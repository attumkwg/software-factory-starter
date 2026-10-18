# cp prod.example.tfvars prod.auto.tfvars(.gitignore 済み)して値を入れる。秘密は入れない。
state_bucket              = "<状態のバケット>"
app_domain                = "app.example.com"
route53_zone_id           = "<Route 53 のゾーン ID>"
image_repository_url      = "<stg のアカウント ID>.dkr.ecr.ap-northeast-1.amazonaws.com/sfs/api"
web_image_repository_url  = "<stg のアカウント ID>.dkr.ecr.ap-northeast-1.amazonaws.com/sfs/web"
mail_image_repository_url = "<stg のアカウント ID>.dkr.ecr.ap-northeast-1.amazonaws.com/sfs/mail"
# 見張りの知らせ(docs/guides/monitoring.md)。Slack は README「本人が手でやる設定」で許可してから
slack_team_id      = "<T で始まるワークスペースの ID>"
slack_channel_id   = "<C で始まる #alerts-prod の ID>"
monthly_budget_usd = 600
