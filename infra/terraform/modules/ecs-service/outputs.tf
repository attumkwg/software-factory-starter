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

output "alb_arn" {
  description = "WAF を付ける先"
  value       = aws_lb.this.arn
}
