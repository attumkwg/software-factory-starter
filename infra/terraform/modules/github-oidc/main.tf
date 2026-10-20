# GitHub Actions → AWS を OIDC で(長期のアクセスキーを作らない)。
# 役割はリポジトリ・ブランチ・環境ごとに分ける。プレビュー用の役割は dev アカウントにしか作らない。
#
# subjects の例(「repo:<owner>/<repo>:」の後ろ):
#   pull_request            … PR から(プレビュー・stg の plan)。PR の版のワークフローが動くので、
#                             ブランチを作れる人なら誰でも使える。本番の役割には付けない
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

# ── 中身を読ませない(ReadOnlyAccess の穴をふさぐ) ──────────────────────────────────────
# ReadOnlyAccess は「設定を読む」だけでなく、ログの本文・S3 の物・Cognito の利用者(メールアドレス)・
# DB のログ・キューの中身なども読める。plan に要るのは設定だけなので、中身を読む操作を明示で拒む。
# (秘密の値 secretsmanager:GetSecretValue は ReadOnlyAccess に元から無い)

locals {
  data_read_actions = [
    # ログの本文(アプリのログには会社や人の ID が出る)
    "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:GetQueryResults",
    "logs:StartLiveTail", "logs:GetLogRecord", "logs:GetLogObject", "logs:Unmask",
    # 利用者(メールアドレス・ログインの記録)
    "cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:AdminGetUser",
    "cognito-idp:AdminListGroupsForUser", "cognito-idp:AdminListDevices", "cognito-idp:AdminGetDevice",
    "cognito-idp:AdminListUserAuthEvents",
    # DB のログ(遅いクエリの SQL)
    "rds:DownloadDBLogFilePortion", "rds:DownloadCompleteDBLogFile",
    # イメージの中身(コードと依存)
    "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
    # SES の送れない宛先(メールアドレス)
    "ses:GetSuppressedDestination", "ses:ListSuppressedDestinations",
    # いまは使っていないが、足したときに中身が読めないように
    "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PartiQLSelect",
    "dynamodb:GetRecords", "sqs:ReceiveMessage", "kinesis:GetRecords", "kinesis:GetShardIterator",
    "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory",
    "athena:GetQueryResults", "states:GetExecutionHistory", "xray:BatchGetTraces",
    "ec2:GetPasswordData", "ec2:GetConsoleOutput", "ec2:GetConsoleScreenshot",
    "s3-object-lambda:GetObject", "s3-object-lambda:GetObjectVersion", "s3tables:GetTableData",
    "support:DescribeCommunications", "support:DescribeAttachment",
  ]
  guarded_roles = { for k, v in var.roles : k => v if v.deny_data_reads != null }
}

data "aws_iam_policy_document" "deny_data_reads" {
  for_each = local.guarded_roles
  statement {
    sid       = "DenyDataReads"
    effect    = "Deny"
    actions   = local.data_read_actions
    resources = ["*"]
  }
  # S3 の物は、Terraform の状態のほかは読ませない
  statement {
    sid           = "DenyObjectReadsExceptState"
    effect        = "Deny"
    actions       = ["s3:GetObject", "s3:GetObjectVersion"]
    not_resources = each.value.deny_data_reads.except_s3_objects
  }
}

resource "aws_iam_role_policy" "deny_data_reads" {
  for_each = local.guarded_roles
  name     = "deny-data-reads"
  role     = aws_iam_role.this[each.key].id
  policy   = data.aws_iam_policy_document.deny_data_reads[each.key].json
}

resource "aws_iam_role_policy_attachment" "managed" {
  for_each = merge([
    for k, v in var.roles : { for arn in v.managed_policy_arns : "${k}|${arn}" => { role = k, arn = arn } }
  ]...)
  role       = aws_iam_role.this[each.value.role].name
  policy_arn = each.value.arn
}
