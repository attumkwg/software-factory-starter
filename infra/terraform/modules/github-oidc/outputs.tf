output "role_arns" {
  description = "GitHub の変数(AWS_*_ROLE_ARN)に入れる値"
  value       = { for k, r in aws_iam_role.this : k => r.arn }
}
