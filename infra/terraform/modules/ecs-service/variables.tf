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
