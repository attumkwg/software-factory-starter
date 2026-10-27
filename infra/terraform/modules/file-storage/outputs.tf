output "bucket" {
  value = aws_s3_bucket.this.id
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "kms_key_arn" {
  value = aws_kms_key.this.arn
}

output "access_role_arn" {
  description = "API の FILES_ACCESS_ROLE_ARN"
  value       = aws_iam_role.access.arn
}
