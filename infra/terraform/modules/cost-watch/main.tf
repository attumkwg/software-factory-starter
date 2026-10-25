# 費用の見張り(アカウントごとに1回)。何にいくらかを分けて見るための土台と、急な変化の知らせ。docs/guides/cost-dashboard.md・ADR 0032
#   コスト配分タグ … 既定のタグ(Project・Environment・Component・Bet・PullRequest)を、Cost Explorer と請求で使えるようにする。
#                    タグが請求に出てから(リソースにタグが付いた翌日ごろ)でないと有効にできない → activate が true のときだけ。
#                    Organizations の中のアカウントなら、有効にするのは管理のアカウント(ここでは作らず、手引きの手順で)
#   Cost Anomaly Detection … このプロダクト(タグ Project)の費用が、いつもより急に増えたら SNS(→ Slack)に知らせる。
#                    「AWS のサービスごと」の見張りはアカウントに1つまでで、AWS が既定で作っていることがあるので、タグで絞った見張りにする
# 予算(AWS Budgets)は modules/alerts(今のまま)。費用: どちらも無料。

resource "aws_ce_cost_allocation_tag" "this" {
  for_each = var.activate ? toset(var.tag_keys) : toset([])
  tag_key  = each.value
  status   = "Active"
}

resource "aws_ce_anomaly_monitor" "this" {
  count        = var.anomaly_threshold_usd == null ? 0 : 1
  name         = "${var.name}-cost"
  monitor_type = "CUSTOM"
  monitor_specification = jsonencode({
    Tags = {
      Key          = "Project"
      Values       = [var.project]
      MatchOptions = ["EQUALS"]
    }
  })
}

resource "aws_ce_anomaly_subscription" "this" {
  count            = var.anomaly_threshold_usd == null ? 0 : 1
  name             = "${var.name}-cost"
  frequency        = "IMMEDIATE" # SNS に送るときは IMMEDIATE だけ
  monitor_arn_list = [aws_ce_anomaly_monitor.this[0].arn]

  subscriber {
    type    = "SNS"
    address = var.topic_arn
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.anomaly_threshold_usd)]
    }
  }
}
