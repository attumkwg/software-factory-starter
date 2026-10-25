variable "name" {
  description = "サービス名(クラスター・ALB・ロググループの名前にも使う)"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "image" {
  description = "最初のイメージ。以後は deploy.yml が更新する"
  type        = string
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "certificate_arn" {
  description = "ALB の HTTPS の証明書(ACM)"
  type        = string
}

variable "environment" {
  description = "秘密ではない環境変数"
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "環境変数名 → Secrets Manager の ARN(JSON のキーを指すなら arn:...:キー::)"
  type        = map(string)
  default     = {}
}

variable "migration_environment" {
  description = "移行タスクの環境変数(PGHOST など)"
  type        = map(string)
  default     = {}
}

variable "migration_secrets" {
  description = "移行タスクの秘密(PGPASSWORD など)"
  type        = map(string)
  default     = {}
}

variable "applications_store" {
  description = "申し込みの置き場(運営のコマンド create-tenant が読む S3。docs/designs/0026-tenant-provisioning.md)。null なら移行のタスクに何も許さない"
  type = object({
    bucket      = string
    bucket_arn  = string
    kms_key_arn = string
  })
  default = null
}

variable "secrets_kms_key_arns" {
  description = "秘密を暗号化している KMS の鍵"
  type        = list(string)
  default     = []
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

variable "deletion_protection" {
  type    = bool
  default = true
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

variable "cloudfront_only" {
  description = "ALB を CloudFront からだけ受ける(送り元の一覧・443 だけ・秘密のヘッダー)。docs/specs/0058-cloudfront-in-front-of-app.md"
  type        = bool
  default     = false
}

variable "origin_header" {
  description = "cloudfront_only のとき、ALB のルールが確かめるヘッダー(名前と、通す値。app-front の origin_header)"
  type = object({
    name   = string
    values = list(string)
  })
  default   = null
  sensitive = true
}
