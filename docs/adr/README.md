# Architecture decision records

These records reconstruct decisions already made in the code of the TypeScript monorepo
(`ventures/freight-recovery-build`, branch `feat/hardening`, `ed3d126`) and its commit history. Each is marked
**accepted (retroactive)**: nobody wrote it at the time; we wrote it on 2026-10-17 from the code, the commits and
`ARCHITECTURE.md`. Where the repository does not record the alternatives that were weighed, the ADR says so
rather than inventing a debate. The product is pre-product, synthetic data only and never deployed.

| ADR | Decision | Decided |
|---|---|---|
| [0001](0001-typescript-platform-fastify-prisma-postgres.md) | TypeScript monorepo on Fastify 5, Prisma 7, PostgreSQL 16, React 19, with `@fr/shared` | 2026-10-08 |
| [0002](0002-rls-fail-closed-tenancy.md) | Tenant isolation in three fail-closed layers anchored in PostgreSQL RLS | 2026-10-08 |
| [0003](0003-python-core-kept-as-reference.md) | Python core kept as reference and exact-parity oracle | 2026-10-09/10 |
| [0004](0004-hash-chained-append-only-audit.md) | Hash-chained, append-only audit written in the business transaction | 2026-10-08 |
| [0005](0005-four-eyes-separation-of-duties.md) | Four-eyes separation of duties on claim and document decisions | 2026-10-09, extended 10-11 and 10-12 |
| [0006](0006-scoped-tenant-api-keys.md) | Scoped tenant API keys bound to the creator's current role | 2026-10-09 |
| [0007](0007-human-approval-gate-content-hash.md) | Human approval gate bound to a content hash; nothing is sent | 2026-10-08 |
| [0008](0008-deterministic-engines-no-runtime-model.md) | Deterministic engines; no trained model or LLM at runtime | 2026-10-05 to 10-11 |
| [0009](0009-sandboxed-document-parsing.md) | Untrusted documents parsed in a bounded child process | 2026-10-05 / 10-09 |
| [0010](0010-single-rbac-matrix-declared-route-access.md) | One RBAC matrix; every route declares its access | 2026-10-08 |
| [0011](0011-money-as-integer-cents.md) | Money as integer cents with exact decimal arithmetic | 2026-10-05 / 10-08 |
| [0012](0012-aws-target-infrastructure-not-applied.md) | AWS target infrastructure in Terraform, validated, never applied | 2026-10-08 |

New decisions get the next number and start as `proposed`.
