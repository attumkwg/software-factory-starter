variable "name" {
  description = "秘密・CloudFront の決まりなどの名前の頭(例: sfs-prod)"
  type        = string
}

variable "domain" {
  description = "アプリ(画面と API)のドメイン(例: app.example.com)。CloudFront の証明書をここで作る(A/AAAA は呼ぶ側で distribution に向ける)"
  type        = string
}

variable "origin_domain" {
  description = "CloudFront が ALB に向かう名前(例: origin.app.example.com)。ALB の証明書に別名で入れておく(A は呼ぶ側で ALB に向ける)"
  type        = string
}

variable "route53_zone_id" {
  description = "domain が入る Route 53 のゾーン"
  type        = string
}

variable "web_acl_arn" {
  description = "CloudFront の前に付ける WAF(スコープ CLOUDFRONT・us-east-1)。null なら付けない"
  type        = string
  default     = null
}

variable "kms_key_arn" {
  description = "秘密(ヘッダーの名前と値)を暗号化する KMS の鍵"
  type        = string
}
