variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "pr_number" {
  type = number
}

variable "image" {
  description = "この PR の API のイメージ(<ECR>:pr-<番号>-<sha>)"
  type        = string
}

variable "web_image" {
  description = "この PR の画面のイメージ(<ECR>:pr-<番号>-<sha>)"
  type        = string
}

variable "domain" {
  type = string
}
