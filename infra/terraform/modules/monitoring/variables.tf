variable "name" {
  type = string
}

variable "topic_arn" {
  description = "鳴ったとき・戻ったときの通知先(modules/alerts の SNS)"
  type        = string
}

variable "cluster_name" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "services" {
  description = "見張る ECS のサービス。キーは知らせに出る名前(api / web / mail)。min_running を下回ったら鳴る"
  type = map(object({
    service_name = string
    min_running  = number
  }))
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_groups" {
  description = "ALB の後ろのサービスごとのターゲットグループ(arn_suffix。blue と green)"
  type        = map(list(string))
}

variable "db_cluster_identifier" {
  type = string
}

variable "ses_enabled" {
  description = "SES でメールを送っているか(評判のアラームを作る)"
  type        = bool
  default     = true
}

variable "task_stops_threshold" {
  description = "15分にこの回数タスクが落ちたら鳴らす"
  type        = number
  default     = 3
}

variable "response_time_p95_seconds" {
  description = "応答の p95 がこれを超え続けたら鳴らす(秒)"
  type        = number
  default     = 2
}

variable "certificate_arn" {
  description = "画面と API の証明書(ACM)。期限が近づいたら鳴らす"
  type        = string
}

variable "db_connections_threshold" {
  description = "DB の接続がこの数を超えたら鳴らす(max_connections の6割ほど)。null なら作らない"
  type        = number
  default     = null
}
