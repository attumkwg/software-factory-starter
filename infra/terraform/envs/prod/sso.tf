# SSO(SAML)の入口(docs/designs/0056-sso-scim-ip-audit-export.md の 5・ADR 0067)。sso_enabled のときだけ作る。
# ユーザープールの OAuth の入口を auth.<app_domain> に置き(証明書は us-east-1)、API に COGNITO_OAUTH_URL を渡す。
# お客さんの IdP は Terraform では作らない: 運営のコマンド sso-connect が Cognito に作り、アプリクライアントの一覧に足す
# (cognito.tf の supported_identity_providers は見ない)。手順は docs/runbooks/sso.md の 4。

locals {
  sso_domain      = "auth.${var.app_domain}"
  sso_environment = var.sso_enabled ? { COGNITO_OAUTH_URL = "https://${local.sso_domain}" } : {}
}

resource "aws_acm_certificate" "sso" {
  count             = var.sso_enabled ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = local.sso_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "sso_cert_validation" {
  for_each = var.sso_enabled ? {
    for o in aws_acm_certificate.sso[0].domain_validation_options : o.domain_name => o
  } : {}
  zone_id = var.route53_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "sso" {
  count                   = var.sso_enabled ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.sso[0].arn
  validation_record_fqdns = [for r in aws_route53_record.sso_cert_validation : r.fqdn]
}

# Cognito の独自ドメインは、親のドメイン(app_domain)に A レコードがあるときだけ作れる
resource "aws_cognito_user_pool_domain" "sso" {
  count           = var.sso_enabled ? 1 : 0
  domain          = local.sso_domain
  certificate_arn = aws_acm_certificate_validation.sso[0].certificate_arn
  user_pool_id    = aws_cognito_user_pool.this.id
  depends_on      = [aws_route53_record.app]
}

resource "aws_route53_record" "sso" {
  count   = var.sso_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = local.sso_domain
  type    = "A"
  alias {
    name                   = aws_cognito_user_pool_domain.sso[0].cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.sso[0].cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}
