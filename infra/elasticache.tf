# Redis (rate-limit store): private, encrypted at rest (data CMK) and in transit, AUTH token.
# The AUTH token is NEVER read by Terraform (so it never lands in state or plan output): an operator
# generates it, stores it in the `redis-auth-token` / `redis-url` secrets, and sets it on the
# replication group out of band (see README.md). Terraform ignores the attribute afterwards. The ECS
# task only references the `redis-url` secret by ARN.

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Redis: only from the API tasks"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_api" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "Redis from API tasks"
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${local.name}-redis"
  description                = "${local.name} rate-limit store"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  transit_encryption_enabled = true
  snapshot_retention_limit   = 1

  lifecycle {
    # Set out of band with `aws elasticache modify-replication-group --auth-token ... --auth-token-update-strategy SET`.
    ignore_changes = [auth_token]
  }
}
