# GitHub Actions が使う役割(OIDC)。値は GitHub の変数に入れる(README の「本人がやる設定」)。
#   AWS_STG_DEPLOY_ROLE_ARN … deploy.yml(environment: stg のジョブだけが使える)
#   AWS_STG_PLAN_ROLE_ARN   … terraform-plan.yml の plan(読むだけ)。PR と main から
#     PR の版のワークフローでも引けるので、ブランチを作れる人は stg の設定と状態ファイルを読める
#     (状態ファイルには stg の秘密の値が入る)。stg は試しのデータだけ・本番とアカウントが別、なので
#     PR の plan はここで受ける。中身(ログの本文・利用者など)は deny_data_reads で読ませない。
#   AWS_STG_COGNITO_CONTRACT_ROLE_ARN … cognito-contract.yml(stg のユーザープールに試しの人を作って消すだけ)
#   AWS_STG_RESTORE_DRILL_ROLE_ARN    … restore-drill.yml(stg の DB を一時の DB に時点復元して、確かめて、消すだけ)

module "github_oidc" {
  source            = "../../modules/github-oidc"
  github_repository = var.github_repository
  create_provider   = var.create_oidc_provider

  roles = {
    "${local.name}-deploy" = {
      description = "deploy.yml: push images, run migration, update ECS services (api, web)"
      subjects    = ["environment:${local.env}"]
      policy_json = data.aws_iam_policy_document.deploy.json
    }
    "${local.name}-cognito-contract" = {
      description = "cognito-contract.yml: create and delete test users in the stg user pool"
      subjects    = ["ref:refs/heads/main"]
      policy_json = data.aws_iam_policy_document.cognito_contract.json
    }
    "${local.name}-restore-drill" = {
      description = "restore-drill.yml: restore the stg DB to a temporary cluster, check it, and delete it"
      subjects    = ["ref:refs/heads/main"]
      policy_json = data.aws_iam_policy_document.restore_drill.json
    }
    "${local.name}-plan" = {
      description         = "terraform-plan.yml: plan only (read)"
      subjects            = ["pull_request", "ref:refs/heads/main"]
      managed_policy_arns = ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
      policy_json         = data.aws_iam_policy_document.plan_state.json
      deny_data_reads     = { except_s3_objects = ["arn:aws:s3:::${var.state_bucket}/${local.env}/*"] }
    }
    "${local.name}-cost" = {
      description = "cost.yml (main only): read Cost Explorer"
      subjects    = ["ref:refs/heads/main"]
      policy_json = data.aws_iam_policy_document.cost.json
    }
  }
}

data "aws_iam_policy_document" "deploy" {
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
    sid       = "EcrKms"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.app.arn]
  }
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
      module.app.execution_role_arn, module.app.task_role_arn,
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
    sid       = "RefreshManagedSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.session.arn, module.aurora.database_url_secret_arn, module.ses.smtp_credentials_secret_arn]
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

# 契約テスト(packages/fake-cognito/contract)が、試しの人を確認済みにする・消す・設定を読むためだけの権限
data "aws_iam_policy_document" "cognito_contract" {
  statement {
    sid = "TestUsersInStgPool"
    actions = [
      "cognito-idp:AdminConfirmSignUp",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:DescribeUserPool",
    ]
    resources = [aws_cognito_user_pool.this.arn]
  }
}

# 戻す訓練(restore-drill.yml)。触れるのは名前が「<名前>-restore-drill-」で始まる一時の DB だけ。
# 元の DB は「復元の元にする」以外は何もできない(読む・書く・消す・変える、のどれもできない)。
locals {
  drill_prefix = "${module.aurora.cluster_identifier}-restore-drill-"
  rds_arn      = "arn:aws:rds:${var.region}:${data.aws_caller_identity.current.account_id}"
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "restore_drill" {
  statement {
    sid     = "RestoreFromStgCluster"
    actions = ["rds:RestoreDBClusterToPointInTime"]
    resources = [
      module.aurora.cluster_arn,
      "${local.rds_arn}:cluster:${local.drill_prefix}*",
      "${local.rds_arn}:subgrp:*",
      "${local.rds_arn}:cluster-pg:*",
    ]
  }
  statement {
    sid = "ManageDrillClusterOnly"
    actions = [
      "rds:CreateDBInstance", "rds:DeleteDBInstance", "rds:DeleteDBCluster", "rds:ModifyDBCluster",
      "rds:AddTagsToResource",
    ]
    resources = [
      "${local.rds_arn}:cluster:${local.drill_prefix}*",
      "${local.rds_arn}:db:${local.drill_prefix}*",
    ]
  }
  statement {
    sid     = "Describe"
    actions = ["rds:DescribeDBClusters", "rds:DescribeDBInstances", "ec2:DescribeSecurityGroups", "ec2:DescribeSubnets", "ec2:DescribeVpcs"]
    #trivy:ignore:AVD-AWS-0057 一覧の読み取りはリソースを絞れない(AWS の仕様)
    resources = ["*"]
  }
  statement {
    sid       = "UseDbKey"
    actions   = ["kms:CreateGrant", "kms:DescribeKey", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.aurora.kms_key_arn]
  }
  # 一時の DB の管理者のパスワード(RDS が作る秘密)を、Data API で SQL を流すためだけに読む
  statement {
    sid       = "DrillSecretOnly"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = ["arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:rds!cluster-*"]
    condition {
      test     = "StringLike"
      variable = "secretsmanager:ResourceTag/aws:rds:primaryDBClusterArn"
      values   = ["${local.rds_arn}:cluster:${local.drill_prefix}*"]
    }
  }
  # 管理者のパスワードを RDS に作らせる(modify-db-cluster --manage-master-user-password)・消す
  statement {
    sid       = "RdsManagedSecret"
    actions   = ["secretsmanager:CreateSecret", "secretsmanager:TagResource", "secretsmanager:RotateSecret", "secretsmanager:DeleteSecret"]
    resources = ["arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:rds!cluster-*"]
  }
  statement {
    sid       = "DataApiOnDrillCluster"
    actions   = ["rds-data:ExecuteStatement"]
    resources = ["${local.rds_arn}:cluster:${local.drill_prefix}*"]
  }
}

# ── 費用を読む(cost.yml。毎日・有効にしたら)。docs/guides/cost-dashboard.md・ADR 0032 ─────────────
#   AWS_<環境>_COST_ROLE_ARN … github_role_arns の …-cost。main のコードからだけ引ける(PR の版は書き換えられるので、請求の詳細を読ませない)
#   Cost Explorer の集計を読むだけ。1回 $0.01 なので、呼ぶ回数は scripts/cost が決める(1日 6回まで)

data "aws_iam_policy_document" "cost" {
  statement {
    sid     = "ReadCost"
    actions = ["ce:GetCostAndUsage", "ce:GetCostForecast"]
    #trivy:ignore:AVD-AWS-0057 Cost Explorer はリソースを絞れない(AWS の仕様)。読むのは金額の集計だけ
    resources = ["*"]
  }
}
