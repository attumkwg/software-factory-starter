output "anomaly_monitor_arn" {
  value = try(aws_ce_anomaly_monitor.this[0].arn, null)
}
