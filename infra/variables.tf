variable "project" {
  description = "Short project name used in resource names."
  type        = string
  default     = "freight-recovery"
}

variable "environment" {
  description = "Environment name (e.g. staging, production)."
  type        = string
  default     = "staging"
}

variable "region" {
  description = "AWS region for regional resources."
  type        = string
  default     = "eu-north-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block."
  type        = string
  default     = "10.40.0.0/16"
}

variable "app_domain" {
  description = "Public hostname of the web app (CloudFront alias), e.g. app.example.com."
  type        = string
  default     = "app.example.com"
}

variable "cloudfront_certificate_arn" {
  description = "ACM certificate ARN in us-east-1 for the CloudFront alias."
  type        = string
  default     = "arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000"
}

variable "alb_certificate_arn" {
  description = "ACM certificate ARN (same region) for the ALB HTTPS listener."
  type        = string
  default     = "arn:aws:acm:eu-north-1:000000000000:certificate/00000000-0000-0000-0000-000000000000"
}

variable "api_image" {
  description = "API container image, pinned by digest (ECR repository URI @sha256:...)."
  type        = string
  default     = "000000000000.dkr.ecr.eu-north-1.amazonaws.com/freight-recovery-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
}

variable "api_ecr_repository_arn" {
  description = "ARN of the ECR repository holding the API image (execution role may pull only from it)."
  type        = string
  default     = "arn:aws:ecr:eu-north-1:000000000000:repository/freight-recovery-api"
}

variable "api_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Number of API tasks."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "RDS storage (GiB)."
  type        = number
  default     = 50
}

variable "db_multi_az" {
  description = "Run RDS Multi-AZ."
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "RDS automated backup retention (days, minimum 14)."
  type        = number
  default     = 14

  validation {
    condition     = var.db_backup_retention_days >= 14
    error_message = "Backups must be kept for at least 14 days."
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "log_retention_days" {
  description = "CloudWatch log retention (days)."
  type        = number
  default     = 90
}

variable "hsts_max_age_seconds" {
  description = "HSTS max-age emitted by the API."
  type        = number
  default     = 31536000
}

variable "body_limit_bytes" {
  description = "Maximum request body size; must match the API BODY_LIMIT_BYTES. The WAF Content-Length rule encodes this value."
  type        = number
  default     = 65536

  validation {
    condition     = var.body_limit_bytes == 65536
    error_message = "The WAF Content-Length regex in waf.tf is written for 65536 bytes; update both together."
  }
}

variable "waf_rate_limit_per_5min" {
  description = "WAF rate-based rule: max requests per IP per 5 minutes."
  type        = number
  default     = 2000
}
