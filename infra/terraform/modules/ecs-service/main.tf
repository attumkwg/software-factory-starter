# API の ECS Fargate のサービス+公開 ALB+blue/green(ECS の組み込み。2025-07〜)。
# ALB とクラスターは画面のサービス(modules/web-service)と共有する:
#   /api/*  → このモジュールの API(優先度 10)
#   それ以外 → web-service の画面(SSR。優先度 20)
# 画面の SSR は API を Service Connect(http://api:3000)で呼ぶ。名前空間もここで作る。
#
# デプロイの流れ(deploy.yml):
#   新しいタスク定義を登録 → サービスを更新 → ECS が green を立てて ALB を切り替え
#   → bake_time の間に 5xx のアラームが鳴ったら自動で blue に戻す
#
# タスク定義のイメージは CD が更新するので、Terraform は「最初の形」だけを持つ(ignore_changes)。

data "aws_region" "current" {}

locals {
  container_name = "api"
  log_group_name = "/ecs/${var.name}"
  base_environment = merge(var.environment, {
    PORT = tostring(var.container_port)
  })
}

# ── 実行の土台 ────────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
  service_connect_defaults {
    namespace = aws_service_discovery_http_namespace.this.arn
  }
}

# サービスどうしが名前で呼び合う場所(画面の SSR → http://api:3000)。VPC の外からは見えない
resource "aws_service_discovery_http_namespace" "this" {
  name        = var.name
  description = "${var.name}: web (SSR) -> api"
}

resource "aws_kms_key" "logs" {
  description         = "${var.name} logs"
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

data "aws_caller_identity" "current" {}

# 標準出力の JSON ログ。requestId / tenantId / traceId で Logs Insights から引ける
resource "aws_cloudwatch_log_group" "this" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
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

# ECS がイメージを取ってきて、秘密を注入するための役割
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        # 「arn:...:secret:名前:キー::」の形でも、秘密そのものの ARN(先頭7つ)にそろえる
        Resource = distinct([for arn in concat(values(var.secrets), values(var.migration_secrets)) : join(":", slice(split(":", arn), 0, 7))])
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.secrets_kms_key_arns
      }
    ]
  })
}

# アプリ自身の役割(S3 などを使うときに足す)。要配慮の鍵(modules/sensitive-data)は、鍵のポリシーでこの役割だけに許す
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# 移行・運営のコマンド(delete-tenant など)の役割。アプリの役割とは分け、何も許さない
# (コマンドから要配慮の鍵を使えないように。ADR 0029)
resource "aws_iam_role" "migrate" {
  name               = "${var.name}-migrate"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# 運営のコマンド create-tenant が、申し込みの置き場の applications/ の下を読むだけ(書く・消す・一覧は渡さない)。
# 申し込みは人が置き、読み終えたら人が消す(docs/runbooks/tenant-provisioning.md)
resource "aws_iam_role_policy" "migrate_read_applications" {
  count = var.applications_store == null ? 0 : 1
  name  = "read-applications"
  role  = aws_iam_role.migrate.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${var.applications_store.bucket_arn}/applications/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.applications_store.kms_key_arn
      }
    ]
  })
}

# blue/green の切り替えで、ECS が ALB のルールを書き換えるための役割
resource "aws_iam_role" "ecs_infrastructure" {
  name = "${var.name}-ecs-infrastructure"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_infrastructure" {
  role       = aws_iam_role.ecs_infrastructure.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonECSInfrastructureRolePolicyForLoadBalancers"
}

# ── ネットワーク ───────────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public ALB"
  vpc_id      = var.vpc_id
}

# CloudFront を前に置くとき(cloudfront_only)は、CloudFront の送り元の一覧からだけ 443 を受ける(80 は開けない)。
# 一覧は全部の CloudFront なので、ルールで秘密のヘッダーも確かめる(origin_header。docs/specs/0058-cloudfront-in-front-of-app.md)
data "aws_ec2_managed_prefix_list" "cloudfront" {
  count = var.cloudfront_only ? 1 : 0
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https_from_cloudfront" {
  count             = var.cloudfront_only ? 1 : 0
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront[0].id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS from CloudFront only"
}

#trivy:ignore:AVD-AWS-0107 CloudFront を前に置かない形(cloudfront_only = false)では、ALB だけはインターネットから受ける(前に WAF を置く)
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  count             = var.cloudfront_only ? 0 : 1
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS from internet"
}

#trivy:ignore:AVD-AWS-0107 HTTP は HTTPS へ転送するだけ(CloudFront を前に置かない形のときだけ)
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  count             = var.cloudfront_only ? 0 : 1
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP redirect to HTTPS"
}

# cloudfront_only を足す前の入口の規則(数を付ける前の住所)を、作り直さずに引き継ぐ
moved {
  from = aws_vpc_security_group_ingress_rule.alb_https
  to   = aws_vpc_security_group_ingress_rule.alb_https[0]
}

moved {
  from = aws_vpc_security_group_ingress_rule.alb_http
  to   = aws_vpc_security_group_ingress_rule.alb_http[0]
}

resource "aws_vpc_security_group_egress_rule" "alb_to_service" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  description                  = "To ECS tasks"
}

resource "aws_security_group" "service" {
  name        = "${var.name}-service"
  description = "ECS tasks"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "service_from_alb" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  description                  = "From ALB"
}

#trivy:ignore:AVD-AWS-0104 ECR・Secrets Manager・Cognito へ NAT 経由で出る。絞るなら VPC エンドポイントに置き換える
resource "aws_vpc_security_group_egress_rule" "service_out" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to AWS APIs"
}

resource "aws_vpc_security_group_egress_rule" "service_to_db" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
  description       = "Postgres in VPC"
}

# ── ALB(blue / green の2つのターゲットグループ) ───────────────────────────────

#trivy:ignore:AVD-AWS-0053 公開する Web アプリの入口
resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
}

resource "aws_lb_target_group" "this" {
  for_each    = toset(["blue", "green"])
  name        = "${var.name}-${each.key}"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  # SIGTERM を受けてから /readyz が 503 になり、ALB が外すまでの猶予
  deregistration_delay = 30
  health_check {
    path                = "/readyz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 10
    timeout             = 5
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# blue/green で ECS が重みを書き換える「本番のルール」。API は /api/* だけ(それ以外は画面のサービス)
resource "aws_lb_listener_rule" "production" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.this["blue"].arn
        weight = 100
      }
      target_group {
        arn    = aws_lb_target_group.this["green"].arn
        weight = 0
      }
    }
  }
  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
  # CloudFront だけが知るヘッダー(名前も値も秘密)。無い・違えば、どのルールにも当たらず既定の 404
  dynamic "condition" {
    for_each = var.cloudfront_only ? [1] : []
    content {
      http_header {
        http_header_name = var.origin_header.name
        values           = var.origin_header.values
      }
    }
  }
  lifecycle {
    ignore_changes = [action]
  }
}

# ── アラーム(鳴ったら blue/green を自動で戻す) ───────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  alarm_name          = "${var.name}-target-5xx"
  alarm_description   = "API の 5xx が増えた。デプロイ中なら自動で戻る。docs/runbooks/alarms.md#target-5xx"
  evaluation_periods  = 2
  threshold           = var.alarm_5xx_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_topic_arns
  ok_actions          = var.alarm_topic_arns

  # ALB は画面と共有なので、API のターゲットグループ(blue と green)の分だけを足す
  metric_query {
    id          = "total"
    expression  = "FILL(blue, 0) + FILL(green, 0)"
    label       = "API 5xx"
    return_data = true
  }
  dynamic "metric_query" {
    for_each = aws_lb_target_group.this
    content {
      id = metric_query.key
      metric {
        namespace   = "AWS/ApplicationELB"
        metric_name = "HTTPCode_Target_5XX_Count"
        stat        = "Sum"
        period      = 60
        dimensions = {
          LoadBalancer = aws_lb.this.arn_suffix
          TargetGroup  = metric_query.value.arn_suffix
        }
      }
    }
  }
}

# ── タスク定義とサービス ─────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "app" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = local.container_name
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = true
    # name は Service Connect が使う(画面の SSR から http://api:3000 で届く)
    portMappings = [{ name = "http", containerPort = var.container_port, protocol = "tcp", appProtocol = "http" }]
    environment  = [for k, v in local.base_environment : { name = k, value = v }]
    secrets      = [for k, arn in var.secrets : { name = k, valueFrom = arn }]
    # SIGTERM を受けてから止まるまでの猶予(アプリは SHUTDOWN_TIMEOUT_MS=25秒で打ち切る)
    stopTimeout = 30
    healthCheck = {
      command  = ["CMD", "/nodejs/bin/node", "-e", "fetch('http://localhost:${var.container_port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval = 10
      timeout  = 3
      retries  = 3
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "app"
      }
    }
  }])
}

# 移行だけを流す1回きりのタスク(deploy.yml が新しい版を出す前に run-task する)
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.migrate.arn
  container_definitions = jsonencode([{
    name                   = "migrate"
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = true
    command                = ["dist/cli.js", "migrate"]
    # 表の持ち主でつなぐ。node-postgres は PG* の環境変数を読む
    # 申し込みの置き場があれば APPLICATIONS_BUCKET も(create-tenant が読む)
    environment = [for k, v in merge(var.migration_environment, var.applications_store == null ? {} : { APPLICATIONS_BUCKET = var.applications_store.bucket }) : { name = k, value = v }]
    secrets     = [for k, arn in var.migration_secrets : { name = k, valueFrom = arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name                   = var.name
  cluster                = aws_ecs_cluster.this.id
  task_definition        = aws_ecs_task_definition.app.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = false
  }

  deployment_controller {
    type = "ECS"
  }

  deployment_configuration {
    strategy             = "BLUE_GREEN"
    bake_time_in_minutes = var.bake_time_minutes
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  alarms {
    alarm_names = [aws_cloudwatch_metric_alarm.target_5xx.alarm_name]
    enable      = true
    rollback    = true
  }

  # 画面の SSR から http://api:3000 で呼べるようにする
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
    service {
      port_name      = "http"
      discovery_name = "api"
      client_alias {
        port     = var.container_port
        dns_name = "api"
      }
    }
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this["blue"].arn
    container_name   = local.container_name
    container_port   = var.container_port
    advanced_configuration {
      alternate_target_group_arn = aws_lb_target_group.this["green"].arn
      production_listener_rule   = aws_lb_listener_rule.production.arn
      role_arn                   = aws_iam_role.ecs_infrastructure.arn
    }
  }

  lifecycle {
    # イメージの更新は CD(deploy.yml)が持つ
    ignore_changes = [task_definition, load_balancer, desired_count]
  }

  depends_on = [aws_lb_listener_rule.production]
}

# ── 台数の自動調整(CPU の平均を目標に保つ) ─────────────────────────────────────────
# リクエスト数(ALBRequestCountPerTarget)では見ない: blue/green でターゲットグループが入れ替わるので、
# 1つのターゲットグループに結びつけられない。CPU なら入れ替えに関係なく使える。
# 入れ替えの間は ECS が縮める側を止める。台数は deploy.yml も Terraform も触らない(desired_count は ignore_changes)。

resource "aws_appautoscaling_target" "this" {
  count              = var.autoscaling == null ? 0 : 1
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.this.name}"
  min_capacity       = var.autoscaling.min_count
  max_capacity       = var.autoscaling.max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  count              = var.autoscaling == null ? 0 : 1
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension
  resource_id        = aws_appautoscaling_target.this[0].resource_id
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = var.autoscaling.cpu_target_percent
    # 増やすのは早く(1分)、減らすのはゆっくり(5分。行ったり来たりしない)
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
