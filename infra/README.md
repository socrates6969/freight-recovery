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
  `database-url`, `redis-url`, `redis-auth-token`, and (step 4) `api-key-pepper`. The full inventory of
  every secret, how to generate and rotate each one, and the buyer handover checklist are in
  [docs/secrets.md](../docs/secrets.md).
- IAM: execution role (pull this image, read these secrets, write this log group) and task role (documents
  bucket `t/*` prefix + data key only).
- ECS Fargate: read-only root filesystem, uid 10001, all capabilities dropped, secrets from Secrets Manager.
- ALB: reachable only from CloudFront origin-facing ranges, HTTP->HTTPS, `ELBSecurityPolicy-TLS13-1-2-2021-06`,
  `drop_invalid_header_fields`, access logs, HTTPS default `403` with one rule that forwards only requests
  carrying the origin-verify header, regional WAFv2 (AWS Common/KnownBadInputs, Content-Length size rules).
- CloudFront: SPA from S3 (OAC) with a response-headers policy built from `web/security-headers.json`;
  `/api/*` and `/healthz` to the ALB with caching disabled, the `x-origin-verify` origin header and
  `CloudFront-Viewer-Address` forwarded; CLOUDFRONT-scope WAFv2 (IP rate limit, AWS IpReputation).

## Order of operations (human)

1. Bootstrap remote state (S3 bucket with versioning + SSE-KMS; `use_lockfile = true`) and uncomment the
   backend block in `versions.tf`.
2. `terraform apply -target=aws_secretsmanager_secret.app` to create the secret containers, then set every
   value out of band, e.g. `aws secretsmanager put-secret-value --secret-id <arn> --secret-string "$(openssl rand -hex 32)"`
   (or `openssl rand -base64 48`; both formats pass the API's production entropy check).
   `mfa-enc-key` must be base64 of 32 random bytes. `api-key-pepper` (step 4) must carry at least 256 bits
   (`openssl rand -hex 32` or `openssl rand -base64 32`) and differ from every other secret; rotating it
   later invalidates every tenant API key. `redis-auth-token` must be 16-128 printable characters.
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

## Deploy gate: CloudFront origin verification and client address (fix round 1, F-03)

The ALB's HTTPS listener answers `403` by default and forwards to the API only when the request carries the
header `x-origin-verify` with the current origin-verify value; CloudFront adds that header on the `api`
origin. The API (`CLIENT_IP_HEADER=cloudfront-viewer-address`, `ORIGIN_VERIFY_SECRET` from the
`<name>/origin-verify-secret` secret) then takes the client address from `CloudFront-Viewer-Address`. The
IP-keyed WAF rules (`ip-rate-limit`, `AWSManagedRulesAmazonIpReputationList`) are in the CLOUDFRONT-scope
web ACL (created in `us-east-1`); the regional ACL on the ALB keeps the size rules and the other managed groups.
Terraform only writes a non-secret placeholder; the CloudFront origin and the listener-rule condition ignore
changes after creation, so the real value is managed by this procedure.

Set the value (first deploy) and rotate it (same steps):

1. Generate a value (`openssl rand -base64 48`; at least 43 characters, different from every other secret) and
   store it: `aws secretsmanager put-secret-value --secret-id <name>/origin-verify-secret --secret-string <value>`.
2. ALB rule: set both the old and the new value (`aws elbv2 modify-rule --rule-arn <api_from_cloudfront arn>
   --conditions Field=http-header,HttpHeaderConfig={HttpHeaderName=x-origin-verify,Values=[<old>,<new>]}`);
   on the first deploy, replace the placeholder with the new value only.
3. Restart the API service so the tasks read the new `ORIGIN_VERIFY_SECRET`.
4. CloudFront: set the `x-origin-verify` origin custom header of the `api` origin to the new value and wait
   for the distribution to deploy.
5. Remove the old value from the ALB rule.

Verify with one real request through CloudFront that `login_attempts.ip` and the audit `ip` show the viewer
address, and that a direct request to the ALB without the header gets `403`. Until that check is recorded,
F-03 stays open as "fixed in code and IaC, unverified in AWS". During step 3 a task with the old value falls
back to the TRUST_PROXY address (never fails a request).

## Known gap

No real mail transport exists yet. In production the API's config validator refuses every
`MAIL_TRANSPORT` value (`outbox` is a dev/test sink; `ses` is a stub whose `SesMailer` throws), so the
ECS task in `ecs.tf` (which sets `MAIL_TRANSPORT=ses`) will not start until a real transport is
implemented and allow-listed in `PRODUCTION_MAIL_TRANSPORTS` (`api/src/config.ts`).

## Imports and exports (step 3)

- **Documents bucket.** Writes must request SSE-KMS with the data CMK (`DenyNonKmsPuts`,
  `DenyMissingSseHeader`, `DenyWrongKmsKey`); the API sends `S3_SSE=aws:kms` and
  `S3_KMS_KEY_ID=<CMK ARN>` on every single-request `PutObject` (no multipart). Lifecycle: noncurrent
  versions expire after 30 days, expired delete markers are removed, incomplete multipart uploads are
  aborted after 1 day. The task role may `s3:DeleteObject` only under `t/*/imports/*` (rejected/failed
  originals); it has no version-level permissions.
- **WAF.** The 65536-byte Content-Length block excludes only `POST /api/v1/imports/<uuid>/documents`,
  which has its own block above `var.import_max_file_bytes` (10485760). The API enforces both limits
  authoritatively while streaming. The AWS Common rule set still inspects the first 8 KB of upload
  bodies; watch the `aws-common` metrics for false positives on binary documents before launch.
- **Parser sandbox.** Documents are parsed in a child Node process (`--permission`, memory and time
  limits, empty working directory under `/tmp`). It inherits this task's network posture: private
  subnets, no NAT, egress only to the VPC endpoints. The worker's in-process network guard is best
  effort only, not a boundary. A dedicated no-egress parser task (separate task definition and security
  group with no egress rules) is a **launch gate**.
- **Image.** The API image contains the built worker (`/app/api/dist/src/imports/sandbox/worker-main.js`,
  set as `PARSE_WORKER_ENTRY`) and the `pdfjs-dist` production dependency; `/tmp` is the task's writable
  volume while the root filesystem stays read-only.
