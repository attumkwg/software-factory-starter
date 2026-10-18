variable "name" {
  type = string
}

variable "domain" {
  description = "外から見るドメイン(app.example.com)"
  type        = string
}

variable "checks" {
  description = "見る道すじ(名前 → パス)。どちらも DB を使わない物にする"
  type        = map(string)
  default = {
    web = "/readyz"
    api = "/api/auth/options"
  }
}

variable "email_addresses" {
  description = "メールでも受けるなら、その宛先(modules/alerts と同じ物)"
  type        = list(string)
  default     = []
}
