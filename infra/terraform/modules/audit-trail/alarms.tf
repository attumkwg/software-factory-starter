# 記録から鳴らすアラーム(alarm_topic_arn があるときだけ)。どれも「起きたら1回で鳴らす」。
# 手順は docs/runbooks/audit-trail.md の 3。ほかの見張りを足すときも、この形(パターン → 数 → アラーム)で。

locals {
  alarm_patterns = {
    # root のアカウントが使われた(AWS のサービスが代わりに呼んだ物は除く)
    root-usage = {
      pattern     = "{ $.userIdentity.type = \"Root\" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != \"AwsServiceEvent\" }"
      description = "root のアカウントが使われた。本人か確かめる"
    }
    # 記録そのものを止める・変える・消す(痕跡を消す前に、まずここを触る)
    trail-changes = {
      pattern     = "{ ($.eventSource = \"cloudtrail.amazonaws.com\") && (($.eventName = \"StopLogging\") || ($.eventName = \"DeleteTrail\") || ($.eventName = \"UpdateTrail\") || ($.eventName = \"PutEventSelectors\") || ($.eventName = \"PutInsightSelectors\")) }"
      description = "管理操作の記録(CloudTrail)が止められた・変えられた"
    }
    # 記録のバケットの物を消す・ロックを変える・方針やライフサイクルを変える(governance を外す前に、まずここを触る)
    trail-bucket-changes = {
      pattern     = "{ ($.eventSource = \"s3.amazonaws.com\") && ($.requestParameters.bucketName = \"${aws_s3_bucket.this.id}\") && (($.eventName = \"DeleteObject\") || ($.eventName = \"DeleteObjects\") || ($.eventName = \"PutObjectRetention\") || ($.eventName = \"PutObjectLegalHold\") || ($.eventName = \"PutObjectLockConfiguration\") || ($.eventName = \"PutBucketPolicy\") || ($.eventName = \"DeleteBucketPolicy\") || ($.eventName = \"PutBucketLifecycle\") || ($.eventName = \"PutBucketVersioning\") || ($.eventName = \"DeleteBucket\")) }"
      description = "管理操作の記録のバケットで、物が消された・ロックや方針が変えられた"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "this" {
  for_each       = local.alarms
  name           = "${var.name}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.this.name
  pattern        = each.value.pattern
  metric_transformation {
    name          = each.key
    namespace     = "${var.name}/AuditTrail"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = "${each.value.description}。docs/runbooks/audit-trail.md の 3"
  namespace           = "${var.name}/AuditTrail"
  metric_name         = each.key
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  depends_on          = [aws_cloudwatch_log_metric_filter.this]
}
