# AWS deployment path (design only - nothing is provisioned)

> Status: **sketch**. No AWS calls are made by this repo, no credentials are stored, and the
> Terraform in `deploy/terraform/` has never been applied. The MVP has no auth and no
> persistence, so do not put it on the public internet until the TODOs below are done.

## Target shape

```
Internet -> ALB (HTTPS, ACM cert) -> ECS Fargate service (freight-recovery container)
                                         |-> RDS PostgreSQL (private subnets)   [future: persistence]
                                         |-> S3 bucket for uploaded documents   [future]
                                         |-> Secrets Manager (DB creds, LLM key) [future]
                                         '-> CloudWatch Logs
```

- **Compute:** ECS on Fargate, 1 task (0.5 vCPU / 1 GB) to start; the app is stateless today.
- **Image:** built from `Dockerfile`, pushed to ECR (`aws ecr` / CI step).
- **Database (future):** RDS PostgreSQL in private subnets, security group allowing only the
  service SG. The MVP does not use a DB yet - add SQLAlchemy/Alembic when persistence lands.
- **Documents (future):** S3 with SSE-KMS, private, lifecycle rules; store sha256 (already
  computed at ingest) alongside the object for evidence integrity.
- **Networking:** ALB in public subnets, tasks and RDS in private subnets, NAT or VPC endpoints.
- **Observability:** CloudWatch Logs + `/health` target-group health check.

## Path to first deploy (checklist, not done)

1. Create ECR repo, push image.
2. Apply Terraform skeleton (VPC, ALB, ECS cluster/service, task role, log group, optional RDS).
3. Put auth in front (Cognito/OIDC on the ALB or in-app) - **required before any real data**.
4. Replace the stub extraction provider with a real one; store the provider key in Secrets Manager.
5. Add upload limits, malware scanning, per-tenant isolation, audit logging.
6. Review data handling (freight docs contain commercial terms; may be contractually confidential).

## Terraform sketch

See `deploy/terraform/main.tf`. It is a **skeleton** with variables and the main resources
stubbed as comments/minimal blocks; run `terraform validate` only after filling in networking
inputs. Remote state (S3 + DynamoDB lock) is intentionally not configured.

## Out of scope / TODO

- Multi-AZ, autoscaling policies, WAF, backups/PITR, DR, cost controls.
- CI/CD to ECR/ECS (GitHub OIDC role) - `.github/workflows/ci.yml` only runs tests/build.
- SOC 2 / compliance work.
