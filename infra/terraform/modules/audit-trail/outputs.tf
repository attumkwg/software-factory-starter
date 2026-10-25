output "trail_arn" {
  value = aws_cloudtrail.this.arn
}

output "bucket_name" {
  description = "記録の置き場(消せない S3)"
  value       = aws_s3_bucket.this.id
}

output "log_group_name" {
  description = "記録を流すロググループ。ほかのアラーム(例: 要配慮の鍵の利用)はここにメトリクスフィルターを置く"
  value       = aws_cloudwatch_log_group.this.name
}

output "log_group_arn" {
  value = aws_cloudwatch_log_group.this.arn
}

output "kms_key_arn" {
  description = "記録とロググループを暗号化する鍵"
  value       = aws_kms_key.this.arn
}
