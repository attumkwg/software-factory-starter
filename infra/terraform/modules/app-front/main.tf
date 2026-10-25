# アプリ(画面と API)の前の CloudFront(docs/specs/0058-cloudfront-in-front-of-app.md・ADR 0070)。stg と prod に1つずつ。
#
#   https://<domain>/ → CloudFront(WAF・キャッシュしない)→ https://<origin_domain>/ + 秘密のヘッダー → ALB → API・画面
#   (domain と origin_domain の DNS は呼ぶ側。domain の向き先を ALB と CloudFront で切り替えても、レコードを作り直さない)
#
# - ALB は CloudFront の送り元の一覧(プレフィックスリスト)からだけ受け、ルールで秘密のヘッダーを確かめる(ecs-service・web-service)。
#   一覧は全部の CloudFront なので、自分の CloudFront だけが知るヘッダー(名前も値も秘密)で絞る。
# - いまの人の IP は CloudFront が付ける CloudFront-Viewer-Address(API と画面の CLIENT_IP_HEADER)。
# - 秘密は Terraform が最初の値を作り、その後は人が Secrets Manager で入れ替える(docs/runbooks/cloudfront-origin.md)。
#   Terraform は今の値を読んで CloudFront と ALB に入れる(plan では sensitive)。
# - アクセスログは取らない(IP を新しく残さない。WAF のログとアプリのログで足りる)。
# 費用の目安: 無料枠(月 1TB・1,000万リクエスト)の中なら 0 円。Secrets Manager 月 $0.40。証明書は無料。

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# ── 秘密のヘッダー(名前も値もランダム)。最初の値だけ Terraform が作る ─────────────────────

resource "random_id" "header" {
  byte_length = 6
}

resource "random_password" "header" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "origin" {
  name        = "${var.name}/cloudfront-origin"
  description = "CloudFront だけが知るオリジンのヘッダー(名前・いまの値・前の値)。入れ替えは docs/runbooks/cloudfront-origin.md"
  kms_key_id  = var.kms_key_arn
}

resource "aws_secretsmanager_secret_version" "origin" {
  secret_id = aws_secretsmanager_secret.origin.id
  secret_string = jsonencode({
    name     = "x-origin-${random_id.header.hex}"
    current  = random_password.header.result
    previous = ""
  })
  # 入れ替えは人が Secrets Manager で(Terraform は最初の値に戻さない)
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# 人が入れ替えた後の値を読む
data "aws_secretsmanager_secret_version" "origin" {
  secret_id  = aws_secretsmanager_secret.origin.id
  depends_on = [aws_secretsmanager_secret_version.origin]
}

locals {
  origin = jsondecode(data.aws_secretsmanager_secret_version.origin.secret_string)
}

# ── 証明書と DNS(CloudFront の証明書は us-east-1 に作る) ─────────────────────────

resource "aws_acm_certificate" "this" {
  provider          = aws.us_east_1
  domain_name       = var.domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# ALB の証明書(東京)と同じ名前なので、確かめのレコードも同じになる。重なっても上書きしてよい
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  }
  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# domain の A/AAAA は呼ぶ側(envs)が持つ(ALB と CloudFront の向き先を、作り直さずに切り替えるため)

# ── 配る口(CloudFront) ───────────────────────────────────────────────────────

# 全部をそのまま渡し(Cookie・クエリ・ヘッダー)、いまの人の「IP:ポート」を足す
resource "aws_cloudfront_origin_request_policy" "app" {
  name    = "${var.name}-app"
  comment = "Forward everything to the ALB and add CloudFront-Viewer-Address"
  cookies_config {
    cookie_behavior = "all"
  }
  headers_config {
    header_behavior = "allViewerAndWhitelistCloudFront"
    headers {
      items = ["CloudFront-Viewer-Address"]
    }
  }
  query_strings_config {
    query_string_behavior = "all"
  }
}

#trivy:ignore:AVD-AWS-0010 アクセスログは取らない(IP を新しく残さない。WAF のログとアプリのログで足りる)
resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  comment         = "App (web and API) in front of the ALB. docs/specs/0058-cloudfront-in-front-of-app.md"
  aliases         = [var.domain]
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_200"
  web_acl_id      = var.web_acl_arn

  origin {
    origin_id   = "alb"
    domain_name = var.origin_domain
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
    custom_header {
      name  = local.origin.name
      value = local.origin.current
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.app.id
    # 縮めるのは画面のサーバーと API(ALB は縮めない。CloudFront もキャッシュしないので縮めない)
    compress = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.this.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
