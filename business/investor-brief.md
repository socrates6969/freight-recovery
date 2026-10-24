# scoup.ai investor brief

> **Draft, 22 October 2026. Not an offer of securities.** scoup.ai is pre-revenue: no customers,
> no pilots, no measured recovery rate. The product has run only on synthetic and public
> reference data. Company figures are plan inputs or model outputs and are labelled. Outside
> figures are footnoted and listed in [`data-and-sources.md`](data-and-sources.md). This brief
> replaces the October 2026 memorandum draft, whose withdrawn claims (neural-mesh speed
> figures, unreproduced classifier scores) are not repeated here.

## In one paragraph

Companies that ship freight pay thousands of small, complicated bills: truck detention,
lumper fees, fuel surcharges, ocean container charges. Checking them by hand costs more than
most errors are worth, so the errors get paid. scoup.ai uses six software agents to check every
invoice against the contract, the carrier's tariff and the government diesel index, flag each
overcharge with its evidence, and draft a claim from confirmed findings only. A
person approves every claim. Customers pay a share of what comes back, then a platform fee.

## What the agents do

![Agent pipeline](figures/agent-pipeline.png)

*Figure 1. Intake, Contract & tariff, Audit checks (code), Evidence, Reviewer, Claim draft,
then a person approves. Plain code computes the money. Source: scoup.ai product design; not a performance claim.*

| Agent | Job | Why it matters to the customer |
|---|---|---|
| Intake | Reads every carrier invoice (EDI 210, CSV, extracted fields) into one format | Nothing is sampled |
| Contract & tariff | Picks the contract, lane, fuel table, accessorial terms and claim deadline | The check is against what was agreed |
| Audit checks (code) | Re-rates the invoice: duplicates, line math, linehaul, fuel vs. diesel week, reweigh, class, LTL rate, accessorials, detention | The dollar figure is exact and repeatable |
| Evidence | Attaches the contract clause and documents to each finding | Each line in dispute carries its proof |
| Reviewer | Recomputes every finding independently; checks the claim window; a model second opinion can only be stricter | A second check before a claim exists |
| Claim | Drafts a dispute from confirmed findings only, marked DRAFT, not sent | Claims go out inside the window: 180 days for a truck bill[^13710] |

**Worked example (synthetic).** An invoice bills 2.5 hours of detention at $75 an hour,
$187.50. The rate confirmation gives 2 hours free, then $75 an hour billed by the minute. The gate log
shows the truck held 1 hour 50 minutes past free time. The Audit checks compute $137.50; Evidence
attaches the clause, gate log and calculation; the Reviewer recomputes the $50 and confirms it;
the Claim agent drafts a $50 short-pay; the customer's AP lead sends it. No real invoice was used.

**What is measured so far (synthetic only).** On a **synthetic** test set (135 invented invoices, 45 clean and 90 with one injected overcharge each, seed 20261022), the deterministic team claimed nothing on the 45 clean invoices, flagged all 90 injected overcharges, and put the amount in dispute equal to the injected dollars to the cent; 5 clean invoices went to human review, not to a claim. The same people wrote the test generator and the checks, so these numbers show the rules work as designed. They are **not** a measurement on real invoices; real precision and recall are unknown.[^agents] The agents are unit-tested code,
not yet wired into the API or the web app.

## Why now

Three things changed. Document-reading AI became good enough to read messy invoices and
contracts. Federal rules for ocean D&D invoices (46 CFR Part 541) set content and timing
requirements a machine can check.[^cfr] And trucking margins are thin, which raises the value
of every recovered dollar.

## Scale of the money involved

![Market size](figures/market-size.png)

*Figure 2. Grey bars: spend and charges in the system, mostly billed correctly. Blue bars: the
fee pool scoup.ai could earn. Sources: CSCMP/Kearney 2026, ATRI 2024, FMC 2025, model.*

- US logistics costs: $2.40 trillion in 2025, 36.8% trucking.[^cscmp]
- Truck detention cost: $15.1 billion in 2023; fewer than half of detention invoices
  paid.[^atri]
- Ocean D&D collected by nine carriers: about $15.4 billion, April 2020 to March 2025.[^fmc]
- scoup.ai's fee pool: about $0.95 billion a year for shippers and importers, $1.86 billion with
  carriers and brokers (accounts x revenue per account; see `market-analysis.md`).

## Business model

| Base case, per account | Year 1 | Year 3 | Year 5 | Year 7 |
|---|---|---|---|---|
| Amount won in disputes (plan input) | $52K | $85K | $105K | $115K |
| scoup.ai revenue | $13.0K | $21.9K | $27.6K | $30.8K |

Year 3 unit economics (base): 64% gross margin; 20% churn; acquisition cost about $14.9K;
lifetime gross profit 4.7x acquisition cost; repaid in about 13 months. The plan assumes
$0.68 of sales cost per $1 of new ARR against a 2024 median of $2.00;[^bm] at the median the
ratio is 1.6x. Full detail in [`business-model.md`](business-model.md).

![Unit economics](figures/unit-economics.png)

*Figure 3. Revenue per account: platform fee plus a share of recoveries. Source:
scoup-financial-model.xlsx, recalculated 22 Oct 2026.*

## Plan and financing

| Base case ($M) | Y1 | Y2 | Y3 | Y4 | Y5 | Y6 | Y7 |
|---|---|---|---|---|---|---|---|
| Accounts at year end | 6 | 35 | 103 | 202 | 327 | 462 | 605 |
| Revenue | 0.04 | 0.37 | 1.51 | 3.72 | 7.30 | 11.52 | 16.43 |
| ARR at year end | 0.08 | 0.63 | 2.26 | 4.93 | 9.03 | 13.49 | 18.63 |
| EBITDA | -0.92 | -1.54 | -2.14 | -2.59 | -2.01 | -0.72 | 1.30 |

*Source: scoup-financial-model.xlsx, Base sheet, recalculated 22 Oct 2026. A plan, not a
forecast.*

Proposed rounds (model): **$7.5M seed** in two tranches ($4.0M at close, $3.5M at a
milestone) and an **$8.5M Series A** at $2.5M ARR, which the base case reaches in month 38.
The downside case needs a hiring freeze to stay within the seed; see `../financial/model.md`.

![Revenue model](figures/revenue-model.png)

*Figure 4. Seven-year plan in three cases. Source: scoup-financial-model.xlsx.*

## Competition

Loop (AI freight audit; $95M Series C in April 2026)[^loop], Cass ($190.8M revenue in
2025)[^cass], Intelligent Audit (subscription pricing; small-business parcel product)[^ia],
Trax, CTSI-Global, nVision, and BlueCargo for ocean D&D. The incumbents audit and pay invoices
at scale; none markets a cited, per-charge dispute for mid-market shippers across truck and
ocean bills. Loop and Intelligent Audit could close that gap; scoup.ai's answer is speed and
focus, not a technology lead.

## What we will prove with the seed, in order

1. Overcharges flagged and amount in dispute on real design-partner files.
2. Review minutes per claim with the agents in the loop, and therefore gross margin.
3. That customers pay a share of recoveries, then a platform fee.
4. Acquisition cost for the first ten accounts.

If (1) shows recoverable money under about 0.25% of freight spend, we stop or change segment
before spending the second tranche.

## Team

Founder-led from Norway, selling to US customers. The largest gap is freight-audit operating
experience; a freight-operations lead is the first hire. See `hiring/README.md`.

---

[^agents]: technical/agents.md (origin/master e3fef5f, 22 Oct 2026); reproduce with `npx tsx packages/shared/src/audit-agents/cli.ts --eval`. Synthetic data only.
[^13710]: 49 U.S.C. § 13710(a)(3)(B), https://www.law.cornell.edu/uscode/text/49/13710, accessed 2026-10-22.
[^cfr]: 46 CFR Part 541 (541.5, 541.7, 541.8), https://www.ecfr.gov/current/title-46/chapter-IV/subchapter-B/part-541, current through 2026-10-15, checked 2026-10-19.
[^cscmp]: CSCMP / Kearney, State of Logistics 2026, via SCDigest, https://www.scdigest.com/firstthoughts/26-06-26.php?cid=23144, published 2026-06-26, accessed 2026-10-22.
[^atri]: ATRI, https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, published 2024-09-10, accessed 2026-10-19.
[^fmc]: Federal Maritime Commission, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-19.
[^bm]: Benchmarkit, 2025 SaaS Performance Metrics, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-22.
[^loop]: Loop, https://www.loop.com/article/loop-raises-95m-series-c-to-scale-its-ai-platform-across-the-supply-chain, published 2026-04-17, accessed 2026-10-22.
[^cass]: Cass Information Systems, 8-K exhibit 99.1, https://www.sec.gov/Archives/edgar/data/708781/000070878126000002/cass-20251231xexx991.htm, published 2026-01-22, accessed 2026-10-22.
[^ia]: Intelligent Audit, FAQ, https://www.intelligentaudit.com/faq, accessed 2026-10-22.