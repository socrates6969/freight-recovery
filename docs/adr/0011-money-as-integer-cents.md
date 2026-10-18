# ADR 0011: Money is stored as integer cents and computed in exact decimal arithmetic

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-05 in Python ("Money is stored as integer cents plus the exact packet JSON"; `Decimal`
  throughout `rules/`); carried into the TS schema on 2026-10-08 (`35945d5`) and the TS engines on 2026-10-10
  (`d27c4a2`)
- **Reconstructed from:** `api/prisma/schema.prisma` (`*_cents Int` columns), `packages/shared/src/money.ts`,
  `packages/shared/src/decimal.ts`, Python `models.py`, `ARCHITECTURE.md` "Key decisions"

## Context

Detention and accessorial disputes are often worth tens or hundreds of dollars per load. A floating-point
rounding error of one cent, repeated across a batch, makes a letter look careless and invites the carrier to
reject the whole claim.

## Decision

- Every stored amount is an `Int` number of US cents (`amount_claimed_cents`, `recoverable_cents`,
  `pending_review_cents`, `amount_cents`, `total_due_cents`). `currency` defaults to `USD`.
- Rule arithmetic uses exact decimal code (`decimal.ts` in TS, `Decimal` in Python) and converts to cents once.
  Amounts cross the API as strings or integer cents, never as floats.
- Formatting goes through `formatUsdCents` in `@fr/shared`, so the web app and the letter render the same text.
- Analyses whose amounts fall outside the allowed range fail with the reason `amount_out_of_range` instead of
  being stored.

## Consequences

- Sums and comparisons in SQL are exact, which the executive dashboard relies on.
- Multi-currency is not supported; a non-USD invoice would need a currency model and conversion rules.
- A 32-bit `Int` caps a single amount at about 21.4 million dollars, far above any single freight claim.
