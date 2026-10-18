# cp stg.example.tfvars stg.auto.tfvars(.gitignore 済み)して値を入れる。秘密は入れない。
state_bucket           = "<状態のバケット>"
app_domain             = "app.stg.example.com"
route53_zone_id        = "<Route 53 のゾーン ID>"
image_pull_account_ids = ["<prod のアカウント ID>"]
