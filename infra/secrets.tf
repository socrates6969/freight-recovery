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
