# 画面のサービス(apps/web の SSR)。ECS Fargate+blue/green。ALB とクラスターは API(modules/ecs-service)と共有する。
#
#   ブラウザ → ALB ─ /api/*  → API のサービス(優先度 10)
#                 └ それ以外 → このサービス(優先度 20)→ HTML を描くときに API を http://api:3000 で読む(Service Connect)
#
# 持たないもの: DB の接続・秘密(SESSION_SECRET など)。Cookie は受け取ったものを API に渡すだけ。
# タスク定義のイメージは CD(deploy.yml)が更新するので、Terraform は「最初の形」だけを持つ(ignore_changes)。

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

locals {
  container_name = "web"
  environment = merge(var.environment, {
    PORT             = tostring(var.container_port)
    API_INTERNAL_URL = "http://api:${var.api_port}"
  })
}

# ── ログ ──────────────────────────────────────────────────────────────────────

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

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
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

# イメージを取ってきて、ログを書くだけ(秘密は読まない)
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# アプリ自身の役割(AWS の API は呼ばないので空)
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
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

resource "aws_security_group" "service" {
  name        = "${var.name}-service"
  description = "Web (SSR) ECS tasks"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "service_from_alb" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  description                  = "From ALB"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_service" {
  security_group_id            = var.alb_security_group_id
  referenced_security_group_id = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  description                  = "To web (SSR) tasks"
}

# SSR → API(Service Connect)
resource "aws_vpc_security_group_egress_rule" "service_to_api" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = var.api_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.api_port
  to_port                      = var.api_port
  description                  = "To API via Service Connect"
}

resource "aws_vpc_security_group_ingress_rule" "api_from_service" {
  security_group_id            = var.api_security_group_id
  referenced_security_group_id = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = var.api_port
  to_port                      = var.api_port
  description                  = "From web (SSR) via Service Connect"
}

#trivy:ignore:AVD-AWS-0104 ECR と CloudWatch Logs へ NAT 経由で出る。絞るなら VPC エンドポイントに置き換える
resource "aws_vpc_security_group_egress_rule" "service_out" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to AWS APIs"
}

# ── ALB(共有の ALB に、blue / green のターゲットグループとルールを足す) ───────────────

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

# /api/* 以外は全部ここ。API のルール(優先度 10)より後に見る
resource "aws_lb_listener_rule" "production" {
  listener_arn = var.listener_arn
  priority     = var.listener_rule_priority
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
      values = ["/*"]
    }
  }
  lifecycle {
    ignore_changes = [action]
  }
}

# ── アラーム(鳴ったら blue/green を自動で戻す) ───────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  alarm_name          = "${var.name}-target-5xx"
  alarm_description   = "画面(SSR)の 5xx が増えた。デプロイ中なら自動で戻る。docs/runbooks/alarms.md#target-5xx"
  evaluation_periods  = 2
  threshold           = var.alarm_5xx_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_topic_arns
  ok_actions          = var.alarm_topic_arns

  # ALB は API と共有なので、画面のターゲットグループ(blue と green)の分だけを足す
  metric_query {
    id          = "total"
    expression  = "FILL(blue, 0) + FILL(green, 0)"
    label       = "Web 5xx"
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
          LoadBalancer = var.alb_arn_suffix
          TargetGroup  = metric_query.value.arn_suffix
        }
      }
    }
  }
}

# ── タスク定義とサービス ─────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "this" {
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
    portMappings           = [{ name = "http", containerPort = var.container_port, protocol = "tcp", appProtocol = "http" }]
    environment            = [for k, v in local.environment : { name = k, value = v }]
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
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name                   = var.name
  cluster                = var.cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
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

  # 呼ぶ側だけ(http://api:3000 が引ける)。このサービス自身は名前で呼ばれない
  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn
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
# SSR は HTML を描く CPU が先に詰まる。リクエスト数で見ないのは API と同じ理由(blue/green で
# ターゲットグループが入れ替わる)。台数は deploy.yml も Terraform も触らない(desired_count は ignore_changes)。

resource "aws_appautoscaling_target" "this" {
  count              = var.autoscaling == null ? 0 : 1
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${element(split("/", var.cluster_arn), 1)}/${aws_ecs_service.this.name}"
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
    target_value       = var.autoscaling.cpu_target_percent
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
