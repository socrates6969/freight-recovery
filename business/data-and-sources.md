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
| 2024 baseline differs by edition | 2026 edition restates 2024 as $2.43T (8.3%); the 2025 edition had $2.58T (8.7%) | [SCDigest, 2025 edition](https://www.scdigest.com/firstthoughts/25-06-13_State_of_Logistics_2025.php?cid=22831) | 2025-06-13 | 2026-10-22 | Verified, secondary; always name the edition |
| US trucking gross freight revenue, 2024 | $906B (2023: $1.004T); 91.5% of carriers run 10 or fewer trucks | [ATA American Trucking Trends 2025](https://www.trucking.org/news-insights/ata-american-trucking-trends-2025) | 2025-08-28 | 2026-10-22 | Verified, primary |
| US truck transport spend, 2025 | about $883 billion | our arithmetic: $2.40T x 36.8% | - | - | Derived |
| Truck driver detention cost, 2023 | $15.1B ($11.5B lost productivity + $3.6B direct expense) | [ATRI](https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/) | 2024-09-10 | 2026-10-19 | Verified, primary |
| Stops with detention; fleets billing it; invoices paid | 39.3% of stops; 94.5% of fleets; fewer than half of invoices (by count) | same | 2024-09-10 | 2026-10-19 | Verified, primary |
| Ocean D&D collected by nine carriers | about $15.4B, 1 Apr 2020 to 31 Mar 2025 (about $3.08B a year, our arithmetic) | [Federal Maritime Commission](https://www.fmc.gov/detention-and-demurrage/) | 2025 | 2026-10-19 | Verified, primary |
| US containerized imports | 28,079,201 TEU in 2025; 28,196,462 TEU in 2024 | Descartes Global Shipping Report, [release](https://www.descartes.com/resources/knowledge-center/descartes-releases-january-global-shipping-report-december-us-0) and trade-press coverage | 2026-01 | 2026-10-22 | Verified, secondary |
| D&D per import TEU | about $110 | our arithmetic: $3.08B / 28.08M TEU. Rough: FMC covers nine carriers and both directions | - | - | Derived |
| Shippers' view of accessorials | 61% say managing accessorial requests is a top accounting time-waster; 70% say carriers are usually honest; 750 respondents | [RXO survey](https://rxo.com/resources/research/freight-accessorials/) | n/d | 2026-10-19 | Verified, primary (vendor-sponsored survey) |
| US account counts (shippers, importers, carriers, brokers) | 19,932; 12,833 (capped); 72,053; 28,438 | research/05-market-size.md (docs/research branch), from Census SUSB 2022, Census importer profile 2024, FMCSA census file, FreightCaviar | 2026-10-17 | 2026-10-17 | Primary counts; the shipper count is modelled from a 2008 freight-to-sales ratio |

## 2. Freight audit market size

Published estimates are vendor research with no method shown. Most fall between $0.28B and
$0.97B; Market Intelo's $6.8B is an outlier. We do not use any of them.

| Publisher | Estimate | Source | Accessed | Status |
|---|---|---|---|---|
| Mordor Intelligence | $0.97B in 2025; $1.89B by 2030; 14.2% CAGR | [Mordor](https://www.mordorintelligence.com/industry-reports/freight-audit-and-payment-market) | 2026-10-22 | Vendor claim |
| Astute Analytica | $727.1M in 2023; $3,147.1M by 2032; 17.68% CAGR | astuteanalytica.com, 2024-03-19 | 2026-10-22 | Vendor claim |
| SkyQuest (via GII) | $284.5M in 2024; $910.7M by 2033; 13.8% CAGR | [GII](https://www.giikorea.co.kr/report/sky1913174-freight-audit-payment-market-size-share-growth.html) | 2026-10-22 | Vendor claim |
| Market Intelo | $6.8B in 2025; $13.9B by 2034; 9.2% CAGR | [Market Intelo](https://marketintelo.com/report/freight-audit-and-payment-market) | 2026-10-22 | Vendor claim |
| Technavio | grows by $651.2M in 2025-2030; 11.2% CAGR | [Technavio](https://www.technavio.com/report/freight-audit-and-payment-market-industry-analysis) | 2026-10-22 | Vendor claim |
| Old repo figure | "about $3.1B, 6.8% growth" | not reproducible | 2026-10-22 | Withdrawn |

## 3. Invoice error and overcharge rates

| Claim | Who says it | Status |
|---|---|---|
| "1% to 9% of freight invoice value" | freight-audit vendors and blogs (e.g. Shipware) | Vendor claim |
| "Between 3 and 6 percent of invoices contain errors"; "1 to 5 percent of total freight spend" recoverable | Trax (traxtech.com, 2026-07-20) | Vendor claim |
| "5% to 10%" (up to 40%), "3-5%", "3-7%", "1.5-5%" | Tompkins Ventures; Technical Traffic, ParcelPath, Nuvocargo; TransImpact; Inbound Logistics | Vendor or trade-press claims |
| "15% to 25%" of invoices | attributed to Cass by blogs; not found on a Cass page | Not verified |
| about 4.5% of nearly 250,000 LTL invoices had errors | an audit vendor's own review | Vendor claim |

We found no independent, academic or government study of freight invoice error rates. The
model therefore does **not** use an error rate. It uses an assumed amount recovered per
account ($52K in year 1), which design-partner files must replace.

## 4. Law and claim windows

| Rule | What it says | Source | Accessed | Status |
|---|---|---|---|---|
| 49 U.S.C. § 13710(a)(3)(B) | A shipper "must contest the original bill or subsequent bill within 180 days of receipt of the bill" to keep the right to contest | [Cornell LII](https://www.law.cornell.edu/uscode/text/49/13710) | 2026-10-22 | Verified, primary text |
| 49 U.S.C. § 13710(a)(3)(A) | A carrier must issue any additional bill within 180 days of receipt of the original bill | same | 2026-10-22 | Verified, primary text |
| 49 U.S.C. § 14705(a)-(b) | Civil actions by a carrier to recover charges, and by a person to recover overcharges, must begin within 18 months after the claim accrues; (c) damages complaint 2 years | [Cornell LII](https://www.law.cornell.edu/uscode/text/49/14705) (USC current through PL 119-120) | 2026-10-22 | Verified, primary text |
| 49 U.S.C. § 14705(d) | Periods "extended for 6 months from the time written notice is given to the claimant by the carrier of disallowance" if a written claim was given within the period | same | 2026-10-22 | Verified, primary text |
| 49 U.S.C. § 14706(e) | Carrier may not set less than 9 months to file a loss/damage claim or less than 2 years (from written disallowance) to sue | [Cornell LII](https://www.law.cornell.edu/uscode/text/49/14706) | 2026-10-22 | Verified, primary text |
| 49 CFR 370.5, 370.9 | Carrier acknowledges a loss/damage claim within 30 days; pays, declines or offers within 120 days, then status every 60 days | [Cornell LII copy of CFR](https://www.law.cornell.edu/cfr/text/49/part-370) | 2026-10-22 | Verified, primary text; cargo claims are outside scoup.ai's first product |
| 46 U.S.C. § 41104(d)(2), (f) | D&D invoices must carry listed information, incl. statements (L) and (M); "Failure to include the information required under subsection (d) ... shall eliminate any obligation of the charged party to pay the applicable charge" (f) | GovInfo USC (Pub. L. 117-146 § 7(a)) | 2026-10-22 | Verified, primary text |
| 46 CFR Part 541 | 541.5: missing required information "eliminates any obligation of the billed party to pay"; 541.7(a): invoice within 30 calendar days of the charge last incurred or the billed party need not pay; 541.8(a): at least 30 days to request mitigation, refund or waiver; 541.4 removed and reserved by Federal Register 2025-23920 (effective 2025-12-29) | [eCFR renderer](https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-46?part=541); [FR 2025-23920 PDF](https://public-inspection.federalregister.gov/2025-23920.pdf) | 2026-10-22 | Verified, primary |

None of this is legal advice. Whether a given charge is owed depends on the contract and the
facts. Counsel will review claim templates before any customer use.

## 5. Fuel

| Figure | Value | Source | Published | Accessed | Status |
|---|---|---|---|---|---|
| US on-highway diesel, weekly | $6.276/gal week of 2026-10-19; $6.179 (10-12); $6.199 (10-05); $6.382 (09-28); $6.529 (09-21) | [EIA](https://www.eia.gov/dnav/pet/pet_pri_gnd_a_epd2d_pte_dpgal_w.htm) | 2026-10-20 | 2026-10-22 | Verified, primary |
| US on-highway diesel, annual average | 2022 $4.989; 2023 $4.214; 2024 $3.760; 2025 $3.660 | [EIA annual](https://www.eia.gov/dnav/pet/pet_pri_gnd_a_epd2d_pte_dpgal_a.htm) | 2026-10-20 | 2026-10-22 | Verified, primary |
| How fuel tables follow the index (example) | FedEx Freight FTL Appendix B: DOE/EIA national average, set Mondays, effective Tuesday; $0.05 price steps | [FedEx Freight PDF](https://www.fedexfreight.com/content/dam/web/us/documents/fs-ftl-fuel-surcharge.pdf) | 2024-10 | 2026-10-22 | Verified, primary |
| Fuel-surcharge overbilling per affected 500-mile load | $6.86-$11.88 | our backtest on EIA weekly diesel 2021-2026 (cost-intelligence business case, 2026-10-11; not in this repo yet) | 2026-10-11 | - | Our analysis; incidence is an assumption |

## 6. Competitors and pricing

| Figure | Value | Source | Published | Accessed | Status |
|---|---|---|---|---|---|
| Loop Series C | $95M, 17 Apr 2026, led by Valor Equity Partners | [Loop](https://www.loop.com/article/loop-raises-95m-series-c-to-scale-its-ai-platform-across-the-supply-chain) | 2026-04-17 | 2026-10-22 | Verified, primary |
| Loop total funding | about $160M | Sacra profile | 2026 | 2026-10-17 | Estimate |
| Cass FY2025 | revenue $190.8M; net income $35.1M; transportation dollar volume $36.4B (from the 8-K earnings exhibit, not the 10-K) | [Cass 8-K exhibit 99.1](https://www.sec.gov/Archives/edgar/data/708781/000070878126000002/cass-20251231xexx991.htm) | 2026-01-22 | 2026-10-22 | Verified, primary |
| Intelligent Audit pricing | "a subscription model based on annual shipment volume, modes, and # of carriers"; Catalyst: 90-day free trial, then one of three plans | [Intelligent Audit FAQ](https://www.intelligentaudit.com/faq) | live page | 2026-10-22 | Verified, primary |
| Parcel refund audit pricing | Refund Retriever: 50% of refunds up to $250K shipping volume, 45% up to $500K, 40% up to $1M; no setup or monthly fees | [Refund Retriever](https://www.refundretriever.com/pricing) | live page | 2026-10-22 | Verified, primary |
| Parcel refund audit pricing | 71lbs SMB plan: "40% of savings recovered"; LateShipment.com OneAudit: "35% of refunds" | [71lbs](https://71lbs.com/pricing-preview/); [LateShipment](https://www.lateshipment.com/pricing) | live pages | 2026-10-22 | Verified, primary |
| Recovery-audit fee range | AP recovery audits "often ranging between 20 to 30 percent" of recovered overpayments | apexanalytix blog (search snippet; page did not load) | - | 2026-10-22 | Vendor claim, not verified |
| Freehand funding | Series A $25M (Mar 2024); Series B $75M (29 Jul 2026); about $100M total | [Crunchbase News](https://news.crunchbase.com/transportation/freehand-pando-enterprise-supply-chain-spend-management-startup/) | 2026-07 | 2026-10-22 | Verified, secondary |
| HappyRobot | Series B $44M, 3 Sep 2025, led by Base10; valuation NOT confirmed (the ~$500M figure appears only in search summaries and Sacra) | [Reuters via Inc.](https://www.inc.com/reuters/happyrobot-raises-44-million-to-expand-ai-agents/91234965) | 2025-09-03 | 2026-10-22 | Round verified, secondary; valuation unconfirmed |
| Freightos FY2025 | revenue $29.5M (+24%); IFRS net loss $17.5M | results release 2026-02-23, read via finviz | 2026-02-23 | 2026-10-22 | Verified, secondary |
| Trimble / Transporeon | "all-cash transaction valued at EUR 1.88 billion", closed 3 Apr 2023 | Trimble press release / SEC filing | 2022-12-12 | 2026-10-22 | Verified, primary |
| Other profiles (Trax, CTSI-Global, nVision, BlueCargo, Hey Bubba, FleetOptos) | see research/01-competitors.md (docs/research branch) | various | 2026-10-17 | 2026-10-17 | Sourced there, not rechecked here |

## 7. SaaS benchmarks

| Figure | Value | Source | Published | Accessed | Status |
|---|---|---|---|---|---|
| Median New CAC ratio, 2024 | $2.00 of sales and marketing per $1 of new customer ARR | [Benchmarkit 2025](https://www.benchmarkit.ai/2025benchmarks) | 2025 | 2026-10-22 | Verified, primary |
| Gross / net revenue retention | GRR fell from 90% to 88% over three years; NRR 101% | same | 2025 | 2026-10-22 | Verified, primary |
| Public SaaS EV / next-12-months revenue | overall median 4.5x | [Clouded Judgement 2026-10-16](https://cloudedjudgement.substack.com/p/clouded-judgement-101626-the-diffusion) | 2026-10-16 | 2026-10-22 | Verified, primary |
| Median ARR at Series A | $2.8M in 2025, up from $2.3M in 2024 | Carta, [ARR at Series A](https://carta.com/data/newsletter-arr-at-series-a/) | 2026 | 2026-10-22 | Verified, secondary (search-indexed; direct fetch blocked) |

## 7a. Wages behind the headcount costs

| Figure | Value | Source | Accessed | Status |
|---|---|---|---|---|
| US median pay, May 2025 | information security analysts $129,180; sales engineers $124,900; technical and scientific wholesale sales reps $104,920; software developers $135,980 | [BLS Occupational Outlook Handbook](https://www.bls.gov/ooh/) | 2026-10-22 | Verified, primary |
| Norway, information and communication sector | average monthly earnings NOK 80,770 in 2025 (about NOK 969K a year) | [SSB](https://www.ssb.no/en/arbeid-og-lonn/lonn-og-arbeidskraftkostnader/statistikk/lonn), published 2026-02-05 | 2026-10-22 | Verified, primary |
| Norway employer contribution, zone I | 14.1% (2026) | [Skatteetaten](https://www.skatteetaten.no/en/rates/employers-national-insurance-contributions/) | 2026-10-22 | Verified, primary |

The workbook's loaded-cost multipliers (1.22 for Norway, 1.43 for the US) are assumptions.

## 8. Company assumptions (not facts)

All of these are inputs in `investor-pack/scoup-financial-model.xlsx`. None is measured.

| Input | Value | Why we chose it |
|---|---|---|
| Money recovered per account | $52K (Y1) rising to $115K (Y7) | mid-size importer-shipper example: about $36K D&D + $16K fuel surcharge |
| scoup.ai's share of recoveries | 25% (Y1) falling to 12% | pilot pricing, then lower with a platform fee |
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
| Audit-agent team on synthetic invoices (seed 20261022, 135 invoices: 45 clean, 90 with one injected overcharge) | 0 of 45 clean invoices claimed; 120 of 120 confirmed findings correct; 90 of 90 injected overcharges flagged, amount in dispute equal to injected dollars to the cent; 5 of 45 clean invoices sent to human review; same on seeds 1-10. SYNTHETIC: generator and checks share an author, so this shows the rules work as designed, not real-world performance. Source: technical/agents.md (origin/master e3fef5f) |
| Agents on real invoices | Not measured. No figure exists |

## 10. Could not be verified

- An independent (non-vendor) freight invoice error rate. None found.
- A usable freight-audit market size. Estimates conflict.
- The 25.66M TEU denominator in the old workbook. Replaced by Descartes 28.08M TEU.
- HappyRobot's valuation (about $500M at Series B; later reports of $1.2B). Marked unconfirmed.
- Carta's median Series A size and pre-money; ATRI's average detention fee per hour.
- Reveel, Shipware and Intelligent Audit fee percentages (not published).
- Trax funding; Terminal49 and Vizion figures are secondary only.

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
| Competitors!C12 | "Series B $44M (Sep 2025) at ~$500M valuation" | "Series B $44M (3 Sep 2025, led by Base10); valuation not confirmed" | No primary source for the valuation |
| Assumptions!K21, K23, K24, K25 | SSB / BLS notes without year | SSB 2025 NOK 80,770/month; BLS May 2025 medians; values unchanged (they match) | Re-verified |
| Sources!A14 | "Cass FY2025 10-K" | "Cass FY2025 results, 8-K exhibit 99.1" with the 8-K URL | Figures come from the 8-K |
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