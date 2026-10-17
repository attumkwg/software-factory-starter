variable "github_repository" {
  description = "owner/repo"
  type        = string
}

variable "create_provider" {
  description = "OIDC のプロバイダーは AWS アカウントに1つ。すでにあれば false"
  type        = bool
  default     = true
}

variable "roles" {
  description = "役割の名前 → 誰が(subjects)・何をしてよいか"
  type = map(object({
    description         = string
    subjects            = list(string)
    policy_json         = optional(string)
    managed_policy_arns = optional(list(string), [])
  }))
}
