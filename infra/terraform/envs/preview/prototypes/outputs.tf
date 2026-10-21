output "bucket" {
  description = "GitHub の変数 PROTOTYPES_BUCKET に"
  value       = module.site.bucket
}

output "url" {
  description = "GitHub の変数 PROTOTYPES_URL に(試作は <これ>/<賭けの ID>/)"
  value       = module.site.url
}

output "github_role_arn" {
  description = "GitHub の変数 AWS_PROTOTYPES_ROLE_ARN に"
  value       = module.github_oidc.role_arns["prototypes-github"]
}

output "passphrases_kvs_arn" {
  description = "合言葉を入れる KeyValueStore(docs/guides/prototypes.md)"
  value       = module.site.passphrases_kvs_arn
}
