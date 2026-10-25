# GitHub Actions が使う役割(OIDC)。
#   AWS_PROD_DEPLOY_ROLE_ARN … deploy.yml の prod ジョブ(environment: prod の承認のあとだけ)
#   AWS_PROD_PLAN_ROLE_ARN   … terraform-plan.yml の plan(読むだけ)。**main のコードからだけ**
#     PR からは引けない(PR の版のワークフローは書き換えられるので、ブランチを作れる人なら誰でも
#     本番の設定と状態ファイル(秘密の値が入っている)を読めてしまう)。PR での plan は stg だけ。
#   AWS_EVIDENCE_ROLE_ARN    … evidence.yml(毎月の証跡)。main のコードからだけ。下の「証跡を集める」
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
    "${local.name}-evidence" = {
      description = "evidence.yml (monthly, main only): read settings, put evidence into the locked bucket"
      subjects    = ["ref:refs/heads/main"]
      policy_json = data.aws_iam_policy_document.evidence.json
    }
    "${local.name}-cost" = {
      description = "cost.yml (environment cost, main only): read Cost Explorer"
      subjects    = ["environment:cost"]
      policy_json = data.aws_iam_policy_document.cost.json
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

# ── 証跡を集める(evidence.yml。毎月)。ADR 0032・docs/compliance/README.md ─────────────────
#   AWS_EVIDENCE_ROLE_ARN … github_role_arns の …-evidence(上の roles)。**main のコードからだけ**(PR の版は書き換えられるので、偽の証跡を置かせない)
#   設定を読むだけ(データは読まない)+証跡の置き場(Object Lock)へ足すだけ。消す・上書きの前の版を消す権限は無い

data "aws_iam_policy_document" "evidence" {
  statement {
    sid = "ReadSettings"
    actions = [
      "iam:GetAccountSummary", "iam:GenerateCredentialReport", "iam:GetCredentialReport", "iam:ListRoles",
      "securityhub:GetFindings", "guardduty:ListDetectors", "guardduty:GetDetector",
      "backup:ListBackupVaults", "cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus",
    ]
    #trivy:ignore:AVD-AWS-0057 設定の読み取り(一覧・要約)はリソースを絞れない(AWS の仕様)。データは読まない
    resources = ["*"]
  }
  statement {
    sid       = "PutEvidence"
    actions   = ["s3:PutObject"]
    resources = ["${module.evidence.bucket_arn}/evidence/*"]
  }
  statement {
    sid       = "EncryptEvidence"
    actions   = ["kms:GenerateDataKey", "kms:Encrypt"]
    resources = [module.evidence.kms_key_arn]
  }
}

# ── 費用を読む(cost.yml。毎日・有効にしたら)。docs/guides/cost-dashboard.md・ADR 0032 ─────────────
#   AWS_<環境>_COST_ROLE_ARN … github_role_arns の …-cost。Environment「cost」(main だけ)のジョブからだけ引ける
#   Cost Explorer の集計を読むだけ+費用のページの置き場へ書くだけ。1回 $0.01 なので、呼ぶ回数は scripts/cost が決める(1日 6回まで)

data "aws_iam_policy_document" "cost" {
  statement {
    sid     = "ReadCost"
    actions = ["ce:GetCostAndUsage", "ce:GetCostForecast"]
    #trivy:ignore:AVD-AWS-0057 Cost Explorer はリソースを絞れない(AWS の仕様)。読むのは金額の集計だけ
    resources = ["*"]
  }
  statement {
    sid       = "PutCostPage"
    actions   = ["s3:PutObject"]
    resources = ["${module.cost_reports.bucket_arn}/cost/*"]
  }
  statement {
    sid       = "EncryptCostPage"
    actions   = ["kms:GenerateDataKey", "kms:Encrypt"]
    resources = [module.cost_reports.kms_key_arn]
  }
}
