output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "service_security_group_id" {
  value = aws_security_group.service.id
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "task_definition_family" {
  value = aws_ecs_task_definition.app.family
}

output "migrate_task_definition_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "migrate_task_role_arn" {
  description = "移行・運営のコマンドの役割(何も許していない)"
  value       = aws_iam_role.migrate.arn
}

output "alb_arn" {
  description = "WAF を付ける先"
  value       = aws_lb.this.arn
}

# ── 画面のサービス(modules/web-service)と共有するもの ──

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "alb_arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "service_connect_namespace_arn" {
  value = aws_service_discovery_http_namespace.this.arn
}

output "target_group_arn_suffixes" {
  description = "API のターゲットグループ(blue と green。見張りで使う)"
  value       = [for tg in aws_lb_target_group.this : tg.arn_suffix]
}
