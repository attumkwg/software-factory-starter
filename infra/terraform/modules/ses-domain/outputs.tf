output "identity_arn" {
  description = "Cognito の email_configuration の source_arn に"
  value       = aws_sesv2_email_identity.this.arn
}

output "domain" {
  value = var.domain
}

output "smtp_credentials_secret_arn" {
  description = "Postfix(modules/mail-relay)が読む SMTP の資格情報"
  value       = aws_secretsmanager_secret.smtp.arn
}
