# Terraform skeleton for the Freight Recovery web stack. NEVER applied by CI: CI runs fmt -check,
# init -backend=false and validate only. `terraform apply` is a deliberate human step (see README.md).

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.100.0"
    }
  }

  # Remote state (example only; bootstrap the bucket + lock first, see README.md):
  # backend "s3" {
  #   bucket       = "<state-bucket-name>"
  #   key          = "freight-recovery/web/terraform.tfstate"
  #   region       = "<region>"
  #   encrypt      = true
  #   kms_key_id   = "<kms-key-arn>"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}
