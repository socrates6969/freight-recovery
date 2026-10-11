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

A multi-tenant web app for the evidence-packet workflow, built security-first. Build-order steps 1 to 7
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
- **Four-eyes (after step 4):** the person who edited a revision cannot approve or reject it; the person
  who uploaded, corrected or added fields to a document cannot accept it. See
  [Four-eyes (separation of duties)](#four-eyes-separation-of-duties).
- **Step 5:** **claim analysis**. The Python rules and the draft demand letter are ported to TypeScript
  (string-identical output to the Python reference on a parity corpus, apart from six registered
  divergences). An **Analyze** action turns an imported claim that is awaiting analysis into evidence
  packet revision 1 for human review; a bulk action analyzes up to 10 at a time. See
  [Claim analysis (step 5)](#claim-analysis-step-5).
- **Step 6:** **charge suggestions and team labels**. A Charges tab suggests a category for each invoice
  charge line by comparing it with labelled examples (175 charge names from six public carrier tariffs,
  plus your team's labels); reviewers confirm or correct it, and later analyses use the labels. The
  analysis can add review-only findings for possible unauthorized accessorials, and moves detention
  findings to review when a line looks like detention under another name. Suggestions are not verified
  and never confirm an amount. See [Charge suggestions and team labels (step 6)](#charge-suggestions-and-team-labels-step-6).
- **Step 7:** **fuel check and cost outlook**. Organizations store their carriers' fuel-surcharge tables;
  for a claim with a ship date and miles, the analysis recomputes the surcharge from the public weekly U.S.
  diesel price and adds a review-only finding when the bill differs. Public price history (U.S. EIA diesel
  and BLS truckload index via FRED) lives in global, append-only tables that only an owner-run importer
  writes. An Outlook page shows diesel and truckload index forecasts only at horizons where a model beat
  "no change" in a walk-forward backtest, with 80% ranges; backtested on public data, not a guarantee. See
  [Fuel check and cost outlook (step 7)](#fuel-check-and-cost-outlook-step-7).

"Send" only marks a demand send-ready and audits it. No email is sent and no money moves. The seeded claims and
packets are synthetic and are transcribed from the Python CLI output on `tests/fixtures/`. Claims created
by import have no amounts or packet until someone runs the analysis (step 5). Findings are rule outputs on
extracted fields and are drafts that need human review. Step 6 charge suggestions compare names with
labelled examples; there is no trained model. Step 7 fuel findings are recomputations from tables and
inputs that people enter, and the cost outlook is backtested on public data, not a guarantee. OCR,
email-forward ingestion and any LLM call are later steps.

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
  append-only table and in the audit trail. Accepted documents cannot be changed. The person who
  uploaded a document, or corrected or added any of its fields, cannot accept it; another reviewer must
  ([four-eyes](#four-eyes-separation-of-duties)).
- **Create claims from accepted documents** (on the Import page; you choose Shipper or Carrier) groups
  the accepted documents by load number. It creates a new claim with status **Awaiting analysis**, or
  links the documents to an existing claim. A new claim has no amounts and no evidence packet until
  someone analyzes it ([Claim analysis (step 5)](#claim-analysis-step-5)). A claim that already has a
  packet only gets the documents linked; its packet does not change.

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
This rule covers the step 4 screens. Step 6 later added charge-line suggestions on the claim sheet: a
nearest-example comparison with labelled charge names, with no trained model and no LLM call (see
[Charge suggestions and team labels (step 6)](#charge-suggestions-and-team-labels-step-6)). Step 7 added an
Outlook page: a small autoregressive model on public price indexes, refitted from the stored history and
shown only where its walk-forward backtest beat "no change", with the backtest figures next to every number
(see [Fuel check and cost outlook (step 7)](#fuel-check-and-cost-outlook-step-7)).

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
are not ranked; the page counts them ("Not ranked: n claims awaiting analysis"). An imported claim
enters the worklist once it has been analyzed ([Claim analysis (step 5)](#claim-analysis-step-5)).

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
  `viaApiKey: <key id>`; ownership columns get the creator's id (so the creator counts as the uploader
  of a key upload and cannot accept that document). The **creator's current role** is checked
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

## Four-eyes (separation of duties)

Run `REQ-20261009-four-eyes` makes two decisions need a second person. The server enforces it; the
screens only hide the button.

- **Claims.** Whoever created any revision of a claim's evidence packet (the current one or an older one)
  cannot approve or reject the claim. Another user with approval rights must do it. A seeded revision 1
  has no recorded creator and excludes nobody. Since step 5, the person who runs the analysis is recorded
  as the creator of revision 1 (see [Claim analysis (step 5)](#claim-analysis-step-5)). Marking an approved revision send-ready is
  unchanged: the approver may do it, and so may an author once someone else has approved.
- **Imported documents.** Whoever uploaded a document, or corrected or added any of its fields, cannot
  accept it. Another reviewer must. Confirming a field, rejecting a field, changing the document type
  and rejecting the document do not count and stay open to everyone with review rights. A document
  uploaded with an API key counts as uploaded by the key's creator.
- **What you see.** On `/approvals` the row shows "You edited this revision. Another approver must
  approve it." instead of Approve/Reject. In the review dialog, "You uploaded or edited this document.
  Another reviewer must accept it." replaces Accept document. If you try anyway (an old screen or a
  second tab), the API answers 403 `four_eyes_required` ("A different person must make this decision."),
  changes nothing, and records the attempt in the audit trail as `authz.four_eyes_denied`. API callers
  get exactly the same answer.
- **Where it is enforced.** A check in the API service, under the same row lock as the decision, plus
  database triggers from migration `20261011000000_four_eyes` that refuse such a decision row even if the
  service check were skipped.
- **Not covered (accepted for now).** A document with no review reasons is accepted automatically, so it
  has no human acceptor. Feature-flag changes are single-person. The full list of residual risks and the
  policy defaults is in [technical/web-platform-security.md, section 8](technical/web-platform-security.md#8-four-eyes-separation-of-duties).

## Claim analysis (step 5)

Run `REQ-20261010-step5-analysis` closes the loop from import to review: import -> review -> create claims
-> **analyze** -> evidence packet revision 1 -> approval by a second person. Architecture:
[ARCHITECTURE.md, claim analysis](ARCHITECTURE.md#web-platform-claim-analysis-step-5). Threat model and
residual risks: [technical/web-platform-security.md, section 9](technical/web-platform-security.md#9-step-5-claim-analysis).

**What the analysis is, and what it is not.** It runs the fixed rules of the Python reference service
(duplicate charge lines, linehaul and fuel above the rate confirmation, accessorials not listed as
authorized, invoice total above the sum of its lines, detention earned versus billed) on the field values
of the claim's accepted documents, and writes a draft demand letter. Findings are **deterministic rule
outputs on extracted fields. They are drafts that need human review, not verified results.** The
confidence shown on a finding is a fixed number per rule, not a measured probability, and nothing here
claims accuracy. The evaluation gate (step 4) runs on synthetic fixtures and is not an accuracy measure.

### Who can analyze

| Role | Analyze one claim, analyze awaiting claims |
| --- | --- |
| OWNER, ADMIN, MANAGER, REVIEWER, ANALYST | yes |
| VIEWER, PLATFORM_DEV, SUPER_ADMIN | no |

The permission is `claims:analyze` in `packages/shared/src/rbac.ts`. API keys cannot call either route
(403 `forbidden`), whatever their scopes.

### Analyze one claim

1. Open a claim with status **Awaiting analysis** (`AWAITING_ANALYSIS`). It needs at least one linked
   document with status Accepted.
2. On the **Summary** or the **Evidence** tab, select **Analyze claim**. The section says: "Runs fixed
   rules on the accepted document fields. Findings are drafts for human review, not verified results."
   and "You will be recorded as the author of revision 1, so another approver must approve it."
3. On success the toast reads "Analysis complete. Revision 1 is ready for review." and the Evidence tab
   shows revision 1: sources, findings with citations back to the document lines, a timeline and the draft
   letter. The claim is now **Pending review** (`PENDING_REVIEW`) with its amounts, and it appears in `/approvals` and in the
   intelligence worklist.

If the analysis is refused, the section shows a fixed message: 409 "This claim is no longer awaiting
analysis or has no accepted documents. Reload to continue.", 422 "The extracted values of this claim cannot
be analysed automatically.", 403 "You do not have permission to analyze claims.", 429 "Too many requests.
Try again later.", anything else "Analysis failed. Try again." A refused analysis changes nothing.

A 422 means the rules refused the input (for example a malformed amount or date) or the result cannot be
stored (a negative amount, or more than 2,147,483,647 cents). The claim stays Awaiting analysis. Accepted
documents cannot be edited, so such a claim needs a new import of corrected documents (see the residual
risks).

### Analyze awaiting claims (bulk)

On the claims page, **Analyze awaiting claims** opens a dialog ("Analyzes up to 10 claims awaiting
analysis, oldest first."). **Analyze** sends one request with `{ "limit": 10 }` and shows a summary such
as "Analyzed 8. Skipped 1. Could not analyze 1. 4 still awaiting analysis.", plus the claim numbers that
could not be analyzed.

- The API accepts `limit` 1..25 (default 10) and looks at no more than `min(4 x limit, 100)` candidates:
  claims awaiting analysis with at least one accepted document, oldest first.
- Each claim is analyzed in its own transaction, exactly like the single action. A claim someone else
  analyzed in the meantime is **skipped**; a claim that gets 422 is **could not analyze**. Claims already
  analyzed stay analyzed if a later one fails.
- **Rate budget.** Both routes share your per-user `analysis` budget (`RATE_LIMIT_ANALYSIS_MAX`, default
  30 per 10 minutes). A bulk request uses one unit for the first claim it tries and one more unit for every
  further claim it tries, including claims that are skipped or could not be analyzed. When the budget runs
  out, the run stops early and still answers normally: the claims it did not try stay Awaiting analysis
  and are counted in "still awaiting analysis". The dialog does not say that the budget stopped the run;
  wait for the window to pass and run it again. When the budget is already empty, the request gets 429.
- A claim that keeps failing with 422 stays a candidate. Because the bulk run takes the oldest claims
  first, it is tried (and charged) again on every run until it is re-imported.

### Four-eyes after analysis

The person who runs the analysis (single or bulk) is recorded as the author of revision 1. Four-eyes then
refuses their approve or reject of that claim, and `/approvals` shows them "You edited this revision.
Another approver must approve it." (the existing four-eyes text). Another approver must decide. The people
who uploaded or edited the claim's documents are **not** counted as claim authors; document four-eyes
already required a second person to accept those documents, except for documents accepted automatically
at upload.

### API

| Route | Body | Success |
| --- | --- | --- |
| `POST /api/v1/claims/:id/analyze` | `{}` (or no body) | 201: `claim` (status and amounts in cents), `packet` (id, revision 1, content hash), `analysis` (`rulesVersion: "rules-v1"`, findings counts) |
| `POST /api/v1/claims/analyze-awaiting` | `{ "limit": 1..25 }` (optional, default 10) | 200: `limit`, `examined`, `analyzed[]`, `skipped[]`, `failed[]`, `remaining` |

Both routes need a signed-in user (API keys are refused) and go through the same Origin and CSRF checks as
every other mutating route. Each successful
analysis is recorded in the tenant audit chain as `claim.analyzed`; each bulk request also writes one
`claim.bulk_analyzed` summary (counts only).

### Configuration (step 5)

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATE_LIMIT_ANALYSIS_MAX` | 30 | analyses per user per 10 minutes, shared by the single and the bulk route (1..100000; off only with `RATE_LIMIT_ENABLED=false`, which production refuses) |

The rule settings are fixed in this step: 15-minute detention increments, a tolerance of $0.01 and a
90-day dispute window (the Python defaults). They are not configurable.

### Not covered (accepted for now)

Analysis does not run automatically when claims are created; the bulk action is the automation. A
document linked to a claim after its analysis is not cited by revision 1. Documents accepted
automatically at upload feed the analysis like reviewed ones. The full list of residual risks is in
[technical/web-platform-security.md, section 9.5](technical/web-platform-security.md#95-accepted-residuals-step-5).

## Charge suggestions and team labels (step 6)

Run `REQ-20261011-charge-intelligence` adds suggestions for the category of invoice charge lines, a label
memory for your team, and review-only findings in the analysis. Architecture:
[ARCHITECTURE.md, charge intelligence](ARCHITECTURE.md#web-platform-charge-intelligence-step-6). Threat
model and residual risks:
[technical/web-platform-security.md, section 10](technical/web-platform-security.md#10-step-6-charge-intelligence).

**Why.** The fixed rules recognise a charge line by keywords. On 175 charge names from six public carrier
tariffs, they recognised 19 of the 159 accessorial names. A line the rules do not recognise is never
checked against the rate confirmation's authorized accessorials.

**What a suggestion is, and what it is not.** The classifier compares a charge name with labelled examples
(character and word overlap, nearest example) and suggests that example's category when the similarity
is at least 0.30. Below that it shows "No suggestion". The examples are 175 charge names from six public
carrier tariffs (names only, with attribution) and your team's labels. There is no trained model, no LLM
call and no network call. A suggestion is not verified. It can only add an item for human review and
never confirms an amount. The evaluation in CI is a regression check on the public tariff names, not an
accuracy measure on invoices.

**Data provenance.** The 175 names are copied from public rules tariffs of XPO, Estes, Dohrn, Magnum,
Gardewine and States Logistics; the sources and URLs are in `packages/shared/src/charge-intel/seed-v1.ts`.
No rates, customers, shipments or invoices are stored. Using these real public names is an owner decision
of 2026-10-10/11. The rule "synthetic data only" in `CLAUDE.md` has not been changed; adding a dated
exception there is an open question for the owner (OQ1).

### Who can do what

| Role | See the Charges tab and labels | Confirm or correct a category (team label) |
| --- | --- | --- |
| OWNER, ADMIN, MANAGER, REVIEWER | yes | yes |
| ANALYST, VIEWER | yes | no |
| PLATFORM_DEV, SUPER_ADMIN | no | no |

The permission is `charge_labels:manage`. Reading needs `claims:read`. API keys cannot call the charge
routes (403). ANALYST cannot label because a label changes later analyses for the whole organization.

### The Charges tab

Open a claim and select **Charges**. The tab lists every invoice charge line of the claim's accepted
documents, in any claim status. It starts with: "Suggestions compare each charge name with labelled
examples: public carrier tariff charge names and your team's labels. They are not verified. A suggestion
only adds items for human review; it never confirms an amount." Per line you see:

- the description and the amount;
- `Rules: <category>`: what the fixed rules call the line;
- `Suggested: <category> (0.xxx)` with the similarity, or `No suggestion`;
- `Nearest example: '<name>' (<source>)`: the public tariff or "Your team's label";
- `Team label: <category>` when your team has labelled this wording.

With `charge_labels:manage` you also get **Confirm <category>** (when there is a suggestion that differs
from the team label) and a **Category** list with **Save label**. On success: "Label saved. It applies to
future analyses." Errors show a fixed text: "You do not have permission to label charges." (403), "This
organization has reached the maximum number of charge labels." (409), "Too many requests. Try again
later." (429), otherwise "Could not save the label. Try again." The controls are disabled for a
description the server would refuse (over 200 characters, control or bidirectional characters, or nothing
left after normalization).

**How a label works.** A label is stored per organization for the normalized wording (lower case,
punctuation removed): one label per wording, the latest one wins. It is used immediately by the Charges
tab and by every later analysis, for that exact wording and, through similarity, for similar wordings.
Packets already created do not change. A label never changes what the fixed rules decide: it only matters
for lines the rules call `other`. An organization can hold at most 2,000 labels. Each change is recorded in
the audit trail (`charge_label.set`, `charge_label.deleted`) with the label id, the category and a SHA-256
of the wording, never the wording itself.

### What changes in the analysis

Only for invoice lines that the fixed rules call `other`:

- **Possible unauthorized accessorial.** If the nearest example is an accessorial, the claim has a rate
  confirmation, the line is not listed there as authorized, and its amount is not the contracted linehaul
  or fuel amount, the analysis adds the finding `LRN-ACCESSORIAL-REVIEW` ("Possible unauthorized
  accessorial (suggestion)"). It always needs human review, has a fixed confidence of 0.5 (not a
  probability), counts only in the pending-review total, and never appears in the draft letter. Its text
  names the nearest example and ends with "Suggestion only - verify before disputing."
- **Detention under another name.** If the nearest example is detention, the analysis creates no new
  amount. Instead, the detention findings "unbilled" and "under-billed" (`DET-UNBILLED`, `DET-UNDERBILLED`)
  are switched to needs-human-review, with a step "Possible detention billed under another name: ...
  Confirm before claiming." Their amount moves from the recoverable total to the pending-review total and
  out of the draft letter until a reviewer confirms.

Everything else is exactly as in step 5. The analysis response adds `classifierVersion`,
`learnedFindingsCount` and `reviewFlagsCount`; `claim.analyzed` also records which team labels influenced
the result (`learnedLabelIds`).

### API

| Route | Permission | Success |
| --- | --- | --- |
| `GET /api/v1/claims/:id/charge-lines` | `claims:read` | 200: lines with rule category, suggestion and team label |
| `GET /api/v1/charge-labels?page=1&pageSize=25` | `claims:read` | 200: the organization's labels (`pageSize` 1..100) |
| `PUT /api/v1/charge-labels` | `charge_labels:manage` | 200: `{ "label": ..., "outcome": "created" \| "changed" \| "unchanged" }`; body `{ "description": "...", "category": "accessorial" }` |
| `DELETE /api/v1/charge-labels/:id` | `charge_labels:manage` | 204 |

All four use the per-user `intelligence` rate limit (`RATE_LIMIT_INTELLIGENCE_MAX`, default 120). The PUT
and DELETE go through the same Origin and CSRF checks as every other mutating route. 409
`label_limit_reached` when the organization already has 2,000 labels (changing an existing label is always
allowed).

### Switching it off

Platform staff can switch off the flag **`intelligence.charge_suggestions`** ("Charge-line suggestions and
team labels", on by default) on the Dev dashboard's Flags tab. Off: the analysis is exactly step 5, the
four routes answer 404 and the Charges tab disappears. Labels stay stored and are used again when the flag
is switched back on.

### Evaluation (seed-set regression check)

```bash
npm run build
npm run eval:charges -- --min-top1 173 --min-accessorial-top1 158 --min-accessorial-recognised 145 --max-wrong-suggested 1
```

It classifies each of the 175 public tariff names using only the other five carriers' names (no
database, no network, nothing recorded). Today: nearest example right for 173 of 175; at the 0.30
threshold 161 suggested (160 right, 1 wrong) and 14 without a suggestion; accessorial names recognised 145
of 159, against 19 of 159 for the keyword rules. CI runs exactly this command; the bounds equal today's
numbers, so a change that lowers them fails the build. `--json` prints the full report. These numbers are
about tariff names, not invoices: they are a regression check on this seed set, not an accuracy measure.

### Detention by tariff terms (not used yet)

`computeTariffDetention` in `@fr/shared` computes detention the way carrier tariffs state it: free time,
billing increments rounded up ("or fraction thereof") or down, a rate per increment, and a minimum and
maximum charge. Example (XPO tariff terms: 60 minutes free, $72.25 per 15 minutes or fraction, minimum
$95.50): 08:00 to 09:20 is 2 increments, $144.50. **The analysis does not use it yet**: reading these terms
from rate confirmations is a later step, so detention is still computed with the step 5 rules.

### Not covered (accepted for now)

Generic linehaul wordings such as "Freight charges" are close to accessorial names in the seed until your
team labels them; only the contracted-amount check and human review stop a wrong finding. Labels are per
organization, not per carrier or customer. The seed has few linehaul (1) and fuel (3) names. A reviewer
who can label can, by labelling a line as detention, move detention findings of later analyses to review
(it is audited and attributable, and it never creates money). The full list is in
[technical/web-platform-security.md, section 10.5](technical/web-platform-security.md#105-accepted-residuals-step-6).

## Fuel check and cost outlook (step 7)

Run `REQ-20261011-fuel-outlook` adds a fuel-surcharge check to the analysis, a store of public price data,
and a cost outlook. Architecture:
[ARCHITECTURE.md, step 7](ARCHITECTURE.md#web-platform-fuel-check-public-price-data-and-cost-outlook-step-7).
Threat model and residual risks:
[technical/web-platform-security.md, section 11](technical/web-platform-security.md#11-step-7-fuel-check-public-price-data-and-cost-outlook).

**What it is, and what it is not.**

- **Fuel check.** Your organization stores its carriers' fuel-surcharge (FSC) tables. For a claim, a
  reviewer enters the ship date, the miles and the table. The analysis then takes the public weekly U.S.
  average diesel price that applies to the ship date, recomputes the surcharge exactly and compares it with
  the billed fuel lines. A difference becomes a finding **for review** ("Fuel surcharge differs from the
  fuel table (review)") that shows the price week, the table row and every step of the arithmetic, and says
  so when the bill matches a neighbouring week's price. It never confirms an amount and never appears in the
  draft letter.
- **Cost outlook.** A page with diesel at 1, 4, 8 and 13 weeks and the long-distance truckload producer
  price index at 1 month, each with an 80% range. A model forecast is shown only where it beat "no change"
  in a walk-forward backtest on the public history; elsewhere the page shows "no change" with a range. It
  is **backtested on public data 2011-2026 (diesel) and 2009-2026 (truckload index); not a guarantee.** It
  forecasts national indexes, not your lane rates: on lane-level rates "no change" was not beaten in our
  tests, so no lane forecast is offered.

**Data provenance.** The price history comes from FRED (Federal Reserve Bank of St. Louis): U.S. Energy
Information Administration weekly diesel (`GASDESW`) and U.S. Bureau of Labor Statistics PPI
`PCU4841214841212`, both marked "Public Domain: Citation Requested" on FRED. The bundled copy is in
`api/data/public-prices/` with sha256 values and citations. It contains no customer, carrier or shipment
data. Committing this real public data is an owner decision of 2026-10-11; the rule "synthetic data only" in
`CLAUDE.md` has not been changed, and adding a dated exception there is an open question for the owner
(OQ1).

### Who can do what

| Role | See fuel tables, the Fuel tab and the Outlook | Add, edit, archive fuel tables | Enter or clear fuel inputs on a claim |
| --- | --- | --- | --- |
| OWNER, ADMIN | yes | yes | yes |
| MANAGER, REVIEWER, ANALYST | yes | no | yes |
| VIEWER | yes | no | no |
| PLATFORM_DEV, SUPER_ADMIN | no | no | no |

The permissions are the existing ones: `settings:manage` for tables, `claims:analyze` for inputs,
`claims:read` for reading. API keys cannot call any of these routes (403).

### Add a fuel table

Open **Fuel tables** (`/settings/fuel-tables`). The page starts with "Fuel tables are your carriers'
surcharge schedules. The fuel check applies them to the public weekly U.S. diesel price." With
`settings:manage`, **Add fuel table** and choose:

| Kind | Fill in | Rate |
| --- | --- | --- |
| Step, above base | base price, step size, rate per step | one step for each step size or part of it above the base (the classic "1 cent per mile for every 6 cents above $1.20") |
| Step, from base | base price, step size, rate per step | the first step starts at the base price (tables like "from $1.12, +1 cent per 5 cents") |
| MPG | base price, miles per gallon, 2-4 decimals | (price - base) / mpg, rounded half up; per mile only |
| Rows | one `atLeast,rate` pair per line (up to 200) | the rate of the last row whose price is at or below the diesel price |

The unit is **per mile** or **percent** (of the contract linehaul from the rate confirmation, otherwise of
the invoice's linehaul lines). **Week rule:** by default the Monday price applies Wednesday to Tuesday (the
GSA rule); a table can shift this by 0 to 6 days (0 = Monday to Sunday). Names must be unique in your
organization. An organization can create at most 50 tables, archived ones included. A table in use is
archived, not deleted; editing it raises its version, and the analysis records the version and a sha256 of
the parameters it used.

### Enter fuel inputs on a claim

Open a claim that is **awaiting analysis** and select **Fuel**. Enter the **Ship date**, the **Miles** (one
decimal, 0.1 to 10,000; not needed for a percent table) and the **Fuel table**, then **Save fuel inputs**
("Fuel inputs saved. They apply when the claim is analysed."). **Clear fuel inputs** removes them. After
analysis the inputs are locked ("Fuel inputs can only change before the claim is analysed."). The tab shows
the check at any time as a preview: the status, the posted date and price, expected, billed, difference and
the calculation. It never changes a stored packet. Then run **Analyze** as usual.

What the statuses mean:

| Status | Meaning |
| --- | --- |
| No fuel inputs yet | nothing entered; the analysis is exactly as without step 7 |
| The selected fuel table is archived | choose another table |
| The rate confirmation states a fixed fuel surcharge; that amount is checked instead | the existing fixed-amount rule applies; no FSC check |
| No fuel surcharge line on the invoice | nothing to compare |
| No public diesel price is available for this ship date | no posting covers the date (for example, newer than the imported data) |
| Miles are required for a per-mile fuel table | enter miles |
| No linehaul amount to apply a percent table to | no contract linehaul and no linehaul line |
| The billed fuel surcharge matches the fuel table | within the analysis tolerance |
| The billed fuel surcharge differs from the fuel table. Review the finding. | one review-only finding `FSC-INDEX-MISMATCH` |

**Example** (a table with base $1.20, step $0.06 and $0.01 per mile per step; ship date 2026-10-07, so the
2026-10-05 posting of $6.199 applies): 84 steps, $0.84 per mile, expected $420.00 for 500.0 miles. A billed
$435.00 gives a finding for review of $15.00, which notes that $435.00 equals the table result for the
2026-09-28 price ($6.382), one week earlier than the applicable posting. Check the table, the miles and the
ship date before disputing.

### The Outlook page

Open **Outlook** (`/outlook`). It starts with: 'Forecasts are shown only at horizons where a model beat "no
change" in a walk-forward backtest on public data; other horizons show "no change" with a range. Not a
guarantee.' For each series it shows the latest value, "Backtested on public data <from>-<to>; not a
guarantee.", one row per horizon with the target date, the method ("Trend model", "Average of trend model and
no change" or "No change"), the reason, the point, the range, "80% range. In the backtest, <n>% of outcomes
fell inside ranges built this way." and the backtest ratio and DM statistic, and the data source line with
the file's sha256. If you can see fuel tables, a **Fuel table** select adds your surcharge rate at each
diesel horizon.

On the bundled history (latest diesel 2026-10-05, latest index 2026-08-01) the page shows:

| Horizon | Method | Point | 80% range | Backtest: MASE vs no change, DM | Range coverage in backtest |
| --- | --- | --- | --- | --- | --- |
| Diesel 1 week | Trend model | 6.124 | 5.903 - 6.392 | 0.85, 5.64 | 78% |
| Diesel 4 weeks | Average of trend model and no change | 6.136 | 5.301 - 7.175 | 0.96, 2.75 | 79% |
| Diesel 8 weeks | No change | 6.199 | 4.777 - 8.189 | by design | 78% |
| Diesel 13 weeks | No change | 6.199 | 4.384 - 9.395 | by design | 77% |
| Truckload index 1 month | Trend model | 218.0 | 210.9 - 225.9 | 0.87, 2.33 | 74% |

A model is used only if, over at least 100 walk-forward origins, its error is below that of "no change"
(MASE < 1) and the difference is statistically significant (Diebold-Mariano >= 1.96). If a later import
makes a model fail, that horizon switches to "no change" automatically. Not shown: the truckload index at 3
months (edge not significant, and the range coverage was too far from 80%), deep-sea freight rates and
lane-level truck rates (no reliable edge over "no change" in our backtests).

### Import or update price data (operators)

Prices are global (shared by all organizations) and can only be written with the **owner database
connection**; the running API can only read them. The seed already imports the bundled history.

```bash
npm run build
export MIGRATE_DATABASE_URL=...           # owner connection; never printed
npm run prices:import -- --list           # active import per series: id, sha256, rows, dates, source kind
npm run prices:import -- --bundled        # the files in api/data/public-prices (sha256 checked)
npm run prices:import -- --series diesel_us --fetch      # download the pinned FRED CSV (CLI only)
npm run prices:import -- --series ppi_tl --file ./PCU4841214841212.csv \
  --source-url "https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU4841214841212" --retrieved-at 2026-10-11
```

- An import is all or nothing and always a full history. The newest import becomes active; older ones are
  kept and can never be changed or deleted.
- Same file again: `unchanged`. A file that covers less history than the active one: refused
  (`would_remove_history`). A file that changes values already imported (for example revised preliminary
  index months): refused with the number of changed values (`revisions_refused`); add `--accept-revisions`
  to import it on purpose.
- Exit codes: 0 imported or unchanged, 2 usage, validation or refusal (nothing written), 3 database or
  network failure (nothing written). Each import is recorded in the platform audit trail
  (`price_data.imported`).
- `--fetch` contacts only the pinned FRED address (no redirects, 20 s timeout, 1 MiB cap). The API itself
  never downloads anything.

### Backtest gate

```bash
npm run build
npm run eval:outlook -- --min-coverage 0.70 --max-coverage 0.90 --require-model diesel_us:1,diesel_us:4,ppi_tl:1
```

It replays the backtest on the bundled files (no database, no network, nothing written; `--json` prints the
full report). CI runs exactly this command; it fails if a range coverage leaves 70-90% or if one of the
three model horizons no longer beats "no change". It is a regression check of the forecast and range rules,
not a guarantee about future prices.

### API

| Route | Permission | Success |
| --- | --- | --- |
| `GET /api/v1/fuel-tables?includeArchived=false` | `claims:read` | 200: `{ "items": [...] }` |
| `POST /api/v1/fuel-tables` | `settings:manage` | 201: the table. Body e.g. `{ "name": "Carrier A 2026", "kind": "step", "unit": "per_mile", "priceSeries": "diesel_us", "params": { "basePrice": "1.20", "stepSize": "0.06", "ratePerStep": "0.01", "bracket": "above_base" } }` |
| `PUT /api/v1/fuel-tables/:id` | `settings:manage` | 200: the same body plus `"expectedVersion"` |
| `DELETE /api/v1/fuel-tables/:id` | `settings:manage` | 204 (archives) |
| `GET /api/v1/claims/:id/fuel-check` | `claims:read` | 200: inputs, table and the computed result |
| `PUT /api/v1/claims/:id/fuel-inputs` | `claims:analyze` | 200: `{ "inputs": ..., "outcome": "created" \| "changed" \| "unchanged" }`; body `{ "shipDate": "2026-10-07", "miles": "500.0", "fscTableId": "<uuid>" }` |
| `DELETE /api/v1/claims/:id/fuel-inputs` | `claims:analyze` | 204 |
| `GET /api/v1/outlook?fscTableId=<uuid>` | `claims:read` | 200: the outlook (`fscTableId` optional) |

All use the per-user `intelligence` rate limit. New errors: 409 `fuel_table_limit_reached`, 422
`fuel_table_unavailable`, 422 `miles_required`; 503 `service_unavailable` when the price data cannot be read.
The analysis response adds `fuelCheckStatus` and `fuelFindingsCount`.

### Switching it off and configuration

Platform staff can switch off **`intelligence.fuel_check`** ("Fuel tables and fuel-surcharge check") and
**`intelligence.cost_outlook`** ("Cost outlook from public price data") on the Dev dashboard's Flags tab
(both on by default). With the fuel check off, the analysis is exactly step 6 and the fuel routes, tab and
page disappear; tables and inputs stay stored. `PRICE_CACHE_TTL_MS` (default 60000) sets how long the API
caches which import is active.

### Not covered (accepted for now)

Only the U.S. national average diesel price (no regional prices); miles and ship date are typed in, not read
from documents; packets analysed before inputs were entered are not re-checked; USD only. The outlook models
were chosen on the same public history the CI gate replays. The full list is in
[technical/web-platform-security.md, section 11.5](technical/web-platform-security.md#115-accepted-residuals-step-7).

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
                             # parity suites (step 3 extraction, step 5 rules); see the env block in .github/workflows/web-ci.yml
npm run test:acceptance      # black-box acceptance suites under */test-acceptance/ (when present)
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1   # step 4: after npm run build
npm run eval:charges -- --min-top1 173 --min-accessorial-top1 158 --min-accessorial-recognised 145 --max-wrong-suggested 1   # step 6: after npm run build
npm run eval:outlook -- --min-coverage 0.70 --max-coverage 0.90 --require-model diesel_us:1,diesel_us:4,ppi_tl:1   # step 7: after npm run build
npm run prices:import -- --list   # step 7: owner connection (MIGRATE_DATABASE_URL); the seed imports the bundled prices
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

Four-eyes (2026-10-10, run `REQ-20261009-four-eyes`, Windows, **local run on Node 22.23.3, not GitHub
CI**, portable PostgreSQL 16, portable MinIO with SSE-KMS, in the `web-ci.yml` step order with its
environment): lint, typecheck, unit tests (shared 136, api 356, web 67), migrate + seed, `ensure-bucket`,
build, integration (95 passed, 2 pre-existing skips), acceptance (shared 36, api 690 passed with 9
skipped and 2 todo, web 150 passed with 1 skip). **Not run:** Node 24, GitHub CI, `npm run audit`,
container images, Playwright, any AWS deployment. The parity suites used Python 3.14 (CI uses 3.12).

Step 5 (2026-10-10, run `REQ-20261010-step5-analysis`, Windows, **local runs, not GitHub CI**; the
validation is **not complete**): the builder ran lint, typecheck, unit tests (shared 165, api 370, web 78),
the rules parity suite (2,132 cases, zero differences on Node 22.23.3 and Node 24) and, on Node 22.23.3,
migrate + seed (also `--reset`), build and integration (16 files, 107 passed, 3 local-skip placeholders),
at commit `b12ce2a`. The first independent acceptance run (Node 22.23.3, `CI=true`, same commit) gave
shared 81/81 and api 754 passed, 4 failed, 10 skipped; the 4 failures were test-design errors, fixed in
the test files but not yet re-verified because the rerun was stopped by low system memory. The web
acceptance suite has not run yet. The fix-round commit `5c047fb` (bulk budget) was checked only with lint,
typecheck and targeted unit tests. **Not run:** acceptance and integration at `5c047fb`, GitHub CI,
container images, Playwright, any AWS deployment.

Step 6 (2026-10-11, run `REQ-20261011-charge-intelligence`, Windows, Node 22.23.3, **local runs, not GitHub
CI**; low-memory mode, so the validation is **not complete**): the builder ran lint, typecheck and unit
tests (at `3a8125d`: shared 190, api 392, all web files; after fix round 1 at `43d7d4c`: shared 195, api
393, the web charges, analysis and step 4 files with 33 tests) and `npm run eval:charges` with the CI
bounds (exit 0). The tester's pure shared acceptance tests (Tier L) passed 73 of 73 at `3a8125d`; after fix
round 1 they found one missing root export, fixed in `a1b1c2a`, where the full shared acceptance suite
passed 153 of 153. **Written but not run** (waiting for the owner's go-ahead): the integration tests for
the new table (RLS, grants, cross-tenant refusal), the API, database, CLI and web acceptance tests (Tier H)
and the parity suites.
**Not run:** GitHub CI, container images, Playwright, any AWS deployment.

Step 7 (2026-10-11, run `REQ-20261011-fuel-outlook`, Windows, Node 22.23.3, **local runs, not GitHub CI**;
low-memory mode, so the validation is **not complete**): the builder ran lint and typecheck (clean,
repo-wide), targeted unit tests (shared fuel and outlook, the api evaluation CLI and fuel units, the web fuel,
outlook, charges, analysis and ui files with 35 tests), `prisma generate`, `prisma migrate diff` (no
database) and the `eval:outlook` gate with the CI bounds (exit 0; bad data exit 2, tight bounds exit 1), at
`cbb340f`. The tester's pure acceptance tests (Tier L) passed: shared 263 of 263, api 13 of 13 (the first
run found one product defect, the return shape of `checkFuel`, fixed in `d87db5e` without changing a test).
The security review found no Critical, High or Medium issue; fix round 1 (`1a95245`: refusal of revised
price values, a parameter hash for fuel tables, an API-key test) was checked with lint, typecheck and 52 api
unit tests. **Written but not run** (waiting for the owner's go-ahead): `npm run build`, the integration
tests for the four new tables (RLS, grants, cross-tenant refusal, append-only price tables), the API,
database, importer and web acceptance tests (Tier H) and the parity suites.
**Not run:** GitHub CI, container images, Playwright, any AWS deployment.
