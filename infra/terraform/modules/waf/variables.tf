variable "name" {
  type = string
}

variable "alb_arn" {
  description = "WAF を付ける ALB"
  type        = string
}

variable "mode" {
  description = "block: 止める / count: 数えるだけ(入れたばかりで誤検知を見るとき)"
  type        = string
  default     = "count"
  validation {
    condition     = contains(["block", "count"], var.mode)
    error_message = "block か count"
  }
}

variable "rate_limit" {
  description = "1つの IP から5分に何回まで"
  type        = number
  default     = 2000
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "logs_kms_key_arn" {
  description = "ログを暗号化する KMS の鍵(無ければ AWS の既定の暗号化)"
  type        = string
  default     = null
}

variable "alarm_topic_arn" {
  description = "WAF が止めた数のアラームを送る SNS(alerts の topic)。null ならアラームを作らない"
  type        = string
  default     = null
}

variable "alarm_threshold" {
  description = "5分に何回止めたら(数えるだけの間は、止めるはずだったら)鳴らすか。最初の目安。鳴りすぎたら上げる"
  type        = number
  default     = 100
}
