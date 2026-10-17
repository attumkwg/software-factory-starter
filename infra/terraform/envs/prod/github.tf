# GitHub Actions が使う役割(OIDC)。
#   AWS_PROD_DEPLOY_ROLE_ARN … deploy.yml の prod ジョブ(environment: prod の承認のあとだけ)
#   AWS_PROD_PLAN_ROLE_ARN   … terraform.yml の plan(読むだけ)
# イメージは stg の ECR から引くので、ここには push の権限は無い。

module "github_oidc" {
  source            = "../../modules/github-oidc"
  github_repository = var.github_repository
  create_provider   = var.create_oidc_provider

  roles = {
    "${local.name}-deploy" = {
      description = "deploy.yml (prod, after approval): run migration, update ECS service"
      subjects    = ["environment:${local.env}"]
      policy_json = data.aws_iam_policy_document.deploy.json
    }
    "${local.name}-plan" = {
      description         = "terraform.yml: plan only (read)"
      subjects            = ["pull_request", "ref:refs/heads/main"]
      managed_policy_arns = ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
      policy_json         = data.aws_iam_policy_document.plan_state.json
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
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [module.app.execution_role_arn, module.app.task_role_arn]
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
}
