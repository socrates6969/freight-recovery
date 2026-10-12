# Internet-facing ALB reachable only from CloudFront's origin-facing ranges; HTTP redirects to HTTPS;
# TLS 1.3/1.2 policy; invalid header fields dropped; access logs to the log bucket.

data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "ALB: HTTPS/HTTP from CloudFront origin-facing ranges only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS from CloudFront"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP from CloudFront (redirected to HTTPS)"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
  description                  = "To API tasks"
}

resource "aws_lb" "main" {
  name                       = "${local.name}-alb"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 30

  access_logs {
    bucket  = aws_s3_bucket.logs.id
    prefix  = "alb"
    enabled = true
  }

  depends_on = [aws_s3_bucket_policy.logs]
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn

  # Fix round 1 (C11.2): nothing is served without the CloudFront origin-verify header.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

# Fix round 1 (C11.2): forward to the API only when x-origin-verify matches (up to two values during rotation) and
# the Host is the app domain.
# Fix round 2 (C-FR2.3a, H-2): the committed placeholder must never reach the API. Terraform creates this rule with
# a fixed 403 action, so a request carrying the placeholder value gets the same 403 as the default action; the
# rotation procedure (README.md) sets the real value(s) and switches the action to forward to the API target group.
# A replaced rule therefore fails closed (403) until the procedure is run again.
# Fix round 2 (C-FR2.3c): the API origin request policy forwards the viewer Host (CloudFront validates the ALB
# certificate against it), so the rule also requires Host = var.app_domain and the listener certificate is checked.
resource "aws_lb_listener_rule" "api_from_cloudfront" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  condition {
    http_header {
      http_header_name = "x-origin-verify"
      values           = [local.origin_verify_placeholder]
    }
  }

  condition {
    host_header {
      values = [var.app_domain]
    }
  }

  # The real header values and the forward action are set out of band by the rotation procedure (README.md).
  lifecycle {
    ignore_changes = [condition, action]

    precondition {
      condition     = data.aws_acm_certificate.alb_app_domain.arn == var.alb_certificate_arn
      error_message = "alb_certificate_arn must be the issued ACM certificate for app_domain (CloudFront forwards the viewer Host and validates the ALB certificate against it)."
    }
  }
}

# Fix round 2 (C-FR2.3c): the issued certificate whose domain is var.app_domain (read at plan time, never by validate).
data "aws_acm_certificate" "alb_app_domain" {
  domain      = var.app_domain
  statuses    = ["ISSUED"]
  most_recent = true
}
