# ADR 0006: Scoped tenant API keys bound to their creator's current role

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-09 (`a405edd` "tenant API keys (R80-R82, HMAC-only storage, scoped machine auth on nine
  routes, revocation without cache, attribution, abuse ...)"); fix rounds `1063b72`, `2ee385c`
- **Reconstructed from:** `api/src/auth/api-key-auth.ts`, `api/src/apikeys/*`, `packages/shared/src/api-key-dto.ts`,
  `ARCHITECTURE.md` "Request flow: API key vs cookie/JWT authentication", threat model T35

## Context

Customers will want to push documents from a TMS or a mailbox integration and pull claim data into a finance
system without a person's browser session. Machine credentials are a classic source of over-privilege: a key
created by an admin keeps admin power after that admin leaves.

## Decision

- Format `fr_live_<keyId>_<secret>`. Only `HMAC-SHA256(pepper, secret)` is stored; the pepper lives outside the
  database. The secret is shown once.
- A key is presented only as `Authorization: Bearer fr_live_...`. A key in the URL is refused with 400 and not
  logged. Key requests never use cookies or CSRF.
- At most three scopes exist (`claims.read`, `exports.claims`, `imports.write`), each mapped to one tenant
  permission. A route must opt in, and only 9 routes do.
- On every request: per-IP failure gate, constant-time compare (dummy digest for unknown ids), revocation and
  expiry read from the database without a cache, scope check, and a check that the creator's **current** role
  still holds the scope's permission. Disabled creator, downgraded role or suspended tenant: 401.
- Only OWNER and ADMIN manage keys, and a creator can grant only scopes they hold. Audit events carry actor role
  `API_KEY` and `viaApiKey`.

## Consequences

- Offboarding a person disables their keys automatically while they are disabled. Re-enabling the person
  re-enables the keys; revoking keys on disable is open question OQ-H3.
- Machine clients cannot analyze, read packets or decide. That keeps humans in the loop but limits integrations
  (see `docs/architecture/dev-portal-drift.md`).
- The per-key database read on every request costs latency; it has not been measured.
