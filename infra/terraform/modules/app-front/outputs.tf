output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_domain_name" {
  description = "domain の A/AAAA(エイリアス)の向き先"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.this.hosted_zone_id
}

output "origin_secret_arn" {
  description = "ヘッダーの名前・いまの値・前の値の秘密(入れ替えは docs/runbooks/cloudfront-origin.md)"
  value       = aws_secretsmanager_secret.origin.arn
}

output "origin_header" {
  description = "ALB のルールが確かめるヘッダー(名前と、通す値。いまの値と前の値)。plan・ログに出さない"
  value = {
    name   = local.origin.name
    values = compact([local.origin.current, try(local.origin.previous, "")])
  }
  sensitive = true
}
