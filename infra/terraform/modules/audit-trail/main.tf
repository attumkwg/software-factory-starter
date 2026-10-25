# 管理操作の記録(CloudTrail)。誰が・いつ・どの AWS の API を呼んだかを、消せない S3 に残す(アカウントごとに1つ)。
#
#   S3          … Object Lock で、保存の期間(retention_days)が過ぎるまで誰も消せない・書き換えられない
#                 governance … 特別な権限があれば外せる(stg。作り直しや試しのため)
#                 compliance … AWS のサポートでも root でも外せない。期限まで消せず、バケットも消せない(prod)
#                              ⚠️ 取り消せない。prod の apply の前に、保存の期間を確かめる(docs/runbooks/audit-trail.md の 2)
#   KMS         … 記録とロググループを、このモジュールの鍵で暗号化する(鍵の利用も記録に残る)
#   CloudWatch  … 同じ記録をロググループにも流す。アラーム(下の root の利用・記録を止める)と調べ物はこちら
#                 ほかのアラーム(例: 要配慮の鍵の利用)は、出力の log_group_name にメトリクスフィルターを置く
#   ファイルの検証 … 記録のファイルが後から書き換えられていないかを、ダイジェストで確かめられる
#
# 管理の出来事(読みと書き)を全部、全部のリージョンで。KMS と RDS Data API の出来事も外さない
# (鍵の利用を見張るため。exclude_management_event_sources は空のまま)。
# データの出来事(S3 の物の読み書き・Lambda の呼び出し)は量で費用が増えるので取らない(足すなら advanced_event_selector)。
#
# Organizations は Terraform で持っていないので、いまはアカウントのトレイル(stg・prod に1つずつ)。
# 管理アカウントを Terraform で持ったら、organization_id を入れて組織のトレイルにできる(docs/runbooks/audit-trail.md の 4)。
#
# 月の費用の目安(2026-10 時点の定価から。量で変わるので、公式の料金表と最初の月の請求で確かめること):
#   CloudTrail … 管理の出来事の最初の写し(1本目のトレイル)は無料
#   S3         … 小さなアカウントで記録は月 数百 MB。保存 1GB あたり 約4円(90日後に Glacier Instant Retrieval へ移して 約1円)
#   CloudWatch … 取り込み 1GB あたり 約115円+保存。小さなアカウントで 月 数十〜数百円
#   KMS        … 鍵1本 月 約150円+呼び出しの回数

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
  partition  = data.aws_partition.current.partition
  trail_arn  = "arn:${local.partition}:cloudtrail:${local.region}:${local.account_id}:trail/${var.name}"
  log_group  = "/aws/cloudtrail/${var.name}"
  # 組織のトレイルなら、組織の ID の下にもほかのアカウントの記録が入る
  log_prefixes = concat([local.account_id], var.organization_id == null ? [] : [var.organization_id])
  alarms       = var.alarm_topic_arn == null ? {} : local.alarm_patterns
  actions      = var.alarm_topic_arn == null ? [] : [var.alarm_topic_arn]
}

# ── 鍵 ──────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "key" {
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }
  statement {
    sid       = "CloudTrailEncrypt"
    actions   = ["kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:aws:cloudtrail:arn"
      values   = ["arn:${local.partition}:cloudtrail:*:${local.account_id}:trail/*"]
    }
  }
  statement {
    sid       = "CloudTrailDescribe"
    actions   = ["kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
  statement {
    sid       = "CloudWatchLogs"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${local.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:${local.log_group}"]
    }
  }
}

resource "aws_kms_key" "this" {
  description         = "${var.name} audit trail"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.key.json
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name}-audit-trail"
  target_key_id = aws_kms_key.this.key_id
}

# ── 消せない S3 ─────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "this" {
  bucket              = "${var.name}-audit-trail-${local.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    default_retention {
      mode = upper(var.lock_mode)
      days = var.retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
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

# 90日を過ぎたら安い置き場へ。保存の期間を過ぎたら消す(ロックの間は、消す指示が来ても消えない)
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    id     = "retention"
    status = "Enabled"
    filter {}
    dynamic "transition" {
      for_each = var.retention_days > 90 ? [1] : []
      content {
        days          = 90
        storage_class = "GLACIER_IR"
      }
    }
    expiration {
      days = var.retention_days + 1
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.this.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }
  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = [for p in local.log_prefixes : "${aws_s3_bucket.this.arn}/AWSLogs/${p}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
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

# ── CloudWatch Logs へも流す ─────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "this" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.this.arn
}

data "aws_iam_policy_document" "cloudwatch_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }
}

resource "aws_iam_role" "cloudwatch" {
  name               = "${var.name}-audit-trail-logs"
  assume_role_policy = data.aws_iam_policy_document.cloudwatch_assume.json
}

data "aws_iam_policy_document" "cloudwatch" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:log-stream:*"]
  }
}

resource "aws_iam_role_policy" "cloudwatch" {
  name   = "write-logs"
  role   = aws_iam_role.cloudwatch.id
  policy = data.aws_iam_policy_document.cloudwatch.json
}

# ── トレイル ─────────────────────────────────────────────────────────────────────────

resource "aws_cloudtrail" "this" {
  name                          = var.name
  s3_bucket_name                = aws_s3_bucket.this.id
  kms_key_id                    = aws_kms_key.this.arn
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  is_organization_trail         = var.organization_id != null
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.this.arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.cloudwatch.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  depends_on = [aws_s3_bucket_policy.this, aws_iam_role_policy.cloudwatch]
}
