# Aurora PostgreSQL Serverless v2。
# - 管理者(表の持ち主・移行用)のパスワードは RDS が Secrets Manager で管理し、回す。
# - アプリの接続ユーザー(app: 持ち主ではない・RLS がかかる)は、ここで作ったパスワードを
#   Secrets Manager に置くだけ。DB の中のロールは README の手順で1回だけ作る。

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Aurora: only from the app"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "from_app" {
  for_each                     = toset(var.allowed_security_group_ids)
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres from app"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id     = data.aws_caller_identity.current.account_id
  log_group_name = "/aws/rds/cluster/${var.name}/postgresql"
}

# DB・Performance Insights・接続文字列の秘密・DB のログを暗号化する鍵。
# 1つ目の文は AWS の既定の鍵ポリシーと同じ(IAM で許す)。2つ目で CloudWatch Logs に DB のログの分だけ使わせる
resource "aws_kms_key" "db" {
  description         = "${var.name} Aurora"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Account"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogsForDbLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${data.aws_region.current.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${data.aws_region.current.region}:${local.account_id}:log-group:${local.log_group_name}"
          }
        }
      }
    ]
  })
}

# ── DB のログ(遅いクエリ・ロック待ち・失敗) ─────────────────────────────────────────
# RDS に任せると、ロググループが「期限なし・鍵なし」で作られる。先に作って、保存の期間と鍵を決める。
# ⚠️ apply 済みの環境では RDS がもう作っているので、apply の前に1回 import する(PR の説明・docs/guides/monitoring.md)。
resource "aws_cloudwatch_log_group" "postgresql" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.db.arn
}

# 値の扱い: 遅いクエリは SQL の形だけを残し、渡した値($1 などの中身)は出さない。
# アプリは値を $1 で渡す(Drizzle)ので、SQL の文字列に会社や人のデータは入らない。
# 失敗の詳細(DETAIL: Key (email)=(…) など、値が入る)も出さない(terse)。失敗の中身はアプリのログで見る
resource "aws_rds_cluster_parameter_group" "this" {
  name        = "${var.name}-pg${split(".", var.engine_version)[0]}"
  family      = "aurora-postgresql${split(".", var.engine_version)[0]}"
  description = "${var.name}: slow query log without bind values"

  # この時間(ミリ秒)より遅い文を残す
  parameter {
    name  = "log_min_duration_statement"
    value = tostring(var.slow_query_log_ms)
  }
  # 遅い文・失敗した文のログに、渡した値を付けない
  parameter {
    name  = "log_parameter_max_length"
    value = "0"
  }
  parameter {
    name  = "log_parameter_max_length_on_error"
    value = "0"
  }
  parameter {
    name  = "log_error_verbosity"
    value = "terse"
  }
  # ロックを deadlock_timeout(1秒)より長く待ったら残す(止まって見える原因の手がかり)
  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_rds_cluster" "this" {
  cluster_identifier = var.name
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = var.engine_version
  database_name      = var.database_name
  master_username    = "app_owner"
  # パスワードは RDS が Secrets Manager で作って回す(Terraform の状態に残らない)
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]

  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.db.arn
  iam_database_authentication_enabled = true
  backup_retention_period             = var.backup_retention_days
  preferred_backup_window             = "17:00-18:00" # 日本の深夜
  copy_tags_to_snapshot               = true
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection
  final_snapshot_identifier           = var.deletion_protection ? "${var.name}-final" : null
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  db_cluster_parameter_group_name     = aws_rds_cluster_parameter_group.this.name
  # 保守(マイナー版の更新など)は日本時間の月曜 3:10〜3:50(バックアップの窓の後・AWS Backup の前)
  preferred_maintenance_window = "sun:18:10-sun:18:50"
  # コンソールのクエリエディタ(Data API)から、接続ユーザーを1回だけ作るため(README)
  enable_http_endpoint = true

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }

  # ログのグループを先に作る(RDS に「期限なし」で作らせない)
  depends_on = [aws_cloudwatch_log_group.postgresql]
}

resource "aws_rds_cluster_instance" "this" {
  count                                 = var.instance_count
  identifier                            = "${var.name}-${count.index}"
  cluster_identifier                    = aws_rds_cluster.this.id
  instance_class                        = "db.serverless"
  engine                                = aws_rds_cluster.this.engine
  engine_version                        = aws_rds_cluster.this.engine_version
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.db.arn
  performance_insights_retention_period = 7
  auto_minor_version_upgrade            = true
  preferred_maintenance_window          = aws_rds_cluster.this.preferred_maintenance_window
}

# アプリの接続ユーザーのパスワードと、それを入れた接続文字列
resource "random_password" "app" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.name}/database-url"
  description = "App connection (role: app, not the table owner)"
  kms_key_id  = aws_kms_key.db.arn
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgres://app:${random_password.app.result}@${aws_rds_cluster.this.endpoint}:5432/${var.database_name}?sslmode=verify-full"
}
