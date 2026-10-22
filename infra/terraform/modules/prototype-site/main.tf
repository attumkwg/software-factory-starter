# 確かめるための試作(prototypes/)の置き場所。dev アカウントにだけ作る(docs/guides/prototypes.md)。
#
#   https://<CloudFront>/<賭けの ID>/ → CloudFront Functions(合言葉 = Basic 認証)→ S3(非公開。OAC で CloudFront からだけ読める)
#
# - 合言葉は KeyValueStore に人が CLI で入れる(コード・リポジトリ・Terraform の状態に入れない)。入れるまでは誰も通さない。
# - 応答に X-Robots-Tag: noindex(検索に載せない)。
# - 中身は偽のデータだけの静的な画面。本物の API・DB・秘密は無い。
# 費用の目安: 月 0〜数十円(CloudFront の無料枠: 月 1TB・1,000万リクエスト・関数 200万回。S3 は数 MB)。

data "aws_caller_identity" "current" {}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# ── 置き場所(S3。外からは直接読めない) ─────────────────────────────────────────

resource "aws_s3_bucket" "this" {
  bucket = "${var.name}-${data.aws_caller_identity.current.account_id}"
  # 捨てる物なので、壊すときは中身ごと
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

#trivy:ignore:AVD-AWS-0132 中身は偽のデータだけの静的な画面。CloudFront の OAC で読ませるため、鍵は S3 の物(SSE-S3)にする
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

# ── 合言葉(CloudFront Functions+KeyValueStore) ────────────────────────────────

# 鍵: _all(全部の試作で通る)/ B-NNNN(その試作だけで通る)。値は base64("名前:合言葉")。
# 入れ方は docs/guides/prototypes.md の「合言葉を入れる・変える」
resource "aws_cloudfront_key_value_store" "passphrases" {
  name    = "${var.name}-passphrases"
  comment = "Basic auth for prototypes. Values are put by hand with the CLI (not in code or state)."
}

resource "aws_cloudfront_function" "auth" {
  name    = "${var.name}-auth"
  runtime = "cloudfront-js-2.0"
  comment = "Basic auth (passphrase from KeyValueStore) and index.html for /<bet id>/"
  publish = true
  code = templatefile("${path.module}/auth.js.tftpl", {
    kvs_id = element(split("/", aws_cloudfront_key_value_store.passphrases.arn), 1)
  })
  key_value_store_associations = [aws_cloudfront_key_value_store.passphrases.arn]
}

# ── 配る口(CloudFront) ───────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = var.name
  description                       = "Prototypes bucket (private)"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "this" {
  name    = "${var.name}-headers"
  comment = "noindex and basic security headers for prototypes"
  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
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
      referrer_policy = "no-referrer"
      override        = true
    }
  }
}

#trivy:ignore:AVD-AWS-0011 合言葉(Basic 認証)で絞った試作だけを置く。WAF(月 約1,000円〜)は付けない
resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  comment         = "Prototypes (noindex, passphrase). docs/guides/prototypes.md"
  is_ipv6_enabled = true
  http_version    = "http2and3"
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
      function_arn = aws_cloudfront_function.auth.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
