# GitHub Actions → AWS を OIDC で(長期のアクセスキーを作らない)。
# 役割はリポジトリ・ブランチ・環境ごとに分ける。プレビュー用の役割は dev アカウントにしか作らない。
#
# subjects の例(「repo:<owner>/<repo>:」の後ろ):
#   pull_request            … PR から(プレビュー。dev アカウントの役割だけ。stg / prod の役割には付けない)
#   environment:stg         … environment: stg のジョブから(stg へのデプロイ)
#   environment:prod        … environment: prod のジョブから(承認のあと)
#   ref:refs/heads/main     … main への push から

locals {
  oidc_provider_arn = var.create_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "assume" {
  for_each = var.roles
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for s in each.value.subjects : "repo:${var.github_repository}:${s}"]
    }
  }
}

resource "aws_iam_role" "this" {
  for_each             = var.roles
  name                 = each.key
  description          = each.value.description
  assume_role_policy   = data.aws_iam_policy_document.assume[each.key].json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "this" {
  for_each = { for k, v in var.roles : k => v if v.policy_json != null }
  name     = "github-actions"
  role     = aws_iam_role.this[each.key].id
  policy   = each.value.policy_json
}

resource "aws_iam_role_policy_attachment" "managed" {
  for_each = merge([
    for k, v in var.roles : { for arn in v.managed_policy_arns : "${k}|${arn}" => { role = k, arn = arn } }
  ]...)
  role       = aws_iam_role.this[each.value.role].name
  policy_arn = each.value.arn
}
