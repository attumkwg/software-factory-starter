variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "pr_number" {
  type = number
}

variable "image" {
  description = "この PR のイメージ(<ECR>:pr-<番号>-<sha>)"
  type        = string
}

variable "domain" {
  type = string
}
