# 写真・ファイルの置き場(非公開の S3)と、組織ごとに絞って引き受ける役割(docs/specs/0072-file-storage.md・ADR 0079・0080)。
# - キーは <段>/<組織の ID>/<ファイルの ID>。段は incoming(上げただけ)と files(確かめて書き直した物)。
# - API・移行のタスクは、この置き場を直接触らない。役割 files-access を STS で引き受け、セッションのポリシーで
#   incoming/<組織>/*・files/<組織>/* に絞ってから、署名・読み書き・消す(apps/api/src/storage/tenant-credentials.ts)。
# - 公開しない(公開を止める設定+TLS だけ+ACL を使わない)・自前の KMS の鍵(バケットの鍵で呼び出しを減らす)・版を残す。
# - 上げ終えない物(incoming)は1日で消す。消した物・上書きした物の前の版は noncurrent_expire_days(既定 30日)で消える。
#   解約の削除(delete-tenant)は、その組織の頭の前の版まで全部消す。
# - 画面の出どころ(allowed_origins)から PUT・GET だけを CORS で許す。
# 費用の目安(東京): 保存 1GB 月 約3.8円・PUT 1,000回 約0.7円・GET 1,000回 約0.06円・鍵 月 約150円(設計書 0072 の 8)。

data "aws_caller_identity" "current" {}

locals {
  stages = ["incoming", "files"]
}

resource "aws_kms_key" "this" {
  description         = "${var.name} files (photos and documents)"
  enable_key_rotation = true
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name}-files"
  target_key_id = aws_kms_key.this.key_id
}

resource "aws_s3_bucket" "this" {
  bucket = "${var.name}-files-${data.aws_caller_identity.current.account_id}"
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

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  # 上げ終えない物(画面が PUT したが complete を呼ばなかった・断った物の残り)
  rule {
    id     = "incoming"
    status = "Enabled"
    filter {
      prefix = "incoming/"
    }
    expiration {
      days = var.incoming_expire_days
    }
  }

  # 消した物・上書きした物の前の版(誤って消したときに運営が戻せる期間。設計書 0072 の U-3)
  rule {
    id     = "noncurrent"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_expire_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # 前の版が消えた後に残る「消した印」
  rule {
    id     = "delete-markers"
    status = "Enabled"
    filter {}
    expiration {
      expired_object_delete_marker = true
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_cors_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["content-type"]
    max_age_seconds = 600
  }
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

# ── 組織ごとに絞って引き受ける役割 ─────────────────────────────────────

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = var.assumer_role_arns
    }
    # セッションの名前は files-<組織の ID>(CloudTrail で組織ごとに追う)
    condition {
      test     = "StringLike"
      variable = "sts:RoleSessionName"
      values   = ["files-*"]
    }
  }
}

resource "aws_iam_role" "access" {
  name                 = "${var.name}-files-access"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  max_session_duration = 3600
}

# 役割の権限は置き場の2つの段の全部。実際に効くのは、アプリが付けるセッションのポリシー(1つの組織の頭)との重なりだけ
resource "aws_iam_role_policy" "access" {
  name = "files"
  role = aws_iam_role.access.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Objects"
        Effect = "Allow"
        Action = [
          "s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:GetObjectVersion", "s3:DeleteObjectVersion",
        ]
        Resource = [for s in local.stages : "${aws_s3_bucket.this.arn}/${s}/*"]
      },
      {
        Sid      = "List"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketVersions"]
        Resource = aws_s3_bucket.this.arn
        Condition = {
          StringLike = { "s3:prefix" = [for s in local.stages : "${s}/*"] }
        }
      },
      {
        Sid      = "Key"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.this.arn
      },
    ]
  })
}

# 引き受ける側(API・移行のタスクの役割)に、この役割を引き受けることだけを許す
resource "aws_iam_role_policy" "assumer" {
  for_each = { for i, arn in var.assumer_role_arns : tostring(i) => arn }
  name     = "assume-files-access"
  role     = element(split("/", each.value), length(split("/", each.value)) - 1)
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sts:AssumeRole"]
      Resource = aws_iam_role.access.arn
    }]
  })
}
