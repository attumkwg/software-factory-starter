variable "name" {
  type = string
}

variable "task_role_arn" {
  description = "鍵を使ってよい、ただ1つの役割(API のタスクの役割。移行のタスクの役割は渡さない)"
  type        = string
}

variable "db_endpoint" {
  description = "Aurora の書き込みの入口(要配慮の接続文字列に入れる。段2で別のクラスターにしたら、その入口)"
  type        = string
}

variable "database_name" {
  type = string
}

variable "secrets_kms_key_arn" {
  description = "接続文字列の秘密を暗号化する鍵(Aurora の鍵。ECS の実行の役割が読める鍵)"
  type        = string
}

variable "cloudtrail_log_group_name" {
  description = <<-EOT
    CloudTrail を受けている CloudWatch Logs のロググループ(同じアカウント・同じ地域)。無ければ見張りを作らない。
    KMS の操作(管理のイベントの Read を含む)を記録しているトレイルであること(kms.amazonaws.com を除外していない)。
  EOT
  type        = string
  default     = null
}

variable "alarm_topic_arn" {
  description = "鳴らす先(modules/alerts の SNS)"
  type        = string
  default     = null
}

variable "decrypt_alarm_threshold" {
  description = "API のタスクが5分にデータ鍵を開いてよい回数の上限(ふつうは 組織の数 × タスクの数 まで)"
  type        = number
  default     = 500
}
