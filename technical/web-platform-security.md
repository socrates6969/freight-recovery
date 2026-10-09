# Web platform: security threat model

> **Status: pre-product, synthetic data only.** The TypeScript web platform (`web/`, `api/`,
> `packages/shared/`, `infra/`) has never been deployed. No independent penetration test has been
> carried out. A production start is refused by the config validator until a real mail transport exists
> (every `MAIL_TRANSPORT` value is rejected in production). Do not put
> real customer data into it. The Python service has its own notes in [deploy/aws.md](../deploy/aws.md).

This document covers build-order steps 1 and 2 of the web platform: authentication, RBAC, tenant
isolation, app hardening, the audit trail, the claims list, the evidence-packet viewer and the approvals
gate. Step 3 (import and export: hostile uploads, the parse sandbox, review, commit and CSV/XLSX export)
is covered in [section 6](#6-step-3-import-and-export). The structure is in [ARCHITECTURE.md](../ARCHITECTURE.md#web-platform-typescript-steps-1-2). The
infrastructure is in [infra/README.md](../infra/README.md).

## 1. Scope, assets and trust boundaries

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Credentials | `users.password_hash` (argon2id), `mfa_secrets` (AES-256-GCM), `mfa_recovery_codes` (hashed) | account takeover |
| Sessions | access JWT (browser memory only), refresh token (`fr_rt` HttpOnly cookie; DB stores only an HMAC of it) | impersonation |
| Tenant data | `claims`, `evidence_packets` and child rows, `approvals`, `memberships`, `invites` | cross-customer disclosure |
| Audit trail | `audit_events`: one hash chain per tenant plus a `platform` chain | evidentiary chain; the product depends on it |
| Approval decisions | `approvals` (append-only), bound to a packet content hash | prevents "approve X, send Y" |
| Server secrets | `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER`, `MFA_ENC_KEY`, DB/Redis URLs (Secrets Manager in AWS) | forging any of the above |

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
| T9 | Platform/Dev access to customer data | `PLATFORM_DEV` holds only `platform:health`, `platform:flags` and `platform:logs`. It has no tenant permission and no tenant DB handle. | T-RBAC matrix | None known. |
| T10 | Audit tampering | Each chain computes `hash_n = SHA-256(hash_{n-1} + "\n" + canonicalJson(event_n))`, under a per-chain advisory lock. DB triggers block UPDATE, DELETE and TRUNCATE on `audit_events`, `approvals`, `login_attempts` and the packet child tables, even for the owner. `freight_app` has only SELECT and INSERT on them. `GET /api/v1/audit/verify` recomputes the chain. | T-AUD-01..08, `api/test/audit-chain.test.ts` | Someone with a DB superuser account, or `freight_owner` with `session_replication_role` (a dev/test-only grant), could rewrite the whole chain from genesis. Nothing anchors chain heads externally yet (for example a WORM export). |
| T11 | "Approve X, send Y", races | Approval stores the packet content hash. Send re-hashes the latest revision and requires it to equal both the approval's hash and the stored hash. A DB trigger makes packets immutable except for `status`, and only along the state machine. The claim row is locked (`SELECT ... FOR UPDATE`) for the whole transition. | T-APR-01..11 (incl. concurrency), T-PKT tamper tests | Four-eyes (author ≠ approver) is **not** enforced (assumption A9). |
| T12 | Injection, malformed input | Prisma uses parameterized queries. Claim search escapes `\ % _` itself, because Prisma 7 `contains` does not. Strict Zod schemas reject unknown keys. Bodies are capped at 64 KiB, with a matching WAF Content-Length rule. | T-VAL-01..06, T-CLM | Step 3 added uploads (raw bytes, size-capped while streaming; see T18-T21 in section 6). There is still no URL fetching of any kind. |
| T13 | Leakage through errors and logs | Error messages are fixed and never echo input. The UI shows fixed texts for 422 and 500. Pino redacts known paths, and a recursive scrubber covers the rest. Request logs carry method, path (no query string), status, duration and requestId. Config errors name the key, never the value. | T-LOG-01/02, T-UI-10, T-CFG | Forced-500 header and log checks are not automatable (section 3). |
| T14 | Unsafe production configuration | `NODE_ENV` defaults to `production`. Production refuses to start with `COOKIE_SECURE=false`, `ENABLE_DEV_OUTBOX`, any `MAIL_TRANSPORT` that is not implemented (currently all of them: `outbox` is a dev sink and `ses` is a stub, fix round 3), `RATE_LIMIT_ENABLED=false` or a missing `REDIS_URL`. Secrets must be at least 43 characters, must differ from each other and must not look like placeholders, in every environment. In production they also must not be a documented dev or CI value, and must pass an alphabet-aware entropy check (≥160 bits, no repetition, at least 8 distinct characters). Random hex and base64 both pass. | T-CFG-01..04, `api/test/config.test.ts` (1000 random hex and base64 draws) | None known. This includes the G-B hole, fixed in fix round 1. |
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

- Four-eyes approval is not enforced (A9). One MANAGER, REVIEWER, ADMIN or OWNER can both approve and,
  where permitted, send.
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
| T26 | A wrong or manipulated value becomes a claim without a human check | Confidence is a **rule-based parse score, not an accuracy measure**, and the UI says so. Fields below 0.90, unparseable values and conflicting duplicates are flagged, and every PDF field is flagged. Only ACCEPTED documents can be committed. Acceptance needs `import:review` (ANALYST cannot accept) and a reason of at least 10 characters. Values that are unparseable or conflicting must be resolved one by one, even with "confirm all remaining". Each decision is an append-only row plus an audit event. Accepted documents are immutable (DB trigger). Claims from imports start as `AWAITING_ANALYSIS`, with no money and no packet. A claim that already has a packet is never changed by a commit. | T-REV (REV-01..08), T-COM (COM-01..11), P3 | **Four-eyes is not enforced** (D-7, like A9 / F-13 for approvals): the same REVIEWER, MANAGER, ADMIN or OWNER can upload, review and accept their own document. |
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
5. **Four-eyes is still not enforced** (finding F-13 from the step 1-2 review; decision D-7 for import
   review). One reviewer can upload, review and accept their own document.
6. **Email-forward ingestion is design only.** No SES, SQS or email worker exists. The design and its
   open questions are in [docs/design/email-ingest.md](../docs/design/email-ingest.md).
7. **No OCR.** Images yield no fields and need manual entry (D8). PDF parity with Python holds only for
   simple text-layer PDFs (D2).
8. **Not run:** the container images and compose stack (Docker was broken locally; CI is the authority),
   Playwright end-to-end tests, and the forced audit-append failure for exports (EXP-06, skipped: it
   needs a second database with INSERT revoked). Encrypted-PDF tests were skipped because `qpdf` was not
   installed. The export abort path is integration-tested with a real socket.
9. **Open owner decisions** (not blocking): outcomes export as a decision ledger, no four-eyes, VIEWER
   cannot import or export, threshold 0.90, 1 GiB storage quota per tenant.
