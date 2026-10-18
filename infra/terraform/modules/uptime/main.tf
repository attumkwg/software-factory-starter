# 外形監視(外から見て開けるか)。AWS の中のアラーム(modules/monitoring)では分からない
# 「中は元気でも、利用者からは開けない」(DNS・証明書・ALB より手前・WAF の誤ブロック)を見る。
#
#   Route 53 のヘルスチェック(東京・シンガポール・オレゴンから30秒ごと)
#     → 数字はバージニア(us-east-1)にしか出ない(Route 53 の決まり)
#     → アラームと SNS もバージニアに置く → Slack(modules/alerts の連携に、この SNS も足す)
#
# 見るのは2つ(既定):
#   web … 画面のサーバー(/readyz。ALB → 画面)
#   api … API(/api/auth/options。DB を使わない公開の API。ALB の /api/* → API)
# DB が止まっているかは中のアラームで見る(外形監視は「届くか」だけ)。
# HTTPS の確認は証明書の中身までは見ない → 期限は modules/monitoring の cert-expiry で見る。
#
# 月の費用: ヘルスチェック1つ 約0.5ドル+HTTPS 約1ドル → 2つで 約3ドル(約450円)+アラーム 約30円。

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

resource "aws_route53_health_check" "this" {
  for_each          = var.checks
  fqdn              = var.domain
  port              = 443
  type              = "HTTPS"
  resource_path     = each.value
  request_interval  = 30
  failure_threshold = 3
  # 最低3か所。利用者に近い所から
  regions = ["ap-northeast-1", "ap-southeast-1", "us-west-2"]
  tags = {
    Name = "${var.name}-${each.key}"
  }
}

# ── バージニアの通知先(Route 53 の数字はここにしか出ない) ──────────────────────────

resource "aws_kms_key" "this" {
  provider            = aws.us_east_1
  description         = "${var.name} uptime alerts"
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
        Sid       = "CloudWatch"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = ["kms:GenerateDataKey*", "kms:Decrypt"]
        Resource  = "*"
      }
    ]
  })
}

resource "aws_sns_topic" "this" {
  provider          = aws.us_east_1
  name              = "${var.name}-uptime-alerts"
  kms_master_key_id = aws_kms_key.this.arn
}

resource "aws_sns_topic_policy" "this" {
  provider = aws.us_east_1
  arn      = aws_sns_topic.this.arn
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
        Sid       = "CloudWatchInThisAccount"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.this.arn
        Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "email" {
  provider  = aws.us_east_1
  for_each  = toset(var.email_addresses)
  topic_arn = aws_sns_topic.this.arn
  protocol  = "email"
  endpoint  = each.value
}

# ── アラーム ──────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "this" {
  provider            = aws.us_east_1
  for_each            = var.checks
  alarm_name          = "${var.name}-uptime-${each.key}"
  alarm_description   = "外から https://${var.domain}${each.value} が開けない(ほとんどの地点から、2分続けて)。docs/runbooks/alarms.md#uptime"
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.this[each.key].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  # 数字が来ない = 見られていない。鳴らして気づく
  treat_missing_data = "breaching"
  alarm_actions      = [aws_sns_topic.this.arn]
  ok_actions         = [aws_sns_topic.this.arn]
}
