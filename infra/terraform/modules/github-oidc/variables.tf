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
    # ReadOnlyAccess を付ける役割(plan)に。設定の読み取りは残し、中身(データ)の読み取りだけを明示で拒む。
    # except_s3_objects は読んでよい S3 の物(Terraform の状態)
    deny_data_reads = optional(object({
      except_s3_objects = list(string)
    }))
  }))
}
