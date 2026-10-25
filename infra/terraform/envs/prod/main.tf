# prod 環境(本番だけの AWS アカウント。AI の環境からは届かない)。
# deploy.yml の prod ジョブ(GitHub の environment「prod」の承認のあと)だけが出せる。
# イメージは stg で作ったものを、そのまま引く(作り直さない)。

locals {
  env  = "prod"
  name = "${var.project}-${local.env}"
  # 失敗を Sentry に送る(docs/guides/monitoring.md)。DSN が無ければ送らない
  # Sentry の1件から、そのリクエストのログを開くリンクも付ける(API と画面のサーバーのロググループ)
  # 運営の組織(社員の代理ログイン。docs/runbooks/support-access.md で作ってから ID を入れる)
  support_environment = var.support_tenant_id == null ? {} : { SUPPORT_TENANT_ID = var.support_tenant_id }
  sentry_environment = var.sentry_dsn == null ? {} : {
    SENTRY_DSN           = var.sentry_dsn
    LOGS_INSIGHTS_REGION = var.region
    LOGS_INSIGHTS_GROUPS = "/ecs/${local.name},/ecs/${local.name}-web"
  }
}

module "network" {
  source = "../../modules/network"
  name   = local.name
  # 本番は AZ ごとに NAT を持つ(1つの AZ の障害で外に出られなくならないように)
  single_nat_gateway      = false
  flow_log_retention_days = 90
}

resource "aws_kms_key" "app" {
  description         = "${local.name} app secrets"
  enable_key_rotation = true
}

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

module "aurora" {
  source                     = "../../modules/aurora"
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  allowed_security_group_ids = [module.app.service_security_group_id]
  min_acu                    = 0.5
  max_acu                    = 8
  instance_count             = 2
  backup_retention_days      = 14
  deletion_protection        = true
}

module "app" {
  source             = "../../modules/ecs-service"
  name               = local.name
  vpc_id             = module.network.vpc_id
  vpc_cidr           = module.network.vpc_cidr
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  image              = "${var.image_repository_url}:${var.initial_image_tag}"
  certificate_arn    = aws_acm_certificate_validation.app.certificate_arn
  desired_count      = 2
  # 2〜6台。DB の接続: 6台×プール10本=60本(blue/green の入れ替えの間は2倍の120本)+移行の1本。
  # Aurora の上限(max_acu 8 で 1,669本)の1割に収まる。上限を上げるなら DB の CPU と費用を先に見る
  autoscaling        = { min_count = 2, max_count = 6 }
  cpu                = 1024
  memory             = 2048
  log_retention_days = 90
  bake_time_minutes  = 10
  alarm_topic_arns   = [module.alerts.topic_arn]

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
  }, local.sentry_environment, local.support_environment)
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
    PGPASSWORD = "${module.aurora.master_user_secret_arn}:password::"
  }
  secrets_kms_key_arns = [aws_kms_key.app.arn, module.aurora.kms_key_arn]
}

# 画面(SSR)。ALB・クラスターは module.app と共有。/api/* 以外がここに来る
module "web" {
  source                        = "../../modules/web-service"
  name                          = "${local.name}-web"
  image                         = "${var.web_image_repository_url}:${var.initial_image_tag}"
  desired_count                 = 2
  autoscaling                   = { min_count = 2, max_count = 6 } # 画面は DB につながないので、上限は費用で決める
  log_retention_days            = 90
  bake_time_minutes             = 10
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
  image                         = "${var.mail_image_repository_url}:${var.initial_image_tag}"
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

# 管理操作の記録(CloudTrail → 消せない S3 と CloudWatch Logs)。docs/runbooks/audit-trail.md
module "audit_trail" {
  source          = "../../modules/audit-trail"
  name            = local.name
  alarm_topic_arn = module.alerts.topic_arn
  # ⚠️ compliance: 保存の期間が過ぎるまで、root でも消せない・バケットも消せない。apply の前に
  #    保存の日数を確かめる(docs/runbooks/audit-trail.md の 2)
  lock_mode      = "compliance"
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
    api  = { service_name = module.app.service_name, min_running = 2 }
    web  = { service_name = module.web.service_name, min_running = 2 }
    mail = { service_name = module.mail.service_name, min_running = 1 }
  }
  alb_arn_suffix = module.app.alb_arn_suffix
  target_groups = {
    api = module.app.target_group_arn_suffixes
    web = module.web.target_group_arn_suffixes
  }
  db_cluster_identifier = module.aurora.cluster_identifier
  certificate_arn       = aws_acm_certificate_validation.app.certificate_arn
  # max_acu 8 の上限 1,669本の6割。API の台数の上限(autoscaling の max_count)を上げたら見直す
  db_connections_threshold = 1000
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
  name           = local.name
  db_cluster_arn = module.aurora.cluster_arn
  topic_arn      = module.alerts.topic_arn
  # ⚠️ compliance: apply から3日を過ぎると、ロックも保存の期間も誰にも変えられない(root でも)。
  #    3日のうちに、保管庫・保存の期間・毎月の分が1年、を確かめる(docs/runbooks/db-restore.md の 6)
  lock_mode = "compliance"
}
