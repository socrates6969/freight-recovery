# Freight Recovery - Business Plan

> **Status: pre-product, pre-revenue, zero customers.** Nothing below is validated on real customer data. Every number is either (a) cited with a grade, or (b) labeled ASSUMPTION. "$1B" is a ceiling-case arithmetic exercise (see `financial/model.md`), not a promise or a forecast.
>
> Source grades: **A** = primary/audited/regulatory; **B** = reputable secondary coverage of a primary source; **C** = vendor/aggregator/blog (directional only).
> Research note: the live web-search budget was exhausted before this document was finalized. Cited figures come from earlier research in this venture (2026-10-05). The ATRI primary PDF has **not** been opened by us. Re-verify before putting any figure in front of an investor.

## 1. Problem

Freight moves on thin margins and loose paperwork. When a truck waits at a dock beyond the free time, the carrier is owed **detention**; when something extra happens (lumper, layover, redelivery, reweigh, TONU, liftgate), the carrier is owed an **accessorial**. These charges are frequently never billed, billed without proof, disputed by email, or paid late or partially. The evidence is scattered: rate confirmation, BOL, appointment time, gate/ELD/geofence timestamps, emails.

### The leakage numbers

| Claim | Figure | Source | Grade | Caveat |
|---|---|---|---|---|
| Annual cost of driver detention to US trucking | **$15.1B/yr** ($11.5B lost productivity + $3.6B added expense) | ATRI driver-detention study, Sept 2024, via truckinginfo.com and Land Line coverage | **B** (A if the ATRI primary confirms; we saw secondary coverage) | This is the *cost of waiting*, mostly lost productivity. It is **not** a pool of recoverable dollars. Only the billable, unpaid slice is addressable. |
| Share of stops involving detention | 39.3% | same | B | |
| Fleets that charge detention | 94.5% | same | B | |
| Detention invoices actually paid | **fewer than half** | same | B | Exact paid % not verified from the primary. |
| Freight invoice error rate | "1-9% of invoice value; 10-25% of bills" | audit-vendor blogs (Shipware, Nuvocargo, others) | **C** | Sold by the people who sell audits. Do not use in a deck as fact. |
| Unclaimed parcel refunds ">$2B" | n/d | vendor blogs | **C** | Parcel, not our wedge. Ignore. |

**Honest read.** The one solid anchor is ATRI. The correct statement is: *detention is a very large, well-documented cost, and carriers collect on fewer than half of the detention they bill.* The correct next step is **not** to multiply $15.1B by a percentage and call it a market. It is to measure, on one partner's closed files, what fraction of billable detention and accessorials went unbilled, unpaid, or short-paid, and what fraction of that is winnable with evidence.

## 2. Who has the problem (target customer)

The incumbents (Cass, Trax, CTSI-Global, Intelligent Audit, and similar freight-audit-and-payment firms) are built for enterprise shippers with large annual freight spend, EDI/TMS integrations, and procurement-led buying. The long tail is under-served:

1. **Mid-market shippers** (ASSUMPTION: roughly $5M-$50M annual freight spend). Too small for a big FAP program, big enough that accessorial errors and unauthorized charges are real money. Pain: they pay carrier invoices with unauthorized or unsupported accessorials and cannot dispute at scale.
2. **Small and mid-size carriers** (ASSUMPTION: 5-100 trucks; owner-operators excluded at first). Pain: they do detention/accessorial billing by hand, do not assemble proof, and write the money off.

Why both sides: detention is a two-sided dispute. A shipper-side tool defends against weak claims; a carrier-side tool builds strong ones. **Decision to validate in discovery:** start on one side. Working hypothesis is carrier-side claim assembly first (the money is plainly owed and the evidence packet is the product), shipper-side audit second. This is a hypothesis, not a finding.

## 3. Product

An agent-assisted pipeline that, for each load:
- **Ingests** documents (rate confirmation, BOL/POD, accessorial invoice, emails) and, later, timestamps from telematics/visibility feeds.
- **Extracts** structured fields (appointment time, arrival, departure, free time, rate, accessorial clauses).
- **Applies rules** that interpret the contract/rate-con language to decide entitlement and amount.
- **Assembles the evidence packet** (timeline, source citations, contract clause) and a ready-to-send demand/invoice.
- **Tracks** deadlines, follow-ups, disputes, and outcomes, with a **human approval** step before anything leaves the building.

See `technical/overview.md`. Explicit non-goals for v1: moving money (avoids money-transmission and bank-partner issues), brokering freight, hardware.

## 4. Pricing: contingency, with a path to SaaS

- **Phase 1 (design partners / pilots): pure contingency.** A percentage of dollars actually recovered, nothing if nothing is recovered. Removes buyer risk, which matters for an unproven vendor. ASSUMPTION: 15-30% is what audit firms commonly charge (vendor-stated, grade C); we model **20%**.
- **Phase 2: hybrid.** Small platform fee plus a lower contingency (ASSUMPTION: $1-2K/month platform + ~10-12%). Gives the revenue predictability investors value.
- **Phase 3: SaaS tier** for customers who want self-serve tooling for their own team, priced on loads processed.

**Honest caveat.** Contingency revenue is variable and lagged (recovery cycles are weeks to months) and investors value it at a discount to contracted ARR. It is a customer-acquisition mechanism, not a destination. Gross margin depends on how much human review each claim needs; that is unmeasured today.

## 5. Go-to-market

1. **Design partners (months 0-4).** Recruit 3-5 carriers or mid-market shippers who will give us **closed historical files** (read-only, under NDA). Deliverable: a leakage audit on their own data: "here is what was left on the table and what we could have recovered". No software sale; this is the validation.
2. **Contingency pilots (months 4-10).** Run live on new claims with human approval. Measured outputs: recovery rate, dollars recovered, time per claim, cost per claim. Convert the pilot data into the first case study.
3. **Land and expand (months 10+).** Land on one lane/terminal/customer set, expand to all loads, add the second side (shipper-side audit for the same relationships), then add integrations (TMS/ELD) that reduce onboarding friction. Channels to test: freight-association communities, TMS/ELD marketplaces, carrier-factoring partners. All hypotheses.

**Sales motion honesty:** carriers have low software budgets and little time; contingency is the right wedge for them. Shippers buy slower and want integrations. Founder-led selling is required through roughly the first 20 accounts.

## 6. Milestones (gated on evidence, not calendar)

| Gate | Evidence required | Kill/pivot trigger |
|---|---|---|
| G0: Eval set | 100+ real or realistic detention/accessorial cases with ground-truth entitlement | Cannot assemble a gold set |
| G1: Leakage proven | One design partner's closed files show material, evidence-backed unrecovered dollars | Recoverable slice is trivial (ASSUMPTION threshold: under ~0.25% of freight spend shipper-side, or very few winnable detention events per 100 loads carrier-side) |
| G2: Pipeline quality | Measured pass^k on the eval set above a bar set in advance (see technical doc); zero hallucinated citations | Verifier cannot be made reliable |
| G3: Paid pilots | 3+ customers on contingency, human-approved, recovery rate measured | Customers will not share data or will not pay the fee |
| G4: Repeatability | 10+ accounts, measured CAC and payback, churn observed | CAC payback far above 24 months |
| G5: Raise | Only now present traction; seed deck grounded in measured results only | - |

## 6b. Forecasting (roadmap)

Future capability, not part of the current offer: demand / lane-volume forecasting to help prioritize recovery work (which lanes and carriers to audit first). A simple seasonal baseline is implemented; a neural option (neuralforecast) is opt-in and not yet validated. It requires real multi-series historical data from design partners and often only ties simple baselines, so we make no accuracy claim and do not sell it. Revisit after G2.

## 7. Key risks (see also README)

- **Recoverable pool smaller than headline.** Mitigation: measure first.
- **Incumbents move down-market** or add accessorial-dispute modules. Mitigation: speed, long-tail focus, dispute-outcome data.
- **Data access** (TMS/ELD integration) is the real hard problem, not the AI.
- **Customer relationship risk:** carriers dunning shippers they depend on may hesitate. Human approval and customer-controlled send settings are required.
- **Payment/regulatory:** stay out of money movement and brokering until counsel confirms.
- **Founder/market fit:** no one on the team has been identified with freight-audit domain experience; see `hiring/README.md`.

## 8. Use of funds

Seed proceeds are allocated to independent security audit, external legal counsel, design-partner data validation, and product hardening, in that priority order. See the "Use of Funds (seed raise)" section in `financial/model.md`.
