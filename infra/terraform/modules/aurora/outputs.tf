output "endpoint" {
  value = aws_rds_cluster.this.endpoint
}

output "database_name" {
  value = var.database_name
}

output "security_group_id" {
  value = aws_security_group.db.id
}

output "master_user_secret_arn" {
  description = "表の持ち主(移行用)のパスワード。JSON の password キー"
  value       = aws_rds_cluster.this.master_user_secret[0].secret_arn
}

output "database_url_secret_arn" {
  description = "アプリの接続文字列"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "kms_key_arn" {
  value = aws_kms_key.db.arn
}

output "cluster_identifier" {
  value = aws_rds_cluster.this.cluster_identifier
}
