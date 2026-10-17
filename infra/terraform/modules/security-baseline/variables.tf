variable "name" {
  type = string
}

variable "findings_topic_arn" {
  description = "重い見つけ物の通知先(SNS)。無ければ通知しない(コンソールで見る)"
  type        = string
  default     = null
}
