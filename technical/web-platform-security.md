# Web platform: security threat model

> **Status: pre-product, synthetic data only.** The TypeScript web platform (`web/`, `api/`,
> `packages/shared/`, `infra/`) has never been deployed. No independent penetration test has been
> carried out. A production start is refused by the config validator until a real mail transport exists
> (every `MAIL_TRANSPORT` value is rejected in production). Do not put
> real customer data into it. The Python service has its own notes in [deploy/aws.md](../deploy/aws.md).

This document covers build-order steps 1 and 2 of the web platform: authentication, RBAC, tenant
isolation, app hardening, the audit trail, the claims list, the evidence-packet viewer and the approvals
gate. Step 3 (import and export: hostile uploads, the parse sandbox, review, commit and CSV/XLSX export)
is covered in [section 6](#6-step-3-import-and-export). Step 4 (the Dev dashboard, Recovery
intelligence, tenant API keys and the evaluation tool) is covered in
[section 7](#7-step-4-dev-dashboard-recovery-intelligence-and-api-keys). The four-eyes rule (separation
of duties for claim approvals and document acceptance) is covered in
[section 8](#8-four-eyes-separation-of-duties). Step 5 (claim analysis: the TS rules engine, the analyze
and bulk-analyze routes, the lifecycle triggers and the `analysis` rate budget) is covered in
[section 9](#9-step-5-claim-analysis). Every secret, its rotation and
the buyer handover checklist are in [docs/secrets.md](../docs/secrets.md). The structure is in [ARCHITECTURE.md](../ARCHITECTURE.md#web-platform-typescript-steps-1-2). The
infrastructure is in [infra/README.md](../infra/README.md).

## 1. Scope, assets and trust boundaries

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Credentials | `users.password_hash` (argon2id), `mfa_secrets` (AES-256-GCM), `mfa_recovery_codes` (hashed) | account takeover |
| Sessions | access JWT (browser memory only), refresh token (`fr_rt` HttpOnly cookie; DB stores only an HMAC of it) | impersonation |
| Tenant data | `claims`, `evidence_packets` and child rows, `approvals`, `memberships`, `invites` | cross-customer disclosure |
| Audit trail | `audit_events`: one hash chain per tenant plus a `platform` chain | evidentiary chain; the product depends on it |
| Approval decisions | `approvals` (append-only), bound to a packet content hash | prevents "approve X, send Y" |
| Server secrets | `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER`, `MFA_ENC_KEY`, `API_KEY_PEPPER` (step 4), DB/Redis URLs (Secrets Manager in AWS; full inventory in [docs/secrets.md](../docs/secrets.md)) | forging any of the above |

Trust boundaries: browser → CloudFront (nginx locally) → API → PostgreSQL / Redis / S3. Inside the API
the boundary is between the **tenant context**, where all business data is read, and **system mode**.
System mode is used only for auth bootstrap, the platform chain and operator scripts. It is restricted by
lint rules and an architecture test. Two internal roles sit outside every tenant: `PLATFORM_DEV` and
`SUPER_ADMIN`. The browser is untrusted. The web app reads the permission matrix only to hide controls;
the API enforces the matrix on every request.

## 2. Threats and mitigations

"Verified by" names the acceptance-test IDs (`T-*`, in `*/test-acceptance/`), the builder's unit tests
(`api/test/`) and the integration tests (`api/test/integration/`). All of them passed in test round 2.
The exceptions are noted in section 3.

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T1 | Password guessing, credential stuffing | argon2id (19 MiB, t=2) with a constant-work dummy verify for unknown or disabled accounts (`security/password.ts`). Lockout is keyed by the normalized-email hash, so unknown emails behave the same way. The lock lasts `min(30 s * 2^(f-5), 900 s)` once there are 5 failures, and locked attempts do not extend it (`auth/lockout-store.ts`). Rate limits: auth 20 per 60 s per IP, forgot-password 5 per 15 min, global 600 per minute (`app.ts`). | T-AUTH, T-LOCK-01..05, T-RATE-01/02 | Distributed low-and-slow attacks across many IPs are only slowed down. The WAF IP rate rule helps in AWS. |
| T2 | Session theft through XSS | The access token lives only in JS memory (default 10 min). The refresh token is in an `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie, and nothing is ever stored in localStorage. The CSP is strict (`default-src 'none'`, scripts and styles from `'self'` only, `frame-ancestors 'none'`). React renders text nodes only, and `displayText()` strips bidi controls. The build checker rejects inline script and style. | T-COOKIE-01/02, T-HDR-02/03, T-UI-09/14/15 (hostile strings) | A same-origin script compromise could still call the API while the tab is open. |
| T3 | Refresh-token replay | Every use rotates the token within its family. Presenting a used or revoked token revokes the whole family. The DB stores `HMAC-SHA256(token, REFRESH_PEPPER)` only. A family lives at most 30 days (`auth/session.ts`). | T-REF-01..07 | Two tabs racing a refresh can sign the user out. This is accepted, and the client single-flights refreshes. |
| T4 | CSRF | `SameSite=Strict` cookies. A double-submit `fr_csrf` cookie must equal the `X-CSRF-Token` header, which must be `nonce.HMAC(CSRF_SECRET, nonce)`. On unsafe methods, an `Origin` header must equal `APP_ORIGIN`, or `Sec-Fetch-Site` must not be `cross-site` (`http/security.ts`, `security/csrf.ts`). | T-CSRF-01..03 (21 unsafe routes x 4 bad-token modes) | None known. |
| T5 | MFA bypass or replay | TOTP (RFC 6238, ±1 step) is mandatory before a session is issued for OWNER, ADMIN, PLATFORM_DEV and SUPER_ADMIN. The accepted step must strictly increase, which blocks replay. Secrets are encrypted with AES-256-GCM, with the AAD bound to the user id. Recovery codes are single-use. | T-MFA-01..09 | MFA is optional for the other roles, and there is no voluntary-enrollment UI yet. |
| T6 | Vertical privilege escalation | Each route declares its access. A route without a declaration stops the app from booting (`http/route.ts`). Permissions come from `PERMISSION_MATRIX` (`packages/shared/src/rbac.ts`). User, role, tenant status and session liveness are **reloaded from the DB on every request**, never taken from token claims. Role assignment is rank-based: OWNER can never be assigned, and ADMIN needs `admins:manage`. | T-RBAC-01..08 (21 routes x 8 roles), T-AUTH-05 | None known. |
| T7 | Cross-tenant access | Three layers (section 4): Postgres RLS with FORCE under a non-owner, NOBYPASSRLS role; a fail-closed Prisma extension; per-request context. Another tenant's id returns 404. | T-TEN-01..05, T-DB-01..04, P-invariants | A bug in system-mode code (auth bootstrap) could reach memberships or invites across tenants. Claims are never visible in system mode. |
| T8 | Super-admin abuse | Cross-tenant access is read-only and needs a reason of at least 10 characters. A `platform.cross_tenant_read` event is appended to the **target tenant's** chain in the same transaction before the read. If that append fails, the request fails with nothing returned (`platform/cross-tenant.ts`). | T-SA-01/02; fail-closed by `api/test/integration/audit-failclosed.int.test.ts` and `api/test/cross-tenant-failclosed.test.ts` | T-SA-03 is not proven black-box (section 3). |
| T9 | Platform/Dev access to customer data | `PLATFORM_DEV` holds only `platform:health`, `platform:flags`, `platform:logs` and (step 4) `platform:eval`; `SUPER_ADMIN` adds (step 4) `platform:audit`. Neither has a tenant permission or a tenant DB handle. The step 4 dashboard returns aggregates and filtered telemetry only (section 7, T38-T39, T45). | T-RBAC matrix, T3, T4, T6 | None known. |
| T10 | Audit tampering | Each chain computes `hash_n = SHA-256(hash_{n-1} + "\n" + canonicalJson(event_n))`, under a per-chain advisory lock. DB triggers block UPDATE, DELETE and TRUNCATE on `audit_events`, `approvals`, `login_attempts` and the packet child tables, even for the owner. `freight_app` has only SELECT and INSERT on them. `GET /api/v1/audit/verify` recomputes the chain. | T-AUD-01..08, `api/test/audit-chain.test.ts` | Someone with a DB superuser account, or `freight_owner` with `session_replication_role` (a dev/test-only grant), could rewrite the whole chain from genesis. Nothing anchors chain heads externally yet (for example a WORM export). |
| T11 | "Approve X, send Y", races | Approval stores the packet content hash. Send re-hashes the latest revision and requires it to equal both the approval's hash and the stored hash. A DB trigger makes packets immutable except for `status`, and only along the state machine. The claim row is locked (`SELECT ... FOR UPDATE`) for the whole transition. | T-APR-01..11 (incl. concurrency), T-PKT tamper tests | None known for "approve X, send Y". Four-eyes (author ≠ approver) used to be a residual here (assumption A9); it is enforced since run `REQ-20261009-four-eyes` (T46, [section 8](#8-four-eyes-separation-of-duties)). |
| T12 | Injection, malformed input | Prisma uses parameterized queries. Claim search escapes `\ % _` itself, because Prisma 7 `contains` does not. Strict Zod schemas reject unknown keys. Bodies are capped at 64 KiB, with a matching WAF Content-Length rule. | T-VAL-01..06, T-CLM | Step 3 added uploads (raw bytes, size-capped while streaming; see T18-T21 in section 6). There is still no URL fetching of any kind. |
| T13 | Leakage through errors and logs | Error messages are fixed and never echo input. The UI shows fixed texts for 422 and 500. Pino redacts known paths, and a recursive scrubber covers the rest. Request logs carry method, path (no query string), status, duration and requestId. Config errors name the key, never the value. | T-LOG-01/02, T-UI-10, T-CFG | Forced-500 header and log checks are not automatable (section 3). |
| T14 | Unsafe production configuration | `NODE_ENV` defaults to `production`. Production refuses to start with `COOKIE_SECURE=false`, `ENABLE_DEV_OUTBOX`, any `MAIL_TRANSPORT` that is not implemented (currently all of them: `outbox` is a dev sink and `ses` is a stub, fix round 3), `RATE_LIMIT_ENABLED=false` or a missing `REDIS_URL`. Secrets must be at least 43 characters, must differ from each other and must not look like placeholders, in every environment. In production they also must not be a documented dev or CI value, and must pass an alphabet-aware entropy check (≥160 bits, no repetition, at least 8 distinct characters, and no single character more frequent than chance allows). Since step 4 fix round 2 the last rule is an **exact binomial bound**: with n symbols over an alphabet of size A the value is refused when `A * P(Binomial(n, 1/A) >= maxCount) < 1e-12`, so a truly random secret is falsely refused with probability below 10^-12 (thresholds: hex-64 25, base64-48 16, base64-32 14 copies of one character). Random hex and base64 both pass. Step 4 adds `API_KEY_PEPPER` (production: required, ≥256 estimated bits, distinct from every other secret; set but empty refused everywhere). | T-CFG-01..04, T-KEY-19, `api/test/config.test.ts` (1000 random hex and base64 draws, a seeded deterministic set of 4000 secrets, and an independent check of the exact thresholds) | None known. This includes the G-B hole, fixed in fix round 1. The old 25% cap occasionally refused a genuine random secret (a flaky test); fixed in step 4 fix round 2. |
| T15 | Supply chain | Exact pins and a lockfile. `.npmrc` sets `ignore-scripts=true`, and an install-script allow-list is checked in CI. CI runs `npm audit` and `npm audit signatures`. GitHub Actions are pinned by SHA and images by digest. | T-REPO, T-CI-01 | Five allow-listed packages ship install scripts that are never run. Each has a documented reason in `tools/allowed-install-scripts.json`. |
| T16 | Clickjacking, downgrade, MIME sniffing | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, COOP and CORP on the API and the static site (`web/security-headers.json`, CloudFront response-headers policy). | T-HDR-01..03 | None known. |
| T17 | Money movement or outbound demand | There is no payment code. "Send" only marks a demand `SEND_READY` and audits it. No email or network call is made. | T-APR (no-egress) | None. |

## 3. Known gaps (explicit)

These are open. Do not read any of them as done.

1. **Docker images and the compose stack were never built or started.** The Docker Desktop engine
   returned HTTP 500 for the whole run. Only `docker compose -f compose.web.yml config -q` (an offline
   parse) was run. The API and web Dockerfiles, nginx in a container, MinIO and the `migrate` target are
   unverified. DB paths were verified against a portable PostgreSQL 16.15 instead.
2. **No real mail transport.** `SesMailer` throws `NotConfigured`. Until fix round 3, `MAIL_TRANSPORT=ses`
   passed production validation, which made forgot-password answer 500 for existing accounts and 202 for
   unknown ones (an enumeration oracle). Now production refuses every unimplemented transport, so a
   **production start is refused by the config validator**. In addition, forgot-password always answers
   the identical 202 when delivery fails (logged and audited as `delivery_failed`, never surfaced), and
   invite creation fails with a fixed 503 and rolls back. Password-reset and invite
   emails cannot be delivered anywhere yet.
3. **The dev `mail_outbox` stores raw reset and invite tokens** so that `GET /api/v1/dev/outbox` can show
   them. This is dev/test only: the route is registered only when `ENABLE_DEV_OUTBOX=true` and
   `NODE_ENV` is not production, and production refuses the flag. The table still exists in every schema.
   It must stay unused (or be dropped) once a real transport lands.
4. **The Redis AUTH token is set out of band**
   (`aws elasticache modify-replication-group --auth-token ...`, see `infra/README.md` step 3a). Terraform
   ignores it so that it never enters state. Rotating it is a manual, documented step.
5. **No third-party penetration test.** All evidence here comes from this repo's own tests.
6. **T-AUD-07 and T-SA-03 (audit-append failure must fail closed) are proven only by integration
   tests.** Black-box fault injection (inserting a duplicate `(chain_key, seq)` row) did not break the
   next append. The guarantee rests on `api/test/integration/audit-failclosed.int.test.ts` and
   `api/test/cross-tenant-failclosed.test.ts`. They cover approve, invite and cross-tenant read: 500, no
   data, no business change.
7. **Forced-500 checks cannot be automated.** The contract has no trigger for an internal error, so the
   "security headers on 500" and "no stack trace in 500 logs" checks are `it.todo`.
8. **Playwright end-to-end tests were not run** (T-UI-16 skips unless Playwright and `ACC_E2E=1` are
   present). UI behaviour is covered by jsdom component tests only.

Other residual risks and limits:

- Four-eyes is enforced for claim approve/reject and document accept since run `REQ-20261009-four-eyes`
  (section 8). Its accepted residuals (FE-S1..S4, FE-N1) are listed in section 8.5; FE-N2 was closed by
  step 5 (section 9). An approver may still mark the revision they approved send-ready (policy D2).
- Step 5 claim analysis has its own accepted residuals SA-1..SA-11 (section 9.5).
- Chain heads are not anchored externally (T10).
- `infra/` has passed `terraform fmt` and `validate` only. It has never been planned or applied, and it
  has no ECR repository or CI deploy path yet.
- Seeded MFA accounts share one public TOTP secret (`api/scripts/seed.ts`). The seed runs only with
  `NODE_ENV=development|test` AND a loopback/compose database host (or an explicit `ALLOW_SEED=1`), and
  never against an `amazonaws.com` host.
- Prisma 7.10 issues concurrent relation loads on one transaction connection, which triggers a `pg`
  DeprecationWarning. Results are correct (pg queues them). This is an upstream issue.
- The acceptance suites (`*/test-acceptance/`) were run by the test pipeline but are not committed on
  this branch. CI's `npm run test:acceptance` uses `--passWithNoTests`.

## 4. Tenant isolation in depth

1. **Layer 1, PostgreSQL RLS (authoritative).** Every tenant-scoped table has `ENABLE` and
   `FORCE ROW LEVEL SECURITY` and a policy keyed on `fr_current_tenant()`, which reads the
   transaction-local `app.tenant_id`. With no setting, the function returns NULL, so reads return zero
   rows and inserts are rejected. The API connects as `freight_app`: not the owner, not a superuser,
   `NOBYPASSRLS`, `NOINHERIT`, and with column-level grants (for example only `UPDATE (status)` on
   `evidence_packets`). Only `freight_owner` (migrations, seed, test fixtures) bypasses RLS.
2. **Layer 2, fail-closed Prisma extension** (`api/src/db/tenant.ts`). Only allow-listed models can be
   reached. `tenantId` is forced into every where clause and every create; a different caller-supplied
   tenant throws. Raw SQL is blocked on the tenant client. A model added later throws until it is
   classified.
3. **Layer 3, per-request context** (`api/src/auth/session.ts`, `api/src/http/context.ts`). The tenant
   comes only from the DB membership of the authenticated user. Platform users get no tenant DB handle,
   so tenant routes answer 403 before any handler runs.

## 5. How to re-verify

```bash
npm run typecheck && npm run lint && npm test          # unit tests, no DB
npm run ensure-bucket && npm run build                 # step 3: S3/MinIO bucket, then the parser worker build
npm run test:integration                               # needs a migrated + seeded test DB, S3 (MinIO) and Python (see web-ci.yml)
npm run audit && npm audit signatures
terraform -chdir=infra fmt -check -recursive && terraform -chdir=infra init -backend=false && terraform -chdir=infra validate
```

Last recorded results (run `REQ-20261008-webapp-foundation`, 2026-10-08). Acceptance tests: 334 passed,
0 failed, 5 skipped, 2 todo. Integration: 3/3. Unit after the final fix round: shared 30, api 83, web 29.
`npm audit`: 0 vulnerabilities.

Step 3 (run `REQ-20261008-step3-import-export`, 2026-10-09, portable PostgreSQL 16.15, MinIO with
SSE-KMS, Python 3.14 and 3.12 for parity): unit shared 113, api 279, web 46; integration 55 passed (2
placeholder skips); acceptance (test round 2) shared 22/22, web 87 passed (1 Playwright skip), api 500
passed with 3 failures (this documentation gap, now closed, and two test bugs fixed and re-verified).
Parity: zero unregistered differences. `npm audit`: 0 vulnerabilities.

Step 4 (run `REQ-20261009-step4-intelligence`, 2026-10-09, Node 22.23.3 and 24.21.0, `web-ci.yml` order
and environment): unit shared 134, api 346, web 62; evaluation gate
`npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1` (30/30, run after
`npm run build`); integration 85 passed (2 placeholder skips); acceptance (test round 2) shared 33/33,
web 138 passed (1 skip), api 651 passed (9 skipped, 2 todo).

Four-eyes (run `REQ-20261009-four-eyes`, 2026-10-10, build commit `8eb7062` plus the acceptance tests,
**local run on Node 22.23.3, not CI**, `web-ci.yml` order and environment, portable PostgreSQL 16, MinIO
with SSE-KMS): lint, typecheck, unit shared 136, api 356, web 67; migrate, seed, `ensure-bucket`, build;
integration 95 passed (2 pre-existing skips); acceptance shared 36, api 690 passed (9 skipped, 2 todo),
web 150 passed (1 skip). Details and gaps in section 8.6.

Step 5 (run `REQ-20261010-step5-analysis`, 2026-10-10, **local runs, not CI; validation not complete**):
builder unit shared 165, api 370, web 78; rules parity 2,132 cases with zero differences (Node 22.23.3 and
24); integration on Node 22.23.3 16 files, 107 passed (3 local-skip placeholders), at `b12ce2a`.
Acceptance run 1 at `b12ce2a`: shared 81/81, api 754 passed, 4 failed (test design, fixed, not yet
re-verified), 10 skipped; web acceptance not run. Fix round 1 (`5c047fb`) has no integration or acceptance
run yet. Details in section 9.6.

## 6. Step 3: import and export

Build-order step 3 (run `REQ-20261008-step3-import-export`, branch `feat/import-export`) adds document
upload, sandboxed parsing, review, commit to claims and CSV/XLSX export. Every uploaded file is treated
as hostile. Every exported cell is treated as a possible spreadsheet formula. The structure is in
[ARCHITECTURE.md, step 3](../ARCHITECTURE.md#web-platform-import-and-export-step-3). The email-forward
path is **design only** ([docs/design/email-ingest.md](../docs/design/email-ingest.md)): nothing of it
is built.

### 6.1 New assets and trust boundaries

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Uploaded originals and derived text | S3 `t/<tenantId>/imports/<batchId>/<docId>/{original,text}`, SSE-KMS, versioned | customer contracts and invoices; cross-tenant disclosure |
| Extracted fields and review decisions | `extracted_fields`, `import_review_decisions` (append-only) | they decide which claims exist and with which values |
| Claim links | `claim_documents` (insert-only) | the evidence base of a claim |
| Export files | streamed to the browser, never stored | bulk exfiltration and formula injection |

New trust boundary: the **parse worker**. A child Node process parses each document. The API treats the
worker as untrusted code. It gets no environment, no secrets, no database or storage access, and its
output is validated again by the parent.

### 6.2 Threats and mitigations (step 3)

"Verified by" names the step 3 acceptance groups (`T-IMP-*`, `T-STORE`, `T-EXP`, `EXP-*`, `REV-*`,
`COM-*`, `P1-P5`, `UI-*` in `*/test-acceptance/`), the builder's unit tests (`api/test/imports/`,
`api/test/exports/`), the integration tests (`api/test/integration/`) and the parity suite
(`api/test/parity/`). Test round 2 passed: api acceptance 500 passed, the 3 failures were this
documentation gap (D10) and two test bugs that were fixed. Web acceptance passed 87 of 87, and shared
22 of 22. The integration suite passed 55 tests.

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T18 | Disguised or polyglot files (a script named `.pdf`, a PDF with junk in front, HTML or SVG named `.txt`) | The type comes from the file's bytes. The client media type is never used. `%PDF-` must be at offset 0 (D1). The extension must agree with the sniffed type (D3). Text files containing NUL, C0 controls or DEL are refused as `binary_content` (D4). Text that starts like HTML, SVG, XML or PHP is refused as `markup_content`. Known archive and executable signatures are refused. Allowed types: PDF, PNG, JPEG, CSV, TXT (`api/src/imports/sniff.ts`). | T-IMP-TYPE, T-IMP-HOSTILE, P1 (300 fuzz inputs per run) | A file can be valid in its allowed type and still carry malicious content for some other reader. Originals are only ever downloaded as `application/octet-stream` attachments (T23). |
| T19 | Parser compromise: a pdf.js bug turns a crafted PDF into code execution | pdf.js runs **only** in a child process, never in the API process. The child starts with `--permission` (read access to the worker files only; no write, child-process, worker, addon or WASI permission), an **empty environment** (on Windows only `SystemRoot`), an empty working directory and `--disallow-code-generation-from-strings`. A preloaded **best-effort, in-process** guard deletes `fetch`, `WebSocket`, `EventSource` and `XMLHttpRequest`, blocks the network, process and VM modules, stubs `process.binding` and `process.dlopen`, and locks `connect`/`listen`/`bind`/`open` on the socket and native handle classes reachable from the stdio streams (fix round 2, F-01: `new process.stdin.constructor().connect(...)` was a bypass). The parent re-validates the whole response, and an invalid response is `parse_failed` (`api/src/imports/sandbox/`). pdf.js 6.4.299 no longer has the font `eval` path behind CVE-2024-4367. | Hostile-worker fixtures in `api/test/fixtures/workers/` (read secrets, dump env, spawn, the known socket routes incl. the stdio-socket constructors, `dlopen`; no connection reaches a local listener); T-IMP-WORKER; architecture test (one spawner, no network imports in parse code) | Node's permission model **has no network control**. The guard is a best-effort in-process measure, **not a security boundary**: code that runs in the worker shares the process with it and may find routes the tests do not know. The real control is the network: in AWS the task network (private subnets, **no NAT**, egress only to VPC endpoints). The parser shares the API task's network, so a full compromise could still reach those endpoints. **A dedicated no-egress parser task is a launch gate.** In local and CI runs only the guard applies. |
| T20 | Resource exhaustion: decompression or page bombs, huge images, endless loops, output floods | Hard caps: `IMPORT_MAX_FILE_BYTES` while streaming (413), 50 pages, 2,000,000 text characters, 50,000,000 image pixels, 200,000 lines, 500 fields, `PARSE_MAX_OUTPUT_BYTES`. The PDF pre-scan (fix round 1) refuses chains of more than 3 filters, an indirect `/Filter`, decoded streams over 32 MiB (64 MiB in total), `/Prev` loops and oversized page trees before pdf.js runs, and counts text drawn off the page. The parent enforces a wall clock (`PARSE_TIMEOUT_MS`, kill of the process group on POSIX), a V8 heap cap (`PARSE_MEMORY_MB`), an RSS poll on Linux, and a semaphore (`PARSE_MAX_CONCURRENCY`, then 503 `parser_busy` after `PARSE_QUEUE_TIMEOUT_MS`). Images are never decoded; only their structure is checked. | T-IMP-HOSTILE (nested filters, 512 MiB zero bombs, Kids depth 5000, `/Prev` loops, 420k off-page characters), T-IMP-WORKER, T-IMP-LIM, `pdf-prescan.test` | **No CPU limit** (`RLIMIT_CPU`) is set: a busy loop is stopped only by the wall clock. On Windows the RSS poll does not run, and killing the process tree is not guaranteed. If the API process crashes, a running worker lives on until its own wall clock. The pre-scan does not count streams that use LZW, RunLength or image filters, or corrupt Flate data; the extracted-text cap still applies to them. |
| T21 | Slow or oversized uploads tie up the API (slowloris) | The body is read as a stream with a hard byte counter, so a lying or missing `Content-Length` does not help. An idle timeout (`UPLOAD_IDLE_TIMEOUT_SECONDS`, 408) and a whole-request timeout (`UPLOAD_REQUEST_TIMEOUT_SECONDS`) apply. Authentication and permission are checked before the body is read. Per-user rate limits apply to uploads (60 per 10 min) and exports (10 per 10 min). Per-tenant concurrency gates allow 4 uploads and 2 exports at once. | T-IMP-LIM, T-RBAC-IMP, imports integration tests | The concurrency gates and parse slots are **per API instance**, not distributed. N instances allow N times the limit. The rate limiters use Redis in production. |
| T22 | Cross-tenant access to documents, fields or objects | Five new tables with `FORCE ROW LEVEL SECURITY` and allow-listed in `TENANT_MODELS`. A CHECK forces `storage_key` to start with `t/<own tenant_id>/`. Every `ObjectStore` call re-checks the tenant prefix. The download route re-checks the prefix independently of RLS. The IAM task role is limited to `t/*`, and it may only delete under `t/*/imports/*`. Another tenant's id returns a byte-identical 404. | T-TEN-IMP, P5 (random interleavings of two tenants), T-STORE | Same as T7. In addition, an S3 key is guessable once its UUIDs are known, but no route accepts a key from a client. |
| T23 | Leaking objects through URLs or downloads | No signed URLs: `presignGet` has no caller outside tests (architecture test). Originals are streamed through the API with `Content-Type: application/octet-stream`, `Content-Disposition: attachment` and a **synthesized** file name (`document-<8 hex>.<ext>`), `nosniff` and `no-store`. The streamed bytes are hashed and compared with the stored sha256; a mismatch aborts the stream and logs an integrity alert. Every download is audited before streaming starts. | T-STORE, T-HDR-IMP, T-AUD-IMP | The API pays the bandwidth cost of downloads. |
| T24 | Unencrypted or wrongly encrypted objects | Every put sends SSE-KMS with the configured key and a SHA-256 checksum. In production a `HEAD` verifies the encryption after the write. Production refuses to start with `S3_SSE=none` or without `S3_KMS_KEY_ID`. The bucket policy denies puts without the SSE header, with a non-KMS algorithm or with a different KMS key id, and it keeps TLS-only access, the public access block, versioning and bucket-owner enforcement. Lifecycle: noncurrent versions expire after 30 days, and incomplete multipart uploads are aborted after 1 day. | T-STORE (SSE `aws:kms` observed on MinIO), T-REPO-IMP 4 and 7, `api/test/config.test.ts` | The bucket policy relies on single-request `PutObject` with explicit headers. A future multipart upload path would need the policy reviewed. |
| T25 | Injection through extracted strings (XSS, bidi spoofing, log injection) | Every string that comes from a document (file names, values, excerpts) is stored and returned as single-line text, with C0/C1 controls, line separators and bidi controls removed (D6, `SANITIZED_VALUE`). The UI renders text nodes only, through `displayText()`. Logs carry ids, sizes, 12-character sha256 prefixes and fixed reason codes, never file names, values or text. Audit metadata is allow-listed. | T-IMP-NAME, T-LOG-IMP, T-AUD-IMP, UI-11 | None known beyond T2. |
| T26 | A wrong or manipulated value becomes a claim without a human check | Confidence is a **rule-based parse score, not an accuracy measure**, and the UI says so. Fields below 0.90, unparseable values and conflicting duplicates are flagged, and every PDF field is flagged. Only ACCEPTED documents can be committed. Acceptance needs `import:review` (ANALYST cannot accept) and a reason of at least 10 characters. Values that are unparseable or conflicting must be resolved one by one, even with "confirm all remaining". Each decision is an append-only row plus an audit event. Accepted documents are immutable (DB trigger). Claims from imports start as `AWAITING_ANALYSIS`, with no money and no packet. A claim that already has a packet is never changed by a commit. | T-REV (REV-01..08), T-COM (COM-01..11), P3 | Four-eyes on acceptance (formerly D-7) is enforced since run `REQ-20261009-four-eyes`: the uploader and anyone who corrected or added a field cannot accept the document (T46, [section 8](#8-four-eyes-separation-of-duties)). Still open: a document with no review reasons is accepted automatically with no human acceptor (FE-S1), and only CORRECT/ADD count as editing (FE-S3). |
| T27 | CSV/Excel formula injection | Every exported text cell is cleaned (controls, bidi and zero-width characters removed; tab, CR, LF, LS and PS become one space; 10,000-character cap). A cell whose first non-whitespace character is `=`, `+`, `-`, `@` or a full-width form (U+FF1D, U+FF0B, U+FF0D, U+FF20) gets a leading `'`. Numbers are written from numbers and never pass through text handling. The XLSX writer never emits `<f>`, hyperlinks, drawings, external relationships, macros or defined names (`api/src/exports/`). | T-EXP (EXP-03 corpus, EXP-15 random strings), P4, exports unit tests | The neutralizing `'` is visible in some spreadsheet programs. Other consumers (a script reading the CSV) must still treat cells as data. |
| T28 | Bulk exfiltration through exports | Exports need `export:claims`, `export:packets` or `export:outcomes`. VIEWER has none, and ANALYST has only claims. Tenant scope and filters are the same as R26. `EXPORT_MAX_ROWS` (50,000) is checked before the first byte (422). `export.started` is committed **before** any data is sent, and `export.completed` records the row count, byte length and SHA-256 of the exact bytes sent. `export.aborted` records partial transfers. Exports contain no user names, emails or ids, and no demand letter text. | EXP-01..14, T-RBAC-IMP, T-AUD-IMP | An authorized user can still export their whole tenant in several files. The audit trail records it but does not prevent it. |
| T29 | WAF blocks or lets through uploads | The 64 KiB Content-Length block now excludes only `POST /api/v1/imports/<uuid>/documents`, and that route has its own block above 10 MiB (`var.import_max_file_bytes`). The API enforces both limits itself while streaming. | `terraform validate`, T-REPO-IMP 4, regex boundary tests | The **AWS Common rule set** still inspects the first 8 KB of binary upload bodies and may produce **false positives** on PDFs or images. Watch the `aws-common` metrics before launch, and add a scoped rule exclusion if needed. Not tested against a deployed WAF. |
| T30 | Malware passed on to other users | Documents are never executed or rendered by the server. Downloads are attachments with `nosniff`. Files are stored, not scanned. | none | **No antivirus or malware scan** of uploads. A reviewer who downloads an original and opens it locally carries that risk. A scanning step (for example a quarantine prefix and an AV task) is future work. |
| T31 | Supply chain of the new parsers | Two new runtime dependencies, exact-pinned and without install scripts: `pdfjs-dist` 6.4.299 (worker only) and `fflate` 0.8.3 (writes XLSX only). Rejected on purpose: SheetJS (`xlsx`), `exceljs`, `pdf-parse`, `file-type`, `csv-parse`, `sharp`, `@fastify/multipart`. The CSV parser and the magic sniffing are small in-house code checked against the Python reference. `@napi-rs/canvas` arrives as an optional dependency of pdf.js; it has no install script, and the worker cannot load it (no `--allow-addons`). | T-REPO-IMP 2, `npm run audit`, `npm audit signatures`, `verify:no-install-scripts` | Same as T15. pdf.js is a large parser, and its bugs remain the main parser risk (T19). |

### 6.3 Known gaps and residual risks (step 3)

These are open. Do not read any of them as done.

1. **Parser isolation has limits.** The worker has no CPU limit (wall clock only). Node's permission
   model does not cover the network; the in-process guard is best effort only (not a boundary). The real
   control is a no-egress network: in AWS the no-NAT task network, which the worker shares with the API
   task. **A dedicated no-egress parser task is a launch gate** (`infra/README.md`). On Windows (development only) the
   RSS poll does not run, and libuv adds a few environment variables to the child.
2. **Concurrency limits are per instance.** Upload, export and parse gates are in-process counters.
   Distributed enforcement (for example Redis semaphores) is future work.
3. **No antivirus scan** of uploaded files (T30).
4. **WAF.** The body-size rule changed for the upload route. The AWS Common managed rule set may
   produce false positives on binary bodies (T29). Neither has been tested against a deployed WAF.
5. **Four-eyes on document acceptance: the gap itself is closed** by run `REQ-20261009-four-eyes`
   (section 8; it was finding F-13 / decision D-7). What stays open from it: auto-accepted documents have
   no human acceptor (FE-S1), and a field REJECT or a document-type change does not count as editing
   (FE-S3).
6. **Email-forward ingestion is design only.** No SES, SQS or email worker exists. The design and its
   open questions are in [docs/design/email-ingest.md](../docs/design/email-ingest.md).
7. **No OCR.** Images yield no fields and need manual entry (D8). PDF parity with Python holds only for
   simple text-layer PDFs (D2).
8. **Not run:** the container images and compose stack (Docker was broken locally; CI is the authority),
   Playwright end-to-end tests, and the forced audit-append failure for exports (EXP-06, skipped: it
   needs a second database with INSERT revoked). Encrypted-PDF tests were skipped because `qpdf` was not
   installed. The export abort path is integration-tested with a real socket.
9. **Open owner decisions** (not blocking): outcomes export as a decision ledger, VIEWER cannot import or
   export, threshold 0.90, 1 GiB storage quota per tenant. (Four-eyes was decided and built in run
   `REQ-20261009-four-eyes`; its policy defaults D1-D4 are in section 8.4.)

## 7. Step 4: Dev dashboard, Recovery intelligence and API keys

Build-order step 4 (run `REQ-20261009-step4-intelligence`, branch `feat/intelligence`) adds the internal
Dev dashboard, the tenant-facing Recovery intelligence features, tenant API keys with a
machine-authentication path, and the evaluation tool. The structure is in
[ARCHITECTURE.md, step 4](../ARCHITECTURE.md#web-platform-dev-dashboard-recovery-intelligence-and-api-keys-step-4).
Every secret and its rotation is in [docs/secrets.md](../docs/secrets.md).

### 7.1 New assets and trust boundaries

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Tenant API keys | the plaintext exists once, in the 201 response to the creator; `api_keys.secret_hash` stores `HMAC-SHA-256(API_KEY_PEPPER, secret)` | a stolen key acts for its tenant within its scopes until it expires or is revoked |
| `API_KEY_PEPPER` | Secrets Manager `…/api-key-pepper`, injected into the ECS task | required to verify any key; rotating it invalidates every key |
| Cross-tenant aggregates | `fr_platform_pipeline_stats` (R60) | the only platform read that touches tenant tables |
| Recent log records | in-memory ring buffer per API instance (R62) | logs can carry identifiers if a developer puts them into a message |
| Feature flags | `feature_flags` | can switch a tenant feature off for every tenant |
| Evaluation runs | `eval_runs`, `eval_case_results` (append-only) | the only quality figures the product shows |

New trust boundaries: **machine clients** (a bearer key instead of a browser session; no cookie, no CSRF
token) and **platform staff reading aggregates across tenants** (the Dev dashboard).

### 7.2 Threats and mitigations (step 4)

"Verified by" names the step 4 acceptance groups (`T-KEY-*`, `T-FLAG-*`, `T-WEB-*`, `T-SIM-*`,
`T-WORK-*`, `T-EVAL-*`, T4-T16 in `*/test-acceptance/`), the builder's unit tests (`api/test/`) and the
integration tests (`api/test/integration/`). Test round 2 passed on Node 22.23.3 and 24.21.0: api
acceptance 651 passed (9 skipped for missing tools or declared skips, 2 todo), web 138 passed (1 skip),
shared 33/33, integration 85 passed (2 placeholder skips). Round 1 had found six defects (D-1..D-6); all
were fixed and re-verified.

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T32 | API key theft or leak (browser, logs, URLs, database dump) | The plaintext is shown once, held only in the create dialog's component state (never in the query cache, router state, URL, console or browser storage) and cleared on Done, Escape or unmount. The database stores only the HMAC (`apikeys/key-material.ts`). The logger redacts `authorization` and replaces any `fr_live_...` string at any depth with `[REDACTED]`; a URL containing `fr_live_` is refused with 400 before it is logged; the log view withholds such messages. Keys expire (default 90 days, at most 365; production refuses keys without expiry). | T-KEY (hash-only DB text search, one-time reveal, log scrubbing), `apikeys-units`, `observability.test`, web `step4.test.tsx` | Keys are **bearer** credentials: whoever holds one can use it from anywhere until it expires or is revoked. No per-key IP allow-list and no request signing (deferred). A key copied into a customer system is only as safe as that system. |
| T33 | Key brute force and key-id enumeration | Secrets carry 256 random bits. Verification is constant-time (`timingSafeEqual` over the digests), and an unknown key id is compared against a fixed dummy digest so timing does not reveal whether the id exists. Unknown, wrong secret, malformed, revoked and expired keys get **byte-identical 401 bodies** with no distinguishing header. Failed attempts count per client address (`RATE_LIMIT_API_KEY_FAIL_MAX`, 30 per 10 minutes); once the budget is used up the address is refused with 429 **before** any verification work, even with a valid key. **D-4 boundary fix:** the gate now blocks as soon as a failure leaves `remaining = 0`, so with a limit of N the (N+1)th attempt is refused (it used to be the (N+2)th). | T-KEY-14 (FAIL_MAX=3: 401, 401, 401, then 429, valid key from the same address 429, other address 200), unit test of the real pipeline, integration FAIL_MAX=2 | The "refuse early" cache is **per instance** (counts are shared through the limiter store, DV-6). Attackers spread over many addresses are slowed only by the per-address limit and the WAF; guessing a 256-bit secret is infeasible anyway. Unknown key ids are not audited per tenant (there is no tenant to attribute them to); they appear in telemetry as 401s. |
| T34 | Scope confusion: a key used on a route it should not reach | Routes opt in explicitly with `access.apiKeyScope`. An architecture test enumerates every route and requires exactly nine (R26, R27, R53 `claims.read`; R54 `exports.claims`; R40-R44 `imports.write`) and forbids `/platform/*`, `/auth/*`, `/users*`, `/api-keys*`, `/audit*`, `/flags*` and approval writes. Every other route answers 403 after authentication (audited `apikey.use_denied` reason `route`); a missing scope answers 403 (reason `scope`). A key never bypasses a permission check, rate limit, flag, tenant scope or audit write. | T-KEY scope matrix over the whole route table, 10 non-listed routes 403 (integration), architecture test | None known. Adding a key route requires a deliberate test change. |
| T35 | Confused deputy through the creator's identity; privilege drift after creation | The key's permissions are the scope permissions **and** must still be held by the creator's **current** role on every request (disabled creator, downgraded role or suspended tenant: 401, reason `creator` or `tenant`). A creator can grant only scopes whose permission they hold. Only OWNER and ADMIN manage keys. The tenant comes only from the key row; tenant ids in headers, query or body are ignored. Audit events carry actor role `API_KEY` and `viaApiKey`. | creator downgrade/disable integration tests, tenant smuggling test, T-KEY | A key works only while its creator is active with a sufficient role; **re-enabling a disabled creator re-enables their keys**. Offboarding should revoke the person's keys explicitly. |
| T36 | Pepper compromise or weak pepper | The pepper lives outside the database (Secrets Manager, ECS `valueFrom`). Production refuses to start if it is missing, shorter than 43 characters, a documented dev/CI value, below 256 estimated bits, fails the entropy check, or equals another secret; a set-but-empty value is refused in every environment (D-6). Because secrets are 256-bit random, a database dump plus the pepper still does not reveal any key. | `config.test.ts`, T-KEY-19 | **Rotation invalidates every key at once** (no dual-pepper support), and the key list keeps showing those keys as ACTIVE until they are revoked. Procedure in [docs/secrets.md](../docs/secrets.md). |
| T37 | CSRF or cookie confusion on key requests | CSRF is skipped **only** for requests authenticated with a `Bearer fr_live_` key; such requests never consult a cookie-derived identity and never receive cookies. A request carrying both a key and cookies is a key request only. If an `Origin` header is present it must equal `APP_ORIGIN` for every method (DV-5). The API sends no CORS headers (it strips them), so a page on another origin cannot read responses or send a cross-origin request carrying an `Authorization` header. Cookie/JWT requests are checked for CSRF exactly as before (T4). | T-KEY-11 (mixed credentials), T-CSRF | None known. |
| T38 | Platform/Dev staff see customer data (data minimisation) | No platform route accepts a tenant id. The only cross-tenant read is the `SECURITY DEFINER` function `fr_platform_pipeline_stats`, which raises outside system mode, pins `search_path`, range-checks its inputs and returns counts and durations only (never a tenant id, user id, name, file name, storage key, hash or claim number). Every platform response is parsed by a strict outgoing schema (`strictBody`) before it is sent. Architecture tests forbid tenant models, tenant tables and `email` in platform modules. Platform responses never mention API keys or per-tenant key counts. Platform roles have no tenant database handle. | hostile tenant strings (e-mail addresses, tokens) absent from all R60-R68 bodies (integration), T4, T-KEY-18, architecture tests | Aggregates span all tenants; with very few tenants, a count can effectively describe one tenant's activity volume (never its content). Platform `authz.denied` events name route templates and permission names (accepted ruling). |
| T39 | Secrets or personal data leaking through the Logs view | The ring buffer stores only 8 fields **derived** from the already-redacted log line: never the raw line. `requestId` must be a UUID, `route` a pattern without `?`, `event` only a message matching `^[A-Za-z0-9 _.:/()-]{1,80}$` with no `@` and no run of 20+ token characters, otherwise `(message withheld)`. Malformed JSON, unknown levels and prototype keys are ignored; the buffer never throws into the logger. The UI renders every value as inert text and clips long values (D-2). Every view is audited (`platform.logs_viewed`) and the tab is `PLATFORM_DEV` only. | `observability.test` (e-mail, JWT-like, long hex, UUID in message, control/bidi characters, 10,000-character messages), T6, T-WEB-04, logging tests | A short message of allowed characters is still shown, so developers must keep data out of log **messages** (structured fields are dropped anyway). The view covers one instance and is lost on restart; central log search is CloudWatch, outside this control. |
| T40 | Telemetry cardinality attack (memory growth) | Telemetry keys on the route **pattern**, never the URL. Unknown URLs share one `(unmatched)` bucket, unknown methods become `OTHER`, at most 200 route keys exist (overflow into `(other)`), and buckets are fixed. Memory is O(routes x buckets). | `observability.test`, T5 | None known. |
| T41 | Feature-flag tampering or misuse | Only `PLATFORM_DEV` (MFA required) holds `platform:flags`. Changes need CSRF + Origin, a reason of at least 10 characters, the current version (409 if stale), a `SELECT ... FOR UPDATE` and the `platform.flag_changed` audit event in the same transaction. Only the three registry keys exist; DB triggers enforce `version + 1` and block INSERT, DELETE and TRUNCATE. Flags can gate only the three intelligence features, never auth, CSRF, RLS or audit (architecture test), and an unreadable flag counts as off. | `platform-dashboard.int` (stale, conflict, unknown, CSRF, role, audit), `intelligence-db.int` (triggers, grants), T7, T-FLAG | **No four-eyes on flags** (the section 8 control covers claim and document decisions only): one PLATFORM_DEV can switch a feature off for every tenant. A change reaches other instances only after `FLAGS_CACHE_TTL_MS` (5 s default, at most 30 s in production). Flags are global; there are no per-tenant overrides. |
| T42 | Cross-tenant leakage through Recovery intelligence (similar claims, worklist, provenance) | All reads run in the caller's tenant transaction (RLS FORCE) with explicit `tenant_id = fr_current_tenant()` predicates as defense in depth. Candidates come only from the same tenant; another tenant's claim id gets the byte-identical 404; platform users get 403 before any query. Query schemas are strict, page size and candidate count are bounded, SQL is parameterized, and nothing is cached. | `intelligence.int`, T10-T12, T-SIM, T-WORK | Same as T7. |
| T43 | Misleading figures (unearned accuracy, learning or speed claims) | Fixed texts from `packages/shared/src/honest-copy.ts`; weights are shown as policy with every result; evaluation results are labeled "synthetic fixtures" and never accuracy; an architecture test forbids "neural mesh", "Hebbian", "solved-problems cache", "AI-powered", "faster than" and "Nx faster" in source, and UI sweeps check every new screen. | architecture test, web DOM sweeps, T14 | Users can still over-read a ranking; the worklist note says it is a work-order aid, not a forecast. |
| T44 | Evaluation tool abuse (path traversal, secret disclosure, tampering with results) | Manifest paths must resolve inside the set directory to regular files of at most 5 MiB (absolute paths, `..` and symlink escapes refused). Parsing runs in the existing sandbox with no network. Only `--record` writes, in one system transaction, and never prints the database URL; an infrastructure error records nothing (exit 3). Eval tables are append-only for every role. | `eval-units`, `eval-record.int`, T9 | The tool runs with the operator's `DATABASE_URL` in system mode, so it is as trusted as the operator. |
| T45 | SUPER_ADMIN reach | SUPER_ADMIN gets pipeline health and telemetry (aggregates) and the platform audit chain (R67/R68), but not logs, flags or evaluation. Every read is audited in the platform chain before data is released. Cross-tenant read rules (T8) are unchanged. | T3 RBAC matrix, T-RBAC | SUPER_ADMIN can read the platform chain it also writes to; chain heads are not anchored externally (T10). |

Changed rows from earlier sections: **T9** (`PLATFORM_DEV` now also holds `platform:eval`, and
`SUPER_ADMIN` holds `platform:audit`; neither gains any tenant-data permission) and **T14** (the secret
entropy check's dominance rule is now an exact binomial bound, so a truly random secret is falsely refused
with probability below 10^-12; `API_KEY_PEPPER` is a new production secret).

### 7.3 Known gaps and residual risks (step 4)

These are open. Do not read any of them as done.

1. **Per-instance observability.** Telemetry, the log view and the API key "refuse early" cache live in
   one API process and reset on restart. With several instances each shows only its own view.
2. **Flags:** no four-eyes approval (section 8 does not cover flags), global only, and up to `FLAGS_CACHE_TTL_MS` of staleness on other
   instances.
3. **No outcome data.** The worklist and similarity are fixed rules; nothing can say which claims will
   actually be paid. A learned ranker is deferred until outcomes are recorded and measured offline.
4. **API keys are bearer tokens** with no IP allow-list, no request signing and no rotation helper
   (create-then-revoke is the manual path). Rotating `API_KEY_PEPPER` invalidates every key, and the list
   still shows them as ACTIVE. Re-enabling a disabled creator re-enables their keys.
5. **Secret operations gaps** (see [docs/secrets.md](../docs/secrets.md)): no tool to re-encrypt TOTP
   secrets when `MFA_ENC_KEY` rotates; `MIGRATE_DATABASE_URL` has no Secrets Manager container in
   `infra/`.
6. **Not testable black-box:** T-KEY-10 (declared skip in the test spec). Wrapping and horizontal-scroll
   behaviour of long log values is not observable in jsdom.
7. **Not run:** container images and the compose stack, Playwright end-to-end tests, any AWS deployment.
   Terraform was validated by the builder only (fmt/validate; never planned or applied).

## 8. Four-eyes: separation of duties

Run `REQ-20261009-four-eyes` (branch `feat/four-eyes`, build commit `8eb7062`) makes sure the person who
prepared a decision is not the person who takes it. Before this run, the gap was a documented residual
(A9 and F-13 for approvals, D-7 for import review). Rows T11 and T26 now point here. The structure is in
[ARCHITECTURE.md, four-eyes](../ARCHITECTURE.md#web-platform-four-eyes-separation-of-duties).

### 8.1 What is enforced

| Decision | Refused | Still allowed |
| --- | --- | --- |
| Approve or reject a claim's current packet revision | Every **revision author** of the claim: the recorded creator (`evidence_packets.created_by_id`) of **any** revision of that claim, current or superseded. A revision with no recorded creator (seeded revision 1) adds nobody. Since step 5, revision 1 created by analysis records the analyzer (section 9). Example: A creates revision 2 and B creates revision 3, so A and B are both refused and C may approve. | Any other user with `packets:approve` |
| Accept an imported document | Every **document editor**: the uploader (`import_documents.uploaded_by_id`, if recorded) and every user who recorded a field `CORRECT` or `ADD` decision on that document | Any other user with `import:review` |

Unchanged: marking an APPROVED revision send-ready (anyone with `demands:send`, including the approver and
a revision author; D2), rejecting a document (D4), RBAC, the state machine, the reason rules and every
other error. A field `CONFIRM`, a field `REJECT`, a document-type change and the confirmations that
acceptance itself records do not make a user a document editor (D3).

**API-key uploads** are attributed to the user who created the key. That user is the uploader (shown as
`uploadedBy` in the review queue), so they cannot accept the document. An ingest actor of kind `user`
with a non-UUID id is refused before any database work. Only the future `system` ingest kind (no caller
today) stores a null uploader; it excludes no uploader, but CORRECT/ADD editors are still excluded. API
keys still cannot call approve, reject, send, accept or reject-document at all (T34).

### 8.2 Threat and mitigation

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T46 | Self-approval: one person edits a packet revision and approves (or rejects) it, or uploads or edits a document and accepts it, so no second person ever checks the work | Service check under the existing row locks, backed by `SECURITY DEFINER` `BEFORE INSERT` triggers on `approvals` and `import_review_decisions` (migration `20261011000000_four_eyes`). A refusal is 403 `four_eyes_required`, changes nothing, and is audited as `authz.four_eyes_denied`. If that audit append fails, the request fails with 500 (fail closed). The UI hides the button for the excluded person, but that is cosmetic only (section 8.3). | FE-C01..17, FE-D01..11, FE-B01..07, FE-P01..04, FE-U01..10, FE-SH, the T-APR-05 rewrite (`*/test-acceptance/`); `api/test/integration/four-eyes.int.test.ts`, `api/test/four-eyes-units.test.ts`, `web/test/four-eyes.test.tsx`, `packages/shared/src/four-eyes.test.ts` | FE-S1..S4, FE-N1 (section 8.5); FE-N2 closed by step 5 (T47) |

### 8.3 How it works

1. **Service check (the primary control).** Claims: `transition()` in `api/src/claims/service.ts` checks
   the requester against every revision's creator for the transitions in `FOUR_EYES_GUARDED_TRANSITIONS`
   (`approve`, `reject`). It runs while the claim row is locked (`SELECT ... FOR UPDATE`). Documents:
   `assertNotDocumentEditor` runs in `acceptDocument` (`api/src/imports/review-service.ts`) right after
   the document row lock. It checks the uploader first (`basis: uploader`), then CORRECT/ADD decisions by
   the requester (`basis: field_editor`). The editor decisions are listed in `EDITOR_DECISIONS`
   (`api/src/imports/dto.ts`). Every edit and decision on a claim takes the same claim lock, and every field
   edit and decision on a document takes the same document lock. So the author or editor set cannot
   change between the check and the commit, and of two concurrent decisions at most one succeeds. The
   other gets `stale_revision`, `invalid_state` or `four_eyes_required`, never 500.
2. **Database triggers (defence in depth).** Migration
   `api/prisma/migrations/20261011000000_four_eyes/migration.sql` adds `approvals_four_eyes_guard`
   (function `fr_approval_four_eyes_guard`, rows with action `APPROVE` or `REJECT`) and
   `import_review_decisions_four_eyes_guard` (function `fr_review_four_eyes_guard`, action `ACCEPT`).
   Both are `BEFORE INSERT`, `SECURITY DEFINER` (owner `freight_owner`) with `search_path = public,
   pg_temp`, and `EXECUTE` revoked from `PUBLIC`. They match `tenant_id` explicitly and raise SQLSTATE
   `P0001` with the message `four_eyes_required`. Because they run as definer, a missing or foreign
   `app.tenant_id` cannot hide the author rows; such inserts are refused too (FE-B04). The migration adds
   triggers only: no table or column changes, no new tenant table, and the earlier migrations are
   byte-for-byte unchanged. Existing rows are not re-validated. `EDIT` and `SEND_READY` rows are not
   checked.
3. **Error.** `403` with code `four_eyes_required` and the fixed message `A different person must make
   this decision.` The body is `{ code, message, requestId }` only, the same for browser and API callers,
   with no other user's identity and no database text. Precedence for approve/reject: 400 -> 401 -> 403
   `forbidden` -> 404 -> 409 `stale_revision` -> 409 `invalid_state` -> **403 `four_eyes_required`** ->
   422 (unacknowledged pending findings). For accept: 400 -> 401 -> 403 `forbidden` -> 404 -> 409
   `invalid_state` -> **403 `four_eyes_required`** -> 409 `unresolved_fields`. If a trigger refusal ever
   reaches the API (a service check was bypassed), `toHttpError` maps it to the same 403, never 500. It
   matches only the exact SQLSTATE and message, and it logs `four_eyes_db_guard` at error level.
4. **Audit, fail closed.** Each refused request appends exactly one `authz.four_eyes_denied` event to the
   tenant chain. The error handler writes it in its own transaction after the business transaction has
   rolled back. Claim metadata: `claimId`, `packetId`, `packetRevision`, `action` (`APPROVE` or
   `REJECT`), `basis: revision_author`. Document metadata: `documentId`, `batchId`, `action: ACCEPT`,
   `basis` (`uploader` or `field_editor`). No reason text, no other user's id and no field values are
   recorded. No `authz.denied` event is written for this error. If the append fails, the request answers
   500 `internal_error` and logs `four_eyes_audit_failed`, the same fail-closed rule as `authz.denied`. A
   refusal otherwise changes nothing: no approval or decision row, no status change, the claim `version`
   unchanged, no field confirmed, no `approval.*` or `review.*` event.
5. **UI hiding is cosmetic only.** `ApprovalItem.selfAuthored` (`GET /api/v1/approvals`) and
   `ImportDocumentDetail.selfAuthored` (document detail, upload, set type, accept, reject) are required
   booleans. They are computed for the requesting user, whose identity is reloaded from the database on
   every request. When the flag is true, the Approvals row shows "You edited this revision. Another
   approver must approve it." instead of Approve/Reject. The review dialog shows "You uploaded or edited
   this document. Another reviewer must accept it." instead of Accept document. This only saves a click.
   **The server is the control**: a stale screen or a second tab still gets the 403, which the UI shows
   in a `role="alert"` element before refetching. The flag only says whether the requester is excluded;
   it names no other user.

### 8.4 Policy defaults (owner decisions; each can be flipped later)

- **D1. A revision author may not reject either** (not only approve), for uniformity. An author who wants
  to withdraw their revision can edit again. To flip it: remove `reject` from
  `FOUR_EYES_GUARDED_TRANSITIONS`, add a new migration that drops `REJECT` from the trigger, and change
  the UI condition.
- **D2. Send-ready is unrestricted.** The approver, and also a revision author, may mark a revision
  someone else approved as send-ready. Two people were already involved.
- **D3. "Document editor" means the uploader plus CORRECT and ADD actors only.** A field REJECT, a
  document-type change and CONFIRM do not count. Adding REJECT and SET_TYPE would take a change to
  `EDITOR_DECISIONS` plus a new migration (see FE-S3).
- **D4. Document reject is unrestricted.** An uploader or editor may reject their own document, which is
  the normal remedy for a wrong upload.

### 8.5 Accepted residuals (four-eyes)

These are open. Do not read any of them as done. All were rated Low or Info by the security review of
this run, with no Critical, High or Medium findings.

1. **FE-S1 (Low): auto-accepted documents have no human acceptor.** A document with no review reasons
   goes `RECEIVED -> ACCEPTED` at ingest (`api/src/imports/service.ts`). Commit needs only `import:run`,
   so the uploader can turn it into a claim without a second person. Options if this is not accepted:
   force `NEEDS_REVIEW` for every document, or stop the uploader from committing a document that no
   human accepted. Since step 5, such documents also feed the analysis (SA-9, section 9.5); the
   resulting packet still needs a second person to approve it.
2. **FE-S2 (Low): a status change is not tied to a decision row.** The triggers guard inserts into
   `approvals` and `import_review_decisions` only. `freight_app` holds `UPDATE (status)` on the packet and
   document tables, so SQL that sets `APPROVED` or `ACCEPTED` without inserting a decision row is outside
   the new triggers. The existing state-machine triggers still apply, and the service always writes both
   in one transaction. Possible hardening: a `DEFERRABLE` constraint trigger that requires a matching
   APPROVE/ACCEPT row in the same transaction.
3. **FE-S3 (Low; policy D3): narrow editor definition.** A field REJECT (choosing between conflicting
   values) or a document-type change also shapes what a document contributes to a claim, but it does not
   make the actor a document editor. If the policy is revisited, count field REJECT, and SET_TYPE when a
   later ADD depends on it.
4. **FE-S4 (Low): refusal audit volume.** Every refused attempt writes one audit row and takes the
   tenant's audit advisory lock. The decision routes have only the global rate limit. This is the same
   exposure as `authz.denied` and has no cross-tenant effect. Possible hardening: a per-user rate group
   for decision routes, or coalescing repeated refusals.
5. **FE-N1 (Info): a trigger refusal is logged but not audited.** If a service check were bypassed and
   the trigger refused the insert, the API answers 403 and logs `four_eyes_db_guard`, but writes no tenant
   audit event. This path is not reachable through the current routes. Option: audit it with
   `basis: db_guard`.
6. **FE-N2 (Info): revision 1 had no creator. Closed by step 5** (run `REQ-20261010-step5-analysis`).
   Revision 1 created by analysis records `created_by_id` = the user who triggered it (single and bulk),
   so that user cannot approve or reject the claim, and the trigger `evidence_packets_analysis_guard`
   refuses a revision 1 without an author for an `AWAITING_ANALYSIS` claim (T47, section 9). Seeded
   revision 1 still has a null creator and excludes nobody (synthetic demo data only). Decided in step 5
   (policy D2): the uploaders and field editors of a claim's documents are not claim authors (SA-10).
7. **Flags are not covered.** Feature-flag changes (T41) remain single-person.

### 8.6 What was run

Local run on **Node 22.23.3 (the CI version), not GitHub CI**, in the `web-ci.yml` step order with its
environment, on Windows with portable PostgreSQL 16 (runtime role `freight_app` without BYPASSRLS) and
MinIO with SSE-KMS:

| Step | Result |
| --- | --- |
| lint, typecheck, `verify:no-install-scripts`, `prisma:generate` | exit 0 |
| unit (`npm test`) | shared 136, api 356, web 67 passed |
| migrate deploy (incl. `20261011000000_four_eyes`), seed `--reset`, `ensure-bucket`, build | exit 0 |
| integration | 95 passed, 2 pre-existing skips |
| acceptance | shared 36 passed; api 690 passed, 9 skipped, 2 todo; web 150 passed, 1 skipped |

Every FE-* case passed, including 20 rounds per concurrency case (FE-P01..04) with no 500. The tester made
three test-design fixes in the first round; none relaxed an expected outcome. Not covered or not run:

- The fail-closed path (500 when the `authz.four_eyes_denied` append fails) and the mapping of a trigger
  refusal to 403 cannot be reached black-box. Only the builder's integration and unit tests cover them.
- Not run on Node 24 or in GitHub CI. `npm run audit` and `npm audit signatures` were not run in this
  run. The parity suites used Python 3.14 (CI uses 3.12).
- Container images, the compose stack, Playwright and any AWS deployment, as in the earlier steps.

## 9. Step 5: claim analysis

Run `REQ-20261010-step5-analysis` (branch `feat/analysis`, build commits `d27c4a2`..`5c047fb`) adds the
analyze action: the Python rules and draft letter, ported to `@fr/shared/analysis`, turn an
`AWAITING_ANALYSIS` claim into packet revision 1 (`PENDING_REVIEW`). The structure is in
[ARCHITECTURE.md, claim analysis](../ARCHITECTURE.md#web-platform-claim-analysis-step-5). The user view is
in [README, claim analysis](../README.md#claim-analysis-step-5).

**Honesty.** Findings are deterministic rule outputs on extracted (and, where flagged, human-reviewed)
field values. They are drafts that need human review, not verified results. The per-finding confidence is
a fixed constant per rule, not a measured probability. No accuracy is claimed anywhere, and the step 4
evaluation gate runs on synthetic fixtures and is not an accuracy measure. The UI copy
(`ANALYSIS_NOTE`, `packages/shared/src/analysis/copy.ts`) says "Findings are drafts for human review, not
verified results", and the shared and acceptance tests scan the copy for accuracy wording.

### 9.1 New assets, permission and trust boundaries

| Item | Detail |
| --- | --- |
| Permission | `claims:analyze`: OWNER, ADMIN, MANAGER, REVIEWER, ANALYST. Not VIEWER, PLATFORM_DEV or SUPER_ADMIN. **No API-key scope** grants it, so any API-key request to either route is 403. ANALYST can analyze but still cannot approve (no `packets:approve`). |
| Routes | `POST /api/v1/claims/:id/analyze` (201), `POST /api/v1/claims/analyze-awaiting` (200). Both mutating, cookie session + Origin + CSRF, per-user rate group `analysis`. |
| New writes | `evidence_packets` revision 1 and its `packet_sources`, `packet_findings`, `packet_timeline_events` rows; claim `status`, amount columns and `version`; audit `claim.analyzed`, `claim.bulk_analyzed`. No new table, no new tenant table, no grant change. |
| Untrusted input | The field values of the claim's accepted documents (uploaded files, parsed in the step 3 sandbox, validated at ingest, possibly corrected by a reviewer). The engine re-validates every decimal and datetime. |
| Database | Migration `20261012000000_analysis`: triggers `claims_status_guard` and `evidence_packets_analysis_guard` (section 9.3). |
| Configuration | `RATE_LIMIT_ANALYSIS_MAX` (default 30 per user per 10 minutes, 1..100000). Not a secret. |

### 9.2 Threats and mitigations (step 5)

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T47 | Self-approval of an analyzed claim: the analyzer, or a script, creates revision 1 and approves it (four-eyes FE-N2) | Revision 1 records `createdById` = requester (single and bulk), so `transition()` and `fr_approval_four_eyes_guard` refuse their approve/reject (403 `four_eyes_required`). `fr_analysis_packet_guard` refuses a revision 1 without an author for an `AWAITING_ANALYSIS` claim, and `fr_claim_status_guard` refuses leaving `AWAITING_ANALYSIS` unless such a revision exists. `created_by_id` is not in the `freight_app` UPDATE grant on `evidence_packets` (status only), so the author cannot be rewritten. The UI tells the analyzer before they click ("You will be recorded as the author of revision 1, ..."). | `api/test/integration/analysis.int.test.ts` (four-eyes on the analyzer, `selfAuthored`, another approver succeeds); acceptance AN-A, AN-D (`*/test-acceptance/`) | SA-9, SA-10, SA-11 |
| T48 | Lifecycle bypass: a write moves a claim out of `AWAITING_ANALYSIS` without revision 1, back into `AWAITING_ANALYSIS`, or inserts a packet that is not a proper revision 1 (a forged or second "first" packet) | Service: row lock (`lockClaimForUpdate`) and re-check of status and "no packet" under the lock; unique `(claim_id, revision)` and one-live-revision indexes. Database: the two step 5 triggers (section 9.3), `SECURITY DEFINER`, explicit `tenant_id` match, independent of `app.tenant_id`. A trigger refusal reaching the API is 409 `invalid_state` (exact SQLSTATE + message match, `api/src/http/db-guard.ts`), never 500 and never the DB text, logged as `analysis_db_guard`. | integration (owner SQL and Prisma as `freight_app`), unit guard-mapping tests, acceptance AN-D01..D08 | SA-6 (amount columns not DB-guarded), SA-7 |
| T49 | Bulk abuse and cost amplification: one request triggers many analyses, or bulk is used to bypass the per-user limit | `limit` 1..25 (strict schema), scan cap `min(4 x limit, 100)`, each candidate in its own short transaction, oldest first. **Fix round 1 (S5-1):** the request's token covers the first candidate and one more `analysis` token is charged per further candidate attempted; an empty bucket stops the run early (200, same shape). So bulk never allows more analyses than the single route in the same window (before the fix: up to 25 per token). Work per analysis is bounded (amounts at most 21 digits, at most 500 fields per document). | `api/test/analysis-budget.test.ts` (fake limiter), integration 429 test, acceptance AN-B01..B07, AN-C03/C04, AN-R/P11 | SA-1, SA-2, SA-3, SA-8. The budget stop has no black-box acceptance case yet (AN-B09 requested by the reviewer). |
| T50 | Untrusted extracted text in stored packet content (letter, citations, timeline, findings) | The letter passes every untrusted string through `plain()` (control, bidi, backtick and angle-bracket stripping, length caps); citation excerpts use `plain(..., 200)`, timeline facility and invoice number `plain(..., 100)`. The Markdown is rendered but not persisted. The web renders all of it as React text (no `dangerouslySetInnerHTML`), claim numbers via `SafeText`; CSV/XLSX export neutralizes formulas. The UI never shows server error text (fixed texts per status code). | shared engine tests (sanitized names in the letter), web tests (no server text in alerts), acceptance AN-W | SA-5 (raw invoice line description in finding `explanation`/`calculation`) |
| T51 | Cross-tenant analysis or disclosure | `analyzeClaim` runs in the caller's tenant transaction; the lock is raw `SELECT ... FOR UPDATE` as `freight_app` under RLS, so another tenant's id (or a non-UUID) is 404 before any work. Bulk scan, per-claim transactions and the summary each use `db.tx` (tenant). Role and tenant are re-read from the DB on every request. Audit metadata is allow-listed (counts, cents, ids, `rulesVersion`, booleans). | acceptance AN-X01..X03, P8 guard tenant-independence probe | None known beyond section 4. |
| T52 | Malformed or extreme values produce wrong or unstorable money (negative claims, int4 overflow, float drift) | All arithmetic in a CPython-exact decimal (no floats on money or hours). The engine accepts only `-?[0-9]+(\.[0-9]+)?` decimals and naive `YYYY-MM-DDTHH:MM:SS` datetimes; all regexes are linear. Every persisted finding amount and both totals must be `>= 0` and `<= 2,147,483,647` cents, and so must their sum; otherwise a fixed 422 `analysis_input_invalid` and nothing is written (RD3). Parity with the Python reference on 2,132 cases (builder run). | `py-decimal.test.ts`, `engine.test.ts`, `analysis-units.test.ts`, rules parity suite, acceptance AN-E, AN-P | SA-8 (a 422 claim stays awaiting). Parity is string equality with the Python rules, which says nothing about whether a finding is correct for a real shipment. |

### 9.3 How it works

1. **Service.** `analyzeClaim` (`api/src/claims/analysis.ts`) takes the claim row lock, re-reads the claim,
   and refuses with 409 `invalid_state` unless the claim is `AWAITING_ANALYSIS`, has no packet and has at
   least one linked `ACCEPTED` document. It builds the whole packet in memory first (`buildAnalysisPacket`,
   pure), so a 422 writes nothing. Then it inserts revision 1 and its child rows, updates the claim
   (status, three amounts, `version + 1`) and appends `claim.analyzed`, all in the same transaction. No
   `approvals` row is written.
2. **Triggers (defence in depth).** `claims_status_guard` (`fr_claim_status_guard`, `BEFORE UPDATE OF
   status ON claims`) refuses a change to `AWAITING_ANALYSIS`, and a change away from it unless the new
   status is `PENDING_REVIEW` and a revision 1 with a non-null `created_by_id` exists for the same claim
   and tenant. `evidence_packets_analysis_guard` (`fr_analysis_packet_guard`, `BEFORE INSERT ON
   evidence_packets`) refuses a packet for an `AWAITING_ANALYSIS` claim unless it is revision 1,
   `PENDING_REVIEW` and has an author. Both are `SECURITY DEFINER` (owner = the migration role) with
   `search_path = public, pg_temp`, `EXECUTE` revoked from `PUBLIC`, raise `P0001` with the messages
   `claim_transition_invalid` / `analysis_packet_invalid`, and do not re-validate existing rows. The
   migration adds triggers only; the four earlier migrations are byte-for-byte unchanged (acceptance AN-D08
   pins their hashes).
3. **Errors.** 422 `analysis_input_invalid` ("The extracted values of this claim cannot be analysed
   automatically."), 409 `invalid_state`, 404 `not_found`, 403 `forbidden`, 400 `validation_error`, 429
   `rate_limited` with `Retry-After`. Precedence: origin/CSRF 403 -> 401 -> 429 -> 403 -> 400 -> 404 -> 409
   -> 422. A database guard refusal is 409 in the single route and `skipped` in bulk, never 500.
4. **Bulk budget.** See ARCHITECTURE "Bulk analyze and the `analysis` rate budget". With
   `RATE_LIMIT_ENABLED=false` (refused in production) the limiter is null and nothing extra is charged;
   that is why the acceptance bulk suite (which runs with rate limiting off) does not exercise the budget
   stop.
5. **Audit.** `claim.analyzed` in the same transaction as the writes (so an audit failure rolls the
   analysis back); `claim.bulk_analyzed` once per bulk request, in its own transaction after the
   per-claim transactions. Metadata: counts, cents, ids, `contentHash`, `perspective`, statuses,
   `rulesVersion`, `bulk`; no names, file names, extracted values, letter text or reasons.

### 9.4 Policy defaults (step 5; each can be flipped later)

- **D1.** `claims:analyze` includes ANALYST (who runs imports and commits; analysis creates a draft only).
  Flip: drop ANALYST from the matrix row.
- **D2.** The requester is the revision-1 author; document uploaders and field editors are not claim
  authors (SA-10). Flip: extend the four-eyes author predicate, plus a migration for the trigger.
- **D3.** No analyze-on-commit. The bulk action is the automation, with an explicit human trigger.
- **D4.** Only own-perspective findings are persisted; other-direction findings are only counted.
- **D5.** Zero findings still create revision 1 (zero amounts, "No amount is requested" letter); a
  reviewer rejects it if appropriate.
- **D6.** Negative or over-INT4 results are refused with 422 and the claim is unchanged.
- **D7.** Rule settings are constants (15-minute increments, tolerance 0.01, 90-day window).
- **D8.** The letter date is the UTC date of `generatedAt`; naive timeline times are stored as UTC.
- **D9.** Bulk `limit` 1..25 (default 10), scan cap `min(4 x limit, 100)`, oldest first.
- **D10.** Rate group `analysis`, `RATE_LIMIT_ANALYSIS_MAX` 30 per 10 minutes, charged per bulk candidate
  attempted.

### 9.5 Accepted residuals (step 5)

These are open. Do not read any of them as done. The security review of this run found no Critical, High or
Medium issue; its one Low finding (S5-1, the 25x bulk amplification) was fixed in fix round 1. The items
below are the remaining Low/Info notes, the reviewer's residuals and the planner's observations.

1. **SA-1 (Low; review 9a): skipped and failed bulk candidates consume budget.** One `analysis` token is
   charged per candidate attempted, not per claim analyzed. This is the conservative choice (it never
   allows more than per-analyzed charging), but a run over many stale or failing candidates can spend the
   user's budget without analyzing anything.
2. **SA-2 (Info; S5-2, review 9b): no bulk summary event after an unexpected error.** Any error other than
   404/409/422 ends the bulk request with 500. This includes the limiter itself failing mid-run (for
   example the Redis store unreachable). Analyses already committed keep their `claim.analyzed` events, so
   the chain stays intact, but no `claim.bulk_analyzed` records the partial run. Writing the summary in a
   `finally` would need a new allow-listed key (`aborted`), which changes the audit contract; not done.
3. **SA-3 (Low; review 9c): the dialog does not say the budget stopped the run.** A budget stop returns 200
   with the normal summary. The summary stays true ("n still awaiting analysis"), but the user is not
   told why fewer claims were analyzed. Option: a `stoppedBy` field in the response and a dialog line.
4. **SA-4 (Info; S5-3): `documentIds` capped at 50 in audit metadata.** The metadata sanitizer slices
   arrays to 50 entries, so `claim.analyzed` would list an incomplete source set for a claim with more than
   50 linked accepted documents (not confirmed reachable). The `packet_sources` rows remain complete.
   Option: add `documentCount`, or cap links per claim at commit time.
5. **SA-5 (Info; S5-5): raw invoice line description in stored finding text.** Only the letter applies
   `plain()`. `packet_findings.explanation` and `calculation` contain the raw (ingest-validated,
   single-line, length-capped) invoice line description, because sanitizing it there would break Python
   parity. This is safe in today's consumers (React text nodes, formula-neutralized CSV/XLSX). **Any future
   HTML, Markdown or PDF renderer or export of findings must sanitize these fields.**
6. **SA-6 (Info; S5-6): the amount columns of an `AWAITING_ANALYSIS` claim are not DB-guarded.** The status
   guard fires on `UPDATE OF status` only, so `recoverable_cents`, `pending_review_cents`,
   `amount_claimed_cents` and `version` of an awaiting claim can be changed by SQL as `freight_app` without
   a trigger refusing it. Only `analysis.ts` writes them, so this is not reachable through the API. If
   `claims` gets wider UPDATE use later, extend the guard.
7. **SA-7 (Low; planner): commit-versus-analysis race.** Commit does not lock the claim row. A document
   that a concurrent or later commit links to the claim is linked, but it is not a source of revision 1
   and is not cited. This is the same as the existing "claim already has a packet" behaviour. A reviewer
   who needs it must edit the packet (new revision).
8. **SA-8 (Low; planner): a failed analysis leaves the claim `AWAITING_ANALYSIS`.** A 422 writes nothing.
   Accepted documents cannot be edited, so the claim needs a new import with corrected documents. Until
   then it stays a bulk candidate; because bulk takes the oldest claims first, it is attempted and charged
   on every bulk run (with SA-1), and enough such claims (`4 x limit` or more) can keep a bulk run from
   reaching newer claims.
9. **SA-9 (Low; planner, related to FE-S1): auto-accepted documents feed analysis.** A document with no
   review reasons is accepted at ingest with no human acceptor, and analysis uses it like a reviewed one.
   The analyzed packet still needs a second person to approve it (T47).
10. **SA-10 (Info; S5-4, policy D2): uploaders and field editors are not claim authors.** The uploader or
    a field editor of a claim's documents may approve a claim that someone else analyzed. Document
    four-eyes already required a second person to accept those inputs (except SA-9), so two people are
    still involved. This is a policy choice, not a bypass.
11. **SA-11 (Info; planner A14): four-eyes wording for analyzers.** The analyzer sees the existing text
    "You edited this revision. Another approver must approve it." in `/approvals`, which is loose for an
    analysis. The analyze controls state beforehand that the analyzer becomes the author. The four-eyes
    copy was left unchanged on purpose.

Deferred features (not residual risks): analyze-on-commit, the `rules` evaluation stage, telemetry
`rules-v1`, a Markdown download endpoint, stricter money parsing.

### 9.6 What was run

Local runs on Windows, **not GitHub CI**. The validation of this run is **not complete**.

| Step | Commit | Result |
| --- | --- | --- |
| lint, typecheck, unit (`npm test`), builder | `b12ce2a` | clean; shared 165, api 370, web 78 passed |
| rules parity (`api/test/parity/rules.parity.test.ts`), builder | `b12ce2a` | 2,132 cases, zero differences, Node 22.23.3 and Node 24 |
| migrate (fresh DB, all 5 migrations), seed, seed `--reset`, `ensure-bucket`, build, eval, integration, builder, Node 22.23.3 | `b12ce2a` | all passed; integration 16 files, 107 passed, 3 local-skip placeholders |
| full CI sequence, tester, Node 22.23.3, `CI=true` | `b12ce2a` + tester files | every step exit 0 except acceptance: shared 81/81; api 754 passed, 4 failed, 10 skipped, 2 todo; web not reached |
| acceptance rerun after the 4 test-design fixes | `b12ce2a` + tester files | stopped by low system memory (environment); not re-run |
| fix round 1 (S5-1), builder | `5c047fb` | eslint, api typecheck and targeted unit tests only (14 + 27 passed) |

The 4 acceptance failures (AN-A05, AN-A07, AN-A17, AN-D08) were classified as test design; none was a
product defect, and no expected outcome was loosened (the reviewer confirmed the AN-D08 narrowing against
four mutants). Still open before this can be called verified: the api acceptance rerun, the web acceptance
suite (AN-W01..W11), an acceptance case for the budget stop (AN-B09), the tester's parity counts, and
integration and acceptance runs at `5c047fb`. Not run at all: Node 24 for acceptance, GitHub CI, container
images, the compose stack, Playwright, any AWS deployment.
