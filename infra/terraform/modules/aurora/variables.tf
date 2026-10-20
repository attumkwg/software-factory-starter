variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "非公開サブネット"
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "5432 に入ってよいセキュリティグループ(ECS のサービス)"
  type        = list(string)
  default     = []
}

variable "engine_version" {
  type    = string
  default = "17.5"
}

variable "database_name" {
  type    = string
  default = "app"
}

variable "min_acu" {
  description = "最小の容量。0 にすると使わない間止まる(stg の節約)"
  type        = number
  default     = 0.5
}

variable "max_acu" {
  type    = number
  default = 4
}

variable "instance_count" {
  description = "本番は2(書き込み+予備)"
  type        = number
  default     = 1
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "slow_query_log_ms" {
  description = "この時間(ミリ秒)より遅い SQL を DB のログに残す。-1 で残さない"
  type        = number
  default     = 1000
}

variable "log_retention_days" {
  description = "DB のログ(CloudWatch Logs)を残す日数"
  type        = number
  default     = 30
}
