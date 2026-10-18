output "topic_arn" {
  description = "アラームなどの通知先(SNS)"
  value       = aws_sns_topic.this.arn
}
