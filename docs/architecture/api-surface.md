# API surface (TypeScript API)

> **Status.** Pre-product, synthetic data only, never deployed; there is no public base URL. This inventory
> is generated from the `defineRoute(...)` calls in `api/src/**` on branch `feat/hardening` (`ed3d126`) by a
> script that reads `method`, `url`, `access` and `rateGroup` from source. The purpose column is ours. The
> Python service's API (`/v1/analyze` and friends) is a different API, covered in
> [dev-portal-drift.md](dev-portal-drift.md).

## 1. Summary

The TypeScript API exposes **97 routes** in 15 route files. One of them (`GET /api/v1/dev/outbox`) is
registered only when the dev mail outbox is enabled, which production configuration refuses, so a production
build serves 96. All application routes live under `/api/v1`; the two probes are `/healthz` and `/readyz`.
There is no OpenAPI document for this API yet.

| Access kind | Routes | Meaning |
|---|---|---|
| `public` | 12 | No session: auth bootstrap (csrf, login, MFA, forgot, reset, invites), probes, dev outbox |
| `cookie-session` | 2 | Refresh and logout, authenticated by the `fr_rt` cookie only |
| `authenticated` | 2 | Any signed-in user (`/me`, change password) |
| permission | 81 | A named permission from `packages/shared/src/rbac.ts`, checked on every request |

Machine access: 9 routes accept a tenant API key (`Authorization: Bearer fr_live_...`), each only with the
matching scope. `claims.read` opens `GET /claims`, `GET /claims/:id` and `GET /claims/:id/documents`;
`exports.claims` opens `GET /exports/claims`; `imports.write` opens the five upload and batch routes. Every
other route answers 403 to a key.

Rate groups (`api/src/http/context.ts`): `auth` and `forgot` are counted per client address; `upload`,
`export`, `platform`, `intelligence` and `analysis` are counted per user; a global per-address limit
(`RATE_LIMIT_GLOBAL_MAX`, default 600) applies to everything. The store is Redis.

## 2. Conventions every route shares

- **Order of checks.** Rate limit, then Origin and CSRF (unsafe methods, cookie callers only), then
  authentication, then permission, all in `onRequest` before the body is read; then Zod validation of body,
  query and params in `preHandler` (`api/src/http/route.ts`, `api/src/http/security.ts`).
- **Path parameters.** UUIDs in any letter case are lower-cased at the boundary (`canonicalizeParams`). A
  malformed or foreign id answers 404, never 403.
- **Errors.** One JSON shape from `api/src/http/errors.ts` with a fixed `code` and message; validation
  errors list field paths and Zod codes, never submitted values. Database guard violations map to fixed 4xx
  codes (`api/src/http/db-guard.ts`), for example `four_eyes_required` (403).
- **Writes.** Every mutating route appends an audit event in the same transaction. Decision routes require a
  `reason`. Editable configuration requires the current `version` and answers 409 when it is stale.
- **Body limits.** A global `BODY_LIMIT_BYTES` applies; allow-listed routes may raise it up to
  `ROUTE_BODY_LIMIT_MAX` (the D&D invoice routes). Uploads have their own size, idle and request timeouts.

## 3. Route inventory

### `api/src/apikeys/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| POST | `/api/v1/api-keys` | `apikeys:manage` |  |  | Create a tenant API key (secret shown once) |
| GET | `/api/v1/api-keys` | `apikeys:manage` |  |  | List tenant API keys (no secrets) |
| POST | `/api/v1/api-keys/:id/revoke` | `apikeys:manage` |  |  | Revoke a key with a reason |

### `api/src/audit/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/audit/events` | `audit:read` |  |  | Page the tenant audit chain |
| GET | `/api/v1/audit/verify` | `audit:read` |  |  | Recompute the tenant chain; report first broken seq |

### `api/src/auth/dev-outbox.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/dev/outbox` | public |  |  | Dev/test mail outbox (registered only when the dev outbox is enabled) |

### `api/src/auth/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/auth/csrf` | public |  | auth | Issue CSRF cookie and token |
| POST | `/api/v1/auth/login` | public |  | auth | Password login (lockout, dummy verify) |
| POST | `/api/v1/auth/mfa/verify` | public |  | auth | Verify TOTP or recovery code |
| POST | `/api/v1/auth/mfa/enroll/start` | public |  | auth | Start TOTP enrolment |
| POST | `/api/v1/auth/mfa/enroll/verify` | public |  | auth | Finish TOTP enrolment |
| POST | `/api/v1/auth/refresh` | cookie-session |  | auth | Rotate refresh token; reuse revokes family |
| POST | `/api/v1/auth/logout` | cookie-session |  | auth | Revoke refresh family |
| POST | `/api/v1/auth/forgot` | public |  | auth | Request reset mail (same answer for unknown emails) |
| POST | `/api/v1/auth/reset` | public |  | auth | Reset password; revokes all sessions |
| POST | `/api/v1/auth/invites/inspect` | public |  | auth | Check an invite token |
| POST | `/api/v1/auth/invites/accept` | public |  | auth | Accept an invite |
| POST | `/api/v1/auth/change-password` | authenticated |  | auth | Change own password (own lockout) |
| GET | `/api/v1/me` | authenticated |  |  | Current user, role, tenant |

### `api/src/auth/users-routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/users` | `users:read` |  |  | List tenant users |
| POST | `/api/v1/users/invites` | `users:manage` |  |  | Invite a user (rank-based role assignment) |
| GET | `/api/v1/users/invites` | `users:read` |  |  | List invites |
| DELETE | `/api/v1/users/invites/:id` | `users:manage` |  |  | Revoke an invite |
| PATCH | `/api/v1/users/:id/role` | `users:manage` |  |  | Change a user role |
| POST | `/api/v1/users/:id/mfa/reset` | `users:manage` |  |  | Reset a user MFA enrolment |
| POST | `/api/v1/users/:id/disable` | `users:manage` |  |  | Disable a user |
| POST | `/api/v1/users/:id/enable` | `users:manage` |  |  | Re-enable a user |

### `api/src/claims/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/claims` | `claims:read` | `claims.read` |  | List, search, filter, sort claims |
| GET | `/api/v1/claims/:id` | `claims:read` | `claims.read` |  | Claim detail |
| GET | `/api/v1/claims/:id/packet` | `claims:read` |  |  | Current packet with findings, sources, timeline, integrity |
| POST | `/api/v1/claims/:id/assign` | `claims:assign` |  |  | Assign a claim |
| POST | `/api/v1/claims/:id/packet/revisions` | `packets:edit` |  |  | Edit: create a new packet revision |
| POST | `/api/v1/claims/:id/packet/approve` | `packets:approve` |  | analysis | Approve (reason, content hash, four-eyes) |
| POST | `/api/v1/claims/:id/packet/reject` | `packets:approve` |  | analysis | Reject (reason, four-eyes) |
| POST | `/api/v1/claims/:id/packet/send` | `demands:send` |  | analysis | Mark send-ready after hash match (sends nothing) |
| POST | `/api/v1/claims/analyze-awaiting` | `claims:analyze` |  | analysis | Bulk analyze AWAITING_ANALYSIS claims |
| POST | `/api/v1/claims/:id/analyze` | `claims:analyze` |  | analysis | Analyze one claim into packet revision 1 |
| GET | `/api/v1/approvals` | `claims:read` |  |  | Approval queue |

### `api/src/exports/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/exports/claims` | `export:claims` | `exports.claims` | export | Stream claims as CSV/XLSX |
| GET | `/api/v1/exports/packets` | `export:packets` |  | export | Stream packet findings |
| GET | `/api/v1/exports/outcomes` | `export:outcomes` |  | export | Stream decision history (approvals rows) |

### `api/src/imports/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| POST | `/api/v1/imports` | `import:run` | `imports.write` |  | Create an import batch |
| GET | `/api/v1/imports` | `import:run` | `imports.write` |  | List batches |
| GET | `/api/v1/imports/:batchId` | `import:run` | `imports.write` |  | Batch detail |
| GET | `/api/v1/imports/:batchId/documents/:docId` | `import:run` | `imports.write` |  | Document detail with fields |
| GET | `/api/v1/imports/:batchId/documents/:docId/original` | `import:run` |  |  | Proxied download of the original |
| PATCH | `/api/v1/imports/:batchId/documents/:docId` | `import:review` |  |  | Set document type |
| POST | `/api/v1/imports/:batchId/documents/:docId/fields` | `import:review` |  |  | Add a field manually |
| POST | `/api/v1/imports/:batchId/documents/:docId/fields/:fieldId/resolve` | `import:review` |  |  | Confirm, correct or reject a field |
| POST | `/api/v1/imports/:batchId/documents/:docId/accept` | `import:review` |  |  | Accept a document (four-eyes) |
| POST | `/api/v1/imports/:batchId/documents/:docId/reject` | `import:review` |  |  | Reject a document |
| GET | `/api/v1/reviews` | `import:review` |  |  | Document review queue |
| POST | `/api/v1/imports/:batchId/commit` | `import:run` |  | upload | Commit accepted documents to claims |
| GET | `/api/v1/claims/:id/documents` | `claims:read` | `claims.read` | upload | Documents linked to a claim |
| POST | `/api/v1/imports/:batchId/documents` | `import:run` | `imports.write` | upload | Upload a file (sniffed, sandbox-parsed) |

### `api/src/intelligence/charge-routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/claims/:id/charge-lines` | `claims:read` |  | intelligence | Charge-line suggestions for a claim |
| GET | `/api/v1/charge-labels` | `claims:read` |  | intelligence | List team charge labels |
| PUT | `/api/v1/charge-labels` | `charge_labels:manage` |  | intelligence | Set a team charge label |
| DELETE | `/api/v1/charge-labels/:id` | `charge_labels:manage` |  | intelligence | Delete a team charge label |

### `api/src/intelligence/fuel-routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/fuel-tables` | `claims:read` |  | intelligence | List fuel-surcharge tables |
| POST | `/api/v1/fuel-tables` | `settings:manage` |  | intelligence | Create a fuel table |
| PUT | `/api/v1/fuel-tables/:id` | `settings:manage` |  | intelligence | Update a fuel table |
| DELETE | `/api/v1/fuel-tables/:id` | `settings:manage` |  | intelligence | Archive a fuel table |
| GET | `/api/v1/claims/:id/fuel-check` | `claims:read` |  | intelligence | Fuel-surcharge check for a claim |
| PUT | `/api/v1/claims/:id/fuel-inputs` | `claims:analyze` |  | intelligence | Set ship date, miles, fuel table |
| DELETE | `/api/v1/claims/:id/fuel-inputs` | `claims:analyze` |  | intelligence | Remove fuel inputs |

### `api/src/intelligence/outlook-routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/outlook` | `claims:read` |  | intelligence | Cost outlook from public price series |

### `api/src/intelligence/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/features` | `claims:read` |  | intelligence | Tenant-visible feature flags |
| GET | `/api/v1/intelligence/worklist` | `claims:read` |  | intelligence | Prioritised worklist (priority-v1) |
| GET | `/api/v1/claims/:id/similar` | `claims:read` |  | intelligence | Similar past claims (similar-v1) |
| GET | `/api/v1/claims/:id/provenance` | `claims:read` |  | intelligence | Provenance summary |

### `api/src/ocean-dd/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/dd/tariffs` | `claims:read` |  | intelligence | List D&D tariffs |
| POST | `/api/v1/dd/tariffs` | `dd_tariffs:manage` |  | intelligence | Create a D&D tariff |
| PUT | `/api/v1/dd/tariffs/:id` | `dd_tariffs:manage` |  | intelligence | Update a D&D tariff |
| GET | `/api/v1/dd/calendars` | `claims:read` |  | intelligence | List terminal calendars |
| POST | `/api/v1/dd/calendars` | `dd_tariffs:manage` |  | intelligence | Create a calendar |
| PUT | `/api/v1/dd/calendars/:id` | `dd_tariffs:manage` |  | intelligence | Update a calendar |
| GET | `/api/v1/dd/invoices` | `claims:read` |  | intelligence | List D&D invoices |
| POST | `/api/v1/dd/invoices` | `dd_invoices:manage` |  | intelligence | Create a D&D invoice |
| GET | `/api/v1/dd/invoices/:id` | `claims:read` |  | intelligence | D&D invoice detail with live preview |
| PUT | `/api/v1/dd/invoices/:id` | `dd_invoices:manage` |  | intelligence | Update a draft D&D invoice |
| DELETE | `/api/v1/dd/invoices/:id` | `dd_invoices:manage` |  | intelligence | Delete a draft D&D invoice |
| POST | `/api/v1/dd/invoices/:id/audit` | `claims:analyze` |  | analysis | Run the audit; creates OCEAN_DD claim and packet rev 1 |

### `api/src/platform/dashboard-routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/platform/pipeline` | `platform:health` |  | platform | Cross-tenant pipeline counts and durations |
| GET | `/api/v1/platform/telemetry` | `platform:health` |  | platform | Metrics registry snapshot |
| GET | `/api/v1/platform/logs` | `platform:logs` |  | platform | Derived log ring buffer |
| GET | `/api/v1/platform/flags` | `platform:flags` |  | platform | Feature flags |
| PUT | `/api/v1/platform/flags/:key` | `platform:flags` |  | platform | Change a flag (reason, version) |
| GET | `/api/v1/platform/eval/runs` | `platform:eval` |  | platform | Evaluation runs |
| GET | `/api/v1/platform/eval/runs/:id` | `platform:eval` |  | platform | Evaluation run detail |
| GET | `/api/v1/platform/audit/events` | `platform:audit` |  | platform | Platform audit chain |
| GET | `/api/v1/platform/audit/verify` | `platform:audit` |  | platform | Verify platform chain |

### `api/src/platform/routes.ts`

| Method | Path | Access | API-key scope | Rate group | Purpose |
|---|---|---|---|---|---|
| GET | `/healthz` | public |  |  | Liveness |
| GET | `/readyz` | public |  |  | Readiness |
| GET | `/api/v1/platform/health` | `platform:health` |  |  | Platform health |
| GET | `/api/v1/platform/tenants` | `platform:tenants:list` |  |  | List tenants |
| GET | `/api/v1/platform/tenants/:tenantId/claims` | `platform:cross_tenant_read` |  |  | Audited read-only cross-tenant claim read |
