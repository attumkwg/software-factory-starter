# PR ごとのプレビュー環境(1つの PR = ECS のサービス1つ+共有 ALB のルール2つ)。
#
#   https://pr-<番号>.preview.<domain>  →  共有の ALB(envs/preview/base)
#     → ホスト名+/api/* のルール → API(3000)
#     → ホスト名だけのルール     → 画面の SSR(3001)
#   本番の「/api/* は API、それ以外は画面」と同じ振り分け。
#
# タスクの中身(1タスクに4つのコンテナ):
#   db    … Postgres(コンテナ。種データだけ・本番の個人データは使わない)
#   setup … 接続ユーザーを作る → 移行 → 種データ(終わったら止まる)
#   api   … API(開発用ログインが有効。APP_ENV=preview)
#   web   … 画面の SSR。同じタスクなので API は http://localhost:3000
# タスクが止まれば DB も消える(PR を閉じたら destroy、毎晩取り残しを掃除)。

data "aws_region" "current" {}

locals {
  name = "preview-pr-${var.pr_number}"
  host = "pr-${var.pr_number}.preview.${var.domain}"
}

locals {
  # コンテナ → ポート。ルールの優先度は PR 番号×2(API)と ×2+1(画面)で、PR ごとにかぶらない
  targets = {
    api = { port = 3000, priority = var.pr_number * 2, paths = ["/api/*"] }
    web = { port = 3001, priority = var.pr_number * 2 + 1, paths = null }
  }
}

resource "aws_lb_target_group" "this" {
  for_each             = local.targets
  name                 = "${local.name}-${each.key}"
  port                 = each.value.port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 5
  health_check {
    path                = "/readyz"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 10
  }
}

resource "aws_lb_listener_rule" "this" {
  for_each     = local.targets
  listener_arn = var.listener_arn
  priority     = each.value.priority
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[each.key].arn
  }
  condition {
    host_header {
      values = [local.host]
    }
  }
  dynamic "condition" {
    for_each = each.value.paths == null ? [] : [each.value.paths]
    content {
      path_pattern {
        values = condition.value
      }
    }
  }
}

# PR ごとのセッションの秘密(使い捨て)
resource "random_password" "session" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "session" {
  name                    = "${local.name}/session-secret"
  recovery_window_in_days = 0
  kms_key_id              = var.secrets_kms_key_arn
}

resource "aws_secretsmanager_secret_version" "session" {
  secret_id     = aws_secretsmanager_secret.session.id
  secret_string = random_password.session.result
}

locals {
  logs = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = var.log_group_name
      awslogs-region        = data.aws_region.current.region
      awslogs-stream-prefix = local.name
    }
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 2048
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  container_definitions = jsonencode([
    {
      name      = "db"
      image     = var.postgres_image
      essential = true
      # タスクの外からは届かない(セキュリティグループは ALB → 3000 だけ)ので、中は trust
      environment = [
        { name = "POSTGRES_DB", value = "app" },
        { name = "POSTGRES_HOST_AUTH_METHOD", value = "trust" },
      ]
      healthCheck = {
        command  = ["CMD-SHELL", "pg_isready -U postgres -d app"]
        interval = 5
        timeout  = 3
        retries  = 20
      }
      logConfiguration = local.logs
    },
    {
      name      = "setup"
      image     = var.image
      essential = false
      command   = ["dist/cli.js", "init-roles", "migrate", "seed"]
      environment = [
        { name = "APP_ENV", value = "preview" },
        { name = "SUPERUSER_DATABASE_URL", value = "postgres://postgres@localhost:5432/app" },
        { name = "MIGRATION_DATABASE_URL", value = "postgres://app_owner@localhost:5432/app" },
      ]
      dependsOn        = [{ containerName = "db", condition = "HEALTHY" }]
      logConfiguration = local.logs
    },
    {
      name         = "api"
      image        = var.image
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "APP_ENV", value = "preview" },
        { name = "AUTH_MODE", value = "dev" },
        { name = "DATABASE_URL", value = "postgres://app@localhost:5432/app" },
        { name = "LOG_LEVEL", value = "debug" },
      ]
      secrets          = [{ name = "SESSION_SECRET", valueFrom = aws_secretsmanager_secret.session.arn }]
      dependsOn        = [{ containerName = "setup", condition = "SUCCESS" }]
      stopTimeout      = 30
      logConfiguration = local.logs
    },
    {
      name         = "web"
      image        = var.web_image
      essential    = true
      portMappings = [{ containerPort = 3001, protocol = "tcp" }]
      environment = [
        { name = "PORT", value = "3001" },
        { name = "API_INTERNAL_URL", value = "http://localhost:3000" },
        { name = "LOG_LEVEL", value = "debug" },
      ]
      dependsOn        = [{ containerName = "setup", condition = "SUCCESS" }]
      stopTimeout      = 30
      logConfiguration = local.logs
    },
  ])
}

resource "aws_ecs_service" "this" {
  name            = local.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = 1
  # 安い Fargate Spot で動かす(止められても、プレビューなので作り直せばよい)
  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.service_security_group_id]
    assign_public_ip = false
  }
  dynamic "load_balancer" {
    for_each = local.targets
    content {
      target_group_arn = aws_lb_target_group.this[load_balancer.key].arn
      container_name   = load_balancer.key
      container_port   = load_balancer.value.port
    }
  }
  # 片付けで探せるように
  tags = {
    "preview:pr" = tostring(var.pr_number)
  }
  wait_for_steady_state = true
  depends_on            = [aws_lb_listener_rule.this]
}
