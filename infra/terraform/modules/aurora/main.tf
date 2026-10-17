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

resource "aws_kms_key" "db" {
  description         = "${var.name} Aurora"
  enable_key_rotation = true
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
  # コンソールのクエリエディタ(Data API)から、接続ユーザーを1回だけ作るため(README)
  enable_http_endpoint = true

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }
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
