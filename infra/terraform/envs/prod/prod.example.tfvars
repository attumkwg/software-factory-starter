# cp prod.example.tfvars prod.auto.tfvars(.gitignore 済み)して値を入れる。秘密は入れない。
state_bucket             = "<状態のバケット>"
app_domain               = "app.example.com"
route53_zone_id          = "<Route 53 のゾーン ID>"
image_repository_url     = "<stg のアカウント ID>.dkr.ecr.ap-northeast-1.amazonaws.com/sfs/api"
web_image_repository_url = "<stg のアカウント ID>.dkr.ecr.ap-northeast-1.amazonaws.com/sfs/web"
alarm_topic_arns         = ["<SNS のトピックの ARN>"]
