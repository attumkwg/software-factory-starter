# DB のバックアップを、Aurora の自動バックアップとは別に、消せない保管庫に取る(環境ごとに1つ)。
#
#   Aurora の自動バックアップ … いつの時点にも戻せる(時点復元)。ただし保存は最大35日(いまは prod 14日)で、
#                                クラスターと同じ所にあり、権限のある人(や乗っ取られた鍵)なら消せる
#   ここ(AWS Backup)        … 毎日(35日)と毎月(1年)のスナップショットを、保管庫のロック(Vault Lock)で
#                                **期限まで誰も消せない**ようにして残す
#
# ロックの強さ(lock_mode):
#   governance … 特別な権限があれば外せる(stg。作り直しや試しのため)
#   compliance … changeable_for_days を過ぎると、AWS のサポートでも root でも外せない・期限まで消せない(prod)
#                ⚠️ 取り消せない。apply してから compliance_grace_days の間に、設定が正しいかを確かめる
#
# 失敗(バックアップが取れなかった)は、modules/alerts の SNS → Slack へ。
# 戻し方は docs/runbooks/db-restore.md。
#
# 月の費用: スナップショットの保管 1GB あたり 約3円(Aurora のスナップショットの単価)× 量。
#           変わった所だけが増えるので、小さな DB なら数百円まで。

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_kms_key" "vault" {
  description         = "${var.name} backup vault"
  enable_key_rotation = true
}

resource "aws_backup_vault" "this" {
  name        = "${var.name}-db"
  kms_key_arn = aws_kms_key.vault.arn
}

resource "aws_backup_vault_lock_configuration" "this" {
  backup_vault_name  = aws_backup_vault.this.name
  min_retention_days = 7
  max_retention_days = 400
  # 値を入れると compliance(猶予の日数のあと、二度と外せない)。null なら governance
  changeable_for_days = var.lock_mode == "compliance" ? var.compliance_grace_days : null
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
  ])
  role       = aws_iam_role.backup.name
  policy_arn = each.value
}

resource "aws_backup_plan" "this" {
  name = "${var.name}-db"

  # 毎日 日本時間 4:00(Aurora の自動バックアップの窓 2:00〜3:00 の後)
  rule {
    rule_name                    = "daily"
    target_vault_name            = aws_backup_vault.this.name
    schedule                     = "cron(0 19 * * ? *)"
    schedule_expression_timezone = "UTC"
    start_window                 = 60
    completion_window            = 360
    lifecycle {
      delete_after = var.daily_retention_days
    }
  }

  # 毎月1日 日本時間 5:00。1年残す(「先月の末の状態」に戻したい、に答えられるように)
  rule {
    rule_name                    = "monthly"
    target_vault_name            = aws_backup_vault.this.name
    schedule                     = "cron(0 20 1 * ? *)"
    schedule_expression_timezone = "UTC"
    start_window                 = 60
    completion_window            = 360
    lifecycle {
      delete_after = var.monthly_retention_days
    }
  }
}

resource "aws_backup_selection" "db" {
  name         = "${var.name}-db"
  plan_id      = aws_backup_plan.this.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = [var.db_cluster_arn]
}

# ── 失敗したら Slack へ ─────────────────────────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "failed" {
  name        = "${var.name}-backup-failed"
  description = "AWS Backup jobs that failed, were aborted, or expired"
  event_pattern = jsonencode({
    source      = ["aws.backup"]
    detail-type = ["Backup Job State Change", "Copy Job State Change"]
    detail = {
      state = ["FAILED", "ABORTED", "EXPIRED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "failed" {
  rule = aws_cloudwatch_event_rule.failed.name
  arn  = var.topic_arn
  input_transformer {
    input_paths = {
      state    = "$.detail.state"
      resource = "$.detail.resourceArn"
      message  = "$.detail.statusMessage"
    }
    # Slack 連携(Amazon Q Developer)の「カスタム通知」の形。ただの文字列だと Slack に出ない
    input_template = <<-EOT
      {
        "version": "1.0",
        "source": "custom",
        "content": {
          "title": "[${var.name}] バックアップが <state> になりました",
          "description": "<resource> / <message> / 手順: docs/runbooks/db-restore.md の 6"
        }
      }
    EOT
  }
}
