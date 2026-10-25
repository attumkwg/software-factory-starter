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

output "ecs_mail_service" {
  value = module.mail.service_name
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

output "evidence_bucket" {
  description = "証跡の置き場(リポジトリの変数 EVIDENCE_BUCKET に入れる)"
  value       = module.evidence.bucket
}
