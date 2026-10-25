output "kms_key_arn" {
  description = "組織のデータ鍵を包む鍵(API の SENSITIVE_KMS_KEY_ID)"
  value       = aws_kms_key.this.arn
}

output "database_url_secret_arn" {
  description = "要配慮だけの接続文字列(API の SENSITIVE_DATABASE_URL)"
  value       = aws_secretsmanager_secret.database_url.arn
}
