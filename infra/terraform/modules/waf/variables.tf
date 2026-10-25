variable "name" {
  type = string
}

variable "scope" {
  description = "REGIONAL: ALB に付ける / CLOUDFRONT: CloudFront に付ける(us-east-1 の provider で呼び、arn を app-front の web_acl_arn に)"
  type        = string
  default     = "REGIONAL"
  validation {
    condition     = contains(["REGIONAL", "CLOUDFRONT"], var.scope)
    error_message = "REGIONAL か CLOUDFRONT"
  }
}

variable "alb_arn" {
  description = "WAF を付ける ALB(scope = REGIONAL のとき)"
  type        = string
  default     = null
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

variable "public_rate_limit" {
  description = "公開の LP の入口(/api/public/*)に、1つの IP から5分に何回まで(WAF の下限は 10)"
  type        = number
  default     = 100
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
