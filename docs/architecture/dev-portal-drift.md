# Developer portal drift

> **Status.** Pre-product, synthetic data only, never deployed. Compared on 2026-10-17:
> `developer-portal/openapi.json` and `developer-portal/docs/*.md` in the main checkout (the build worktree's
> copy is identical after JSON normalisation) against the TypeScript API on `feat/hardening` (`ed3d126`).

## 1. The short version

The developer portal and the TypeScript API describe two different products. The portal documents the
**Python reference service** (`src/freight_recovery/api/main.py`): five operations, operator-issued `frk_`
keys, a synchronous "upload three files, get a packet back" call, no rate limiting. Its OpenAPI file is
generated from that FastAPI app, and CI keeps it honest against the Python code
(`python developer-portal/build.py --check` in `.github/workflows/ci.yml`, job `developer-portal`). Nothing
checks it against the TypeScript API, which is the product we would actually ship. The overlap is zero
paths: no route in `openapi.json` exists in the TS API, and no TS route appears in the portal.

The portal is accurate about what it covers, and its "pre-product" warnings are correct. The problem is
scope. A buyer or integrator who reads it will form a wrong picture of authentication, error shapes, rate
limits and, most importantly, of what a machine client can do.

## 2. What the portal documents that the TS API lacks

| Portal item (source) | Python behaviour | TS API today |
|---|---|---|
| `POST /v1/analyze` (`openapi.json`) | Multipart upload of up to 10 files; returns extracted values, findings, totals, Markdown packet and draft letter in one response | No equivalent. The TS flow is batch, upload, review, commit, then analyze, across several routes. `POST /claims/:id/analyze` takes no files, and **no API-key scope opens it** |
| `POST /v1/analyze/text` | Inline JSON documents | No equivalent; uploads are one `application/octet-stream` body per file |
| `GET /v1/analyses`, `GET /v1/analyses/{analysis_id}` | Paged list and fetch of stored analyses | Closest: `GET /api/v1/claims` and `GET /api/v1/claims/:id` (scope `claims.read`). The packet itself (`GET /claims/:id/packet`) is **not** open to keys |
| `GET /health` returning `{status, version}` | Anonymous | `GET /healthz` returns `{status}` only; the versioned route is `GET /api/v1/platform/health` and needs `platform:health` |
| `X-API-Key` header (`authentication.md`) | Accepted, as is `Authorization: Bearer` | Only `Authorization: Bearer fr_live_...` is recognised as a key |
| Key format `frk_<8 hex>_<43 chars>` | HMAC-SHA256 with a pepper | `fr_live_<keyId>_<secret>`, also HMAC with a pepper, but a different prefix and layout (`api/src/apikeys/key-material.ts`) |
| Keys issued by an operator CLI (`python -m freight_recovery.admin issue-key`) | No self-service | OWNER or ADMIN create, list and revoke keys in the app or through `/api/v1/api-keys`, with scopes and optional expiry |
| `401` for no key, `403` for any invalid key | Fixed messages | An invalid, revoked or expired key answers **401** with one identical body; `403` means "route not open to keys" or "scope missing" (`api/src/auth/api-key-auth.ts`) |
| Error body `{"detail": ...}` (`errors.md`) | FastAPI shape | `{"error": {"code", "message", "requestId", "details?"}}` with stable machine-readable codes (`sendError` in `api/src/app.ts`) |
| "No rate limiting, never returns 429" (`rate-limits.md`) | True for Python | A global per-address budget, per-group budgets, a per-key budget and an IP failure gate, all answering 429 with `Retry-After` |
| Limits: 10 files, 10 MiB per file, 25 MiB body, 30 s parse, 1024 MB worker | `FR_SANDBOX_*` | 10 files per batch, 10 MiB per file (ceiling 25 MiB), 20 s parse timeout, 256 MB worker memory, 50 PDF pages, a 1 GiB storage quota per tenant (`api/src/config.ts`) |
| `perspective` = `shipper` or `carrier` per request | Request field | Stored on the claim as `SHIPPER` or `CARRIER`; no key-accessible route takes it as a parameter |

## 3. What the TS API has that the portal does not mention

The portal covers none of the 97 TS routes, because they do not exist in the Python service. The groups an
integrator or a buyer's diligence team would look for are below; the full list is in
[api-surface.md](api-surface.md).

- **Import pipeline** (`/api/v1/imports/...` and `/reviews`, 14 routes): batches, per-file upload with type
  sniffing and a sandboxed parse, field-level review, four-eyes document acceptance, commit to claims. Five
  of these routes accept keys (`imports.write`).
- **Claims, packets and approvals** (11 routes): list and filter, packet revisions, approve, reject and
  send-ready with reasons, content-hash binding and four-eyes, single and bulk analyze.
- **Exports** (3 routes): streaming CSV and XLSX of claims, packet findings and decision history with formula
  neutralisation. `GET /exports/claims` accepts keys (`exports.claims`).
- **Intelligence** (16 routes): worklist, similar claims, provenance, charge-line suggestions and team labels,
  fuel tables and fuel check, cost outlook from public FRED series, tenant-visible feature flags.
- **Ocean demurrage and detention** (12 routes under `/api/v1/dd`): tariffs, calendars, invoices and an audit
  run against 46 CFR 541 and 545.5 that creates an `OCEAN_DD` claim.
- **Tenant administration and audit**: users, invites, roles, MFA reset, API keys, audit chain and verify.
- **Session auth for people** (13 routes): CSRF, login, TOTP MFA, refresh rotation, recovery, invites.

## 4. Recommendation

We recommend that the portal document the TypeScript API and that the Python service's pages move to an
"internal reference implementation" note. Three facts drive this. The TS API is the stack the owner chose for
everything customer-facing. A machine-readable contract already exists in `@fr/shared` (Zod schemas for every
request and response), so generating a spec is cheap. And a buyer's technical due diligence will compare the
portal with the running product; today that comparison fails on every route.

In this order:

1. **Stop the misleading signal (docs only).** Add a banner to `developer-portal/docs/index.md` saying the
   pages describe the Python reference service, not the product API, and link to an interim TS route list
   such as [api-surface.md](api-surface.md). No code change.
2. **Generate OpenAPI 3.1 from the TS routes.** Convert the Zod schemas attached to each `defineRoute` call
   (Zod 4 ships JSON Schema output) and emit `developer-portal/openapi.json` from a script, with access kind,
   permission and API-key scope as vendor extensions (`x-fr-permission`, `x-fr-api-key-scope`). Publish the 9
   key-accessible routes first; the session routes only if we decide the web app's API is public.
3. **Move the drift check to the TS side.** Replace the Python `build.py --check` gate with a check in
   `web-ci.yml` that fails when the generated document differs from the committed one, the same contract the
   Python job enforces today.
4. **Rewrite the narrative pages** (`authentication.md`, `errors.md`, `rate-limits.md`, `quickstart.md`,
   `sdk.md`) for `fr_live_` keys, the `{"error": {...}}` shape, the 401 versus 403 rules, real 429 behaviour and
   the batch-upload flow.
5. **Settle the machine-client boundary before publishing** (first open question). With today's scopes an
   integration can push documents and read claim summaries, but it cannot trigger analysis, read a packet or
   record a decision. That can be the right line for a human-in-the-loop product. The portal should then state
   it plainly instead of implying the Python one-call flow.

These are changes to `developer-portal/` and a new script under `api/` or `tools/`; none is in this
worktree's ownership, so we only recommend them here.

## 5. Open questions

- Should an API-key scope open `GET /claims/:id/packet` (read the packet) and `POST /claims/:id/analyze`? Today
  neither is possible by design. The approve, reject and send routes should stay human-only either way.
- Do we keep the Python FastAPI service runnable as a documented local demo, or reduce it to the parity oracle
  and retire its portal pages?
- Is the per-key rate limit a published, per-plan number? The portal should not state limits that pricing has
  not fixed.
