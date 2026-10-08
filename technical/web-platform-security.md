# Web platform: security threat model

> **Status: pre-product, synthetic data only.** The TypeScript web platform (`web/`, `api/`,
> `packages/shared/`, `infra/`) has never been deployed. No independent penetration test has been
> carried out. A production start is refused by the config validator until a real mail transport exists
> (every `MAIL_TRANSPORT` value is rejected in production). Do not put
> real customer data into it. The Python service has its own notes in [deploy/aws.md](../deploy/aws.md).

This document covers build-order steps 1 and 2 of the web platform: authentication, RBAC, tenant
isolation, app hardening, the audit trail, the claims list, the evidence-packet viewer and the approvals
gate. The structure is in [ARCHITECTURE.md](../ARCHITECTURE.md#web-platform-typescript-steps-1-2). The
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
| T12 | Injection, malformed input | Prisma uses parameterized queries. Claim search escapes `\ % _` itself, because Prisma 7 `contains` does not. Strict Zod schemas reject unknown keys. Bodies are capped at 64 KiB, with a matching WAF Content-Length rule. | T-VAL-01..06, T-CLM | No uploads or URL fetching exist yet (step 3). The hostile-document pipeline is future work. |
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
npm run test:integration                               # needs a migrated + seeded test DB (see web-ci.yml)
npm run audit && npm audit signatures
terraform -chdir=infra fmt -check -recursive && terraform -chdir=infra init -backend=false && terraform -chdir=infra validate
```

Last recorded results (run `REQ-20261008-webapp-foundation`, 2026-10-08). Acceptance tests: 334 passed,
0 failed, 5 skipped, 2 todo. Integration: 3/3. Unit after the final fix round: shared 30, api 83, web 29.
`npm audit`: 0 vulnerabilities.
