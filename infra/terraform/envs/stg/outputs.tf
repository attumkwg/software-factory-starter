output "ecr_repository_url" {
  description = "GitHub の変数 ECR_REPOSITORY_URL に(API)"
  value       = aws_ecr_repository.this["api"].repository_url
}

output "web_ecr_repository_url" {
  description = "GitHub の変数 WEB_ECR_REPOSITORY_URL に(画面)"
  value       = aws_ecr_repository.this["web"].repository_url
}

output "ecs_cluster" {
  value = module.app.cluster_name
}

output "ecs_service" {
  value = module.app.service_name
}

output "ecs_web_service" {
  value = module.web.service_name
}

output "migrate_task_definition" {
  value = module.app.migrate_task_definition_family
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "service_security_group_id" {
  value = module.app.service_security_group_id
}

output "github_role_arns" {
  value = module.github_oidc.role_arns
}

output "url" {
  value = "https://${var.app_domain}"
}

output "cognito_scan_client_id" {
  description = "GitHub の変数 COGNITO_SCAN_CLIENT_ID に(ZAP の認証つきスキャン用)"
  value       = aws_cognito_user_pool_client.scanner.id
}
