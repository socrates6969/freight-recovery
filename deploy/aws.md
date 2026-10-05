# AWS deployment path (design only - nothing is provisioned)

> Status: **sketch**. No AWS calls are made by this repo, no credentials are stored, and the
> Terraform in `deploy/terraform/` has never been applied. The application now has the
> production *foundation* (API-key auth + tenant isolation, PostgreSQL persistence with
> migrations, a `StorageProvider`, sandboxed parsing, a hash-locked supply chain), but it is
> still pre-product: **real integrations, a third-party penetration test and compliance
> sign-off are required before any real customer data.** This document maps each
> application feature to the AWS service that must back it.

## Target shape

```
Internet -> WAF -> ALB (HTTPS, ACM cert) -> ECS Fargate service (freight-recovery container)
                                               |-> RDS PostgreSQL (private subnets)      FR_DATABASE_URL
                                               |-> S3 bucket, SSE-KMS (raw documents)    FR_STORAGE_BACKEND=s3
                                               |-> Secrets Manager (pepper, DB creds)    task-definition secrets
                                               '-> CloudWatch Logs
ECS run-task (one-shot):  python -m freight_recovery.db.migrate     (before each deploy)
ECS run-task (operator):  python -m freight_recovery.admin ...      (tenants / API keys)
```

## How the application features map to AWS

| Application feature | AWS mapping |
|---|---|
| **API-key auth** (`X-API-Key`, per-tenant, HMAC-hashed in the DB) | Keys live in the `api_keys` table (RDS). The HMAC **pepper** (`FR_API_KEY_PEPPER`, >= 32 chars) is a Secrets Manager secret injected via the task definition `secrets:` block (never a plain `environment:` value, never in Terraform state as plaintext). Rotate by issuing new keys first, then rotating the pepper (a pepper change invalidates all existing keys). Issue/revoke keys with a one-off ECS task running `python -m freight_recovery.admin` using the task's own secrets. Optionally also put Cognito/OIDC or a WAF rate rule in front; the API key is a machine credential, not a user login. |
| **Tenant isolation** | Enforced in the application (key -> tenant -> tenant-bound repository; tenant-prefixed S3 keys). Add PostgreSQL row-level security as defense in depth. S3 bucket policy denies public access; the task role is limited to the bucket/prefix and KMS key it needs. |
| **PostgreSQL persistence** (SQLAlchemy + Alembic) | RDS PostgreSQL 16, private subnets, SG allowing only the service SG on 5432, encryption at rest (KMS), automated backups + PITR, Multi-AZ in prod, `manage_master_user_password = true` (RDS-managed secret in Secrets Manager). `FR_DATABASE_URL` is assembled into a Secrets Manager secret (`postgresql+psycopg://user:pass@host:5432/db`) and injected as a task secret. Use TLS (`?sslmode=require`) and pooled connections (`pool_pre_ping` is already on). |
| **Migrations** | One-shot ECS task (`python -m freight_recovery.db.migrate`) in the deploy pipeline *before* the service rolls to the new task definition; never at app start-up from every task. Expand/contract changes so the previous version keeps working during rollout. |
| **Raw-document storage** (`StorageProvider`) | Local filesystem is the dev default and must **not** be used on Fargate (ephemeral). Promote the `S3Storage` stub: S3 bucket with SSE-KMS (the stub already sets `aws:kms` + optional `FR_STORAGE_S3_KMS_KEY_ID`), versioning, block public access, lifecycle/retention rules, access logging; task role grants `s3:PutObject/GetObject/DeleteObject` on `arn:...:bucket/<prefix>/*` only, plus KMS `GenerateDataKey/Decrypt`. Install `boto3` in the image when you promote it (it is intentionally not in the lock file today) and enable both `FR_STORAGE_BACKEND=s3` and `FR_STORAGE_S3_ENABLED=true`. |
| **Sandboxed parsing** (`FR_SANDBOX_*`) | The app already runs each analysis in a time- and memory-bounded worker subprocess (process isolation only). The **OS-level** containment is yours to add in the task definition: `readonlyRootFilesystem: true` (give the worker a writable `/tmp` volume), `linuxParameters.capabilities.drop: [ALL]`, `user: 10001`, no new privileges, a tight seccomp profile (check what your launch type allows: Fargate does not take custom seccomp profiles), and **no outbound path to the internet or the DB/S3 from the parser**, which in practice means running parsing as a **separate, egress-less ECS task/service** (or Lambda) called by the API. Size CPU/memory for `FR_SANDBOX_MAX_WORKERS x FR_SANDBOX_MEMORY_MB` plus the API process (default 4 x 1 GiB => start at 2 vCPU / 6 GiB, or lower the worker settings). |
| **Docs gating** | Keep `FR_DOCS_MODE=off` in production (or `auth`). `open` is refused when `FR_ENV=production`. |
| **Fail-safe config** | The image defaults to `FR_ENV=production`; the app refuses to start without the pepper, PostgreSQL and `FR_SANDBOX_MODE=process`. A crash-looping task on a bad secret is the intended failure mode. |
| **Supply chain** | CI builds the image from hash-locked requirements and scans it (`trivy`); push to ECR with **immutable tags (git SHA)**, ECR scan-on-push, and a lifecycle policy. Deploy via GitHub OIDC (no static AWS keys): a `pull_request` role for `terraform plan` (read-only) and a `refs/heads/master` role for apply/deploy, each scoped to this repo's `sub` claim. |
| **Observability** | CloudWatch Logs (structured JSON recommended); the `freight_recovery.audit` logger writes `tenant/analysis/status/doc-hash-prefix` lines and never document content - ship them to a separate, access-restricted log group with a retention policy. ALB target-group health check on `/health` (liveness only; it deliberately does not touch the DB). Alarms: 5xx, unhealthy hosts, task restarts, 503 rate (worker back-pressure), 413/422 spikes. |
| **Edge limits** | WAF: rate-based rule per IP/API key header, request body size rule (the app caps at 25 MiB; set the same at the ALB/WAF), managed rule groups. The app does not rate-limit. |

## Environment variables for the ECS task definition

| Source | Variable |
|---|---|
| plain `environment` | `FR_ENV=production`, `FR_DOCS_MODE=off`, `FR_SANDBOX_MODE=process`, `FR_SANDBOX_MAX_WORKERS`, `FR_SANDBOX_MEMORY_MB`, `FR_SANDBOX_TIMEOUT_SECONDS`, `FR_STORAGE_BACKEND=s3`, `FR_STORAGE_S3_ENABLED=true`, `FR_STORAGE_S3_BUCKET`, `FR_STORAGE_S3_PREFIX`, `FR_STORAGE_S3_KMS_KEY_ID`, `FORWARDED_ALLOW_IPS=<ALB subnet CIDRs>` |
| Secrets Manager `secrets:` | `FR_DATABASE_URL`, `FR_API_KEY_PEPPER` |

## Path to first deploy (checklist, not done)

1. Create the state backend by hand once (S3 + locking, versioned, encrypted), CloudTrail/GuardDuty/billing alarm, IAM Identity Center for humans; no long-lived keys.
2. Replace the Terraform skeleton with a validated stack: VPC/subnets/endpoints, SGs, ALB + ACM + WAF, ECR (immutable, scan on push), ECS cluster/task/service with the hardening above, RDS (encrypted, private, backups), S3 bucket + KMS key, Secrets Manager secrets (values set out-of-band), IAM execution + task roles (no wildcards), log groups (KMS, retention). Run `terraform fmt/validate`, `tflint` and `checkov` in CI before the first plan.
3. GitHub OIDC roles; extend CI to push to ECR with immutable tags and deploy (plan on PR, apply on merge with a manual approval gate for prod).
4. Run the migration task, then create the first tenant and key with the admin task. **Do not expose the ALB listener until the application prerequisites below are met (at minimum: OS-level parser isolation and a WAF in front).**
5. Dev account first; load-test with large/hostile PDFs to size the task and tune `FR_SANDBOX_*`.

## Application prerequisites before real customer data (status)

- [x] Authentication, per-tenant authorization, tenant-scoped persistence (this repo).
- [x] Bounded parsing (process isolation) (this repo). **[ ] OS-level isolation (above) is yours.**
- [x] Hash-locked dependencies, `pip-audit`, `trivy`, Dependabot in CI (this repo; green in CI).
- [ ] Real extraction/match providers replacing `stub`; vendor/DPA review before any hosted LLM.
- [ ] Malware scanning of uploads, retention/deletion policy, tamper-evident audit logging.
- [ ] Rate limiting / WAF, TLS, private networking, backups/PITR (infrastructure).
- [ ] **Independent third-party penetration test.**
- [ ] **Compliance sign-off** (contract confidentiality, privacy law, SOC 2 readiness as customers require).

## Terraform sketch

See `deploy/terraform/main.tf`. It is a **skeleton** (variables, a log group, an empty ECS cluster);
everything in the table above is still a TODO. Run `terraform validate` only after filling in
networking inputs. Remote state is intentionally not configured yet.

## Out of scope / TODO

- Multi-AZ, autoscaling policies, DR, cost controls, multi-environment layout.
- CI/CD to ECR/ECS (GitHub OIDC role) - `.github/workflows/ci.yml` only tests, audits, scans and smoke-tests the image.
- SOC 2 / compliance work.
