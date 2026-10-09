data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "${var.project}-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # Single source of the web security headers (also rendered into web/nginx.conf).
  web_security = jsondecode(file("${path.module}/../web/security-headers.json"))
  web_headers  = local.web_security.headers
  hsts_max_age = tonumber(regex("max-age=([0-9]+)", local.web_headers["Strict-Transport-Security"])[0])

  public_subnets  = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 10)]

  secret_names = ["jwt-secret", "csrf-secret", "refresh-pepper", "mfa-enc-key", "database-url", "redis-url", "redis-auth-token", "api-key-pepper"]
}
