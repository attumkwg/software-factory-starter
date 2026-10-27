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
  # 公開の LP(apps/site。docs/guides/landing-page.md)。public_site_domain を入れたときだけ、置き場所を作り、API の公開の入口を開く
  public_site_environment = var.public_site_domain == null ? {} : { PUBLIC_SITE_URL = "https://${var.public_site_domain}" }
  # 要配慮個人情報の段1(専用の鍵・要配慮だけの接続。ADR 0029)。sensitive_data_enabled のときだけ
  sensitive_environment = var.sensitive_data_enabled ? { SENSITIVE_KMS_KEY_ID = module.sensitive_data[0].kms_key_arn } : {}
  sensitive_secrets     = var.sensitive_data_enabled ? { SENSITIVE_DATABASE_URL = module.sensitive_data[0].database_url_secret_arn } : {}
  # アプリの前の CloudFront(docs/specs/0058-cloudfront-in-front-of-app.md)。ALB へは origin.<app_domain> で向かう。
  # いまの人の IP は CloudFront が付ける CloudFront-Viewer-Address から読む(API と画面のサーバー。組織ごとの IP の制限)
  origin_domain         = "origin.${var.app_domain}"
  client_ip_environment = var.app_cloudfront ? { CLIENT_IP_HEADER = "cloudfront-viewer-address", TRUSTED_PROXY_HOPS = "1" } : {}
  sentry_environment = var.sentry_dsn == null ? {} : {
    SENTRY_DSN           = var.sentry_dsn
    LOGS_INSIGHTS_REGION = var.region
    LOGS_INSIGHTS_GROUPS = "/ecs/${local.name},/ecs/${local.name}-web"
  }
  # 写真・ファイルの置き場(docs/specs/0072-file-storage.md)。API は役割を組織ごとに絞って引き受ける(ADR 0079)。
  # 移行のタスクにも渡す(解約の削除 delete-tenant が、その組織の中身を前の版まで消す)
  files_environment = {
    FILES_BUCKET          = module.files.bucket
    FILES_REGION          = var.region
    FILES_ACCESS_ROLE_ARN = module.files.access_role_arn
  }
}

module "network" {
  source    = "../../modules/network"
  providers = { aws = aws.network }
  name      = local.name
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
  providers                  = { aws = aws.db }
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
  image              = "${var.image_repository_url}:${var.initial_image_tag}"
  certificate_arn    = aws_acm_certificate_validation.app.certificate_arn
  # CloudFront からだけ受ける(送り元の一覧・秘密のヘッダー。docs/specs/0058-cloudfront-in-front-of-app.md)
  cloudfront_only = var.app_cloudfront
  origin_header   = var.app_cloudfront ? module.app_front[0].origin_header : null
  desired_count   = 2
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
  }, local.sentry_environment, local.support_environment, local.sensitive_environment, local.public_site_environment, local.client_ip_environment, local.sso_environment, local.files_environment)
  secrets = merge({
    DATABASE_URL   = module.aurora.database_url_secret_arn
    SESSION_SECRET = aws_secretsmanager_secret.session.arn
  }, local.sensitive_secrets)
  migration_environment = merge(local.files_environment, {
    PGHOST     = module.aurora.endpoint
    PGDATABASE = module.aurora.database_name
    PGUSER     = "app_owner"
    PGSSLMODE  = "verify-full"
    # 運営のコマンド sso-connect・sso-disconnect が Cognito に IdP を作る・消す(sso_enabled のときだけ権限がある)
    COGNITO_REGION       = var.region
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.this.id
    COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
  })
  migration_secrets = {
    PGPASSWORD = "${module.aurora.master_user_secret_arn}:password::"
  }
  secrets_kms_key_arns = [aws_kms_key.app.arn, module.aurora.kms_key_arn]
  # 運営のコマンド sso-connect が、このユーザープールの IdP とアプリクライアントだけを触る
  sso_user_pool_arn = var.sso_enabled ? aws_cognito_user_pool.this.arn : null
  # 申し込みの置き場(create-tenant が読むだけ)
  applications_store = {
    bucket      = module.applications.bucket
    bucket_arn  = module.applications.bucket_arn
    kms_key_arn = module.applications.kms_key_arn
  }
}

# 写真・ファイルの置き場(非公開の S3。docs/specs/0072-file-storage.md・ADR 0079)。API と移行のタスクは
# 役割 files-access を組織ごとに絞って引き受ける。消した物の前の版は30日で消える(設計書 0072 の U-3。導入時に決める)
module "files" {
  source            = "../../modules/file-storage"
  providers         = { aws = aws.api }
  name              = local.name
  assumer_role_arns = [module.app.task_role_arn, module.app.migrate_task_role_arn]
  allowed_origins   = ["https://${var.app_domain}"]
}

# 申し込みの置き場(非公開の S3)。開通のとき、開発が申込書の JSON を applications/<申込番号>.json に置き、
# create-tenant がキーだけを受けて読む(管理者の名前・メールを CloudTrail に残さない)。読み終えたら人が消す。
# 消し忘れても今の版は7日・古い版は1日で消える。docs/runbooks/tenant-provisioning.md・docs/designs/0026-tenant-provisioning.md
module "applications" {
  source                 = "../../modules/record-store"
  providers              = { aws = aws.api }
  name                   = "${local.name}-applications"
  archive_after_days     = null
  expire_days            = 7
  noncurrent_expire_days = 1
}

# 画面(SSR)。ALB・クラスターは module.app と共有。/api/* 以外がここに来る
module "web" {
  source                        = "../../modules/web-service"
  providers                     = { aws = aws.web }
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
  cloudfront_only               = var.app_cloudfront
  origin_header                 = var.app_cloudfront ? module.app_front[0].origin_header : null
  alb_security_group_id         = module.app.alb_security_group_id
  alb_arn_suffix                = module.app.alb_arn_suffix
  api_security_group_id         = module.app.service_security_group_id
  service_connect_namespace_arn = module.app.service_connect_namespace_arn
  # 画面のサーバーとブラウザの失敗も同じ Sentry へ(DSN は秘密ではない。ブラウザに渡る)
  environment = merge({
    APP_ENV = local.env
    # 写真・ファイルの置き場(署名つき URL で PUT・写真を表示。CSP の connect-src・img-src に足す。docs/specs/0072-file-storage.md)
    FILES_ORIGIN = module.files.origin
  }, local.sentry_environment, local.client_ip_environment)
}

resource "aws_acm_certificate" "app" {
  domain_name       = var.app_domain
  validation_method = "DNS"
  # CloudFront は origin.<app_domain> で ALB に向かうので、ALB の証明書にも入れる
  subject_alternative_names = var.app_cloudfront ? [local.origin_domain] : []
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

# app_domain は CloudFront か ALB へ。向き先だけを変える(レコードを作り直さない。切り替えの間に名前が消えない)
resource "aws_route53_record" "app" {
  zone_id = var.route53_zone_id
  name    = var.app_domain
  type    = "A"
  alias {
    name                   = var.app_cloudfront ? module.app_front[0].distribution_domain_name : module.app.alb_dns_name
    zone_id                = var.app_cloudfront ? module.app_front[0].distribution_hosted_zone_id : module.app.alb_zone_id
    evaluate_target_health = !var.app_cloudfront
  }
}

resource "aws_route53_record" "app_ipv6" {
  count   = var.app_cloudfront ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.app_domain
  type    = "AAAA"
  alias {
    name                   = module.app_front[0].distribution_domain_name
    zone_id                = module.app_front[0].distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# CloudFront が ALB に向かう名前(公開の DNS に出るが、ALB は CloudFront の送り元と秘密のヘッダーでしか通さない)
resource "aws_route53_record" "origin" {
  count   = var.app_cloudfront ? 1 : 0
  zone_id = var.route53_zone_id
  name    = local.origin_domain
  type    = "A"
  alias {
    name                   = module.app.alb_dns_name
    zone_id                = module.app.alb_zone_id
    evaluate_target_health = true
  }
}

# アプリの前の CloudFront(docs/specs/0058-cloudfront-in-front-of-app.md・ADR 0070)。WAF は CloudFront の前(waf_front)
module "app_front" {
  count  = var.app_cloudfront ? 1 : 0
  source = "../../modules/app-front"
  providers = {
    aws           = aws.api
    aws.us_east_1 = aws.us_east_1
  }
  name            = local.name
  domain          = var.app_domain
  origin_domain   = local.origin_domain
  route53_zone_id = var.route53_zone_id
  web_acl_arn     = module.waf_front[0].web_acl_arn
  kms_key_arn     = aws_kms_key.app.arn
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

# CloudFront を前に置かない形(app_cloudfront = false)だけ、WAF は ALB に付ける
module "waf" {
  count   = var.app_cloudfront ? 0 : 1
  source  = "../../modules/waf"
  name    = local.name
  alb_arn = module.app.alb_arn
  # 入れたばかりは数えるだけ。誤検知が無いのを確かめてから block に
  mode = "count"
  # 止めた数(数えるだけの間は止めるはずだった数)が多いと鳴らす(docs/runbooks/attack.md)
  alarm_topic_arn = module.alerts.topic_arn
}

moved {
  from = module.waf
  to   = module.waf[0]
}

# CloudFront を前に置く形では、WAF は CloudFront に付ける(us-east-1。IP ごとの上限を本当の相手の IP で数える)。
# アラームも us-east-1 に置くので、通知は外形監視(uptime)の us-east-1 の topic へ。この topic は alerts の extra_topic_arns で
# 東京の topic と同じ Slack(Chatbot)にも流れる(メールも)
module "waf_front" {
  count     = var.app_cloudfront ? 1 : 0
  source    = "../../modules/waf"
  providers = { aws = aws.us_east_1 }
  name      = "${local.name}-front"
  scope     = "CLOUDFRONT"
  # 入れたばかりは数えるだけ。誤検知が無いのを確かめてから block に
  mode            = "count"
  alarm_topic_arn = module.uptime.topic_arn
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
  # governance: 外す権限(s3:BypassGovernanceRetention)はバケットの方針で全員に拒否。消す・方針を変えると鳴る。
  # 誰にも消せなくするなら "compliance"(取り消せない。docs/runbooks/audit-trail.md の 2・設計書 0017 の U-2)
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
  providers      = { aws = aws.db }
  name           = local.name
  db_cluster_arn = module.aurora.cluster_arn
  topic_arn      = module.alerts.topic_arn
  # ⚠️ compliance: apply から3日を過ぎると、ロックも保存の期間も誰にも変えられない(root でも)。
  #    3日のうちに、保管庫・保存の期間・毎月の分が1年、を確かめる(docs/runbooks/db-restore.md の 6)
  lock_mode = "compliance"
}

# ── 証跡の置き場(消せない S3。evidence.yml が毎月足す)。docs/compliance/README.md・ADR 0032 ──────────
#   CloudTrail の置き場とは別。中身は GitHub と AWS の設定の写しと、訓練・点検の記録(データは入れない)

module "evidence" {
  source = "../../modules/record-store"
  name   = "${local.name}-evidence"
  lock   = { mode = var.evidence_lock_mode, years = var.evidence_retention_years }
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

# 費用のページの置き場(非公開の S3。cost.yml が毎日上書きする。古い版は400日で消える)。ADR 0032
module "cost_reports" {
  source = "../../modules/record-store"
  name   = "${local.name}-cost"
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
  indexable = true
}
