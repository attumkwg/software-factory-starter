variable "name" {
  description = "トレイルの名前(バケット・ロググループ・鍵の名前の頭にもなる)"
  type        = string
}

variable "lock_mode" {
  description = "S3 の Object Lock。governance(外せる。stg)か compliance(誰も外せない。期限まで消せない。prod)"
  type        = string
  default     = "governance"
  validation {
    condition     = contains(["governance", "compliance"], var.lock_mode)
    error_message = "governance か compliance にしてください"
  }
}

variable "retention_days" {
  description = "S3 に残す日数(この間は誰も消せない)。過ぎたら消す"
  type        = number
  default     = 400
  validation {
    condition     = var.retention_days >= 1
    error_message = "1日以上にしてください"
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs に残す日数(アラームと調べ物の分。長く残すのは S3)"
  type        = number
  default     = 90
}

variable "alarm_topic_arn" {
  description = "root の利用・記録を止めた、の知らせ先(modules/alerts の SNS)。無ければ鳴らさない"
  type        = string
  default     = null
}

variable "organization_id" {
  description = "組織のトレイルにするときの Organizations の ID(o-…)。管理アカウントで使うときだけ。null ならこのアカウントだけ"
  type        = string
  default     = null
}
