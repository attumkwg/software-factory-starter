# メールの中継(Postfix)。アプリ → ここ(Service Connect の smtp://mail:25)→ SES(SMTP・TLS)。docs/guides/mail.md
#
#   - 送り待ちは EFS に置く。デプロイや障害で Postfix が入れ替わっても、SES に渡す前のメールが消えない
#   - 1台だけで動かす(2台で同じ送り待ちを触らない)。入れ替えのときは古い方を止めてから新しい方を起こす
#   - 受け取るのは API のセキュリティグループからだけ。Postfix 自身も mynetworks と送り元のドメインで絞る
#   - SES の SMTP の資格情報は Secrets Manager(modules/ses-domain が作る)から
# タスク定義のイメージは .github/workflows/deploy-mail-relay.yml が更新する(ignore_changes)。

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

locals {
  container_name = "mail"
  smtp_port      = 25
}

# ── ログ ──────────────────────────────────────────────────────────────────────

resource "aws_kms_key" "this" {
  description         = "${var.name} logs and queue"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Account"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${data.aws_region.current.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.this.arn
}

# ── 送り待ち(EFS)───────────────────────────────────────────────────────────────

resource "aws_efs_file_system" "queue" {
  creation_token = "${var.name}-queue"
  encrypted      = true
  kms_key_id     = aws_kms_key.this.arn
  # 使った分だけ払う。送り待ちは数 MB なので、月数十円
  throughput_mode = "elastic"
  tags            = { Name = "${var.name}-queue" }
}

resource "aws_efs_backup_policy" "queue" {
  file_system_id = aws_efs_file_system.queue.id
  # 送り待ちは数分で入れ替わるので、バックアップから戻す意味が無い
  backup_policy {
    status = "DISABLED"
  }
}

resource "aws_security_group" "efs" {
  name        = "${var.name}-efs"
  description = "Mail relay queue (EFS)"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "efs_from_service" {
  security_group_id            = aws_security_group.efs.id
  referenced_security_group_id = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = 2049
  to_port                      = 2049
  description                  = "NFS from mail relay"
}

resource "aws_efs_mount_target" "queue" {
  for_each        = toset(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.queue.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

# この中継のタスクだけがつなげる(TLS と IAM で)。Postfix は持ち主を root と postfix に分けるので、root で触る
resource "aws_efs_file_system_policy" "queue" {
  file_system_id = aws_efs_file_system.queue.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "OnlyTheRelayTask"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.task.arn }
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
        ]
        Resource = aws_efs_file_system.queue.arn
        Condition = {
          Bool = { "elasticfilesystem:AccessedViaMountTarget" = "true" }
        }
      },
      {
        Sid       = "TlsOnly"
        Effect    = "Deny"
        Principal = { AWS = "*" }
        Action    = "*"
        Resource  = aws_efs_file_system.queue.arn
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      }
    ]
  })
}

# ── IAM ───────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# イメージを取り、ログを書き、SES の資格情報(秘密)を読む
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.smtp_credentials_secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = var.secrets_kms_key_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# タスク自身の役割: EFS をつなぐだけ(上のファイルシステムのポリシーで許す)
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ── ネットワーク ───────────────────────────────────────────────────────────────

resource "aws_security_group" "service" {
  name        = "${var.name}-service"
  description = "Mail relay (Postfix) ECS task"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "smtp_from_api" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = var.api_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = local.smtp_port
  to_port                      = local.smtp_port
  description                  = "SMTP from API"
}

resource "aws_vpc_security_group_egress_rule" "api_to_smtp" {
  security_group_id            = var.api_security_group_id
  referenced_security_group_id = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = local.smtp_port
  to_port                      = local.smtp_port
  description                  = "SMTP to mail relay"
}

#trivy:ignore:AVD-AWS-0104 SES の SMTP の入口は IP が決まっていない(名前で引く)。587 だけに絞り、TLS が無ければ渡さない
resource "aws_vpc_security_group_egress_rule" "to_ses" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 587
  to_port           = 587
  description       = "SMTP (STARTTLS) to SES"
}

#trivy:ignore:AVD-AWS-0104 ECR・CloudWatch Logs・Secrets Manager へ NAT 経由で出る。絞るなら VPC エンドポイントに置き換える
resource "aws_vpc_security_group_egress_rule" "https_out" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to AWS APIs (ECR, Logs, Secrets Manager)"
}

resource "aws_vpc_security_group_egress_rule" "to_efs" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.efs.id
  ip_protocol                  = "tcp"
  from_port                    = 2049
  to_port                      = 2049
  description                  = "NFS to queue"
}

# ── タスクとサービス ─────────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "queue"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.queue.id
      transit_encryption = "ENABLED"
      authorization_config {
        iam = "ENABLED"
      }
    }
  }
  # 起動のたびに作る設定(SES のパスワードを含む)。タスクが止まれば消える
  volume {
    name = "run"
  }

  container_definitions = jsonencode([{
    name                   = local.container_name
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = true
    # name は Service Connect が使う(API から smtp://mail:25 で届く)
    portMappings = [{ name = "smtp", containerPort = local.smtp_port, protocol = "tcp" }]
    mountPoints = [
      { sourceVolume = "queue", containerPath = "/var/spool/postfix", readOnly = false },
      { sourceVolume = "run", containerPath = "/run", readOnly = false },
    ]
    environment = [for k, v in {
      POSTFIX_RELAYHOST      = "[email-smtp.${data.aws_region.current.region}.amazonaws.com]:587"
      POSTFIX_RELAY_TLS      = "encrypt"
      POSTFIX_MYNETWORKS     = var.vpc_cidr
      POSTFIX_SENDER_DOMAINS = join(",", var.sender_domains)
      POSTFIX_MYHOSTNAME     = "${var.name}.internal"
    } : { name = k, value = v }]
    secrets = [
      { name = "POSTFIX_RELAY_USERNAME", valueFrom = "${var.smtp_credentials_secret_arn}:username::" },
      { name = "POSTFIX_RELAY_PASSWORD", valueFrom = "${var.smtp_credentials_secret_arn}:password::" },
    ]
    # SIGTERM を受けたら受け付けをやめ、送りかけの物を送り待ちに残して止まる
    stopTimeout = 30
    healthCheck = {
      command  = ["CMD", "postfix", "-c", "/run/postfix/conf", "status"]
      interval = 10
      timeout  = 3
      retries  = 3
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "mail"
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name                   = var.name
  cluster                = var.cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = 1
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = false
  }

  # 2台を同時に動かさない(同じ送り待ちを2つの Postfix が触らない)。入れ替えの間の数十秒は、
  # API が渡せずにアウトボックスがやり直す(メールは遅れるだけで、消えない)
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn
    service {
      port_name      = "smtp"
      discovery_name = "mail"
      client_alias {
        port     = local.smtp_port
        dns_name = "mail"
      }
    }
  }

  lifecycle {
    # イメージの更新は deploy-mail-relay.yml が持つ
    ignore_changes = [task_definition]
  }

  depends_on = [aws_efs_mount_target.queue]
}
