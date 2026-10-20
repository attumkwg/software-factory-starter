variable "name" {
  description = "サービス名(タスク定義・ターゲットグループ・ロググループの名前にも使う。例: sfs-stg-web)"
  type        = string
}

variable "image" {
  description = "最初のイメージ。以後は deploy.yml が更新する"
  type        = string
}

variable "container_port" {
  type    = number
  default = 3001
}

variable "api_port" {
  description = "API のポート(Service Connect の http://api:<これ>)"
  type        = number
  default     = 3000
}

variable "cpu" {
  description = "SSR は DB を持たず軽い。重くなったら上げる"
  type        = number
  default     = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "environment" {
  description = "秘密ではない環境変数(PORT と API_INTERNAL_URL はこのモジュールが入れる)"
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "bake_time_minutes" {
  description = "green に切り替えてから、アラームを見て待つ時間"
  type        = number
  default     = 5
}

variable "alarm_5xx_threshold" {
  type    = number
  default = 10
}

variable "alarm_topic_arns" {
  description = "アラームの通知先(SNS → Slack など)"
  type        = list(string)
  default     = []
}

variable "listener_rule_priority" {
  description = "共有 ALB のルールの優先度。API の /api/*(10)より大きく"
  type        = number
  default     = 20
}

# ── API のモジュール(modules/ecs-service)と共有するもの ──

variable "cluster_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "listener_arn" {
  description = "共有 ALB の HTTPS のリスナー"
  type        = string
}

variable "alb_security_group_id" {
  type = string
}

variable "alb_arn_suffix" {
  type = string
}

variable "api_security_group_id" {
  description = "API のタスクのセキュリティグループ(SSR から入れるように穴を開ける)"
  type        = string
}

variable "service_connect_namespace_arn" {
  type = string
}

variable "autoscaling" {
  description = <<-EOT
    台数の自動調整(CPU の平均を目標に保つ)。null なら desired_count で固定。
    max は DB の接続の上限と合わせて決める(API は1台あたりプール10本。blue/green の入れ替えの間は2倍になる)
  EOT
  type = object({
    min_count          = number
    max_count          = number
    cpu_target_percent = optional(number, 60)
  })
  default = null
  validation {
    condition     = var.autoscaling == null || (var.autoscaling.min_count >= 1 && var.autoscaling.max_count >= var.autoscaling.min_count)
    error_message = "autoscaling は 1 <= min_count <= max_count にする"
  }
}
