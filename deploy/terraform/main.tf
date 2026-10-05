# SKELETON ONLY. Never applied, no credentials, no state backend configured.
# Fill in networking inputs and review before any `terraform plan`.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # TODO: backend "s3" { ... } for remote state + locking.
}

provider "aws" {
  region = var.region
  # Credentials come from the environment/role at apply time; none live in this repo.
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "freight-recovery"
}

variable "container_image" {
  type        = string
  description = "ECR image URI, e.g. <acct>.dkr.ecr.<region>.amazonaws.com/freight-recovery:tag"
}

variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "this" {
  name = var.name
}

# TODO: IAM execution role + task role (least privilege).
# TODO: aws_ecs_task_definition (FARGATE, CPU/memory sized for FR_SANDBOX_MAX_WORKERS x FR_SANDBOX_MEMORY_MB + API, port 8000, logs -> log group,
#       env/secrets per the table in deploy/aws.md: FR_ENV=production, FR_DATABASE_URL and
#       FR_API_KEY_PEPPER from Secrets Manager, readonlyRootFilesystem, caps dropped, user 10001).
# TODO: aws_lb + listener (HTTPS/ACM) + target group (health check /health).
# TODO: aws_ecs_service (desired_count = 1, private subnets, SG from ALB only).
# TODO: aws_db_instance (postgres, private subnets, encrypted) - persistence exists (Alembic migrations; see deploy/aws.md).
# TODO: aws_s3_bucket for documents (SSE-KMS, block public access) - only when uploads persist.
