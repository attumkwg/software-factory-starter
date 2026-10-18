# SES の送り元ドメイン。docs/guides/mail.md
#
#   - DKIM(署名)・SPF(MAIL FROM を自分のサブドメインに)・DMARC を Route 53 に書く(迷惑メールに入りにくくする)
#   - Postfix が SES に渡すための SMTP の資格情報を作り、Secrets Manager に置く
#     (SES の SMTP は IAM の役割では使えず、IAM ユーザーのアクセスキーから作るパスワードが要る。
#      送れるのはこのドメインを名乗るメールだけに絞る。入れ替えは terraform apply -replace=…aws_iam_access_key.smtp)
#   - Cognito の確認メールも、このドメインから SES で直接送る(envs/*/cognito.tf)
#
# ⚠️ 作ったばかりの SES は「サンドボックス」で、確かめたアドレスにしか送れない。
#    本番の前に、コンソールから「本番のアクセス」を申し込む(人がやる。docs/guides/mail.md)。

data "aws_region" "current" {}

resource "aws_sesv2_email_identity" "this" {
  email_identity = var.domain
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# DKIM: SES が署名に使う鍵を、DNS から引けるようにする(3つ)
resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = var.route53_zone_id
  name    = "${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# MAIL FROM(戻ってきたメールの宛先)を自分のサブドメインにして、SPF をそろえる
resource "aws_sesv2_email_identity_mail_from_attributes" "this" {
  email_identity         = aws_sesv2_email_identity.this.email_identity
  mail_from_domain       = "bounce.${var.domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.route53_zone_id
  name    = "bounce.${var.domain}"
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${data.aws_region.current.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.route53_zone_id
  name    = "bounce.${var.domain}"
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# DMARC: まずは「数えるだけ」(p=none)。届き方を見てから quarantine → reject に上げる
resource "aws_route53_record" "dmarc" {
  count   = var.create_dmarc_record ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 600
  records = [var.dmarc_report_email == "" ? "v=DMARC1; p=none" : "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_email}"]
}

# ── Postfix が SES に渡すための SMTP の資格情報 ─────────────────────────────────────

resource "aws_iam_user" "smtp" {
  name = "${var.name}-ses-smtp"
}

data "aws_iam_policy_document" "smtp" {
  statement {
    actions   = ["ses:SendRawEmail"]
    resources = [aws_sesv2_email_identity.this.arn]
    # このドメインを名乗るメールだけ
    condition {
      test     = "StringLike"
      variable = "ses:FromAddress"
      values   = ["*@${var.domain}"]
    }
  }
}

resource "aws_iam_user_policy" "smtp" {
  name   = "send-from-${var.domain}"
  user   = aws_iam_user.smtp.name
  policy = data.aws_iam_policy_document.smtp.json
}

resource "aws_iam_access_key" "smtp" {
  user = aws_iam_user.smtp.name
}

resource "aws_secretsmanager_secret" "smtp" {
  name       = "${var.name}/ses-smtp"
  kms_key_id = var.kms_key_arn
}

resource "aws_secretsmanager_secret_version" "smtp" {
  secret_id = aws_secretsmanager_secret.smtp.id
  secret_string = jsonencode({
    username = aws_iam_access_key.smtp.id
    password = aws_iam_access_key.smtp.ses_smtp_password_v4
  })
}
