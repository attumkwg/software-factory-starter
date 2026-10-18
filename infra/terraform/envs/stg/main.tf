# stg 環境(stg 用の AWS アカウント)。main へのマージで deploy.yml が自動で出す。
# イメージの置き場(ECR)もここに置き、prod はここから同じイメージを引く(作り直さない)。
# 育ったら ECR は共有アカウントへ移す。

locals {
  env  = "stg"
  name = "${var.project}-${local.env}"
}

module "network" {
  source             = "../../modules/network"
  name               = local.name
  single_nat_gateway = true
}

# ── イメージの置き場 ──────────────────────────────────────────────────────────

resource "aws_kms_key" "app" {
  description         = "${local.name} app secrets and images"
  enable_key_rotation = true
}

# API と画面(SSR)の2つ。どちらも stg で作り、prod は同じイメージを引く
resource "aws_ecr_repository" "this" {
  for_each             = toset(["api", "web", "mail"])
  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.app.arn
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 50 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
      action       = { type = "expire" }
    }]
  })
}

# prod のアカウントから同じイメージを引けるように
resource "aws_ecr_repository_policy" "this" {
  for_each   = length(var.image_pull_account_ids) > 0 ? aws_ecr_repository.this : {}
  repository = each.value.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CrossAccountPull"
      Effect    = "Allow"
      Principal = { AWS = [for id in var.image_pull_account_ids : "arn:aws:iam::${id}:root"] }
      Action    = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    }]
  })
}

# 画面のイメージを足したときに、API の置き場を作り直さない(名前が変わっただけ)
moved {
  from = aws_ecr_repository.api
  to   = aws_ecr_repository.this["api"]
}

moved {
  from = aws_ecr_lifecycle_policy.api
  to   = aws_ecr_lifecycle_policy.this["api"]
}

moved {
  from = aws_ecr_repository_policy.api[0]
  to   = aws_ecr_repository_policy.this["api"]
}

# ── 秘密 ─────────────────────────────────────────────────────────────────────

resource "random_password" "session" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "session" {
  name       = "${local.name}/session-secret"
  kms_key_id = aws_kms_key.app.arn
}

resource "aws_secretsmanager_secret_version" "session" {
  secret_id     = aws_secretsmanager_secret.session.id
  secret_string = random_password.session.result
}

# ── DB とアプリ ───────────────────────────────────────────────────────────────

module "aurora" {
  source                     = "../../modules/aurora"
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  allowed_security_group_ids = [module.app.service_security_group_id]
  # stg は使わない間 0 まで縮めて節約する
  min_acu             = 0
  max_acu             = 2
  deletion_protection = false
}

module "app" {
  source             = "../../modules/ecs-service"
  name               = local.name
  vpc_id             = module.network.vpc_id
  vpc_cidr           = module.network.vpc_cidr
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  image              = "${aws_ecr_repository.this["api"].repository_url}:${var.initial_image_tag}"
  certificate_arn    = aws_acm_certificate_validation.app.certificate_arn
  desired_count      = 1
  # stg はすぐ消せるように
  deletion_protection = false
  alarm_topic_arns    = [module.alerts.topic_arn]

  environment = {
    APP_ENV              = local.env
    AUTH_MODE            = "cognito"
    COGNITO_REGION       = var.region
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.this.id
    COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
    APP_URL              = "https://${var.app_domain}"
    # メールは Postfix に渡す(Service Connect)。送り元は SES で確かめたドメイン
    MAIL_SMTP_URL = module.mail.smtp_url
    MAIL_FROM     = "Tasks <no-reply@${var.app_domain}>"
  }
  secrets = {
    DATABASE_URL   = module.aurora.database_url_secret_arn
    SESSION_SECRET = aws_secretsmanager_secret.session.arn
  }
  migration_environment = {
    PGHOST     = module.aurora.endpoint
    PGDATABASE = module.aurora.database_name
    PGUSER     = "app_owner"
    PGSSLMODE  = "verify-full"
  }
  migration_secrets = {
    # RDS が管理する JSON の秘密から password のキーだけ
    PGPASSWORD = "${module.aurora.master_user_secret_arn}:password::"
  }
  secrets_kms_key_arns = [aws_kms_key.app.arn, module.aurora.kms_key_arn]
}

# 画面(SSR)。ALB・クラスターは module.app と共有。/api/* 以外がここに来る
module "web" {
  source                        = "../../modules/web-service"
  name                          = "${local.name}-web"
  image                         = "${aws_ecr_repository.this["web"].repository_url}:${var.initial_image_tag}"
  desired_count                 = 1
  alarm_topic_arns              = [module.alerts.topic_arn]
  cluster_arn                   = module.app.cluster_arn
  vpc_id                        = module.network.vpc_id
  private_subnet_ids            = module.network.private_subnet_ids
  listener_arn                  = module.app.https_listener_arn
  alb_security_group_id         = module.app.alb_security_group_id
  alb_arn_suffix                = module.app.alb_arn_suffix
  api_security_group_id         = module.app.service_security_group_id
  service_connect_namespace_arn = module.app.service_connect_namespace_arn
  environment = {
    APP_ENV = local.env
  }
}

# ── メール(API → Postfix → SES)。docs/guides/mail.md ─────────────────────────────

module "ses" {
  source          = "../../modules/ses-domain"
  name            = local.name
  domain          = var.app_domain
  route53_zone_id = var.route53_zone_id
  kms_key_arn     = aws_kms_key.app.arn
}

module "mail" {
  source                        = "../../modules/mail-relay"
  name                          = "${local.name}-mail"
  image                         = "${aws_ecr_repository.this["mail"].repository_url}:${var.initial_image_tag}"
  cluster_arn                   = module.app.cluster_arn
  vpc_id                        = module.network.vpc_id
  vpc_cidr                      = module.network.vpc_cidr
  private_subnet_ids            = module.network.private_subnet_ids
  api_security_group_id         = module.app.service_security_group_id
  service_connect_namespace_arn = module.app.service_connect_namespace_arn
  sender_domains                = [var.app_domain]
  smtp_credentials_secret_arn   = module.ses.smtp_credentials_secret_arn
  secrets_kms_key_arns          = [aws_kms_key.app.arn]
}

# ── DNS と証明書 ───────────────────────────────────────────────────────────────

resource "aws_acm_certificate" "app" {
  domain_name       = var.app_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.app.domain_validation_options : o.domain_name => o
  }
  zone_id = var.route53_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "app" {
  certificate_arn         = aws_acm_certificate.app.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "app" {
  zone_id = var.route53_zone_id
  name    = var.app_domain
  type    = "A"
  alias {
    name                   = module.app.alb_dns_name
    zone_id                = module.app.alb_zone_id
    evaluate_target_health = true
  }
}

# ── 見張り(WAF・GuardDuty・Security Hub) ─────────────────────────────────────────

module "waf" {
  source  = "../../modules/waf"
  name    = local.name
  alb_arn = module.app.alb_arn
  # 入れたばかりは数えるだけ。誤検知が無いのを確かめてから block に
  mode = "count"
}

module "security_baseline" {
  source             = "../../modules/security-baseline"
  name               = local.name
  findings_topic_arn = module.alerts.topic_arn
}

# ── 見張りと知らせ(アラーム → SNS → Slack)。docs/guides/monitoring.md ────────────────────

module "alerts" {
  source             = "../../modules/alerts"
  name               = local.name
  slack_team_id      = var.slack_team_id
  slack_channel_id   = var.slack_channel_id
  email_addresses    = var.alert_emails
  monthly_budget_usd = var.monthly_budget_usd
}

module "monitoring" {
  source       = "../../modules/monitoring"
  name         = local.name
  topic_arn    = module.alerts.topic_arn
  cluster_name = module.app.cluster_name
  cluster_arn  = module.app.cluster_arn
  services = {
    api  = { service_name = module.app.service_name, min_running = 1 }
    web  = { service_name = module.web.service_name, min_running = 1 }
    mail = { service_name = module.mail.service_name, min_running = 1 }
  }
  alb_arn_suffix = module.app.alb_arn_suffix
  target_groups = {
    api = module.app.target_group_arn_suffixes
    web = module.web.target_group_arn_suffixes
  }
  db_cluster_identifier = module.aurora.cluster_identifier
}
