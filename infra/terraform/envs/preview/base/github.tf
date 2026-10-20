# preview.yml / cleanup-previews.yml が使う役割。**この dev アカウントにだけ作る**。
#   AWS_PREVIEW_ROLE_ARN … PR(同じリポジトリのブランチからだけ。フォークの PR では動かさない)
# PR ごとの Terraform(envs/preview/pr)を apply / destroy できる範囲に絞る(名前が preview-pr-* の物だけ)。
# PR の版のワークフローでも引けるので、この役割で届くものは「PR を出せる人なら誰でも触れる」と考える。

module "github_oidc" {
  source            = "../../../modules/github-oidc"
  github_repository = var.github_repository
  create_provider   = var.create_oidc_provider

  roles = {
    "preview-github" = {
      description = "preview.yml / cleanup-previews.yml: build images and apply/destroy per-PR env"
      # PR のジョブと、毎晩の掃除(main の schedule)から
      subjects    = ["pull_request", "ref:refs/heads/main"]
      policy_json = data.aws_iam_policy_document.preview.json
    }
  }
}

data "aws_iam_policy_document" "preview" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart", "ecr:DescribeImages",
    ]
    resources = [for r in aws_ecr_repository.this : r.arn]
  }
  statement {
    sid       = "Kms"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [aws_kms_key.preview.arn]
  }
  # 名前の決まらない物(一覧・登録)だけを * に。dev アカウントの中でも、PR の物(preview-pr-*)の
  # ほかは作る・変える・消すができないように、名前で絞る(ECS Exec や RunTask も渡さない)
  statement {
    sid = "ReadAndRegister"
    actions = [
      "ecs:DescribeClusters", "ecs:ListServices", "ecs:ListTasks", "ecs:DescribeTasks",
      "ecs:DescribeTaskDefinition", "ecs:ListTaskDefinitions",
      "ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition", "ecs:ListTagsForResource",
      "elasticloadbalancing:Describe*",
      "ec2:Describe*", "logs:DescribeLogGroups", "logs:ListTagsForResource",
    ]
    #trivy:ignore:AVD-AWS-0057 一覧とタスク定義の登録はリソースを絞れない(AWS の仕様)。dev アカウントだけに置く
    resources = ["*"]
  }
  statement {
    sid = "PerPrEcsService"
    actions = [
      "ecs:CreateService", "ecs:UpdateService", "ecs:DeleteService", "ecs:DescribeServices",
      "ecs:TagResource", "ecs:UntagResource",
    ]
    resources = [
      "arn:aws:ecs:${var.region}:${local.account_id}:service/${aws_ecs_cluster.this.name}/preview-pr-*",
      "arn:aws:ecs:${var.region}:${local.account_id}:task-definition/preview-pr-*:*",
    ]
  }
  statement {
    sid = "PerPrTargetGroups"
    actions = [
      "elasticloadbalancing:CreateTargetGroup", "elasticloadbalancing:DeleteTargetGroup",
      "elasticloadbalancing:ModifyTargetGroup", "elasticloadbalancing:ModifyTargetGroupAttributes",
      "elasticloadbalancing:AddTags", "elasticloadbalancing:RemoveTags",
    ]
    resources = ["arn:aws:elasticloadbalancing:${var.region}:${local.account_id}:targetgroup/preview-pr-*/*"]
  }
  # 共有の ALB(preview)の HTTPS の受け口に、ルールを足す・消すだけ
  statement {
    sid = "PerPrListenerRules"
    actions = [
      "elasticloadbalancing:CreateRule", "elasticloadbalancing:DeleteRule", "elasticloadbalancing:ModifyRule",
      "elasticloadbalancing:AddTags", "elasticloadbalancing:RemoveTags",
    ]
    resources = [
      aws_lb_listener.https.arn,
      "arn:aws:elasticloadbalancing:${var.region}:${local.account_id}:listener-rule/app/${aws_lb.this.name}/*",
    ]
  }
  # PR ごとのセッションの秘密(preview-pr-<番号>/…)だけ。ほかの秘密は読めない
  statement {
    sid = "PerPrSecrets"
    actions = [
      "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret", "secretsmanager:PutSecretValue",
      "secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue", "secretsmanager:GetResourcePolicy",
      "secretsmanager:TagResource",
    ]
    resources = ["arn:aws:secretsmanager:${var.region}:${local.account_id}:secret:preview-pr-*"]
  }
  statement {
    sid       = "ReadTaskRoles"
    actions   = ["iam:GetRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
  }
  statement {
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
  }
  statement {
    sid       = "State"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.state_bucket}", "arn:aws:s3:::${var.state_bucket}/preview/*"]
  }
}

locals {
  account_id = data.aws_caller_identity.current.account_id
}
