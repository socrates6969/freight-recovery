# Freight Recovery

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
- usiness/ — business plan, market & competitor analysis, GTM.
- inancial/ — unit economics, model, the ARR-to-valuation math.
- 	echnical/ — architecture, the verified tool/agent pipeline, eval harness (pass^k).
- undraising/ — right-fit VC/angel firms + their **official** contact channels + outreach templates. (No personal dossiers.)
- hiring/ — role specs + how to source an operator/CEO in Norway (recruiters & official channels).

## Build plan
Follows the 12-prompt playbook: eval set first → verified tool layer → draft + independent verifier (measured pass^k) → retrieval/memory → routing/cost control → red-team → audit trail + human approval → measured recovery rate → pilot one-pager → seed deck grounded only in measured results.

---

# MVP codebase (pre-product, NOT production-ready)

A working vertical slice of the core flow: **ingest -> extract -> rules -> recovery amount -> evidence packet + DRAFT demand letter**. It runs fully offline with a deterministic extraction stub (no API key). It has **not** been validated on real customer data, has **no auth or database**, and is a starting point, not an enterprise system. See [ARCHITECTURE.md](ARCHITECTURE.md) and [deploy/aws.md](deploy/aws.md).

## Stack
Python 3.11+ (developed on 3.14), FastAPI, pydantic v2, uvicorn, pdfplumber (PDF text layer), pytest. Versions are pinned in `requirements.txt` / `requirements-dev.txt`. CSV is handled with the stdlib (pandas was deliberately skipped: too heavy for what is needed).

## Setup, run, test
```bash
python -m venv .venv
.venv/Scripts/activate            # Windows (Git Bash: source .venv/Scripts/activate); Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt

pytest                                            # run the test suite (offline)
uvicorn freight_recovery.api.main:app --app-dir src --reload   # API; docs at http://localhost:8000/docs
python -m freight_recovery.cli --perspective carrier tests/fixtures/ld5002/*   # CLI (set PYTHONPATH=src)
docker compose up --build                         # local container (not yet exercised, see below)
```

## API (OpenAPI at `/docs`, `/openapi.json`)
- `GET /health`
- `POST /v1/analyze` - multipart upload of invoice / rate confirmation / BOL (PDF, CSV, TXT) for one load, plus `perspective` (`shipper` | `carrier`).
- `POST /v1/analyze/text` - same, with inline text documents (JSON).

Perspective: **shipper** recovers overcharges; **carrier** recovers detention/accessorials earned but unbilled or under-billed.

## What the rules do today
Detention (clock starts at later of appointment/arrival, free time and rate from the rate con, rounded down to 15 min, capped at contract max), linehaul above rate con, fuel surcharge above rate con, accessorials not authorized on the rate con (flagged for human review), duplicate lines, invoice total above sum of lines. Conventions are explicit in `src/freight_recovery/rules/`; real contracts/tariffs vary and will need per-customer configuration.

## What was actually run vs left for CI
- **Run locally (Windows, Python 3.14.7, fresh venv): `pytest` -> 29 passed**, including the hand-built PDF ingest test and the FastAPI TestClient tests; plus a CLI smoke run.
- **Not run:** `docker build` / `docker compose up` (Docker not exercised on this busy box) - the Dockerfile and compose file are unverified; `.github/workflows/ci.yml` builds the image and runs pytest on Python 3.12, so that run is left for CI. Terraform was never validated or applied.

## Stubbed / TODO (real work still needed)
- Extraction is a deterministic `Key: Value` parser; real carrier PDFs need layout-aware parsing/OCR and a hosted-model provider behind `ExtractionProvider` (placeholder `LLMExtractionProvider` raises NotImplementedError).
- No TMS/carrier-portal/EDI (204/210/214) integrations, no payments or credit-memo reconciliation, no email/portal dispute filing, no deadline tracking.
- No auth, tenancy, persistence (RDS), job queue, audit log, upload hardening, or timezone handling.
- Rules are not validated against real closed files; accuracy numbers do not exist yet. Demand letters are drafts and are never sent automatically.
