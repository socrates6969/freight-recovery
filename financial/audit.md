# Financial model audit

Date: 2026-10-17. Author: finance agent, for Marius Carlsson. Status: draft for owner review.

The company, scoup.ai, is pre-product. We have no customers, no revenue and no measured recovery rate, and every figure in the files we audited is a plan input or the arithmetic consequence of one. This audit covers the existing financial material in the main checkout (read-only), records what is sourced and what is assumed, lists hardcoded values that should be formulas, and lists every inconsistency we found between the files. The last section records the formula-drivenness check on the new `financial/model.xlsx`.

## 1. Files audited

| # | File | Date on disk | What it is |
|---|---|---|---|
| F1 | `financial/model.md` | 2026-10-05 | Five-year detention-only model, $40K ACV, $2.0-3.0M seed |
| F2 | `financial/model/01_assumptions.csv` to `09_burn_runway.csv` | 2026-10-08 | Tabular copy of F1 |
| F3 | `financial/model/freight-recovery-financial-model.xlsx` | 2026-10-08 | Nine tabs, text copy of F2 |
| F4 | `business/investor-pack/scoup-financial-model.xlsx` | 2026-10-12 | Seven-year, three-scenario model, $7.5M seed, live formulas |
| F5 | `business/investor-pack/02-scoup-financial-plan.pdf` | 2026-10-12 | Narrative of F4 (text extracted with pypdf) |
| F6 | `business/investor-brief.md` | before 2026-10-12 | Investment memorandum; still uses F1 numbers and the old name Freight Recovery |
| F7 | `business/business-plan.md` | 2026-10-05 | Business plan with F1 numbers |
| F8 | `business/business-case-2026-10-cost-intelligence.md` | 2026-10-11 | Source of the F4 revenue-per-account build |

The pricing model is contingency in every file: a share of dollars actually recovered, nothing if nothing is recovered. F1, F6 and F7 use 20%. F8 and F4 use 25% in the pilot year, then a platform fee plus a lower share (17% falling to 12%). The product code in `freight-recovery-build` holds no pricing logic, so the documents are the only source.

The two generations of material describe different businesses. F1, F2, F3, F6 and F7 model a detention and accessorial recovery tool with a $40K contract value and a $2.0-3.0M seed. F4 and F5, written a week later, model a broader cost-recovery product (ocean demurrage and detention audit, fuel-surcharge verification, detention) with revenue per account of $13K rising to $31K and a $7.5M seed. F4 is the more rigorous of the two, so we reused it as the base; section 4 lists every number that differs.

## 2. Inputs: sourced or assumed

### 2.1 F1, F2 and F3 (detention-only model)

No input in F1-F3 carries a URL. F7 states that the ATRI primary PDF had not been opened and that live search was unavailable when it was written. In practice everything below is an assumption.

| Input | Value | Status | Note |
|---|---|---|---|
| Example shipper freight spend | $20M | Assumed | "Mid-market band", no source |
| Recoverable share of spend | 1.0% (bull 1.3%, bear 0.75%) | Assumed | Audit-vendor claim of 1-3% cited as grade C, no link |
| Contingency fee | 20% | Assumed | "15-30% typical per vendors", grade C, no link |
| ACV | $40K (bull $55K, bear $30K) | Derived for base; bull and bear set by hand | Base = $20M x 1.0% x 20%. Bull $55K does not follow from $20M x 1.3% x 20% = $52K |
| Gross margin | 60% rising to 70% | Assumed | ICONIQ via SaaStr cited, no link |
| Blended CAC | $25K (bull $22K, bear $30K) | Assumed | No source |
| Logo churn | 20% (bull 15%, bear 35%) | Assumed | No source |
| Loaded headcount cost | $150K | Assumed | No source |
| Year-end paying accounts | 5 / 25 / 80 / 180 / 330 | Assumed | Plan input |
| Valuation multiples | 8-15x ARR, haircut 4-6x | Assumed | Clouded Judgement 4.1x and 12.4x cited as grade A, no link |
| Series A and dilution medians | $14.4M at $80M post, 18% | Secondary | "Carta via secondary", no link |
| CAC payback benchmark | 18-20 months | Secondary | KeyBanc / Benchmarkit, no link |
| Use of proceeds split | 15 / 10 / 20 / 35 / 10 / 10% | Assumed | Not derived from a cost plan |
| Cap table | $2.5M at $10M post, 12.5% pool | Assumed | No source |

### 2.2 F4 and F5 (seven-year model)

| Input | F4 value | Status | Re-verification on 2026-10-17 |
|---|---|---|---|
| Compensation inflation | 4%/yr | Assumed | n/a |
| Series A ARR milestone | $2.5M | Assumed, Carta median $2.8M as context | Direct fetch of carta.com returned HTTP 403; the $2.8M (2025, up from $2.3M in 2024) figure appears in carta.com search results |
| Cash buffer on each round | 20% | Assumed | n/a |
| Months to close next round | 6 | Assumed | n/a |
| NOK per USD | 10.5 | Assumed | Live rate differs: Norges Bank Sep 2026 average 9.3817. Live source wins (change C2) |
| Platform fee | $0-17K/yr | Assumed | Competitor pricing pending from market-researcher |
| Amount recovered per account | $52K-115K/yr | Derived in F8 from FMC, EIA and ATRI figures | F8 itself flags the FMC $15.4B figure as not re-verified |
| Recovery share | 25% to 12% | Assumed, Refund Retriever 40-50% as context | Refund Retriever publishes 50% / 45% / 40% by shipping volume: confirmed |
| Software engineer pay | NOK ~969K x 1.22 | Sourced (SSB) | SSB Nov 2025 information and communication average NOK 80,770/month = NOK 969,240/yr: confirmed |
| Employer social security | 14.1% | Sourced (Skatteetaten) | Zone I 14.1% for 2026: confirmed |
| Loading factor 1.22 | | Partly sourced | 14.1% sourced; the remaining ~8 points are assumed |
| ML, security, finance pay | $125K, $125K, $130K loaded | Assumed premium over SSB | n/a |
| US sales engineer | $175K loaded | Sourced (BLS) | Median $124,900 (May 2025): confirmed; x 1.43 = $178.4K, not $175K |
| US benefits loading | x 1.43 | Sourced (BLS ECEC) | June 2026: benefits 30.0% of private-industry compensation: confirmed |
| Account executive | $230K loaded | Assumed | Stated basis "BLS base $105K, OTE ~2x, loaded" gives $105K x 2 x 1.43 = $300K, so $230K does not follow from its own rule. Not re-verified |
| Claims analyst | $100K loaded | Assumed | n/a |
| Headcount plan | 6 to 54 people | Assumed | n/a |
| Other operating costs | six lines | Assumed (grade C) | SOC 2 and pen-test cost ranges come from vendor blogs; not re-verified |
| New accounts per year | 6 to 235 (base) | Assumed | n/a |
| Churn | 20% (15% / 30%) | Assumed, Benchmarkit GRR 88% as context | GRR 88%: confirmed |
| Gross margin path | 50% to 74% (base) | Assumed | Replaced by a bottom-up cost of revenue (change C1) |
| S&M per $1 of new ARR benchmark | $2.00 | Sourced (Benchmarkit) | 2024 median New CAC Ratio $2.00: confirmed |
| Seed median | $3.0M at $18.4M pre | Sourced, grade C | Not re-verified |

Source: Norges Bank, Exchange rates USD/NOK monthly, https://data.norges-bank.no/api/data/EXR/M.USD.NOK.SP, accessed 2026-10-17
Source: Statistics Norway, Earnings, https://www.ssb.no/arbeid-og-lonn/lonn-og-arbeidskraftkostnader/statistikk/lonn, accessed 2026-10-17
Source: Skatteetaten, Arbeidsgiveravgift rates, https://www.skatteetaten.no/satser/arbeidsgiveravgift/, accessed 2026-10-17
Source: US Bureau of Labor Statistics, Occupational Outlook Handbook: Sales Engineers, https://www.bls.gov/ooh/sales/sales-engineers.htm, accessed 2026-10-17
Source: US Bureau of Labor Statistics, Employer Costs for Employee Compensation June 2026, https://www.bls.gov/news.release/ecec.nr0.htm, accessed 2026-10-17
Source: Benchmarkit, 2025 SaaS Performance Metrics, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-17
Source: Refund Retriever, Pricing, https://www.refundretriever.com/pricing, accessed 2026-10-17
Source: Carta, ARR at Series A, https://carta.com/data/newsletter-arr-at-series-a/, accessed 2026-10-17 (via search result)

## 3. Hardcoded values that should be formulas

F3 is not a working model. All of its cells are text: 0 numeric cells, 0 live formulas, and the three cells that look like formulas on `unit_economics` (C3 `= 20M x 1.0%`, C4 `= recoverable x 20% = ACV`, C10 `= 26K / 0.20`) are text strings. Every figure in it would have to be retyped by hand after any change to an assumption.

F4 is formula-driven at its core (867 formulas) but still holds inputs and results in the wrong places:

| Location in F4 | Hardcoded value | Should be |
|---|---|---|
| Base, Upside, Downside B5:H5 | New accounts per year | Inputs on Assumptions, so all scenario levers sit in one place |
| Base, Upside, Downside B6, B7, B8 | Churn, revenue multiplier, cost scale | Same |
| Base, Upside, Downside B12:H12 | Gross margin per year | A bottom-up cost of revenue (it double-counts costs, see 4.2) |
| Base, Upside, Downside B17 and B24 | `*0.6` inside every year-1 people-cost formula | An input: year-1 hiring quarter per role |
| Base, Upside, Downside B18 | `*1` instead of the cost-scale cell in year 1 | Explicit, documented choice (kept in the new model) |
| Financing B13, B14 | Seed $7.5M, Series A $8.5M | Inputs feeding the cash flow, with a check that cash stays above zero |
| Financing D13, D14, A16 | "Base need $7.36M", "month 55", "$7.6M" typed into text | Formula outputs |
| Use of funds B5:B11, B27:B33 | Every dollar amount by function | SUMs of the cost lines over the funded period |
| Use of funds A3, A13, A25, A35 | "$8.83M less $2.70M = $6.13M" typed into text | Formula outputs |
| Unit economics B13 | $2.00 benchmark on a calculation tab | An Assumptions input |
| Customer value B6, B7, B9, B11 | 7,540; 12,670; 16,000; 36,000 | Derivations of other cells (for example B11 = B10 x 15%) |

F2 and F1 have no formulas at all. The derived lines (ACV, gross profit, LTV, LTV:CAC, revenue, run-rate, valuation) are typed numbers.

## 4. Inconsistencies

### 4.1 Between the five-year files (F1, F2, F3, F6, F7)

1. **Bull LTV.** F2 shows $180K. With ACV $55K, a 62-72% margin and 15% churn, LTV is $55K x 67% / 0.15 = $246K. $180K implies a 49% margin.
2. **Bear LTV.** F2 shows $74K, which is $26K / 0.35, i.e. the base-case gross profit. With the bear ACV of $30K and a 58.5% margin it is $30K x 58.5% / 0.35 = $50K.
3. **Bear LTV:CAC.** F1 and F7 say 3.0x "at 35% churn" (base CAC $25K: $74K / $25K = 2.96x); F2 says 2.5x (bear CAC $30K: $74K / $30K = 2.47x). Neither uses the bear ACV.
4. **Gross profit per account.** F2 row "Gross margin (blended Y1-2) 60%" sits above "Gross profit per account $26K at ~65%". At 60% the figure is $24K.
5. **Founder ownership after seed.** F2 shows 62.5% (from $2.5M at $10M post with a 12.5% pool); F6 says "near ~56% post-seed" from Carta medians.
6. **Name.** F6 and F7 use Freight Recovery; F4 and F5 use scoup.ai. The owner has set the name as lowercase scoup.ai.
7. **Stale technical statements in F6.** It describes a ~1,100-line Python/FastAPI MVP to be ported, which no longer matches the TypeScript platform in `freight-recovery-build`, and it states "~250x" mesh speed-ups from internal synthetic benchmarks next to financial claims. These are not finance inputs, but the honesty rule applies to them; flagged for the architect and the owner.

The F2 arithmetic that does hold: base revenue (Y1 2.5 x $40K x 0.5 = $0.05M; Y2 15 x $40K = $0.60M; Y5 255 x $40K = $10.2M), run-rates, use-of-proceeds total ($2.5M, 100%), cap table (25% at $10M post) and the valuation table ($13.2M x 8 = $106M, x 15 = $198M) all recompute correctly.

### 4.2 Inside the seven-year files (F4, F5)

1. **Cost of revenue is counted twice.** F4 computes cost of revenue as revenue x (1 - gross margin), and its note says the margin is "after hosting, data feeds and claim review labour". The same claims analysts (Assumptions row 26) and the same hosting and data line (row 32) are also inside People costs and Other operating costs. In base year 3 that double-counts about $0.46M: claims analysts (2 + 4) / 2 x $100K x 1.04^2 = $0.32M plus hosting $0.14M. F4 EBITDA is therefore too low by roughly that amount every year, and its seed and Series A sizes are too high. Fixed in the new model (change C1).
2. **The PDF downside table does not match the workbook.** F4 rounds scaled headcount with Excel ROUND (half away from zero). The F5 figures were evidently produced with round-half-to-even: downside year-5 headcount is 34 in F5 but 36 when the F4 formulas are evaluated (10 x 0.85 = 8.5 rounds to 9 in Excel, 8 in Python), and downside year-5 EBITDA is -$4.77M in F5 against -$4.90M from the workbook. Base and upside are unaffected because their scale factors do not produce .5 values.
3. **Sales efficiency is far better than the benchmark it cites.** F4 plans $0.68 of sales and marketing per $1 of new ARR in base year 3; the cited Benchmarkit 2024 median is $2.00. F5 calls this the largest single risk, which we agree with. At $2.00 the F5 text says LTV:CAC falls to 1.6x.
4. **Milestone month.** F5 says the base case reaches $2.5M ARR "around month 37". Interpolating F4 year-end ARR ($2.256M at month 36, $4.929M at month 48) gives 36 + 12 x (2.5 - 2.256) / (4.929 - 2.256) = month 37.1, so the first full month above the milestone is month 38.
5. **Account-executive cost** does not follow its stated rule (section 2.2).
6. **Missing statements.** F4 stops at EBITDA. It has no tax, depreciation, working capital, cash flow statement or balance sheet. Contingency fees are paid after the counterparty pays the customer, so receivables are a real cash use that F4 ignores.
7. **The downside cost response is described, not modelled.** F5 section 4 says hiring is held at year-2 levels if the tranche-2 milestone is missed and quotes the result ($7.6M, month 55). No formula in F4 implements the hold.

### 4.3 Between the generations, and against the new model

| Metric | F1 / F2 / F6 / F7 | F4 / F5 | New `model.xlsx` (base) |
|---|---|---|---|
| Horizon | 5 years | 7 years | 7 years |
| Product scope | Detention and accessorials | D&D audit, fuel surcharge, detention | As F4; segments explicit (shippers, SME importers, carriers via partner) |
| Revenue per account | $40K ACV | $13.0K (Y1) to $30.8K (Y7) | Importer as F4; shipper 77% of the importer recovery; carrier $7.9K |
| Year-5 revenue | $10.20M | $7.30M | $7.44M |
| Year-5 ARR / run-rate | $13.2M | $9.03M | $9.24M |
| Gross margin | 60% to 70% (input) | 50% to 74% (input) | -183% (Y1), 60% (Y3), 75% (Y5), 79% (Y7), output |
| CAC | $25K (input) | ~$14.9K (Y3, implied) | $15.0K (Y3), $17.9K (Y5) on direct accounts, output |
| LTV:CAC | 5.2x | 4.7x (Y3) | 4.1x (Y3), 5.4x (Y5); 2.0x / 3.1x at the $31K pessimistic CAC |
| First EBITDA-positive year | "between years 3 and 4" (F6 9.5) | Year 7 | Year 6 |
| Seed | $2.0-3.0M | $7.5M ($4.0M + $3.5M) | $7.0M ($4.0M + $3.0M) |
| Series A | ~$10-14M (median reference) | $8.5M | $8.5M |
| Seed runway | ~30 months at $2.5M | to ~month 43 | 49 months with both tranches, no Series A |
| Year-1 monthly burn | $75-85K | ~$77K (EBITDA basis) | $81.4K (free-cash-flow basis) |

F6 (the investor brief) still quotes the five-year numbers. Anyone reading F6 next to F5 sees a seed of $2.0-3.0M in one and $7.5M in the other, a $40K ACV in one and $13K-31K in the other, and break-even in year 3-4 against year 7. The investor package should carry one set of numbers; we recommend the owner retire F1-F3 and update F6 and F7 to the figures in `financial/scenarios.md`.

## 5. What we reused and what we changed

We kept F4 wherever it holds up: the revenue-per-account build (platform fee, amount recovered, recovery share), the three new-account plans, churn, revenue multipliers, cost scales, the headcount plan by role, the six other-cost lines, the 4% inflation, the 20% buffer and the $2.5M Series A milestone. Before change C14 the new model reproduced F4 base revenue and ARR to the dollar ($7,300.2K revenue and $9,025.2K ARR in year 5); C14 then made the segment mix explicit. Effects in rows C1-C11 are stated as of the first draft; C14 gives the current figures.

| # | Change | Why | Effect (base case) |
|---|---|---|---|
| C1 | Cost of revenue built bottom-up: claims-operations people + hosting and data + variable cost (new input, 8% of revenue). Claims staff and hosting removed from operating expense. Gross margin becomes an output. | F4 counted these costs twice (4.2 item 1). | Year-3 gross margin 61% (F4 64%); year-5 74% (F4 71%); EBITDA turns positive in year 6 instead of year 7 |
| C2 | NOK per USD 10.5 -> 9.3817 | Live Norges Bank rate wins over the repo figure (brief rule) | Norwegian loaded costs rise about 12%; software engineer $126.0K instead of $115K |
| C3 | Norwegian pay entered in NOK and converted; US pay entered as wages / (1 - 0.30) | Makes the FX and benefits inputs actually drive cost | Sales engineer $178.4K instead of $175K; other US roles unchanged |
| C4 | Year-1 hiring quarter per role replaces the `*0.6` factor | Hardcode removed; drives the quarterly budget | 3.25 non-founder FTE-years in year 1 instead of 3.0 |
| C5 | Bear cost response modelled: hold headcount and spend at year-2 level for years 3-4, then resume the scaled plan | F5 described it, F4 did not model it | See `scenarios.md` |
| C6 | Added tax (22%, loss carry-forward), depreciation, receivables (60 days), payables (30 days), cash flow statement and balance sheet | Required tabs; contingency revenue is collected late | Seed need $6.80M including buffer and half of the year-4 burn |
| C7 | Seed $7.5M -> $7.0M (tranche 1 $4.0M unchanged, tranche 2 $3.5M -> $3.0M) | Re-sized to the new model's need ($6.80M) | Base seed-only runway 50 months; lowest year-end cash $2.46M (year 3) |
| C8 | Scenario names Upside/Downside -> Bull/Bear; all scenario levers moved to Assumptions | Brief naming; one place for inputs | None on numbers |
| C9 | Platform fee and recovery share relabelled ASSUMED (first draft: PENDING research) | Market-researcher found no competitor publishes pricing, so research cannot confirm them | None |
| C10 | Addressable accounts set to 334,514 (carriers 5-100 trucks + SME importers + brokers) | Market-researcher counts (FMCSA, US Census); used only for the share-of-market check | Year-7 base accounts = 0.18% of the count |
| C12 | SAM fee pool input $474.2M (`sam_usd`) and a Revenue row for revenue as a share of SAM | market-researcher 05-market-size.md | Base year-7 revenue = 3.5% of SAM (3.6% after C14) |
| C13 | Carrier-economics sensitivity: every account at $7,895 a year | SAM is 96% carriers, the revenue build is importer-shipper | Seed need $9.16M, seven-year need $35.7M, no break-even. After C14 replaced by the all-carrier run (same account count, all carriers): $9.34M seed, $36.0M total |
| C14 | Explicit segment mix (owner decision 2026-10-17): direct accounts split 50/50 between mid-market shippers (77% of the importer recovery, `shp_mult`) and SME importers (F4 path); carriers added as a separate partner-led segment from year 3 (base 0, 0, 15, 30, 50, 70, 90 new a year) at $7,895 each with a 20% partner commission booked in Sales. Unit economics now measured on direct accounts; carrier CAC = commission / new carriers. All-carrier run kept as a downside sensitivity | The prior model depended on an unstated mix; the market SAM is 96% carriers | Year-7 revenue $16.43M -> $16.91M; accounts 605 -> 805 (304 / 301 / 200); seed need $6.80M -> $6.91M (raise stays $7.0M); runway 50 -> 49 months; EBITDA positive year 6 unchanged; year-3 LTV : CAC 4.5x -> 4.1x; all-carrier downside needs $36.0M of equity |
| C15 | SAM inputs replaced with market-researcher v3 (2026-10-18 revision): `sam` 32,765 shipper + importer accounts, `sam_usd` $1,009.2M (shippers $613.9M + importers $395.3M); share-of-SAM rows now use shipper + importer accounts and revenue only. C10 and C12 values (334,514 accounts, $474.2M) are withdrawn by market-researcher | Shipper- and importer-first sizing; carriers and brokers belong to the TAM (133,256 accounts, $4.10B) | Base year-7 direct accounts = 1.8% of SAM accounts, revenue = 1.5% of the SAM pool; shipper revenue 1.2% of $613.9M, importer revenue 2.1% of $395.3M (the earlier 44%-of-importer-pool problem is resolved); no headline number changes |
| C16 | SAM pool `sam_usd` $1,009.2M -> $945.4M; TAM $4.10B -> $1,855.5M (market-researcher final, 2026-10-18, at our year-7 segment rates: shippers $27.6K, importers $30.8K, carriers $7,895, brokers $12K assumed) | Market size and model now use the same revenue per account | Base year-7 direct revenue = 1.6% of SAM (was 1.5%); shippers 1.3% of $550.1M; importers 2.1% of $395.3M unchanged; account shares unchanged; no headline number changes |
| C11 | Pessimistic CAC input $31K (Metadata 2026 paid-media cost per small-company customer) with LTV : CAC and payback rows | Digital-marketing showed the investor-brief funnel assumes about 6x the observed paid lead-to-customer rate | Year-3 LTV : CAC 2.2x at $31K; full-model seed need $9.86M (after C14: 2.0x and $9.98M) |

The five-year model (F1-F3) is not reused. Its $40K ACV rests on a 1% recoverable share of a $20M freight spend that no source supports, and the product scope has since moved to the F8 build.

## 6. Formula-drivenness check (recorded 2026-10-17, re-run 2026-10-18 after C14)

`financial/tools/verify_model.py` runs these checks against `financial/model.xlsx`; results are in `financial/tools/verify_results.json`. The workbook is evaluated with the open-source `formulas` package (v1.3.4), so the check does not depend on Excel having cached values.

1. **No hardcoded numbers outside Assumptions.** Numeric constant cells on the eight non-Assumptions tabs: **0**. Formula cells: Revenue 254, Headcount 308, OpEx 254, P&L 140, Cash Flow 161, Balance Sheet 84, Unit Economics 161, Scenarios 1,478. Formulas contain only structural constants (12 months, 365 days, 4 quarters, 1000, 0.5 for a mid-year round).
2. **Balance sheet balances** in all seven years (check row = 0) for Base, Bull and Bear.
3. **The two engines agree.** The Scenarios tab recomputes all three scenarios independently; its active-scenario revenue, EBITDA, net income, free cash flow and closing cash equal the main tabs in every year (difference 0).
4. **The year-1 quarterly budget sums to the annual model** (difference 0).
5. **One assumption changed at a time, model rebuilt and recomputed:**

| Change | P&L rows that moved | Example |
|---|---|---|
| Recovery share, year 3: 14% -> 20% | Revenue, EBITDA, net income | Y3 revenue $1,464.9K -> $1,773.8K; Y3 EBITDA -$1,894.6K -> -$1,610.4K |
| Compensation inflation: 4% -> 6% | EBITDA, net income | Y7 EBITDA $4,052.4K -> $2,922.8K |
| NOK per USD: 9.3817 -> 10.5 | EBITDA, net income | Y7 EBITDA $4,052.4K -> $4,474.7K |

The balance sheet still balanced after each change. Rerun with `financial/.venv/Scripts/python.exe financial/tools/verify_model.py`.

## 7. Limits of this audit

We could not render the PDFs as images (no poppler on this machine) and read F5 through extracted text only; tables and charts may have lost layout. The `formulas` package could not evaluate F4 Financing!B4 (a `MATCH(TRUE, INDEX(range>=x,0),0)` array idiom), so we recomputed the milestone month by hand from year-end ARR. The other F5 figures we did not trace back to F4 are listed in `financial/scenarios.md` under open questions. Market-researcher asked that the repo figure for the freight-audit-and-payment market (~$3.1B) be dropped as unreproducible; this model never used it. The TAM work in `research/05` assumes a $40K shipper contract value and a 20% fee from the old five-year model, which differs from the revenue per account here ($13.0K-30.8K); the business plan should use one set.
