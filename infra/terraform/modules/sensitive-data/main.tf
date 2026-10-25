# 要配慮個人情報の段1(ADR 0018・ADR 0029・docs/designs/0016-sensitive-data-tier1.md の 5)。
# - 専用の KMS の鍵: 組織ごとのデータ鍵を包む(エンベロープ暗号化)。使えるのは API のタスクの役割だけ・
#   「組織のデータ鍵」の文脈(purpose = tenant-data-key)を付けた呼び出しだけ。管理者も鍵の中身は使えない。
# - 要配慮だけの接続ユーザー(app_sensitive_login。ロール app_sensitive)の接続文字列。DB の中のロールは README の手順で1回だけ作る。
# - 鍵の利用の見張り: CloudTrail のロググループ(cloudtrail_log_group_name)があるときだけ。
#     ① API のタスク以外が鍵を使った(失敗も含む)        → 1回で鳴る
#     ② 鍵を消す予約・止める・ポリシーを変えた            → 1回で鳴る(消すと要配慮のデータは戻せない)
#     ③ API のタスクが5分に開いた数が多すぎる(大量の持ち出し)→ decrypt_alarm_threshold を超えたら鳴る
#   鳴ったときにやることは docs/runbooks/alarms.md#sensitive-key。
#
# 月の費用: 鍵 1本 約150円+呼び出し(組織ごとに数分に1回)・秘密 1つ 約60円・アラーム 3つ 約45円。

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # アプリ(store.ts の key-wrapper.ts)が付ける文脈と同じ
  key_purpose = "tenant-data-key"
  data_actions = [
    "Decrypt", "Encrypt", "GenerateDataKey", "GenerateDataKeyWithoutPlaintext", "ReEncrypt",
  ]
  admin_alarm_actions = ["ScheduleKeyDeletion", "DisableKey", "PutKeyPolicy", "CreateGrant"]
  namespace           = "${var.name}/SensitiveData"
  actions             = var.alarm_topic_arn == null ? [] : [var.alarm_topic_arn]
  watch               = var.cloudtrail_log_group_name != null
}

resource "aws_kms_key" "this" {
  description             = "${var.name} sensitive data (tenant data keys)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # 管理(鍵の設定・回す・消す予約)は IAM で許した人だけ。鍵で暗号化・復号する操作はここに入れない
      {
        Sid       = "AccountAdministersOnly"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action = [
          "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*",
          "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource",
          "kms:UntagResource", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
        ]
        Resource = "*"
      },
      # 使えるのは API のタスクの役割だけ。組織のデータ鍵の文脈(purpose と tenant_id)が付いた呼び出しだけ
      {
        Sid       = "ApiTaskUsesForTenantDataKeys"
        Effect    = "Allow"
        Principal = { AWS = var.task_role_arn }
        Action    = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource  = "*"
        Condition = {
          StringEquals = { "kms:EncryptionContext:purpose" = local.key_purpose }
          "ForAllValues:StringEquals" = {
            "kms:EncryptionContextKeys" = ["purpose", "tenant_id"]
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name}-sensitive"
  target_key_id = aws_kms_key.this.key_id
}

# 要配慮だけの接続ユーザーのパスワードと、それを入れた接続文字列(アプリの接続 database-url とは別)
resource "random_password" "this" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.name}/sensitive-database-url"
  description = "Sensitive data connection (role: app_sensitive, schema sensitive only)"
  kms_key_id  = var.secrets_kms_key_arn
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgres://app_sensitive_login:${random_password.this.result}@${var.db_endpoint}:5432/${var.database_name}?sslmode=verify-full"
}

# ── 鍵の利用の見張り(CloudTrail のロググループがあるときだけ) ─────────────────────────────

resource "aws_cloudwatch_log_metric_filter" "other_principals" {
  count          = local.watch ? 1 : 0
  name           = "${var.name}-sensitive-key-other-principals"
  log_group_name = var.cloudtrail_log_group_name
  pattern = join(" && ", [
    "{ ($.eventSource = \"kms.amazonaws.com\")",
    "($.resources[0].ARN = \"${aws_kms_key.this.arn}\")",
    "(${join(" || ", [for a in local.data_actions : "$.eventName = \"${a}\""])})",
    "($.userIdentity.sessionContext.sessionIssuer.arn != \"${var.task_role_arn}\") }",
  ])
  metric_transformation {
    name          = "KeyUsedByOthers"
    namespace     = local.namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "other_principals" {
  count               = local.watch ? 1 : 0
  alarm_name          = "${var.name}-sensitive-key-other-principals"
  alarm_description   = "要配慮の鍵を、API のタスク以外が使った(使おうとした)。docs/runbooks/alarms.md#sensitive-key"
  namespace           = local.namespace
  metric_name         = "KeyUsedByOthers"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_log_metric_filter" "admin_changes" {
  count          = local.watch ? 1 : 0
  name           = "${var.name}-sensitive-key-admin-changes"
  log_group_name = var.cloudtrail_log_group_name
  pattern = join(" && ", [
    "{ ($.eventSource = \"kms.amazonaws.com\")",
    "($.resources[0].ARN = \"${aws_kms_key.this.arn}\")",
    "(${join(" || ", [for a in local.admin_alarm_actions : "$.eventName = \"${a}\""])}) }",
  ])
  metric_transformation {
    name          = "KeyAdminChanges"
    namespace     = local.namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "admin_changes" {
  count               = local.watch ? 1 : 0
  alarm_name          = "${var.name}-sensitive-key-admin-changes"
  alarm_description   = "要配慮の鍵を消す予約・止める・ポリシーを変える操作があった(消えると要配慮のデータは戻せない)。docs/runbooks/alarms.md#sensitive-key"
  namespace           = local.namespace
  metric_name         = "KeyAdminChanges"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_log_metric_filter" "api_decrypts" {
  count          = local.watch ? 1 : 0
  name           = "${var.name}-sensitive-key-api-decrypts"
  log_group_name = var.cloudtrail_log_group_name
  pattern = join(" && ", [
    "{ ($.eventSource = \"kms.amazonaws.com\")",
    "($.resources[0].ARN = \"${aws_kms_key.this.arn}\")",
    "($.eventName = \"Decrypt\")",
    "($.userIdentity.sessionContext.sessionIssuer.arn = \"${var.task_role_arn}\") }",
  ])
  metric_transformation {
    name          = "ApiDecrypts"
    namespace     = local.namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_decrypts" {
  count               = local.watch ? 1 : 0
  alarm_name          = "${var.name}-sensitive-key-api-decrypts"
  alarm_description   = "API のタスクが5分に要配慮のデータ鍵を ${var.decrypt_alarm_threshold} 回より多く開いた(ふつうは組織ごと・タスクごとに5分に1回)。docs/runbooks/alarms.md#sensitive-key"
  namespace           = local.namespace
  metric_name         = "ApiDecrypts"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.decrypt_alarm_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}
