# ALB の前に置く WAF(AWS WAF v2)。型どおりの攻撃(SQL インジェクション・既知の悪い入力・悪い IP)と、
# 1つの IP からの大量のリクエストを止める。業務の穴(他社のデータが見える等)は止められない(docs/security.md)。
#
# 月の費用の目安(東京・2026-10 時点の定価から。公式の料金表で確かめること):
#   Web ACL 1つ $5 + ルール(AWS の管理ルールのまとまりも1つずつ数える)$1 × 4 + リクエスト 100万ごとに $0.60
#   → 少ない量なら 月 約1,500〜2,000円。ログ(CloudWatch Logs)は量に比例。
# 最初は count(数えるだけ)で入れて誤検知を見てから block にするなら、var.mode = "count"。

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "ALB in front of ${var.name}"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      dynamic "none" {
        for_each = var.mode == "block" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.mode == "count" ? [1] : []
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # 本文の大きさの制限(8KB)は API の正しい大きな本文も止めることがあるので数えるだけ
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20
    override_action {
      dynamic "none" {
        for_each = var.mode == "block" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.mode == "count" ? [1] : []
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 30
    override_action {
      dynamic "none" {
        for_each = var.mode == "block" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.mode == "count" ? [1] : []
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-aws-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # 1つの IP から5分に rate_limit を超えたら止める(1社の暴走・総当たりの手前の守り)
  rule {
    name     = "rate-limit-per-ip"
    priority = 40
    action {
      dynamic "block" {
        for_each = var.mode == "block" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.mode == "count" ? [1] : []
        content {}
      }
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

# WAF のログ(名前は aws-waf-logs- で始める決まり)。Cookie と Authorization は伏せる
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
}
