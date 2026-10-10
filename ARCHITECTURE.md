# Architecture (MVP, pre-product)

```
files (PDF/CSV/TXT)
   |  ingest/        bytes -> RawDocument (text, doc_type, sha256)
   v
 extraction/        RawDocument -> Invoice | RateConfirmation | BillOfLading   (swappable provider)
   |  extract_bundle -> ExtractedBundle (+ warnings)
   v
 rules/             ExtractedBundle -> Findings -> RecoveryResult (per perspective)
   v
 evidence/          documents + findings + calculations + DRAFT letter -> EvidencePacket (+ markdown)
   v
 api/ (FastAPI) and cli.py     thin adapters over pipeline.run_pipeline
```

Request path in the API (production foundation):

```
request -> BodySizeLimitMiddleware -> AuthenticatedRoute (API key -> tenant, BEFORE the body is parsed)
        -> persist Analysis(running) + raw docs via StorageProvider      [db/, storage/; tenant-scoped]
        -> sandbox worker process: ingest -> extract -> rules -> evidence  [sandbox/; time+memory bounded]
        -> mark Analysis succeeded|failed (+ result JSON)                  [tenant-scoped repository]
```

## Modules (`src/freight_recovery/`)
| Module | Responsibility |
|---|---|
| `models.py` | pydantic v2 domain types; money is `Decimal`; `Finding`, `RecoveryResult`, `EvidencePacket` |
| `config.py` | env-driven `Settings` (`FR_*`), secrets excluded from `repr`, `validate_for_production()` guard |
| `keys.py`, `auth.py` | API-key format/HMAC hashing; `AuthenticatedRoute` resolves the tenant from the key before the body is read (401 no key / 403 invalid) |
| `admin.py` | operator CLI: tenants and API keys (`python -m freight_recovery.admin`) |
| `db/` | SQLAlchemy 2 tables (`tables.py`), tenant-bound `AnalysisRepository` and unscoped `TenantAdminRepository` (`repository.py`), engine/session factories, Alembic migrations (`migrations/`, `migrate.py`) |
| `storage/` | `StorageProvider` interface: `LocalFilesystemStorage` (default), `S3Storage` stub behind two flags; tenant-prefixed keys built only from validated ids |
| `sandbox/` | `run_isolated` / `SandboxRunner`: one worker subprocess per job with wall-clock, memory, CPU and output limits and a clean environment; `targets.analyze` is the analysis job |
| `ingest/` | decode PDF (pdfplumber, lazy import) / CSV (flattened to `Key: Value`) / TXT; classify doc type; sha256 |
| `extraction/` | `ExtractionProvider` Protocol; `DeterministicStubProvider` (default, offline); `LLMExtractionProvider` placeholder; `extract_bundle` |
| `rules/` | `detention.py` (auditable calculation), `invoice_checks.py` (rate/fuel/accessorial/duplicate/total), `engine.py` (perspective totals) |
| `evidence/` | `letter.py` deterministic draft letter; `packet.py` assembles packet and markdown |
| `pipeline.py` | `run_pipeline(files, perspective)` - the single orchestration entry point |
| `api/main.py` | `create_app()` factory + `app`; authenticated routes, tenant-scoped persistence, gated docs; `cli.py` for local use (no auth/DB) |

## Key decisions
- **Provider interface, deterministic default.** The pipeline depends only on `ExtractionProvider`. The stub makes tests reproducible and offline; a hosted-model provider can be added without touching rules or evidence. Model output must be validated by pydantic and never trusted for arithmetic: **all money math is in `rules/`, in Decimal.**
- **Rules produce explainable findings.** Every finding carries rule id, amount, confidence, and a step-by-step calculation; uncertain ones set `needs_human_review`. Duplicates are removed before rate comparisons to avoid double counting.
- **Two perspectives, one engine.** Findings are directional (`overcharge` vs `underbilled`); the chosen perspective sums its direction and reports the rest as ignored.
- **Human in the loop.** Output is a draft packet; nothing is sent. Every packet carries a disclaimer.
- **Tenant isolation by construction.** The tenant comes only from the API key. `AnalysisRepository` is bound to one tenant at construction and every query filters on it; another tenant's id is a 404; storage keys carry the tenant prefix and are re-checked on read. PostgreSQL row-level security is the next layer of defense in depth.
- **Persistence behind a repository.** SQLAlchemy 2 + Alembic; SQLite locally/tests, PostgreSQL (RDS) in production. An `analyses` row is both the job record (queued/running/succeeded/failed) and the result, so an async worker can adopt it without a schema change. Money is stored as integer cents plus the exact packet JSON.
- **Bounded parsing.** Hostile input is parsed in a separate, resource-limited worker process, never in the API process. This is process isolation, not an OS sandbox; seccomp/read-only-rootfs/no-egress containment is a deployment-layer control (`deploy/aws.md`).
- **No queue yet.** Analyses run synchronously within the request (bounded by the worker pool and a 503 back-pressure); an async job queue is a next step for large documents.
- **Evidence integrity.** Original-bytes sha256 recorded per document.

## Forecasting (roadmap)
`forecast/` is an optional, future capability (not in the core flow): a `Forecaster` interface, a stdlib seasonal-naive/moving-average baseline (default, tested), and a lazily-imported `neuralforecast` backend behind the `[forecast]` extra, off by default and not validated (needs real multi-series data; often only ties baselines). No accuracy claims.

## Known gaps
Scanned-PDF OCR; multi-document/multi-stop loads; timezone-aware timestamps; contract/tariff-specific rules; carrier-specific charge codes; dispute deadlines and status tracking; integrations (TMS/EDI/carrier portals); payments/credit reconciliation; rate limiting, malware scanning, retention policy, an async job queue; and the external security audit / compliance sign-off. The project's research plan (eval set first, independent verifier, measured pass^k) lives in `technical/` and is not yet implemented here.

---

# Web platform (TypeScript, steps 1-2)

> Written by scriber for run `REQ-20261008-webapp-foundation` on 2026-10-08. **Pre-product, synthetic
> data only, never deployed.** The Python service above and the `webapp/` pilot dashboard are unchanged and
> still run on their own. Threat model and known gaps:
> [technical/web-platform-security.md](technical/web-platform-security.md).

## Overview

An npm-workspaces monorepo next to the Python service. `web/` is a React 19 + Vite SPA (React Router,
TanStack Query, Zustand, Tailwind). `api/` is Node 22 + Fastify 5 + Prisma 7 on PostgreSQL 16, with Zod
validation and Pino logs. `packages/shared/` (`@fr/shared`) holds the roles, the permission matrix,
canonical JSON, text safety and the DTO schemas; both sides import it. `infra/` is a Terraform skeleton for
AWS. Build-order steps 1 and 2 are implemented: authN (argon2id, access JWT plus a rotating refresh
cookie, TOTP MFA, lockout), RBAC across 8 roles, 3-layer tenant isolation, app hardening, a hash-chained
append-only audit trail, the claims list, the evidence-packet viewer and the approvals human gate.
Step 3 (import and export) is described in its own section below:
[Web platform: import and export (step 3)](#web-platform-import-and-export-step-3). Step 4 (Dev
dashboard, Recovery intelligence, tenant API keys and the evaluation tool) has its own section too:
[Web platform: Dev dashboard, Recovery intelligence and API keys (step 4)](#web-platform-dev-dashboard-recovery-intelligence-and-api-keys-step-4).
Step 5 (the TS port of the Python rules and evidence letter, and the analyze action that turns an imported
claim into packet revision 1) is described in
[Web platform: claim analysis (step 5)](#web-platform-claim-analysis-step-5). There is no learned model and no LLM call. The seeded claims and packets come from
the Python CLI output on `tests/fixtures/` (synthetic).

## Module Structure

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    subgraph Web["web/ (SPA)"]
        W1["app-root + router"]
        W2["features/auth"]
        W3["features/claims"]
        W4["features/approvals"]
        W5["api/client.ts"]
    end

    subgraph Shared["packages/shared (@fr/shared)"]
        S1["rbac.ts"]
        S2["dto.ts (Zod)"]
        S3["canonical-json + text"]
    end

    subgraph Http["api/src/http"]
        H1["security.ts pipeline"]
        H2["route.ts defineRoute"]
    end

    subgraph Domain["api/src domain"]
        D1["auth/ + users"]
        D2["claims/"]
        D3["platform/"]
        D4["audit/"]
    end

    subgraph Data["api/src/db + Postgres"]
        B1["db/tenant.ts"]
        B2["db/system.ts"]
        B3["RLS + triggers (SQL)"]
    end

    W1 --> W2
    W1 --> W3
    W1 --> W4
    W2 --> W5
    W3 --> W5
    W4 --> W5
    W5 --> H1
    W1 --> S1
    W5 --> S2
    H1 --> H2
    H2 --> D1
    H2 --> D2
    H2 --> D3
    D1 --> D4
    D2 --> D4
    D3 --> D4
    D1 --> B2
    D2 --> B1
    D3 --> B1
    D4 --> B1
    B1 --> B3
    B2 --> B3
    H1 --> S1
    D2 --> S3
    D4 --> S3

    style W1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style W5 fill:#1e90ff,stroke:#1565c0,color:#fff
    style S1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style H1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style B1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style B3 fill:#1e90ff,stroke:#1565c0,color:#fff
    style D4 fill:#1e90ff,stroke:#1565c0,color:#fff
```

> Everything in this diagram is new in this run. Blue marks the security-critical modules.

### Module Reference

| Module / File | Layer | Purpose | Key Exports | Changed |
| --- | --- | --- | --- | --- |
| `packages/shared/src/rbac.ts` | Shared | **Single source of truth** for roles and the frozen permission matrix | `ROLES`, `PERMISSION_MATRIX`, `can`, `canAssignRole`, `canManageUserWithRole`, `MFA_REQUIRED_ROLES` | new |
| `packages/shared/src/dto.ts` | Shared | Strict request schemas and response DTOs (also `CLAIM_SORT_FIELDS`) | Zod schemas | new |
| `packages/shared/src/canonical-json.ts`, `text.ts`, `money.ts` | Shared | Canonical JSON for hashing; `displayText` and unsafe-character checks; integer-cent formatting | `canonicalJson`, `GENESIS_HASH`, `displayText`, `formatUsdCents` | new |
| `api/src/app.ts`, `server.ts`, `config.ts` | API | App factory; fail-safe config (production guards, secret checks) | `buildApp`, `loadConfig`, `secretEntropyProblem` | new |
| `api/src/http/security.ts` | API | One `onRequest` pipeline: rate limit → Origin → CSRF → authN → permission; security headers | `registerSecurityPipeline` | new |
| `api/src/http/route.ts` | API | `defineRoute`; the boot fails if a route lacks an access declaration; Zod validation in `preHandler` | `defineRoute` | new |
| `api/src/security/*` | API | argon2id, HS256 JWT (per-purpose key/typ/aud), TOTP, CSRF, HKDF/AES-GCM, lockout math | | new |
| `api/src/auth/*` | API | Login, MFA, refresh rotation + reuse detection, forgot/reset, invites, users (R3-R23), dev outbox (R38) | `authenticateAccessToken`, `rotateRefreshToken`, route registrars | new |
| `api/src/claims/*` | API | List/sort/search (`escapeLike`), packet viewer, content hash, review state machine, approvals (R26-R34) | `canTransition`, `packetContentHash` | new |
| `api/src/platform/*` | API | Health, tenant stats, SUPER_ADMIN cross-tenant read (audited first) | `crossTenantRead` | new |
| `api/src/audit/*` | API | Hash chain, append under an advisory lock, verifier, list/verify routes | `appendAudit`, `ChainVerifier` | new |
| `api/src/db/tenant.ts`, `system.ts` | Data | Layer-2 fail-closed tenant extension; system-mode transactions (restricted by lint) | `withTenantTx`, `withSystemTx` | new |
| `api/prisma/migrations/20261008000000_init/migration.sql`, `api/db/init/00-roles.sql` | Data | Schema, RLS + FORCE, least-privilege grants, append-only and state-machine triggers, DB roles | | new |
| `web/src/api/client.ts` | Web | Access token in memory, CSRF header, single-flight refresh (Web Locks across tabs) | `ApiClient` | new |
| `web/src/features/{auth,shell,claims,approvals}` | Web | Login/MFA/reset/invite pages, shell + command palette, claims table + detail sheet, approvals queue | pages | new |
| `infra/*.tf` | Infra | AWS skeleton (fmt/validate only, never applied) | | new |
| `compose.web.yml`, `.github/workflows/web-ci.yml` | Ops | Separate local stack and CI; the Python `docker-compose.yml` and `ci.yml` are untouched | | new |

## Request pipeline (data flow)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    Req["HTTPS request"] --> Rate{"Rate limit ok?"}
    Rate -- no --> R429["429 + Retry-After"]
    Rate -- yes --> Unsafe{"Unsafe method?"}
    Unsafe -- yes --> Csrf{"Origin + CSRF ok?"}
    Csrf -- no --> R403a["403"]
    Csrf -- yes --> AuthN{"Route needs auth?"}
    Unsafe -- no --> AuthN
    AuthN -- yes --> Tok{"JWT valid + user live?"}
    Tok -- no --> R401["401"]
    Tok -- yes --> Ctx["Load ctx from DB"]
    Ctx --> Perm{"Permission in matrix?"}
    Perm -- no --> R403b["403 + audit"]
    Perm -- yes --> Body["Parse body + Zod"]
    AuthN -- no --> Body
    Body --> Valid{"Schema valid?"}
    Valid -- no --> R400["400 validation_error"]
    Valid -- yes --> Tx["ctx.db.tx: set app.tenant_id"]
    Tx --> Handler["Handler + appendAudit"]
    Handler --> Commit["Commit (atomic)"]
    Commit --> Hdr["onSend: security headers"]

    style Ctx fill:#1e90ff,stroke:#1565c0,color:#fff
    style Tx fill:#1e90ff,stroke:#1565c0,color:#fff
    style Perm fill:#1e90ff,stroke:#1565c0,color:#fff
```

AuthN and authZ run in `onRequest`, before the body is parsed. An unauthenticated or forbidden request
therefore gets 401/403 even when its body is invalid. A business change and its audit event commit in
the same transaction: if the audit append fails, the request returns 500 and nothing changes.

## Authentication flows

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    L["POST /auth/login"] --> Lock{"Email hash locked?"}
    Lock -- yes --> L429["429 Retry-After"]
    Lock -- no --> Pw{"argon2id verify ok?"}
    Pw -- no --> Fail["Count failure + audit"]
    Pw -- yes --> Mfa{"Role needs MFA?"}
    Mfa -- no --> Sess["Issue session"]
    Mfa -- yes --> Enr{"TOTP enrolled?"}
    Enr -- no --> EnrollFlow["mfa/enroll start+verify"]
    Enr -- yes --> Verify["mfa/verify TOTP or code"]
    EnrollFlow --> Sess
    Verify --> Sess
    Sess --> Out["Access JWT body + fr_rt cookie"]
    Out --> Ref["POST /auth/refresh"]
    Ref --> Used{"Token already used?"}
    Used -- yes --> Kill["Revoke family + audit"]
    Used -- no --> Rot["Rotate: new token same family"]

    style Used fill:#1e90ff,stroke:#1565c0,color:#fff
    style Mfa fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Flow | Routes (under `/api/v1`) | Key rules |
| --- | --- | --- |
| Login | `POST /auth/login` | argon2id with a dummy verify for unknown or disabled users; per-email-hash lockout `min(30·2^(f-5), 900)` s after 5 failures; auth rate limit 20/60 s per IP |
| MFA | `/auth/mfa/verify`, `/auth/mfa/enroll/start`, `/auth/mfa/enroll/verify` | mandatory for OWNER, ADMIN, PLATFORM_DEV, SUPER_ADMIN; RFC 6238 ±1 step; accepted step strictly increasing (no replay); single-use recovery codes |
| Session | `/auth/refresh`, `/auth/logout`, `GET /me` | access JWT (10 min) is kept in JS memory; `fr_rt` cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`; DB stores an HMAC of the token; reuse revokes the family; family max 30 days |
| CSRF | `GET /auth/csrf` | `fr_csrf` cookie == `X-CSRF-Token` == `nonce.HMAC(secret, nonce)`, plus an Origin check |
| Recovery | `/auth/forgot`, `/auth/reset`, `/auth/change-password` | same response for unknown emails; reset revokes all sessions; forgot limited to 5/15 min |
| Invites | `/users/invites`, `/auth/invites/inspect`, `/auth/invites/accept` | role assignment is rank-based (`canAssignRole`); OWNER is never assignable |

## RBAC

`packages/shared/src/rbac.ts` is the single source of truth. The API checks `can(role, permission)`
on every request. The web app imports the same frozen data only to hide controls.

| Permission | OWNER | ADMIN | MANAGER | REVIEWER | ANALYST | VIEWER | PLATFORM_DEV | SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claims:read` | x | x | x | x | x | x | | |
| `claims:assign` | x | x | x | | | | | |
| `packets:edit`, `packets:approve` | x | x | x | x | | | | |
| `demands:send` | x | x | x | | | | | |
| `import:run` (step 3: batches, upload, documents, download, commit) | x | x | x | x | x | | | |
| `import:review` (step 3: review queue and decisions) | x | x | x | x | | | | |
| `export:claims` (step 3) | x | x | x | x | x | | | |
| `export:packets`, `export:outcomes` (step 3) | x | x | x | x | | | | |
| `users:read`, `users:manage`, `audit:read`, `settings:manage`, `integrations:manage` | x | x | | | | | | |
| `admins:manage`, `billing:manage`, `tenant:delete` | x | | | | | | | |
| `apikeys:manage` (step 4: create, list and revoke tenant API keys) | x | x | | | | | | |
| `claims:analyze` (step 5: analyze one claim, bulk analyze; no API-key scope) | x | x | x | x | x | | | |
| `platform:health` (step 4: also pipeline health and telemetry) | | | | | | | x | x |
| `platform:flags`, `platform:logs` | | | | | | | x | |
| `platform:eval` (step 4: evaluation runs) | | | | | | | x | |
| `platform:audit` (step 4: platform audit chain) | | | | | | | | x |
| `platform:tenants:list`, `platform:cross_tenant_read` | | | | | | | | x |

Platform roles have no tenant and no tenant data permission. A SUPER_ADMIN cross-tenant read is
read-only, needs a reason of at least 10 characters, and is audited into the target tenant's chain first.
There is no Team model, so every tenant role sees all claims of its tenant (assumption A4).

## Tenant isolation (three layers, fail closed)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    C["request.ctx (Layer 3)"] --> T{"tenantId from DB membership?"}
    T -- no --> F403["403 before handler"]
    T -- yes --> X["Prisma extension (Layer 2)"]
    X --> M{"Model allow-listed?"}
    M -- no --> Err["TenantScopeError"]
    M -- yes --> Inj["Force tenantId in where/data"]
    Inj --> SetCfg["set_config app.tenant_id (tx-local)"]
    SetCfg --> R["RLS + FORCE (Layer 1)"]
    R --> Role{"Role is freight_app?"}
    Role -- yes --> Rows["Only own-tenant rows"]

    style X fill:#1e90ff,stroke:#1565c0,color:#fff
    style R fill:#1e90ff,stroke:#1565c0,color:#fff
```

- **Layer 1, PostgreSQL RLS.** Every tenant-scoped table (`claims`, `evidence_packets`, the packet child
  tables, `approvals`, `memberships`, `invites`, `audit_events`) has `ENABLE` and `FORCE ROW LEVEL
  SECURITY` with `USING/WITH CHECK (tenant_id = fr_current_tenant())`. With no `app.tenant_id` set,
  queries see zero rows. Only `memberships` and `invites` also allow `fr_system_mode()` (auth bootstrap),
  and the `platform` audit chain is visible only in system mode.
- **Roles.** The API runs as `freight_app` (`NOSUPERUSER NOBYPASSRLS NOINHERIT`, not the owner; DML
  grants only; `evidence_packets` gets `UPDATE (status)` only; append-only tables get `SELECT, INSERT`
  only). `freight_owner` owns the schema and runs migrations, the seed and test fixtures (BYPASSRLS).
- **Layer 2, fail-closed Prisma extension** (`api/src/db/tenant.ts`). Models are allow-listed;
  `tenantId` is injected into every where clause and create, and a conflicting value throws. Raw SQL is
  blocked on the tenant client.
- **Layer 3, request context.** User, role, tenant status and refresh-family liveness are reloaded from
  the DB on every request, never from token claims. Platform users get `db = null`.

## Audit hash chain

- One chain per tenant (`chain_key = t:<tenantId>`) plus a `platform` chain.
  `hash_n = SHA-256(hash_{n-1} + "\n" + canonicalJson(event_n))`; genesis is 64 zeros; `seq` is contiguous
  under `pg_advisory_xact_lock(hashtextextended(chain_key, 0))`.
- Triggers block UPDATE, DELETE and TRUNCATE on `audit_events` (and on `approvals`, `login_attempts`
  and the packet child tables), even for the owner. Only `db:seed -- --reset` in dev/test bypasses them
  through `session_replication_role`.
- `GET /api/v1/audit/verify` (`audit:read`) recomputes the chain and reports `brokenAtSeq`. Metadata
  passes through a whitelist; failed logins are recorded with `actor = null`.

## Approval state machine

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    W["AWAITING_ANALYSIS (claim)"] -- "analyze (step 5)" --> P["PENDING_REVIEW"]
    P -- "approve (reason)" --> A["APPROVED"]
    P -- "reject (reason)" --> J["REJECTED"]
    A -- "send (reason, hash match)" --> S["SEND_READY (terminal)"]
    P -- "edit" --> N["new revision PENDING_REVIEW"]
    A -- "edit" --> N
    J -- "edit" --> N
    N -. "old revision" .-> X["SUPERSEDED"]

    style S fill:#1e90ff,stroke:#1565c0,color:#fff
    style W fill:#1e90ff,stroke:#1565c0,color:#fff
```

`AWAITING_ANALYSIS` is a claim status only (imported claims, no packet yet). Since run
`REQ-20261010-step5-analysis` the analyze action creates packet revision 1 in `PENDING_REVIEW` and moves the
claim there; nothing returns to `AWAITING_ANALYSIS`. See
[claim analysis (step 5)](#web-platform-claim-analysis-step-5).

Every action needs a reason and writes an append-only `approvals` row plus an audit event in one
transaction, with the claim row locked `FOR UPDATE`. Approve records the packet's canonical content hash.
Send recomputes it and requires it to equal both the approval's hash and the stored hash. "Send" only
marks the demand send-ready: no email, no payment. The DB trigger `fr_packet_update_guard` enforces
the same transitions and makes every column except `status` immutable. Edit creates a new revision; the
approval row records the base revision (deviation 18). Since run `REQ-20261009-four-eyes`, approve and
reject are also refused (403 `four_eyes_required`) for anyone who created any revision of the claim's
packet; see [four-eyes](#web-platform-four-eyes-separation-of-duties).

| Function | Defined In | Called By | Purpose |
| --- | --- | --- | --- |
| `canTransition`, `targetStatus` | `api/src/claims/state-machine.ts` | claims service | transition table (mirrors the SQL trigger) |
| `packetContentHash` | `api/src/claims/content-hash.ts` | approve, edit, send, viewer integrity | canonical hash with ordinals instead of UUIDs |
| `lockClaimForUpdate` | `api/src/db/tenant.ts` | claims service | serializes concurrent decisions |
| `appendAudit` | `api/src/audit/audit.ts` | every mutating handler, cross-tenant read | chain append in the caller's transaction |
| `crossTenantRead` | `api/src/platform/cross-tenant.ts` | platform routes | audit first, then read, fail closed |

## AWS mapping (web stack)

`infra/` replaces `deploy/terraform/` **for the web stack only**. It follows the principles in
[deploy/aws.md](deploy/aws.md): secrets come from Secrets Manager through the task definition and are
never in state, migrations run as a one-shot ECS task before the rollout, the WAF sits in front, and
nothing is applied automatically.

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    U["Browser"] --> CF["CloudFront + headers policy"]
    CF --> S3W["S3 static SPA (OAC)"]
    CF --> ALB["ALB + WAFv2 (regional)"]
    ALB --> ECS["ECS Fargate api"]
    ECS --> RDS["RDS PostgreSQL 16"]
    ECS --> RED["ElastiCache Redis 7"]
    ECS --> S3D["S3 documents (SSE-KMS)"]
    ECS --> SM["Secrets Manager"]
    ECS --> CW["CloudWatch Logs"]
    MIG["ECS one-off migrate"] --> RDS

    style ALB fill:#1e90ff,stroke:#1565c0,color:#fff
    style ECS fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Component | Local (`compose.web.yml`) | AWS (`infra/`) |
| --- | --- | --- |
| SPA | nginx-unprivileged, headers from `web/security-headers.json` | S3 + CloudFront (OAC), response-headers policy generated from the same JSON |
| API | `api` container (uid 10001, read-only root fs, caps dropped) | ECS Fargate, same hardening, private subnets, VPC endpoints (no NAT) |
| Edge | loopback only | ALB reachable only from CloudFront origin ranges, TLS 1.2/1.3 policy, WAFv2 (managed rules, IP rate limit, Content-Length > 64 KiB; step 3: the upload route has its own > 10 MiB rule) |
| DB | `postgres:16.15-alpine` + `00-roles.sql` | RDS PostgreSQL 16, KMS, `rds.force_ssl=1`, managed master password; roles applied by an operator |
| Rate-limit store | `redis:7-alpine` | ElastiCache Redis 7, TLS + at-rest encryption, AUTH token set out of band |
| Documents | MinIO (`chainguard/minio`) with built-in KMS (`fr-dev-key`) and versioning | S3 SSE-KMS (puts without the CMK are denied by bucket policy), versioning, lifecycle; task role limited to the `t/*` prefix, `s3:DeleteObject` only on `t/*/imports/*` |
| Secrets | public `local-dev-*` values (refused in production) | 7 Secrets Manager containers; values set out of band |

## Architectural Patterns

- **Security pipeline as one hook**: an exact, testable order (rate → Origin → CSRF → authN → authZ → validation).
- **Fail closed everywhere**: unknown routes refuse to boot; unset tenant means zero rows; an audit failure rolls back the business change; the production config refuses dev values.
- **Shared contract package**: roles, matrix and DTOs are defined once in `@fr/shared` and used by API and web.
- **Defense in depth in the database**: RLS, grants and triggers enforce the invariants even if application code is wrong.
- **Content-addressed approvals**: decisions bind to a canonical hash, not to a mutable row.

## Notes

- Deviations from the brief: Node 22 instead of 20 (Node 20 is EOL); a Prisma client extension instead of the removed `$use` middleware; eslint 9; framer-motion omitted. The full list (22 items) is in the run's `implementation.md`.
- Not verified: Docker images and the compose stack, Playwright e2e, any AWS deployment. See the threat model's "Known gaps".

---

# Web platform: import and export (step 3)

> Written by scriber for run `REQ-20261008-step3-import-export` on 2026-10-09 (branch
> `feat/import-export`). **Pre-product, synthetic data only, never deployed.** Threat rows for this step
> are T18-T31 in [technical/web-platform-security.md](technical/web-platform-security.md). The
> email-forward path is design only: [docs/design/email-ingest.md](docs/design/email-ingest.md).

## Overview (step 3)

Step 3 adds document **import** and **export**. Import covers upload, sniffing, encrypted storage,
sandboxed parsing, deterministic extraction with provenance, human review and commit to claims. Export
streams claims, packets and approval outcomes as CSV or XLSX, with formula neutralization. Step 3 does
not add OCR, AI or LLM calls, outbound email or email-forward ingestion. The parsing and extraction
logic is a TypeScript port of the Python `ingest/` and `extraction/` modules. Parity tests check it
against the Python code. Python is a test oracle only and never runs in production.

Main decisions:

- The pipeline is **synchronous** inside the upload request and bounded by timeouts. The status model
  already allows a queue later.
- The API **proxies** originals. There are no signed URLs.
- PDFs are read from the text layer only. Images are stored and flagged for manual entry.
- Claims created from imports start in the new status `AWAITING_ANALYSIS`, with no money and no packet.
  Step 5 adds the analysis ([claim analysis (step 5)](#web-platform-claim-analysis-step-5)).

## Module Structure (step 3)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    subgraph Web["web/ (SPA)"]
        WI["features/imports pages"]
        WE["ui/ExportMenu"]
        WC["api/client upload+download"]
    end

    subgraph Shared["packages/shared"]
        SR["rbac.ts (+4 permissions)"]
        SD["import-dto + decimal"]
        SS["text-sanitize (plain/md)"]
    end

    subgraph Imp["api/src/imports"]
        IR["routes.ts R40-R53"]
        IS["service.ts ingestDocument"]
        IN["sniff + display-name"]
        RV["review + commit services"]
        BU["bundle.ts (step 5 input)"]
    end

    subgraph Sbx["api/src/imports/sandbox"]
        EX["executor.ts"]
        SP["spawn.ts (only spawner)"]
        WM["worker-main + guard"]
    end

    subgraph Parse["api/src/imports/parse (pure)"]
        PP["pipeline.ts"]
        PD["pdf + pdf-prescan"]
        PX["csv, text, image"]
        DE["deterministic + confidence"]
    end

    subgraph Exp["api/src/exports"]
        ER["routes.ts R54-R56"]
        EW["rows + writers"]
        NZ["neutralize.ts"]
    end

    subgraph Data["storage + db"]
        S3["storage/s3.ts SSE-KMS"]
        DB["5 tables, RLS FORCE"]
    end

    WI --> WC
    WE --> WC
    WC --> IR
    WC --> ER
    IR --> IS
    IR --> RV
    IS --> IN
    IS --> EX
    IS --> S3
    IS --> DB
    RV --> DB
    RV --> BU
    EX --> SP
    SP --> WM
    WM --> PP
    PP --> PD
    PP --> PX
    PP --> DE
    DE --> SD
    PX --> SS
    ER --> EW
    EW --> NZ
    EW --> DB
    IR --> SR
    ER --> SR

    style IS fill:#1e90ff,stroke:#1565c0,color:#fff
    style IN fill:#1e90ff,stroke:#1565c0,color:#fff
    style EX fill:#1e90ff,stroke:#1565c0,color:#fff
    style SP fill:#1e90ff,stroke:#1565c0,color:#fff
    style WM fill:#1e90ff,stroke:#1565c0,color:#fff
    style PD fill:#1e90ff,stroke:#1565c0,color:#fff
    style NZ fill:#1e90ff,stroke:#1565c0,color:#fff
    style S3 fill:#1e90ff,stroke:#1565c0,color:#fff
```

> Everything in this diagram is new or changed in step 3. Blue marks the modules that handle hostile
> bytes or hostile cell content.

### Module Reference (step 3)

| Module / File | Layer | Purpose | Key Exports | Changed |
| --- | --- | --- | --- | --- |
| `packages/shared/src/rbac.ts` | Shared | Adds `import:review`, `export:claims`, `export:packets`, `export:outcomes`; `import:run` now has routes | `PERMISSION_MATRIX`, `can` | changed |
| `packages/shared/src/import-dto.ts`, `import-fields.ts`, `extraction.ts` | Shared | Strict Zod DTOs for R40-R56, field keys and labels, reason codes, TS mirror of the Python `ExtractedBundle` | schemas, `FIELD_LABELS` | new |
| `packages/shared/src/decimal.ts` | Shared | Python-compatible `parseMoney`, integer micros, compare; no floating point | `parseMoney`, `toMicros`, `fromMicros`, `compareDecimal` | new |
| `packages/shared/src/text-sanitize.ts` | Shared | Port of `evidence/sanitize.py` with parity | `plain`, `md` | new |
| `api/src/imports/routes.ts` | API | R40-R53; raw `application/octet-stream` body on R43 only | `registerImportRoutes` | new |
| `api/src/imports/service.ts` | API | `ingestDocument` (single entry for upload and a future email worker), batch reads, stale reaper, verifying download stream | `ingestDocument`, `reapStale`, `prepareDownload`, `VerifyingStream` | new |
| `api/src/imports/sniff.ts`, `display-name.ts`, `body.ts` | API | Magic-byte sniffing and the extension rule; display-name sanitizing; bounded streaming body reader with idle timeout | `sniff`, `displayNameFor` | new |
| `api/src/imports/review-service.ts` | API | Confirm, correct or reject fields; add manual fields; set the type; accept or reject the document (row lock, decision row, audit) | `resolveField`, `addField`, `setDocType`, `acceptDocument`, `rejectDocument`, `reviewQueue` | new |
| `api/src/imports/commit-service.ts` | API | Groups accepted documents by normalized load number; creates or links claims (`AWAITING_ANALYSIS`) | `commitBatch`, `claimDocuments`, `normalizeLoadNumber` | new |
| `api/src/imports/bundle.ts` | API | Builds the TS `ExtractedBundle` from effective field values; citation locators (step 5 input) | `assembleBundle`, `loadBundleForClaim`, `pointerToLocator` | new |
| `api/src/imports/sandbox/executor.ts` | API | Semaphore, wall clock, output cap, RSS poll (Linux), exit-code mapping, strict response validation | `ChildProcessExecutor`, `ParseExecutor`, `ParserBusyError` | new |
| `api/src/imports/sandbox/spawn.ts` | API | The only `child_process` importer: fixed argv, `shell:false`, empty env, empty cwd, `--permission` | `startWorker`, `workerArgs`, `workerEnv` | new |
| `api/src/imports/sandbox/worker-main.ts`, `guard.ts`, `protocol.ts` | Worker | Worker entry (stdin to stdout); network and module guard preloaded with `--import`; versioned protocol | `validateWorkerResponse` | new |
| `api/src/imports/parse/*` | Parse | Pure port of `ingest/loader.py` and `extraction/stub.py`: text primitives, classification, CPython-compatible CSV and `strptime`, PDF text layer, PDF pre-scan, image structure checks, deterministic provider, confidence | `parseDocument`, `prescanPdf`, `ExtractionProvider`, `getProvider` | new |
| `api/src/exports/*` | API | R54-R56: count, `export.started`, keyset batches of 500, streaming CSV and XLSX (fflate), neutralization, `export.completed` / `export.aborted` | `registerExportRoutes`, `csvStream`, `xlsxStream`, `neutralizeFormula`, `cleanText`, `formatCents` | new |
| `api/src/storage/s3.ts` | Data | `putObject` (SHA-256 checksum, SSE-KMS), `headObject` verify, `getObjectStream`, `deleteObject`; every call checks the tenant prefix | `ObjectStore`, `tenantKey`, `isKeyInTenant` | changed |
| `api/src/db/claim-numbers.ts`, `claim-load-key.ts`, `import-locks.ts` | Data | `CLM-%04d` numbers under a tenant advisory lock; normalized load-number lookup; batch and document row locks | `nextClaimNumber` | new |
| `api/prisma/migrations/20261009000000_import_export/` | Data | 5 tenant tables, enums, CHECKs, RLS FORCE, column grants, immutability and append-only triggers, `AWAITING_ANALYSIS` | | new |
| `api/scripts/ensure-bucket.ts` | Ops | Creates the dev/CI bucket and enables versioning; refuses `NODE_ENV=production` | | new |
| `web/src/features/imports/*`, `web/src/components/ui/ExportMenu.tsx`, `web/src/api/client.ts` | Web | Import page, review queue, fields table, export menus, XHR upload with progress, blob download | pages, `ApiClient.upload`, `ApiClient.download` | new / changed |
| `tools/parity/extract_dump.py`, `sanitize_dump.py`, `api/test/parity/` | Test | Python oracle dumps and the parity comparison (registered divergences only) | | new |
| `infra/{s3,iam,ecs,waf,variables}.tf`, `compose.web.yml`, `.github/workflows/web-ci.yml` | Ops | Bucket deny rules and lifecycle, scoped `s3:DeleteObject`, ECS env, WAF upload exception, MinIO KMS and versioning, CI MinIO and build order | | changed |

## Import pipeline (data flow)

One upload is one `POST /api/v1/imports/:batchId/documents?filename=` request with the raw file bytes.
The pipeline runs synchronously, and the response carries the final document state.

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    Up["R43 raw bytes + ?filename="] --> Sec["Security pipeline (step 1-2)"]
    Sec --> Pre{"Batch open, gate free, name ok?"}
    Pre -- no --> E4["400 / 404 / 409 / 429"]
    Pre -- yes --> Rd["Stream body: cap, idle timeout, SHA-256"]
    Rd --> Big{"Over IMPORT_MAX_FILE_BYTES?"}
    Big -- yes --> E413["413, nothing stored"]
    Big -- no --> Sn{"Magic + extension ok?"}
    Sn -- no --> E415["415 reason, audited, nothing stored"]
    Sn -- yes --> Tx1["Tx 1: dedupe, quota, RECEIVED + audit"]
    Tx1 --> Put["S3 put SSE-KMS + verify"]
    Put --> Slot{"Parse slot in time?"}
    Slot -- no --> E503["503 parser_busy, FAILED"]
    Slot -- yes --> Wk["Sandbox worker parse"]
    Wk --> Ok{"Parsed, response valid?"}
    Ok -- no --> Rej["Tx 2: REJECTED, objects deleted"]
    Ok -- yes --> Txt["Store derived text (SSE-KMS)"]
    Txt --> Tx2["Tx 2: fields + status + audit"]
    Tx2 --> St{"Any review reason?"}
    St -- yes --> NR["NEEDS_REVIEW (review queue)"]
    St -- no --> AC["ACCEPTED"]

    style Rd fill:#1e90ff,stroke:#1565c0,color:#fff
    style Sn fill:#1e90ff,stroke:#1565c0,color:#fff
    style Put fill:#1e90ff,stroke:#1565c0,color:#fff
    style Wk fill:#1e90ff,stroke:#1565c0,color:#fff
```

The steps in detail:

1. **Upload.** The client sends the raw bytes (`Content-Type: application/octet-stream`, no multipart).
   The file name is a query parameter and is sanitized into a display name. The client's media type is
   never used. Rate limit, Origin, CSRF, authentication and permission all run before the body is read.
2. **Sniff.** The API accepts `%PDF-` at offset 0, the PNG signature or `FF D8 FF`. Anything else is a
   text candidate. A text candidate must contain no NUL, C0 control or DEL byte other than HT, LF, CR
   and FF, and must not start like HTML, SVG, XML or PHP. Known non-allowed signatures are refused (zip,
   gzip, PE, ELF, GIF, RIFF, OLE, PostScript, rar, 7z). The last extension must be one of
   `.pdf .png .jpg .jpeg .csv .txt` and must agree with the sniffed type.
3. **Store.** Transaction 1 inserts the `RECEIVED` row and its audit event before any slow I/O. The
   original goes to `t/<tenantId>/imports/<batchId>/<docId>/original` with SSE-KMS and a SHA-256
   checksum. In production a `HEAD` request verifies the encryption. Keys never contain the client file
   name.
4. **Isolated parse worker.** `ChildProcessExecutor` takes a slot from a per-instance semaphore. It
   starts `node` with `--permission`, which grants read access to the worker files only. The worker gets
   no write, child-process, worker, addon or WASI permission. It also gets `--max-old-space-size`, an
   **empty environment** and an empty working directory. A best-effort, in-process guard module deletes
   `fetch`, `WebSocket`, `EventSource` and `XMLHttpRequest`, blocks the network, process and VM modules,
   and locks socket `connect` on the classes reachable from the stdio streams. It is not a security
   boundary: the real network control is a no-egress network (in AWS the no-NAT task network), and a
   dedicated no-egress parser task is a launch gate. The parent
   enforces the wall clock, the output cap and (on Linux) an RSS limit. The parent also treats the
   worker as untrusted. It re-validates the whole response (allowed keys, counts, pointer bounds,
   re-sanitized strings), and an invalid response becomes `parse_failed`.
5. **PDF pre-scan.** `pdf-prescan.ts` walks the PDF structure with fixed bounds before pdf.js sees the
   file. It rejects these as `malformed_pdf`: more than 3 chained filters, an indirect `/Filter`,
   decompression bombs (32 MiB per stream, 64 MiB in total), `/Prev` loops, more than 64 xref sections,
   page trees larger than the page count plus 16, and zero pages. It also counts the string operands of
   the content streams, including text drawn outside the page box, so the `PARSE_MAX_TEXT_CHARS` cap
   holds (`text_too_large`). pdf.js then reads the text layer only. It reads no annotations,
   attachments, JavaScript or XFA.
6. **Extraction with provenance.** The deterministic provider (`deterministic`, version 1) reads
   `Key: value` lines and produces allow-listed fields only. Every field has a source pointer (page,
   line, UTF-16 start and end, CSV row, sanitized excerpt) and a rule-based confidence. A field is
   flagged when its confidence is below `REVIEW_CONFIDENCE_THRESHOLD` (0.90), when its value is
   unparseable, or when duplicates conflict. PDF fields start at 0.85, so every PDF field is flagged by
   default.
7. **Review.** A document with any review reason is `NEEDS_REVIEW` and appears in the review queue
   (`GET /reviews`). A reviewer confirms, corrects or rejects each flagged field. For images the
   reviewer can also set the type and add manual fields. Then the reviewer accepts or rejects the
   document. Every action needs a reason. Each decision is an append-only `import_review_decisions` row
   plus an audit event. ACCEPTED documents are immutable.
8. **Commit.** `POST /imports/:batchId/commit` groups the batch's ACCEPTED documents by normalized load
   number (NFKC, whitespace collapsed, upper case). It then creates an `AWAITING_ANALYSIS` claim or links
   to an existing one. If the claim already has a packet, the documents are only linked
   (`new_evidence_not_in_packet`), and its packet and fields never change. The commit is atomic and
   idempotent.

### Function call graph (upload)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    R43["R43 handler"] --> ING["ingestDocument"]
    ING --> ABA["assertBatchAcceptsUploads"]
    ING --> BODY["read body (body.ts)"]
    ING --> SNF["sniff"]
    ING --> PUT["ObjectStore.putObject"]
    ING --> RUN["ChildProcessExecutor.run"]
    RUN --> SEM["semaphore acquire"]
    RUN --> STW["startWorker (spawn.ts)"]
    STW --> WMN["worker-main"]
    WMN --> PDOC["parseDocument"]
    PDOC --> PSC["prescanPdf"]
    PDOC --> PDF["pdf.js text layer"]
    PDOC --> CSV["csv / text / image"]
    PDOC --> EXT["deterministic extract"]
    RUN --> VAL["validateWorkerResponse"]
    ING --> TX2["Tx 2 + appendAudit"]

    style ING fill:#1e90ff,stroke:#1565c0,color:#fff
    style RUN fill:#1e90ff,stroke:#1565c0,color:#fff
    style PSC fill:#1e90ff,stroke:#1565c0,color:#fff
    style VAL fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Function | Defined In | Called By | Purpose |
| --- | --- | --- | --- |
| `ingestDocument` | `api/src/imports/service.ts` | R43 (later also an email worker) | the whole synchronous pipeline |
| `sniff` | `api/src/imports/sniff.ts` | `ingestDocument` | magic bytes, text gate, extension rule |
| `ChildProcessExecutor.run` | `api/src/imports/sandbox/executor.ts` | `ingestDocument` | slot, spawn, limits, outcome mapping |
| `startWorker` | `api/src/imports/sandbox/spawn.ts` | executor | the only process spawn in `api/src` |
| `parseDocument` | `api/src/imports/parse/pipeline.ts` | worker-main (and unit tests) | PDF/CSV/TXT/image to text, classify, extract |
| `prescanPdf` | `api/src/imports/parse/pdf-prescan.ts` | `pdf.ts` | bounded structural checks before pdf.js |
| `validateWorkerResponse` | `api/src/imports/sandbox/protocol.ts` | executor | strict re-validation of the worker output |
| `resolveField`, `acceptDocument` | `api/src/imports/review-service.ts` | R48, R49 | human review gate |
| `commitBatch` | `api/src/imports/commit-service.ts` | R52 | documents to claims under an advisory lock |
| `loadBundleForClaim` | `api/src/imports/bundle.ts` | step 5 analysis (via `loadAnalysisInput`, which adds provenance) | claim documents to `ExtractedBundle` |

## Document and field states

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    RC["RECEIVED (transient)"] --> AC["ACCEPTED (terminal)"]
    RC --> NR["NEEDS_REVIEW"]
    RC --> RJ["REJECTED (terminal, no object)"]
    RC --> FL["FAILED (terminal)"]
    NR -- "R49 accept + reason" --> AC
    NR -- "R50 reject + reason" --> RJ

    style NR fill:#1e90ff,stroke:#1565c0,color:#fff
```

A field moves once from `PROPOSED` to `CONFIRMED`, `CORRECTED` or `REJECTED`. A BEFORE UPDATE trigger
enforces the transitions and keeps the extracted value, raw value, confidence and pointers immutable. A
`RECEIVED` document older than `IMPORT_STALE_SECONDS` becomes `FAILED` the next time its batch is read,
and its object is removed.

Since run `REQ-20261009-four-eyes`, R49 (accept) is refused with 403 `four_eyes_required` for the
document's uploader and for anyone who recorded a field `CORRECT` or `ADD` on it; see
[four-eyes](#web-platform-four-eyes-separation-of-duties). A document that goes straight from `RECEIVED`
to `ACCEPTED` (no review reasons) has no human acceptor (residual FE-S1).

## Data model and storage

| Table | Purpose | Notable rules |
| --- | --- | --- |
| `import_batches` | one upload session (later also one email) | insert and select only |
| `import_documents` | one file: sniffed type, sha256, status, reasons, counts, `storage_key` | `UNIQUE (tenant_id, batch_id, sha256)`; `storage_key LIKE 't/<tenant_id>/%'`; identity columns immutable; status transitions enforced by trigger; no DELETE |
| `extracted_fields` | one field with value, raw value, confidence, pointer and review status | immutable except status and correction; one live field per key (partial unique index) |
| `import_review_decisions` | every reviewer decision, with the reason and value hashes (never values) | append-only |
| `claim_documents` | links a document to at most one claim | insert-only |

All five tables have `ENABLE` and `FORCE ROW LEVEL SECURITY` with the tenant policy and column-level
grants for `freight_app`. They are allow-listed in `TENANT_MODELS`. Object storage is private.
Originals and derived text live under `t/<tenantId>/imports/<batchId>/<docId>/{original,text}`. Every
`ObjectStore` call re-checks the tenant prefix, and the API never returns a storage URL.
`GET .../original` streams the object through the API under a synthesized file name. It verifies the
SHA-256 of the streamed bytes and aborts on a mismatch.

## Export streaming

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    Rq["R54/R55/R56 + format"] --> Gt{"Permission, rate, gate ok?"}
    Gt -- no --> X4["403 / 429"]
    Gt -- yes --> Cn["Count rows (R26 filters)"]
    Cn --> Mx{"Over EXPORT_MAX_ROWS?"}
    Mx -- yes --> X422["422 export_too_large"]
    Mx -- no --> St["Commit export.started audit"]
    St --> Bt["Keyset batch of 500 (short tx)"]
    Bt --> Nz["cleanText + neutralizeFormula"]
    Nz --> Wr["CSV or XLSX writer"]
    Wr --> More{"More rows?"}
    More -- yes --> Bt
    More -- no --> Dn["export.completed: rows, bytes, SHA-256"]
    Wr -. "client abort" .-> Ab["export.aborted: rowsWritten"]

    style Nz fill:#1e90ff,stroke:#1565c0,color:#fff
    style St fill:#1e90ff,stroke:#1565c0,color:#fff
```

- **Formats.** CSV is UTF-8 with a BOM and CRLF, and every text cell is quoted. XLSX is one sheet,
  written as a streaming ZIP by `fflate`. It has typed strings and numbers and a bold, frozen header. It
  has no formulas, links, macros, drawings or external relationships.
- **Formula neutralization.** Text cells lose C0/C1 controls and bidi and zero-width characters. Tab,
  CR, LF, LS and PS become one space. Cells are capped at 10,000 characters. If the first
  non-whitespace character is `=`, `+`, `-`, `@` or a full-width form (U+FF1D, U+FF0B, U+FF0D, U+FF20),
  the cell gets a leading `'`. Numbers are written as numbers and are never neutralized.
- **Bounded memory.** Each batch of 500 rows uses its own short transaction, so no transaction stays
  open while the client reads. The writers honour backpressure.
- **Content.** Exports contain no user names, emails or ids. The claim assignee is excluded, and so is
  the demand letter text. Money is USD with two decimals, computed with integer arithmetic.
  `Invoice Date` is `YYYY-MM-DD`; timestamps are ISO-8601 UTC.

## Python parity: registered divergences (D1-D8)

The TypeScript parser must match the Python reference (`ingest_bytes`, `classify`,
`DeterministicStubProvider.extract`) for the supported subset. `api/test/parity/extract.parity.test.ts`
runs the Python code through `tools/parity/extract_dump.py`. It covers the fixture corpus, a generated
corpus and generated text-layer PDFs, and compares document type, sha256, text and fields. The
divergences below are the **only** allowed differences. Any other difference is a defect.

| ID | Divergence (TS vs Python) | Rationale |
| --- | --- | --- |
| D1 | PDF magic `%PDF-` must be at offset 0. Python tolerates up to 1024 junk bytes before it. | Leading junk is a classic polyglot trick (one file that is both a PDF and something else). Offset 0 makes the sniffed type unambiguous. |
| D2 | PDF text comes from pdf.js, not pdfplumber. Parity is claimed only for simple text-layer PDFs: one text line per line, standard Helvetica or Times, single column. | pdfplumber is Python-only, and the TS port must not call Python at runtime. Two engines order and space text differently on complex layouts. |
| D3 | The extension and the sniffed content type must agree. Allowed extensions: `.pdf .png .jpg .jpeg .csv .txt` (case-insensitive, last extension only). Python dispatches on the extension alone. | Stops a PDF or script disguised as `.csv` (and the reverse) from reaching the wrong parser. |
| D4 | Invalid UTF-8 is decoded with U+FFFD, as in Python, but adds the warning and review reason `DECODE_REPLACEMENTS`. A NUL byte, a C0 control byte other than HT, LF, CR and FF, **or DEL (0x7F)** rejects the file as `binary_content`. Python would continue. | Binary content in a "text" file signals a disguised or corrupted file. The DEL rule was added in fix round 1 (leader ruling SQ2). Python has no binary gate, so DEL has no Python counterpart. |
| D5 | Text longer than `PARSE_MAX_TEXT_CHARS` (default 2,000,000) is rejected as `text_too_large`. Python's cap is 5,000,000. For PDFs the cap also counts text drawn outside the page box (fix round 1 pre-scan). | A smaller bound on parser memory and time. |
| D6 | String values lose unsafe characters (controls, line separators, bidi controls) and are capped at 200 characters. The field gets reason `SANITIZED_VALUE` when anything changed. | Extracted strings are shown in the UI and exported, so they must be safe, single-line text. |
| D7 | Non-ASCII digits and exotic Unicode case folding are refused where Python's regexes would accept them. Date and time digits are ASCII `0-9` only, and the `USD` suffix matches ASCII letters only. | Stops look-alike digits and letters from changing amounts or dates. |
| D8 | PNG and JPEG are accepted and structurally validated but yield **no fields** (no OCR). The status is `NEEDS_REVIEW` with reason `IMAGE_NO_TEXT_LAYER`. A reviewer may set the type (R46) and enter fields (R47). | Python does not read images, and OCR is out of scope for step 3. |

Related notes (not new divergences):

- **Money format** (leader ruling SQ1): `parseMoney` keeps CPython parity, so `"1,2,3"` parses as `123`
  and `"$-5"` as `-5`. A later step may make money parsing stricter (step 5 did not). That change would be
  registered as a new divergence. Step 5 refuses a negative result at persistence instead (RD3, 422).
- **PDF pre-scan** (fix round 1): the pre-scan refuses bombs, filter chains longer than 3, an indirect
  `/Filter`, `/Prev` loops and oversized page trees before pdf.js runs. These hostile PDFs lie outside
  the D2 parity subset.
- **PNG trailing bytes** (fix round 1): up to 16 zero bytes after `IEND` are tolerated, the same rule as
  for JPEG. Images have no Python counterpart (D8).
- **`strptime` edge case**: parity follows CPython 3.12 for a leading space before `%H` or `%d`. CPython
  3.14 differs. The corpus avoids that case, and both versions show zero differences.
- **Field order** (ruling SQ4): fields are ordered by the N7 key order, then by `groupIndex`.

## Interfaces for step 5 (rules and evidence port)

**Status: delivered** in run `REQ-20261010-step5-analysis` (see
[claim analysis (step 5)](#web-platform-claim-analysis-step-5)). Items 1-6 are used as described below;
item 7 (an LLM provider) and stricter money parsing remain future work. Step 5 ported the Python rules and
evidence generation to TypeScript, with parity tests. It plugs into these step 3 interfaces:

1. **Input.** `loadBundleForClaim(tx, claimId)` returns `{bundle, sources}`. `bundle` is the TS
   `ExtractedBundle`, built from the effective field values of the claim's linked documents. Step 5
   added `loadAnalysisInput(tx, claimId)` (same document selection and order, plus field provenance and
   `sizeBytes`); `loadBundleForClaim` now delegates to it with an unchanged signature. The engine entry is
   `buildEvidence(docs, bundle, perspective, settings, now)` in `@fr/shared/analysis`. The Python
   counterpart is `run_pipeline` after `extract_bundle`.
2. **Provenance.** `pointerToLocator(displayName, pointer)` produces citation locators such as
   `invoice.txt:L5`, or `file.pdf:p2:L14` for PDFs. The seed already uses this convention. `sources[]`
   carries `documentId`, `displayName`, `sha256` and `docType` for `PacketSource`.
3. **Money.** `packages/shared/src/decimal.ts` is the base for money parsing. Step 5 added
   `packages/shared/src/analysis/py-decimal.ts`, a CPython-exact `Decimal` (precision 28, ROUND_HALF_EVEN,
   quantize, `str` and `.2f` formatting) for the rules arithmetic.
4. **Text.** `plain` and `md` (`packages/shared/src/text-sanitize.ts`) are already ported with parity.
   The letter renderer reuses them.
5. **Claim lifecycle.** Step 5 added the transition `AWAITING_ANALYSIS -> PENDING_REVIEW`. The same
   transaction creates packet revision 1 (with its content hash) and the `claim.analyzed` audit event.
   `claim_documents` names the source documents. Revision 1 records `created_by_id` as the user who
   triggered the analysis, so that user cannot approve it (four-eyes FE-N2 closed; the migration
   `20261012000000_analysis` refuses a revision 1 without an author for an awaiting claim).
6. **Parity pattern.** `tools/parity/` and `api/test/parity/` are the pattern for the rules dump
   script. CI already sets up Python. Step 5 added `tools/parity/rules_dump.py` and
   `api/test/parity/rules.parity.test.ts` (registered divergences RD1-RD6).
7. **Providers.** `ExtractionProvider` is where an LLM provider will plug in later, behind sanitization
   and with mandatory provenance. A future provider must return the same draft shape and pass the same
   validators. It can never lower a flag raised by the deterministic checks.

## How to run the step 3 checks

```bash
npm run db:migrate:deploy && npm run db:seed -- --reset
npm run ensure-bucket        # creates the dev/test bucket (MinIO), enables versioning; refuses production
npm run build                # builds the parser worker; run it before the integration and acceptance tests
npm run test:integration     # needs Postgres, S3 (MinIO) and Python for the parity suite (PYTHON=<interpreter>)
npm run test:acceptance      # black-box suites; same services
```

The README section "Import and export (step 3)" describes the local setup without Docker: portable
PostgreSQL, MinIO with KMS, and Python for parity.

## Notes (step 3)

- The run's `implementation.md` lists the deviations from the spec (14 items plus fix round 1). The most
  important two: the worker is not started with `--no-experimental-fetch` (the guard deletes the network
  globals instead), and the WAF Content-Length rule has a dedicated exception for the upload route.
- Concurrency gates (uploads, exports, parse slots) are per API instance, not distributed.
- Not verified: container images, the compose stack, Playwright end-to-end tests, any AWS deployment.

---

# Web platform: Dev dashboard, Recovery intelligence and API keys (step 4)

> Written by scriber for run `REQ-20261009-step4-intelligence` on 2026-10-09 (branch
> `feat/intelligence`). **Pre-product, synthetic data only, never deployed.** Threat rows for this step are
> T32-T45 in [technical/web-platform-security.md](technical/web-platform-security.md). Every secret is
> listed in [docs/secrets.md](docs/secrets.md). User-facing description:
> [README, step 4](README.md#dev-dashboard-recovery-intelligence-and-api-keys-step-4).

## Overview (step 4)

Step 4 adds four things on top of steps 1-3:

1. **Dev dashboard** (`/dev`, routes R60-R68) for `PLATFORM_DEV` and `SUPER_ADMIN`: pipeline health
   aggregated over all tenants, request telemetry and a filtered log view of the serving API instance,
   feature flags, read-only evaluation runs, and the platform audit chain. Platform responses carry
   aggregates and telemetry only.
2. **Recovery intelligence** (routes R70-R73) for tenant users: a prioritised worklist (`priority-v1`),
   similar past claims (`similar-v1`) and a provenance summary per claim. All three are deterministic
   functions of persisted columns of the caller's own tenant.
3. **Tenant API keys** (routes R80-R82 plus a machine-authentication path): HMAC-hashed, shown once,
   three scopes over exactly nine opted-in routes.
4. **Evaluation tool** (`api/src/eval/`, a command-line program): pass^k over the synthetic set
   `api/eval/sets/extraction-v1`, run through the real sandboxed parse pipeline; the only writer of
   evaluation data.

Binding rule for all of it (the **honest-labeling rule**): nothing is shown that is not computed from data
held by the system at request time or recorded by a measuring tool, every figure names its basis, and no
accuracy, speed-up, learning or "AI" claim appears. The fixed texts live in
`packages/shared/src/honest-copy.ts`; the UI renders them verbatim. An architecture test fails the build
if the strings "neural mesh", "Hebbian", "solved-problems cache", "AI-powered", "faster than" or an
"Nx faster" pattern appear in `api/src`, `packages/shared/src` or `web/src`.

## Brief terms vs what is built

The product brief uses vocabulary that this code does **not** implement. None of the following exists in
the repository, and no figure from the brief has been measured:

| Brief term | Status | What is built instead (honest equivalent) |
| --- | --- | --- |
| "Hebbian router" (ranks claims/lanes by expected recoverable value) | **Not implemented.** A Hebbian or any learned ranker needs recorded recovery outcomes (paid, short-paid, denied), and none exist. Lanes are not modelled. | `priority-v1`: a fixed formula `recoverable + floor(pending_review * W / 100)` with W = 25% as stated policy, explicit tie-breaks and a "why" list per row. Not called "expected value" (there are no probabilities). |
| "Neural mesh" (panel / metrics) | **Not implemented.** There is no neural component in the product. (`src/freight_recovery/forecast/neural.py` is optional, unvalidated roadmap scaffolding for the Python service and is wired to nothing.) | The "Intelligence components" table on the Telemetry tab: the two components `priority-v1` and `similar-v1` with measured calls, errors, duration bounds and candidate counts from real requests, labeled Method "Fixed rules" and Learned model "None". |
| "Solved-problems cache" with "~250x" | **Not implemented.** There is no cache of any kind, and the ~250x figure was never measured. "Winning evidence pattern" would need outcomes that do not exist. | `similar-v1`: explainable integer similarity (same carrier 35, shared rules up to 40, similar amount up to 15, same perspective 10; anchor required; minimum 30) over the tenant's own decided claims, showing how the team handled each one. It shows the measured `computeMs` of that single request and nothing resembling a speed-up ratio. |
| "AI extraction with provenance" | Exists since step 3 as **deterministic, rule-based** extraction with source pointers (no LLM). | Step 4 adds the per-claim provenance summary (field counts by review status, lowest rule-based confidence). |
| "pass^k metrics" | **Built, on synthetic fixtures only.** | The evaluation tool and the read-only Evaluation tab. With this deterministic pipeline pass^k equals pass^1, and the UI says so. Never presented as accuracy on customer documents. |

What a learned ranker would need (deferred, design only): recorded outcomes per claim; an offline
comparison against `priority-v1` on a held-out period with a pre-registered metric (for example captured
dollars at fixed review capacity) and an interval; and shipping only behind a new flag if it beats the
fixed formula with the interval excluding zero. The seam is the pure `scoreClaim`/`compareWorklist` pair
plus the `formula.version` field.

## Module Structure (step 4)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    subgraph Web["web/ (SPA)"]
        WD["features/dev (6 tabs)"]
        WI["features/intelligence"]
        WK["features/apikeys"]
        WC["api/client (strict parse)"]
    end

    subgraph Shared["packages/shared"]
        SR["rbac (+3 permissions)"]
        SF["feature-flags registry"]
        SH["honest-copy texts"]
        SE["eval-stats computePassStats"]
        SD["platform/intel/key DTOs"]
    end

    subgraph Http["api/src/http + auth"]
        SP["security.ts pipeline"]
        AK["auth/api-key-auth.ts"]
    end

    subgraph Plat["api/src/platform"]
        PR["dashboard-routes R60-R68"]
        FS["flags.ts FlagService"]
        PP["pipeline.ts + eval-read"]
    end

    subgraph Intel["api/src/intelligence"]
        IR["routes R70-R73"]
        IS["service.ts"]
        PRI["priority.ts (pure)"]
        SIM["similarity.ts (pure)"]
    end

    subgraph Keys["api/src/apikeys"]
        KR["routes R80-R82"]
        KM["key-material HMAC"]
    end

    subgraph Obs["api/src/observability"]
        MR["metrics.ts registry"]
        RB["ring-buffer.ts"]
    end

    subgraph Data["db + eval"]
        DI["db/intelligence.ts SQL"]
        DS["db/system.ts stats fn"]
        EV["eval CLI + record"]
    end

    WD --> WC
    WI --> WC
    WK --> WC
    WC --> SD
    WC --> SP
    SP --> AK
    AK --> KM
    SP --> PR
    SP --> IR
    SP --> KR
    PR --> FS
    PR --> PP
    PR --> MR
    PR --> RB
    PP --> DS
    IR --> FS
    IR --> IS
    IS --> PRI
    IS --> SIM
    IS --> DI
    KR --> KM
    EV --> SE
    PP --> SE
    FS --> SF
    WI --> SH

    style AK fill:#1e90ff,stroke:#1565c0,color:#fff
    style KM fill:#1e90ff,stroke:#1565c0,color:#fff
    style FS fill:#1e90ff,stroke:#1565c0,color:#fff
    style RB fill:#1e90ff,stroke:#1565c0,color:#fff
    style DS fill:#1e90ff,stroke:#1565c0,color:#fff
    style PRI fill:#1e90ff,stroke:#1565c0,color:#fff
    style SIM fill:#1e90ff,stroke:#1565c0,color:#fff
```

> Everything in this diagram is new or changed in step 4. Blue marks the security-relevant modules (key
> authentication, key hashing, the flag cache, log derivation, the cross-tenant aggregate function) and
> the two scoring cores.

### Module Reference (step 4)

| Module / File | Layer | Purpose | Key Exports | Changed |
| --- | --- | --- | --- | --- |
| `packages/shared/src/rbac.ts` | Shared | Adds `platform:eval` (PLATFORM_DEV), `platform:audit` (SUPER_ADMIN), `apikeys:manage` (OWNER, ADMIN) | `PERMISSION_MATRIX`, `can` | changed |
| `packages/shared/src/feature-flags.ts` | Shared | The flag registry: exactly `intelligence.provenance`, `intelligence.similar_claims`, `intelligence.worklist` (architecture test) | `FEATURE_FLAGS`, `isKnownFlag` | new |
| `packages/shared/src/honest-copy.ts` | Shared | The fixed honest texts (worklist, similar, provenance, no-accuracy, eval, telemetry, logs, pipeline notes) | `WORKLIST_NOTE`, `worklistNote`, `EVAL_NOTE`, ... | new |
| `packages/shared/src/eval-stats.ts` | Shared | pass^k statistics: per-run rate, pass^k, unbiased pass^j curve, flaky counts, Wilson 95% interval (z = 1.959964) | `computePassStats`, `binomial`, `wilsonInterval` | new |
| `packages/shared/src/{platform,intelligence,api-key}-dto.ts` | Shared | Strict Zod schemas for every step 4 request and response; the web client and the API both parse with them | schemas, `API_KEY_SCOPES`, `SCOPE_PERMISSION` | new |
| `api/src/http/security.ts`, `http/route.ts`, `http/context.ts` | API | URL guard (`fr_live_` in a URL = 400), the key branch of the pre-handler, `apiKeyScope` on route access, `RequestCtx.role = 'API_KEY'` with `viaApiKey` | `registerSecurityPipeline`, `defineRoute` | changed |
| `api/src/auth/api-key-auth.ts` | API | Machine authentication: per-IP failure gate, format, lookup, constant-time HMAC compare, state checks, route and scope checks, creator re-check, per-key limit, context | `ApiKeyAuthenticator`, `FailureGate` | new |
| `api/src/apikeys/{key-material,service,routes}.ts` | API | Key generation (`randomBytes`), HMAC-SHA-256 with the pepper, quota under a tenant lock, R80-R82 | `generateKey`, `verifySecret`, `createApiKey`, `revokeApiKey` | new |
| `api/src/audit/attribution.ts` | API | Adds `viaApiKey` and actor role `API_KEY` centrally in `appendAudit` for key-authenticated requests (DV-7) | `registerApiKeyRequest`, `apiKeyFor` | new |
| `api/src/platform/dashboard-routes.ts` | API | R60-R68: audited platform reads, strict outgoing schemas (`strictBody`), `platform` rate group | `registerPlatformDashboardRoutes` | new |
| `api/src/platform/flags.ts` | API | `FlagService`: per-instance TTL cache, fail closed, row lock + optimistic version + audit in one system transaction | `FlagService`, `validFlagReason` | new |
| `api/src/platform/pipeline.ts`, `eval-read.ts` | API | Assemble `PipelineHealth` from the SQL function (zero-fill, rates); read eval runs | `assemblePipelineHealth`, `listEvalRuns`, `getEvalRun` | new |
| `api/src/intelligence/priority.ts` | Core | `priority-v1`: score, 4-key order, "why" texts, next action (pure, integer cents) | `scoreClaim`, `compareWorklist`, `buildWhy`, `nextAction` | new |
| `api/src/intelligence/similarity.ts` | Core | `similar-v1`: carrier normalization, point scoring, inclusion rule, ranking (pure) | `scoreSimilarity`, `rankSimilar`, `normalizeCarrier` | new |
| `api/src/intelligence/{service,routes}.ts` | API | R70-R73: flag check first (off = 404), tenant-tx reads, component telemetry, `intelligence.viewed` audit | `buildWorklist`, `findSimilar`, `provenanceFor` | new |
| `api/src/db/intelligence.ts` | Data | Parameterized raw SQL for worklist, similarity features and provenance, run on the caller's tenant transaction (raw SQL stays in `db/`, DV-1) | `worklistPage`, `similarityFeatures`, `provenanceRows` | new |
| `api/src/db/system.ts` | Data | Adds `platformPipelineStats` (calls `fr_platform_pipeline_stats`) and `lockFeatureFlag` | | changed |
| `api/src/observability/metrics.ts` | API | `MetricsRegistry`: 11 fixed duration buckets, at most 200 route keys, nearest-rank bucket bounds, component stats; no I/O | `MetricsRegistry`, `DURATION_BOUNDS` | new |
| `api/src/observability/ring-buffer.ts`, `api/src/logging.ts` | API | Logger tee into a bounded ring of derived 8-field records; `route` in `serializeRes`; `fr_live_` scrubbing | `LogRingBuffer`, `deriveRecord`, `safeEvent` | new / changed |
| `api/src/eval/{manifest,runner,canonical,record,cli,git-sha}.ts` | Tool | Manifest guards, k runs through the real sandbox, canonical digests, stats, `--record` (only DB writer, system tx) | `loadSet`, `runEval`, `EVAL_STAGES`, `recordRun` | new |
| `api/eval/sets/extraction-v1/` | Data | 30 synthetic cases (9 Python-oracle, 9 rejected, 12 hand-authored) and a README | | new |
| `api/prisma/migrations/20261010000000_intelligence/` | Data | `feature_flags`, `eval_runs`, `eval_case_results`, `api_keys`, `fr_platform_pipeline_stats`, RLS FORCE, grants, triggers | | new |
| `web/src/features/dev/*`, `features/intelligence/*`, `features/apikeys/ApiKeysPage.tsx`, `api/client.ts`, `AppShell.tsx` | Web | Dev dashboard (6 lazy tabs), Intelligence page, claim-sheet Similar/Provenance tabs, API keys page, role-aware navigation | pages | new / changed |
| `.github/workflows/web-ci.yml`, `compose.web.yml`, `.env.example`, `infra/{ecs,iam,locals,variables}.tf` | Ops | CI eval gate and public CI pepper, knob passthrough, Secrets Manager container and reference `api-key-pepper` | | changed |

## Request flow: API key vs cookie/JWT authentication

Both kinds of request share the pre-handler in `api/src/http/security.ts`. The branch is chosen only by
the `Authorization` header: `Bearer fr_live_...` is a key request, any other bearer value is a user
access token exactly as before. A key request never consults a cookie, never needs a CSRF token and never
receives a cookie.

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    Req["HTTPS request"] --> Url{"fr_live_ in URL?"}
    Url -- yes --> E400["400, value not logged"]
    Url -- no --> Rate{"Global rate limit ok?"}
    Rate -- no --> E429a["429"]
    Rate -- yes --> Kind{"Bearer fr_live_?"}
    Kind -- no --> Csrf{"Unsafe: Origin + CSRF ok?"}
    Csrf -- no --> E403a["403"]
    Csrf -- yes --> Jwt{"JWT valid, user live?"}
    Jwt -- no --> E401a["401"]
    Jwt -- yes --> Perm{"Permission?"}
    Kind -- yes --> Org{"Origin absent or APP_ORIGIN?"}
    Org -- no --> E403b["403"]
    Org -- yes --> Gate{"IP failure budget left?"}
    Gate -- no --> E429b["429 before verify"]
    Gate -- yes --> Ver{"Key known, HMAC equal, live?"}
    Ver -- no --> E401b["401 identical + count IP"]
    Ver -- yes --> Scope{"Route opted in + scope?"}
    Scope -- no --> E403c["403 + use_denied"]
    Scope -- yes --> Creator{"Creator still holds perm?"}
    Creator -- no --> E401c["401 + use_denied"]
    Creator -- yes --> KLim{"Per-key limit ok?"}
    KLim -- no --> E429c["429"]
    KLim -- yes --> Perm
    Perm -- no --> E403d["403 + authz.denied"]
    Perm -- yes --> Tx["withTenantTx: RLS context"]
    Tx --> H["Handler + audit (viaApiKey)"]

    style Gate fill:#1e90ff,stroke:#1565c0,color:#fff
    style Ver fill:#1e90ff,stroke:#1565c0,color:#fff
    style Scope fill:#1e90ff,stroke:#1565c0,color:#fff
    style Creator fill:#1e90ff,stroke:#1565c0,color:#fff
```

Details of the key path (`ApiKeyAuthenticator.authenticate`):

- **Lookup and compare.** The key is parsed with `^fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$`. The row is
  found by `key_id` in a system transaction (the `api_keys` RLS policy allows system mode). The presented
  secret is hashed with `HMAC-SHA-256(API_KEY_PEPPER, secret)` and compared with `timingSafeEqual`; an
  unknown key id is compared against a fixed dummy digest, so the work is the same. Unknown, malformed,
  wrong secret, revoked and expired all answer the identical 401.
- **State on every request.** Revocation, expiry, tenant suspension and the creator's status are read
  from the database on every request; nothing about key state is cached, so a revocation is effective on
  the next request on every instance.
- **Route opt-in.** Only routes declared with `access.apiKeyScope` accept keys. An architecture test
  enumerates every route and requires the set to be exactly R26, R27, R53 (`claims.read`), R54
  (`exports.claims`) and R40-R44 (`imports.write`). Any other route answers 403 after a successful key
  authentication, so the denial can be audited (`apikey.use_denied` reason `route`).
- **Confused-deputy guard.** The key's permissions are `SCOPE_PERMISSION[scope]` for its scopes, and the
  creator's **current** role must still hold each one; otherwise 401 (reason `creator`). The tenant comes
  only from the key row; tenant ids in headers, query or body are ignored.
- **Abuse limits.** Failed authentications count per client address in the shared limiter store. Once
  `RATE_LIMIT_API_KEY_FAIL_MAX` (30) failures are reached in 10 minutes, the address is refused with 429
  before any verification until the window ends (the boundary fix D-4: the 31st attempt is refused, using
  the limiter's `remaining` count). The "refuse early" cache is per instance; the counts are shared.
  Successful requests then pass the per-key limiter (`RATE_LIMIT_API_KEY_MAX`, 300 per 60 s).
- **Attribution.** The context is `{tenantId: key.tenant_id, actor: creator, role: 'API_KEY',
  viaApiKey: keyId}`, and the request continues through the same `withTenantTx` path as a user request.
  `appendAudit` adds `viaApiKey` from a request registry (DV-7). `last_used_at` is updated at most once
  per 60 seconds, best effort.

### Function call graph (step 4)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    R71["R71 worklist handler"] --> FL["FlagService.isEnabled"]
    R72["R72 similar handler"] --> FL
    R71 --> BW["buildWorklist"]
    BW --> WP["worklistPage (SQL)"]
    BW --> SC["scoreClaim / buildWhy"]
    R72 --> FS2["findSimilar"]
    FS2 --> SF["similarityFeatures (SQL)"]
    FS2 --> RS["rankSimilar"]
    RS --> SS["scoreSimilarity"]
    SS --> NC["normalizeCarrier"]
    R71 --> OC["observeComponent"]
    R72 --> OC
    R71 --> AA["appendAudit intelligence.viewed"]
    PRE["security pipeline"] --> AUTH["ApiKeyAuthenticator"]
    AUTH --> FG["FailureGate.check"]
    AUTH --> VS["verifySecret (timingSafeEqual)"]
    R60["R60 pipeline"] --> PS["platformPipelineStats"]
    PS --> FN["fr_platform_pipeline_stats"]
    R62["R62 logs"] --> LRB["LogRingBuffer.query"]
    CLI["eval cli"] --> RE["runEval"]
    RE --> CPS["computePassStats"]
    CLI --> REC["recordRun (--record)"]

    style AUTH fill:#1e90ff,stroke:#1565c0,color:#fff
    style VS fill:#1e90ff,stroke:#1565c0,color:#fff
    style SC fill:#1e90ff,stroke:#1565c0,color:#fff
    style SS fill:#1e90ff,stroke:#1565c0,color:#fff
    style FN fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Function | Defined In | Called By | Purpose |
| --- | --- | --- | --- |
| `scoreClaim`, `compareWorklist`, `buildWhy`, `nextAction` | `api/src/intelligence/priority.ts` | `buildWorklist` | `priority-v1` arithmetic, order and explanation; the SQL `ORDER BY` must agree with `compareWorklist` (integration test on 48 random claims) |
| `scoreSimilarity`, `rankSimilar`, `normalizeCarrier` | `api/src/intelligence/similarity.ts` | `findSimilar` | `similar-v1` points, inclusion (anchor + minimum 30), order; no caching of any kind |
| `worklistPage`, `similarityFeatures`, `provenanceRows` | `api/src/db/intelligence.ts` | intelligence service | parameterized SQL on the caller's tenant transaction, plus explicit `tenant_id = fr_current_tenant()` predicates |
| `FlagService.isEnabled` / `change` | `api/src/platform/flags.ts` | intelligence routes, R63/R64 | TTL-cached read, fail closed; locked, versioned, audited change |
| `ApiKeyAuthenticator.authenticate` | `api/src/auth/api-key-auth.ts` | security pipeline | machine authentication (see above) |
| `MetricsRegistry.observeRequest` / `observeComponent` / `snapshot` | `api/src/observability/metrics.ts` | `onResponse` hook, R71/R72, R61 | in-process telemetry |
| `LogRingBuffer.ingest` / `query` | `api/src/observability/ring-buffer.ts` | logger tee, R62 | derived log records |
| `platformPipelineStats` | `api/src/db/system.ts` | R60 | calls the `SECURITY DEFINER` function in a system transaction |
| `runEval`, `computePassStats`, `recordRun` | `api/src/eval/runner.ts`, `packages/shared/src/eval-stats.ts`, `api/src/eval/record.ts` | eval CLI | k runs per case, statistics, optional recording |

## Data model additions (step 4)

| Object | Purpose | Notable rules |
| --- | --- | --- |
| `feature_flags(key, enabled, version, updated_by_id, updated_at, last_reason)` | Global flags; the migration inserts the 3 registry rows | Not tenant-scoped (holds no tenant data). RLS FORCE; SELECT for all, UPDATE only in system mode; `freight_app` has `SELECT` and column-level `UPDATE` only; a trigger requires `key` unchanged and `version = old + 1`; DELETE and TRUNCATE raise for every role |
| `eval_runs`, `eval_case_results` | Recorded evaluation runs and per-case results (no document content, values or file names) | RLS FORCE with a system-mode-only policy (a raw connection sees zero rows and cannot insert); `SELECT, INSERT` grants only; UPDATE, DELETE and TRUNCATE raise in every mode; CHECKs tie the counts together (`runs_passed <= runs_total`, `pass_hat_k_count <= pass_at_least_one_count <= case_count`, curve length = k, `passed_all = (runs_passed = k)`) |
| `api_keys(id, tenant_id, key_id, name, secret_hash, scopes, created_by_id, created_at, expires_at, last_used_at, revoked_at, revoked_by_id, revoke_reason)` | Tenant API keys | Tenant-scoped, in `TENANT_MODELS`; policy `tenant_id = fr_current_tenant() OR fr_system_mode()` (system mode for the lookup by `key_id`); CHECKs on `key_id` (16 hex), `secret_hash` (64 hex), 1-3 scopes from the three, name length, revoke-reason length and all-or-nothing revoke columns; only `last_used_at` and the revoke columns are updatable, revocation is set once and never cleared; DELETE/TRUNCATE raise |
| `fr_platform_pipeline_stats(window_seconds, stale_seconds)` | Cross-tenant aggregate for R60 | `SECURITY DEFINER`, `search_path` pinned, raises unless system mode, range-checks its inputs, `EXECUTE` granted to `freight_app` only; returns `(metric, label, n, p50_ms, p95_ms)` rows and never selects a tenant id, user id, name, file name, storage key, hash or claim number |
| index `claims (tenant_id, status, updated_at DESC, id)` | Worklist and similarity queries | plans recorded in the run's `implementation.md` (no timings claimed) |

## Flag cache

`FlagService.isEnabled(key)` keeps a per-instance cache keyed by flag with TTL `FLAGS_CACHE_TTL_MS`
(default 5000 ms, production ceiling 30000 ms, 0 disables it). A read error returns **false** (fail
closed) and is not cached for more than 1 second. A change (`PUT /platform/flags/:key`) runs in one system
transaction: registry check (unknown key = 404 before any DB access), `SELECT ... FOR UPDATE`, version
compare (409 `stale_revision`), same value (409 `conflict`, nothing written), update with `version + 1`,
`platform.flag_changed` audit; the local cache is invalidated after commit. Other instances see the change
within their TTL. Flags gate only the three intelligence features; they cannot reach auth, CSRF, RLS or
audit code paths (architecture test).

## Observability: telemetry registry and log ring buffer

- **Telemetry.** A Fastify `onResponse` hook (registered before the routes, so health routes count)
  records the route **pattern** (`routeOptions.url`, or `(unmatched)`), the method (unknown methods
  become `OTHER`), the status and `reply.elapsedTime`. It never reads the URL, query, headers or body.
  Memory is bounded: at most 200 route keys (overflow into `(other)`) times 11 buckets. Percentiles are
  reported as the upper bound of the bucket that holds the nearest rank. The parser executor counters and
  the two component stats are added at snapshot time. Nothing touches the database.
- **Log ring buffer.** `createLogger` tees every formatted (already redacted) line into
  `LogRingBuffer(LOG_BUFFER_SIZE)`. `ingest` parses the line inside try/catch and keeps only a derived
  record of 8 fields (time, level, request id if a UUID, method if standard, route if it starts with `/`,
  has no `?` and is at most 200 characters, status 100-599, finite duration, event if it passes the
  message rule); everything else is discarded, and the buffer never throws into the logger. The logger
  additionally replaces any `fr_live_...` string at any depth with `[REDACTED]`. Telemetry and logs are
  **per instance and ephemeral**, and the UI says so.

## Evaluation tool (data flow)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    C["npm run eval -- --set dir"] --> M{"Manifest valid, paths inside dir?"}
    M -- no --> X2["exit 2, nothing recorded"]
    M -- yes --> K["Each case: k runs"]
    K --> P["Pre-store checks + sandboxed parse"]
    P --> J["Compare exactly with expect"]
    J --> I{"Infrastructure error?"}
    I -- yes --> X3["exit 3, nothing recorded"]
    I -- no --> S["computePassStats + digests"]
    S --> R{"--record?"}
    R -- yes --> W["One system tx: run + cases + audit"]
    R -- no --> O["Print table or JSON"]
    W --> O
    O --> T{"pass^k >= threshold?"}
    T -- no --> X1["exit 1"]
    T -- yes --> X0["exit 0"]

    style P fill:#1e90ff,stroke:#1565c0,color:#fff
    style W fill:#1e90ff,stroke:#1565c0,color:#fff
```

The stage registry `EVAL_STAGES` currently holds `extraction` only. A `rules` stage was planned for
step 5 but deferred; the rules are checked against Python by the parity suite instead. The set
hash `evalSetSha256` covers the manifest and every case file in order; fixtures are kept byte-exact by
`.gitattributes` (`api/eval/sets/** -text`).

## Interfaces for step 5

Status after run `REQ-20261010-step5-analysis`: item 1 is delivered; items 2 and 3 were deferred and
remain open.

1. **Delivered.** The intelligence features read only persisted columns (`claims` amounts, status, carrier,
   perspective, `updated_at`; the latest `evidence_packets` revision; `packet_findings.rule_id` and
   `needs_human_review`; `packet_sources.doc_type`; `approvals.created_at`). Step 5 now creates packet
   revision 1 (`AWAITING_ANALYSIS -> PENDING_REVIEW`), so analyzed imported claims enter the worklist,
   similarity and provenance without a step 4 change. `rule_id` is one of the eight stable, non-empty
   `RULE_IDS` (`rules-v1`).
2. **Open.** A `rules` stage in `EVAL_STAGES` (and a migration widening the `stage` CHECK), reusing
   `computePassStats`, the recorder and the dashboard, with the Python `run_pipeline` as the oracle.
3. **Open.** Telemetry `observeComponent('rules-v1', ...)`. No flag was added (analyze-on-commit is not
   built).

## Notes (step 4)

- Deviations recorded by the builder (DV-1..DV-11), most relevant: raw SQL lives in `db/` (DV-1); the
  route table has 199 keys plus `(other)` (DV-2); audited reads append in their own transaction after
  the data is computed, and a failed append still returns 500 with no data (DV-3); `API_KEY_PEPPER` has
  a public default outside production (DV-4); a key on a non-key route gets 403 even for `/healthz`, and
  an `Origin` on a key request is checked for every method (DV-5); the per-IP "refuse early" cache is per
  instance (DV-6); platform users land on `/dev` (DV-11).
- Deferred (design only, not built): per-key IP allow-lists, key rotation helpers (create-then-revoke is
  the manual path), HMAC request signing, per-key usage dashboards, more scopes, four-eyes on flag
  changes, cluster-wide telemetry and logs, any learned ranker.
- Not verified: container images, the compose stack, Playwright end-to-end tests, any AWS deployment.

---

# Web platform: four-eyes (separation of duties)

> Written by scriber for run `REQ-20261009-four-eyes` on 2026-10-10 (branch `feat/four-eyes`, build
> commit `8eb7062`). **Pre-product, synthetic data only, never deployed.** Threat row T46, the policy
> defaults and the accepted residuals are in
> [technical/web-platform-security.md, section 8](technical/web-platform-security.md#8-four-eyes-separation-of-duties).
> User-facing description: [README, four-eyes](README.md#four-eyes-separation-of-duties).

## Overview (four-eyes)

Two decisions now need a second person:

1. **Claims.** A user who created **any** packet revision of a claim (current or superseded) cannot
   approve or reject the claim's current revision. A revision with no recorded creator (seeded revision
   1) excludes nobody. Since step 5, revision 1 created by analysis records the analyzer. Send-ready is
   unchanged.
2. **Imported documents.** The uploader and every user who recorded a field `CORRECT` or `ADD` cannot
   accept the document. Reject is unchanged. API-key uploads count as uploads by the key's creator.

The service check is the primary control. Database triggers back it up, a refusal is one fixed 403 for
every caller and is audited, and the UI hides the button for the excluded person (cosmetic only). No
table, column, tenant table, RBAC entry or route was added. The only schema change is the trigger
migration `20261011000000_four_eyes`.

## Module Structure (four-eyes)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    subgraph Shared["packages/shared"]
        FE["four-eyes.ts"]
        AA["audit-actions.ts"]
        DTO["dto.ts / import-dto.ts"]
    end
    subgraph Web["web/src/features"]
        AP["ApprovalsPage.tsx"]
        RQ["ReviewQueuePage.tsx"]
    end
    subgraph API["api/src"]
        CR["claims/routes.ts"]
        CS["claims/service.ts"]
        IR["imports/routes.ts"]
        RS["imports/review-service.ts"]
        ID["imports/dto.ts"]
        ER["http/errors.ts"]
        APP["app.ts error handler"]
        CH["audit/chain.ts"]
    end
    subgraph DB["PostgreSQL 16"]
        MIG["20261011000000_four_eyes"]
        T1["approvals trigger"]
        T2["review_decisions trigger"]
    end

    AP --> FE
    RQ --> FE
    AP --> DTO
    RQ --> DTO
    CR --> CS
    IR --> RS
    RS --> ID
    CS --> ER
    RS --> ER
    ER --> APP
    APP --> CH
    APP --> AA
    CS --> T1
    RS --> T2
    MIG --> T1
    MIG --> T2

    style FE fill:#1e90ff,stroke:#1565c0,color:#fff
    style AA fill:#1e90ff,stroke:#1565c0,color:#fff
    style DTO fill:#1e90ff,stroke:#1565c0,color:#fff
    style AP fill:#1e90ff,stroke:#1565c0,color:#fff
    style RQ fill:#1e90ff,stroke:#1565c0,color:#fff
    style CS fill:#1e90ff,stroke:#1565c0,color:#fff
    style CR fill:#1e90ff,stroke:#1565c0,color:#fff
    style RS fill:#1e90ff,stroke:#1565c0,color:#fff
    style ID fill:#1e90ff,stroke:#1565c0,color:#fff
    style IR fill:#1e90ff,stroke:#1565c0,color:#fff
    style ER fill:#1e90ff,stroke:#1565c0,color:#fff
    style APP fill:#1e90ff,stroke:#1565c0,color:#fff
    style CH fill:#1e90ff,stroke:#1565c0,color:#fff
    style MIG fill:#1e90ff,stroke:#1565c0,color:#fff
    style T1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style T2 fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Module/Function | Purpose | Key Dependencies | Changed in This Run |
| --- | --- | --- | --- |
| `packages/shared/src/four-eyes.ts` | `FOUR_EYES_ERROR_CODE`, `FOUR_EYES_CLAIM_TEXT`, `FOUR_EYES_DOCUMENT_TEXT` (exact UI copy) | none | new |
| `packages/shared/src/audit-actions.ts` | adds `authz.four_eyes_denied` (last entry) | none | changed |
| `packages/shared/src/dto.ts`, `import-dto.ts` | required `selfAuthored: boolean` on `ApprovalItem` and `ImportDocumentDetail` only | zod | changed |
| `api/src/http/errors.ts` | `four_eyes_required` message; `FourEyesRefusal` (403, carries the audit context); `errors.fourEyes(audit)` | `HttpError` | changed |
| `api/src/app.ts` | async error handler: appends `authz.four_eyes_denied` in its own tenant transaction, 500 if that fails; `isFourEyesDbError` maps a trigger refusal to 403 | `appendAudit`, `requireTenant` | changed |
| `api/src/audit/chain.ts` | `basis` allow-listed in `METADATA_KEYS` | none | changed |
| `api/src/claims/service.ts` | `FOUR_EYES_GUARDED_TRANSITIONS`; author check in `transition()`; `listApprovalQueue(tx, query, viewerId)` computes `selfAuthored` | `lockAndLoadLatest` | changed |
| `api/src/claims/routes.ts` | passes `requireTenant(req).user.id` as the viewer | claims service | changed |
| `api/src/imports/review-service.ts` | `assertNotDocumentEditor` in `acceptDocument`; all detail call sites pass the viewer | `lockReviewable`, `documentDetail` | changed |
| `api/src/imports/dto.ts` | `EDITOR_DECISIONS = {CORRECT, ADD}`; `isDocumentEditor(uploadedById, decisions, viewerId)` | none | changed |
| `api/src/imports/service.ts`, `routes.ts`, `deps.ts` | `documentDetail(..., viewerId)`; `uploadedById` loaded internally (no DTO exposes it); ingest refuses a `user` actor with a non-UUID id; attribution rule documented | storage, DB | changed |
| `api/prisma/migrations/20261011000000_four_eyes/` | `fr_approval_four_eyes_guard`, `fr_review_four_eyes_guard` and their `BEFORE INSERT` triggers | `evidence_packets`, `import_documents`, `import_review_decisions` | new |
| `web/src/features/approvals/ApprovalsPage.tsx` | hides Approve/Reject when `selfAuthored`; maps a 403 `four_eyes_required` to the claim text and refetches | shared constants | changed |
| `web/src/features/imports/ReviewQueuePage.tsx` | hides Accept document when `selfAuthored`; maps the 403 to the document text and refetches | shared constants | changed |

## Function Call Graph (four-eyes)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    R1["POST approve / reject"] --> TR["transition()"]
    TR --> LK["lockAndLoadLatest"]
    TR --> GT{"in GUARDED_TRANSITIONS?"}
    GT -- yes --> AF["findFirst author rev"]
    AF -- found --> FR["errors.fourEyes()"]
    AF -- none --> INS1["insert approvals row"]
    INS1 --> TG1["fr_approval_four_eyes_guard"]

    R2["POST accept document"] --> ACC["acceptDocument()"]
    ACC --> LR["lockReviewable"]
    ACC --> AN["assertNotDocumentEditor"]
    AN -- editor --> FR
    AN -- not editor --> INS2["insert ACCEPT decision"]
    INS2 --> TG2["fr_review_four_eyes_guard"]

    FR --> EH["app error handler"]
    TG1 -. "P0001 (bypass only)" .-> MAP["isFourEyesDbError"]
    TG2 -. "P0001 (bypass only)" .-> MAP
    MAP --> EH
    EH --> AUD["appendAudit four_eyes_denied"]

    style TR fill:#1e90ff,stroke:#1565c0,color:#fff
    style AF fill:#1e90ff,stroke:#1565c0,color:#fff
    style AN fill:#1e90ff,stroke:#1565c0,color:#fff
    style FR fill:#1e90ff,stroke:#1565c0,color:#fff
    style TG1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style TG2 fill:#1e90ff,stroke:#1565c0,color:#fff
    style MAP fill:#1e90ff,stroke:#1565c0,color:#fff
    style EH fill:#1e90ff,stroke:#1565c0,color:#fff
    style AUD fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Function | Defined In | Called By | Purpose |
| --- | --- | --- | --- |
| `transition` | `api/src/claims/service.ts` | claims routes (approve, reject, send) | state machine, then the author check for approve/reject, then the acknowledgement check |
| `listApprovalQueue` | `api/src/claims/service.ts` | `GET /api/v1/approvals` | one `distinct` query over the page's claim ids sets `selfAuthored` |
| `acceptDocument`, `assertNotDocumentEditor` | `api/src/imports/review-service.ts` | `POST .../accept` | uploader check (`basis: uploader`), then CORRECT/ADD check (`basis: field_editor`), before the unresolved-field checks |
| `documentDetail`, `isDocumentEditor` | `api/src/imports/service.ts`, `api/src/imports/dto.ts` | detail, upload, set type, accept, reject, ingest | `selfAuthored` from the decisions already loaded (no extra query) |
| `FourEyesRefusal`, `errors.fourEyes` | `api/src/http/errors.ts` | both services | 403 `four_eyes_required` carrying `{tenantId, targetType, targetId, metadata}` |
| `isFourEyesDbError` | `api/src/app.ts` | `toHttpError` | matches SQLSTATE `P0001` and the exact message `four_eyes_required` on the error or its `cause`/`meta` chain (depth 5, cycle-safe) |
| `fr_approval_four_eyes_guard` | migration `20261011000000_four_eyes` | `BEFORE INSERT ON approvals` | refuses `APPROVE`/`REJECT` by any `created_by_id` of the claim's packets (same tenant) |
| `fr_review_four_eyes_guard` | migration `20261011000000_four_eyes` | `BEFORE INSERT ON import_review_decisions` | refuses `ACCEPT` by the uploader or a CORRECT/ADD actor of the document (same tenant) |

## Data Flow (four-eyes refusal)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    A["Approve / reject / accept"] --> B["Route checks: 400, 401, 403, 404"]
    B --> C["Business tx: row lock"]
    C --> D{"Stale or wrong state?"}
    D -- yes --> E["409 (unchanged)"]
    D -- no --> F{"Requester excluded?"}
    F -- no --> G["Insert decision row"]
    G --> H{"Trigger agrees?"}
    H -- yes --> I["Commit: 200"]
    H -- no --> J["Rollback"]
    F -- yes --> J
    J --> K["Own tx: append four_eyes_denied"]
    K --> L{"Audit append ok?"}
    L -- yes --> M["403 four_eyes_required"]
    L -- no --> N["500 internal_error"]

    style F fill:#1e90ff,stroke:#1565c0,color:#fff
    style H fill:#1e90ff,stroke:#1565c0,color:#fff
    style K fill:#1e90ff,stroke:#1565c0,color:#fff
    style M fill:#1e90ff,stroke:#1565c0,color:#fff
```

The "Trigger agrees?" branch is a backstop: it is reached only if application code skipped the service
check. In that case the API also answers 403 and logs `four_eyes_db_guard`, but writes no audit event
(FE-N1). Every edit and decision on one claim takes the claim row lock, and every field edit and
decision on one document takes the document row lock. So the author or editor set read inside the
transaction cannot change before commit.

| Step | Where | Notes |
| --- | --- | --- |
| Precedence, approve/reject | `transition()` | 400 -> 401 -> 403 `forbidden` -> 404 -> 409 `stale_revision` -> 409 `invalid_state` -> **403 `four_eyes_required`** -> 422 |
| Precedence, accept | `acceptDocument()` | 400 -> 401 -> 403 `forbidden` -> 404 -> 409 `invalid_state` -> **403 `four_eyes_required`** -> 409 `unresolved_fields` |
| Error body | `sendError` | `{ code, message: "A different person must make this decision.", requestId }`, identical for UI and API callers; no `authz.denied` event |
| Audit | error handler, tenant chain | claim: `claimId`, `packetId`, `packetRevision`, `action`, `basis: revision_author`; document: `documentId`, `batchId`, `action: ACCEPT`, `basis` |
| UI | `selfAuthored` | hides the button and shows the fixed text; cosmetic only, the server decides |

## Policy defaults (four-eyes)

D1 a revision author may not reject either; D2 send-ready is unrestricted; D3 only the uploader and
CORRECT/ADD actors are document editors; D4 document reject is unrestricted. The flip points are
`FOUR_EYES_GUARDED_TRANSITIONS` (claims) and `EDITOR_DECISIONS` (documents), each plus a new migration
for the matching trigger. Details are in the threat model, section 8.4.

## Interfaces for step 5 (four-eyes)

- **Delivered (FE-N2 closed).** Step 5 creates packet revision 1 for imported claims and sets
  `evidence_packets.created_by_id` to the user who triggered the analysis (single and bulk). That user is
  then a revision author and cannot approve or reject the claim. The trigger
  `evidence_packets_analysis_guard` refuses a revision 1 without an author for an `AWAITING_ANALYSIS`
  claim. Decision (policy D2 of step 5): the uploaders and field editors of a claim's documents are
  **not** claim authors. Document four-eyes already forced a second person to accept those inputs
  (except auto-accepted documents, FE-S1).
- Any new code path that inserts an `approvals` row (`APPROVE`/`REJECT`) or an `ACCEPT` decision must run
  the service check under the same row lock. The triggers refuse the insert otherwise.

## Notes (four-eyes)

- Verified locally on Node 22.23.3 (the CI version), **not in GitHub CI**: unit shared 136, api 356, web
  67; integration 95 passed (2 pre-existing skips); acceptance shared 36, api 690 passed (9 skipped, 2
  todo), web 150 passed (1 skipped). The audit fail-closed path and the trigger-to-403 mapping are
  covered only by the builder's integration and unit tests (not reachable black-box).
- Accepted residuals FE-S1..S4, FE-N1 and FE-N2 are listed in the threat model, section 8.5.

---

# Web platform: claim analysis (step 5)

> Written by scriber for run `REQ-20261010-step5-analysis` on 2026-10-10 (branch `feat/analysis`, build
> commits `d27c4a2`..`5c047fb`). **Pre-product, synthetic data only, never deployed.** Threat rows T47-T52,
> the policy defaults and the accepted residuals are in
> [technical/web-platform-security.md, section 9](technical/web-platform-security.md#9-step-5-claim-analysis).
> User-facing description: [README, claim analysis](README.md#claim-analysis-step-5).

## Overview (step 5)

Before step 5, a claim created by import stayed `AWAITING_ANALYSIS` with no amounts and no packet, because
the rules engine existed only in the Python reference service. Step 5 closes the loop:
import -> review -> commit -> **analyze** -> packet revision 1 -> four-eyes review.

- **Engine (`@fr/shared/analysis`).** A TypeScript port of the Python `rules/` (`detention.py`,
  `invoice_checks.py`, `engine.py`) and `evidence/` (`letter.py`, the Markdown of `packet.py`). The module is
  pure: no Node built-ins and no floating point on money or hours. It uses a CPython-exact decimal
  (`py-decimal.ts`: precision 28, ROUND_HALF_EVEN, CPython `str` and `.2f` formatting), CPython `repr` for
  strings and lists, and naive `YYYY-MM-DDTHH:MM:SS` datetimes with integer day arithmetic. Rules version
  `rules-v1`, eight rule ids (`INV-DUPLICATE`, `INV-LINEHAUL-RATE`, `INV-FUEL-SURCHARGE`,
  `INV-ACCESSORIAL-UNAUTH`, `INV-TOTAL-MISMATCH`, `DET-UNBILLED`, `DET-UNDERBILLED`, `DET-OVERBILLED`).
  Settings are constants (`DEFAULT_ANALYSIS_SETTINGS`: 15-minute detention increments, tolerance 0.01,
  90-day dispute window).
- **What a finding is.** A finding is the output of a fixed, deterministic rule applied to the field values
  of the claim's accepted documents (extracted by the step 3 parser and, where flagged, reviewed by a
  person). It is a **draft for human review, not a verified result**. The confidence on a finding is a
  fixed constant per rule copied from the Python reference (0.6, 0.85, 0.9 or 0.95), not a measured
  probability, and the product makes no accuracy claim. The step 4 evaluation gate runs on synthetic
  fixtures and is not an accuracy measure.
- **Routes.** `POST /api/v1/claims/:id/analyze` (201) and `POST /api/v1/claims/analyze-awaiting` (200,
  bulk). Both need the new permission `claims:analyze` (OWNER, ADMIN, MANAGER, REVIEWER, ANALYST), have no
  API-key scope, and share the per-user rate group `analysis` (`RATE_LIMIT_ANALYSIS_MAX`, default 30 per 10
  minutes).
- **Lifecycle.** One analyze runs in one tenant transaction under the claim row lock. It creates packet
  revision 1 (`PENDING_REVIEW`, created by the requester) with sources, findings (with citations and a
  governing clause), a timeline and the content hash. It sets the claim to `PENDING_REVIEW` with
  `recoverableCents`, `pendingReviewCents` and `amountClaimedCents`, increments `version`, and appends
  `claim.analyzed`. No `approvals` row is written. After that, the existing review flow applies unchanged.
- **Database guards.** Migration `20261012000000_analysis` adds two triggers and no table, column, enum or
  grant change.
- **Web.** An **Analyze claim** section on the claim sheet (Summary and Evidence tabs) and an **Analyze
  awaiting claims** dialog on the claims page, both shown only with `claims:analyze`.

Deferred (not built): analyze-on-commit (no flag; the bulk action is the automation, with an explicit human
trigger), a `rules` stage in the evaluation tool, telemetry component `rules-v1`, a Markdown download
endpoint, stricter money parsing, per-carrier letter templates.

## Module Structure (step 5)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    subgraph Web["web/src/features/claims"]
        CSH["ClaimSheet.tsx"]
        ACS["AnalyzeClaimSection.tsx"]
        CPG["ClaimsPage.tsx"]
        BAD["BulkAnalyzeDialog.tsx"]
    end
    subgraph Shared["packages/shared"]
        ENG["analysis/ engine"]
        PDC["analysis/py-decimal.ts"]
        REN["analysis/ letter + markdown"]
        CPY["analysis/copy.ts"]
        ADT["analysis-dto.ts"]
        RBC["rbac.ts + audit-actions.ts"]
        TXS["text-sanitize.ts"]
    end
    subgraph API["api/src"]
        CR["claims/routes.ts"]
        CA["claims/analysis.ts"]
        BU["imports/bundle.ts"]
        SEC["http/security.ts + config"]
        DG["http/db-guard.ts"]
        CH["audit/chain.ts"]
    end
    subgraph DB["PostgreSQL 16"]
        MIG["20261012000000_analysis"]
        TG1["claims_status_guard"]
        TG2["packets_analysis_guard"]
    end
    subgraph Parity["parity (tests only)"]
        PT["rules.parity.test.ts"]
        PY["rules_dump.py (Python)"]
    end

    CSH --> ACS
    CPG --> BAD
    ACS --> CPY
    BAD --> CPY
    BAD --> ADT
    ACS -. "HTTP" .-> CR
    BAD -. "HTTP" .-> CR
    CR --> SEC
    SEC --> RBC
    CR --> CA
    CA --> BU
    CA --> ENG
    ENG --> PDC
    ENG --> REN
    REN --> TXS
    CA --> CH
    CA --> DG
    CA --> TG1
    CA --> TG2
    MIG --> TG1
    MIG --> TG2
    PT --> ENG
    PT --> PY

    style CSH fill:#1e90ff,stroke:#1565c0,color:#fff
    style ACS fill:#1e90ff,stroke:#1565c0,color:#fff
    style CPG fill:#1e90ff,stroke:#1565c0,color:#fff
    style BAD fill:#1e90ff,stroke:#1565c0,color:#fff
    style ENG fill:#1e90ff,stroke:#1565c0,color:#fff
    style PDC fill:#1e90ff,stroke:#1565c0,color:#fff
    style REN fill:#1e90ff,stroke:#1565c0,color:#fff
    style CPY fill:#1e90ff,stroke:#1565c0,color:#fff
    style ADT fill:#1e90ff,stroke:#1565c0,color:#fff
    style RBC fill:#1e90ff,stroke:#1565c0,color:#fff
    style CR fill:#1e90ff,stroke:#1565c0,color:#fff
    style CA fill:#1e90ff,stroke:#1565c0,color:#fff
    style BU fill:#1e90ff,stroke:#1565c0,color:#fff
    style SEC fill:#1e90ff,stroke:#1565c0,color:#fff
    style DG fill:#1e90ff,stroke:#1565c0,color:#fff
    style CH fill:#1e90ff,stroke:#1565c0,color:#fff
    style MIG fill:#1e90ff,stroke:#1565c0,color:#fff
    style TG1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style TG2 fill:#1e90ff,stroke:#1565c0,color:#fff
    style PT fill:#1e90ff,stroke:#1565c0,color:#fff
    style PY fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Module/Function | Purpose | Key Dependencies | Changed in This Run |
| --- | --- | --- | --- |
| `packages/shared/src/analysis/py-decimal.ts` | CPython `Decimal` semantics: parse, add, sub, mul, true and integer division, compare, quantize, `str`, `.2f`, Python `max`/`sum` | none (BigInt) | new |
| `packages/shared/src/analysis/py-text.ts`, `local-datetime.ts` | CPython `repr(str)` and list repr, `_norm_text`; naive datetimes, days-from-civil epoch seconds, `%Y-%m-%d %H:%M` | none | new |
| `packages/shared/src/analysis/invoice-checks.ts`, `detention.ts`, `engine.ts` | Port of `rules/*.py`: `classifyLine`, dedupe, invoice checks, `computeDetention`, `applyRules`; `applyRulesTraced` also returns per-finding traces for citations | `py-decimal`, `py-text`, `local-datetime` | new |
| `packages/shared/src/analysis/letter.ts`, `markdown.ts`, `evidence.ts` | Port of `evidence/letter.py` and the Markdown of `packet.py`: `buildDemandLetter`, `renderPacketMarkdown`, `buildEvidence` (`buildEvidenceTraced`), `packetLoadNumber` | `text-sanitize.ts` (`plain`, `md`) | new |
| `packages/shared/src/analysis/types.ts`, `copy.ts`, `index.ts` | `AnalysisInputError`, `DEFAULT_ANALYSIS_SETTINGS`, `RULES_VERSION`, `RULE_IDS`, `DRAFT_BANNER`, `PACKET_DISCLAIMER`; UI copy `ANALYSIS_NOTE`, `ANALYZE_AUTHOR_NOTE`, `ANALYSIS_TEXT`; subpath `@fr/shared/analysis` | none | new |
| `packages/shared/src/analysis-dto.ts` | `AnalyzeBody` (strict `{}`), `BulkAnalyzeBody` (`limit` 1..25), response schemas, `ANALYZE_BATCH_MAX = 25`, `ANALYZE_BATCH_DEFAULT = 10` | zod | new |
| `packages/shared/src/rbac.ts`, `audit-actions.ts` | `claims:analyze` appended (5 roles); `claim.analyzed`, `claim.bulk_analyzed` appended | none | changed |
| `api/src/imports/bundle.ts` | `assembleBundleWithProvenance` (records which document and field filled each bundle slot); `loadAnalysisInput` (sources with `sizeBytes`, fields with page, line, excerpt; fields ordered by `ordinal, id`); `loadBundleForClaim` delegates, signature unchanged | Prisma tenant tx | changed |
| `api/src/claims/analysis.ts` | `buildAnalysisPacket` (pure: rows, citations, clauses, timeline, hash, storability), `analyzeClaim` (single, one tx), `analyzeAwaiting` (bulk), `storableCents`, `INT4_MAX` | `@fr/shared/analysis`, `bundle.ts`, `lockClaimForUpdate`, `appendAudit`, `packetContentHash` | new |
| `api/src/claims/routes.ts` | `POST /claims/:id/analyze` (201), `POST /claims/analyze-awaiting` (200); permission `claims:analyze`, no `apiKeyScope`, `rateGroup: 'analysis'` | `analysis.ts` | changed |
| `api/src/http/security.ts`, `context.ts`, `config.ts`, `app.ts` | Rate group `analysis` (per user, 10-minute window); `RATE_LIMIT_ANALYSIS_MAX` (default 30, 1..100000); `app.analysisLimiter` (null when rate limiting is off) passed to bulk | limiter store (Redis) | changed |
| `api/src/http/db-guard.ts` | Exact trigger-raise matcher (SQLSTATE `P0001` + exact message, through `cause`/`meta`/`driverAdapterError`, depth 5) shared by four-eyes and analysis; `isAnalysisDbError` | none | new (moved from `app.ts`) |
| `api/src/http/errors.ts`, `audit/chain.ts` | 422 `analysis_input_invalid`; step 5 metadata keys allow-listed | none | changed |
| `api/prisma/migrations/20261012000000_analysis/` | `fr_claim_status_guard` + trigger `claims_status_guard`; `fr_analysis_packet_guard` + trigger `evidence_packets_analysis_guard` | `claims`, `evidence_packets` | new |
| `web/src/features/claims/AnalyzeClaimSection.tsx`, `ClaimSheet.tsx` | Analyze button with both notes in the Summary and Evidence tabs; fixed error texts per status code; on success reload claim, packet, claims, approvals and show the Evidence tab | `useCan('claims:analyze')`, shared copy | new / changed |
| `web/src/features/claims/BulkAnalyzeDialog.tsx`, `ClaimsPage.tsx` | Toolbar button and modal dialog; POST `{ limit: 10 }`; summary in a `role="status"` region; failed claim numbers via `SafeText` | `Dialog`, shared copy | new / changed |
| `tools/parity/rules_dump.py`, `api/test/parity/rules.parity.test.ts` | Python oracle dump (test only, never at runtime) and the TS-vs-Python comparison in `test:integration` | Python reference service | new |

## Function Call Graph (step 5)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    R1["POST claims/:id/analyze"] --> PIPE["security pipeline"]
    R2["POST analyze-awaiting"] --> PIPE
    PIPE --> AC["analyzeClaim (one tx)"]
    PIPE --> AW["analyzeAwaiting"]
    AW --> SCAN["candidate scan (own tx)"]
    AW --> CHG["chargeExtra (bucket)"]
    AW --> AC
    AW --> AUD2["audit bulk_analyzed"]
    AC --> LK["lockClaimForUpdate"]
    AC --> LI["loadAnalysisInput"]
    LI --> PROV["assembleBundleWithProvenance"]
    AC --> BP["buildAnalysisPacket"]
    BP --> BE["buildEvidenceTraced"]
    BE --> AR["applyRulesTraced"]
    BE --> DL["buildDemandLetter"]
    BP --> SC["storableCents"]
    BP --> HASH["packetContentHash"]
    AC --> INS["insert packet + children"]
    INS --> TG2["packets_analysis_guard"]
    AC --> CU["claim.update"]
    CU --> TG1["claims_status_guard"]
    AC --> AUD1["audit claim.analyzed"]

    style AC fill:#1e90ff,stroke:#1565c0,color:#fff
    style AW fill:#1e90ff,stroke:#1565c0,color:#fff
    style CHG fill:#1e90ff,stroke:#1565c0,color:#fff
    style LI fill:#1e90ff,stroke:#1565c0,color:#fff
    style PROV fill:#1e90ff,stroke:#1565c0,color:#fff
    style BP fill:#1e90ff,stroke:#1565c0,color:#fff
    style BE fill:#1e90ff,stroke:#1565c0,color:#fff
    style AR fill:#1e90ff,stroke:#1565c0,color:#fff
    style DL fill:#1e90ff,stroke:#1565c0,color:#fff
    style SC fill:#1e90ff,stroke:#1565c0,color:#fff
    style TG1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style TG2 fill:#1e90ff,stroke:#1565c0,color:#fff
    style AUD1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style AUD2 fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Function | Defined In | Called By | Purpose |
| --- | --- | --- | --- |
| `analyzeClaim(tx, claimId, actor, { bulk })` | `api/src/claims/analysis.ts` | single route (inside `db.tx`), `analyzeAwaiting` (one `db.tx` per candidate) | UUID check and row lock (404), re-check status and "no packet" under the lock (409), load input (409 if no accepted document), build (422), insert, update, audit |
| `analyzeAwaiting(db, actor, limit, chargeExtra)` | `api/src/claims/analysis.ts` | bulk route | candidates once, per-candidate tx, outcome lists, budget stop, summary audit |
| `loadAnalysisInput(tx, claimId)` | `api/src/imports/bundle.ts` | `analyzeClaim` | linked `ACCEPTED` documents (oldest link first, ties by link id) to `{ bundle, provenance, sources }` |
| `buildAnalysisPacket({ input, claim, now, actorId })` | `api/src/claims/analysis.ts` | `analyzeClaim` | pure: engine run, storability check, source, finding, citation, clause and timeline rows, `HashPacket` and content hash |
| `buildEvidenceTraced` / `buildEvidence` | `packages/shared/src/analysis/evidence.ts` | `buildAnalysisPacket`, parity test | result, letter (UTC date of `now`), Markdown (not persisted), load number |
| `applyRules` / `applyRulesTraced` | `packages/shared/src/analysis/engine.ts` | `buildEvidence*`, parity test | invoice findings, detention findings, perspective split, totals |
| `isAnalysisDbError` | `api/src/http/db-guard.ts` | `app.ts` `toHttpError`, `analyzeAwaiting` | maps `claim_transition_invalid` / `analysis_packet_invalid` to 409 `invalid_state` (single) or `skipped` (bulk) |
| `fr_claim_status_guard`, `fr_analysis_packet_guard` | migration `20261012000000_analysis` | `BEFORE UPDATE OF status ON claims`, `BEFORE INSERT ON evidence_packets` | database backstop for the lifecycle (below) |

## Data Flow (single analyze)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    A["POST claims/:id/analyze"] --> B["Pipeline: 403, 401, 429, 403, 400"]
    B --> C["Tenant tx: lock claim row"]
    C --> D{"Claim visible?"}
    D -- no --> E["404 not_found"]
    D -- yes --> F{"AWAITING, no packet, accepted doc?"}
    F -- no --> G["409 invalid_state"]
    F -- yes --> H["Load bundle + provenance"]
    H --> I["Rules, letter, rows, hash"]
    I --> J{"Input valid and storable?"}
    J -- no --> K["422 analysis_input_invalid"]
    J -- yes --> L["Insert rev 1 + children"]
    L --> M["Claim to PENDING_REVIEW"]
    M --> N{"Triggers agree?"}
    N -- no --> O["Rollback: 409 invalid_state"]
    N -- yes --> P["Append claim.analyzed: 201"]

    style F fill:#1e90ff,stroke:#1565c0,color:#fff
    style J fill:#1e90ff,stroke:#1565c0,color:#fff
    style N fill:#1e90ff,stroke:#1565c0,color:#fff
    style P fill:#1e90ff,stroke:#1565c0,color:#fff
```

Nothing is written before the 422 check, so a refused analyze (404, 409, 422) changes nothing and writes no
`claim.analyzed`. The "Triggers agree?" branch is a backstop that the service checks make unreachable
through the API; if it is ever reached the API answers 409 `invalid_state` (never 500, never the database
text) and logs `analysis_db_guard` at error level.

| Step | Where | Notes |
| --- | --- | --- |
| Precedence, single | security pipeline, `analyzeClaim` | origin/CSRF 403 -> 401 -> 429 (`analysis` bucket) -> 403 `forbidden` -> 400 -> 404 -> 409 `invalid_state` -> 422 `analysis_input_invalid` |
| Precedence, bulk | security pipeline | origin/CSRF 403 -> 401 -> 429 -> 403 -> 400 -> 200 (per-claim outcomes in the body) |
| 422 | `buildAnalysisPacket` | the engine refuses an input (malformed decimal or datetime, increment 0), or a result is not storable: any persisted finding amount or total negative, or above 2,147,483,647 cents, or the two totals together above it (RD3) |
| Concurrency | `lockClaimForUpdate` + re-check | N parallel analyzes of one claim: exactly one 201, the rest 409; one packet, one event, `version` +1 once. Unique `(claim_id, revision)` and the one-live-revision index are a further backstop |
| Response | `AnalyzeResponse` | `claim` (id, status, three cent amounts), `packet` (id, revision 1, status, `contentHash`), `analysis` (`rulesVersion`, `findingsCount`, `pendingFindingsCount`, `ignoredFindingsCount`) |

## Claim lifecycle and database guards (step 5)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    CM["import commit"] --> AW["AWAITING_ANALYSIS"]
    AW -- "analyze: rev 1 with author" --> PR["PENDING_REVIEW"]
    PR --> FL["existing review flow"]
    FL -. "back to AWAITING: refused" .-> AW

    style AW fill:#1e90ff,stroke:#1565c0,color:#fff
    style PR fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Trigger (function) | Fires on | Refuses | Error |
| --- | --- | --- | --- |
| `claims_status_guard` (`fr_claim_status_guard`) | `BEFORE UPDATE OF status ON claims` | a status change **to** `AWAITING_ANALYSIS`; a change **from** `AWAITING_ANALYSIS` to anything other than `PENDING_REVIEW`, or to `PENDING_REVIEW` when no `evidence_packets` row of the same claim and tenant with `revision = 1` and a non-null `created_by_id` exists | `P0001` `claim_transition_invalid` |
| `evidence_packets_analysis_guard` (`fr_analysis_packet_guard`) | `BEFORE INSERT ON evidence_packets` | a packet for an `AWAITING_ANALYSIS` claim unless `revision = 1`, `created_by_id` is not null and `status = 'PENDING_REVIEW'` | `P0001` `analysis_packet_invalid` |

Both functions are `SECURITY DEFINER` (owner = the migration role), `search_path = public, pg_temp`, match
`tenant_id` explicitly (so a missing `app.tenant_id` cannot hide rows), and have `EXECUTE` revoked from
`PUBLIC`. Existing rows are not re-validated. Updates that do not change `status`, other status changes,
claim inserts and packet inserts for other claims are unaffected; in particular the amount and `version`
columns of an `AWAITING_ANALYSIS` claim are **not** guarded by the database (residual SA-6 in the threat
model). The four earlier migrations are byte-for-byte unchanged.

## Bulk analyze and the `analysis` rate budget

`POST /api/v1/claims/analyze-awaiting` with `{ "limit": n }` (1..25, default 10; the web dialog always sends
10):

1. **Candidates**, fetched once in a short tenant transaction: the tenant's claims in `AWAITING_ANALYSIS`
   with at least one linked `ACCEPTED` document, oldest `createdAt` first (ties by id), at most
   `min(4 x limit, 100)`.
2. **Each candidate in its own transaction**, exactly like the single route. A candidate that is no longer
   analyzable (404/409, or a database guard refusal) goes to `skipped` (`invalid_state`); one that gets 422
   goes to `failed` (`analysis_input_invalid`). Any other error ends the request with 500; analyses already
   committed stay committed.
3. **Budget (fix round 1, S5-1).** The request's own `analysis` token covers the first candidate. Before
   each further candidate, one more token is taken from the requester's per-user `analysis` bucket
   (`app.analysisLimiter`). Tokens are charged per candidate **attempted**, so skipped and failed
   candidates also cost one. With `RATE_LIMIT_ENABLED=false` (dev/test only; production refuses it) nothing
   extra is charged.
4. **Stop conditions:** `analyzed` reaches `limit`, the candidates are exhausted, or the bucket is empty.
   A budget stop still returns 200 with the same shape; unattempted claims stay `AWAITING_ANALYSIS` and
   count in `remaining`. `examined` = candidates attempted = analyzed + skipped + failed.
5. **Summary.** One `claim.bulk_analyzed` event (target `tenant`) in its own transaction, with `limit`,
   `examined`, `analyzed`, `skipped`, `failed` and `remaining` (the tenant's claims still awaiting analysis
   after the run).

Effect: a user can perform at most `RATE_LIMIT_ANALYSIS_MAX` analyses per 10-minute window whether they use
the single or the bulk route. Before fix round 1, one bulk request cost one token for up to 25 analyses (a
25x amplification, security finding S5-1, Low). Concurrent bulk requests never analyze a claim twice; the
loser of a race reports it as `skipped`.

Known limits (threat model section 9.5): skipped and failed candidates consume budget (SA-1); a limiter
failure mid-run (for example the Redis store unreachable) ends the request with 500 and no
`claim.bulk_analyzed` event (SA-2); the dialog does not say that the budget stopped the run, although its
summary ("n still awaiting analysis") stays true (SA-3); a claim that fails with 422 stays a candidate and,
being old, is attempted first on every run (SA-8).

## Packet content (revision 1)

| Part | Content |
| --- | --- |
| Packet | `revision 1`, `PENDING_REVIEW`, claim perspective, `loadNumber` (first non-empty of invoice, rate confirmation, bill of lading), `generatedAt` = analysis time, `PACKET_DISCLAIMER`, the draft demand letter (dated with the UTC date of `generatedAt`), USD, `verifier NOT_RUN`, `createdBy` = requester, content hash |
| Sources | one per linked `ACCEPTED` document in link order: display name, type, SHA-256, size of the stored original |
| Findings | own-perspective findings in engine order (rule id, title, direction, amount in cents, explanation, calculation steps, confidence, `needsHumanReview`); other-direction findings are counted (`ignoredFindingsCount`) but not stored |
| Citations | per rule, the fields that fed it, as `{sourceId, locator, excerpt}` with locator `<name>:L<line>`, `<name>:p<page>:L<line>` or `<name>:manual`; excerpt through `plain(..., 200)`; duplicates removed |
| Governing clause | the rate-confirmation field the rule compares against (linehaul rate, fuel surcharge, authorized accessorials, detention free time), or null |
| Timeline | appointment, arrival, departure (bill of lading) and invoice date, stored with naive local times read as UTC; facility and invoice number through `plain(..., 100)` |

Citations, governing clauses and the timeline are TS-only additions with no Python counterpart. They are
part of the content hash, so the approve/send hash binding covers them.

## Audit (step 5)

| Action | When | Target | Metadata (exact key set) |
| --- | --- | --- | --- |
| `claim.analyzed` | each successful analyze, same transaction as the writes | `claim` | `claimId`, `claimNumber`, `packetId`, `revision`, `contentHash`, `perspective`, `fromStatus`, `toStatus`, `documentIds`, `findingsCount`, `pendingFindingsCount`, `ignoredFindingsCount`, `recoverableCents`, `pendingReviewCents`, `rulesVersion`, `bulk` |
| `claim.bulk_analyzed` | once per bulk request that reaches the handler and finishes, after the per-claim transactions | `tenant` | `limit`, `examined`, `analyzed`, `skipped`, `failed`, `remaining` (all integers) |

No names, file names, extracted values, letter text or reasons go into metadata. Refused analyzes (409, 422)
write no event; permission refusals keep the existing `authz.denied` behaviour. The audit metadata
sanitizer caps arrays at 50 entries, so `documentIds` would be incomplete for a claim with more than 50
linked accepted documents; the `packet_sources` rows stay complete (SA-4).

## Python parity: registered divergences (RD1-RD6)

`api/test/parity/rules.parity.test.ts` (part of `npm run test:integration`; same Python discovery rule as
the step 3 parity suite: CI without Python fails, a local run without Python skips with a message) feeds
the same cases to the TS engine and to `tools/parity/rules_dump.py`, which calls the Python reference with
explicit `Settings`. It compares with exact string equality: `classifyLine`, `computeDetention` JSON,
`applyRules` JSON, the letter, the Markdown and the load number, and checks that both sides refuse the same
inputs. Parity domain: decimals `-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?`; datetimes
`YYYY-MM-DDTHH:MM:SS`, years 1000-9999; strings of assigned code points without controls, bidi controls or
U+2028/U+2029, at most 200 code points; increments 1..240; window 1..3650 days.

| ID | Divergence (TS vs Python) | Rationale |
| --- | --- | --- |
| RD1 | Timestamps are naive `YYYY-MM-DDTHH:MM:SS` only; offsets are refused (`AnalysisInputError`). Python's timezone-aware paths have no TS input. | The step 3 extraction stores naive local times; there is no time zone to apply. |
| RD2 | `%Y` pads years below 1000 to 4 digits (CPython on Linux does not). | The corpus uses years 1000 and later. |
| RD3 | The API refuses negative or over-INT4 results (422) where Python would emit them. The pure engine still matches Python. | Amounts are stored as int4 cents; a negative claim amount has no meaning. |
| RD4 | Case mapping and printability follow Node 22's ICU tables, not Python's Unicode database. | The corpus excludes unassigned code points. |
| RD5 | End to end, the TS packet lists the claim's accepted linked documents; Python lists every ingested file. | Only accepted documents feed a claim. |
| RD6 | The letter date is the UTC date of `generatedAt`; Python uses the local date of `datetime.now()`. | Independent of the server time zone; parity runs pass the same `now`. |

Builder corpus (seed `20261010`): 2,132 cases (4 fixture end-to-end, 623 inputs from the Python test
files, 1,200 generated bundles, 300 generated detention cases, 5 classification batches of 200
descriptions). Result in the builder's run: zero differences on Node 22 and Node 24, every rule id
exercised, no registered divergence needed inside the corpus. The tester's independent oracle
(`api/test-acceptance/helpers/rules_oracle.py`) passed P01-P05 in acceptance run 1; its per-corpus counts
were not yet recorded.

## Policy defaults (step 5)

| ID | Default | Flip point |
| --- | --- | --- |
| D1 | `claims:analyze` = OWNER, ADMIN, MANAGER, REVIEWER, ANALYST; no API-key scope | `rbac.ts` matrix row |
| D2 | Revision-1 author = the requester (single and bulk); document uploaders and field editors are not claim authors | `analysis.ts` + four-eyes predicate |
| D3 | Analyze-on-commit not built; bulk is the automation | future flag + migration row |
| D4 | Only own-perspective findings are persisted | `buildAnalysisPacket` |
| D5 | Zero findings still create revision 1 with zero amounts and the "No amount is requested" letter | `analyzeClaim` |
| D6 | Negative or over-INT4 results -> 422, claim unchanged | `buildAnalysisPacket` |
| D7 | Settings are constants (15 min, 0.01, 90 days) | `DEFAULT_ANALYSIS_SETTINGS` |
| D8 | Letter date = UTC date of `generatedAt`; naive timeline times stored as UTC | `buildEvidence`, timeline |
| D9 | Bulk `limit` 1..25 (default 10), scan cap `min(4 x limit, 100)`, oldest first | `analyzeAwaiting` |
| D10 | Rate group `analysis`, `RATE_LIMIT_ANALYSIS_MAX` 30 per 10 minutes, charged per bulk candidate | config, `analyzeAwaiting` |

## Interfaces for later steps (after step 5)

- Keep `rule_id` within `RULE_IDS` and bump `RULES_VERSION` when a rule changes; step 4 intelligence and
  the parity suite depend on both.
- Open: the `rules` evaluation stage, telemetry `rules-v1`, analyze-on-commit, a Markdown download
  endpoint, stricter money parsing.
- Any future HTML, Markdown or PDF renderer of stored findings must sanitize `explanation` and
  `calculation`: they contain the raw invoice line description (SA-5). Only the letter applies `plain()`.
- A new code path that writes claim amounts must keep to the analyze transaction or extend the status guard
  (SA-6).

## Notes (step 5)

- What ran (local, Windows, **not GitHub CI**): the builder ran lint, typecheck and unit tests (shared 165,
  api 370, web 78), the rules parity suite (2,132 cases, zero differences on Node 22 and 24) and the
  integration suite on Node 22.23.3 (16 files, 107 passed, 3 local-skip placeholders), all at `b12ce2a`.
  The independent acceptance run 1 (Node 22.23.3, `CI=true`, at `b12ce2a`) gave shared 81/81 and api 754
  passed, 4 failed, 10 skipped; all 4 failures were classified as test design and fixed in the test files,
  but the verification rerun was stopped by low system memory. The web acceptance suite (AN-W01..W11) has
  not run yet. Fix round 1 (`5c047fb`) was checked only with lint, typecheck and targeted unit tests; no
  integration or acceptance run exists at `5c047fb`.
- Review verdict at the time of writing: FAIL (validation incomplete), no code defect found. The deviations
  1-8 in the run's `implementation.md` were accepted.
- `.env.example` lists `RATE_LIMIT_ANALYSIS_MAX=30` uncommented, unlike the commented step 4 knobs; the
  value equals the default.
- Not verified: GitHub CI, container images, the compose stack, Playwright, any AWS deployment.
