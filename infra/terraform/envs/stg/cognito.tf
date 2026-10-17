# 認証は自作しない。Cognito のユーザープールとホスト UI に任せる(API は ID トークンを検証するだけ)。
# 管理者は二段階認証を必須にする運用(グループで分ける)。パスキーを使うなら Managed Login を有効にする。

resource "aws_cognito_user_pool" "this" {
  name                     = local.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"
  deletion_protection      = "INACTIVE"

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

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${local.name}-web"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.app_domain}/auth/callback"]
  logout_urls                          = ["https://${var.app_domain}/"]
  prevent_user_existence_errors        = "ENABLED"
  id_token_validity                    = 15
  access_token_validity                = 15
  token_validity_units {
    id_token     = "minutes"
    access_token = "minutes"
  }
}
