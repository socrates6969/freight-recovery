# ECS Fargate service for the API: private subnets, read-only root filesystem, non-root user,
# all Linux capabilities dropped, secrets injected from Secrets Manager, KMS-encrypted logs.

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}/api"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "API tasks: HTTP from the ALB only; egress to DB, Redis and VPC endpoints"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
  description                  = "API port from the ALB"
}

resource "aws_vpc_security_group_egress_rule" "api_to_db" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL"
}

resource "aws_vpc_security_group_egress_rule" "api_to_redis" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.redis.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "Redis"
}

resource "aws_vpc_security_group_egress_rule" "api_to_endpoints" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.endpoints.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  description                  = "Interface VPC endpoints"
}

resource "aws_vpc_security_group_egress_rule" "api_to_s3" {
  security_group_id = aws_security_group.api.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "S3 gateway endpoint"
}

locals {
  api_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "HOST", value = "0.0.0.0" },
    { name = "PORT", value = "3001" },
    { name = "APP_ORIGIN", value = "https://${var.app_domain}" },
    { name = "COOKIE_SECURE", value = "true" },
    { name = "HSTS_MAX_AGE_SECONDS", value = tostring(var.hsts_max_age_seconds) },
    { name = "BODY_LIMIT_BYTES", value = tostring(var.body_limit_bytes) },
    { name = "TRUST_PROXY", value = var.vpc_cidr },
    # SES is NOT implemented (SesMailer is a stub). The API's production config refuses every
    # unimplemented MAIL_TRANSPORT, so this task will not start until a real transport exists.
    { name = "MAIL_TRANSPORT", value = "ses" },
    { name = "S3_REGION", value = var.region },
    { name = "S3_BUCKET", value = aws_s3_bucket.documents.bucket },
    { name = "LOG_LEVEL", value = "info" },
  ]

  api_secrets = [
    { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.app["jwt-secret"].arn },
    { name = "CSRF_SECRET", valueFrom = aws_secretsmanager_secret.app["csrf-secret"].arn },
    { name = "REFRESH_PEPPER", valueFrom = aws_secretsmanager_secret.app["refresh-pepper"].arn },
    { name = "MFA_ENC_KEY", valueFrom = aws_secretsmanager_secret.app["mfa-enc-key"].arn },
    { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.app["database-url"].arn },
    { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.app["redis-url"].arn },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.api_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = "api"
      image                  = var.api_image
      essential              = true
      user                   = "10001"
      readonlyRootFilesystem = true
      portMappings           = [{ containerPort = 3001, protocol = "tcp" }]
      environment            = local.api_environment
      secrets                = local.api_secrets
      mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
      linuxParameters = {
        capabilities       = { drop = ["ALL"] }
        initProcessEnabled = true
      }
      healthCheck = {
        command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3001/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name                   = "api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.api_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.https]
}
