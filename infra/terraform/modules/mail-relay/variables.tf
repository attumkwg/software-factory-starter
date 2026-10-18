variable "name" {
  description = "サービス名(例: sfs-stg-mail)"
  type        = string
}

variable "image" {
  description = "最初のイメージ(docker/postfix)。以後は deploy-mail-relay.yml が更新する"
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  description = "Postfix が受け取ってよい送り手の範囲(mynetworks)"
  type        = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "api_security_group_id" {
  description = "メールを渡してくる API のセキュリティグループ"
  type        = string
}

variable "service_connect_namespace_arn" {
  type = string
}

variable "sender_domains" {
  description = "送り元として許すドメイン(SES で確かめたもの)"
  type        = list(string)
}

variable "smtp_credentials_secret_arn" {
  description = "SES の SMTP の資格情報(JSON: username・password。modules/ses-domain)"
  type        = string
}

variable "secrets_kms_key_arns" {
  description = "秘密を暗号化している KMS の鍵"
  type        = list(string)
}

variable "log_retention_days" {
  type    = number
  default = 30
}
