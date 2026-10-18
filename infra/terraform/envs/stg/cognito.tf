# 認証(パスワードの保管・照合・確認コード・二段階認証)は Cognito に任せる。画面は自前(ADR 0009)。
# 流れ: 画面 → API(/api/auth/*)→ Cognito の API(USER_PASSWORD_AUTH)。トークンは API の中だけ。
# 誰でも Cognito に登録できる。アプリに入れるのは organizations.users にいる人だけ(初回は確認済みのメールで結びつく)。
# 管理者は二段階認証を必須にする運用(グループで分ける)。
#
# パスワードの決まりと確認コードのメールの文面は packages/shared/src/cognito-settings.json が正
# (偽物の Cognito と画面も同じ物を読む)。変えたら apply のあと、契約テスト(cognito-contract.yml)を流す。

locals {
  cognito_settings = jsondecode(file("${path.module}/../../../../packages/shared/src/cognito-settings.json"))
}

resource "aws_cognito_user_pool" "this" {
  name                     = local.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  # 画面を自作するので、Cognito の画面(Managed Login)の要る Essentials にはしない。月1万人(MAU)までは無料。
  # パスキー・メールでの二段階認証を使うなら ESSENTIALS に上げる
  user_pool_tier      = "LITE"
  mfa_configuration   = "OPTIONAL"
  deletion_protection = "INACTIVE"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = local.cognito_settings.passwordPolicy.minimumLength
    require_lowercase                = local.cognito_settings.passwordPolicy.requireLowercase
    require_numbers                  = local.cognito_settings.passwordPolicy.requireNumbers
    require_symbols                  = local.cognito_settings.passwordPolicy.requireSymbols
    require_uppercase                = local.cognito_settings.passwordPolicy.requireUppercase
    temporary_password_validity_days = local.cognito_settings.passwordPolicy.temporaryPasswordValidityDays
  }

  # 確認コード(登録・パスワードの再設定)のメールの文面
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = local.cognito_settings.verificationEmail.subject
    email_message        = local.cognito_settings.verificationEmail.message
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

# 画面(API)が使うアプリクライアント。パスワードでのログインだけを許す(秘密は持たない)
resource "aws_cognito_user_pool_client" "web" {
  name            = "${local.name}-web"
  user_pool_id    = aws_cognito_user_pool.this.id
  generate_secret = false
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  # 「その人はいない」と答えない(パスワード違いと同じ答え。契約テストが確かめる)
  prevent_user_existence_errors = "ENABLED"
  # 二段階認証のコードを待つ札(Session)の期限
  auth_session_validity = 3
  # API は ID トークンを確かめたらすぐ捨て、自前の Cookie にする。トークンは短く
  id_token_validity      = 15
  access_token_validity  = 15
  refresh_token_validity = 60
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "minutes"
  }
}
