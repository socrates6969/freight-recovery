# Data and sources

Last full check: 22 October 2026. This file lists every outside number used in the investor
documents, where it came from, and how sure we are of it. It also lists the company's own
assumptions, so no reader mistakes one for the other.

**Status words.**
- **Verified, primary**: we read it on the publisher's own page or filing on the date shown.
- **Verified, secondary**: a reputable outlet reporting the primary source; the primary was
  not opened.
- **Vendor claim**: published by a company that sells the service, or a market-report landing
  page; method not shown. Never used as a model input.
- **Assumption**: our own number. It stays an assumption until design-partner data replaces it.
- **Not verified**: we could not confirm it. It is not used as a fact anywhere.

## 1. Market and spend

| Figure | Value | Source | Published | Accessed | Status |
|---|---|---|---|---|---|
| US business logistics costs, 2025 | $2.40 trillion, 7.8% of GDP (2024: $2.43T, 8.3%) | CSCMP / Kearney, 37th State of Logistics, via [SCDigest](https://www.scdigest.com/firstthoughts/26-06-26.php?cid=23144) | 2026-06-26 | 2026-10-22 | Verified, secondary |
| Trucking share of logistics spend, 2025 | 36.8% (59.5% of transport costs) | same | 2026-06-26 | 2026-10-22 | Verified, secondary |
| US truck transport spend, 2025 | about $883 billion | our arithmetic: $2.40T x 36.8% | - | - | Derived |
| Truck driver detention cost, 2023 | $15.1B ($11.5B lost productivity + $3.6B direct expense) | [ATRI](https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/) | 2024-09-10 | 2026-10-19 | Verified, primary |
| Stops with detention; fleets billing it; invoices paid | 39.3% of stops; 94.5% of fleets; fewer than half of invoices (by count) | same | 2024-09-10 | 2026-10-19 | Verified, primary |
| Ocean D&D collected by nine carriers | about $15.4B, 1 Apr 2020 to 31 Mar 2025 (about $3.08B a year, our arithmetic) | [Federal Maritime Commission](https://www.fmc.gov/detention-and-demurrage/) | 2025 | 2026-10-19 | Verified, primary |
| US containerized imports | 28,079,201 TEU in 2025; 28,196,462 TEU in 2024 | Descartes Global Shipping Report, [release](https://www.descartes.com/resources/knowledge-center/descartes-releases-january-global-shipping-report-december-us-0) and trade-press coverage | 2026-01 | 2026-10-22 | Verified, secondary |
| D&D per import TEU | about $110 | our arithmetic: $3.08B / 28.08M TEU. Rough: FMC covers nine carriers and both directions | - | - | Derived |
| Shippers' view of accessorials | 61% say managing accessorial requests is a top accounting time-waster; 70% say carriers are usually honest; 750 respondents | [RXO survey](https://rxo.com/resources/research/freight-accessorials/) | n/d | 2026-10-19 | Verified, primary (vendor-sponsored survey) |
| US account counts (shippers, importers, carriers, brokers) | 19,932; 12,833 (capped); 72,053; 28,438 | research/05-market-size.md (docs/research branch), from Census SUSB 2022, Census importer profile 2024, FMCSA census file, FreightCaviar | 2026-10-17 | 2026-10-17 | Primary counts; the shipper count is modelled from a 2008 freight-to-sales ratio |

## 2. Freight audit market size

Published estimates disagree by more than twenty times. We do not use any of them.

| Publisher | Estimate | Source | Accessed | Status |
|---|---|---|---|---|
| SkyQuest (via GII) | $284.5M in 2024; $910.7M by 2033; 13.8% CAGR | [GII](https://www.giikorea.co.kr/report/sky1913174-freight-audit-payment-market-size-share-growth.html) | 2026-10-22 | Vendor claim |
| Market Intelo | $6.8B in 2025; $13.9B by 2034; 9.2% CAGR | [Market Intelo](https://marketintelo.com/report/freight-audit-and-payment-market) | 2026-10-22 | Vendor claim |
| Technavio | grows by $651.2M in 2025-2030; 11.2% CAGR | [Technavio](https://www.technavio.com/report/freight-audit-and-payment-market-industry-analysis) | 2026-10-22 | Vendor claim |
| Old repo figure | "about $3.1B, 6.8% growth" | not reproducible | 2026-10-22 | Withdrawn |

## 3. Invoice error and overcharge rates

| Claim | Who says it | Status |
|---|---|---|
| "1% to 9% of freight invoice value" | freight-audit vendors and blogs (e.g. Shipware) | Vendor claim |
| "3% to 6%" / "5% to 10%" / "15% to 25%" of invoices contain an error | audit vendors and blogs; the 15-25% figure is attributed to Cass in secondary blogs | Vendor claim; not traced to a primary study |
| about 4.5% of nearly 250,000 LTL invoices had errors | an audit vendor's own review | Vendor claim |

We found no independent, academic or government study of freight invoice error rates. The
model therefore does **not** use an error rate. It uses an assumed amount recovered per
account ($52K in year 1), which design-partner files must replace.

## 4. Law and claim windows

| Rule | What it says | Source | Accessed | Status |
|---|---|---|---|---|
| 49 U.S.C. § 13710(a)(3)(B) | A shipper "must contest the original bill or subsequent bill within 180 days of receipt of the bill" to keep the right to contest | [Cornell LII](https://www.law.cornell.edu/uscode/text/49/13710) | 2026-10-22 | Verified, primary text |
| 49 U.S.C. § 13710(a)(3)(A) | A carrier must issue any additional bill within 180 days of receipt of the original bill | same | 2026-10-22 | Verified, primary text |
| 49 U.S.C. § 14705(a)-(b) | Civil actions by a carrier to recover charges, and by a person to recover overcharges, must begin within 18 months after the claim accrues | [Cornell LII](https://www.law.cornell.edu/uscode/text/49/14705) | 2026-10-22 | Verified, primary text |
| 49 CFR Part 370 | Rules for loss and damage claims (acknowledge within 30 days, dispose within 120 days) | [eCFR](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-370) | - | Not verified this pass (eCFR blocked our fetch); cargo claims are outside Scoup's first product |
| 46 CFR Part 541 | Ocean D&D invoice content (541.5), issuance deadlines (541.7), at least 30 days to request mitigation, refund or waiver (541.8); 541.4 reserved after Federal Register 2025-23920 (effective 2025-12-29) | [eCFR](https://www.ecfr.gov/current/title-46/chapter-IV/subchapter-B/part-541); [Federal Register](https://www.federalregister.gov/documents/2025/12/29/2025-23920/demurrage-and-detention-billing-requirements-properly-issued-invoices-provision-set-aside-by-court) | 2026-10-19 | Verified, primary (repo ledger of 2026-10-19; our 2026-10-22 fetch was blocked) |

None of this is legal advice. Whether a given charge is owed depends on the contract and the
facts. Counsel will review claim templates before any customer use.

## 5. Fuel

| Figure | Value | Source | Published | Accessed | Status |
|---|---|---|---|---|---|
| US on-highway diesel, weekly | $6.276/gal week of 2026-10-19; $6.179 (10-12); $6.199 (10-05); $6.382 (09-28); $6.529 (09-21) | [EIA](https://www.eia.gov/dnav/pet/pet_pri_gnd_a_epd2d_pte_dpgal_w.htm) | 2026-10-20 | 2026-10-22 | Verified, primary |
| Fuel-surcharge overbilling per affected 500-mile load | $6.86-$11.88 | our backtest on EIA weekly diesel 2021-2026 (cost-intelligence business case, 2026-10-11; not in this repo yet) | 2026-10-11 | - | Our analysis; incidence is an assumption |

## 6. Competitors and pricing

| Figure | Value | Source | Published | Accessed | Status |
|---|---|---|---|---|---|
| Loop Series C | $95M, 17 Apr 2026, led by Valor Equity Partners | [Loop](https://www.loop.com/article/loop-raises-95m-series-c-to-scale-its-ai-platform-across-the-supply-chain) | 2026-04-17 | 2026-10-22 | Verified, primary |
| Loop total funding | about $160M | Sacra profile | 2026 | 2026-10-17 | Estimate |
| Cass FY2025 | revenue $190.8M; net income $35.1M; transportation dollar volume $36.4B | [Cass 8-K exhibit 99.1](https://www.sec.gov/Archives/edgar/data/708781/000070878126000002/cass-20251231xexx991.htm) | 2026-01-22 | 2026-10-22 | Verified, primary |
| Intelligent Audit pricing | "a subscription model based on annual shipment volume, modes, and # of carriers"; Catalyst: 90-day free trial, then one of three plans | [Intelligent Audit FAQ](https://www.intelligentaudit.com/faq) | live page | 2026-10-22 | Verified, primary |
| Parcel refund audit pricing | Refund Retriever: 50% of refunds up to $250K shipping volume, 45% up to $500K, 40% up to $1M; no setup or monthly fees | [Refund Retriever](https://www.refundretriever.com/pricing) | live page | 2026-10-22 | Verified, primary |
| Freehand funding | Series A $25M (Mar 2024); Series B $75M (29 Jul 2026); about $100M total | [Crunchbase News](https://news.crunchbase.com/transportation/freehand-pando-enterprise-supply-chain-spend-management-startup/) | 2026-07 | 2026-10-22 | Verified, secondary |
| HappyRobot | Series B $44M, Sep 2025, about $500M valuation | [Reuters via Inc.](https://www.inc.com/reuters/happyrobot-raises-44-million-to-expand-ai-agents/91234965) | 2025-09 | 2026-10-22 | Verified, secondary |
| Other profiles (Trax, CTSI-Global, nVision, BlueCargo, Hey Bubba, FleetOptos) | see research/01-competitors.md (docs/research branch) | various | 2026-10-17 | 2026-10-17 | Sourced there, not rechecked here |

## 7. SaaS benchmarks

| Figure | Value | Source | Published | Accessed | Status |
|---|---|---|---|---|---|
| Median New CAC ratio, 2024 | $2.00 of sales and marketing per $1 of new customer ARR | [Benchmarkit 2025](https://www.benchmarkit.ai/2025benchmarks) | 2025 | 2026-10-22 | Verified, primary |
| Gross / net revenue retention | GRR fell from 90% to 88% over three years; NRR 101% | same | 2025 | 2026-10-22 | Verified, primary |
| Median ARR at Series A | $2.8M in 2025, up from $2.3M in 2024 | Carta, [ARR at Series A](https://carta.com/data/newsletter-arr-at-series-a/) | 2026 | 2026-10-22 | Verified, secondary (search-indexed; direct fetch blocked) |

## 8. Company assumptions (not facts)

All of these are inputs in `investor-pack/scoup-financial-model.xlsx`. None is measured.

| Input | Value | Why we chose it |
|---|---|---|
| Money recovered per account | $52K (Y1) rising to $115K (Y7) | mid-size importer-shipper example: about $36K D&D + $16K fuel surcharge |
| Scoup's share of recoveries | 25% (Y1) falling to 12% | pilot pricing, then lower with a platform fee |
| Platform fee | $0 (Y1) rising to $17K (Y7) | introduced from year 2 |
| New accounts per year (base) | 6, 30, 75, 120, 165, 200, 235 | plan input |
| Annual account churn | 20% base, 15% upside, 30% downside | plan input, checked against the 88% GRR median |
| Gross margin | 50% (Y1) to 74% (Y7), base | after hosting, data and claim review labour |
| Sales cost per $1 of new ARR | about $0.68 (base, Y3) | plan output; the median is $2.00 (section 7) |
| Flag, confirm and pay rates in the funnel figure | 9%, 50%, 60% | placeholders for the chart only |

## 9. Internal and synthetic results

| Result | Status |
|---|---|
| Charge-name classifier recognises 145 of 159 public tariff names (another record says 158/159) | Internal; public tariff names, not invoices; records conflict; not independently reproduced. Not quoted externally |
| Recall learning curve 48.6% to 91.8% on public charge names (seed-v2) | Internal, public data; reproducible in repo per hive notes; still not a customer result |
| Detention Monte Carlo: $56,400 owed per 1,000 loads | Our simulation calibrated on ATRI; synthetic |
| Agent pipeline accuracy | Not measured. No figure exists |

## 10. Could not be verified

- 49 CFR Part 370 periods (eCFR fetch blocked). Not used in the documents as a fact.
- An independent (non-vendor) freight invoice error rate. None found.
- A usable freight-audit market size. Estimates conflict.
- The 25.66M TEU denominator in the old workbook. Replaced by Descartes 28.08M TEU.
- Wage bases in the workbook (SSB, BLS) were not rechecked in this pass.
- Funding for Trax, Terminal49, Vizion; Freightos FY2025 results; Transporeon price. Kept with
  their old grades in the workbook; not quoted in the documents.

## 11. Spreadsheet change log, 22 October 2026

`business/investor-pack/scoup-financial-model.xlsx` (planning model):

| Cell | Old | New | Why |
|---|---|---|---|
| Customer value!B10 | 240000 (hardcoded) | `=ROUND(3080000000/28079201*2000,-3)` = 219,000 | Old value used an untraceable 25.66M TEU; now FMC / Descartes 2025 |
| Customer value!B11 | 36000 (hardcoded) | `=ROUND(B10*0.15,-2)` = 32,900 | Follows B10; 15% stays an assumption |
| Customer value!C8, C10, C12 | old notes | sourced notes; latest EIA week; internal-result warning | Sources |
| Assumptions!C5 | "about $2.8M ARR (Carta, B)" | Carta 2025 $2.8M (2024 $2.3M), input kept at $2.5M | Re-verified |
| Assumptions!I15 | "parcel audit firms publish 40-50% (A)" | names Refund Retriever 50/45/40% | Source named |
| Competitors!C4, D4, C7, C9, C12 | old figures | verified figures (Loop, Cass, Freehand, HappyRobot) | Re-verified |
| Financing!C14, D13, D14 | "month ~37", "$7.36M", "$5.7M" | month 38, $7.59M, $5.58M | Notes did not match the recalculated formulas |
| Source review!B5, A17:B17 | old status | recalculation method and open owner decision | Status |
| New sheet "Sources (verified)" | - | cell -> source, URL, published, accessed, status | Requested |

Model outputs did not change: base Y5 revenue $7.30M, Y5 ARR $9.03M, Y7 ARR $18.63M. One
input is now inconsistent and left to the owner: Assumptions!B14 ($52K in year 1) was built
on the old $36K D&D figure. With the sourced denominator the D&D part is about $32.9K and B14
would be about $48.9K.

`financial/model/freight-recovery-financial-model.xlsx` (legacy, superseded): unit_economics
C3, C4 and C10 started with "=" and were read as broken formulas; they are now plain text
("calc: ..."). Marked superseded on the review sheet; a Sources sheet was added. No values
changed.

Scripts: `business/tools/update_scoup_workbook.py`, `update_legacy_workbook.py`,
`recalc_model.py` (recalculates without Excel), `make_figures.py`.