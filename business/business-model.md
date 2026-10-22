# scoup.ai business model

> **Status, 22 October 2026.** scoup.ai is pre-revenue. It has no customers, no pilots and no
> measured recovery rate. The product has run only on synthetic and public reference data.
> Every company number below is a plan input or a model output, and is labelled that way.
> Outside facts carry a footnote with the source, URL, publication date and access date.
> Unverified items are listed in [`data-and-sources.md`](data-and-sources.md).

![How the agents find an overcharge and turn it into a claim](figures/agent-pipeline.png)

*Figure 1. The agent pipeline: Intake, Contract & tariff, Audit checks (code), Evidence,
Reviewer, Claim draft, then a person approves. Language models only do judgment; money is
computed by deterministic, tested code. Source: scoup.ai product design. A design description, not a performance claim.*

## 1. The problem, in one example

A mid-size importer brings in containers through Long Beach and moves them inland by truck.
In one month it gets three kinds of bills it cannot easily check:

- **A truck carrier's invoice** with $187.50 of detention and a $150 lumper fee. Was the truck
  really held past free time? Is the lumper receipt attached? Does the rate confirmation allow
  either charge?
- **A fuel surcharge** on every truckload. The contract says the surcharge follows the US
  Energy Information Administration's weekly diesel price. Did the carrier use the right week
  and the right table?
- **A container demurrage and detention (D&D) invoice** from an ocean carrier. Federal rules
  say what that invoice must contain and how fast it must be issued.[^cfr541] Did this one
  comply?

Each charge is small. Checking it by hand means finding the contract, the right diesel week,
the gate times and the invoice rules, and then writing a dispute before the window closes. A
two-person freight team does not do this for a $9 fuel difference, so the money is paid.

The amounts in the system are large. US companies spent about $2.4 trillion on logistics in
2025, roughly 37% of it on trucking.[^cscmp] The American Transportation Research Institute
(ATRI) estimates that driver detention cost trucking $15.1 billion in 2023, and found that
fewer than half of detention invoices were paid.[^atri] Nine large ocean carriers reported
collecting about $15.4 billion in D&D between April 2020 and March 2025.[^fmc] None of these
figures is money scoup.ai can recover. Most of it is correctly billed. They show the scale of the
bills a customer has to check.

How much of the money is billed wrongly is not known. The most-quoted error rates come from
companies that sell freight audits, and they do not publish their method (see section 7). The
first thing scoup.ai has to measure is that rate, on real customer files.

## 2. What scoup.ai does

scoup.ai checks every freight invoice a customer receives, not a sample, and flags each
overcharge with the evidence for a claim. Six agents do the work, in this order. A person
approves every claim before it is sent.

| Step | Agent | What it does | Example |
|---|---|---|---|
| 1 | **Intake** | Reads a carrier invoice (EDI 210, CSV or extracted fields) into one format. A language model is used only for free text, and its answer must pass a schema check. | Turns an EDI 210 into lines: linehaul, fuel, "DETENTION 2.5 HR". |
| 2 | **Contract & tariff** | Picks the contract, lane, fuel table, accessorial schedule, detention terms and the claim deadline. | Finds "2 hours free, $75/h after, billed by the minute" and the contract's claim window. |
| 3 | **Audit checks** (code, no language model) | Re-rates the invoice with fixed, tested rules: duplicate invoice, line math, linehaul vs contract, fuel surcharge (wrong base, wrong diesel week), reweigh without certificate, freight class, LTL rate, minimum charge, accessorial approval and caps, detention vs gate times. | Gate times show 1 h 50 min past free time, so detention is $137.50, not $187.50: $50 in dispute. |
| 4 | **Evidence** | Attaches the contract clause, invoice line and documents to each finding. | Rate-con clause, gate log, calculation. |
| 5 | **Reviewer** | Recomputes every finding independently and checks the claim window is still open. A language-model second opinion can only make a verdict stricter. | Sends a finding with a doubtful duplicate line to human review instead of the claim. |
| 6 | **Claim** | Drafts a dispute from confirmed findings only, marked DRAFT and not sent. | Draft letter: billed, expected, basis, total, file-by date. |
| - | **A person** | Reads the draft and decides whether to send it. | The customer's AP lead clicks "send". |

Language models only do judgment: reading free text, mapping an unfamiliar charge name, a
stricter second opinion, the wording of the letter. They never compute money; step 3 does,
with ordinary code that gives the same answer every time. In a dispute that matters: a carrier
can ask how a number was reached, and the answer is a formula and a cited clause.

**Status.** The agents exist as unit-tested code in `packages/shared/src/audit-agents/`. They
are not yet wired into the API or the web app. Ocean D&D invoice checks are a separate module.
On a **synthetic** test set (135 invented invoices, 45 clean and 90 with one injected overcharge each, seed 20261022), the deterministic team claimed nothing on the 45 clean invoices, flagged all 90 injected overcharges, and put the amount in dispute equal to the injected dollars to the cent; 5 clean invoices went to human review, not to a claim. The same people wrote the test generator and the checks, so these numbers show the rules work as designed. They are **not** a measurement on real invoices; real precision and recall are unknown.[^agents]

## 3. Who pays, and why

**The customer is the company that pays the freight bills.** scoup.ai's first customers are:

1. **Mid-market shippers** that spend roughly $5 million to $50 million a year on freight.
   Large enough for errors to add up; too small for an in-house audit team. We estimate about
   19,900 such US firms.[^count]
2. **Small and mid-size importers** that pay ocean D&D invoices. A modelled cap, based on the
   FMC data, puts about 12,800 importers in reach.[^count]

Carriers and freight brokers come later, through partners. They are in the total market
figure but not in the plan for the first three years.

**Why they pay.** The customer pays only out of money that comes back, at first. In the model's
year-1 example a shipper wins $52,000 in disputes and pays scoup.ai $13,000, so it is $39,000
ahead without extra work. That $52,000 is a plan assumption, not a result. The cost of saying no is the money left on the table. The cost of saying yes is
sharing invoice files under a contract.

**Who signs.** Usually the head of logistics or the controller. The person who benefits most
is the accounts-payable lead who today checks invoices by hand.

## 4. Pricing

scoup.ai charges in two parts. Both are plan inputs, not prices any customer has agreed to.

| | Year 1 | Year 2 | Year 3 | Year 5 | Year 7 |
|---|---|---|---|---|---|
| Platform fee per account | $0 | $6K | $10K | $15K | $17K |
| Amount won in disputes (plan input) | $52K | $70K | $85K | $105K | $115K |
| scoup.ai's share of recoveries | 25% | 17% | 14% | 12% | 12% |
| **Revenue per account** | **$13.0K** | **$17.9K** | **$21.9K** | **$27.6K** | **$30.8K** |

*Source: scoup-financial-model.xlsx, Assumptions rows 13-16. Revenue per account = fee +
recovered x share.*

**Why start at 25% of recoveries.** In a pilot the customer takes no risk: no recovery, no
fee. Parcel-audit firms that publish their prices charge a similar or larger share of the
refunds they win.[^parcel] Freight audit firms mostly do not publish prices; Intelligent Audit
says it charges a subscription based on shipment volume, modes and carriers.[^ia]

**Why move to a platform fee.** A share of recoveries is lumpy and lags the work by weeks or
months. A fixed fee from year 2 makes revenue predictable and lets the share fall, so the
customer keeps more of each recovered dollar as the volume grows.

**What would make us change it.** If design partners will not accept a platform fee, the plan
falls back to share-only pricing, and revenue per account in year 3 drops from $21.9K to about
$11.9K (14% of $85K). That case is not modelled separately; it is the single most important
pricing question for the pilots.

## 5. Unit economics

![Revenue per account, base case](figures/unit-economics.png)

*Figure 2. Revenue per account in the base case: a growing platform fee on top of a falling
share of recoveries. Source: scoup-financial-model.xlsx, Assumptions and Unit economics
sheets, recalculated 22 Oct 2026. All inputs are assumptions.*

One account in year 3 of the base case:

| Line | Value | Basis |
|---|---|---|
| Revenue per account | $21.9K | $10K fee + 14% of $85K |
| Gross margin | 64% | after hosting, data feeds and claim-review labour (assumption) |
| Gross profit per year | $14.0K | |
| Accounts lost per year | 20% | assumption; an average account stays 5 years |
| Lifetime gross profit | $70.1K | $14.0K x 5 years |
| Sales and marketing cost per $1 of new ARR | $0.68 | the plan's own ratio |
| Acquisition cost per account | $14.9K | $0.68 x $21.9K |
| Lifetime gross profit / acquisition cost | 4.7x | |
| Months to repay acquisition cost | 13 | |

*Source: scoup-financial-model.xlsx, Unit economics sheet, recalculated 22 Oct 2026.*

**The weak point.** The plan spends $0.68 on sales and marketing for each $1 of new annual
revenue. The median for private software companies in 2024 was about $2.00.[^benchmarkit]
At the median, lifetime gross profit covers acquisition cost only 1.6 times. The plan
therefore assumes scoup.ai sells about three times more efficiently than a typical software
company. The argument for that is the risk-free pilot (no fee unless money comes back), but
it is an argument, not evidence. Investors should treat sales efficiency as the main risk in
the model.

**Why agents matter for the margin.** The cost that sinks traditional freight audit at small
accounts is analyst time per disputed invoice. One services firm in the space has kept a
headcount of about 220 for two decades.[^ctsi] scoup.ai's plan assumes the agents draft the
packet and a person spends minutes, not hours, on review. If review takes longer than
planned, gross margin falls below the 64% above. Review minutes per claim is the second
number the pilots must measure.

## 6. Why agents are an advantage

Four concrete reasons, each with what is and is not proven:

1. **Coverage.** Code and agents can check every invoice line against the contract. People
   sample, because checking a $9 fuel difference costs more than $9. Not proven: how many real
   errors full coverage finds that sampling misses.
2. **Speed against deadlines.** Dispute windows are fixed in law and contract: 180 days to
   contest a truck freight bill under 49 U.S.C. § 13710, 18 months to sue over an overcharge
   under § 14705(b) (extended 6 months after a written claim is disallowed, § 14705(d)), and at least 30 days to ask an ocean carrier for a D&D refund under
   46 CFR 541.8.[^law] An agent can flag the claim the day the invoice arrives. Not proven:
   how many claims customers miss today because of late detection.
3. **Cost per audit.** A claim that takes an analyst an hour is not worth filing below a few
   hundred dollars. If an agent drafts it and a person reviews it in a few minutes, small
   claims become worth filing. Not proven: the real review time per claim.
4. **A second check before a person.** Each number is computed by tested code and recomputed
   by the separate Reviewer agent; only confirmed findings reach the Claim draft. On synthetic
   data this produced no claims on clean invoices (0 of 45). Not proven: error rates on real
   invoices. No real-world figure will be published until it has been measured on customer
   files and reproduced.

## 7. Market size

![Market size](figures/market-size.png)

*Figure 3. Grey bars are spend and charges in the freight system; blue bars are the fees
scoup.ai could earn if it served every account in a segment. Sources: CSCMP/Kearney 2026, ATRI
2024, FMC 2025, research/05-market-size.md and the model.*

We size the market as **accounts x revenue per account**, not as a share of the big numbers.

| Segment | US accounts | Year-7 revenue per account | Fee pool per year |
|---|---|---|---|
| Mid-market shippers | 19,932 | $27.6K | $550M |
| Small and mid-size importers (D&D) | 12,833 | $30.8K | $395M |
| **Serviceable market (SAM)** | **32,765** | | **$945M** |
| Carriers, 5-100 trucks (partner channel) | 72,053 | $7.9K | $569M |
| Freight brokers | 28,438 | $12.0K | $341M |
| **Total (TAM)** | **133,256** | | **$1.86B** |

*Source: research/05-market-size.md (docs/research branch, 17 Oct 2026); account counts from
Census SUSB 2022, Census import profile 2024, FMCSA census file and a broker-authority count;
revenue per account from the model.*

The base case reaches 605 accounts in year 7, about 1.8% of the serviceable accounts. Two
caveats: the shipper count rests on a 2008 survey of freight cost as a share of sales, and the
shipper and importer groups overlap by an unknown amount, so the serviceable market is
between $0.55 billion and $0.95 billion.

Published estimates of the freight audit and payment market are vendor research with no
method shown; most fall between $0.28 billion and $0.97 billion, and one says $6.8 billion. We
do not use them.[^fap] Published invoice-error rates ("1% to 9% of freight
spend") come from audit vendors and are not used as inputs either.

## 8. Go-to-market

1. **Design partners, months 0-6.** Three to five shippers or importers share 6-12 months of
   closed invoices under a written data agreement. scoup.ai runs the full pipeline and reports
   the overcharges it would have flagged and the amount in dispute. No fee. Output: the first measured error rate and review
   time.
2. **Paid pilots, months 6-18.** Live invoices, share-of-recovery pricing, a person approves
   every claim. Output: recovery rate, days to payment, cost per claim.
3. **Platform fee and first sales hire, year 2.** Convert pilots to the two-part price. Hire
   one US account executive once the founder has closed the first ten accounts.
4. **Partners, year 2-3.** Customs brokers and forwarders already hold importers' documents;
   factoring companies and ELD vendors reach small carriers. The base case assumes a broker
   channel in year 2 and a factoring partner from year 3.

## 9. Competition

| Company | What it does | Where scoup.ai differs |
|---|---|---|
| Loop | AI freight audit and payment; raised about $160M, Series C $95M in April 2026[^loop] | Enterprise-first; scoup.ai sells evidence-backed disputes to smaller shippers |
| Cass Information Systems | Public freight audit and payment processor, bank-owned[^cass] | Earns on payment volume at scale; does not market disputes |
| Intelligent Audit | Multimodal audit; small-business product (Catalyst) for parcel[^ia] | Catalyst is parcel; no truck accessorial or D&D dispute product found |
| Trax, CTSI-Global, nVision Global | Enterprise freight audit and payment | Built for large, global shippers |
| BlueCargo | Port and drayage D&D audit and disputes | Strongest D&D competitor; scoup.ai combines D&D with truck charges |
| Hey Bubba, FleetOptos | Carrier-side detention capture from ELD data | Capture the clock but not the cited packet |

*Source: research/01-competitors.md (docs/research branch, 17 Oct 2026), rechecked items
footnoted.*

The two firms best placed to close the gap are Loop (capital and a mid-market book bought in
2025) and Intelligent Audit (already selling down-market). scoup.ai's defence is speed and focus
on the dispute itself, not a technology lead; any of these firms can build agents.

## 10. Risks

| Risk | What would show it | What we do |
|---|---|---|
| Too few real errors | Design-partner files show recoverable money under ~0.25% of spend | Stop or change segment before raising more |
| Sales cost near the $2.00 median | First ten accounts cost far more than planned | Lean on partners; slow hiring; the downside case |
| Review takes too long | Review minutes per claim far above plan | Narrow to charge types the agents handle well |
| Customers do not share data | Partners decline the data agreement | Start with documents customers already email us |
| Incumbent moves down-market | Loop or Intelligent Audit launch a dispute product | Partner with forwarders; compete on depth of evidence |
| Legal error in a claim | A sent claim misstates a rule | Person approves every claim; counsel reviews templates |

## 11. Roadmap

| When | Product | Evidence it must produce |
|---|---|---|
| Now - month 6 | Six audit agents unit-tested on synthetic data; wire them into the API and web app; contract storage | Reproducible synthetic results, labelled synthetic |
| Months 6-12 | Design-partner run on real closed files | Measured error rate, review minutes per claim |
| Months 12-24 | Paid pilots, platform fee, first integrations (email inbox, EDI 210) | Recovery rate, days to payment, gross margin |
| Year 3+ | Carrier and broker channels; cost outlook for fuel and D&D | Channel unit economics |

## 12. Financing

The model plans a $7.5 million seed in two tranches ($4.0 million at close, $3.5 million at
the milestone) and an $8.5 million Series A once ARR reaches $2.5 million. Recalculated on
22 October 2026, the base case reaches that ARR in month 38 and needs $7.6 million of seed
including a 20% buffer; the workbook's own note says $7.36 million and month 37 and should be
updated by the owner. Base-case EBITDA turns positive in year 7. See
[`../financial/model.md`](../financial/model.md) and the workbook.

![Revenue model](figures/revenue-model.png)

*Figure 4. Seven-year plan in three cases. Bars: base-case revenue; lines: year-end ARR.
Source: scoup-financial-model.xlsx, recalculated 22 Oct 2026. A plan, not a forecast.*

---

[^agents]: technical/agents.md (origin/master e3fef5f, 22 Oct 2026); reproduce with `npx tsx packages/shared/src/audit-agents/cli.ts --eval`. Synthetic data only.
[^cfr541]: eCFR, 46 CFR Part 541, "Demurrage and Detention Billing Requirements", current through 2026-10-15, https://www.ecfr.gov/current/title-46/chapter-IV/subchapter-B/part-541, accessed 2026-10-22.
[^cscmp]: CSCMP / Kearney, 37th Annual State of Logistics Report (June 2026), as reported by SCDigest, https://www.scdigest.com/firstthoughts/26-06-26.php?cid=23144, published 2026-06-26, accessed 2026-10-22. Trucking share 36.8%; $883B is our arithmetic.
[^atri]: ATRI, "New Research Documents Substantial Financial and Safety Impacts from Truck Driver Detention", https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, published 2024-09-10, accessed 2026-10-22.
[^fmc]: Federal Maritime Commission, "Detention and Demurrage", https://www.fmc.gov/detention-and-demurrage/, data for 2020-04-01 to 2025-03-31, accessed 2026-10-22.
[^count]: research/05-market-size.md on branch docs/research (17 Oct 2026), from U.S. Census Bureau SUSB 2022 (https://www2.census.gov/programs-surveys/susb/tables/2022/us_naicssector_large_rcptsize_2022.xlsx) and FMC data; the shipper count is modelled, not a list of firms.
[^parcel]: Refund Retriever, Pricing, https://www.refundretriever.com/pricing (50% of refunds up to $250K of shipping volume, 45% up to $500K, 40% up to $1M), live page, accessed 2026-10-22.
[^ia]: Intelligent Audit, FAQ, https://www.intelligentaudit.com/faq, accessed 2026-10-22.
[^benchmarkit]: Benchmarkit, 2025 SaaS Performance Metrics (2024 data), https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-22.
[^ctsi]: Wikipedia, "CTSI-Global", https://en.wikipedia.org/wiki/CTSI-Global, accessed 2026-10-17 (secondary source).
[^law]: 49 U.S.C. § 13710(a)(3)(B), https://www.law.cornell.edu/uscode/text/49/13710, and § 14705(b) and (d), https://www.law.cornell.edu/uscode/text/49/14705, both accessed 2026-10-22; 46 CFR 541.8 via eCFR (link above), checked 2026-10-19. Not legal advice; counsel reviews claim templates.
[^fap]: SkyQuest via GII ($284.5M, 2024), Mordor Intelligence ($0.97B, 2025), Astute Analytica ($727.1M, 2023), Market Intelo ($6.8B, 2025), Technavio (+$651.2M, 2025-2030); report landing pages, accessed 2026-10-22. See data-and-sources.md, section 2.
[^loop]: Loop, "Loop raises $95M Series C", https://www.loop.com/article/loop-raises-95m-series-c-to-scale-its-ai-platform-across-the-supply-chain, April 2026, accessed 2026-10-22.
[^cass]: Cass Information Systems, 8-K exhibit 99.1 (FY2025 results), https://www.sec.gov/Archives/edgar/data/708781/000070878126000002/cass-20251231xexx991.htm, published 2026-01-22, accessed 2026-10-22.