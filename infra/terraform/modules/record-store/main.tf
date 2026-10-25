# 記録の置き場(非公開の S3)。証跡(evidence.yml)と、費用のページ(cost.yml)が使う。ADR 0032
#   lock を渡すと Object Lock(保存の期間の間は、誰も消せない・上書きしても前の版が残る)。証跡はこちら
#   lock を渡さなければ、古い版を noncurrent_expire_days で消す(費用のページのように毎日上書きする物)
# 中身は公開しない(公開を止める設定+TLS だけ+自前の鍵)。読むのは AWS のコンソールか、人が作る期限つきの URL だけ。
# 費用の目安: 月 数円〜数十円(1か月の証跡は 1MB 前後。90日後に安い保存(Glacier Instant Retrieval)へ移す)+鍵 月 約150円。

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "this" {
  description         = "${var.name} records"
  enable_key_rotation = true
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.this.key_id
}

resource "aws_s3_bucket" "this" {
  bucket = "${var.name}-${data.aws_caller_identity.current.account_id}"
  # Object Lock は作るときにしか付けられない(後から付け外しできない)
  object_lock_enabled = var.lock != null
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

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.this.arn
    }
    bucket_key_enabled = true
  }
}

# ⚠️ mode が COMPLIANCE だと、保存の期間の間は root でも消せない・期間を縮められない(戻せない)。
#    GOVERNANCE は s3:BypassGovernanceRetention を持つ人だけが消せる(誤って入れた物を消す道を残す)
resource "aws_s3_bucket_object_lock_configuration" "this" {
  count  = var.lock == null ? 0 : 1
  bucket = aws_s3_bucket.this.id
  rule {
    default_retention {
      mode  = var.lock.mode
      years = var.lock.years
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "archive"
    status = "Enabled"
    filter {}
    transition {
      days          = var.archive_after_days
      storage_class = "GLACIER_IR"
    }
    dynamic "noncurrent_version_expiration" {
      for_each = var.lock == null ? [1] : []
      content {
        noncurrent_days = var.noncurrent_expire_days
      }
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

data "aws_iam_policy_document" "bucket" {
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
  bucket     = aws_s3_bucket.this.id
  policy     = data.aws_iam_policy_document.bucket.json
  depends_on = [aws_s3_bucket_public_access_block.this]
}
