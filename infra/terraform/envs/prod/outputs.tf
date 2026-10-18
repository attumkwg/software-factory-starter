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
