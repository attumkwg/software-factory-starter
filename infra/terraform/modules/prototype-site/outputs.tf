output "bucket" {
  description = "試作を置くバケット(GitHub の変数 PROTOTYPES_BUCKET に)"
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "url" {
  description = "試作の URL の頭(GitHub の変数 PROTOTYPES_URL に)。https://<CloudFront>/<賭けの ID>/"
  value       = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "passphrases_kvs_arn" {
  description = "合言葉を入れる KeyValueStore(docs/guides/prototypes.md の「合言葉を入れる・変える」)"
  value       = aws_cloudfront_key_value_store.passphrases.arn
}
