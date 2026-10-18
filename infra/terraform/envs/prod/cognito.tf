# 認証は自作しない。Cognito のユーザープールと、Cognito の画面(Managed Login)に任せる。
# 流れ: 画面「ログイン」→ API(/api/auth/login)→ Cognito の画面 → API(/api/auth/callback)が code を
#       トークンに替えて確かめ、Cookie を発行する。トークンはサーバーの中だけ(docs/security.md の「ログイン」)。
# 誰でも Cognito に登録できる。アプリに入れるのは organizations.users にいる人だけ(初回は確認済みのメールで結びつく)。
# 管理者は二段階認証を必須にする運用(グループで分ける)。

resource "aws_cognito_user_pool" "this" {
  name                     = local.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  # Managed Login(新しい Cognito の画面)は Essentials 以上。月1万人(MAU)までは無料
  user_pool_tier      = "ESSENTIALS"
  mfa_configuration   = "OPTIONAL"
  deletion_protection = "ACTIVE"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 3
  }

  # メールアドレスの大文字小文字を区別しない(API の結びつけも小文字で比べる)
  username_configuration {
    case_sensitive = false
  }

  # メールを変えても、新しいメールを確認するまでは古いメールのまま(確認していないメールで別の人に結びつかせない)
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  # 自分で登録できる(アプリに入れるかは API が users を見て決める)。登録を管理者だけにするなら true
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # 確認コード・パスワードの再設定のメールは、アプリと同じドメインから SES で直接送る(Postfix は通さない)。
  # 既定の Cognito のメール(1日50通まで・no-reply@verificationemail.com)は使わない
  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = module.ses.identity_arn
    from_email_address    = "Tasks <no-reply@${var.app_domain}>"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# Cognito の画面の入口: https://<接頭辞>.auth.<region>.amazoncognito.com
# 独自ドメイン(auth.example.com)にするなら、us-east-1 の ACM 証明書が要る(次の一歩)。
resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 2
}

# Managed Login の見た目。まずは Cognito の既定(ロゴと色はコンソールか、この設定で変える)
resource "aws_cognito_managed_login_branding" "web" {
  client_id                   = aws_cognito_user_pool_client.web.id
  user_pool_id                = aws_cognito_user_pool.this.id
  use_cognito_provided_values = true
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${local.name}-web"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  # 戻り先は API(トークンをブラウザに渡さない)。ログアウトの後はログイン画面へ
  callback_urls                 = ["https://${var.app_domain}/api/auth/callback"]
  logout_urls                   = ["https://${var.app_domain}/login"]
  prevent_user_existence_errors = "ENABLED"
  id_token_validity             = 15
  access_token_validity         = 15
  token_validity_units {
    id_token     = "minutes"
    access_token = "minutes"
  }
}
