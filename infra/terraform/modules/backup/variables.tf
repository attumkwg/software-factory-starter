variable "name" {
  type = string
}

variable "db_cluster_arn" {
  description = "バックアップを取る Aurora のクラスター"
  type        = string
}

variable "topic_arn" {
  description = "失敗の知らせ先(modules/alerts の SNS)"
  type        = string
}

variable "lock_mode" {
  description = "保管庫のロック。governance(外せる。stg)か compliance(猶予のあと二度と外せない。prod)"
  type        = string
  default     = "governance"
  validation {
    condition     = contains(["governance", "compliance"], var.lock_mode)
    error_message = "governance か compliance にしてください"
  }
}

variable "compliance_grace_days" {
  description = "compliance で、ロックを外せる猶予(日)。この間に設定を確かめる。過ぎると取り消せない"
  type        = number
  default     = 3
}

variable "daily_retention_days" {
  type    = number
  default = 35
}

variable "monthly_retention_days" {
  type    = number
  default = 365
}
