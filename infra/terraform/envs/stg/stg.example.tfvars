# cp stg.example.tfvars stg.auto.tfvars(.gitignore 済み)して値を入れる。秘密は入れない。
state_bucket           = "<状態のバケット>"
app_domain             = "app.stg.example.com"
route53_zone_id        = "<Route 53 のゾーン ID>"
image_pull_account_ids = ["<prod のアカウント ID>"]
# 見張りの知らせ(docs/guides/monitoring.md)。Slack は README「本人が手でやる設定」で許可してから
slack_team_id      = "<T で始まるワークスペースの ID>"
slack_channel_id   = "<C で始まる #alerts-stg の ID>"
monthly_budget_usd = 250
