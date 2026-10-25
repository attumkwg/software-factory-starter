# 公開の LP(apps/site)の置き場所(docs/specs/0025-public-landing-page.md・ADR 0038)。stg と prod に1つずつ。
#
#   https://<domain>/ → CloudFront(フォルダの index.html に読み替える関数)→ S3(非公開。OAC で CloudFront からだけ読める)
#
# - 中身はビルドで作った静的なファイルだけ(秘密も個人情報も無い)。事前登録は画面の API(/api/public/*)へ送る。
# - prod だけ検索に載せる(indexable)。stg は全部の応答に X-Robots-Tag: noindex, nofollow。
# - 外へ送らない: CSP で、読み込みと送り先を自分と API だけに絞る(解析・広告のタグを入れるなら、ここと同意の決まりを一緒に直す)。
# - アクセスログは取らない(IP を新しく残さない。見た数は API が日ごとに数える)。
# 費用の目安: 月 0〜数十円(CloudFront の無料枠: 月 1TB・1,000万リクエスト・関数 200万回。S3 は数 MB)。証明書は無料。

data "aws_caller_identity" "current" {}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# ── 置き場所(S3。外からは直接読めない) ─────────────────────────────────────────

resource "aws_s3_bucket" "this" {
  bucket = "${var.name}-site-${data.aws_caller_identity.current.account_id}"
  # 中身はビルドし直せば戻る(リポジトリが正)
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

#trivy:ignore:AVD-AWS-0132 中身は公開する静的なページだけ。CloudFront の OAC で読ませるため、鍵は S3 の物(SSE-S3)にする
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "CloudFrontOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
  statement {
    sid       = "HttpsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.bucket.json
  # 公開を止める設定の後に(順番が逆だと、ポリシーを公開とみなして断られることがある)
  depends_on = [aws_s3_bucket_public_access_block.this]
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

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  }
  zone_id = var.route53_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "this" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "this" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.route53_zone_id
  name     = var.domain
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

# ── 配る口(CloudFront) ───────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "${var.name}-site"
  description                       = "Public site bucket (private)"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "index" {
  name    = "${var.name}-site-index"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite /path/ to /path/index.html for the public site"
  publish = true
  code    = file("${path.module}/index.js")
}

resource "aws_cloudfront_response_headers_policy" "this" {
  name    = "${var.name}-site-headers"
  comment = "Security headers (and noindex outside prod) for the public site"
  dynamic "custom_headers_config" {
    for_each = var.indexable ? [] : [1]
    content {
      items {
        header   = "X-Robots-Tag"
        value    = "noindex, nofollow"
        override = true
      }
    }
  }
  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    content_security_policy {
      # 読み込みと送り先は自分と API だけ(外へ送らない)。部品(React Aria)が style 属性を使うので style は unsafe-inline
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self' ${var.app_url}",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ])
      override = true
    }
  }
}

#trivy:ignore:AVD-AWS-0011 静的なページだけ(書き込みは API の側の WAF が見る)。WAF(月 約1,000円〜)は付けない
#trivy:ignore:AVD-AWS-0010 アクセスログは取らない(IP を新しく残さない。見た数は API が日ごとに数える)
resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "Public site (apps/site). docs/guides/landing-page.md"
  aliases             = [var.domain]
  default_root_object = "index.html"
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  # 日本を含む(PriceClass_100 は北米と欧州だけ)
  price_class = "PriceClass_200"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index.arn
    }
  }

  # 無いページは 404(S3 は OAC で読めない物を 403 で返すので、404 に直す)
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/index.html"
    error_caching_min_ttl = 60
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
