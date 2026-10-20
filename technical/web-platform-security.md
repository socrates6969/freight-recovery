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
[section 9](#9-step-5-claim-analysis). Step 6 (charge intelligence: charge-line suggestions, the
`charge_labels` tenant table, review-only learned findings and the seed-set evaluation gate) is covered in
[section 10](#10-step-6-charge-intelligence). Step 7 (the fuel-surcharge check, the global public price
tables and their owner-only importer, and the cost outlook with its backtest gate) is covered in
[section 11](#11-step-7-fuel-check-public-price-data-and-cost-outlook). Step 8 (the ocean demurrage and
detention invoice audit against 46 CFR Part 541 and 545.5, its three tenant tables, the `OCEAN_DD` claim kind and
the four-eyes rule for the invoice's editors) is covered in
[section 12](#12-step-8-ocean-demurrage-and-detention-audit). Claim outcomes (the human-entered, append-only
record of what happened after a demand was marked ready, and the Recovery section) are covered in
[section 14](#14-claim-outcomes). The hardening run (database backstops for four-eyes,
the label-author rule, failure transparency, the CloudFront client address and the authentication fixes of the
platform audit) is covered in [section 13](#13-hardening-run). Every secret, its rotation and
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
| T1 | Password guessing, credential stuffing | argon2id (19 MiB, t=2) with a constant-work dummy verify for unknown or disabled accounts (`security/password.ts`). Lockout is keyed by the normalized-email hash, so unknown emails behave the same way. The lock lasts `min(30 s * 2^(f-5), 900 s)` once there are 5 failures, and locked attempts do not extend it (`auth/lockout-store.ts`). Rate limits: auth 20 per 60 s per client address, forgot-password 5 per 15 min, global 600 per minute (`app.ts`); since the hardening run the client address is the CloudFront viewer address when the origin-verify header matches (section 13), and change-password is in the auth group and counts toward the lockout. | T-AUTH, T-LOCK-01..05, T-RATE-01/02 | Distributed low-and-slow attacks across many IPs are only slowed down. The WAF IP rate rule helps in AWS. |
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
- Step 6 charge intelligence has its own accepted residuals SC-1..SC-11 (section 10.5). Its database-level
  tenant-isolation tests for `charge_labels` are written but have not run yet (section 10.6).
- The hardening run (section 13) narrowed or closed SC-1, SC-2, SC-8, DD-3, DD-6, FE-S2, SA-1..SA-6, SA-8, SA-11,
  FO-1 and FO-10, and fixed platform findings P1-P5. Its own open items are HR-1..HR-13 (section 13.5).
- **F-03 (per-address controls keyed on the CloudFront edge address)** is fixed in code and IaC but
  **unverified in AWS** until the deploy-gate check in `infra/README.md` is recorded (section 13.6).
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

Step 6 (run `REQ-20261011-charge-intelligence`, 2026-10-11, **local runs on Node 22.23.3, not CI;
validation not complete**): builder unit shared 195, api 393 and the web charges, analysis and step 4
files (33) at `43d7d4c`; `npm run eval:charges` with the CI bounds exit 0; shared acceptance (Tier L)
153/153 at `a1b1c2a`. Integration and Tier H acceptance are written, not run. Details in section 10.6.

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
2. **FE-S2 (Low): a status change is not tied to a decision row.** *Narrowed by the hardening run (packets, UPDATE only; section 13.4).* The triggers guard inserts into
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
5. **FE-N1 (Info): a trigger refusal is logged but not audited.** *Unchanged by the hardening run, which adds a third such trigger (section 13.4).* If a service check were bypassed and
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

1. **SA-1 (Low; review 9a): skipped and failed bulk candidates consume budget.** *Narrowed by the hardening run (section 13.4).* One `analysis` token is
   charged per candidate attempted, not per claim analyzed. This is the conservative choice (it never
   allows more than per-analyzed charging), but a run over many stale or failing candidates can spend the
   user's budget without analyzing anything.
2. **SA-2 (Info; S5-2, review 9b): no bulk summary event after an unexpected error.** *Closed by the hardening run (section 13.4).* Any error other than
   404/409/422 ends the bulk request with 500. This includes the limiter itself failing mid-run (for
   example the Redis store unreachable). Analyses already committed keep their `claim.analyzed` events, so
   the chain stays intact, but no `claim.bulk_analyzed` records the partial run. Writing the summary in a
   `finally` would need a new allow-listed key (`aborted`), which changes the audit contract; not done.
3. **SA-3 (Low; review 9c): the dialog does not say the budget stopped the run.** *Closed by the hardening run (section 13.4).* A budget stop returns 200
   with the normal summary. The summary stays true ("n still awaiting analysis"), but the user is not
   told why fewer claims were analyzed. Option: a `stoppedBy` field in the response and a dialog line.
4. **SA-4 (Info; S5-3): `documentIds` capped at 50 in audit metadata.** *Closed by the hardening run (`documentCount`; section 13.4).* The metadata sanitizer slices
   arrays to 50 entries, so `claim.analyzed` would list an incomplete source set for a claim with more than
   50 linked accepted documents (not confirmed reachable). The `packet_sources` rows remain complete.
   Option: add `documentCount`, or cap links per claim at commit time.
5. **SA-5 (Info; S5-5): raw invoice line description in stored finding text.** *Guarded by an architecture test since the hardening run (section 13.4).* Only the letter applies
   `plain()`. `packet_findings.explanation` and `calculation` contain the raw (ingest-validated,
   single-line, length-capped) invoice line description, because sanitizing it there would break Python
   parity. This is safe in today's consumers (React text nodes, formula-neutralized CSV/XLSX). **Any future
   HTML, Markdown or PDF renderer or export of findings must sanitize these fields.**
6. **SA-6 (Info; S5-6): the amount columns of an `AWAITING_ANALYSIS` claim are not DB-guarded.** *Narrowed by the hardening run (CHECK on the amounts; section 13.4).* The status
   guard fires on `UPDATE OF status` only, so `recoverable_cents`, `pending_review_cents`,
   `amount_claimed_cents` and `version` of an awaiting claim can be changed by SQL as `freight_app` without
   a trigger refusing it. Only `analysis.ts` writes them, so this is not reachable through the API. If
   `claims` gets wider UPDATE use later, extend the guard.
7. **SA-7 (Low; planner): commit-versus-analysis race.** Commit does not lock the claim row. A document
   that a concurrent or later commit links to the claim is linked, but it is not a source of revision 1
   and is not cited. This is the same as the existing "claim already has a packet" behaviour. A reviewer
   who needs it must edit the packet (new revision).
8. **SA-8 (Low; planner): a failed analysis leaves the claim `AWAITING_ANALYSIS`.** *Narrowed by the hardening run (section 13.4).* A 422 writes nothing.
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
11. **SA-11 (Info; planner A14): four-eyes wording for analyzers.** *Closed by the hardening run (section 13.4).* The analyzer sees the existing text
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

## 10. Step 6: charge intelligence

Run `REQ-20261011-charge-intelligence` (branch `feat/charge-intelligence`, build commits
`959aa36`..`43d7d4c`, plus `a1b1c2a`, which only exports one more constant) adds a nearest-example charge-line
classifier with an attributed seed of public tariff charge names, a tenant label memory (`charge_labels`),
a review-only learned layer in analysis, a seed-set evaluation gate in CI, a pure tariff detention
calculator (not wired) and a Charges tab on the claim sheet. The structure is in
[ARCHITECTURE.md, charge intelligence](../ARCHITECTURE.md#web-platform-charge-intelligence-step-6). The
user view is in [README, charge suggestions](../README.md#charge-suggestions-and-team-labels-step-6).

**Honesty.** A suggestion is the category of the nearest labelled example when the similarity is at least
0.30. It is not verified and not a probability. Learned findings have a fixed confidence of 0.5 and
always need human review. The CI evaluation runs leave-one-carrier-out on the 256 seed names: it is a
regression check on that seed set, not an accuracy measure on invoices (`CHARGE_EVAL_NOTE`). No trained
model, no LLM call and no network call is involved. The shared and acceptance tests scan the copy for
accuracy wording.

**Data provenance.** The seed (`packages/shared/src/charge-intel/seed-v1.ts` and `seed-v2.ts`) holds 256 charge
names copied from six public carrier rules tariffs (XPO, Estes, Dohrn, Magnum, Gardewine, States Logistics; 175
names, retrieved 2026-10-11), the U.S. GSA Uniform Rules Tariff 200-A and the FedEx Freight accessorial sheet (81
names, retrieved 2026-10-19, archive sha256 and reuse terms recorded in `SEED_V2_PROVENANCE`), with the document,
effective date, URL and retrieval date of each. It holds no rates, tariff text,
customers, shipments, invoices, secrets or e-mail addresses (security review S8: a search found only the
six tariff URLs). Using real public names is an **owner decision** of 2026-10-10/11, recorded in the run
request. It is in tension with the wording of CLAUDE.md hard rule 4 ("synthetic data only"), which was not
changed. A dated exception note is open question **OQ1** for the owner. The URLs still need the owner's
confirmation (OQ2), and the tariffs' reuse terms have not been checked.

### 10.1 New assets, permission and trust boundaries

| Item | Detail |
| --- | --- |
| Permission | `charge_labels:manage`: OWNER, ADMIN, MANAGER, REVIEWER. Not ANALYST, VIEWER, PLATFORM_DEV or SUPER_ADMIN. The two GET routes need `claims:read` (all tenant roles; platform roles 403). **No API-key scope** grants any of the four routes, so any API-key request is 403. |
| Routes | `GET /api/v1/claims/:id/charge-lines`, `GET /api/v1/charge-labels`, `PUT /api/v1/charge-labels`, `DELETE /api/v1/charge-labels/:id`. All use the per-user `intelligence` rate bucket; PUT and DELETE are mutating cookie routes with Origin and CSRF checks. |
| New table | `charge_labels` (tenant-scoped): `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `charge_labels_tenant_isolation` `FOR ALL` `USING`/`WITH CHECK` `tenant_id = fr_current_tenant()`, `REVOKE ALL FROM PUBLIC`. `freight_app`: SELECT, INSERT, DELETE, and UPDATE only of `description`, `category`, `updated_by_id`, `updated_at`, `version` (not `tenant_id`, `normalized_text` or the `created_*` columns). CHECKs on category, normalized-text format and length (1..200), description length (1..200) and `version >= 1`. In `TENANT_MODELS` and `TenantTx`. |
| New writes | label rows; audit `charge_label.set`, `charge_label.deleted`, `intelligence.viewed` (`kind: charge_lines`); extra `claim.analyzed` keys; LRN findings and review flags in packet revision 1. |
| Untrusted input | Label descriptions (strict Zod: trimmed, 1..200 characters, no control or bidi characters, non-empty normalized text) and invoice line descriptions from accepted documents (ingest-validated, single line). |
| Database | Migration `20261013000000_charge_intelligence`: the table, its security part and the flag row `intelligence.charge_suggestions` (enabled). Earlier migrations unchanged. |
| Kill switch | Platform flag `intelligence.charge_suggestions` (default on). Off: exact step 5 analysis and 404 on the four routes. |
| Configuration | No new environment variable. |

### 10.2 Threats and mitigations (step 6)

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T53 | Label poisoning: a user with `charge_labels:manage` labels a wording so that later analyses add misleading review items, or so that detention money is not claimed | Labels can only influence lines the keyword rules call `other`; they never change a step 5 rule output. LRN findings always need human review, count only in the pending total and never appear in the draft letter. A detention look-alike never creates money: it only moves `DET-UNBILLED`/`DET-UNDERBILLED` to review. Approving a packet with pending findings still needs `acknowledgePendingFindings`, and four-eyes is unchanged. RBAC limits labelling to four roles, with no API keys. Every change is audited (`charge_label.set`/`deleted` with `labelId`, category and, since fix round 1 (S4), `normalizedTextSha256`). Since fix round 1 (S3), `claim.analyzed` records `learnedLabelIds` (up to 50 influencing label ids), so a label that moved money to review stays attributable after it is deleted. Labels can be deleted; the cap and the kill switch limit the blast radius. | `learned.test.ts`, `analysis-learned.test.ts`, `charge-labels-units.test.ts`; acceptance CI-L01..L13 (Tier L; 153/153 shared acceptance at `a1b1c2a`); CI-A13..A19, CI-U01..U05 (Tier H, not run) | SC-1 |
| T54 | CPU exhaustion of the shared event loop through many long labels and invoices with many distinct `other` lines (security finding S1, Medium) | **Fixed in fix round 1:** a 200-character cap on the normalized query text; an inverted index instead of a full scan, proven equal to the scan by a randomized test (3,000 queries) and by the tester's oracle (2,000 queries); suggestions memoized per text (at most 1,000 per classifier); one classifier per request (bulk analysis builds it once per bulk request). Labels are capped at 2,000 per tenant. All routes use the `intelligence` rate bucket, analysis its `analysis` bucket. Measured at the caps (2,000 labels, 250 distinct 4,000-character lines, Node 22): **about 0.47 s** with the index against **about 5.5 s** with the full scan (the security review's pre-fix benchmark: 7.3 to 8.6 s on Node 24). | `classifier-index.test.ts` (index equals scan, cost test at the caps with a 20 s bound); acceptance CI-S24/S25 (Tier L, passed at `a1b1c2a`; CI-S25 measured 808 ms against its 20 s bound) | SC-2 |
| T55 | The label cap is exceeded by concurrent PUTs (security finding S2, Low), which would undo the bound T54 relies on | **Fixed in fix round 1:** PUT and DELETE first take a transaction-scoped advisory lock on `charge-labels:<tenantId>` (`api/src/db/charge-label-locks.ts`), so count and insert of one tenant cannot interleave. Updates of an existing label are always allowed. | `charge-labels-units.test.ts` (lock taken); acceptance CI-A20 (Tier H, not run) | No database-side cap (a trigger was not added). |
| T56 | Cross-tenant influence or disclosure through labels | RLS `FORCE` plus the tenant policy on `charge_labels`; every query in `db.tx`; the classifier is built per request from the tenant's own rows (the only shared cache is the static seed features); another tenant's label or claim id is a 404 byte-identical to an unknown id; audit metadata is allow-listed and never contains the description or normalized text. | `tenant-scope.test.ts` (unit); `charge-labels.int.test.ts` and acceptance CI-X01, CI-D01..D04 (**written, not run**) | Until the integration and Tier H runs happen, the database-level isolation of this table is checked by code review and unit tests only. |
| T57 | Untrusted text: label descriptions and invoice line descriptions shown in the UI and stored in findings | Strict Zod on the label body (length, control and bidi characters refused, non-empty normalized text); the web renders all of it as React text (`SafeText`), shows fixed error texts and disables the label controls for descriptions the server would refuse (fix round 1, S7). The nearest example text in finding text goes through `plain(..., 200)`. The CSP is unchanged. | `web/test/charges.test.tsx` (hostile strings rendered as text, fixed errors, S7); acceptance CI-W01..W08 (Tier H, not run) | SC-7 (raw invoice description in LRN text, as SA-5) |

### 10.3 How it works

1. **Classifier.** Character 3-, 4- and 5-grams plus word tokens (weight 2), cosine similarity decided with
   exact integer arithmetic, nearest single example, ties to the earlier example (team labels before the
   seed), threshold 0.30 (`100 * dot^2 >= 9 * |q|^2 * |e|^2`). Details in ARCHITECTURE.
2. **Learned layer.** Only unique, keyword-`other` lines with an amount above zero. `LRN-ACCESSORIAL-REVIEW`
   needs a rate confirmation, a non-authorized line and an amount that differs from the contracted linehaul
   and fuel amounts (the contracted-amount guard). A detention look-alike flags `DET-UNBILLED`/
   `DET-UNDERBILLED` for review. With the flag off, or when nothing applies, the stored packet is exactly
   the step 5 packet.
3. **Labels.** Keyed per tenant by normalized text; PUT creates, changes or leaves unchanged; DELETE
   removes. Writes are serialized per tenant (T55). The cap is checked in the service.
4. **Errors.** 409 `label_limit_reached`; otherwise as before. Precedence for the four routes: origin/CSRF
   403 -> 401 -> 429 -> 403 -> 400 -> 404 (flag off, unknown, non-UUID or other-tenant id) -> 409.
5. **Flag.** Read once per request before the transaction. A read error counts as off for at most 1 s
   (accepted deviation S6).

### 10.4 Policy defaults (step 6; each can be flipped later)

- **D1.** Threshold 0.30 exactly, chosen from the seed's leave-one-carrier-out distribution.
- **D6.** `charge_labels:manage` for OWNER, ADMIN, MANAGER, REVIEWER; not ANALYST, because a label changes
  later analyses for the whole tenant.
- **D7.** 2,000 labels per tenant.
- **D8.** The kill switch is on by default.
- **D9.** Tariff rounding `down` when a tariff does not say "or fraction thereof".

D1, D6 and D7 await the owner's confirmation (OQ3). The full list D1-D10 is in ARCHITECTURE.

### 10.5 Accepted residuals (step 6)

These are open. The security review of `51ea826..3a8125d` found no Critical or High issue. Its Medium
finding S1 and the Low/Info findings S2, S3, S4 and S7 were fixed in `43d7d4c`; S5 and S6 were accepted.

1. **SC-1 (Low; S3 residual): a labeller can move detention money to review.** *Narrowed by the hardening run (label authors cannot approve; section 13.4).* Any user with
   `charge_labels:manage` (REVIEWER and above) can label a wording as detention. Every later analysis of a
   claim with a keyword-`other` line whose nearest example is that label then switches all `DET-UNBILLED`
   and `DET-UNDERBILLED` findings to needs-human-review: their amounts leave the recoverable total and the
   draft letter until a reviewer confirms them. The labeller may also be the approver. Labels never create
   confirmed money and never bypass four-eyes, and since fix round 1 the influence is attributable
   (`learnedLabelIds` in `claim.analyzed`, `normalizedTextSha256` in the label events).
2. **SC-2 (Low; S1 residual): classification is still synchronous.** *Narrowed by the hardening run (section 13.4).* At the caps it costs about 0.47 s of
   CPU per request on the shared event loop (Node 22 measurement), and the charge-lines view classifies
   every line inside an open tenant transaction. A per-request time or line budget was suggested by the
   review and not built.
3. **SC-3 (Low; planner): generic linehaul wordings look like accessorials.** The seed has no generic
   linehaul wording, so "Freight charges" is nearest to "HEAVY LIFT CHARGES" (similarity 0.445). Only the
   contracted-amount guard and human review prevent a misleading LRN finding until the team labels the
   wording.
4. **SC-4 (Info; planner): seed coverage.** The seed is LTL tariff vocabulary: 159 accessorial, 12
   detention, 3 fuel and 1 linehaul name. Truckload and invoice-specific wordings are not represented.
5. **SC-5 (Info; planner): the evaluation is optimistic.** 14 normalized names appear at more than one
   carrier, which helps leave-one-carrier-out. The distinct-name variant (accessorial recognised 141 rather
   than 145 of 159) is reported too. Neither number says anything about invoices.
6. **SC-6 (Info; planner): label scope.** Labels are tenant-wide (not per carrier or customer) and keyed by
   exact normalized text; keyword rules still win over a label.
7. **SC-7 (Info; planner): raw description in LRN text.** LRN finding explanations and calculations
   contain the raw invoice line description, as step 5 findings do (SA-5). Any future HTML, Markdown or PDF
   renderer of findings must sanitize them.
8. **SC-8 (Info; S5, accepted): retry conflict gives 500.** *Closed by the hardening run (409; section 13.4).* A second unique-key violation on a label PUT
   (only on delete-and-recreate races) becomes 500 `internal_error` with a generic message; a 409 would be
   friendlier.
9. **SC-9 (Info; S6, accepted): a flag read error means off.** The spec asked for a 500; the existing
   `FlagService` returns off, cached for at most 1 s. Off is exact step 5 behaviour and 404 on the routes,
   and authentication, permission and validation run before the flag check, so there is no bypass.
10. **SC-10 (Info; S8): real public data.** The seed contains real carrier names and tariff URLs under the
    owner decision above (OQ1, OQ2); the tariffs' reuse terms are unchecked.
11. **SC-11 (Info): no database-level cap.** The 2,000-label cap is enforced by the service under the
    advisory lock (T55), not by a trigger.

Deferred features (not residual risks): extraction of tariff detention terms and their use in analysis,
detention without power, weight-based free time, embeddings, learned effects on linehaul and fuel rules, a
classifier telemetry component, label import and export.

### 10.6 What was run

Local runs on Windows, Node 22.23.3, **not GitHub CI**. Low-memory mode; the validation is **not complete**.

| Step | Commit | Result |
| --- | --- | --- |
| lint, typecheck (shared, api, web), builder | `3a8125d`, `43d7d4c` | clean |
| unit tests, builder (`--maxWorkers=1`) | `3a8125d` | shared 190, api 392, web all 11 files passed |
| unit tests, builder | `43d7d4c` | shared 195 (incl. `classifier-index.test.ts`), api 393, web charges + analysis + step 4 (33) passed |
| `npm run eval:charges` with the CI bounds | `3a8125d`, `43d7d4c` | exit 0, numbers unchanged; a deliberately failing bound gave exit 1 |
| `prisma generate`; `prisma migrate diff` (no database) | `5baaeec` | DDL generated; the drift check against a shadow database was not run |
| Tier L acceptance (pure shared), tester, fresh `dist` | `3a8125d` | 73/73; full shared acceptance 148/148 |
| security review (read-only, one CPU benchmark on Node 24) | `3a8125d` | no Critical/High; S1 Medium; S2-S4 Low; S5-S8 Info |
| fix round 1 (S1-S4, S7), builder | `43d7d4c` | lint, typecheck, unit tests as above; cost at the caps about 0.47 s (index) vs about 5.5 s (scan) |
| Tier L with the fix-round-1 cases (CI-S24, S25, L13), tester | `43d7d4c` | 77/78; CI-S25 808 ms (bound 20 s); 1 defect D1 (root export of `LEARNED_LABEL_IDS_MAX` missing) |
| fix round 2 (D1), builder; Tier L re-run, tester | `a1b1c2a` | shared unit 196; full shared acceptance 153/153 |

**Written but not run** (waiting for the owner's go-ahead, OQ4): `api/test/integration/charge-labels.int.test.ts`
(RLS and FORCE, policy, grants, cross-tenant refusal as `freight_app`, CHECKs, unique key, flag row, routes,
RBAC, cap, audit key sets) and the additive pin updates in four integration files; Tier H acceptance (API,
database, cross-tenant, RBAC, audit, flag, CLI, web), including the Tier H cases added after fix round 1;
the parity suites; `verify-ci-locally`. Not run at all: GitHub CI, container images, the compose stack,
Playwright, any AWS deployment.

## 11. Step 7: fuel check, public price data and cost outlook

Run `REQ-20261011-fuel-outlook` (branch `feat/fuel-outlook`, build commits `a164f56`..`cbb340f`, fix round 1
`1a95245`) adds tenant fuel-surcharge (FSC) tables and per-claim fuel inputs, a review-only
`FSC-INDEX-MISMATCH` finding in analysis, two **global** append-only price tables fed by an owner-only
command-line importer, a cost outlook route with a backtest gate in CI, and three web screens. The structure
is in [ARCHITECTURE.md, step 7](../ARCHITECTURE.md#web-platform-fuel-check-public-price-data-and-cost-outlook-step-7).
The user view is in [README, fuel check and cost outlook](../README.md#fuel-check-and-cost-outlook-step-7).

**Honesty.** The FSC finding is a recomputation from a table, miles and a ship date that people enter; it
always needs human review (fixed confidence 0.7, not a probability) and never enters the recoverable total
or the draft letter. The outlook is backtested on public data (diesel 2011-2026, PPI 2009-2026); it is not a
guarantee, and each 80% range shows its measured backtest coverage. The CI step is a regression check of the
forecast and range rules on bundled history, not an accuracy measure. The shared acceptance tests scan the
copy and the data README for accuracy, prediction and guarantee wording.

**Data provenance.** `api/data/public-prices/` holds two public U.S. government series downloaded from FRED
on 2026-10-11: EIA weekly diesel (`GASDESW`) and the BLS long-distance truckload PPI (`PCU4841214841212`),
pinned by sha256 in `manifest.json`. Both FRED series pages show "Public Domain: Citation Requested"
(re-checked by scriber on 2026-10-11). No customer, carrier or shipment data. Committing real public data is
an **owner decision** recorded in the run request and is in tension with the wording of CLAUDE.md hard rule
4 ("synthetic data only"), which was not changed; a dated exception note is open question **OQ1**.

### 11.1 New assets, permission and trust boundaries

| Item | Detail |
| --- | --- |
| Permissions | No new permission. Fuel tables: write `settings:manage` (OWNER, ADMIN), read `claims:read`. Fuel inputs: write `claims:analyze` (OWNER, ADMIN, MANAGER, REVIEWER, ANALYST), read `claims:read`. Outlook: `claims:read`. Platform roles 403. **No API-key scope** grants any of the 8 new routes, so any API-key request is 403. |
| Routes | `GET/POST /api/v1/fuel-tables`, `PUT/DELETE /api/v1/fuel-tables/:id`, `GET /api/v1/claims/:id/fuel-check`, `PUT/DELETE /api/v1/claims/:id/fuel-inputs`, `GET /api/v1/outlook`. All use the per-user `intelligence` rate bucket; the mutating ones go through the Origin and CSRF checks. Each checks its flag after auth, permission and schema. |
| New tenant tables | `fsc_tables`, `claim_fuel_inputs`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, a `FOR ALL` policy `USING`/`WITH CHECK` `tenant_id = fr_current_tenant()`, `REVOKE ALL FROM PUBLIC`, column-limited UPDATE grants that exclude `tenant_id` and `created_by_id`, no DELETE on `fsc_tables`. Composite FKs `(claim_id, tenant_id)` and `(fsc_table_id, tenant_id)` stop cross-tenant references in the database. Both are in `TENANT_MODELS` and `TenantTx`. |
| New global tables | `price_imports`, `price_observations`: no tenant column. `ENABLE` + `FORCE` RLS with a SELECT policy and an INSERT policy that requires `fr_system_mode()`. `freight_app` has **SELECT only**. `fr_append_only()` triggers refuse UPDATE, DELETE and TRUNCATE for every role. CHECKs pin `source_url` to the two FRED URLs, `sha256` to 64 hex characters and `row_count` to 1..5000. |
| New writes | fuel tables and inputs (tenant); audit `fsc_table.created/updated/archived` (with `paramsSha256`), `claim.fuel_inputs_set/cleared`, `intelligence.viewed` (`kind: fuel_check`), fuel keys in `claim.analyzed`; FSC findings in packet revision 1; platform audit `price_data.imported` (with `revisedValues`) |
| Untrusted input | Table names (strict Zod: single line, 1..80, no control or bidi characters), table params (regex formats plus exact decimal comparisons, at most 200 rows, at most 16 KB in the database), ship date and miles (bounded), price CSV files (operator-supplied or fetched; strict parser), invoice line descriptions (ingest-validated, as before). |
| Outbound network | Only `npm run prices:import -- --series <key> --fetch` (CLI) to the pinned FRED URL. No route, store or analysis path makes an outbound request. |
| Database | Migration `20261014000000_fuel_outlook`: the four tables, their security part and the flag rows `intelligence.cost_outlook` and `intelligence.fuel_check` (both enabled). Earlier migrations unchanged. |
| Kill switches | `intelligence.fuel_check` (off: 404 on the seven fuel routes, analysis exactly step 6) and `intelligence.cost_outlook` (off: 404 on the outlook). A flag read error counts as off. |
| Configuration | `PRICE_CACHE_TTL_MS` (default 60000, 0..3600000). The importer uses only `MIGRATE_DATABASE_URL` and never prints it. The API image contains `api/data` (4 public files). |

### 11.2 Threats and mitigations (step 7)

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T58 | Price poisoning: someone changes the diesel or PPI history, which every tenant's FSC check and outlook uses | Only the owner connection can write (`freight_app` SELECT only; INSERT policy needs system mode); no API route writes prices; append-only triggers for every role; the source URL is pinned by a CHECK; every import stores sha256, source kind, retrieved-at and row count and writes `price_data.imported` on the platform chain in the same transaction; a shrinking range is refused (`would_remove_history`); since fix round 1 (L1) a re-import that changes values of already covered dates is refused (`revisions_refused`, the count printed) unless `--accept-revisions` is given, and `revisedValues` is audited; the bundled files are checked against the manifest sha256 | `fuel-outlook-units.test.ts` (importer outcomes with a fake DB, including `revisions_refused`); acceptance CI-P01..P05, CI-D04 file part, CI-I06 (Tier L, passed at `cbb340f`); `fuel-outlook.int.test.ts` grants, append-only and L1 refusal, acceptance CI-I01..I05, CI-D01..D03 (**written, not run**) | FO-1, FO-2 |
| T59 | Hostile or malformed CSV (size, encoding, ReDoS, absurd values) | `parsePriceCsv` checks the size (1 MiB) before anything else, refuses a BOM, allows only LF, CR and printable ASCII, uses anchored regexes without nested quantifiers, checks real dates, frequency and gaps, exact decimal bounds per series, at most 5,000 rows (counted before parsing). `--file` refuses symlinks and non-regular files. All input is validated before the database is opened | `outlook.test.ts`; acceptance CI-C01..C04 (1 MB adversarial input under 1 s; Tier L, passed) | None known |
| T60 | Outbound requests from the server (SSRF, data exfiltration, a hijacked redirect) | `fetch(` exists only in `prices-cli.ts` (architecture test; no route, store or analysis module imports it); the URL comes from the frozen registry, `redirect: 'error'`, default TLS verification, a 20 s timeout covering the body, a 1 MiB streaming cap, status 200 required; the downloaded bytes go through the same parser and import rules | acceptance CI-I06 (Tier L, passed); CI-I05 (Tier H, not run) | FO-3 |
| T61 | CPU exhaustion through the outlook or the FSC evaluation | The outlook is computed from the active import only, memoized per import id (at most 2 per series) and never from request data; both series take about 25-30 ms. `evaluateFscTable` uses BigInt arithmetic without step loops; rows are capped at 200 and params at 16 KB; extreme but valid params produce a 422 in analysis, not a 500 or a loop. All routes use the `intelligence` bucket | acceptance CI-O05 (24.6 ms, bound 2 s); CI-W04 (2,000 pairs vs a BigInt oracle) | FO-8 (I4), FO-9 (I3) |
| T62 | Money manipulation through fuel inputs or tables (wrong miles, a convenient table, a late edit) | The FSC finding is always `needs_human_review`, counts only in the pending total and never in the draft letter or `recoverableCents`; approval with pending findings still needs `acknowledgePendingFindings`; four-eyes is unchanged. Inputs can change only while the claim is `AWAITING_ANALYSIS`, under the claim row lock. Tables need `settings:manage`, are versioned, and are archived rather than deleted. Every change is audited; since fix round 1 (L2) `paramsSha256` is in the three table events, the packet summary and `claim.analyzed`, so the exact parameters behind a finding stay traceable after an edit. A fixed contract FSC skips the check (no double counting with step 5) | `fuel.test.ts`, `fuel-outlook-units.test.ts`; acceptance CI-F01..F12 (Tier L, passed); CI-A01..A17 (Tier H, not run) | FO-5, FO-6 |
| T63 | Cross-tenant disclosure or influence through fuel tables, inputs or the outlook cache | RLS FORCE and tenant policies on both tenant tables; every query in the tenant transaction; composite FKs; another tenant's id is a 404 byte-identical to an unknown id (also for `?fscTableId` on the outlook, read in a tenant transaction). The `PriceStore` cache holds only public data keyed by series and import id; the tenant table overlay (S2) is computed per request and never cached. Audit metadata is allow-listed (no table names, no invoice text) | `tenant-scope.test.ts` (unit); `fuel-outlook.int.test.ts` cross-tenant cases and acceptance CI-X01..X03 (**written, not run**) | FO-4 |
| T64 | API keys or platform roles reaching the new routes | No route declares `apiKeyScope`, so `api-key-auth.ts` denies keys with 403; platform roles hold no tenant permission. Fix round 1 (I1) added an integration case: a key with every scope gets 403 on all 8 routes | route-registration unit test; `fuel-outlook.int.test.ts` I1 case (**written, not run**) | None known |
| T65 | Overclaiming: users read the outlook or the FSC finding as certain | Fixed copy: `OUTLOOK_NOTE`, "Backtested on public data <from>-<to>; not a guarantee.", method and reason labels, `rangeText` with the measured coverage, "for review" titles; horizons without a significant edge show "no change"; the CI gate fails if a required model stops beating "no change" or if any coverage leaves 70-90% | acceptance CI-K02/K03 (honesty scan; Tier L, passed); CI-E01..E06 (gate CLI; passed) | FO-7 |

### 11.3 How it works

1. **Week rule.** The Monday diesel posting applies from `Monday + effectiveOffsetDays` for 7 days (default 2,
   Wednesday to Tuesday, the GSA rule). No posting, or a ship date past the window, gives
   `price_unavailable`, never a guess.
2. **FSC check.** Exact decimal recomputation (step, mpg or rows tables; per mile or percent of linehaul),
   compared with the billed fuel lines; above the tolerance one review-only finding citing the price week,
   the table line, the file sha256 and every arithmetic step; a wrong-week probe (-1, -2, -3, +1 weeks).
3. **Price store.** One active import per series (newest); data read only from it; the runtime reads only.
   Imports go through the owner-connection CLI in one transaction per series under an advisory lock, with
   the outcomes `unchanged`, `would_remove_history`, `revisions_refused` or `imported`.
4. **Outlook.** AR(2), the naive/AR(2) average or "no change" per horizon; a model is used only with at least
   100 walk-forward origins, `maeRatio < 1` and DM >= 1.96, otherwise "no change" automatically;
   volatility-scaled empirical 80% ranges.
5. **Errors.** New 409 `fuel_table_limit_reached`, 422 `fuel_table_unavailable`, 422 `miles_required`; 503
   `service_unavailable` when the price store cannot be read. Precedence: origin/CSRF 403 -> 401 -> 429 ->
   403 -> 400 -> 404 -> 409 -> 422.

### 11.4 Policy defaults (step 7; each can be flipped later)

- **D1.** Ship date and miles are entered per claim, only while `AWAITING_ANALYSIS`.
- **D2.** Week rule per table, default Wednesday to Tuesday.
- **D5.** One review-only finding, confidence 0.7, tolerance = the analysis tolerance.
- **D8.** Gate: >= 100 origins, maeRatio < 1, DM >= 1.96.
- **D10.** Only the owner connection writes prices; append-only; shrinking refused; revisions need
  `--accept-revisions`.
- **D11.** Tables `settings:manage`, inputs `claims:analyze`, reads `claims:read`, no API keys.
- **D12.** Both flags on by default.

D1, D2, D5, D8, D11 and D12 await the owner's confirmation (OQ2). The importer needing the owner database URL
in production is OQ3. The full list D1-D13 is in ARCHITECTURE.

### 11.5 Accepted residuals (step 7)

These are open. The security review of `5f7eb7e..cbb340f` found no Critical, High or Medium issue. L1, L2 and
I1 were fixed in `1a95245`; I2, I3 and I4 were accepted.

1. **FO-1 (Low; L1 residual): `--file` provenance is asserted by the operator.** *Narrowed by the hardening run (source kind shown; section 13.4).* In `--file` mode the import
   records the pinned FRED URL as `source_url`, but the bytes did not necessarily come from it. The row
   stores `source_kind = 'file'`, and `--list` and the audit event show it; the Outlook page and the FSC
   finding show the citation, retrieval date and sha256 but not the source kind. The operator holds the
   owner database credentials and is trusted.
2. **FO-2 (Low): revisions accepted by flag.** With `--accept-revisions`, revised history (for example
   preliminary PPI months) becomes active. Old imports stay, the count is audited, and packets keep the
   import id they used, but there is no second-person approval of a price revision.
3. **FO-3 (Info): trust in FRED.** `--fetch` trusts FRED's TLS endpoint and content; nothing compares a
   fetched file with an independent source. The parser bounds and the revision refusal limit what a bad file
   can do.
4. **FO-4 (Info): database isolation not yet run.** RLS, grants, append-only triggers and the cross-tenant
   refusals of the four new tables are checked by code review and unit tests; the integration and Tier H
   tests that exercise them in PostgreSQL are written but not run (OQ4).
5. **FO-5 (Info): manual miles and ship date.** Both are typed by a user with `claims:analyze`; nothing
   checks them against documents yet. A wrong value produces a wrong review item, never confirmed money.
6. **FO-6 (Info): national average only.** The check uses the U.S. national average diesel price. Tables
   indexed to a PADD region or another index will disagree; regional prices are deferred (OQ5).
7. **FO-7 (Info): model selection and the gate use the same history.** The horizons and candidate models were
   chosen on the same public history the CI gate replays, so the gate is a regression check, not an
   independent out-of-sample confirmation. A future edge decay shows up only as new data is imported.
8. **FO-8 (Info; I4, accepted): synchronous first computation.** The first outlook request after a new import
   computes on the event loop (about 30 ms today); re-check if series or horizons grow.
9. **FO-9 (Info; I3, accepted): extreme table parameters.** Valid but extreme params (step size 0.0001, a
   percent rate of 100 per step) give very large rates; analysis of a claim using such a table returns 422
   `analysis_input_invalid` (handled, no 500).
10. **FO-10 (Info; I2, accepted): the cap counts archived tables.** *Narrowed by the hardening run (copy; section 13.4).* Archived tables are never deleted, so a
    tenant can create at most 50 tables in total. Only `settings:manage` can reach that ceiling.
11. **FO-11 (Info): preliminary data.** The latest PPI months are preliminary; the outlook and the gate follow
    whatever import is active.
12. **FO-12 (Info): real public data in the repository.** The bundled series are real government data under
    the owner decision above (OQ1); the NOTICE file does not yet carry the EIA and BLS attribution (the data
    README does).

Deferred features (not residual risks): PADD prices, deep-sea and lane-rate forecasts, scheduled imports, a
platform upload route, miles and date extraction, re-checking analysed packets, non-USD FSC, Canadian prices,
alerts, a version-history table for fuel tables, showing the source kind in the UI.

### 11.6 What was run

Local runs on Windows, Node 22.23.3, **not GitHub CI**. Low-memory mode; the validation is **not complete**.

| Step | Commit | Result |
| --- | --- | --- |
| lint, typecheck (repo-wide, acceptance files included), builder | `cbb340f`, `1a95245` | clean |
| targeted unit tests, builder (`--maxWorkers=1`) | `cbb340f` | shared fuel and outlook, api eval CLI, fuel-outlook units and touched pins, web fuel/outlook/charges/analysis/ui (35) passed |
| `prisma generate`; `prisma migrate diff` from the `5f7eb7e` schema (no database) | `8ce71b8` | DDL generated; the drift check against a shadow database was not run |
| `eval:outlook` `main()` with the CI bounds | `cbb340f`, `1a95245` | exit 0; tampered data, bad manifest, escaping path, missing dir exit 2; tight bounds exit 1 |
| Tier L acceptance, tester, first run | builder work in progress (before `d87db5e`) | shared 241/263; all 22 failures one product defect D1 (`checkFuel` return shape) |
| Tier L acceptance, tester, re-run | `cbb340f` | shared **263/263** (17 files), api **13/13**; eslint exit 0; tsc 0 errors |
| security review (static) | `5f7eb7e..cbb340f` | no Critical/High/Medium; L1, L2 Low; I1-I4 Info |
| fix round 1 (L1, L2, I1), builder | `1a95245` | lint, typecheck clean; 52 api unit tests passed; `eval:outlook` exit 0 |

**Written but not run** (waiting for the owner's go-ahead, OQ4): `api/test/integration/fuel-outlook.int.test.ts`
(RLS and FORCE, policies, grants and column grants, cross-tenant refusal as `freight_app`, composite FKs,
CHECKs, SELECT-only and append-only price tables, the pinned-URL CHECK, importer end-to-end including the L1
refusal, routes, RBAC including the I1 API-key case, audit key sets, the cap race, flags) and the additive
pins in three integration files; Tier H acceptance (API, database, importer, web); `npm run build` and the
built `eval:outlook`; the parity suites; `verify-ci-locally`. The tester's Tier L run predates fix round 1.
Not run at all: GitHub CI, container images, the compose stack, Playwright, any AWS deployment.

## 12. Step 8: ocean demurrage and detention audit

Run `REQ-20261011-ocean-dd` (branch `feat/ocean-dd` from `ce107d0`, build commits `7419c32`..`afadac3`, fix round 1
`1ca8eb5`, fix round 2 `22e4a73`, fix round 3 `10f8941`) adds a deterministic audit of US ocean demurrage and detention (D&D) invoices against 46 CFR Part 541,
46 CFR 545.5 and a tenant-attached tariff: three tenant tables, a claim kind `OCEAN_DD`, 12 routes under
`/api/v1/dd`, an audit run that creates a claim with evidence packet revision 1, and an Ocean D&D web page. The
structure is in [ARCHITECTURE.md, step 8](../ARCHITECTURE.md#web-platform-ocean-demurrage-and-detention-audit-step-8).
The user view is in [README, ocean demurrage and detention audit](../README.md#ocean-demurrage-and-detention-audit-step-8).

**Not legal advice; legal risk is a product risk here.** The findings are candidates computed from data a user
enters. Whether an invoice is in fact not payable under 46 CFR 541.5 or 541.7, or a charge unreasonable under
545.5, is a legal judgment. Every regulatory finding is review-only and worded "may not be payable under 46 CFR
541.x - review" (or "likely to be found unreasonable ... - review"); the packet carries `DD_PACKET_DISCLAIMER`
("Not legal advice. ... have counsel review them before relying on them."), the letter starts with "DRAFT - FOR
HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.", and every claim goes through four-eyes approval. No accuracy,
compliance or recovery figure appears in the product.

**Legal source notes.** The regulation text (`DD_REGULATION_TEXT`, version `ecfr-2026-10-07`) was checked verbatim
against the eCFR, title 46 up to date as of 2026-10-07: 541.5, 541.6(a)-(e), 541.7(a) and (b) (the NVOCC
variant), 541.8(a) and (b), and 545.5(c)(2)(i) and (ii). Part 541 has been in force since 2024-05-28. **46 CFR
541.4** ("properly issued invoices", who may be billed) was set aside by the D.C. Circuit on 2025-09-23 (World
Shipping Council v. FMC, 152 F.4th 215) and removed effective 2025-12-29 (FR Doc. 2025-23920); the product
therefore has **no billed-party check**.

**Data provenance.** Invoices in tests and fixtures are synthetic. The four tariff presets hold published public
tariff figures (Maersk, MSC, Hapag-Lloyd, CMA CGM; retrieved 2026-10-11) with URL, retrieval date, sha256 where a
PDF was downloaded, verification level and assumptions: MSC and Hapag-Lloyd **primary** (PDF hashes recorded),
Maersk **primary via a search-engine extract** (direct download failed, no hash), CMA CGM **secondary only** (a
trade publication). No customer, carrier-account or shipment data. Committing public tariff figures sits next to
CLAUDE.md hard rule 4 ("synthetic data only"), which was not changed; a dated exception is open question **OQ2**.

### 12.1 New assets, permission and trust boundaries

| Item | Detail |
| --- | --- |
| Permissions | New `dd_invoices:manage` (OWNER, ADMIN, MANAGER, REVIEWER, ANALYST) and `dd_tariffs:manage` (OWNER, ADMIN, MANAGER, REVIEWER). Reads need `claims:read`; the audit run needs `claims:analyze`. VIEWER reads only; PLATFORM_DEV and SUPER_ADMIN have neither. **No API-key scope** grants any D&D route, so API keys get 403. |
| Routes | `GET/POST /api/v1/dd/tariffs`, `PUT /api/v1/dd/tariffs/:id`, the same for `calendars`, `GET/POST /api/v1/dd/invoices`, `GET/PUT/DELETE /api/v1/dd/invoices/:id`, `POST /api/v1/dd/invoices/:id/audit`. All use the per-user `intelligence` bucket except the audit run (`analysis`); mutating routes go through the Origin and CSRF checks; the flag is checked after auth, rate limit, permission and schema. |
| New tenant tables | `dd_tariffs`, `dd_calendars`, `dd_invoices`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, one `FOR ALL` policy `<table>_tenant_isolation` (`USING`/`WITH CHECK tenant_id = fr_current_tenant()`), `REVOKE ALL FROM PUBLIC`; `freight_app` gets SELECT, INSERT and column-limited UPDATE (never `id`, `tenant_id`, `created_by_id`, `created_at`), DELETE only on `dd_invoices`, never TRUNCATE. Composite FKs `(tariff_id, tenant_id)`, `(calendar_id, tenant_id)`, `(claim_id, tenant_id)` with `ON DELETE RESTRICT`. CHECKs on enums, text lengths, `jsonb` object type and size (64 KiB tariffs and calendars, 256 KiB invoices), non-negative totals, positive versions and DRAFT/AUDITED consistency. In `TENANT_MODELS` and `TenantTx`. |
| Triggers | `claims_kind_guard`: `claims.kind` (`FREIGHT` or `OCEAN_DD`) can never change, for every role. `dd_invoices_guard`: inserts must be DRAFT; an AUDITED invoice cannot be updated or deleted by any role; AUDITED requires an `OCEAN_DD` claim of the same tenant (the function is SECURITY DEFINER and matches the tenant explicitly). |
| New writes | tariffs, calendars, invoices (tenant); on audit one new claim of kind `OCEAN_DD`, packet revision 1 with sources, findings, timeline and letter, the invoice set to AUDITED with a frozen snapshot; audit events `dd_tariff.created/updated`, `dd_calendar.created/updated`, `dd_invoice.created/updated/deleted/audited` (ids, versions, counts, sha256 values and cents only; no names, numbers or invoice text). |
| Untrusted input | every invoice, tariff and calendar field (strict Zod schemas: single-line text without control or bidi characters and with length caps, regex money and size-type formats, civil dates 2000-2099, bounded integers, caps on containers, periods, tiers, sizes and dates, https-only `sourceUrl` that is never fetched); CSV files, parsed only in the browser. |
| Outbound network | None. No D&D path fetches anything; preset and tariff URLs are displayed only. |
| Database | Migration `20261016000000_ocean_dd` (the column, enum, three tables, security part, flag row). Earlier migrations unchanged. |
| Kill switch | `intelligence.ocean_dd` (on by default). Off: all D&D routes 404 and the page is hidden; existing OCEAN_DD claims and their approvals keep working. A flag read error counts as off. |

### 12.2 Threats and mitigations (step 8)

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T66 | Cross-tenant disclosure or reference: reading another tenant's invoice, tariff or calendar, or pointing an invoice at another tenant's tariff, calendar or claim | RLS FORCE and tenant policies on the three tables; every query in the tenant transaction (the invoice list's raw SQL adds an explicit `tenant_id` match); `tariffId`/`calendarId` looked up in the tenant transaction (400 `not_found` detail otherwise); composite `(id, tenant_id)` FKs; another tenant's id is a 404 byte-identical to an unknown id | `tenant-scope.test.ts` (unit); `ocean-dd.int.test.ts` cross-tenant read, update, delete and insert as `freight_app`, no rows without `app.tenant_id`; acceptance `dd-db`/`dd-api` (**written, not run**) | DD-8, DD-7 |
| T67 | Tampering with audited evidence (editing an invoice, tariff or calendar after the audit so the packet no longer matches; changing a claim's kind) | The audit stores a snapshot `{ invoice, tariff, calendar, rulesVersion }` with its sha256 and the packet sources with their own sha256; AUDITED invoices are immutable and undeletable by trigger for every role; tariff and calendar edits never touch an audited result (the preview of an AUDITED invoice is computed from the snapshot); `claims_kind_guard`; the packet content hash and the unchanged packet triggers of step 5 | `ocean-dd-units.test.ts` (`buildDdPacket` hashes); `ocean-dd.int.test.ts` triggers and "preview frozen after tariff change" (**written, not run**) | DD-8 |
| T68 | D&D claims leaking into the freight paths (re-analysis overwriting the packet, linking imported documents, bulk analysis) | `analyzeClaim` refuses `kind !== 'FREIGHT'` with 409 `invalid_state`; bulk candidates and the import load-key lookup filter `kind = 'FREIGHT'` | `ocean-dd.int.test.ts` analyze 409 (**written, not run**); code review | None known |
| T69 | Resource exhaustion through large or many inputs | Schema caps (50 containers x 20 periods, 10 tiers, 20 sizes, 400 calendar dates, 60 refused dates, spans of 730 and 365 days); bounded date arithmetic (free-time search stops after 3,660 days or at 2099-12-31); DB size CHECKs; caps of 200 tariffs, 200 calendars and (fix round 1, **S2**) 2,000 invoices per tenant under an advisory lock; (**S1**) the invoice list reads only list columns and two JSON-path values, never `data` or `audit_snapshot`, and pages hold at most 50 rows; (**S4**) the global 64 KiB body limit stays, only `POST`/`PUT /dd/invoices` get a bounded 262,144-byte `bodyLimit`, asserted at registration and allow-listed by an architecture test; (**S5**) the browser refuses a CSV over 4,000,000 bytes before reading it and the parser refuses over 1,000,000 characters before any work; rate buckets | acceptance DD-T02 (3,660-day bound), CSV07 (1,000,000 characters), 2,000-row parse under 2 s (Tier L, passed); `architecture.test.ts` (body-limit allow-list); `ocean-dd.int.test.ts` pageSize 51 -> 400, 2,000-invoice cap, 50x20 invoice 201, 262,145 bytes 413 (**written, not run**) | DD-9 |
| T70 | Self-approval: one person enters the invoice data, has someone else run the audit, then approves the claim | Step 4 four-eyes is unchanged (the audit runner authors revision 1 and cannot approve or reject it); approve and reject are also refused for **every user who created or edited the invoice data** (403 `four_eyes_required`, basis `dd_invoice_editor`): since fix round 3 (review **F1/F2**, replacing the fix-round-1 **S3** check of `created_by_id`/`updated_by_id`) the editors are the distinct actors of the invoice's `dd_invoice.created` and `dd_invoice.updated` events in the tenant audit chain (`api/src/audit/dd-editors.ts`, one query in the tenant transaction), and the audit run no longer overwrites `updated_by_id`; checked under the claim lock after the revision-author rule; the approval queue marks those claims `selfAuthored`; approving with review findings still needs `acknowledgePendingFindings` | `four-eyes-units.test.ts`, `ocean-dd-units.test.ts`; `ocean-dd.int.test.ts` fix-round-3 case (creator, an earlier editor and the last editor each refused on approve and reject, a non-editor approves) and acceptance DD-X10, DD-X11 (**written, not run**) | DD-6 |
| T71 | Script or formatting injection through untrusted strings (container numbers, party names, tariff names) into findings, letters, packets or the UI | `plain()` with length limits on every untrusted value in finding texts, citations and the letter; React text nodes and `SafeText` in the UI, no HTML sinks; server error messages never shown; audit metadata allow-listed without free text | shared acceptance DD-L05 (`plain` in letters), web `ocean-dd.test.tsx` (Tier L, passed) | None known |
| T72 | Legal overclaiming or a wrong legal reading (a user treats a finding as a ruling; the product applies a removed or misquoted rule) | Wording "may not be payable ... - review"; 541.5 cited only when a required element is missing, inaccuracy-only content findings titled "inaccurate" and citing 541.6(b) or (d) (fix round 3, F3); the 545.5(c)(2)(ii) and 541.8(b) wording quoted verbatim, including "Absent extenuating circumstances" and "or at a later date as agreed upon by both parties" (F4); all CFR and 545.5 findings review-only; disclaimer on the page, the packet and the letter; four-eyes; the regulation text is verbatim, versioned (`ecfr-2026-10-07`) and byte-pinned by an acceptance test; 541.4 excluded and documented; Part 541 checks off for invoices dated before 2024-05-28 | acceptance DD-K01..K04 (regulation text sha256, copy and honesty scan; Tier L, passed) | DD-1, DD-3, DD-4 |
| T73 | API keys or platform roles reaching D&D routes | No route declares `apiKeyScope` (403 for keys); platform roles hold no tenant permission | route registration; `ocean-dd.int.test.ts` API key 403 (**written, not run**) | None known |
| T74 | Misleading money: amounts counted twice, or regulatory amounts presented as confirmed | Fixed allocation order (TOTAL, PERIOD, TARIFF, RETURN, AVAILABILITY, LATE, CONTENT) with remaining-amount carving, so findings never exceed the stated charges plus the total mismatch; only arithmetic findings (line, total, the tenant's attached tariff) are confirmed; regulatory findings count only in the review total; integer cents; amounts above the int4 range give 422 with nothing written | shared acceptance DD-P01..P04 (3,000 random cases vs an independent oracle, allocation invariant), SI-1..SI-12 (Tier L, passed) | DD-2, DD-5 |

### 12.3 How it works

1. **Dates.** Civil dates as integer day numbers (2000-01-01..2099-12-31); ISO weekdays; no `Date` parsing, no
   time zones, no clock reads in the engine.
2. **Free time and tariff.** Free time counted on calendar or working days, start day included or additional,
   closed dates (not free on a working basis, charged on a calendar basis) and shutout dates (never free, never
   charged) from a tenant calendar; tiered daily rates per size type on the ordinal of the chargeable day.
3. **Rules.** Seven rules in a fixed order with a no-double-counting allocation; confirmed = arithmetic on the
   entered data, review = everything regulatory.
4. **Audit run.** One transaction: claim `OCEAN_DD`, packet revision 1 (snapshot sources with sha256, citations
   with RFC 6901 pointers, verbatim CFR clauses, timeline, draft letter, disclaimer), invoice AUDITED, audit event.
5. **Errors.** New 409 `dd_limit_reached`; reused 400, 404, 409 (`conflict`, `stale_revision`, `invalid_state`),
   413, 422. Precedence: origin/CSRF 403 -> 401 -> 429 -> 403 -> 400 -> 404 -> 400 reference -> 409 -> 422.

### 12.4 Policy defaults (step 8; each can be flipped later)

- **D1.** No 541.4 check; `billedPartyName` recorded only (OQ1).
- **D2.** Line arithmetic, total mismatch and tariff recomputation are confirmed (0.9); all CFR and 545.5 findings
  are review-only (OQ4).
- **D7.** `dd_invoices:manage` includes ANALYST; `dd_tariffs:manage` REVIEWER and up; audit run `claims:analyze`;
  no API keys.
- **D8.** Flag on by default (OQ3: whether to keep it on before counsel has reviewed the wording).
- **D9.** CSV parsed only in the browser; the API accepts only validated JSON.
- **D11.** Caps 200 tariffs, 200 calendars, 2,000 invoices per tenant; tariffs and calendars cannot be deleted.

The full list D1-D11 is in ARCHITECTURE.

### 12.5 Accepted residuals (step 8)

The security review of `ce107d0..afadac3` found no Critical or High issue. S1 (Medium), S2, S3, S4 (Low) and S5
(Info) were fixed in `1ca8eb5`; S6 (test gaps) was assigned to the tester; S7 needs no action.

1. **DD-1 (Info): no billed-party check.** 541.4 is not in force, so nothing checks whether the right party was
   billed. A non-legal consistency note is open question OQ1.
2. **DD-2 (Info): user-entered facts.** Tariff terms, calendars, clock dates, availability dates and refused
   returns are typed in; nothing compares them with tracking data or documents yet. A wrong entry gives a wrong
   finding; regulatory findings stay review-only, but a confirmed tariff overcharge rests on the tariff the user
   attached (OQ4).
3. **DD-3 (Low): presets may be outdated or wrong.** *Narrowed by the hardening run (copy; section 13.4).* Presets are starting points with assumptions where the
   tariff is silent (start day, chargeable-day basis, working weekdays, tier mapping). Maersk was read through a
   search extract (no hash); **the CMA CGM preset is secondary-source only** and must be verified before use.
4. **DD-4 (Info): legal interpretation.** "Last incurred" is the latest charged date on the invoice; 541.8 windows
   are read into 541.6(d)(3); the 541.7(c) NVOCC extension and service-contract terms are not modelled. Counsel
   review is required before relying on any finding or marketing the feature (business case risk "legal
   interpretation").
5. **DD-5 (Info): confidence values are labels.** 0.9, 0.7 and 0.5 are fixed per rule, not measured
   probabilities.
6. **DD-6 (Low; S3, F1/F2 residual): the invoice-editor rule is a service check.** *Closed by the hardening run (database backstop; section 13.4).* Since fix round 3 it
   refuses every user who created or edited the invoice data, taken from the `dd_invoice.created` and
   `dd_invoice.updated` audit events (earlier editors included; the audit run no longer overwrites
   `updated_by_id`). It is still enforced in `transition()` only, with no database trigger backstop, so code that
   changed a claim's status outside that path would not be stopped by it; it also relies on every invoice write
   appending its audit event in the same transaction (it does today). The revision-author rule still excludes
   the audit runner. The integration test for it is written, not run.
7. **DD-7 (Info; S6): test gaps closed in the contract, not yet run.** The planner added acceptance cases DD-X10 (a
   REVIEWER or MANAGER who ran the audit gets 403 `four_eyes_required`) and DD-A10 (cross-tenant
   `tariffId`/`calendarId` with another tenant's real ids; the builder's integration test uses random UUIDs). Both
   are Tier H cases and have not run.
8. **DD-8 (Info): database isolation not yet run.** RLS, grants, triggers and cross-tenant refusals of the three
   tables are checked by code review, the static acceptance tests and unit tests; the integration and Tier H tests
   that exercise them in PostgreSQL are written but not run (pending the owner's go-ahead).
9. **DD-9 (Info): one CSV import is many requests.** The browser posts invoices one by one (at most 50 per file),
   each counted against the `intelligence` bucket, so a large import uses a visible share of a user's budget.
10. **DD-10 (Info; S7): migration comment.** The comment on the SECURITY DEFINER guard function may overstate why
    it is needed; the behaviour is fail-closed either way. Committed migrations are immutable, so it stays.
11. **DD-11 (Info): CSV import is not atomic.** The browser parses and validates the whole file first, but a
    request can still fail midway (rate limit, a duplicate, the invoice cap); the invoices already created stay as
    drafts and the per-invoice outcome list shows which ones. Re-importing the same file gives 409 `conflict` for
    those, never a duplicate.
12. **DD-12 (Info): real public tariff figures in the repository** under the owner decision above (OQ2).

Deferred features (not residual risks): PDF extraction, tracking-data import, API-key scopes, deleting tariffs or
calendars, `kind` in exports and filters, the NVOCC 541.7(c) extension, per diem, chassis and hourly charges,
non-USD, built-in holiday lists, automatic sending.

### 12.6 What was run

Local runs on Windows, Node 22.23.3, **not GitHub CI**. Low-memory mode; the validation is **not complete**.

| Step | Commit | Result |
| --- | --- | --- |
| `prisma validate`, `prisma generate`, `prisma migrate diff` from the `ce107d0` schema (no database) | `527fc14` | DDL generated; every FK `ON DELETE RESTRICT`; drift check against a shadow database not run |
| lint, typecheck, targeted unit tests, builder (`--maxWorkers=1`) | `7419c32`..`afadac3` | clean; shared ocean-dd and pins, api `ocean-dd-units`, `tenant-scope`, `architecture`, `four-eyes-units`, web ocean-dd and touched fixtures passed |
| Tier L acceptance, tester, first run | M1 + M2 + work in progress | shared 384/389; all 5 failures one cause (per-container check order), fixed in M3 without changing a test |
| Tier L acceptance, tester, re-run | `afadac3` (before fix round 1) | shared **389/389** (23 files, incl. 3,000 random cases vs an independent oracle), api static **10/10**; eslint clean; tsc 0 errors |
| security review (static) | `ce107d0..afadac3` | no Critical/High; S1 Medium; S2-S4 Low; S5-S7 Info |
| fix round 1 (S1-S5), builder | `1ca8eb5` | lint, typecheck clean; unit tests shared ocean-dd 32, api 55, web ocean-dd 10 passed |
| Part C amended (planner): S1-S5 contract, S6 cases DD-A10 and DD-X10 | spec and test-spec | identical Part C in both files |
| fix round 2 (limit message covers invoices, `DD_TEXT.csvTooLarge`, exported `DD_CSV_MAX_FILE_BYTES`), builder | `22e4a73` | lint, typecheck clean; unit tests shared 32, api 36, web 10 passed |
| code review (reviewer) | `22e4a73` | FAIL (STOP) on F1: the audit run overwrote `updated_by_id`, so the last editor could approve; F2-F7 notes |
| fix round 3 (F1-F4), builder | `10f8941` | four-eyes from the audit chain, audit run keeps `updated_by_id`, inaccuracy-only texts, verbatim quotes; lint, typecheck clean; unit tests shared ocean-dd 34, api 43 passed; re-review pending |

**Written but not run** (pending the owner's go-ahead): `api/test/integration/ocean-dd.int.test.ts` (RLS, FORCE,
policies, grants including refused UPDATE columns and TRUNCATE, FK delete rules, cross-tenant refusal for all
three tables, the two triggers, routes, RBAC, flag off, audit run, four-eyes including S3, the S1/S2/S4 cases,
API key 403); the tester's Tier H files `dd-db`, `dd-api`, `dd-audit`, `dd-ui`; `npm run build`; the parity
suites; `verify-ci-locally`. The tester's Tier L run predates fix round 1. Not run at all: GitHub CI, container
images, the compose stack, Playwright, any AWS deployment.

## 13. Hardening run

Run `REQ-20261012-hardening` (branch `feat/hardening` from `bcc23bb`, the step 8 head; build commits
`cd596c3`..`c4f703b`; fix round 1 `f8d37f0`, `b603b14`; fix round 2 `c3f131b`, `ce536c5`, `8ac4360`, `76458e4`)
improves existing features only. It adds **no** new route, permission, API-key scope, feature flag, tenant table,
column, index, grant, RLS policy or enum value. `schema.prisma` and the frozen engine directories
(`packages/shared/src/{analysis,charge-intel,fuel,outlook,ocean-dd}`) are byte-identical, so rule outputs, finding
texts, letters, packet content hashes and the parity results are unchanged. The structure is in
[ARCHITECTURE.md, hardening run](../ARCHITECTURE.md#web-platform-hardening-run). The user view is in
[README, hardening](../README.md#hardening-improvements-to-existing-features).

Inputs: the residual registers in sections 8-12; a whole-platform security audit of the step 8 head (no Critical
or High; two Medium findings, P1 change-password and P2 = the carried-over F-03; three Low, P3-P5); and a security
review of this run's own diff (H-1 Medium, H-2..H-5 Low). P1-P5 and H-1..H-4 are fixed in this run. H-5 is
deferred (13.5).

### 13.1 What changed (assets and boundaries)

| Item | Detail |
| --- | --- |
| Migrations | `20261018000000_hardening`: two trigger functions, one deferred constraint trigger and one CHECK. `20261019000000_hardening_fr2`: only `CREATE OR REPLACE FUNCTION fr_approval_four_eyes_ext_guard()` (adds the truncated branch) plus `REVOKE ALL ... FROM PUBLIC`. No `CREATE TABLE`, column, index, grant, policy, enum or `DROP`. Both functions are `SECURITY DEFINER`, `SET search_path = public, pg_temp`, match `tenant_id` explicitly and have `EXECUTE` revoked from `PUBLIC`. The earlier migration folders are unchanged. |
| Database guards | `approvals_four_eyes_ext_guard` (`BEFORE INSERT ON approvals`, APPROVE/REJECT rows): refuses D&D invoice editors and label authors of the claim (P0001 `four_eyes_required`). `evidence_packets_decision_guard` (`CONSTRAINT TRIGGER ... AFTER UPDATE OF status ... DEFERRABLE INITIALLY DEFERRED`): an UPDATE to `APPROVED`, `REJECTED` or `SEND_READY` needs a matching `approvals` row at commit (P0001 `packet_decision_unrecorded`, mapped to 409 `invalid_state`, never 500). CHECK `claims_awaiting_amounts_zero`: an `AWAITING_ANALYSIS` claim has zero `amount_claimed_cents`, `recoverable_cents` and `pending_review_cents`. |
| Four-eyes | New refusal basis `label_author` (service check and trigger) after `revision_author` and `dd_invoice_editor`. The approval queue item gains `selfAuthoredBasis`. The `authz.four_eyes_denied` metadata stays `{ claimId, packetId, packetRevision, action, basis }`, with no label id, label text or other user id. |
| Client address | `api/src/http/client-ip.ts` derives one client address per request (first `onRequest` hook). No code outside that file reads `req.ip` (architecture test). New env vars `CLIENT_IP_HEADER` and `ORIGIN_VERIFY_SECRET` ([docs/secrets.md](../docs/secrets.md)). Terraform: an origin-verify header on the CloudFront `api` origin, the ALB default 403 plus one header- and host-conditioned forward rule, a CLOUDFRONT-scope WAF for the IP-keyed rules, a new Secrets Manager container `<name>/origin-verify-secret` ([infra/README.md](../infra/README.md#deploy-gate-cloudfront-origin-verification-and-client-address-fix-round-1-f-03)). |
| Authentication | Change-password lockout and `auth` rate group; MFA-role promotion revokes sessions; invite parity for other tenants' emails; known-device login during a lockout. New audit actions `auth.password.change_failed` (tenant chain) and `invite.existing_account` (platform chain); new metadata key `knownDevice`; new revoke reason `role_requires_mfa`. |
| Identifiers | Every UUID path parameter is lower-cased in `defineRoute` (`canonicalizeParams`). Audit `targetId`, packet and approval `claimId` come from the loaded row, never from a parameter (architecture test). |
| Failure transparency | 422 analyze carries `details: [{ path: 'analysis', code }]`; new tenant audit action `claim.analysis_failed`; `ClaimDetail.analysisFailure`; bulk `stoppedBy`, `failed[].reasonCode`, failed-last candidate order and a summary event on the error path; `documentCount` and `learnedLabelIdsTruncated` in `claim.analyzed`. New allow-listed keys `stoppedBy`, `documentCount`, `knownDevice`, `learnedLabelIdsTruncated`. |
| Fixed copy | `packages/shared/src/transparency-copy.ts`, rendered verbatim as text nodes. No string contains "accura", "guarantee", "AI-powered", "verified result" or a recovery rate (acceptance scan HD-S06). |

### 13.2 Threats and mitigations (hardening)

"Verified by" names the tester's acceptance IDs (`HD-*`, `HP-*`, `FR2-*` in `api/test-acceptance/hardening-*.acc.test.ts`
and the web and shared suites) and the builder's tests. Local runs only, not GitHub CI (13.7).

| # | Threat | Mitigation (where) | Verified by | Residual risk |
| --- | --- | --- | --- | --- |
| T75 | A D&D invoice editor approves the claim through a path that skips the service check (DD-6) | Trigger part (a): refuses an APPROVE/REJECT row whose actor is the invoice's `created_by_id`/`updated_by_id` or the actor of any `dd_invoice.created`/`updated` event for it | HD-D02, HD-D03, FR2-C01; `hardening.int.test.ts` | FE-N1: a trigger refusal is logged (`four_eyes_db_guard`), not audited |
| T76 | Label poisoning plus self-approval: a user labels a wording, the label influences an analysis, and the same user approves the claim (SC-1) | Basis `label_author` in `transition()` (`api/src/audit/label-authors.ts`, one query) and trigger part (b). Label authors = actors of `charge_label.set` events for the labels in `claim.analyzed.learnedLabelIds` written **before** the analysis, plus the current creators of those labels. When `learnedLabelIdsTruncated` is true, every tenant label author before the analysis is excluded (13.3) | HD-F01..F12, HD-D01, HD-D04, FR2-L01..L04 | HR-7 (availability in small tenants); a labeller can still move detention money to review (SC-1 narrowed, 13.4) |
| T77 | A packet becomes `APPROVED`/`REJECTED`/`SEND_READY` by an UPDATE without a decision row (FE-S2) | Deferred constraint trigger `evidence_packets_decision_guard`; the API maps its refusal to 409 `invalid_state` and logs `packet_decision_db_guard` | HD-D05..D07, HD-D10; `hardening.int.test.ts` (409 mapping) | HR-2 (any historic matching row is accepted), HR-3 (INSERTs not checked; document status not covered) |
| T78 | An awaiting claim carries amounts written by SQL (SA-6) | CHECK `claims_awaiting_amounts_zero` (also enforced with `session_replication_role = replica`, since CHECKs are not triggers) | HD-D08 | `version` of an awaiting claim is still not DB-guarded |
| T79 | Four-eyes bypass through an upper-case UUID (H-1): the audit row stores the raw parameter, so the case-sensitive text comparison in the service and the trigger misses it | `canonicalizeParams` in `defineRoute` lower-cases every UUID path parameter after schema parsing; every audit `targetId` and packet `claimId` is taken from the loaded row; the D&D-editor and label-author maps are looked up with the database claim id; architecture test rejects `targetId` or `claimId` from params | FR2-C01..C04; `ocean-dd.int.test.ts` and `hardening.int.test.ts` upper-case cases | HR-12 (no database CHECK on `target_id` case; chain rows written before this run keep their stored case) |
| T80 | Change-password as a password oracle and argon2 load lever (P1) | Rate group `auth` (per client address); the lockout record of the user's email hash is read **before** any password hash is computed (`429 account_locked`); a wrong current password calls `recordFailure` and appends `auth.password.change_failed`; success clears the lock. No known-device exception on this route | HP-P01..P04; `auth-hardening.int.test.ts` | HR-5 (burst TOCTOU) |
| T81 | Per-IP controls and WAF rules keyed on the CloudFront edge address (P2 = F-03): one attacker locks out everyone behind a POP | The viewer address is trusted only when `CLIENT_IP_HEADER = cloudfront-viewer-address` and `x-origin-verify` equals `ORIGIN_VERIFY_SECRET` (constant-time) and `CloudFront-Viewer-Address` parses strictly; otherwise the `TRUST_PROXY` address (fail-safe, never an error). Both headers are redacted in logs. Terraform: ALB answers 403 unless the origin-verify value (and `Host = app_domain`) matches; the IP-keyed WAF rules moved to a CLOUDFRONT-scope ACL | HP-C01..C07, FR2-I01..I06 (static), builder `deriveClientIp`/`parseViewerAddress` unit tables | 13.6 (unverified in AWS); HR-6, HR-8, HR-11 |
| T82 | An MFA-required role gained inside a password-only session (P3) | When a role change makes MFA required and the subject has no verified MFA secret, every live refresh family is revoked in the same transaction (`role_requires_mfa`); `user.role_changed` records `sessionsRevoked` | HP-M01, HP-M02 | HR-1 (H-5 race) |
| T83 | Invite creation reveals accounts of other tenants (P4) | For an email of another tenant the request takes the normal path (invite row, mail attempt, same `invite.created`, same `201`); one platform-chain `invite.existing_account { inviteId }` is added. Acceptance of such an invite is refused by the existing check (409) | HP-I01..I04 | The extra insert is a small timing difference; synchronous mail delivery probably dominates it (not measured) |
| T84 | Targeted lockout of a chosen user (P5) | Known-device rule (13.3): a request carrying a live refresh cookie of that user is still processed during a lock; `auth.login.success` gets `knownDevice: true` | HP-L01..L04 | HR-4 |
| T85 | Opaque failures and overclaiming copy (SA-2, SA-3, SA-4, SA-8, SA-11, FO-1, FO-10, DD-3, SC-8) | 422 reason code, `claim.analysis_failed` and the claim-sheet note; bulk `stoppedBy`, failed-last order and an error-path summary event; `documentCount`; basis-specific four-eyes texts; confidence shown as a fixed rule setting; price `sourceKind`; D&D preset verification in words; SC-8 retry conflict answers 409 `conflict`; accessible names on five tables | HD-A01..A10, HD-B01..B07, HD-C01..C06, HD-W01..W11, HD-S05, HD-S06, HD-O01 | 13.4 |

### 13.3 How it works

1. **Four-eyes bases.** Approve and reject check, in this order, `revision_author`, `dd_invoice_editor` and
   `label_author`. The first that applies is the reported basis. Precedence otherwise unchanged. Send-ready and
   edit are not restricted by these bases. Each refusal appends one `authz.four_eyes_denied` event (fail closed).
2. **Label authors.** For the claim's `claim.analyzed` event `A` with `learnedLabelIds` `L` (at most 50 ids): every
   non-null actor of a `charge_label.set` event for a label in `L` with a chain `seq` lower than `A.seq`, plus the
   `created_by_id` of each label in `L` that still exists. A later write to a label does not make its writer an
   author, and `charge_label.deleted` does not count. A claim without `claim.analyzed` has no label authors.
3. **The 50-label cap.** The frozen engine caps `learnedLabelIds` at 50 without saying so. The API now computes
   `learnedLabelIdsTruncated` from an upper bound: the distinct nearest tenant labels of the candidate lines (rules
   class `other`, classifier category accessorial or detention). The bound can only be too high, never too low. The key is
   recorded in `claim.analyzed` only when true. When it is true, the label authors are **every** non-null
   `charge_label.set` actor of the tenant before `A`, plus the creator of every tenant label created at or before
   `A`. The service (`label-authors.ts`) and the trigger (migration `20261019000000_hardening_fr2`) apply the same rule.
   This tenant-wide superset is deliberate. The engine decides whether a label matches a charge line by similarity,
   and SQL cannot evaluate that.
4. **Database guards.** See 13.1. Existing rows are not re-validated by the triggers. The decision guard is a
   constraint trigger, so `session_replication_role = replica` (test fixtures only) disables it; the CHECK stays.
5. **Client address.** A Fastify request getter `clientIp`, primed by the first `onRequest` hook, so even Fastify's
   own request log gets the derived value. It feeds the global, `auth` and `forgot` buckets, the API-key failure
   limiter and its in-memory gate, the per-user buckets' fallback key, `login_attempts.ip`, every audit `ip` and the
   request logs. Rate-limit maxima and windows are unchanged; only the key source changed.
6. **Change-password lock.** The route is in rate group `auth`. With threshold N (`LOCKOUT_THRESHOLD`, default 5),
   wrong attempts 1..N answer 401 (the N-th starts the lock), and attempt N+1, wrong or right, answers 429
   `account_locked` while the lock lasts. A lock started here also blocks `/auth/login` for that email, subject to
   the known-device rule.
7. **MFA-promotion revocation.** Only when the role actually changes to OWNER or ADMIN and the subject has no
   verified MFA secret. Access tokens stop working on their next request because each request re-checks the
   session. The next login requires MFA enrolment.
8. **Invite parity.** A member of the inviting tenant, or a live invite in that tenant, still gives 409 `conflict`.
   An email of another tenant gives the same response, queries, mail call and tenant audit event as an unknown
   email.
9. **Known device.** On `/auth/login` and `/auth/mfa/verify`, a locked email is still processed when the `fr_rt`
   cookie belongs to the **current** (unused) token of a live family of that same user: not revoked, not expired,
   family within `REFRESH_FAMILY_MAX_SECONDS`. The cookie is only checked, never rotated. A wrong password on this
   path still counts as a failure and answers 401. Success clears the lock as usual.
10. **Canonical ids.** Mixed-case UUIDs keep returning the same resource. Non-UUID values are unchanged and still
    404 in the handlers.
11. **Failure transparency.** `claim.analysis_failed` is appended in its own transaction after the analysis
    transaction rolled back. If that append fails, the single route answers 500 (fail closed). The bulk route then
    writes `claim.bulk_analyzed` with `stoppedBy: 'error'` and the counts so far before answering 500. If that
    append also fails, it logs `bulk_summary_audit_failed`. Analyses already committed stay committed.

### 13.4 Status of earlier residuals and findings

| ID | Status after this run | What remains |
| --- | --- | --- |
| SC-1 (10.5) | **Narrowed.** A labeller whose label influenced an analysis can no longer approve or reject that claim (service + trigger), and the Charges tab lists the influencing labels | A labeller can still move detention findings to review, and another approver must then decide. Truncated claims exclude every tenant label author (HR-7) |
| SC-2 (10.5) | **Narrowed.** The charge-lines view reads the labels once in the tenant transaction and classifies after it closes | Classification is still synchronous on the event loop |
| SC-8 (10.5) | **Closed.** A repeated unique violation on the retry answers 409 `conflict`; the UI shows a fixed reload text | - |
| DD-3 (12.5) | **Narrowed (copy).** The preset line shows the verification level in plain words, with "Verify before use" for the search-extract and secondary presets | Presets may still be outdated or wrong |
| DD-6 (12.5) | **Closed.** The invoice-editor rule now has a database backstop (T75), and the upper-case-id bypass is closed (T79) | FE-N1 for trigger refusals |
| FE-S2 (8.5) | **Narrowed:** evidence packets, UPDATE only | INSERTs are not checked; `import_review_decisions`/document status is not covered; HR-2 |
| FE-N1 (8.5) | **Unchanged**, now for three triggers | Refusals by `approvals_four_eyes_guard` and `approvals_four_eyes_ext_guard` are logged (`four_eyes_db_guard`), not audited. No current route reaches them |
| SA-1 (9.5) | **Narrowed.** Previously failed claims are tried last, so they no longer use the budget before newer claims | One budget unit is still charged per candidate attempted, not per claim analyzed |
| SA-2 (9.5) | **Closed.** An unexpected error writes `claim.bulk_analyzed` with `stoppedBy: 'error'` | If that append also fails, only a log line remains |
| SA-3 (9.5) | **Closed.** `stoppedBy` in the response and a stop line in the dialog | - |
| SA-4 (9.5) | **Closed.** `claim.analyzed` records `documentCount` | `documentIds` is still capped at 50 |
| SA-5 (9.5) | **Guarded by a test.** An architecture test allow-lists the modules that read finding texts | Any new renderer must still sanitize them |
| SA-6 (9.5) | **Narrowed.** CHECK on the three amount columns | `version` is not DB-guarded |
| SA-8 (9.5) | **Narrowed.** The reason is shown to every reader of the claim and audited, and failed claims no longer block newer ones in bulk | A failure caused by the documents still needs a re-import of corrected documents (open question OQ-H2) |
| SA-11 (9.5) | **Closed.** Basis-specific four-eyes texts | - |
| FO-1 (11.5) | **Narrowed.** The Outlook page shows the source kind (`fetch`, `bundled`, `file`) of each series | `--file` provenance is still asserted by the trusted operator |
| FO-10 (11.5) | **Narrowed (copy).** The limit message says archived tables count | The cap still counts archived tables |
| Platform P1-P5 | **Fixed in code** (T80-T84) | HR-1, HR-4, HR-5 |
| F-03 / P2 | **Fixed in code and IaC, unverified in AWS** (13.6) | HR-6, HR-8, HR-11 |
| H-1 | **Fixed** (T79) | HR-12 |
| H-2 | **Fixed in IaC.** The ALB rule is created with a fixed 403 action, so the committed placeholder never forwards; a replaced rule fails closed (outage, not bypass) | Unverified in AWS |
| H-3 | **Fixed in IaC.** `ignore_changes = [origin]` stays (it carries the secret header), guarded by a `postcondition` and a `check "cloudfront_origins"` block on domains, OAC, `https-only` and TLSv1.2 | An intended origin change needs the documented targeted apply |
| H-4 | **Fixed** (13.3, item 3) | HR-7, HR-9 |
| H-5 | **Deferred** | HR-1 |

### 13.5 Known gaps and residual risks (hardening)

These are open. Do not read any of them as done.

1. **HR-1 (Low; H-5, deferred): revoke versus concurrent refresh rotation.** `revokeUserSessionsTx` is a single
   `updateMany` under READ COMMITTED. A successor token inserted by a rotation running at the same moment can
   survive the revoke, so a session refreshing in a tight loop while the user is promoted to an MFA role might keep
   a password-only session. The same race affects password change, disable and MFA reset. Not confirmed by a test.
   Fix options: serialize per user in both rotation and revoke (`SELECT ... FOR UPDATE` on the users row, or
   `pg_advisory_xact_lock` on the user id). Alternatively, add a `sessions_valid_after` timestamp on the user,
   checked in `authenticateAccessToken` and in rotation (needs a new migration).
2. **HR-2 (Info): the packet-decision guard accepts any historic matching approval row.** The guard requires an
   `approvals` row with the same packet, tenant, `to_status` and action. It does not require that row to come from
   the same transaction. The comment in migration `20261018000000_hardening` says "in the same transaction", which
   is **inaccurate**. Committed migrations are immutable, so the comment stays. The security review found no
   reachable path that exploits this. Fix options for a later migration: tighten the guard (for example `ap.created_at = now()`), or record the actual semantics with
   `COMMENT ON FUNCTION`.
3. **HR-3 (Low; FE-S2 residual): INSERTs and documents are outside the decision guard.** A packet inserted with a
   decided status, and a document status change without a review-decision row, are not checked by it. The
   existing packet triggers still refuse a packet that is not a proper revision.
4. **HR-4 (Low; P5 residual): known-device limits.** A user with no live session on any device can still be
   locked out by someone who knows the address. The `auth` bucket per client address (now the viewer address)
   slows that down. Conversely, someone holding a victim's live refresh cookie can guess the password without
   the lockout, limited only by the per-address `auth` bucket. Optional hardening: cap failed known-device attempts
   per family.
5. **HR-5 (Info; P1 residual): change-password burst TOCTOU.** The lock check and the failure write are separate
   transactions. A burst of parallel requests can all pass the check before their failures are recorded (the same
   pattern as login). The per-address `auth` bucket bounds the burst.
6. **HR-6 (Low; review R-4): rotation window and unenforced configuration.** During rotation step 3 in
   [infra/README.md](../infra/README.md#deploy-gate-cloudfront-origin-verification-and-client-address-fix-round-1-f-03)
   (API restarted with the new value, CloudFront still sending the old one), tasks fall back to the `TRUST_PROXY`
   address. For that window the per-address controls key on the edge address again, as in F-03. Requests never
   fail. Also, production does **not** require `CLIENT_IP_HEADER`: a CloudFront deploy without it in the ECS
   environment silently keeps F-03. Follow-up options: accept a current and a previous secret, or require both
   variables behind an explicit "behind CloudFront" flag.
7. **HR-7 (Info; review R-5, OQ-H1): truncated claims in small tenants.** When `learnedLabelIdsTruncated` is
   true, every tenant label author before the analysis is excluded. In a tenant where every potential approver
   had set a label before the analysis, nobody in that tenant can approve or reject the claim. This is a
   fail-closed availability cost, not a bypass. It needs more than 50 distinct influencing labels.
8. **HR-8 (Info; review R-6): public test values for `ORIGIN_VERIFY_SECRET` are not on the production
   denylist.** The committed test literals for it (in `api/test/` and `api/test-acceptance/`) are not in
   `DOCUMENTED_DEV_SECRETS`, so production would accept one if someone copied it and it passed the entropy checks. Treat every committed literal as public
   ([docs/secrets.md, section 4](../docs/secrets.md#4-public-values-never-use-them-anywhere-real)). Follow-up:
   add them to the denylist, or refuse `ci-only-`/test-value patterns.
9. **HR-9 (Info): the influence list is still capped at 50.** `learnedLabelIds` keeps at most 50 ids. The new
   flag says when the list may be incomplete, and the four-eyes rule then fails closed (item 7). The Charges
   tab shows at most those 50 labels.
10. **HR-10 (Info): origin request policy.** The `/api/*` and `/healthz` behaviours keep a custom origin request
    policy that also forwards the viewer `Host`. This change could not confirm from AWS documentation that
    `Managed-AllViewerExceptHostHeader` forwards `CloudFront-Viewer-Address`. The compensating controls are a
    `Host = app_domain` listener condition and a precondition that `alb_certificate_arn` is the issued ACM
    certificate for `app_domain`. That precondition blocks `plan` for wildcard or SAN-only certificates until it
    is adapted. The API reads neither Host nor X-Forwarded-Host. Owner follow-up: confirm the managed policy's
    header list. If it forwards `CloudFront-Viewer-Address`, switching removes the Host coupling.
11. **HR-11 (Info): Terraform not formatted or validated locally.** No `terraform` binary was available.
    `fmt -check` and `validate` run in CI only (merge gate). Nothing in `infra/` has been planned or applied.
12. **HR-12 (Info): no database CHECK on `audit_events.target_id` case.** Canonicalisation happens at the request
    boundary. A CHECK was not added because some target ids are not UUIDs (for example flag keys). Rows written
    before this run keep the case they were stored with.
13. **HR-13 (Info; review R-1): one acceptance check skips in CI.** HD-S09 compares `.env.example` with the base
    commit via `git show`. CI's shallow checkout (fetch-depth 1) makes it skip, and the stated fallback pin does
    not exist. This is a coverage gap, not a loosened expectation (route: tester).

### 13.6 F-03 history

- **Open** since review F-03 of run `REQ-20261008-webapp-foundation`, and carried over in step 3 (F-14). The API
  trusted only the VPC CIDR, so `req.ip` was the CloudFront edge address. Every per-IP control, the WAF rate rule
  and the IP-reputation rule keyed on shared edge addresses. One attacker near a POP could lock out everyone
  behind it, and audit and login-attempt IPs were useless for forensics. It was not recorded in this document
  until now. The platform audit of this run raised it again as P2 (Medium).
- **Fixed in code and IaC** in fix round 1 (`b603b14`): the derived client address (13.3, item 5), the
  origin-verify header and ALB rule, the CLOUDFRONT-scope WAF, the Secrets Manager container and the deploy gate
  in `infra/README.md`.
- **Hardened** in fix round 2 (`8ac4360`): the placeholder rule answers 403 until rotation (H-2), the origin drift
  postcondition and check block (H-3), and the host condition with the certificate precondition (HR-10).
- **Status now: fixed in code and IaC, unverified in AWS.** It stays that way until the
  [infra/README.md deploy-gate check](../infra/README.md#deploy-gate-cloudfront-origin-verification-and-client-address-fix-round-1-f-03)
  is recorded: one real request through CloudFront shows the viewer address in `login_attempts.ip` and the audit
  `ip`, and a direct ALB request without the header, or with the placeholder value, gets 403. HR-6 and HR-8
  apply in the meantime.

### 13.7 What was run

Local runs on Windows, Node 22.23.3 (portable, the CI version), `CI=true`, one worker, **not GitHub CI**.
PostgreSQL 16.15 (fresh cluster per session, `freight_app` without BYPASSRLS confirmed) and MinIO with SSE-KMS.

| Step | Commit | Result |
| --- | --- | --- |
| builder: typecheck, eslint on changed files, unit tests | `c4f703b` | clean; shared 279, api 453, web 119 passed |
| tester Tier H, first run: `migrate deploy` (10 migrations incl. `20261018000000_hardening`), seed, bucket, build | `c4f703b` | all rc 0 |
| builder integration, first run | `c4f703b` | four-eyes, analysis, charge-labels, ocean-dd, fuel-outlook, intelligence, exports green; `hardening.int` 7 failed and `auth-hardening.int` 1 failed. All were classified as **test design** by amplified repro: an approval reason shorter than the existing CHECK allows, an AUDITED fixture violating `dd_invoices_audit_consistent`, an illegal transition, an uninitialised CSRF client. No product change |
| tester acceptance (the new hardening files, touched and remaining api suites in batches, analysis and import parity) | `c4f703b` | all green after two test-design fixes in the tester's own files (one assertion moved and one added; two fixture faults); 0 failures |
| platform and hardening security reviews (static) | `a0cf959`, `bcc23bb..c4f703b` | no Critical/High; P1, P2 and H-1 Medium; the rest Low |
| fix round 2 builder: unit, typecheck, eslint | `c3f131b`..`8ac4360` | clean; api 460, web 119, shared 279 passed |
| tester Tier L, fix round 2 | `8ac4360` | api static 41 passed, 1 declared skip (no terraform binary); shared 405/405; root typecheck and full lint rc 0 |
| tester Tier H, fix round 2: `migrate deploy` (11 migrations incl. `20261019000000_hardening_fr2`) | `8ac4360` | all builder integration files green except `hardening.int` 10/11 (test design: a `feature_flags` UPDATE without the version bump the existing trigger requires); `hardening-id-case` 8/8, `hardening-label-cap` 5/5, all other api acceptance, parity, web acceptance (23 files) and web unit (15 files) green |
| follow-up re-run | `76458e4` | `hardening.int` 11/11 twice; `hardening-id-case` 8/8; `hardening-label-cap` 5/5 |
| code review | `76458e4` | APPROVE WITH NOTES; no weakened control or loosened expectation; merge gates: the tester commits `*/test-acceptance/**` (done in `4c61607`), CI `terraform fmt -check`/`validate` green, these docs |

Not run: GitHub CI, `terraform fmt`/`validate` (no binary; CI runs both), `prisma migrate diff` against a shadow
database (schema unchanged), container images, the compose stack, Playwright, any AWS deployment.

## 14. Claim outcomes

Run `REQ-20261020-claim-outcomes` (branch `feat/outcomes` from `0830f01`, the launch-readiness merge). It closes
the "nothing is recorded after SEND_READY" gap with one **human-entered, append-only** tenant table and a read-only
Recovery section on the executive dashboard. No reconciliation with payments exists and no outbound network path was
added; the design and its limits are in [docs/design/claim-outcomes.md](../docs/design/claim-outcomes.md).

### 14.1 New assets, permission and trust boundaries

| Item | Detail |
| --- | --- |
| Permissions | New `outcomes:record` (OWNER, ADMIN, MANAGER, REVIEWER: the roles that may approve). Reads need `claims:read`; the Recovery section needs `insights:read`. ANALYST, VIEWER, PLATFORM_DEV and SUPER_ADMIN cannot record. **No API-key scope** grants either route, so API keys get 403. |
| Routes | `GET /api/v1/claims/:id/outcomes` (newest first, at most 200 rows), `POST /api/v1/claims/:id/outcomes` (201; mutating, cookie session + Origin + CSRF; strict body `ClaimOutcomeBody`, a discriminated union on `kind`), `GET /api/v1/insights/recovery` (read-only, `intelligence` bucket, READ ONLY REPEATABLE READ transaction like the other insights routes). An unknown id and another tenant's id answer byte-identical 404s on both claim routes. |
| New tenant table | `claim_outcomes`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, one `FOR ALL` policy `claim_outcomes_tenant_isolation` (`USING`/`WITH CHECK tenant_id = fr_current_tenant()`), `REVOKE ALL FROM PUBLIC`; `freight_app` gets **SELECT and INSERT only** (no UPDATE, DELETE or TRUNCATE). Composite FK `(claim_id, tenant_id) -> claims(id, tenant_id)` `ON DELETE RESTRICT`, FKs to `tenants` and `users`. CHECKs on `kind`, `channel`, `carrier_response`, the 500-character note, non-negative cents, `version >= 1` and the kind consistency of an `AUDITED_NO_FINDING` row. In `TENANT_MODELS` and `TenantTx`. |
| Triggers | `claim_outcomes_append_only` / `claim_outcomes_no_truncate` (`fr_append_only`, every role). `claim_outcomes_guard` (`BEFORE INSERT`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `EXECUTE` revoked from `PUBLIC`, tenant matched explicitly): `OUTCOME` needs a `SEND_READY` claim of the same tenant, `AUDITED_NO_FINDING` an analysed claim (`status <> 'AWAITING_ANALYSIS'`); raises P0001 `claim_outcome_state_invalid` / `claim_outcome_claim_invalid`, mapped to 409 `invalid_state` (never 500). The service applies the same rule first, under the claim row lock. |
| New writes | one `claim_outcomes` row per POST and the tenant audit event `claim.outcome_recorded` with `{ claimId, outcomeId, kind, channel, carrierResponse, creditedCents, paidCents, sentAt, closedAt }` (new allow-listed keys `outcomeId`, `channel`, `carrierResponse`, `creditedCents`, `paidCents`, `sentAt`, `closedAt`); the note text is never audited. Both commit together. |
| Untrusted input | the outcome body (fixed enumerations, integer cents within the INTEGER bound, UTC instants of years 2000-2100 with `closedAt >= sentAt`, a single-line note of at most 500 characters without control or bidi characters); the insights query (same period rules as the other insights routes). Everything is a bound parameter; the Recovery SQL interpolates nothing from a request or a tenant row (unit-checked). |
| Outbound network | None. |
| Database | Migration `20261020000000_claim_outcomes` (the table, CHECKs, triggers, policy, grants). Earlier migrations unchanged; `schema.prisma` gains the `ClaimOutcome` model and its relation lists. Pins amended in `hardening-static.acc.test.ts` (migration list, `SCHEMA_BASE`, `RBAC_BASE`) and the audit-action tail oracles. |
| Fixed copy | `OUTCOME_TEXT`, `OUTCOME_CHANNEL_TEXT`, `CARRIER_RESPONSE_TEXT`, `OUTCOME_KIND_TEXT` in `packages/shared/src/outcomes-dto.ts`; `INSIGHTS_OUTCOME_DISCLAIMER` and the G1/G4/G9 "not tracked" entries reworded. The Recovery section states its basis (`human_entered`) and the reviewer-hour approximation (packet creation to SEND_READY, capped at 8 h per claim). No string claims accuracy, savings or recovery. |

### 14.2 Threats and mitigations (claim outcomes)

| Threat | Mitigation | Verified by |
| --- | --- | --- |
| A user records an outcome on another tenant's claim, or reads one | RLS (`FORCE`) on `claim_outcomes` and on `claims`; the service loads the claim through the tenant transaction, so the id is "not found"; the trigger matches `tenant_id` explicitly; the 404 body is byte-identical to the unknown-id case | `outcomes.int` (cross-tenant SELECT 0 rows, INSERT refused by RLS, byte-identical 404s) |
| A recorded outcome is altered or removed to change a recovery figure | no UPDATE/DELETE grant for `freight_app`; `fr_append_only` refuses UPDATE, DELETE and TRUNCATE for every role; a correction is a new row and the latest row counts | `outcomes.int` (permission denied as `freight_app`; `append_only` as the owner) |
| An outcome is recorded on a claim that was never sent | state rule in the service under the claim row lock, repeated by the guard trigger; 409 `invalid_state` | `outcomes.int`, `outcomes-units` |
| A lower role records outcomes | `outcomes:record` only for OWNER, ADMIN, MANAGER, REVIEWER; API keys never; CSRF and Origin on the POST | `outcomes.int` (matrix row, 401/403, `csrf_failed`, `origin_not_allowed`), `rbac.acc` and the three oracles |
| The note carries injected text into audit, exports or the UI | single-line, length-capped, control/bidi-free at the API; never written to `audit_events`; rendered as text nodes (`SafeText`); not exported | `outcomes-dto.test`, `outcomes.int` (audit metadata contains no note), eslint `react/no-danger` |
| Recovery figures read as reconciled money | `basis: 'human_entered'` on the wire; intro, disclaimer and reviewer-hour note state the basis; MoneyFigure labels `credited` and `paid` are visible next to each amount; the "not tracked" list keeps the reconciliation gap | `outcomes-dto.test` (copy scan), `insights-dto.test` |
| Recovery SQL leaks across tenants or interpolates input | every reader runs in the caller's READ ONLY tenant transaction, filters `tenant_id = fr_current_tenant()` on the outcome rows and the claims, and binds every value | `outcomes-units` (SQL shape), `outcomes.int` (other tenant's outcome not counted) |

### 14.3 What was run

Local runs on Windows, Node 24, `CI=true`, **not GitHub CI**. Embedded PostgreSQL 18.4 (the hosted-platform recipe:
`freight_app` without BYPASSRLS, random role passwords), no object store (none needed by these tests). `npm run lint`,
`npm run typecheck`, `npm test` (shared, api, web unit) and `migrate deploy` (12 migrations) pass; `prisma migrate diff`
against the live database shows no drift for `claim_outcomes`. `outcomes.int` 9/9. Acceptance: the static pins, RBAC,
the shared copy/contract files and the touched claims/approvals/audit files. Not run: the full integration and
acceptance suites (parity needs Python), container images, Playwright, any deployment.