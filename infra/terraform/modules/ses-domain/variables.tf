variable "name" {
  description = "名前の頭(例: sfs-stg)"
  type        = string
}

variable "domain" {
  description = "送り元のドメイン(例: app.stg.example.com)。no-reply@<これ> から送る"
  type        = string
}

variable "route53_zone_id" {
  description = "domain が入る Route 53 のゾーン"
  type        = string
}

variable "kms_key_arn" {
  description = "SMTP の資格情報(秘密)を暗号化する鍵"
  type        = string
}

variable "create_dmarc_record" {
  description = "DMARC のレコードを作るか(ドメインにもう DMARC があるなら false)"
  type        = bool
  default     = true
}

variable "dmarc_report_email" {
  description = "DMARC の集計を受け取るアドレス(空なら受け取らない)"
  type        = string
  default     = ""
}
