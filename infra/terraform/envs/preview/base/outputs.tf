output "ecr_repository_url" {
  description = "GitHub の変数 PREVIEW_ECR_REPOSITORY に(API)"
  value       = aws_ecr_repository.this["api"].repository_url
}

output "web_ecr_repository_url" {
  description = "GitHub の変数 PREVIEW_WEB_ECR_REPOSITORY に(画面)"
  value       = aws_ecr_repository.this["web"].repository_url
}

output "github_role_arn" {
  description = "GitHub の変数 AWS_PREVIEW_ROLE_ARN に"
  value       = module.github_oidc.role_arns["preview-github"]
}
