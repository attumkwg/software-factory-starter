output "task_stops_log_group" {
  description = "落ちたタスクの記録(理由・終了コード)。Logs Insights で引く"
  value       = aws_cloudwatch_log_group.task_stops.name
}
