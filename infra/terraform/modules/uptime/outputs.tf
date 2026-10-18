output "topic_arn" {
  description = "外形監視の通知先(バージニアの SNS)。modules/alerts の extra_topic_arns に渡して Slack へ"
  value       = aws_sns_topic.this.arn
}
