# Use of funds

Date: 2026-10-17. Status: draft for owner review. Model: `financial/model.xlsx`, tab Cash Flow (funding requirement and use-of-seed sections). Base case unless stated. The company, scoup.ai, is pre-product with no revenue; the amounts below are sized from the operating plan, not from a target valuation.

## The raise

We are raising a **$7.0M seed in two tranches**, and we plan a **$8.5M Series A** once ARR reaches $2.5M.

| Round | Amount | Timing | Condition |
|---|---|---|---|
| Seed, tranche 1 | $4.0M | At close | - |
| Seed, tranche 2 | $3.0M | Base case around month 23 | Five paying customers, recovery measured on real invoices, ARR above $0.5M |
| Series A | $8.5M | Milestone month 38 in the base case, close by about month 44 | ARR of $2.5M |

The seed size follows from the model. The deepest point of the base-case cash curve before a Series A arriving mid-way through year 4 is $5.76M: cumulative free cash flow is -$4,625.9K at the end of year 3, and half of the year-4 free cash flow (-$2,263.3K / 2 = -$1,131.7K) brings it to -$5,757.6K. With the 20% buffer that is $6.91M, which we round up to $7.0M. The figure includes the explicit segment mix the owner set on 2026-10-17 (shippers and SME importers first, carriers later through a partner). The investor-pack plan asked for $7.5M; the difference comes from removing costs it counted twice and from re-pricing Norwegian salaries at today's exchange rate (`audit.md`, changes C1, C2 and C7).

With both tranches and no Series A, the seed lasts **49 months** in the base case. The Series A milestone falls in month 38, so the seed leaves about six months to close the round plus a further six months of margin. Tranche 1 alone lasts about 32 months.

For orientation only: at the Q1 2026 median US seed pre-money valuation of $18.4M (PitchBook via WaveUp, grade C, not re-verified), $7.0M would buy 7.0 / (18.4 + 7.0) = 27.6% of the company before any option pool. Our round is more than twice the $3.0M median seed in the same source, so the median price may not apply. Terms are for the lead investor.

## Where the seed goes

The table covers years 1 to 3, the period the seed funds before the Series A year. Revenue of $1.8M in the same period covers part of the gross uses, so the seed is drawn down by the net figure.

| Use | $K | Share of gross uses |
|---|---|---|
| Engineering (software, ML / data) | 1,498.0 | 23.2% |
| G&A (founder, finance and legal operations, counsel, office) | 1,340.4 | 20.8% |
| Sales (account executives from year 2, sales engineer, travel, partner commission) | 1,224.8 | 19.0% |
| Cost of revenue (claims analysts, hosting and data, variable cost) | 941.9 | 14.6% |
| Security (engineer, pen tests, SOC 2, insurance) | 835.8 | 12.9% |
| Marketing (hire from year 3, programmes) | 401.1 | 6.2% |
| Working capital (receivables less payables) | 157.1 | 2.4% |
| Equipment | 57.0 | 0.9% |
| **Gross uses** | **6,456.0** | 100% |
| Less revenue earned, years 1-3 | -1,830.1 | |
| **Net use of cash, years 1-3** | **4,625.9** | |
| Seed raised | 7,000.0 | |
| **Remaining at the start of year 4** | **2,374.1** | covers about half of year-4 burn plus the buffer |

The order of priority is the one the earlier use-of-funds plan set, and it still holds: independent security verification and counsel before any real customer data, then design-partner validation, then product hardening and integrations, then go-to-market. In the model this shows as a security engineer and a $120K security programme in year 1, before any sales hire.

## Milestones per tranche

**Tranche 1 ($4.0M, months 0 to about 23) buys evidence.**

1. External penetration test passed and SOC 2 readiness work under way before the first real customer file is loaded.
2. A gold evaluation set of 100+ realistic detention, demurrage and fuel-surcharge cases with known answers, and a measured pass rate on it (business-plan gate G0 and G2).
3. Three to five design partners (mid-market shippers and SME importers) sharing closed historical invoices under NDA, with recoverable dollars measured on their files (gate G1). This replaces the assumed $52K recovered per account.
4. The first paying contingency accounts, human-approved, with recovery rate, time per claim and analyst minutes per claim recorded (gate G3).

**Tranche 2 ($3.0M, from about month 23 to the Series A) buys repeatability.** It is released when five customers pay, recovery is measured on real invoices and ARR passes $0.5M. The base case crosses $0.5M ARR around month 23: 12 + 12 x ($500K - $69.0K) / ($562.1K - $69.0K) = 22.5. We also ask that acquisition cost on the first ten deals be measured and reported, because the plan spends $0.73 of sales and marketing per $1 of new direct ARR, which is far below the $2.00 benchmark (`unit-economics.md`). The money funds the first US account executive and sales engineer, more claims analysts, the platform-fee pricing and the search for a carrier channel partner (carriers start in year 3 in the base case).

**Series A ($8.5M) buys scale.** At $2.5M ARR the plan adds account executives (to nine by year 7), claims staff (to sixteen) and integrations with TMS, ELD and carrier tracking. The base case needs only $2.8M of further equity after the seed (total seven-year need $9.80M including buffer, less $7.0M). We size the Series A at $8.5M because a 20% shortfall in direct accounts won raises the seven-year need to $13.86M, which $7.0M plus $8.5M covers. It does not cover acquisition at paid-media prices: at the $31K pessimistic CAC (Metadata 2026) the seven-year need is $18.67M, at the $2.00 benchmark it is $38.49M, and if every account were a carrier at $7,895 it would be $36.01M.

## If the milestones are missed

The bear case wins about half the base accounts, earns 20% less per account and churns 30% a year. Its ARR at the end of year 2 is $238K, so it never triggers tranche 2. On tranche 1 alone, with headcount held at year-2 levels from year 3, cash runs out around month 33. The bear case reaches the Series A milestone only in month 57. The decision at the tranche-2 checkpoint is therefore a real one: either the measured recoveries and acquisition costs support the plan, or we stop or pivot with roughly a year of tranche-1 money left. This matches the kill triggers in `business/business-plan.md` section 6.

## What changed from earlier versions

The five-year plan (`financial/model/06_use_of_proceeds.csv`) split a $2.5M seed by fixed percentages (security 15%, legal 10%, validation 20%, engineering 35%, go-to-market 10%, reserve 10%) without a cost plan behind it. The investor-pack plan sized a $7.5M seed from its workbook but typed the dollar amounts by function into the sheet. Here every figure above is a formula output of `model.xlsx`; change an input and this table recalculates.
