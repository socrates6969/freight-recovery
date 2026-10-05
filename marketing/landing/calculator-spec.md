# Recovery calculator: specification (lead magnet; not built)

Purpose: give a prospective design partner a transparent, hand-checkable estimate of detention or
accessorial exposure from **their own inputs**, then offer a leakage review on their real closed files.

## Principles

1. **Inputs come from the user.** No pre-filled industry statistics. Where a default helps a user start
   (for example a 2-hour free time), it is labeled "typical contract term, varies; check your rate
   confirmation".
2. **Show the arithmetic.** Print every step with the user's numbers, like the product's evidence
   packet does.
3. **Output is an order-of-magnitude range with a caveat, never a quote or promise.**
4. **Deterministic and reproducible.** Pure function of the inputs; the formula and a worked example
   are published on the page; a unit test pins the worked example.
5. **Client-side only.** Inputs stay in the browser unless the user submits the lead form (and the
   form says exactly what is sent, stored and for how long). Consent for any email capture.

## Carrier variant

Inputs (all user-supplied): loads per year `L`; share of loads with waiting beyond free time `s`
(0 to 1); average billable hours over free time per such load `h`; detention rate per hour `r`
(from rate confirmations); share of that detention currently **billed** `b` (0 to 1); share of billed
detention that is **paid** `p` (0 to 1).

```
detention_earned        = L x s x h x r
detention_collected     = detention_earned x b x p
uncollected_detention   = detention_earned - detention_collected
```

Output: `uncollected_detention` per year, split into "not billed" `detention_earned x (1 - b)` and
"billed but not paid" `detention_earned x b x (1 - p)`, shown with the formula.

## Shipper variant

Inputs: annual freight spend `S`; share of spend that is accessorial `a`; share of accessorial
dollars you suspect are unauthorized or unsupported `u` (user's estimate; if unknown, the page
tells them how to sample 3 months of invoices to find out).

```
accessorial_spend = S x a
exposure          = accessorial_spend x u
```

Output: `exposure` per year, labeled "dollars you may be paying that your rate confirmations do not
support; not all are recoverable and some will be legitimate".

## Worked example (hypothetical numbers, labeled as an illustration on the page)

Carrier: `L = 4000`, `s = 0.20`, `h = 1.5`, `r = 50`, `b = 0.60`, `p = 0.50`.

- `detention_earned = 4000 x 0.20 x 1.5 x 50 = 60,000`
- `detention_collected = 60,000 x 0.60 x 0.50 = 18,000`
- `uncollected_detention = 60,000 - 18,000 = 42,000`
  - not billed: `60,000 x (1 - 0.60) = 24,000`
  - billed but not paid: `60,000 x 0.60 x (1 - 0.50) = 18,000`

(These inputs are invented to demonstrate the arithmetic. They are not benchmarks and must not be
presented as typical.)

Shipper: `S = 20,000,000`, `a = 0.08`, `u = 0.10` -> `accessorial_spend = 1,600,000`, `exposure = 160,000`.

## Caveat block (always shown with the result)

"This is arithmetic on the numbers you entered, not a prediction or a quote. Contract terms, proof
and counterparties determine what is winnable, and fees apply. We have not validated recovery
rates on real customer data. To replace estimates with facts, send 20-50 closed loads (read-only,
under NDA) and we will review them."

## Acceptance tests (when built)

- The worked examples above produce exactly the stated outputs (assert in a unit test; use integer
  or decimal arithmetic, not binary floats, for money).
- Inputs outside 0..1 for shares, negative or non-numeric values are rejected with a plain message.
- Same inputs always give the same output; no network requests occur until the lead form is submitted.
- Page text contains the caveat block, the formula, and the "illustration" label on the example.
