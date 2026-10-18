# ADR 0004: Hash-chained, append-only audit trail written in the business transaction

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-08 (`35945d5`, `207479a`; fail-closed proof in `cf075e7`)
- **Reconstructed from:** `api/src/audit/audit.ts`, `api/src/audit/chain.ts`, `api/src/audit/routes.ts`,
  `packages/shared/src/audit-actions.ts`, migration triggers `audit_events_append_only` and
  `audit_events_no_truncate`, `ARCHITECTURE.md` "Audit hash chain", threat model T10

## Context

Freight disputes are adversarial. When a shipper sends a demand built from our packet, the carrier may contest
who approved it, what it said at approval time and whether anyone altered it afterwards. Buyers in this market
also ask for an audit trail during security review.

## Decision

- One chain per tenant (`chain_key = t:<tenantId>`) and one `platform` chain.
  `hash_n = SHA-256(hash_{n-1} + "\n" + canonicalJson(event_n))`, genesis is 64 zeros, and `seq` is contiguous
  under `pg_advisory_xact_lock(hashtextextended(chain_key, 0))`.
- Every mutating handler appends its event inside the same database transaction as the business change. If the
  append fails, the whole request fails with 500 and nothing changes.
- Triggers refuse UPDATE, DELETE and TRUNCATE on `audit_events` (and on `approvals`, `login_attempts` and the
  packet child tables) for every role, including the owner. Only the dev/test seed reset bypasses them.
- Metadata passes a whitelist, so document content and secrets never enter the chain.
- `GET /api/v1/audit/verify` recomputes the chain and reports the first broken `seq`.

## Consequences

- Every write serialises on its tenant's chain lock. That is a throughput ceiling per tenant; it has not been
  measured.
- Approvals are tamper-evident from inside the application. Someone with a database superuser account could
  still rewrite a chain from genesis, because no chain head is anchored externally yet (threat model T10
  residual; a WORM export is a known gap).
- The audit index on `(tenant_id, target_type, target_id)` (migration `20261017000000_audit_target_index`) lets
  four-eyes checks read authorship from the chain (ADR 0005).
