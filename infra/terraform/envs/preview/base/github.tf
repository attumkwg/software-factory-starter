# preview.yml / cleanup-previews.yml が使う役割。**この dev アカウントにだけ作る**。
#   AWS_PREVIEW_ROLE_ARN … PR(同じリポジトリのブランチからだけ。フォークの PR では動かさない)
# PR ごとの Terraform(envs/preview/pr)を apply / destroy できる範囲に絞る。

module "github_oidc" {
  source            = "../../../modules/github-oidc"
  github_repository = var.github_repository
  create_provider   = var.create_oidc_provider

  roles = {
    "preview-github" = {
      description = "preview.yml / cleanup-previews.yml: build image and apply/destroy per-PR env"
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
    resources = [aws_ecr_repository.api.arn]
  }
  statement {
    sid       = "Kms"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [aws_kms_key.preview.arn]
  }
  statement {
    sid = "PerPrResources"
    actions = [
      "ecs:*",
      "elasticloadbalancing:Describe*",
      "elasticloadbalancing:CreateTargetGroup", "elasticloadbalancing:DeleteTargetGroup",
      "elasticloadbalancing:ModifyTargetGroup", "elasticloadbalancing:ModifyTargetGroupAttributes",
      "elasticloadbalancing:CreateRule", "elasticloadbalancing:DeleteRule", "elasticloadbalancing:ModifyRule",
      "elasticloadbalancing:AddTags", "elasticloadbalancing:RemoveTags",
      "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret", "secretsmanager:PutSecretValue",
      "secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue", "secretsmanager:GetResourcePolicy",
      "secretsmanager:TagResource",
      "ec2:Describe*", "iam:GetRole", "logs:DescribeLogGroups", "logs:ListTagsForResource",
    ]
    #trivy:ignore:AVD-AWS-0057 PR ごとに名前の決まらない資源を作るため。dev アカウントだけに置き、本番には届かない
    resources = ["*"]
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
