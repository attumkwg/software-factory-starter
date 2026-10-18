output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.this.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "target_group_arn_suffixes" {
  description = "画面のターゲットグループ(blue と green。見張りで使う)"
  value       = [for tg in aws_lb_target_group.this : tg.arn_suffix]
}
