# AWS アカウントの見張り(アカウントごとに1回)。
#   GuardDuty    … 怪しい動き(漏れた鍵の利用・不審な通信・暗号通貨の採掘など)を見つける
#   Security Hub … 設定の点検(公開のバケット・暗号化していない DB など)を、AWS の決まりの一覧で採点する
# 見つけたものは Security Hub に集まる。通知(SNS → Slack など)は findings_topic_arn で。
#
# 月の費用の目安(2026-10 時点の定価から。量で大きく変わるので、公式の料金表と無料の試用期間の実績で確かめること):
#   GuardDuty    … 小さなアカウントで 月 数百〜千数百円(CloudTrail のイベント数・VPC フローログ・DNS の量に比例)
#   Security Hub … 点検の回数に比例。小さなアカウントで 月 数百〜千数百円
# どちらも最初の 30日は無料の試用で、実際の量からの見積もりがコンソールに出る。

data "aws_region" "current" {}

resource "aws_guardduty_detector" "this" {
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"
}

resource "aws_securityhub_account" "this" {
  enable_default_standards = false
  auto_enable_controls     = true
}

# AWS の基本の決まり(AWS Foundational Security Best Practices)で採点する
resource "aws_securityhub_standards_subscription" "fsbp" {
  standards_arn = "arn:aws:securityhub:${data.aws_region.current.region}::standards/aws-foundational-security-best-practices/v/1.0.0"
  depends_on    = [aws_securityhub_account.this]
}

# 重いもの(HIGH 以上)だけを通知する
resource "aws_cloudwatch_event_rule" "findings" {
  count       = var.findings_topic_arn == null ? 0 : 1
  name        = "${var.name}-security-findings"
  description = "Security Hub findings (HIGH / CRITICAL)"
  event_pattern = jsonencode({
    source      = ["aws.securityhub"]
    detail-type = ["Security Hub Findings - Imported"]
    detail = {
      findings = {
        Severity = { Label = ["HIGH", "CRITICAL"] }
        Workflow = { Status = ["NEW"] }
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "findings" {
  count = var.findings_topic_arn == null ? 0 : 1
  rule  = aws_cloudwatch_event_rule.findings[0].name
  arn   = var.findings_topic_arn
}
