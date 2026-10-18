# ADR 0001: TypeScript platform on Fastify 5, Prisma 7 and PostgreSQL 16

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-08 (scaffold commits `4798c70` to `b939225`, run `REQ-20261008-webapp-foundation`)
- **Reconstructed from:** `package.json` workspaces, `api/package.json`, `web/package.json`,
  `ARCHITECTURE.md` section "Web platform (TypeScript, steps 1-2)", the owner's stack decision in `BRIEF.md`

## Context

By 2026-10-05 the repository held a working Python service (FastAPI, SQLAlchemy, Alembic) with API-key
tenancy and sandboxed parsing, plus a small Vite pilot dashboard. A sellable product needed far more: people
logging in with MFA, eight roles, a review and approval workflow, imports with field-level review, exports and
an audit trail. Doing that in two languages with two copies of every role and schema would have doubled the
places where a permission or a DTO could drift.

## Decision

We build the customer-facing product as one npm-workspaces monorepo in TypeScript:

- `api/`: Node 22, Fastify 5.12, Prisma 7.10 on PostgreSQL 16, Zod 4 for validation, Pino for logs.
- `web/`: React 19.3 with Vite, React Router 7, TanStack Query 5 and Zustand 5.
- `packages/shared/` (`@fr/shared`): the one place for roles, the permission matrix, DTO schemas, canonical
  JSON and, later, the pure rule engines. Both `api/` and `web/` import it.

Prisma's removed `$use` middleware is replaced by a client extension (see ADR 0002). Node 22 was chosen over
the brief's Node 20 because Node 20 reached end of life; CI pins 22.23.3 in `.nvmrc`.

## Consequences

- One contract package means a role, permission or DTO is defined once. The web app's view of permissions
  cannot disagree with the API's, because it imports the same frozen object (it only hides controls; the API
  enforces).
- Prisma cannot express RLS, CHECKs or triggers, so the security-critical parts of the schema live in
  hand-written SQL migrations next to `schema.prisma`. Reviewers must read both.
- The Python service stays (ADR 0003), so the repository carries two runtimes and two CI workflows
  (`ci.yml`, `web-ci.yml`).
- Hiring and buyer diligence face a mainstream stack. Committed migration folders are immutable by project
  rule, so schema history is linear and reviewable.

## Alternatives

Extending the Python FastAPI service into the full product was the obvious alternative. The commit history
and `ARCHITECTURE.md` do not record a written comparison; the owner's brief for this package fixes the stack
as decided, and we do not reopen it here.
