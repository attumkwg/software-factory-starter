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


output "mail_ecr_repository_url" {
  description = "GitHub の変数 MAIL_ECR_REPOSITORY_URL に(メールの中継)"
  value       = aws_ecr_repository.this["mail"].repository_url
}

output "ecs_mail_service" {
  value = module.mail.service_name
}

output "cognito_user_pool_id" {
  description = "GitHub の変数 COGNITO_USER_POOL_ID に(契約テスト cognito-contract.yml)"
  value       = aws_cognito_user_pool.this.id
}

output "cognito_oauth_url" {
  description = "SSO の入口(sso_enabled のときだけ。API の COGNITO_OAUTH_URL。お客さんの IdP に渡す ACS の URL は <これ>/saml2/idpresponse)"
  value       = var.sso_enabled ? "https://${local.sso_domain}" : null
}

output "cognito_client_id" {
  description = "GitHub の変数 COGNITO_CLIENT_ID に(契約テスト・ZAP のスキャン)"
  value       = aws_cognito_user_pool_client.web.id
}

output "db_cluster_identifier" {
  description = "Aurora のクラスター(戻すとき・戻す訓練で使う)"
  value       = module.aurora.cluster_identifier
}

output "backup_vault_name" {
  value = module.backup.vault_name
}

output "audit_trail_arn" {
  value = module.audit_trail.trail_arn
}

output "audit_trail_bucket" {
  description = "管理操作の記録の置き場(ロックした S3)"
  value       = module.audit_trail.bucket_name
}

output "audit_trail_log_group_name" {
  description = "管理操作の記録を流すロググループ(ほかのアラームのメトリクスフィルターはここに)"
  value       = module.audit_trail.log_group_name
}

output "audit_trail_log_group_arn" {
  value = module.audit_trail.log_group_arn
}

output "applications_bucket" {
  description = "申し込みの置き場(create-tenant が読む。applications/<申込番号>.json に置き、読み終えたら消す。docs/runbooks/tenant-provisioning.md)"
  value       = module.applications.bucket
}

output "public_site" {
  description = "公開の LP の置き場所(GitHub の変数 STG_SITE_BUCKET・STG_SITE_DISTRIBUTION_ID・STG_SITE_URL に)。public_site_domain が無ければ null"
  value = var.public_site_domain == null ? null : {
    bucket          = module.public_site[0].bucket
    distribution_id = module.public_site[0].distribution_id
    url             = module.public_site[0].url
  }
}
