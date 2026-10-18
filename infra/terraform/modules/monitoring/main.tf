# PMF の前から置いておく見張り(環境ごとに1つ)。鳴ったら modules/alerts の SNS → Slack へ。
# 鳴ったときにやることは docs/runbooks/alarms.md(アラームの名前ごと)。
#
#   何が                     どう見るか                                   いつ鳴る(既定)
#   ─────────────────────────────────────────────────────────────────────────────────────
#   タスクが足りない         ECS の RunningTaskCount(Container Insights)   決めた数を5分続けて下回る
#   タスクが落ち続ける       ECS のタスクの停止(EventBridge → ログ → 数)   15分に3回(落ちた理由はログに残る)
#   ALB の後ろが返事しない   UnHealthyHostCount(サービスごと)             5分続けて1つ以上
#   ALB 自身の 5xx           HTTPCode_ELB_5XX_Count(後ろに誰もいない等)    2分続けて 5回/分 以上
#   遅い                     TargetResponseTime の p95                     15分のうち10分 2秒超
#   DB が上限に張りつく      Aurora の ACUUtilization / CPUUtilization      15分続けて 90% / 80% 超
#   DB の切り替え・障害       RDS のイベント(failover / failure / 保守)      その都度
#   メールの評判             SES の Reputation.BounceRate / ComplaintRate   5% / 0.1% 以上(SES が止めるのは 10% / 0.5%)
#
# アプリの 5xx は ecs-service / web-service のアラーム(デプロイの自動の戻しにも使う)。
# 鳴った知らせだけでなく、戻った知らせ(OK)も同じ所へ流す。
#
# 月の費用: アラーム 1つ 約15円(式のアラームは使う数ぶん)。この一式で 1環境 約300〜450円。

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  actions = [var.topic_arn]
}

# ── ECS: タスクが足りない ───────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "running_tasks" {
  for_each            = var.services
  alarm_name          = "${var.name}-${each.key}-running-tasks"
  alarm_description   = "${each.key} の動いているタスクが ${each.value.min_running} を下回った。docs/runbooks/alarms.md#running-tasks"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = var.cluster_name, ServiceName = each.value.service_name }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = each.value.min_running
  comparison_operator = "LessThanThreshold"
  # 数字が来ない = 数えるタスクもいない
  treat_missing_data = "breaching"
  alarm_actions      = local.actions
  ok_actions         = local.actions
}

# ── ECS: タスクが落ち続ける ───────────────────────────────────────────────────
# デプロイで入れ替えたタスクは数えない。数えるのは、アプリが落ちた・起動できなかった・
# ヘルスチェックで外された、の3つ。1回なら ECS が立て直すので鳴らさない。

resource "aws_kms_key" "events_log" {
  description         = "${var.name} ECS task stops log"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Account"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${data.aws_region.current.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
      }
    ]
  })
}

# EventBridge から書けるのは /aws/events/ で始まる名前だけ
resource "aws_cloudwatch_log_group" "task_stops" {
  name              = "/aws/events/${var.name}/ecs-task-stops"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.events_log.arn
}

resource "aws_cloudwatch_log_resource_policy" "task_stops" {
  policy_name = "${var.name}-ecs-task-stops"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }
      Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource  = "${aws_cloudwatch_log_group.task_stops.arn}:*"
    }]
  })
}

resource "aws_cloudwatch_event_rule" "task_stops" {
  name        = "${var.name}-ecs-task-stops"
  description = "ECS tasks that crashed, failed to start, or failed health checks"
  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [var.cluster_arn]
      lastStatus = ["STOPPED"]
      "$or" = [
        { stopCode = ["EssentialContainerExited", "TaskFailedToStart"] },
        # 「Task failed ELB health checks」「Task failed container health checks」
        { stoppedReason = [{ prefix = "Task failed" }] },
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "task_stops" {
  rule = aws_cloudwatch_event_rule.task_stops.name
  arn  = aws_cloudwatch_log_group.task_stops.arn
}

resource "aws_cloudwatch_log_metric_filter" "task_stops" {
  name           = "${var.name}-ecs-task-stops"
  log_group_name = aws_cloudwatch_log_group.task_stops.name
  pattern        = "{ $.detail.lastStatus = \"STOPPED\" }"
  metric_transformation {
    name          = "TaskStops"
    namespace     = "${var.name}/ECS"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "task_stops" {
  alarm_name          = "${var.name}-task-stops"
  alarm_description   = "タスクが15分に${var.task_stops_threshold}回以上落ちた。理由はロググループ ${aws_cloudwatch_log_group.task_stops.name}。docs/runbooks/alarms.md#task-stops"
  namespace           = "${var.name}/ECS"
  metric_name         = "TaskStops"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = var.task_stops_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ── ALB ───────────────────────────────────────────────────────────────────────

# ALB の後ろのターゲットグループは blue と green の2つ。両方を足す(待機側は 0)
resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  for_each            = var.target_groups
  alarm_name          = "${var.name}-${each.key}-unhealthy-hosts"
  alarm_description   = "${each.key} のタスクが ALB のヘルスチェックに落ちている(API なら DB に届かない等)。docs/runbooks/alarms.md#unhealthy-hosts"
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions

  metric_query {
    id          = "total"
    expression  = join(" + ", [for i, _ in each.value : "FILL(tg${i}, 0)"])
    label       = "${each.key} unhealthy"
    return_data = true
  }
  dynamic "metric_query" {
    for_each = each.value
    content {
      id = "tg${metric_query.key}"
      metric {
        namespace   = "AWS/ApplicationELB"
        metric_name = "UnHealthyHostCount"
        stat        = "Maximum"
        period      = 60
        dimensions  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = metric_query.value }
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "elb_5xx" {
  alarm_name          = "${var.name}-elb-5xx"
  alarm_description   = "ALB 自身が 5xx を返している(後ろに動いているタスクがいない・つながらない)。docs/runbooks/alarms.md#elb-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "slow" {
  alarm_name          = "${var.name}-slow"
  alarm_description   = "応答の p95 が ${var.response_time_p95_seconds} 秒を超えている(画面と API の合計)。docs/runbooks/alarms.md#slow"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 15
  datapoints_to_alarm = 10
  threshold           = var.response_time_p95_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ── Aurora ────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "db_capacity" {
  alarm_name          = "${var.name}-db-capacity"
  alarm_description   = "Aurora が上限の容量(max_acu)に張りついている。遅くなる・つながらなくなる手前。docs/runbooks/alarms.md#db-capacity"
  namespace           = "AWS/RDS"
  metric_name         = "ACUUtilization"
  dimensions          = { DBClusterIdentifier = var.db_cluster_identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  # stg は使わない間 0 まで縮む(数字が来ない)
  treat_missing_data = "notBreaching"
  alarm_actions      = local.actions
  ok_actions         = local.actions
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${var.name}-db-cpu"
  alarm_description   = "Aurora の CPU が高い(重いクエリ・N+1・索引の抜け)。docs/runbooks/alarms.md#db-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBClusterIdentifier = var.db_cluster_identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# 切り替え(failover)・障害・保守の予定を、その都度知らせる
resource "aws_db_event_subscription" "cluster" {
  name             = "${var.name}-db-events"
  sns_topic        = var.topic_arn
  source_type      = "db-cluster"
  source_ids       = [var.db_cluster_identifier]
  event_categories = ["failover", "failure", "maintenance"]
}

# ── SES(メールの評判) ─────────────────────────────────────────────────────────
# 届かない宛先(バウンス)や迷惑メールの報告が増えると、SES がアカウントごと送れなくする。
# その手前で気づく。数字はアカウント全体のもの。

resource "aws_cloudwatch_metric_alarm" "ses_bounce" {
  count               = var.ses_enabled ? 1 : 0
  alarm_name          = "${var.name}-ses-bounce-rate"
  alarm_description   = "SES のバウンス率が 5% を超えた(10% で送れなくなる)。docs/runbooks/alarms.md#ses-reputation"
  namespace           = "AWS/SES"
  metric_name         = "Reputation.BounceRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.05
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "ses_complaint" {
  count               = var.ses_enabled ? 1 : 0
  alarm_name          = "${var.name}-ses-complaint-rate"
  alarm_description   = "SES の苦情率が 0.1% を超えた(0.5% で送れなくなる)。docs/runbooks/alarms.md#ses-reputation"
  namespace           = "AWS/SES"
  metric_name         = "Reputation.ComplaintRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.001
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}
