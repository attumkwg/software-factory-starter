variable "name" {
  description = "バケット(<name>-site-<アカウント ID>)・CloudFront の関数などの名前の頭(例: sfs-prod)"
  type        = string
}

variable "domain" {
  description = "公開のページのドメイン(例: www.example.com)。証明書と DNS をここで作る"
  type        = string
}

variable "route53_zone_id" {
  description = "domain が入る Route 53 のゾーン"
  type        = string
}

variable "app_url" {
  description = "画面と API の URL(https://app.example.com)。事前登録の送り先として CSP の connect-src に入れる"
  type        = string
}

variable "indexable" {
  description = "検索に載せるか(prod だけ true)。false なら全部の応答に X-Robots-Tag: noindex, nofollow"
  type        = bool
}
