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
