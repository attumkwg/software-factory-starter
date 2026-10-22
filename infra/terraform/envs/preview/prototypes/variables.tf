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
  description = "GitHub の OIDC のプロバイダーはアカウントに1つ。envs/preview/base を先に立てたなら false"
  type        = bool
  default     = true
}
