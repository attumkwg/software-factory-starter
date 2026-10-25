output "bucket" {
  description = "公開のページを置くバケット(GitHub の変数 <ENV>_SITE_BUCKET に)"
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "distribution_id" {
  description = "置いたあとに古い物を消す(invalidation)CloudFront(GitHub の変数 <ENV>_SITE_DISTRIBUTION_ID に)"
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "url" {
  description = "公開のページの URL(API の PUBLIC_SITE_URL・GitHub の変数 <ENV>_SITE_URL に)"
  value       = "https://${var.domain}"
}
