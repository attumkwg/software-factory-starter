variable "project" {
  description = "名前の頭"
  type        = string
  default     = "sfs"
}

variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "github_repository" {
  description = "owner/repo"
  type        = string
  default     = "attumkwg/software-factory-starter"
}

variable "create_oidc_provider" {
  description = "このアカウントに GitHub の OIDC プロバイダーがまだ無ければ true"
  type        = bool
  default     = true
}

variable "state_bucket" {
  description = "Terraform の状態を置く S3 バケット(backend.tf と同じ)"
  type        = string
}

variable "app_domain" {
  description = "画面と API のドメイン(例: app.example.com)"
  type        = string
}

variable "route53_zone_id" {
  description = "app_domain が入る Route 53 のゾーン"
  type        = string
}

variable "image_repository_url" {
  description = "stg の ECR(同じイメージを引く。stg の image_pull_account_ids にこのアカウントを入れる)"
  type        = string
}

variable "web_image_repository_url" {
  description = "stg の画面の ECR(stg の出力 web_ecr_repository_url)"
  type        = string
}

variable "initial_image_tag" {
  description = "最初に作るときのイメージのタグ(以後は deploy.yml が更新)"
  type        = string
  default     = "bootstrap"
}

variable "alarm_topic_arns" {
  description = "アラームの通知先(SNS)"
  type        = list(string)
  default     = []
}
