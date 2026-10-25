# GitHub Actions が使う役割(OIDC)。
#   AWS_PROD_DEPLOY_ROLE_ARN … deploy.yml の prod ジョブ(environment: prod の承認のあとだけ)
#   AWS_PROD_PLAN_ROLE_ARN   … terraform-plan.yml の plan(読むだけ)。**main のコードからだけ**
#     PR からは引けない(PR の版のワークフローは書き換えられるので、ブランチを作れる人なら誰でも
#     本番の設定と状態ファイル(秘密の値が入っている)を読めてしまう)。PR での plan は stg だけ。
# イメージは stg の ECR から引くので、ここには push の権限は無い。

module "github_oidc" {
  source            = "../../modules/github-oidc"
  github_repository = var.github_repository
  create_provider   = var.create_oidc_provider

  roles = {
    "${local.name}-deploy" = {
      description = "deploy.yml (prod, after approval): run migration, update ECS services (api, web)"
      subjects    = ["environment:${local.env}"]
      policy_json = data.aws_iam_policy_document.deploy.json
    }
    "${local.name}-plan" = {
      description         = "terraform-plan.yml: plan only (read), from main only"
      subjects            = ["ref:refs/heads/main"]
      managed_policy_arns = ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
      policy_json         = data.aws_iam_policy_document.plan_state.json
      deny_data_reads     = { except_s3_objects = ["arn:aws:s3:::${var.state_bucket}/${local.env}/*"] }
    }
  }
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "EcsDeploy"
    actions = [
      "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition", "ecs:DescribeServices",
      "ecs:UpdateService", "ecs:RunTask", "ecs:DescribeTasks", "ecs:DescribeServiceDeployments",
      "ecs:ListServiceDeployments",
    ]
    #trivy:ignore:AVD-AWS-0057 タスク定義の登録はリソースを絞れない(AWS の仕様)
    resources = ["*"]
  }
  statement {
    sid     = "PassTaskRoles"
    actions = ["iam:PassRole"]
    resources = [
      module.app.execution_role_arn, module.app.task_role_arn, module.app.migrate_task_role_arn,
      module.web.execution_role_arn, module.web.task_role_arn,
      module.mail.execution_role_arn, module.mail.task_role_arn,
    ]
  }
}

data "aws_iam_policy_document" "plan_state" {
  statement {
    sid       = "StateRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.state_bucket}", "arn:aws:s3:::${var.state_bucket}/${local.env}/*"]
  }
  statement {
    sid       = "StateLock"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.state_bucket}/${local.env}/*.tflock"]
  }
  # Terraform が値を持つ秘密は、plan のときに今の値と比べる(GetSecretValue。ReadOnlyAccess に無い)。
  # 同じ値は状態ファイルにも入っているので、読める範囲は広がらない
  statement {
    sid     = "RefreshManagedSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [aws_secretsmanager_secret.session.arn, module.aurora.database_url_secret_arn, module.ses.smtp_credentials_secret_arn],
      [for m in module.sensitive_data : m.database_url_secret_arn],
    )
  }
  statement {
    sid       = "DecryptManagedSecrets"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.app.arn, module.aurora.kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}
