# プレビュー環境の「共有の土台」(dev 用の AWS アカウント。人が1回だけ apply する)。
# PR ごとの部分は envs/preview/pr(preview.yml が PR ごとに apply / destroy)。
#
#   *.preview.<domain> → 共有 ALB(HTTPS・ワイルドカード証明書)→ PR ごとのホスト名のルール
#
# 費用の目安: ALB 1つ+NAT 1つ+PR ごとの Fargate Spot。PR を閉じたら消し、毎晩取り残しを掃除する。

locals {
  name = "preview"
}

module "network" {
  source             = "../../../modules/network"
  name               = local.name
  cidr               = "10.20.0.0/16"
  single_nat_gateway = true
}

resource "aws_ecs_cluster" "this" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }
}

resource "aws_kms_key" "preview" {
  description         = "preview secrets, images and logs"
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
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "preview" {
  name          = "alias/preview"
  target_key_id = aws_kms_key.preview.key_id
}

resource "aws_cloudwatch_log_group" "preview" {
  name              = "/ecs/preview"
  retention_in_days = 7
  kms_key_id        = aws_kms_key.preview.arn
}

# API と画面(SSR)の2つ
resource "aws_ecr_repository" "this" {
  for_each             = toset(["api", "web"])
  name                 = "${var.project}/${each.key}-preview"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.preview.arn
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "expire after 14 days"
      selection    = { tagStatus = "any", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }
      action       = { type = "expire" }
    }]
  })
}

moved {
  from = aws_ecr_repository.api
  to   = aws_ecr_repository.this["api"]
}

moved {
  from = aws_ecr_lifecycle_policy.api
  to   = aws_ecr_lifecycle_policy.this["api"]
}

# PR のタスクの中のポート: API 3000 / 画面(SSR)3001。ALB はホスト名+パスでどちらかへ
locals {
  task_ports = toset(["3000", "3001"])
}

# ── 共有の ALB ───────────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "preview-alb"
  description = "Preview ALB"
  vpc_id      = module.network.vpc_id
}

# プレビューは社内の人だけが見る。allowed_cidrs を会社の出口の IP に絞る
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each          = toset(var.allowed_cidrs)
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_services" {
  for_each                     = local.task_ports
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  description                  = "To preview tasks"
}

resource "aws_security_group" "service" {
  name        = "preview-service"
  description = "Preview ECS tasks"
  vpc_id      = module.network.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "service_from_alb" {
  for_each                     = local.task_ports
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  description                  = "From ALB"
}

moved {
  from = aws_vpc_security_group_egress_rule.alb_to_services
  to   = aws_vpc_security_group_egress_rule.alb_to_services["3000"]
}

moved {
  from = aws_vpc_security_group_ingress_rule.service_from_alb
  to   = aws_vpc_security_group_ingress_rule.service_from_alb["3000"]
}

#trivy:ignore:AVD-AWS-0104 ECR とイメージの取得に NAT 経由で出る
resource "aws_vpc_security_group_egress_rule" "service_out" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS out"
}

#trivy:ignore:AVD-AWS-0053 社内からの確認用。入口は allowed_cidrs で絞る
resource "aws_lb" "this" {
  name                       = local.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = module.network.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
}

resource "aws_acm_certificate" "wildcard" {
  domain_name       = "*.preview.${var.domain}"
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.wildcard.domain_validation_options : o.domain_name => o
  }
  zone_id = var.route53_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.wildcard.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "no preview for this host"
      status_code  = "404"
    }
  }
}

resource "aws_route53_record" "wildcard" {
  zone_id = var.route53_zone_id
  name    = "*.preview.${var.domain}"
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}

# ── PR のタスクが使う役割 ──────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "preview-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-preview-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:preview-pr-*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.preview.arn
      }
    ]
  })
}

resource "aws_iam_role" "task" {
  name               = "preview-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_caller_identity" "current" {}
