# 知らせの通り道(環境ごとに1つ)。アラーム・費用・セキュリティの見つけ物は、全部ここの SNS に集める。
#
#   CloudWatch のアラーム・EventBridge(Security Hub)・RDS のイベント・AWS Budgets(費用)・Cost Anomaly Detection(費用の急な変化)
#     → SNS(KMS で暗号化)→ Slack(Amazon Q Developer in chat applications。旧 AWS Chatbot)
#                          → メール(任意)
#
# Slack へは、AWS の公式の連携を使う(コードを持たない・無料)。
#   最初に1回だけ、人が AWS のコンソールで Slack のワークスペースを許可する(README「本人が手でやる設定」)。
#   その後に分かる slack_team_id / slack_channel_id を tfvars に入れると、ここでつながる。
#   設定の API は東京に無い(オハイオ・オレゴン・アイルランド・シンガポールだけ)ので、chat_region で場所を指定する。
#   Slack から AWS を操作はさせない(読むだけの権限+ガードレール)。
#
# 月の費用: SNS と Slack 連携はほぼ0円。Budgets は アカウントで2つまで無料。

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # SNS に書いてよい AWS のサービス(すべてこのアカウントの物に限る)
  publishers = [
    "cloudwatch.amazonaws.com",
    "events.amazonaws.com",
    "budgets.amazonaws.com",
    "costalerts.amazonaws.com", # 費用の急な変化(Cost Anomaly Detection。modules/cost-watch)
    "events.rds.amazonaws.com",
  ]
  slack_enabled = var.slack_team_id != null && var.slack_channel_id != null
}

# ── SNS(暗号化つき) ──────────────────────────────────────────────────────────

# AWS の既定の鍵(alias/aws/sns)では CloudWatch や Budgets が書けないので、自前の鍵にする
resource "aws_kms_key" "this" {
  description         = "${var.name} alerts"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Account"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "Publishers"
        Effect    = "Allow"
        Principal = { Service = local.publishers }
        Action    = ["kms:GenerateDataKey*", "kms:Decrypt"]
        Resource  = "*"
      }
    ]
  })
}

resource "aws_sns_topic" "this" {
  name              = "${var.name}-alerts"
  kms_master_key_id = aws_kms_key.this.arn
}

resource "aws_sns_topic_policy" "this" {
  arn = aws_sns_topic.this.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountOwner"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = ["sns:Publish", "sns:Subscribe", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:ListSubscriptionsByTopic"]
        Resource  = aws_sns_topic.this.arn
      },
      {
        Sid       = "AwsServicesInThisAccount"
        Effect    = "Allow"
        Principal = { Service = local.publishers }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.this.arn
        Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
      }
    ]
  })
}

# メールでも受ける(任意)。作ったあと、届いた確認のメールのリンクを人が押すまで届かない
resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.email_addresses)
  topic_arn = aws_sns_topic.this.arn
  protocol  = "email"
  endpoint  = each.value
}

# ── Slack ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "chatbot_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["chatbot.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "chatbot" {
  count              = local.slack_enabled ? 1 : 0
  name               = "${var.name}-chatbot"
  assume_role_policy = data.aws_iam_policy_document.chatbot_assume.json
}

# 知らせにグラフを付けるのに要る分だけ(読むだけ)
resource "aws_iam_role_policy_attachment" "chatbot" {
  count      = local.slack_enabled ? 1 : 0
  role       = aws_iam_role.chatbot[0].name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess"
}

resource "aws_chatbot_slack_channel_configuration" "this" {
  count              = local.slack_enabled ? 1 : 0
  region             = var.chat_region
  configuration_name = "${var.name}-alerts"
  iam_role_arn       = aws_iam_role.chatbot[0].arn
  slack_team_id      = var.slack_team_id
  slack_channel_id   = var.slack_channel_id
  sns_topic_arns     = concat([aws_sns_topic.this.arn], var.extra_topic_arns)
  logging_level      = "ERROR"
  # Slack から打てる操作の上限。指定しないと AdministratorAccess になるので、必ず絞る
  guardrail_policy_arns = ["arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess"]
}

# ── 費用(AWS Budgets) ────────────────────────────────────────────────────────

# 月の上限に対して「使った額が 80%」と「月末の見込みが 100%」で知らせる。
# 金額はドル(請求の通貨)。AWS 全体の費用で、税は含まない。
resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_usd == null ? 0 : 1
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_sns_topic_arns  = [aws_sns_topic.this.arn]
    subscriber_email_addresses = var.email_addresses
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_sns_topic_arns  = [aws_sns_topic.this.arn]
    subscriber_email_addresses = var.email_addresses
  }

  depends_on = [aws_sns_topic_policy.this]
}
