# stg 環境(stg 用の AWS アカウント)。main へのマージで deploy.yml が自動で出す。
# イメージの置き場(ECR)もここに置き、prod はここから同じイメージを引く(作り直さない)。
# 育ったら ECR は共有アカウントへ移す。

locals {
  env  = "stg"
  name = "${var.project}-${local.env}"
  # 失敗を Sentry に送る(docs/guides/monitoring.md)。DSN が無ければ送らない
  # Sentry の1件から、そのリクエストのログを開くリンクも付ける(API と画面のサーバーのロググループ)
  # 運営の組織(社員の代理ログイン。docs/runbooks/support-access.md で作ってから ID を入れる)
  support_environment = var.support_tenant_id == null ? {} : { SUPPORT_TENANT_ID = var.support_tenant_id }
  # 公開の LP(apps/site。docs/guides/landing-page.md)。public_site_domain を入れたときだけ、置き場所を作り、API の公開の入口を開く
  public_site_environment = var.public_site_domain == null ? {} : { PUBLIC_SITE_URL = "https://${var.public_site_domain}" }
  # 要配慮個人情報の段1(専用の鍵・要配慮だけの接続。ADR 0029)。sensitive_data_enabled のときだけ
  sensitive_environment = var.sensitive_data_enabled ? { SENSITIVE_KMS_KEY_ID = module.sensitive_data[0].kms_key_arn } : {}
  sensitive_secrets     = var.sensitive_data_enabled ? { SENSITIVE_DATABASE_URL = module.sensitive_data[0].database_url_secret_arn } : {}
  sentry_environment = var.sentry_dsn == null ? {} : {
    SENTRY_DSN           = var.sentry_dsn
    LOGS_INSIGHTS_REGION = var.region
    LOGS_INSIGHTS_GROUPS = "/ecs/${local.name},/ecs/${local.name}-web"
  }
}

module "network" {
  source             = "../../modules/network"
  providers          = { aws = aws.network }
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
  providers                  = { aws = aws.db }
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  allowed_security_group_ids = [module.app.service_security_group_id]
  # stg は使わない間 0 まで縮めて節約する
  min_acu             = 0
  max_acu             = 2
  deletion_protection = false
}

# 要配慮個人情報の段1(ADR 0018・0029)。要配慮の列を足す仕様が承認されたら sensitive_data_enabled = true にして、
# README の「接続ユーザーを1回だけ作る」で app_sensitive_login も作る。段を上げるときは docs/runbooks/sensitive-data-tiers.md
# 鍵の利用の見張りは、管理操作の記録(CloudTrail)のロググループに置く(KMS の出来事も入っている)
module "sensitive_data" {
  count                     = var.sensitive_data_enabled ? 1 : 0
  source                    = "../../modules/sensitive-data"
  name                      = local.name
  task_role_arn             = module.app.task_role_arn
  db_endpoint               = module.aurora.endpoint
  database_name             = module.aurora.database_name
  secrets_kms_key_arn       = module.aurora.kms_key_arn
  cloudtrail_log_group_name = module.audit_trail.log_group_name
  alarm_topic_arn           = module.alerts.topic_arn
}

module "app" {
  source             = "../../modules/ecs-service"
  providers          = { aws = aws.api }
  name               = local.name
  vpc_id             = module.network.vpc_id
  vpc_cidr           = module.network.vpc_cidr
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  image              = "${aws_ecr_repository.this["api"].repository_url}:${var.initial_image_tag}"
  certificate_arn    = aws_acm_certificate_validation.app.certificate_arn
  desired_count      = 1
  # 1〜2台(stg は小さく)。DB の接続は 2台×10本(入れ替えの間 40本)で、Aurora の上限(max_acu 2 で 約400本)に収まる
  autoscaling = { min_count = 1, max_count = 2 }
  # stg はすぐ消せるように
  deletion_protection = false
  alarm_topic_arns    = [module.alerts.topic_arn]

  environment = merge({
    APP_ENV              = local.env
    AUTH_MODE            = "cognito"
    COGNITO_REGION       = var.region
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.this.id
    COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
    APP_URL              = "https://${var.app_domain}"
    # メールは Postfix に渡す(Service Connect)。送り元は SES で確かめたドメイン
    MAIL_SMTP_URL = module.mail.smtp_url
    MAIL_FROM     = "Tasks <no-reply@${var.app_domain}>"
  }, local.sentry_environment, local.support_environment, local.sensitive_environment, local.public_site_environment)
  secrets = merge({
    DATABASE_URL   = module.aurora.database_url_secret_arn
    SESSION_SECRET = aws_secretsmanager_secret.session.arn
  }, local.sensitive_secrets)
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
  providers                     = { aws = aws.web }
  name                          = "${local.name}-web"
  image                         = "${aws_ecr_repository.this["web"].repository_url}:${var.initial_image_tag}"
  desired_count                 = 1
  autoscaling                   = { min_count = 1, max_count = 2 }
  alarm_topic_arns              = [module.alerts.topic_arn]
  cluster_arn                   = module.app.cluster_arn
  vpc_id                        = module.network.vpc_id
  private_subnet_ids            = module.network.private_subnet_ids
  listener_arn                  = module.app.https_listener_arn
  alb_security_group_id         = module.app.alb_security_group_id
  alb_arn_suffix                = module.app.alb_arn_suffix
  api_security_group_id         = module.app.service_security_group_id
  service_connect_namespace_arn = module.app.service_connect_namespace_arn
  # 画面のサーバーとブラウザの失敗も同じ Sentry へ(DSN は秘密ではない。ブラウザに渡る)
  environment = merge({
    APP_ENV = local.env
  }, local.sentry_environment)
}

# ── メール(API → Postfix → SES)。docs/guides/mail.md ─────────────────────────────

module "ses" {
  source          = "../../modules/ses-domain"
  providers       = { aws = aws.mail }
  name            = local.name
  domain          = var.app_domain
  route53_zone_id = var.route53_zone_id
  kms_key_arn     = aws_kms_key.app.arn
}

module "mail" {
  source                        = "../../modules/mail-relay"
  providers                     = { aws = aws.mail }
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
  # 止めた数(数えるだけの間は止めるはずだった数)が多いと鳴らす(docs/runbooks/attack.md)
  alarm_topic_arn = module.alerts.topic_arn
}

module "security_baseline" {
  source             = "../../modules/security-baseline"
  name               = local.name
  findings_topic_arn = module.alerts.topic_arn
}

# 管理操作の記録(CloudTrail → ロックした S3 と CloudWatch Logs)。docs/runbooks/audit-trail.md
module "audit_trail" {
  source          = "../../modules/audit-trail"
  name            = local.name
  alarm_topic_arn = module.alerts.topic_arn
  # prod と同じ形(governance・400日)。手順の練習に使う
  lock_mode      = "governance"
  retention_days = 400
}

# ── 見張りと知らせ(アラーム → SNS → Slack)。docs/guides/monitoring.md ────────────────────

module "alerts" {
  source             = "../../modules/alerts"
  name               = local.name
  slack_team_id      = var.slack_team_id
  slack_channel_id   = var.slack_channel_id
  email_addresses    = var.alert_emails
  monthly_budget_usd = var.monthly_budget_usd
  extra_topic_arns   = [module.uptime.topic_arn]
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
  certificate_arn       = aws_acm_certificate_validation.app.certificate_arn
  # max_acu 2 の上限 約400本の6割。API の台数の上限(autoscaling の max_count)を上げたら見直す
  db_connections_threshold = 250
}

# 外形監視(外から開けるか)。Route 53 の決まりで、アラームはバージニアに置く
module "uptime" {
  source          = "../../modules/uptime"
  name            = local.name
  domain          = var.app_domain
  email_addresses = var.alert_emails
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

# ── バックアップ(消せない保管庫に、毎日と毎月)。docs/runbooks/db-restore.md ─────────────────

module "backup" {
  source         = "../../modules/backup"
  providers      = { aws = aws.db }
  name           = local.name
  db_cluster_arn = module.aurora.cluster_arn
  topic_arn      = module.alerts.topic_arn
  # stg は作り直すことがあるので、外せるロック
  lock_mode = "governance"
}

# ── 費用の見張り(コスト配分タグ・急な変化の知らせ)。docs/guides/cost-dashboard.md ─────────────────

module "cost_watch" {
  source                = "../../modules/cost-watch"
  name                  = local.name
  project               = var.project
  topic_arn             = module.alerts.topic_arn
  activate              = var.activate_cost_allocation_tags
  anomaly_threshold_usd = var.anomaly_threshold_usd
}

# ── 公開の LP(apps/site)の置き場所。docs/guides/landing-page.md・docs/specs/0025-public-landing-page.md ─────

module "public_site" {
  count  = var.public_site_domain == null ? 0 : 1
  source = "../../modules/public-site"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name            = local.name
  domain          = var.public_site_domain
  route53_zone_id = var.route53_zone_id
  app_url         = "https://${var.app_domain}"
  # 検索に載せるのは prod だけ
  indexable = false
}
