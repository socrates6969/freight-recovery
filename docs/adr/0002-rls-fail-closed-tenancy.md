# ADR 0002: Tenant isolation in three fail-closed layers, anchored in PostgreSQL RLS

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-08 (`35945d5` "Prisma schema + SQL migration (RLS fail-closed, least-privilege grants,
  append-only triggers)", `207479a`)
- **Reconstructed from:** `api/prisma/migrations/20261008000000_init/migration.sql`, `api/db/init/00-roles.sql`,
  `api/src/db/tenant.ts`, `api/src/auth/session.ts`, `ARCHITECTURE.md` "Tenant isolation (three layers, fail
  closed)", threat model T7 and section 4, `CLAUDE.md` hard rule 2

## Context

The product holds several customers' freight invoices, rate confirmations and dispute packets in one database.
A single missing `WHERE tenant_id = ...` in application code would leak one shipper's carrier rates to another,
which would end the business. The Python service isolated tenants in its repository layer only and named RLS as
"the next layer of defence".

## Decision

Isolation is enforced three times, and each layer refuses access when it lacks information rather than
allowing it:

1. **Database.** Every tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY` with
   `USING/WITH CHECK (tenant_id = fr_current_tenant())`. With no `app.tenant_id` set, queries return zero rows.
   The API connects as `freight_app` (`NOSUPERUSER NOBYPASSRLS NOINHERIT`, not the owner, DML grants only).
   Child tables reference parents by `[id, tenant_id]`.
2. **ORM.** A Prisma client extension (`api/src/db/tenant.ts`) allows only models listed in `TENANT_MODELS`,
   injects `tenantId` into every query and create, throws on a conflicting value and removes raw SQL. Every query
   runs in a transaction that sets `app.tenant_id` locally.
3. **Request.** User, role, tenant status and session liveness are reloaded from the database on every request,
   never trusted from token claims, headers or the body.

A new tenant table must ship with a policy, grants, a `TENANT_MODELS` entry and a cross-tenant test.

## Consequences

- An application bug in one layer does not become a leak; it becomes a 404, an exception or zero rows.
- System-mode code paths (auth bootstrap on `memberships` and `invites`, the eval recorder, the price importer,
  the platform statistics function) are the residual risk the threat model names, and lint restricts where
  `db/system.ts` may be imported.
- Every request costs a few extra queries to reload context; nothing has been load-tested.
- Platform staff roles get no tenant database handle at all, which is also a data-minimisation property buyers
  ask about.

## Alternatives

Schema-per-tenant or database-per-tenant isolation is not discussed in the repository. Application-only
filtering (the Python approach) was the prior state and was explicitly treated as insufficient.
