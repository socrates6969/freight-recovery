# Regional WAF on the ALB: AWS managed rule groups, an IP rate limit, and a request-size rule.
# Note: for ALBs, WAF inspects at most the first 8 KB of a body, so the size limit is enforced on the
# declared Content-Length (regex below encodes > 65536 = var.body_limit_bytes) and, authoritatively,
# by the API's own BODY_LIMIT_BYTES. The Common rule set's 8 KB body rule is set to COUNT so legitimate
# demand-letter edits (up to 20000 characters) are not blocked.

resource "aws_wafv2_regex_pattern_set" "oversized_content_length" {
  name        = "${local.name}-oversized-content-length"
  description = "Content-Length values greater than 65536"
  scope       = "REGIONAL"

  regular_expression {
    regex_string = "^(6553[7-9]|655[4-9][0-9]|65[6-9][0-9]{2}|6[6-9][0-9]{3}|[7-9][0-9]{4}|[1-9][0-9]{5,})$"
  }
}

resource "aws_wafv2_web_acl" "alb" {
  name        = "${local.name}-alb"
  description = "Freight Recovery API protections"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "body-size-limit"
    priority = 0

    action {
      block {}
    }

    statement {
      regex_pattern_set_reference_statement {
        arn = aws_wafv2_regex_pattern_set.oversized_content_length.arn
        field_to_match {
          single_header {
            name = "content-length"
          }
        }
        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "body-size-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "ip-rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

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
      metric_name                = "aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-alb"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}
