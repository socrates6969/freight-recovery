# Secret CONTAINERS only. Values are set out of band (never in Terraform code or variables):
#   aws secretsmanager put-secret-value --secret-id <name> --secret-string "$(openssl rand -base64 48)"
# database-url must use the freight_app role and sslmode=verify-full; redis-url must be rediss://.

resource "aws_secretsmanager_secret" "app" {
  for_each                = toset(local.secret_names)
  name                    = "${local.name}/${each.value}"
  description             = "Freight Recovery web API: ${each.value}"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}

# Fix round 1 (C11.3): the CloudFront -> ALB origin-verify value (also the API's ORIGIN_VERIFY_SECRET). Container
# only: no secret version resource; the value is set and rotated out of band (README.md, deploy gate).
resource "aws_secretsmanager_secret" "origin_verify" {
  name                    = "${local.name}/origin-verify-secret"
  description             = "Freight Recovery: CloudFront origin-verify header value"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}
