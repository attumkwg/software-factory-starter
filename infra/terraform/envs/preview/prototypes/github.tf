# prototypes.yml が使う役割。**この dev アカウントにだけ作る**。
#   AWS_PROTOTYPES_ROLE_ARN … 試作のバケットに置く・消すだけ(ほかのバケット・CloudFront・合言葉には触れない)
# PR の版のワークフローでも引けるので、この役割で届くものは「PR を出せる人なら誰でも触れる」と考える
# (届くのは、偽のデータだけの試作の置き場所だけ)。

module "github_oidc" {
  source            = "../../../modules/github-oidc"
  github_repository = var.github_repository
  create_provider   = var.create_oidc_provider

  roles = {
    "prototypes-github" = {
      description = "prototypes.yml: upload and delete prototypes in the prototypes bucket only"
      # PR(同じリポジトリのブランチ)と、main に入ったとき(閉じた賭けの試作を消す)
      subjects    = ["pull_request", "ref:refs/heads/main"]
      policy_json = data.aws_iam_policy_document.prototypes.json
    }
  }
}

data "aws_iam_policy_document" "prototypes" {
  statement {
    sid       = "ListPrototypes"
    actions   = ["s3:ListBucket"]
    resources = [module.site.bucket_arn]
  }
  statement {
    sid       = "PutAndDeletePrototypes"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.site.bucket_arn}/B-*"]
  }
}
