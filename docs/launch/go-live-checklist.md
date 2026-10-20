# Go-live checklist: hosted team workspace (API + console)

> Written 2026-10-20 from a local end-to-end proof of the web platform (`api/`, `web/`, `packages/shared/`,
> `infra/`) on branch `feat/hosted-platform` (base `origin/master` fb1eeb2). Nothing in this checklist has
> been done in AWS: no account, domain, secret or resource exists. The platform is **not** deployable to
> production today (section 2). Threat model: [technical/web-platform-security.md](../../technical/web-platform-security.md).
> Secrets inventory: [docs/secrets.md](../secrets.md). Infrastructure: [infra/README.md](../../infra/README.md).

## 1. What the local proof established (2026-10-20)

Stack used (Docker Desktop's Linux engine was down on this machine, so `compose.web.yml` could not be used;
the CI recipe of `.github/workflows/web-ci.yml` was reproduced by hand):

| Component | Local stand-in | Production target |
| --- | --- | --- |
| PostgreSQL | embedded PostgreSQL 18.4 on 127.0.0.1:5433, roles from `api/db/init/00-roles.sql` with **random passwords substituted** (the `infra/README.md` step 4 procedure) | RDS PostgreSQL 16 (`infra/rds.tf`) |
| Object store | `moto` 5.2.4 S3 server on 127.0.0.1:9000 (versioning + SSE-KMS headers honoured) | S3 + KMS (`infra/s3.tf`, `infra/kms.tf`) |
| Redis | none (in-memory limiter store, as in CI) | ElastiCache (`infra/elasticache.tf`), required in production |
| Secrets | generated per run into a git-ignored `.env` (verified ignored before writing) | Secrets Manager containers (`infra/secrets.tf`) |
| Python (parity suites) | repo venv, Python 3.14, hash-locked `requirements.txt` | n/a |

Commands run, in this order, all green: `npm ci --ignore-scripts`, `npm run build -w packages/shared`,
`npm run prisma:generate`, `npm run db:migrate:deploy` (11 migrations), `npm run db:seed`,
`npm run ensure-bucket`, `npm run build`, `npm run test:integration` (21 files, 157 passed, 3 skipped),
`npm test` (shared 279, api 460, web 141 passed), `npm run test:acceptance` (`packages/shared` 405 passed; the `api` and `web` acceptance projects were still
running when this run was stopped, with one failure seen in `api/test-acceptance/dd-api.acc.test.ts` (1 of 19)
not yet diagnosed; re-run `npm run test:acceptance` in CI), then `npm run dev -w api` and `npm run dev -w web` and a scripted
run of the real flows against the live API (seed accounts, synthetic data only):

- `/healthz` and `/readyz`; console served by Vite with `/api` proxied to 127.0.0.1:3001.
- Sign-in of the seeded OWNER with password + TOTP; `GET /me`.
- MFA enrolment forced for a privileged role without MFA (`mfa_enrollment_required` ->
  `/auth/mfa/enroll/start` -> `/auth/mfa/enroll/verify` -> 10 recovery codes; next sign-in needs TOTP).
- Refresh-token rotation; reuse of the old token refused (401) and the whole family revoked; logout 204.
- Lockout: 5 wrong passwords -> 401, the 6th (correct password) -> 429 `account_locked` + `Retry-After`.
- API key: created by OWNER (secret shown once, `fr_live_...`), reads claims (200), refused on `/me` (403),
  list never shows the secret, revoked key -> 401.
- Import: PDF upload parsed in the sandbox and stored with SSE -> `NEEDS_REVIEW`; uploader cannot accept;
  reviewer confirms fields; a second person accepts; commit creates the claim (`AWAITING_ANALYSIS`);
  analysis -> packet revision 1, `PENDING_REVIEW`.
- Four-eyes on approval: the revision author gets 403 `four_eyes_required`; a second user approves; the
  author marks it send-ready (`SEND_READY`).
- CSV export (session and API-key scope `exports.claims`) contains the new claim; XLSX packet export.
- Audit chain `GET /audit/verify` -> `valid: true` after all of the above; audit events readable by OWNER.
- Platform roles: SUPER_ADMIN lists tenants; PLATFORM_DEV gets health (200) but no tenant list (403) and no
  tenant claims (403).

Defects fixed in this run (small commits on `feat/hosted-platform`):

1. `api/package.json` `dev` script: `tsx --conditions=source watch src/server.ts` made tsx load a file named
   `watch`; `npm run dev -w api` never started. Now `tsx watch --conditions=source src/server.ts`.
2. `web/tools/gen-nginx-conf.mjs` / `web/nginx.conf`: the global `client_max_body_size 64k` also applied to
   `POST /api/v1/imports/<batch>/documents`, so the compose web container would answer 413 to any document
   over 64 KiB. The upload route now gets its own `client_max_body_size 10m` (= `IMPORT_MAX_FILE_BYTES`,
   same exception as the WAF rule in `infra/waf.tf`). **Not exercised in a container** (Docker was down):
   verify once with `docker compose -f compose.web.yml up --build` and a 1 MiB PDF upload.

Not proven here: the Docker images (`api/Dockerfile`, `web/Dockerfile`), nginx, MinIO, Terraform
(`terraform validate` runs only in CI), anything in AWS.

## 2. Hard blockers: the API cannot start in production today

1. **No mail transport.** `PRODUCTION_MAIL_TRANSPORTS` in `api/src/config.ts` is empty and `SesMailer`
   throws, so `NODE_ENV=production` refuses every `MAIL_TRANSPORT` value: the ECS task in `infra/ecs.tf`
   (`MAIL_TRANSPORT=ses`) will not start. Password reset and invites cannot be delivered. Required: implement
   a real transport (SES or a provider), add it to `PRODUCTION_MAIL_TRANSPORTS`, give the task role
   `ses:SendEmail` (or the provider secret), verify the sending domain (SPF/DKIM/DMARC).
2. **No first-admin bootstrap.** `npm run db:seed` refuses `NODE_ENV=production` and any `amazonaws.com` host
   (`api/scripts/seed.ts`), and there is no operator command that creates a tenant, its first OWNER or a
   SUPER_ADMIN. Required: an owner-connection script (run as a one-off ECS task with `MIGRATE_DATABASE_URL`)
   that creates the tenant and an OWNER invite and prints the invite URL; the OWNER accepts it
   (`/auth/invites/accept`) and is forced into MFA enrolment at first sign-in (proven locally). Decide who the
   first OWNER and the first SUPER_ADMIN are.
3. **No independent assessment.** No third-party penetration test and no compliance sign-off exist
   (`technical/web-platform-security.md` section 3, item 5; `deploy/aws.md`). All evidence is the repo's own
   tests.
4. **Egress-less parser task.** The PDF parser child inherits the API task's network (private subnets, VPC
   endpoints). A dedicated no-egress task/service for parsing is a stated launch gate (`infra/README.md`).
5. **Incident response plan and data retention/deletion policy do not exist** (section 9).

Decisions only the owner can take: hosting account and region (`infra/variables.tf` defaults to
`eu-north-1`, environment `staging`), the public hostname (`app_domain`), who holds the AWS root and IAM
Identity Center admin, the budget (section 10), the first OWNER/SUPER_ADMIN identities, the mail provider,
and the data-retention periods.

## 3. What to provision (from `infra/` and `deploy/`)

`infra/` is the web-stack Terraform and supersedes `deploy/terraform/main.tf`, which is a skeleton (log group
+ empty ECS cluster + TODOs) for the **Python** service described in `deploy/aws.md`. Both are unapplied.

| Area | Resources (`infra/*.tf`) |
| --- | --- |
| Network | VPC 2 AZs, public subnets (ALB only), private subnets (ECS, RDS, Redis), no NAT; S3 gateway endpoint; interface endpoints for ECR, Logs, Secrets Manager, KMS (`network.tf`) |
| Keys | CMK `data` (RDS, S3 documents, Redis, Secrets Manager) and CMK `logs`, rotation on (`kms.tf`) |
| Database | RDS PostgreSQL 16, `db.t4g.medium`, 50 GiB gp3, encrypted, `rds.force_ssl=1`, managed master password, Multi-AZ, backups >= 14 days, deletion protection (`rds.tf`) |
| Cache | ElastiCache Redis 7, TLS, encrypted at rest, AUTH token set out of band (`elasticache.tf`) |
| Storage | S3 `documents` (SSE-KMS, versioned, TLS-only, lifecycle), `static` (CloudFront OAC only), `logs` (`s3.tf`) |
| Secrets | containers `jwt-secret`, `csrf-secret`, `refresh-pepper`, `mfa-enc-key`, `database-url`, `redis-url`, `redis-auth-token`, `api-key-pepper`, `origin-verify-secret` (`secrets.tf`) |
| Compute | ECS Fargate cluster + service (2 tasks, 512 CPU / 1024 MiB, read-only root fs, uid 10001, caps dropped, `/tmp` volume, circuit breaker), CloudWatch log group (KMS, 90 days) (`ecs.tf`) |
| Edge | ALB (HTTPS, TLS1.3 policy, access logs, 403 default, forward only with `x-origin-verify` + Host), regional WAFv2; CloudFront (SPA from S3, `/api/*` + `/healthz` to the ALB, response-headers policy from `web/security-headers.json`), CLOUDFRONT-scope WAFv2 in us-east-1 (`alb.tf`, `waf.tf`, `cloudfront.tf`) |
| IAM | execution role (pull image, read named secrets, write log group) and task role (documents bucket `t/*` + data key) (`iam.tf`) |
| Not in Terraform | remote state bucket, ECR repository + image push (CI has no deploy job), DNS record, ACM certificates, the DB roles, every secret value, the Redis AUTH token, CloudTrail/GuardDuty/billing alarm (listed in `deploy/aws.md`) |

Variables to set (`infra/variables.tf`): `environment`, `region`, `app_domain`, `cloudfront_certificate_arn`
(us-east-1), `alb_certificate_arn` (same region, issued exactly for `app_domain`, see HR-10), `api_image`
(ECR URI by digest), `api_ecr_repository_arn`, sizing variables.

## 4. Environment variables and secrets (where each is read)

Source of truth: `loadConfig` in `api/src/config.ts`; inventory with rotation procedures in `docs/secrets.md`.
The API refuses to start and names the variable (never the value) when a rule fails.

Required everywhere:

| Variable | Rule | Read in |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://` URL of `freight_app` (no BYPASSRLS); production: `sslmode=require` or `verify-full` | `api/src/config.ts` -> `db/client.ts` |
| `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER` | >= 43 chars, distinct, no placeholder text; production: not a documented dev/CI value and >= 160 bits estimated entropy | `security/jwt.ts`, `security/csrf.ts`, `auth/session.ts`, `auth/service.ts` |
| `MFA_ENC_KEY` | base64 of exactly 32 random bytes | `auth/service.ts`, `security/crypto.ts` |
| `APP_ORIGIN` | exact origin; production: `https://` | `app.ts` (CSRF/origin checks, cookies) |

Production-only requirements (`NODE_ENV=production`, the default when unset):

| Variable | Rule |
| --- | --- |
| `API_KEY_PEPPER` | required, >= 256 bits, distinct from every other secret (rotation invalidates every tenant API key) |
| `REDIS_URL` | required, `rediss://` with the AUTH token (rate-limit store) |
| `S3_SSE=aws:kms`, `S3_KMS_KEY_ID` | required (data CMK ARN); `S3_BUCKET`, `S3_REGION`; no static S3 keys in AWS (task role) |
| `COOKIE_SECURE` | must not be `false` (default `true`) |
| `ENABLE_DEV_OUTBOX` | must not be `true`; `RATE_LIMIT_ENABLED` must not be `false`; `API_KEY_ALLOW_NON_EXPIRING` must be `false` |
| `MAIL_TRANSPORT` | **every value refused today** (section 2) |
| Knob floors/ceilings | e.g. `ARGON2_MEMORY_KIB >= 19456`, `ARGON2_TIME_COST >= 2`, `LOCKOUT_*`, `FLAGS_CACHE_TTL_MS <= 30000`, `PARSE_*` floors (`KNOBS`, `STEP4_KNOBS`, `IMPORT_KNOBS` in `config.ts`) |

Plain environment set by `infra/ecs.tf`: `NODE_ENV`, `HOST=0.0.0.0`, `PORT=3001`, `APP_ORIGIN`,
`COOKIE_SECURE=true`, `HSTS_MAX_AGE_SECONDS`, `BODY_LIMIT_BYTES=65536`, `TRUST_PROXY=<vpc cidr>`,
`S3_*`, `LOG_LEVEL`, the import/parse/export limits, the step-4 knobs, `CLIENT_IP_HEADER=cloudfront-viewer-address`.
Secrets injected by ARN: `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER`, `MFA_ENC_KEY`, `DATABASE_URL`,
`REDIS_URL`, `API_KEY_PEPPER`, `ORIGIN_VERIFY_SECRET`. Operator-only (never in the task): `MIGRATE_DATABASE_URL`
(`freight_owner`, used by `api/prisma.config.ts`, `api/scripts/seed.ts`, `api/src/platform/prices-cli.ts`);
there is no Secrets Manager container for it (gap noted in `docs/secrets.md`). Generate every value with
`openssl rand -hex 32` (or `-base64 48`; `MFA_ENC_KEY`: `openssl rand -base64 32`), never reuse a value from
the repository, compose, CI or tests (they are public).

## 5. Domain and TLS

- Choose `app_domain` (one hostname; the console and the API share one origin, cookies are `SameSite=Strict`,
  the API emits no CORS headers).
- ACM certificate in **us-east-1** for the CloudFront alias and one in the deployment region for the ALB,
  issued exactly for `app_domain` (a wildcard/SAN-only certificate blocks `terraform plan` until the
  precondition in `alb.tf` is adapted, residual HR-10).
- DNS: alias/CNAME `app_domain` -> `cloudfront_domain_name` output. The ALB is reachable only from CloudFront
  origin ranges and answers 403 without the origin-verify header.
- HSTS: `max-age=63072000; includeSubDomains` on the SPA (`web/security-headers.json`), `HSTS_MAX_AGE_SECONDS`
  on API responses. `upgrade-insecure-requests` is in the CSP.
- `ORIGIN_VERIFY_SECRET`: set and rotated in the five-step order in `infra/README.md` (Secrets Manager, ALB
  rule, API redeploy, CloudFront header, remove old value).

## 6. Order of operations: migration, seed, first admin

1. Remote state (S3 + lockfile), `terraform apply -target=aws_secretsmanager_secret.app`, set every secret
   value out of band, full apply, Redis AUTH token (`infra/README.md` steps 1-3a).
2. Database roles: from inside the VPC as the RDS master user apply `api/db/init/00-roles.sql` with random
   passwords, **without** `freight_web_test` and without the `GRANT SET ON PARAMETER` line; `freight_owner`
   gets BYPASSRLS via `rds_superuser`, `freight_app` never. Set `database-url` (`sslmode=verify-full`).
3. Migrations: one-off ECS task from the `migrate` image target with `MIGRATE_DATABASE_URL` (owner role):
   `prisma migrate deploy` (`api/prisma/migrations`, 11 migrations, idempotent). Before every deploy, never at
   API start.
4. Public price tables (fuel check / outlook): `npm run prices:import -- --bundled` as the owner (the seed does
   this locally; production needs the explicit import).
5. **Seed: never in production.** Create the first tenant and OWNER with the bootstrap command of section 2
   item 2 once it exists; the OWNER signs in, enrols MFA, invites the team (requires the mail transport).
6. Deploy the API service (image by digest), then upload `web/dist` (section 7). Smoke: `/healthz` through
   CloudFront, direct ALB request -> 403, sign in, `GET /audit/verify` -> `valid: true`.

## 7. How the console is served

- Build: `npm run build -w web` (Vite, `es2022`, no sourcemaps, no inlined assets, `tools/check-dist.mjs`
  refuses inline script/style). Output `web/dist`.
- AWS path: upload to the `static` bucket (`index.html` with `Cache-Control: no-store`, `assets/*` with
  `public, max-age=31536000, immutable`); CloudFront serves it via OAC with the response-headers policy
  rendered from `web/security-headers.json` (CSP `default-src 'none'; script-src 'self'; style-src 'self';
  font-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests`, HSTS 2 years, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP `same-origin`).
- Container path (compose / any host with Docker): `web/Dockerfile` builds the SPA and serves it with
  unprivileged nginx using `web/nginx.conf`, **generated** from the same JSON by `npm run gen:headers -w web`
  (`--check` runs in the image build and in `web/test/security-config.test.ts`); nginx proxies `/api/` and
  `/healthz` to `api:3001`, overwrites `X-Forwarded-For`, 64 KiB body cap except the upload route (10 MiB).
- The API itself sends its own security headers (`@fastify/helmet`, `api/src/http/security.ts`).

## 8. Backups, logging, monitoring

- RDS automated backups >= 14 days with PITR, Multi-AZ, deletion protection; test a restore before launch.
- S3 documents: versioning on, noncurrent versions expire after 30 days, delete markers cleaned, multipart
  aborted after 1 day; cross-region or vault copy is **not** configured.
- Redis holds only rate-limit counters (no backup needed). The audit log is a hash-linked table in PostgreSQL
  (`audit_events`); `GET /api/v1/audit/verify` per tenant and the platform chain via SUPER_ADMIN. Chain heads
  are not anchored outside the database.
- Logs: API JSON logs (pino) to CloudWatch `/ecs/<name>/api` (KMS, `log_retention_days` = 90), ALB and S3
  access logs to the `logs` bucket, Container Insights on. No alarms are defined in `infra/`: add 5xx, unhealthy
  targets, task restarts, 503 `parser_busy`, 413/422 spikes, WAF block counts, RDS storage/CPU, and a billing alarm.
- Health: `/healthz` (liveness), `/readyz` (readiness, checks the database).

## 9. Known gaps carried from the threat model (open)

From `technical/web-platform-security.md` section 3 and 13.5, `infra/README.md`, `docs/secrets.md`:

- No independent assessment (penetration test, compliance sign-off, SOC 2 readiness).
- No incident response plan: no on-call, no runbook for key compromise beyond the rotation table in
  `docs/secrets.md` section 5 (note `MFA_ENC_KEY` rotation needs a re-encryption tool that does not exist).
- No retention or deletion policy for customer documents, claims and audit rows (only the S3 lifecycle above).
- Docker images and the compose stack unverified in this run and in the last documented run.
- Dev/CI object store: upstream MinIO (community) is archived and `dl.min.io` answers 410; compose and CI pin
  Chainguard images by digest, which still exist but will not receive upstream fixes. Plan a replacement for
  local/CI S3 (this run used `moto`).
- `mail_outbox` table exists in every schema (dev only); drop or keep unused once a transport lands.
- Residuals HR-1 (revoke vs concurrent refresh race), HR-4 (known-device lockout limits), HR-6 (origin-verify
  rotation window; `CLIENT_IP_HEADER` not enforced by config), HR-8 (test values for `ORIGIN_VERIFY_SECRET`
  not denylisted), HR-10 (origin request policy / Host coupling), HR-11 (Terraform never planned/applied),
  HR-13 (one acceptance check skips in CI).
- Per-instance limits (parse slots, upload/export gates) multiply with the task count.
- Python service (`deploy/aws.md`): still `stub` providers, no OS-level parser isolation, separate pepper.

## 10. Monthly cost

Not stated. `deploy/aws.md` lists "cost controls" as out of scope and gives no figure; `infra/README.md`
gives none. The sized defaults (2 Fargate tasks, `db.t4g.medium` Multi-AZ, `cache.t4g.small`, CloudFront,
2 WAF ACLs, interface endpoints, KMS) must be priced by the owner before the account is opened.