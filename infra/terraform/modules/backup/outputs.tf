output "vault_name" {
  description = "戻すときに見る保管庫(docs/runbooks/db-restore.md)"
  value       = aws_backup_vault.this.name
}
