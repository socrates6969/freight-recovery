# Calculator variants for the shipper- and importer-first audience (draft)

> Status: draft spec, not built. It extends `freight-recovery/marketing/landing/calculator-spec.md`
> (main checkout, outside our owned paths), which already defines the principles, the carrier variant
> and a two-input shipper variant. The principles there apply unchanged: user-supplied inputs only, the
> arithmetic printed, an order-of-magnitude result with a caveat, deterministic and client-side. This
> file adds what the owner's 2026-10-17 shipper- and importer-first decision needs: a fuller shipper
> variant and a new importer (D&D) variant. Whoever owns `marketing/landing/` should merge it there.
> The worked examples use invented numbers to show the arithmetic; they are not benchmarks.

## Shipper variant (replaces the two-input version)

The existing shipper variant multiplies spend by an accessorial share and a suspected-unsupported
share. We have no shipper interviews yet, but the lines in dispute differ in kind, so the variant names
both: accessorial lines with no authorizing clause, and detention billed above what
the timestamps support.

Inputs (all user-supplied): truckload and LTL invoices paid per year `N`; share of invoices carrying
at least one accessorial or detention line `a` (0 to 1); average accessorial and detention dollars on
such an invoice `d`; share of those dollars the user suspects are not supported by the rate
confirmation or the timestamps `u` (0 to 1; if unknown, the page explains how to sample one month of
invoices to estimate it).

```
accessorial_and_detention_paid = N x a x d
possibly_unsupported           = accessorial_and_detention_paid x u
```

Output: `possibly_unsupported` per year, labelled "dollars you may be paying that your rate
confirmations or timestamps do not support; some will turn out to be legitimate, and not all are
recoverable".

Worked example (illustration): `N = 6,000`, `a = 0.15`, `d = 180`, `u = 0.20`.
- `accessorial_and_detention_paid = 6,000 x 0.15 x 180 = 162,000`
- `possibly_unsupported = 162,000 x 0.20 = 32,400`

## Importer variant (new): container D&D

The FMC billing rule sets content and timing requirements for D&D invoices, and the billed party has
30 calendar days from issuance to request mitigation, refund or waiver (Thompson Hine, source line in
`research/04-gaps.md`, gap 3; only 46 C.F.R. 541.4 was vacated in September 2025). The calculator does
not decide whether any invoice is valid. It sizes what is at stake and how much of it is time-limited.

Inputs (all user-supplied): D&D invoices received per year `I`; average amount per invoice `m`; share
of invoices the user suspects are late, missing required fields, or charged for days the container
could not be moved `q` (0 to 1); share of invoices the user currently reviews within 30 days of
issuance `w` (0 to 1).

```
dd_paid                 = I x m
questionable            = dd_paid x q
questionable_unreviewed = questionable x (1 - w)
```

Output: `questionable` per year, and `questionable_unreviewed`, labelled "the part you would currently
let pass the 30-day window". The page adds: "Whether a charge is owed depends on the invoice, the
contract and the facts; confirm with counsel or your customs broker."

Worked example (illustration): `I = 300`, `m = 900`, `q = 0.25`, `w = 0.40`.
- `dd_paid = 300 x 900 = 270,000`
- `questionable = 270,000 x 0.25 = 67,500`
- `questionable_unreviewed = 67,500 x (1 - 0.40) = 40,500`

## Caveat block (shipper and importer)

"This is arithmetic on the numbers you entered, not a prediction, a quote or legal advice. What is
recoverable depends on your contracts, the evidence and the counterparty, and fees apply. We have not
validated recovery rates on real customer data. To replace estimates with facts, share three months of
paid invoices (read-only, under an NDA we agree first) and we will review them at no cost."

## Acceptance tests (when built)

- Both worked examples produce exactly the stated outputs (decimal or integer arithmetic for money).
- Shares outside 0..1, negative or non-numeric inputs are rejected with a plain message.
- No network request until the lead form is submitted; same inputs always give the same output.
- The importer page shows the FMC source line and the "confirm with counsel or your customs broker"
  sentence next to the result.
