# Freight Recovery

(c) 2026 Marius Carlsson (socrates6969) - owner and copyright holder. Proprietary; all rights reserved.

> **Status: pre-product.** Nothing here is validated on real customer data yet. Figures are graded A/B/C from research; the single most important first step is a design-partner pilot. Not investment advice.

## The problem
$15.1B/yr detention (ATRI, Sept 2024; grade A/B); <half of detention invoices paid

## Our wedge
Agent assembles the detention/accessorial evidence packet + demand, tracks deadlines, files disputes — for mid-market shippers & small carriers the incumbents (Cass, Trax, CTSI) ignore.

## Pricing
Contingency: a % of recovered dollars.

## Likely acquirers
Cass, Trax, Descartes, project44, FourKites

## Honest risk
Incumbents could move down-market; invoice-error % figures are vendor-grade. Validate real leakage on one partner's closed files first.

## Repository map
- business/ — business plan, market & competitor analysis, GTM.
- financial/ — unit economics, model, the ARR-to-valuation math.
- technical/ — architecture, the verified tool/agent pipeline, eval harness (pass^k).
- fundraising/ — right-fit VC/angel firms + their **official** contact channels + outreach templates. (No personal dossiers.)
- marketing/ — B2B SEO + content + channel plan (`seo-and-growth.md`) and a landing-page outline (`landing/`); plan only, no live site yet.
- hiring/ — role specs + how to source an operator/CEO in Norway (recruiters & official channels).
- web/, api/, packages/shared/, infra/ — the new TypeScript web platform (pre-product, synthetic data only); see [Web platform](#web-platform-typescript-pre-product-synthetic-data-only) below.
- docs/design/ — design documents for features that are not built yet (email-forward ingestion: design only).
- docs/secrets.md — every secret and credential of the web platform, rotation, and the buyer handover checklist.

## Secrets & handover
Every secret the web platform uses (env var, purpose, how to generate it, start-up rules, rotation and its impact, where it lives in production), the public dev/CI values that must never be used for real, and the **buyer handover checklist** (seller revokes and rotates everything, buyer generates their own, how to prove that no secret is in the git history, why Terraform state holds no secret values) are in **[docs/secrets.md](docs/secrets.md)** (Norwegian: [docs/secrets.no.md](docs/secrets.no.md)). Read it before any deployment and before any sale or transfer of the code.

## Build plan
Follows the 12-prompt playbook: eval set first → verified tool layer → draft + independent verifier (measured pass^k) → retrieval/memory → routing/cost control → red-team → audit trail + human approval → measured recovery rate → pilot one-pager → seed deck grounded only in measured results.

---

# MVP codebase (pre-product, NOT production-ready)

A working vertical slice of the core flow: **ingest -> extract -> rules -> recovery amount -> evidence packet + DRAFT demand letter**. It runs fully offline with a deterministic extraction stub (no API key). It has **not** been validated on real customer data. It now has the production *foundation* (API-key authentication with per-tenant isolation, PostgreSQL persistence with migrations, sandboxed parsing, a hash-locked supply chain), but real integrations, a third-party security audit and compliance sign-off are still required before any real customer data (see "Before real customer data"). It is a starting point, not an enterprise system. See [ARCHITECTURE.md](ARCHITECTURE.md) and [deploy/aws.md](deploy/aws.md).

## Stack
Python 3.11+ (developed on 3.14, CI/Docker on 3.12), FastAPI, pydantic v2, uvicorn, pdfplumber (PDF text layer), SQLAlchemy 2 + Alembic, psycopg 3 (PostgreSQL), pytest. Direct pins live in `requirements.in` / `requirements-dev.in`; `requirements.txt` / `requirements-dev.txt` are the **hash-locked** files generated from them (every transitive dependency pinned and hashed). CSV is handled with the stdlib (pandas was deliberately skipped: too heavy for what is needed).

## Setup, run, test
```bash
python -m venv .venv
.venv/Scripts/activate            # Windows (Git Bash: source .venv/Scripts/activate); Linux/macOS: source .venv/bin/activate
pip install --require-hashes --no-deps -r requirements-dev.txt   # hash-locked; pip aborts on any mismatch

pytest                                            # run the test suite (offline, SQLite)
python -m freight_recovery.cli --perspective carrier tests/fixtures/ld5002/*   # CLI (set PYTHONPATH=src); no auth/DB needed
```
To run the API (needs a database, tenant and key) see **Running with auth + Postgres** below.

### Changing dependencies
Edit `requirements.in` (or `requirements-dev.in`), then regenerate the locks and review the diff:
```bash
pip install uv     # or any recent pip-tools; uv is only used to resolve, not at runtime
uv pip compile requirements.in     --universal --python-version 3.12 --generate-hashes --no-header -o requirements.txt
uv pip compile requirements-dev.in --universal --python-version 3.12 --generate-hashes --no-header -o requirements-dev.txt
```
`--universal` produces one lock valid for Linux/macOS/Windows (platform markers are kept). Dependabot opens these updates weekly; CI runs `pip-audit` and `trivy` on every PR.

## API
Every route except `GET /health` requires an API key (`X-API-Key: <key>` or `Authorization: Bearer <key>`): no key = **401**, any invalid key = **403**. The tenant is derived from the key only.
- `GET /health` - anonymous liveness probe.
- `POST /v1/analyze` - multipart upload of invoice / rate confirmation / BOL (PDF, CSV, TXT) for one load, plus `perspective` (`shipper` | `carrier`). Persists the analysis; the response includes `analysis_id`.
- `POST /v1/analyze/text` - same, with inline text documents (JSON).
- `GET /v1/analyses?limit=&offset=` - the caller's analyses, newest first.
- `GET /v1/analyses/{id}` - one stored analysis with its documents' metadata and the full packet. Another tenant's id is a **404**, indistinguishable from a missing one.
- `/docs` and `/openapi.json` are **off by default** (`FR_DOCS_MODE=off`); `auth` serves them only with a valid key (use `curl`/Postman/codegen; browsers cannot attach the header to the initial page load); `open` is anonymous and refused in production.

Error mapping: bad/malformed input 422 (fixed messages, never echoing content), over-size 413, parsing time limit exceeded 422, parsing memory/output limit exceeded 413, all worker slots busy 503 (`Retry-After`).

Perspective: **shipper** recovers overcharges; **carrier** recovers detention/accessorials earned but unbilled or under-billed.

## Developer portal
Static B2B API docs (MkDocs + Material, pinned) in [developer-portal/](developer-portal/README.md): authentication, quickstart, generated API reference and Redoc, errors, rate limits (planned), changelog. Built in CI, **not deployed**. Build locally with `python developer-portal/build.py`.

## What the rules do today
Detention (clock starts at later of appointment/arrival, free time and rate from the rate con, rounded down to the configured increment using exact integer-minute arithmetic, capped at contract max), linehaul above rate con, fuel surcharge above rate con, accessorials not authorized on the rate con (flagged for human review), repeated identical lines (also flagged for human review: could be legitimate), invoice total above sum of lines. **Only confirmed findings count toward `recoverable_total` and the demand letter; `needs_human_review` items are listed and summed separately as `pending_review_total`.** Rule keyword tables and thresholds are illustrative and unmeasured. Conventions are explicit in `src/freight_recovery/rules/`; real contracts/tariffs vary and will need per-customer configuration.

## What was actually run vs left for CI
- **Run locally (Windows, Python 3.14.7): `pytest` -> 344 passed** (SQLite, sandbox in-process by default; also run once with `FR_TEST_SANDBOX=process`, every request through a real worker subprocess). A fresh venv built from the hash-locked `requirements-dev.txt` with `pip install --require-hashes --no-deps` also passes the suite; `pip check` is clean; `pip-audit` reports no known vulnerabilities in either lock file.
- **Run in GitHub Actions on Linux / Python 3.12 (master, run 37257873084): all six jobs green** - the suite on SQLite with the sandbox in-process and with every request through a real worker subprocess (the Linux rlimit memory/CPU path), the suite on **PostgreSQL 16**, `pip-audit` on both lock files, `trivy` on the repository (vulnerabilities + secrets) and on the built image (no fixable HIGH/CRITICAL after OS updates), and a container smoke test (migrate, 401/403/404 behaviour, tenant + key creation, a full analysis through the sandbox worker, tenant-scoped list). Not run anywhere: Terraform (still a skeleton), `trivy config` findings are informational, and nothing has been deployed to AWS.

## Stubbed / TODO (real work still needed)
- Extraction is a deterministic `Key: Value` parser; real carrier PDFs need layout-aware parsing/OCR and a hosted-model provider behind `ExtractionProvider` (placeholder `LLMExtractionProvider` raises NotImplementedError).
- No TMS/carrier-portal/EDI (204/210/214) integrations, no payments or credit-memo reconciliation, no email/portal dispute filing, no deadline tracking.
- No async job queue (analyses run synchronously; the `analyses` row already models the job lifecycle), no rate limiting, no malware scanning of uploads, no retention/deletion policy, only an application-level audit log line (no tamper-evident store). Naive timestamps are treated as facility-local (mixed naive/aware input is rejected; DST transitions on naive times are not modelled).
- Rules are one-directional per perspective (linehaul/fuel/total only flag overcharges), so a carrier-perspective run does not find under-billed linehaul.
- Rules are not validated against real closed files; accuracy numbers do not exist yet. Demand letters are drafts and are never sent automatically.

## Production foundation (what exists now)
- **Authentication + tenant isolation:** per-tenant API keys, stored only as an HMAC-SHA256 hash (keyed with a pepper held outside the DB); keys are shown once; revocable; auth runs before the request body is read. All persisted/retrieved data is scoped to the key's tenant (repository bound to one tenant; storage keys tenant-prefixed). Tests prove 401 / 403 / cross-tenant 404.
- **Persistence:** SQLAlchemy 2 + Alembic (`src/freight_recovery/db/`), SQLite for local/tests, PostgreSQL in compose/prod. Analyses are job + result records per tenant. Raw uploads sit behind a `StorageProvider` (local filesystem default; an **S3 stub** behind `FR_STORAGE_BACKEND=s3` *and* `FR_STORAGE_S3_ENABLED=true`, never exercised against real AWS, `boto3` is not a dependency).
- **Bounded parsing:** the whole pipeline runs in a separate worker process per request with a hard wall-clock timeout, a memory cap, a CPU limit, an output cap and a clean environment (no DB URL, pepper or AWS credentials). **This is process isolation, not a security sandbox**: full containment (seccomp, read-only root filesystem, no egress, dropped capabilities, per-task limits) is a deployment-layer concern, see `deploy/aws.md`.
- **Supply chain:** hash-locked requirements, hash-verified image install, digest-pinned base/Postgres images, SHA-pinned Actions, `pip-audit`, `trivy`, Dependabot.
- **Fail-safe configuration:** `FR_ENV=production` (the image default) refuses to start without a >=32-char `FR_API_KEY_PEPPER`, PostgreSQL, `FR_SANDBOX_MODE=process`, and with `FR_DOCS_MODE=open`.

## Running with auth + Postgres
Local, with Docker (API + PostgreSQL + one-shot migration; loopback only; public dev-only pepper/password):
```bash
docker compose up --build                       # db -> migrate -> api on http://127.0.0.1:8000
docker compose run --rm api python -m freight_recovery.admin create-tenant "Acme Logistics"
docker compose run --rm api python -m freight_recovery.admin issue-key "Acme Logistics" --label dev
#   prints the raw key ONCE (frk_<id>_<secret>); only its hash is stored. Lost key => issue a new one.
export KEY=frk_...                              # paste it

curl http://127.0.0.1:8000/health                                   # 200, no key needed
curl http://127.0.0.1:8000/v1/analyses                              # 401: no key
curl -H "X-API-Key: wrong" http://127.0.0.1:8000/v1/analyses        # 403: invalid key
curl -H "X-API-Key: $KEY" -F perspective=shipper \
     -F files=@tests/fixtures/ld5001/invoice.txt \
     -F files=@tests/fixtures/ld5001/rate_confirmation.txt \
     -F files=@tests/fixtures/ld5001/bol.txt \
     http://127.0.0.1:8000/v1/analyze                               # 200 + analysis_id
curl -H "X-API-Key: $KEY" http://127.0.0.1:8000/v1/analyses         # your analyses only
curl -H "X-API-Key: $KEY" http://127.0.0.1:8000/openapi.json        # docs_mode=auth in compose
```
Without Docker (SQLite file, from the repo root with the venv active):
```bash
export PYTHONPATH=src FR_ENV=dev FR_API_KEY_PEPPER=dev-pepper-not-a-secret-0123456789abcdef FR_DOCS_MODE=auth
python -m freight_recovery.db.migrate           # creates ./freight_recovery.db (Alembic upgrade head)
python -m freight_recovery.admin create-tenant "Acme Logistics"
python -m freight_recovery.admin issue-key "Acme Logistics"
uvicorn freight_recovery.api.main:app --app-dir src
```
Configuration (all `FR_*` environment variables; see `src/freight_recovery/config.py`):

| Variable | Default | Meaning |
|---|---|---|
| `FR_ENV` | `dev` (image: `production`) | `production` enforces the guard-rails above |
| `FR_DATABASE_URL` | `sqlite:///./freight_recovery.db` | e.g. `postgresql+psycopg://user:pass@host:5432/freight` |
| `FR_API_KEY_PEPPER` | empty | HMAC pepper for key hashes (>= 32 chars in production; secret) |
| `FR_DOCS_MODE` | `off` | `off` / `auth` / `open` (dev only) |
| `FR_STORAGE_BACKEND` | `local` | `local` or `s3` (stub; also needs `FR_STORAGE_S3_ENABLED=true`, `FR_STORAGE_S3_BUCKET`, optional `FR_STORAGE_S3_PREFIX`, `FR_STORAGE_S3_KMS_KEY_ID`) |
| `FR_STORAGE_LOCAL_DIR` | `./var/documents` | local-filesystem storage root |
| `FR_SANDBOX_MODE` | `process` | `process` (worker per request) or `inprocess` (dev/tests only) |
| `FR_SANDBOX_TIMEOUT_SECONDS` / `FR_SANDBOX_MEMORY_MB` | `30` / `1024` | hard wall-clock limit / memory cap beyond the worker's start-up footprint |
| `FR_SANDBOX_MAX_WORKERS` / `FR_SANDBOX_QUEUE_TIMEOUT_SECONDS` | `4` / `10` | concurrent workers / wait for a free slot before 503 |

Schema changes: edit `src/freight_recovery/db/tables.py`, run `alembic revision --autogenerate -m "..."` (uses `FR_DATABASE_URL`), review the generated file; a test fails if models and migrations drift. In deployment apply migrations as a one-shot step before the new version takes traffic (`python -m freight_recovery.db.migrate`), not from every app instance.

## Input hardening in place (since the pre-product review)
Request-body cap and per-file / file-count caps (checked before and while reading), bounded JSON fields on `/v1/analyze/text`, linear-time `Key: Value` parsing (no ReDoS), strict money parsing (NaN/Infinity/exponents rejected), PDF magic-byte check with page and wall-clock guards, parse/domain errors mapped to 4xx with fixed messages (no input echoed), untrusted values escaped in the Markdown packet and draft letter, compose bound to 127.0.0.1, base image pinned by digest, CI with least-privilege token and SHA-pinned actions. Regression and invariant tests live in `tests/test_regressions_*.py`; auth/tenant tests in `tests/test_auth_api.py`; persistence in `tests/test_persistence.py` and `tests/test_storage.py`; sandbox in `tests/test_sandbox.py`.

## Forecasting (roadmap)
**Future capability, not shipping.** Demand / lane-volume forecasting to help prioritize which lanes and shipments to work first for recovery. A dependency-free seasonal-naive / moving-average baseline exists now in `src/freight_recovery/forecast/` (tested, no extra deps). A neural backend (`neuralforecast`) is opt-in via `pip install ".[forecast]"`, is NOT yet validated, and is off by default. It needs real multi-series historical data and often only ties simple baselines. No accuracy figures exist. Not part of the core recovery flow.

## Before real customer data (NOT done; do not skip)
The software foundation above is necessary, not sufficient. Still required:
1. **Real integrations** to replace the stub extraction provider and the absent TMS/carrier-portal/EDI connections (with a data-processing/vendor review, redaction and prompt-injection defenses before any hosted LLM sees a document).
2. **Independent third-party penetration test** and threat model, run against a deployed staging stack. This repo's own tests and the internal pre-audit are not a substitute.
3. **Compliance sign-off** appropriate to the data (contract confidentiality/NDAs, privacy law, and SOC 2 readiness as customers demand): retention/deletion policy, data-processing agreements, residency, key-rotation procedure.
4. **Deployment-layer hardening** that code cannot provide: WAF + rate limiting, TLS, private networking, no-egress/seccomp/read-only-rootfs containers for the parser, KMS-encrypted RDS and S3, Secrets Manager, tamper-evident audit logging, alarms, backups/PITR. A complete, validated Terraform stack (the current one is a skeleton) is part of this.
5. Malware scanning of uploads, an async job queue for large documents, and PostgreSQL row-level security as defense in depth for tenant isolation.
6. Measured accuracy on a design-partner pilot (see the business docs): no accuracy figures exist yet.

---

# Web platform (TypeScript, pre-product, synthetic data only)

> **Status: pre-product, NOT production-ready, synthetic data only.** It has never been deployed, it has
> had no third-party penetration test, and it has never seen real customer data. A production start is
> **refused by the config validator** until a real mail transport exists: in production every
> `MAIL_TRANSPORT` value is rejected (`outbox` is a dev sink, `ses` is an unimplemented stub). The Docker images and the compose stack have
> never been built or started (the Docker engine was down for the whole build). Everything under
> "Before real customer data" above applies here too. Threat model and known gaps:
> [technical/web-platform-security.md](technical/web-platform-security.md). Architecture:
> [ARCHITECTURE.md, "Web platform"](ARCHITECTURE.md#web-platform-typescript-steps-1-2).

A multi-tenant web app for the evidence-packet workflow, built security-first. Build-order steps 1 to 4
are done:

- **Step 1:** email + password login (argon2id), a short-lived access token plus a rotating refresh
  cookie, TOTP MFA for Owner/Admin/platform roles, lockout with exponential backoff, CSRF protection,
  a strict CSP and security headers, rate limits, RBAC across 8 roles, fail-closed tenant isolation
  (PostgreSQL row-level security plus a Prisma guard), and a hash-chained, append-only audit trail.
- **Step 2:** a claims list (filter, sort, search), a claim detail sheet with the evidence-packet viewer,
  and the approvals human gate (approve / edit / reject / send, each with a reason).
- **Step 3:** document import (PDF, CSV, TXT, PNG, JPEG) with type sniffing, encrypted storage, parsing
  in an isolated worker process, deterministic field extraction with source pointers, a human review
  queue and commit to claims; plus CSV and Excel export of claims, packets and approval decisions with
  formula neutralization. See [Import and export (step 3)](#import-and-export-step-3).
- **Step 4:** an internal **Dev dashboard** for platform staff (pipeline health, request telemetry,
  filtered logs, feature flags, evaluation runs, platform audit; aggregates only, never customer data),
  **Recovery intelligence** for tenant users (a prioritised worklist, similar past claims and a
  provenance summary, all computed by fixed, documented rules over the tenant's own data), **tenant API
  keys** for machine access to nine routes, and a command-line **evaluation tool** (pass^k on synthetic
  fixtures). See [Dev dashboard, Recovery intelligence and API keys (step 4)](#dev-dashboard-recovery-intelligence-and-api-keys-step-4).

"Send" only marks a demand send-ready and audits it. No email is sent and no money moves. The seeded claims and
packets are synthetic and are transcribed from the Python CLI output on `tests/fixtures/`. Claims created
by import have no amounts or packet yet. OCR, email-forward ingestion, any learned model or LLM call, and
the TS port of the Python rules (build step 5, which will analyse imported claims) are later steps.

**The Python service and the `webapp/` pilot dashboard are unchanged and remain.** The web platform has
its own compose file (`compose.web.yml`), CI workflow (`.github/workflows/web-ci.yml`) and Terraform
(`infra/`, which supersedes `deploy/terraform/` for the web stack only). The root `docker-compose.yml`,
`ci.yml`, `src/`, `tests/`, `webapp/` and `deploy/` were not modified.

## Layout

| Path | What |
| --- | --- |
| `web/` | React 19 + TypeScript + Vite SPA (React Router, TanStack Query, Zustand, Tailwind) |
| `api/` | Node 22 + Fastify 5 + Prisma 7 (PostgreSQL 16) + Zod + Pino. Schema, migration and RLS SQL live in `api/prisma/`; DB roles in `api/db/init/00-roles.sql`; the synthetic seed in `api/scripts/seed.ts` |
| `packages/shared/` | `@fr/shared`: roles and the permission matrix (single source of truth), Zod DTOs, canonical JSON, text safety |
| `infra/` | Terraform skeleton for AWS (VPC, RDS, S3 + KMS, ECS Fargate, ALB + WAF, ElastiCache, Secrets Manager, CloudFront). `fmt` and `validate` only, **never applied**; see `infra/README.md` |
| `compose.web.yml` | Local stack: postgres, redis, minio, migrate, api, web (loopback only) |
| `.env.example` | Every variable, with placeholders. Placeholders are refused at start-up |

## Local quickstart (without Docker: the path that was actually verified)

Prerequisites: Node 22 (`.nvmrc` pins 22.23.3, the version in the digest-pinned `node:22-alpine` images;
`engines` allows `>=22.15.0 <23 || >=23.5.0 <25`: step 3 needs `module.registerHooks`, added in Node 22.15.0 /
23.5.0, for the parse sandbox guard, and the API refuses to start without it), PostgreSQL 16, and `openssl` (or Node, see below). Import/export also needs an
S3-compatible store (MinIO locally) and, for the parity tests, Python: see
[Local verification without Docker](#local-verification-without-docker).

```bash
npm ci --ignore-scripts                 # install scripts stay disabled (.npmrc)
npm run verify:no-install-scripts
npm run prisma:generate

# 1. Database roles + databases (once, as the Postgres superuser; .env.example assumes port 5433):
psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5433 -U postgres -f api/db/init/00-roles.sql

# 2. Environment: copy and replace EVERY <...> placeholder (the API refuses to start with them).
cp .env.example .env
openssl rand -hex 32        # JWT_SECRET      (hex is valid ...)
openssl rand -hex 32        # CSRF_SECRET
openssl rand -base64 48     # REFRESH_PEPPER  (... and so is base64)
openssl rand -base64 32     # MFA_ENC_KEY     (must be base64 of exactly 32 random bytes)
openssl rand -hex 32        # API_KEY_PEPPER  (step 4; optional outside production, required in production)
#   no openssl? node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
set -a; . ./.env; set +a    # the API and the seed read process.env only (no .env loader)

# 3. Schema + synthetic seed (owner role via MIGRATE_DATABASE_URL). The seed runs only with NODE_ENV=development|test
#    AND a loopback/compose DB host (127.0.0.1, localhost, ::1, postgres) or an explicit ALLOW_SEED=1; never RDS.
npm run db:migrate:deploy
npm run db:seed             # idempotent;  npm run db:seed -- --reset  wipes and recreates the seed tenants

# 4. Run (two terminals, each with the env loaded)
npm run dev -w api          # http://127.0.0.1:3001
npm run dev -w web          # http://127.0.0.1:5173 (proxies /api to the API)
```

Secret rules: `JWT_SECRET`, `CSRF_SECRET` and `REFRESH_PEPPER` must each be at least 43 characters and
must all differ. `API_KEY_PEPPER` (step 4), when set, must be at least 43 characters and differ from every
other secret; set but empty is refused everywhere, and when it is unset outside production the public
dev value is used. Placeholder-looking values are refused in every environment. In production the
documented dev/CI values are refused as well, and every secret must pass an entropy check whose
"one character dominates" rule is an exact binomial bound, so a truly random secret is wrongly refused
with probability below 10^-12. Random hex (`openssl rand -hex 32`) and base64 (`openssl rand -base64 48`)
both pass it. The full inventory, rotation procedures and the handover checklist are in
[docs/secrets.md](docs/secrets.md).

Seed accounts (synthetic, local only): `owner@acme.test`, `admin@acme.test`, `manager@acme.test`,
`reviewer@acme.test`, `analyst@acme.test`, `viewer@acme.test`, a second tenant `*@globex.test`, and the
platform users `dev@platform.test` and `super@platform.test`. The password is `Synthetic-Pass-2026!`.
Owner, admin and platform accounts need TOTP. The seed uses the public test secret
`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`, which you can add to any authenticator app. Reset and invite tokens
appear at `GET /api/v1/dev/outbox`. That route is dev only: it exists only with `ENABLE_DEV_OUTBOX=true`
outside production.

**With Docker (unverified):** `docker compose -f compose.web.yml up --build -d`, then seed with
`docker compose -f compose.web.yml run --rm api node dist/scripts/seed.js` and open
http://127.0.0.1:8080. This file passes `docker compose config`, but the images have never been built.
Treat the first run as a test.

## Import and export (step 3)

Step 3 lets staff upload freight documents, check what was read from them, turn accepted documents
into claims, and export claims, packets and approval decisions. Every uploaded file is treated as
hostile. Architecture: [ARCHITECTURE.md, step 3](ARCHITECTURE.md#web-platform-import-and-export-step-3).
Threats: section 6 of [technical/web-platform-security.md](technical/web-platform-security.md).

**Not in step 3:** OCR, any AI or LLM call, outbound email, and email-forward ingestion. Email
forwarding is **design only**; see [docs/design/email-ingest.md](docs/design/email-ingest.md).

### Who can do what

| Role | Import (upload, view, download, commit) | Review (resolve fields, accept or reject) | Export claims | Export packets and decisions |
| --- | --- | --- | --- | --- |
| OWNER, ADMIN, MANAGER, REVIEWER | yes | yes | yes | yes |
| ANALYST | yes | no | yes | no |
| VIEWER, PLATFORM_DEV, SUPER_ADMIN | no | no | no | no |

The permissions are `import:run`, `import:review`, `export:claims`, `export:packets` and
`export:outcomes`, defined in `packages/shared/src/rbac.ts`. The API enforces them on every request.
The UI only hides the controls.

### Formats and limits

- **Accepted files:** PDF (text layer only), CSV, TXT, PNG and JPEG. The type is read from the file's
  bytes, not from the browser's media type, and the extension must agree with it. Images are checked
  for structure and stored, but no text is read from them (no OCR), so they always go to review for
  manual entry.
- **Refused before storage:** files over 10 MiB (`413`); unknown or mismatched types; text files with
  binary control bytes; HTML, SVG, XML or PHP disguised as text; empty files (`415` with a reason code).
  Nothing is stored for a refused file.
- **Refused after parsing** (the document shows status `REJECTED` and its stored copy is deleted):
  malformed or encrypted PDFs, PDFs over 50 pages, more than 2,000,000 characters of text, malformed
  CSV, broken or oversized images, and parses that hit the time or memory limit.
- **Batches:** up to 10 files per batch. Uploading the same file twice into one batch returns `409`.
  The tenant storage quota is 1 GiB (`422 quota_exceeded`).
- **Uploads** send the raw file bytes (`POST /api/v1/imports/:batchId/documents?filename=...`,
  `Content-Type: application/octet-stream`). The browser uploads 2 files at a time and shows progress.

### What happens to an upload

1. The API streams the body with a hard size limit and computes its SHA-256.
2. It checks the file type from the bytes.
3. It stores the original in S3 under `t/<tenantId>/imports/...`, encrypted with SSE-KMS.
4. A separate, locked-down worker process parses the file. That process has no environment, no
   secrets, no network modules and no database access.
5. Deterministic rules extract fields from `Key: value` lines. Every field records where it came from
   (page, line, characters, CSV row and an excerpt).
6. The document ends up `ACCEPTED` (nothing to check), `NEEDS_REVIEW`, `REJECTED` or `FAILED`
   (infrastructure error). The upload response already contains this final state.

### Review flow

- A document goes to the **review queue** (`/import/review`) when a field is flagged, the type is
  unknown, no fields or no load number were found, it is an image, it duplicates an earlier upload, or
  some content could not be used.
- A reviewer (`import:review`) confirms, corrects or rejects each flagged field. For images the reviewer
  can also set the document type and type fields in by hand. The reviewer then accepts or rejects the
  whole document. Every decision needs a reason of at least 10 characters and is recorded in an
  append-only table and in the audit trail. Accepted documents cannot be changed.
- **Create claims from accepted documents** (on the Import page; you choose Shipper or Carrier) groups
  the accepted documents by load number. It creates a new claim with status **Awaiting analysis**, or
  links the documents to an existing claim. A new claim has no amounts and no evidence packet until the
  analysis step (build step 5) exists. A claim that already has a packet only gets the documents linked;
  its packet does not change.

**Confidence is a rule-based parse score, not an accuracy measure.** It says how the value was read (for
example 0.95 for an explicit `Key: value` line in a text or CSV file, 0.85 for a PDF, lower for a
guessed document type or an ambiguous date format). It does not say how likely the value is to be
correct, and the product never presents it as accuracy. Fields below 90% (`REVIEW_CONFIDENCE_THRESHOLD`)
need review, so every PDF field is reviewed by default.

### Exports

- **Claims list** (`Export` on `/claims`): the current filtered list. **Packets** (`Export packet` on a
  claim): one row per finding of the latest packet. **Decisions** (`Export decisions` on `/approvals`):
  one row per approval record.
- **Formats:** CSV (UTF-8 with BOM, CRLF, text cells quoted) or Excel `.xlsx` (one sheet, bold frozen
  header, typed numbers). Files are streamed; nothing is stored on the server. The limit is 50,000 rows
  per file (`422`, "Too many rows to export. Narrow your filters.").
- **Formula neutralization:** a text cell that would start with `=`, `+`, `-` or `@` (also the
  full-width forms), after any leading whitespace, is prefixed with `'`, so a spreadsheet shows it as
  text instead of running it. Control and invisible characters are removed first. Numbers stay numbers
  (`-12.50` is not changed). The `.xlsx` files contain no formulas, links or macros.
- **Content:** no user names, emails or ids, and no demand letter text. Money is USD with two decimals.
  `Invoice Date` is `YYYY-MM-DD`; other timestamps are ISO-8601 UTC.
- **Audit:** `export.started` is written before the first byte. `export.completed` records the row
  count, size and SHA-256 of the exact file sent. An interrupted download records `export.aborted`.

### Configuration (step 3)

All knobs are read once at start-up. Production floors and ceilings apply only with
`NODE_ENV=production`. `.env.example` lists them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMPORT_MAX_FILE_BYTES` | 10485760 | max bytes per file (production ceiling 26214400) |
| `IMPORT_MAX_FILES_PER_BATCH` | 10 | documents per batch (`409 batch_full`) |
| `TENANT_STORAGE_QUOTA_BYTES` | 1073741824 | bytes of non-rejected documents per tenant (`422`) |
| `UPLOAD_REQUEST_TIMEOUT_SECONDS` / `UPLOAD_IDLE_TIMEOUT_SECONDS` | 60 / 10 | whole-request timeout / no-bytes timeout during an upload (`408`) |
| `UPLOAD_MAX_CONCURRENT_PER_TENANT` / `EXPORT_MAX_CONCURRENT_PER_TENANT` | 4 / 2 | simultaneous uploads / exports per tenant **per API instance** (`429`) |
| `RATE_LIMIT_UPLOAD_MAX` / `RATE_LIMIT_EXPORT_MAX` | 60 / 10 | uploads / exports per user per 10 minutes (all limiters are off with `RATE_LIMIT_ENABLED=false`, which production refuses) |
| `PARSE_TIMEOUT_MS` | 20000 | wall clock per parse (production 1000..60000) |
| `PARSE_MEMORY_MB` | 256 | heap per parse (production 64..1024) |
| `PARSE_MAX_CONCURRENCY` / `PARSE_QUEUE_TIMEOUT_MS` | 2 / 5000 | parse jobs at once per instance / wait for a slot before `503 parser_busy` |
| `PARSE_MAX_OUTPUT_BYTES` | 25165824 | max size of a parse result |
| `PARSE_MAX_PDF_PAGES` / `PARSE_MAX_TEXT_CHARS` / `PARSE_MAX_IMAGE_PIXELS` | 50 / 2000000 / 50000000 | content limits (text ceiling 5000000) |
| `REVIEW_CONFIDENCE_THRESHOLD` | 0.90 | fields below this need review (0.50..1.00) |
| `EXPORT_MAX_ROWS` | 50000 | rows per export file (`422 export_too_large`) |
| `IMPORT_STALE_SECONDS` | 600 | a document stuck in `RECEIVED` this long is marked `FAILED` |
| `S3_SSE` / `S3_KMS_KEY_ID` | `aws:kms` / unset | encryption of stored documents; production refuses `none` and a missing key id |
| `PARSE_WORKER_ENTRY` | built worker | override for tests |

### Local verification without Docker

The Docker engine was broken on the build machine, so step 3 was verified with portable binaries. CI
(`.github/workflows/web-ci.yml`) is the authority for container builds. Keep all binaries outside the
repository and never commit them.

1. **PostgreSQL 16:** a portable PostgreSQL 16 on a free loopback port (the build used
   `127.0.0.1:55433`). Apply `api/db/init/00-roles.sql`, then migrate and seed as in the quickstart.
2. **MinIO with KMS:** download the Windows `minio.exe` from the official MinIO GitHub release and check
   its published SHA-256 before the first run (the build used `RELEASE.2025-09-07T16-13-09Z`). Start it
   on loopback with a static KMS key so that SSE-KMS works locally:
   ```bash
   export MINIO_ROOT_USER=localdev MINIO_ROOT_PASSWORD=localdev-minio-password   # public dev values
   export MINIO_KMS_SECRET_KEY="fr-dev-key:$(openssl rand -base64 32)"          # <key name>:<base64 of 32 bytes>
   ./minio.exe server ./minio-data --address 127.0.0.1:59000
   ```
3. **API environment for S3** (in the shell that runs the tests):
   ```bash
   export S3_ENDPOINT=http://127.0.0.1:59000 S3_FORCE_PATH_STYLE=true S3_REGION=us-east-1
   export S3_BUCKET=fr-documents-dev S3_ACCESS_KEY_ID=localdev S3_SECRET_ACCESS_KEY=localdev-minio-password
   export S3_SSE=aws:kms S3_KMS_KEY_ID=fr-dev-key      # S3_SSE=none is the dev-only fallback
   npm run ensure-bucket                               # creates the bucket, enables versioning
   ```
   `ensure-bucket` runs only with `NODE_ENV=development` or `test`. It refuses production and an unset
   `NODE_ENV`, because the AWS bucket is managed by Terraform.
4. **Python parity:** the parity suite runs the Python reference code. Set `PYTHON` to an interpreter
   that has the repository's runtime dependencies (for example the Python service's `.venv`). The test
   adds `PYTHONPATH=<repo>/src` itself. In CI (`CI=true`) a missing Python fails the suite; locally it is
   skipped with a message.
   ```bash
   export PYTHON=/path/to/.venv/Scripts/python    # Linux/macOS: .venv/bin/python
   ```
5. **Build, then test:** the parser worker is a build artifact, so build before the DB-backed suites.
   ```bash
   npm run build
   npm run test:integration
   npm run test:acceptance
   ```

Stop the portable services afterwards. With Docker, `compose.web.yml` starts MinIO with the same KMS
key name (`fr-dev-key`) and enables versioning (unverified locally).

### Python parity and registered divergences

The TypeScript parser is a port of the Python `ingest/` and `extraction/` code. The parity suite
(`api/test/parity/`, run by `npm run test:integration`) compares both on fixtures, generated text and
CSV files, and generated text-layer PDFs. These registered divergences are the only allowed
differences. The full register, with the rationale for each, is in
[ARCHITECTURE.md](ARCHITECTURE.md#python-parity-registered-divergences-d1-d8).

- **D1:** the PDF signature must be at byte 0 (Python allows 1024 junk bytes).
- **D2:** PDF text comes from pdf.js instead of pdfplumber. Parity holds only for simple text-layer PDFs.
- **D3:** the extension must match the sniffed type (Python looks at the extension only).
- **D4:** invalid UTF-8 adds `DECODE_REPLACEMENTS`. NUL, C0 control bytes (except tab, LF, CR, FF) and
  DEL (0x7F) reject the file as `binary_content`; Python would continue.
- **D5:** text over 2,000,000 characters is rejected (Python: 5,000,000).
- **D6:** string values are sanitized and capped at 200 characters (`SANITIZED_VALUE`).
- **D7:** only ASCII digits in dates and times, and only an ASCII `USD` suffix.
- **D8:** PNG and JPEG are accepted but yield no fields (no OCR); they go to manual review.

## Dev dashboard, Recovery intelligence and API keys (step 4)

Step 4 adds an internal dashboard for platform staff, explainable work aids for tenant users, tenant API
keys and an evaluation tool. Architecture:
[ARCHITECTURE.md, step 4](ARCHITECTURE.md#web-platform-dev-dashboard-recovery-intelligence-and-api-keys-step-4).
Threats: section 7 of [technical/web-platform-security.md](technical/web-platform-security.md). Secrets:
[docs/secrets.md](docs/secrets.md).

**Honesty rule.** Every number on these screens is computed from data the system holds at request time
(database rows, in-process counters of this API instance, or evaluation runs recorded by the tool), and
every number says what it is based on. There is **no learned model, no neural network, no cache, no
LLM or other "AI" call, and no accuracy or speed-up figure** anywhere. The brief's "Hebbian router",
"neural mesh" and "solved-problems cache (~250x)" are **not implemented**; what ships instead is listed in
[ARCHITECTURE.md, "Brief terms vs what is built"](ARCHITECTURE.md#brief-terms-vs-what-is-built).

### Who can see what

| Feature | OWNER | ADMIN | MANAGER | REVIEWER | ANALYST | VIEWER | PLATFORM_DEV | SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dev dashboard: Pipeline health, Telemetry (`platform:health`) | - | - | - | - | - | - | yes | yes |
| Dev dashboard: Logs, Feature flags, Evaluation (`platform:logs`, `platform:flags`, `platform:eval`) | - | - | - | - | - | - | yes | - |
| Dev dashboard: Audit, the platform audit chain (`platform:audit`) | - | - | - | - | - | - | - | yes |
| Recovery intelligence: worklist, similar claims, provenance (`claims:read`) | yes | yes | yes | yes | yes | yes | - | - |
| API keys: create, list, revoke (`apikeys:manage`) | yes | yes | - | - | - | - | - | - |

Platform users land on `/dev` and get no tenant links; a tenant user who opens `/dev` is sent to
`/claims`. The API enforces the same matrix (`packages/shared/src/rbac.ts`): a tenant route answers 403
to a platform user and a platform route answers 403 to a tenant user. Platform staff never see customer
data, and they can never see, create or revoke a tenant's API keys.

### Dev dashboard (`/dev`)

Every dashboard read is recorded in the platform audit chain (`platform.dashboard_viewed` or
`platform.logs_viewed`) **before** the data is returned; if that write fails, the request fails with no
data. The dashboard never refreshes by itself: each view is a deliberate click on "Refresh". Reads are
limited to `RATE_LIMIT_PLATFORM_MAX` (120) per user per 10 minutes.

- **Pipeline health** (`GET /api/v1/platform/pipeline?window=1h|24h|7d`). Counts across **all tenants**,
  read from the database at request time: documents by status and by detected type, rejections by
  reason, the rejected/failed/needs-review rates, upload-to-parse time (p50 and p95, interpolated over
  the documents of the window), review queue depth and oldest waiting time, documents stuck in
  `RECEIVED` longer than `IMPORT_STALE_SECONDS`, and claims awaiting analysis. A `SECURITY DEFINER`
  SQL function returns counts only: no tenant, user, file name or claim number. Files refused before
  storage (413/415) have no database row and show up only in Telemetry.
- **Telemetry** (`/dev/telemetry`). Counters of **this API instance since it started** (they reset on
  restart; with several instances each one has its own): requests by status class, 401/403/429 counts,
  and per route pattern (at most 200 patterns, the rest under `(other)`, unknown URLs under
  `(unmatched)`) a duration histogram with bucket bounds 5, 10, 25, 50, 100, 250, 500, 1000, 2500 and
  5000 ms. p50 and p95 are shown as the **upper bound of the bucket** they fall into, never as a point
  estimate. Also the parser sandbox counters and the **Intelligence components** table: `priority-v1`
  and `similar-v1`, each with Method "Fixed rules", Learned model "None", the flag state, calls, errors
  and duration bounds.
- **Logs** (`/dev/logs`). The most recent `LOG_BUFFER_SIZE` (500) log records of **this instance**, kept
  in memory and lost on restart. Only eight fields derived from the already-redacted log line are kept:
  time, level, request id, method, route **pattern**, status, duration and event. The event text is shown
  only when it matches `^[A-Za-z0-9 _.:/()-]{1,80}$`, contains no `@` and no run of 20 or more
  token-like characters; anything else shows as `(message withheld)`. No query string, concrete path,
  header, cookie, body, IP address, e-mail address, token, API key, file name or document value is ever
  shown. Filters: minimum level and an exact request id. Central log search stays with the cloud
  provider (the ECS log group in CloudWatch).
- **Feature flags** (`/dev/flags`). Exactly three global flags, all on by default:
  `intelligence.worklist`, `intelligence.similar_claims` and `intelligence.provenance`. They can switch
  off these three features only, never a security control, and there are no per-tenant overrides. A
  change needs a reason of at least 10 characters and the current version (a stale version answers
  409), and is written together with a `platform.flag_changed` audit event. It takes effect within
  `FLAGS_CACHE_TTL_MS` (5 seconds by default, per instance). If the flag table cannot be read, the flag
  counts as off.
- **Evaluation** (`/dev/evaluation`). Read-only list of the runs recorded by the evaluation tool (below),
  with per-case results.
- **Audit** (`/dev/audit`, SUPER_ADMIN only). The platform audit chain and a "Verify chain" button.

### Recovery intelligence (tenant users)

The "Intelligence" page (`/intelligence`) and two new claim-sheet tabs, "Similar" and "Provenance". All
three use **only this tenant's own data**, every view is recorded as `intelligence.viewed` in the
tenant's audit chain, they are limited to `RATE_LIMIT_INTELLIGENCE_MAX` (120) requests per user per 10
minutes, and a feature switched off by its flag answers 404.

**Prioritised worklist (`priority-v1`).** Claims in `PENDING_REVIEW` or `APPROVED` that have an evidence
packet are sorted by money. Confirmed recoverable dollars count in full; dollars still pending human
review count at **W = 25%**. W is a stated policy, not something learned from data (no recovery outcomes
exist to learn from); it is set by `INTELLIGENCE_PENDING_WEIGHT_PERCENT` and shown with every result.

```
priority score (cents) = recoverable + floor(pending_review * W / 100)      W = 25 by default
order: score (high first), then recoverable (high first), then waiting longest first, then claim id
```

Example: $1,000.00 confirmed and $400.00 pending gives $1,000.00 + $100.00 = **$1,100.00**. Each row
lists why it is where it is ("Confirmed recoverable $1,000.00 (counted at 100%)", "Pending human review
$400.00 (counted at 25%)", how many findings still need review, and "Waiting 3 days (not part of the
score)") and a next action (Resolve findings, Review and approve, Mark send-ready). The page states:
"This is a work-order aid, not a forecast of what will be recovered." Claims still `AWAITING_ANALYSIS`
are not ranked; the page counts them ("Not ranked: n claims awaiting analysis"). Until build step 5
analyses imported claims, a real tenant's worklist is empty; only the seeded demo claims rank.

**Similar past claims (`similar-v1`).** The open claim is compared with the 500 most recently updated
claims of the same tenant (`SIMILAR_CANDIDATE_LIMIT`) that the team has already decided (`APPROVED`,
`SEND_READY` or `REJECTED`) and that have a packet. Points (fixed weights, total 0-100):

| Signal | Points |
| --- | --- |
| Same carrier (case and extra spaces ignored) | 35 |
| Shared rules: 40 x (rules in both) / (rules in either), rounded down | 0-40 |
| Similar amount: 15 x (smaller total) / (larger total), rounded down | 0-15 |
| Same perspective (shipper or carrier) | 10 |

A claim is shown only with at least 30 points **and** the same carrier or at least one shared rule; the
best matches come first (ties: most recently updated). Each match lists its reasons, how the team
handled it (final status, rule ids, source document types, decision date) and the line "Computed in X ms
over N claims", which is the measured time of **that** request. There is no cache and no speed-up claim.
"Final status shows how your team handled the claim, not whether the carrier paid."

**Provenance.** For each document linked to the claim: extracted and manual field counts by review
status, unresolved flagged fields and the lowest confidence. "Confidence is a rule-based parse score, not
an accuracy measure."

### API keys (machine access)

- **Who.** OWNER and ADMIN manage keys under Settings > "API keys" (`/settings/api-keys`). A key belongs
  to one tenant; the tenant is taken from the key, never from the request.
- **Create.** Name, at least one scope, and an expiry of 30, 90, 180 or 365 days (**default 90**,
  `API_KEY_DEFAULT_TTL_DAYS`). Production never allows keys without expiry. You can only grant scopes
  whose permission you hold yourself. At most `API_KEY_MAX_ACTIVE` (20) active keys per tenant.
- **Shown once.** The full key appears only in the "API key created" dialog, with a Copy button.
  Closing the dialog clears it; the server stores only an HMAC-SHA-256 hash keyed with `API_KEY_PEPPER`,
  so nobody can show it again. A lost key is replaced by a new one. The list shows the public prefix
  `fr_live_<16 hex>` only.
- **Use.** Format `fr_live_<16 hex>_<43 characters>`, sent **only** as a header:
  ```bash
  curl -H "Authorization: Bearer $FR_API_KEY" http://127.0.0.1:3001/api/v1/claims
  ```
  Never put a key in a URL, query string, cookie or body: any request whose URL contains `fr_live_` is
  refused with 400 before anything else happens, and the value is never logged (the logger also
  replaces any `fr_live_...` string with `[REDACTED]`). Key requests need no CSRF token and never get
  cookies; if they carry an `Origin` header it must equal `APP_ORIGIN`.
- **Scopes and the nine routes that accept a key.** All other routes refuse a key with 403, even if it
  holds every scope: packets, approvals, review, commit, original download, packet and decision exports,
  users, audit, intelligence, `/features`, `/me`, auth, the platform routes, the key routes, and health.

  | Scope | Routes (under `/api/v1`) | Permission re-checked on every request |
  | --- | --- | --- |
  | `claims.read` | `GET /claims`, `GET /claims/:id`, `GET /claims/:id/documents` | `claims:read` |
  | `exports.claims` | `GET /exports/claims` | `export:claims` |
  | `imports.write` | `POST /imports`, `GET /imports`, `GET /imports/:batchId`, `POST /imports/:batchId/documents`, `GET /imports/:batchId/documents/:docId` | `import:run` |

- **Same rules as a user.** A key request runs through the same tenant isolation, permission checks,
  rate limits, flags and audit as a user of that tenant. Audit events show the actor role `API_KEY` and
  `viaApiKey: <key id>`; ownership columns get the creator's id. The **creator's current role** is checked
  on every request: if the creator is disabled or no longer holds the scope's permission, or the tenant
  is suspended, the key gets 401.
- **Failures.** Unknown key, wrong secret, malformed, revoked or expired: an identical 401 (nothing tells
  them apart). A valid key on a route it may not use: 403.
- **Revoke.** "Revoke <name>" with a reason of at least 10 characters. It takes effect on the very next
  request on every instance (key state is read from the database on every request, never cached).
- **Rotate.** Create a new key, switch the client, then revoke the old one. Rotating `API_KEY_PEPPER`
  invalidates every key at once (see [docs/secrets.md](docs/secrets.md)).
- **Rate limits.** `RATE_LIMIT_API_KEY_MAX` (300) requests per key per 60 seconds. Failed key
  authentications: `RATE_LIMIT_API_KEY_FAIL_MAX` (30) per client address per 10 minutes; after the 30th
  failure every further key request from that address, even with a valid key, gets 429 **before** any
  verification until the window ends. The step 3 upload and export limits apply too. "Last used" is
  updated at most once per minute.

### Evaluation tool (pass^k on synthetic fixtures)

```bash
npm run build      # the tool runs the built parser worker
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1   # the CI gate
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --json               # machine-readable output
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --record             # also store the run (needs DATABASE_URL)
```

Each case runs k times (1-20, default 3) through the **same** pre-store checks and the **same** sandboxed
parse job as the API, with no network and no database. A run counts as correct only if the result
matches the expected answer exactly (document type and every field, or the exact rejection reason).

- **pass^k** = the share of cases whose **all k runs** were correct. It punishes flaky behaviour: a case
  that is right 9 times out of 10 fails pass^k far more often than pass^1. The tool also reports the
  per-run pass rate, the pass^j curve for j = 1..k (an unbiased estimate), flaky and always-failing
  cases, how many cases gave byte-identical output on every run, and a Wilson 95% interval for pass^k.
- This extraction stage is deterministic, so pass^k equals pass^1 here, and the dashboard says so.
- **Synthetic fixtures only.** The set `api/eval/sets/extraction-v1` has 30 synthetic cases (9 with
  expected values from the Python reference, 9 expected rejections, 12 hand-written). Results are **not
  an accuracy measure** on real documents. The latest run: 30 of 30 cases passed all 3 runs, all
  deterministic, Wilson 95% interval 88.6%-100%. That only says the stage reproduces 30 known answers
  consistently.
- Exit codes: 0 success (and threshold met), 1 `--min-pass-hat-k` not met, 2 usage or manifest error, 3
  infrastructure error. Without `--record` nothing is written anywhere. `--record` writes the run and its
  case results in one transaction and appends `eval.run_recorded` to the platform audit chain; it never
  prints the database URL. CI runs the gate on every build.

### Configuration (step 4)

All knobs are read once at start-up and range-checked; production limits apply only with
`NODE_ENV=production`. `.env.example`, `compose.web.yml` and `infra/ecs.tf` list them.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOG_BUFFER_SIZE` | 500 | log records kept in memory for the Logs tab (50..5000) |
| `FLAGS_CACHE_TTL_MS` | 5000 | per-instance flag cache (0..60000; production ceiling 30000; 0 = no cache) |
| `INTELLIGENCE_PENDING_WEIGHT_PERCENT` | 25 | W, the weight of pending-review dollars in the worklist (0..100) |
| `SIMILAR_CANDIDATE_LIMIT` | 500 | past claims compared per "Similar" request (10..2000) |
| `RATE_LIMIT_PLATFORM_MAX` / `RATE_LIMIT_INTELLIGENCE_MAX` | 120 / 120 | dashboard / intelligence requests per user per 10 minutes |
| `API_KEY_PEPPER` | dev value outside production | HMAC key for stored API key hashes; **secret**, required in production (see [docs/secrets.md](docs/secrets.md)) |
| `API_KEY_MAX_ACTIVE` | 20 | active keys per tenant (1..200) |
| `API_KEY_DEFAULT_TTL_DAYS` | 90 | default expiry (1..365) |
| `API_KEY_ALLOW_NON_EXPIRING` | true outside production | keys without expiry; must be false in production |
| `RATE_LIMIT_API_KEY_MAX` | 300 | requests per key per 60 seconds |
| `RATE_LIMIT_API_KEY_FAIL_MAX` | 30 | failed key authentications per client address per 10 minutes |

## Tests and checks

```bash
npm run typecheck
npm run lint                 # --max-warnings 0
npm test                     # unit tests (shared, api, web); no database needed
npm run ensure-bucket        # step 3: create the dev/test bucket in MinIO (S3_* env; refuses production)
npm run build                # shared + api + web (+ dist check: no inline script/style, no sourcemaps);
                             # builds the parser worker, so run it BEFORE the integration/acceptance suites
npm run test:integration     # api, against a migrated + seeded test DB (TEST_DATABASE_URL, TEST_ADMIN_DATABASE_URL,
                             # and the same MFA_ENC_KEY the seed used), S3 (MinIO) and Python (PYTHON=...) for the
                             # parity suite; see the env block in .github/workflows/web-ci.yml
npm run test:acceptance      # black-box acceptance suites under */test-acceptance/ (when present)
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1   # step 4: after npm run build
npm run audit && npm audit signatures
terraform -chdir=infra fmt -check -recursive && terraform -chdir=infra init -backend=false && terraform -chdir=infra validate
```

What was actually run (2026-10-08, Windows, Node 24, portable PostgreSQL 16.15): typecheck, lint, unit
tests (shared 30, api 83, web 29), integration (3/3), build, `npm audit` (0 vulnerabilities),
`npm audit signatures`, migrate + seed, and terraform fmt/validate (portable 1.16.5). The independent
acceptance run gave 334 passed, 0 failed, 5 skipped, 2 todo. **Not run:** the Docker images or compose
stack, Playwright end-to-end tests, and any AWS deployment.

Step 3 (2026-10-09, Windows, Node 24 plus a Node 22.23 check of the worker, portable PostgreSQL 16.15,
portable MinIO with SSE-KMS, Python 3.14 and 3.12 for parity): typecheck, lint, unit tests (shared 113,
api 279, web 46), migrate + seed, `ensure-bucket`, build, integration (55 passed, 2 placeholder skips),
`npm audit` (0 vulnerabilities), `npm audit signatures`, terraform fmt/validate. Parity with the Python
reference: zero unregistered differences. Independent acceptance run (round 2): shared 22/22, web 87
passed (1 Playwright skip), api 500 passed; the 3 api failures were this documentation (since added) and
two test bugs that were fixed and re-run. **Not run:** container images and the compose stack,
Playwright, the forced audit-failure export test, encrypted-PDF tests (no `qpdf`), any AWS deployment.

Step 4 (2026-10-09, run `REQ-20261009-step4-intelligence`, Windows, Node 22.23.3 (the CI version) and
Node 24.21.0, portable PostgreSQL 16, portable MinIO with SSE-KMS, Python for parity, in the
`web-ci.yml` step order with its environment): lint, typecheck, unit tests (shared 134, api 346, web
62), migrate + seed, `ensure-bucket`, build, the evaluation gate (30 of 30 cases pass all 3 runs),
integration (85 passed, 2 placeholder skips). Independent acceptance run (round 2): shared 33/33, web
138 passed (1 skip), api 651 passed (9 skipped for missing tools or declared skips, 2 todo). Round 1 had
found six defects (D-1..D-6); all were fixed and re-verified. **Not run:** container images and the
compose stack, Playwright, terraform in the test run (the builder ran fmt/validate), any AWS deployment.
