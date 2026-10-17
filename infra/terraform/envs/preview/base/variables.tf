variable "project" {
  type    = string
  default = "sfs"
}

variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "github_repository" {
  type    = string
  default = "attumkwg/software-factory-starter"
}

variable "create_oidc_provider" {
  type    = bool
  default = true
}

variable "state_bucket" {
  type = string
}

variable "domain" {
  description = "pr-<番号>.preview.<domain> の <domain>(例: example.com)"
  type        = string
}

variable "route53_zone_id" {
  type = string
}

variable "allowed_cidrs" {
  description = "プレビューを見てよい出口の IP(会社・VPN)。GitHub の実行環境から E2E と ZAP を流すなら、その範囲も"
  type        = list(string)
}
