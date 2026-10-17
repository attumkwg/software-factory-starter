variable "pr_number" {
  description = "PR の番号(ALB のルールの優先度にも使う)"
  type        = number
  validation {
    condition     = var.pr_number >= 1 && var.pr_number <= 50000
    error_message = "ALB のルールの優先度に使うので 1〜50000"
  }
}

variable "domain" {
  description = "pr-<番号>.preview.<domain> の <domain>"
  type        = string
}

variable "image" {
  description = "この PR のイメージ(ECR)"
  type        = string
}

variable "postgres_image" {
  type    = string
  default = "public.ecr.aws/docker/library/postgres:17-alpine"
}

# ── 共有の土台(envs/preview/base が作る)──
variable "cluster_arn" {
  type = string
}

variable "listener_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "service_security_group_id" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "log_group_name" {
  type = string
}

variable "secrets_kms_key_arn" {
  type = string
}
