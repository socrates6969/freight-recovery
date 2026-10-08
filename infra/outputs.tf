output "cloudfront_domain_name" {
  description = "CloudFront distribution domain (point the app_domain DNS record here)."
  value       = aws_cloudfront_distribution.main.domain_name
}

output "alb_dns_name" {
  description = "ALB DNS name (origin for /api/*)."
  value       = aws_lb.main.dns_name
}

output "rds_endpoint" {
  description = "RDS endpoint (private)."
  value       = aws_db_instance.main.address
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint (private, TLS)."
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "documents_bucket" {
  description = "Documents bucket name."
  value       = aws_s3_bucket.documents.bucket
}

output "static_bucket" {
  description = "Static site bucket name (upload web/dist here)."
  value       = aws_s3_bucket.static.bucket
}

output "secret_arns" {
  description = "Secret containers whose values must be set out of band."
  value       = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}
