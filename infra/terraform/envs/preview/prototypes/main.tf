# 確かめるための試作の置き場所(dev 用の AWS アカウント。人が1回だけ apply する)。
# プレビュー環境の土台(envs/preview/base)とは別に立てられる(NAT・ALB が要らないので、こちらだけなら月 0〜数十円)。
#
#   https://<CloudFront>/<賭けの ID>/ → 合言葉 → S3(非公開)
#
# 立てたあと: 合言葉を KeyValueStore に入れる・GitHub の変数を3つ入れる(docs/guides/prototypes.md の「AWS に置く」)。

module "site" {
  source = "../../../modules/prototype-site"
  name   = "${var.project}-prototypes"
}
