# infra/ - Terraform for the Freight Recovery web stack

This module supersedes `deploy/terraform/` **for the web stack** (TypeScript API + SPA). The Python
service's deployment notes in `deploy/` are unchanged.

CI (`.github/workflows/web-ci.yml`) only runs `terraform fmt -check`, `terraform init -backend=false`
and `terraform validate`. **Nothing here is ever applied automatically**: `terraform apply` is a
deliberate human step after review.

## What it creates

- VPC (2 AZs): public subnets for the ALB only; private subnets for ECS, RDS and Redis. No NAT gateway:
  tasks reach AWS APIs through VPC endpoints (S3 gateway; ECR, Logs, Secrets Manager, KMS interface).
- KMS: one CMK for data (RDS, S3 documents, Redis, Secrets Manager), one for logs; rotation on.
- RDS PostgreSQL 16: private, encrypted, `rds.force_ssl=1`, managed master password, backups >= 14 days,
  deletion protection, Multi-AZ (variable).
- S3: documents (SSE-KMS, versioning, public access blocked, TLS-only), static site (CloudFront OAC only),
  access logs.
- ElastiCache Redis 7 (rate-limit store): TLS in transit, encrypted at rest, AUTH token set out of band (never in state).
- Secrets Manager containers (no values): `jwt-secret`, `csrf-secret`, `refresh-pepper`, `mfa-enc-key`,
  `database-url`, `redis-url`, `redis-auth-token`.
- IAM: execution role (pull this image, read these secrets, write this log group) and task role (documents
  bucket `t/*` prefix + data key only).
- ECS Fargate: read-only root filesystem, uid 10001, all capabilities dropped, secrets from Secrets Manager.
- ALB: reachable only from CloudFront origin-facing ranges, HTTP->HTTPS, `ELBSecurityPolicy-TLS13-1-2-2021-06`,
  `drop_invalid_header_fields`, access logs, WAFv2 (AWS Common/KnownBadInputs/IpReputation, IP rate limit,
  Content-Length size rule).
- CloudFront: SPA from S3 (OAC) with a response-headers policy built from `web/security-headers.json`;
  `/api/*` and `/healthz` to the ALB with caching disabled.

## Order of operations (human)

1. Bootstrap remote state (S3 bucket with versioning + SSE-KMS; `use_lockfile = true`) and uncomment the
   backend block in `versions.tf`.
2. `terraform apply -target=aws_secretsmanager_secret.app` to create the secret containers, then set every
   value out of band, e.g. `aws secretsmanager put-secret-value --secret-id <arn> --secret-string "$(openssl rand -hex 32)"`
   (or `openssl rand -base64 48`; both formats pass the API's production entropy check).
   `mfa-enc-key` must be base64 of 32 random bytes. `redis-auth-token` must be 16-128 printable characters.
3. `terraform plan` / `terraform apply` for the rest. Terraform never reads any secret value: no secret
   material is in state or plan output.
3a. Redis AUTH (out of band, before the API is deployed): generate a token, store it in `redis-auth-token`,
   then `aws elasticache modify-replication-group --replication-group-id <name>-redis --auth-token <token>
   --auth-token-update-strategy SET --apply-immediately`. Terraform ignores `auth_token` afterwards.
4. Database roles: connect to RDS as the managed master user (from its Secrets Manager secret) from a
   bastion/SSM session inside the VPC and apply `api/db/init/00-roles.sql` with **random passwords
   substituted** for the `local-dev-only` placeholders (and without `CREATE DATABASE freight_web_test`).
   RDS has no superuser: grant `BYPASSRLS` to `freight_owner` via `rds_superuser` membership or run
   migrations as the master user; never give `freight_app` BYPASSRLS. The `GRANT SET ON PARAMETER
   session_replication_role` line is dev/test-only (seed) and must be skipped in AWS.
5. Set `database-url` to `postgresql://freight_app:<pw>@<rds_endpoint>:5432/freight_web?sslmode=verify-full`
   and `redis-url` to `rediss://:<token>@<redis_primary_endpoint>:6379`.
6. Run migrations as a one-off ECS task using the `migrate` image target with `MIGRATE_DATABASE_URL`
   (owner role), then deploy the API service.
7. Upload `web/dist` to the static bucket: `index.html` with `Cache-Control: no-store`, `assets/*` with
   `Cache-Control: public, max-age=31536000, immutable`.

## Known gap

No real mail transport exists yet. In production the API's config validator refuses every
`MAIL_TRANSPORT` value (`outbox` is a dev/test sink; `ses` is a stub whose `SesMailer` throws), so the
ECS task in `ecs.tf` (which sets `MAIL_TRANSPORT=ses`) will not start until a real transport is
implemented and allow-listed in `PRODUCTION_MAIL_TRANSPORTS` (`api/src/config.ts`).
