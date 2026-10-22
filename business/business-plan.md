# Scoup business plan

> **Status, 22 October 2026: pre-revenue.** No customers, no pilots, no measured recovery
> rate. The product has run only on synthetic and public reference data. Company numbers are
> plan inputs or model outputs from `investor-pack/scoup-financial-model.xlsx` and are
> labelled as such. Outside figures are footnoted; the full ledger is in
> [`data-and-sources.md`](data-and-sources.md). The detailed business model is in
> [`business-model.md`](business-model.md).

## 1. What Scoup is

Scoup is a set of software agents that check every freight invoice a company receives and
turn each real overcharge into a claim the company can send. A person approves every claim.

The first customers are mid-market US shippers ($5-50M a year of freight) and small and
mid-size importers who pay ocean container charges. They pay Scoup out of the money it
recovers, and later a platform fee.

## 2. The problem

Freight bills are many, small and hard to check. A truckload invoice can carry detention,
lumper, layover and fuel surcharge lines; an ocean carrier's demurrage and detention (D&D)
invoice must meet federal content and timing rules.[^cfr] Each line is cheap to pay and
expensive to dispute by hand, and the dispute windows are short: 180 days to contest a truck
freight bill,[^13710] at least 30 days to ask an ocean carrier for a D&D refund.[^cfr]

The money involved is large. US logistics costs were $2.40 trillion in 2025, 36.8% of it
trucking.[^cscmp] ATRI puts the 2023 cost of truck detention at $15.1 billion and found that
fewer than half of detention invoices were paid.[^atri] Nine ocean carriers collected about
$15.4 billion of D&D over five years to March 2025.[^fmc] These numbers show scale. They are
not money Scoup can recover; most of it is correctly billed. How much is billed wrongly is
the first thing Scoup must measure.

## 3. The product: five agents and a person

![Agent pipeline](figures/agent-pipeline.png)

*Figure 1. How the agents find an overcharge and turn it into a claim. Source: Scoup product
design; a description, not a performance claim.*

1. **Intake agent** reads invoices, bills of lading, rate confirmations and emails, and
   records the page and line behind every fact.
2. **Contract and tariff agent** finds the terms that apply: rate, free time, fuel table,
   accessorial rules, carrier tariff.
3. **Audit checks** re-rate the invoice with plain, tested code: duplicates, fuel surcharge
   against the EIA diesel week, detention clock, D&D invoice rules. No AI computes money.
4. **Evidence and claim agent** builds a cited evidence packet and a draft dispute, with the
   deadline.
5. **Reviewer agent** re-checks every number and citation and rejects what it cannot trace.

Then a person reads the packet and decides whether to send it.

Why agents: they let Scoup check **every** invoice instead of a sample, flag a claim the day
the bill arrives instead of near the deadline, cut the analyst time behind a small claim to
minutes, and add an independent check before a person signs off. None of these effects has
been measured on real invoices yet; section 7 sets the gates that will measure them.

## 4. How Scoup makes money

| Base case, per account | Year 1 | Year 3 | Year 5 | Year 7 |
|---|---|---|---|---|
| Money recovered for the customer | $52K | $85K | $105K | $115K |
| Scoup's share | 25% | 14% | 12% | 12% |
| Platform fee | $0 | $10K | $15K | $17K |
| **Scoup revenue per account** | **$13.0K** | **$21.9K** | **$27.6K** | **$30.8K** |

*Source: investor-pack/scoup-financial-model.xlsx, Assumptions rows 13-16. All inputs are
assumptions.*

Unit economics in year 3 (base): 64% gross margin, 20% annual churn, about $14.9K to win an
account, lifetime gross profit 4.7 times acquisition cost, cost repaid in about 13 months.
These rest on spending $0.68 of sales cost per $1 of new ARR. The 2024 software median was
$2.00;[^bm] at that level the ratio falls to 1.6x. Sales efficiency is the plan's biggest
risk. Details: [`business-model.md`](business-model.md), sections 4-5.

## 5. Market

Sized bottom-up as accounts x revenue per account: about **$0.95 billion a year** for
shippers and importers (32,765 accounts) and **$1.86 billion** including carriers and brokers
(133,256 accounts). The base case reaches 605 accounts in year 7, about 1.8% of the
serviceable accounts. See [`market-analysis.md`](market-analysis.md).

## 6. Go-to-market

1. **Design partners (months 0-6).** Three to five shippers or importers share closed
   invoices under a written data agreement. Scoup reports what it would have recovered. No
   fee.
2. **Paid pilots (months 6-18).** Live invoices; 25% of recoveries; a person approves each
   claim.
3. **Platform fee and first US sales hire (year 2).**
4. **Partners (years 2-3).** Customs brokers and forwarders for importers; factoring and ELD
   companies for small carriers.

## 7. Gates (evidence before money)

| Gate | Evidence required | Stop or change course if |
|---|---|---|
| G0 Test set | 100+ realistic cases with known answers, labelled synthetic | No reliable answer key can be built |
| G1 Leakage | One design partner's closed files show material, evidence-backed overcharges | Recoverable money is under about 0.25% of freight spend |
| G2 Agent quality | Reviewer agent catches seeded errors; zero invented citations on held-out cases; review minutes per claim measured | The reviewer cannot be made reliable, or review takes too long to pay |
| G3 Paid pilots | Three or more customers paying a share of recoveries | Customers will not share data or pay |
| G4 Repeatability | Ten or more accounts; acquisition cost and churn measured | Cost repaid in more than 24 months |
| G5 Series A | ARR of about $2.5M (Carta's 2025 median at Series A was $2.8M)[^carta] | - |

## 8. Financing

The model plans a $7.5 million seed in two tranches and an $8.5 million Series A at
$2.5 million ARR. Recalculated on 22 October 2026, the base case reaches that ARR in month 38;
base-case EBITDA turns positive in year 7 ($1.3M). The downside case does not reach
break-even within seven years. See [`../financial/model.md`](../financial/model.md).

![Revenue model](figures/revenue-model.png)

*Figure 2. Seven-year plan in three cases. Source: scoup-financial-model.xlsx, recalculated
22 Oct 2026. A plan, not a forecast.*

## 9. Main risks

Too few real errors; sales cost near the industry median; slow review; customers unwilling to
share data; Loop or Intelligent Audit moving down-market with a dispute product; a legal
mistake in a sent claim. Each has a test and a response in
[`business-model.md`](business-model.md), section 10. One further gap: no one on the team has
yet run freight audit for a living; a freight-operations lead is the first hire (see
`hiring/README.md`).

---

[^cfr]: eCFR, 46 CFR Part 541, https://www.ecfr.gov/current/title-46/chapter-IV/subchapter-B/part-541, current through 2026-10-15, checked 2026-10-19.
[^13710]: 49 U.S.C. § 13710(a)(3)(B), https://www.law.cornell.edu/uscode/text/49/13710, accessed 2026-10-22.
[^cscmp]: CSCMP / Kearney, State of Logistics 2026, via SCDigest, https://www.scdigest.com/firstthoughts/26-06-26.php?cid=23144, published 2026-06-26, accessed 2026-10-22.
[^atri]: ATRI, https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, published 2024-09-10, accessed 2026-10-19.
[^fmc]: Federal Maritime Commission, https://www.fmc.gov/detention-and-demurrage/, data 2020-04-01 to 2025-03-31, accessed 2026-10-19.
[^bm]: Benchmarkit, 2025 SaaS Performance Metrics, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-22.
[^carta]: Carta, "ARR at Series A", https://carta.com/data/newsletter-arr-at-series-a/, 2026, accessed via search index 2026-10-22 (secondary).