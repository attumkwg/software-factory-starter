variable "name" {
  type = string
}

variable "slack_team_id" {
  description = "Slack のワークスペースの ID(T で始まる)。コンソールで Slack を許可したあとに分かる。null なら Slack にはつながない"
  type        = string
  default     = null
}

variable "slack_channel_id" {
  description = "知らせを流す Slack のチャンネルの ID(C で始まる)。非公開のチャンネルなら、先に /invite @Amazon Q で招く"
  type        = string
  default     = null
}

variable "chat_region" {
  description = "Slack 連携の設定を置く場所(東京には無い。us-east-2 / us-west-2 / eu-west-1 / ap-southeast-1)"
  type        = string
  default     = "ap-southeast-1"
}

variable "email_addresses" {
  description = "メールでも受けるなら、その宛先(任意)"
  type        = list(string)
  default     = []
}

variable "monthly_budget_usd" {
  description = "このアカウントの月の上限(ドル)。null なら費用の警報を作らない"
  type        = number
  default     = null
}

variable "extra_topic_arns" {
  description = "Slack に一緒に流す、ほかのリージョンの SNS(外形監視はバージニアにしか置けない。modules/uptime)"
  type        = list(string)
  default     = []
}
