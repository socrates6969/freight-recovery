# Assumptions

Date: 2026-10-17. Status: draft for owner review. Model: `financial/model.xlsx`, tab Assumptions.

With no customers and no revenue, scoup.ai has no history for this model to calibrate against. Of its 79 inputs, 11 are sourced from a primary or reputable secondary publication (re-checked today by us or by the market-researcher and digital-marketing agents, with links), and 68 are our own assumptions. The ratio is the honest state of a pre-product company, and we show it rather than dress assumptions up as findings. Where an assumption leans on a published figure for context (Carta for the Series A bar, Benchmarkit for churn and sales efficiency), the figure is sourced but the input we chose is still marked ASSUMED.

Every input lives on the Assumptions tab in blue. Column I carries the status and column J the source or the reasoning, and the table below is generated from the same metadata the build script writes into the workbook (`financial/tools/build_model.py`), so the two cannot drift apart. All money is in thousands of US dollars unless the label says NOK or USD. Year 1 is the first twelve months after the seed closes.

## How the statuses are used

- **SOURCED**: the value comes from a named publication, with URL and access date. Re-verified on 2026-10-17.
- **ASSUMED**: our planning choice. The reasoning column says what it rests on and how we would measure it.
- **PENDING research**: none left. Market research arrived on 2026-10-17 (`research/05-market-size.md` v3): the SAM is 32,765 shipper and importer accounts ($945.4M at our segment rates), the TAM 133,256 accounts ($1,855.5M). Platform fee and recovery share stay ASSUMED, because no competitor publishes its pricing.

## The inputs that move the answer most

Four assumptions decide whether the plan works, and none of them is measured.

**Amount recovered per account ($52K in year 1, rising to $115K).** Revenue per account is a fee on money the customer recovers, so this number drives revenue one-for-one. The $52K comes from the October business case: a mid-size importer-shipper with 2,000 TEU of imports might recover $36K of non-compliant demurrage and detention charges (15% of a $240K exposure) and $16K of fuel-surcharge overbilling. Both percentages are guesses that the first design partners will replace. A 20% shortfall in revenue per account raises the seed need from $6.91M to $7.62M and moves the Series A milestone from month 38 to month 40 (`tools/verify_results.json`, stress runs).

**Sales and marketing efficiency.** The plan spends $0.73 of sales and marketing per $1 of new direct ARR in year 3. The Benchmarkit 2024 median is $2.00. We kept the investor-pack plan because founder-led selling, a free review of past invoices and a channel partner from year 3 can plausibly beat the median for a while, but we treat it as the largest single risk. At $2.00 the base case would need an $11.9M seed and $38.5M of equity over seven years. A second, sourced pessimistic case uses the paid-media cost of acquiring a small-company customer, $31K (Metadata.io 2026 B2B Paid Media Benchmark, 2025 data). At that CAC the base case needs a $10.0M seed and $18.7M over seven years, and LTV : CAC is 2.0x in year 3. This is why tranche 2 of the seed is tied to measured acquisition cost.

**Recovery share and platform fee.** The fee path (25% contingency in pilots, then a $6K-17K platform fee plus 12-17%) is the investor-pack pricing. One published reference point is far above it (Refund Retriever, a parcel-audit firm, charges 40-50%), which suggests room on price but is a different market. Market-researcher found that none of the nine freight competitors profiled (Loop, Cass, Trax, CTSI-Global, nVision Global, Intelligent Audit, BlueCargo, Hey Bubba, FleetOptos) publishes a contingency rate, so the fee path stays an assumption that pilots must test.

**Segment mix (owner decision, 2026-10-17).** The owner set the go-to-market as shipper- and importer-first. New direct accounts split 50/50 between mid-market shippers and SME importers (`mix_shp`); a shipper recovers 77% of the importer amount because it has no ocean demurrage and detention (`shp_mult`, built from the $16K fuel-surcharge example plus an assumed $24K of accessorial and detention audit). Carriers are a small, partner-led segment from year 3 in the base case at $7,895 a year each (market-researcher carrier fee, `car_rec` x `car_share`), with a 20% partner commission (`partner`). If every account were a carrier instead, the base plan would need $36.0M of equity and never break even, which is why the mix is now explicit.

**Churn (20% base).** Contingency service is easy to switch off. The Benchmarkit median gross revenue retention of 88% is for subscription software; we assume worse retention than that median for the base case and better in the bull case.

## Inputs that changed from the investor-pack workbook

Three inputs carry new values, each logged in `audit.md` section 5. The NOK/USD rate moved from 10.5 to the live Norges Bank September 2026 average of 9.3817, which makes Norwegian staff about 12% more expensive in dollars. The gross-margin path was replaced by a variable cost of revenue (8% base, 7% bull, 10% bear) plus explicit claims staff and hosting, because the old workbook counted those costs twice. The seed tranche 2 fell from $3.5M to $3.0M after re-sizing. Two inputs are new: the year-1 hiring quarter for each role (replacing a hidden 0.6 factor) and the bear-case hold on hiring for years 3 and 4.

## Full input list

| Key | Input | Value (Y1..Y7, or Base / Bull / Bear) | Status | Source / reasoning |
|---|---|---|---|---|
| `infl` | Compensation inflation per year | 4% | ASSUMED | Planning assumption carried from the investor-pack workbook (grade C). |
| `fx` | NOK per USD | 9.3817 | SOURCED | Norges Bank, USD/NOK monthly average Sep 2026 = 9.3817, https://data.norges-bank.no/api/data/EXR/M.USD.NOK.SP, accessed 2026-10-17. Replaces 10.5 in the prior workbook. |
| `no_load` | Norway loading on gross salary (employer tax + pension + other) | 1.22 | ASSUMED | Employer tax zone I 14.1% is SOURCED (Skatteetaten, https://www.skatteetaten.no/satser/arbeidsgiveravgift/, accessed 2026-10-17); the remaining ~8 points (mandatory pension, insurance) are assumed. |
| `us_ben` | US benefits share of total compensation | 30% | SOURCED | BLS Employer Costs for Employee Compensation, June 2026: benefits 30.0% of private-industry compensation, https://www.bls.gov/news.release/ecec.nr0.htm, accessed 2026-10-17. Loaded cost = wage / (1 - 0.30). |
| `tax` | Norwegian corporate income tax rate | 22% | SOURCED | 22% (DLA Piper Global Expansion Tax, Norway, https://intelligence.dlapiper.com/global-expansion-tax/?c=NO, accessed 2026-10-17). Unlimited loss carry-forward assumed; confirm with counsel. |
| `dso` | Days sales outstanding | 60 | ASSUMED | Contingency fees are invoiced after the counterparty pays the customer; 60 days assumed. Unmeasured. |
| `dpo` | Days payable outstanding (non-payroll costs) | 30 | ASSUMED | Standard 30-day vendor terms assumed. |
| `capex` | Equipment capex per net new hire ($K) | 3 | ASSUMED | Laptop and peripherals. Software development is expensed, not capitalised. |
| `dep` | Depreciation life (years) | 3 | ASSUMED | Straight line. |
| `int` | Interest earned on cash | 0 | ASSUMED | Set to zero for conservatism. |
| `cash0` | Opening cash at seed close, before seed ($K) | 0 | ASSUMED | UNKNOWN; owner to confirm founder-funded cash and share capital (NOK 30,000 minimum for an AS). |
| `milestone` | Series A ARR milestone ($K) | 2,500 | ASSUMED | Planning target. Reference: median ARR at Series A $2.8M in 2025 (Carta, ARR at Series A, https://carta.com/data/newsletter-arr-at-series-a/, figure confirmed via search result 2026-10-17; direct fetch returned HTTP 403). |
| `buffer` | Cash buffer on each round | 20% | ASSUMED | Planning assumption carried from the investor-pack workbook. |
| `seed1` | Seed tranche 1 ($K) | 4,000 | ASSUMED | Plan decision; sized against the Cash Flow funding-need rows. |
| `seed1y` | Seed tranche 1 year | 1 | ASSUMED | At close. |
| `seed2` | Seed tranche 2 ($K) | 3,000 | ASSUMED | Released at milestone: 5 paying customers, recovery measured on real invoices, ARR above $0.5M. |
| `seed2y` | Seed tranche 2 year | 2 | ASSUMED | Base case passes $0.5M ARR in year 2. |
| `seriesA` | Series A ($K) | 8,500 | ASSUMED | Plan decision, kept from the investor-pack plan; tested against all three scenarios. |
| `seriesAy` | Series A year | 4 | ASSUMED | Base case crosses the ARR milestone early in year 4. |
| `pre` | Seed pre-money valuation ($K) | 18,400 | ASSUMED | Orientation only: median US seed pre-money $18.4M in Q1 2026 (PitchBook via WaveUp, grade C, not re-verified). Terms are set with the lead investor. |
| `bench_sm` | Benchmark: S&M spend per $1 of new ARR | 2 | SOURCED | Benchmarkit 2025 SaaS Performance Metrics (2024 data), median New CAC Ratio $2.00, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-17. |
| `bench_grr` | Benchmark: median gross revenue retention | 88% | SOURCED | Benchmarkit 2025 report: GRR 88%, same URL, accessed 2026-10-17. |
| `bench_nrr` | Benchmark: median net revenue retention | 101% | SOURCED | Benchmarkit 2025 report: NRR 101%, same URL, accessed 2026-10-17. |
| `sam` | SAM: addressable shipper + importer accounts (count) | 32,765 | SOURCED | market-researcher research/05-market-size.md v3 (2026-10-17): 19,932 mid-market shippers (Census SUSB 2022 firms with $100M-$999.9M receipts in manufacturing, wholesale and retail, i.e. $5M-$50M freight spend at 4.68% transport-to-sales, Establish via DC Velocity 2008, grade B) + SME importers capped at 12,833 (FMC D&D pool $3.08B / $240K exposure). TAM adds carriers 72,053 and brokers 28,438 = 133,256 accounts. |
| `sam_usd` | SAM: annual revenue pool, shipper + importer accounts ($K) | 945,400 | SOURCED | market-researcher research/05-market-size.md v3: final figure at our year-7 segment rates: shippers 19,932 x $27.6K = $550.1M + importers 12,833 x $30.8K = $395.3M = $945.4M; range $0.61B-$1.01B because the shipper/importer overlap is unknown. TAM $1,855.5M (133,256 accounts: SAM + 72,053 carriers x $7,895 + 28,438 brokers x $12K, broker rate assumed). Replaces the flat-rate $1,009.2M SAM / $4.10B TAM. Supersedes the withdrawn v2 figures ($474.2M SAM, $10.30B TAM, $8.99B SAM). |
| `pess_cac` | Pessimistic CAC: paid-media cost per small-company customer ($K) | 31 | SOURCED | Metadata.io, 2026 B2B Paid Media Benchmark Report (2025 data, 153 advertisers): small-company customer cost $31k, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17. Media cost only; excludes sales labour. LinkedIn cost per customer $58,572 (same source, reported by digital-marketing, not re-verified by finance). |
| `fee` | Platform fee | 0 / 6 / 10 / 13 / 15 / 16 / 17 | ASSUMED | Investor-pack workbook (grade C). Hybrid fee starts in year 2. No competitor publishes pricing (market-researcher research/01-competitors.md, 2026-10-17), so there is no market check. |
| `recov` | Amount recovered for the customer | 52 / 70 / 85 / 95 / 105 / 110 / 115 | ASSUMED | Year 1 $52K = business-case base for a mid-size importer-shipper (D&D $36K + fuel surcharge $16K), built on FMC and EIA/ATRI figures; grows as modules are added. Not measured on any customer data. |
| `share` | Recovery share (contingency %) | 25% / 17% / 14% / 12% / 12% / 12% / 12% | ASSUMED | 25% pilot contingency, falling once the platform fee starts. No freight competitor publishes a contingency rate (market-researcher research/01-competitors.md, 2026-10-17). Only public reference: Refund Retriever (parcel audit) 40-50%, https://www.refundretriever.com/pricing, accessed 2026-10-17. |
| `mix_shp` | Shipper share of new shipper + importer accounts | 50% | ASSUMED | Owner decision 2026-10-17: shipper- and importer-first. 50/50 split assumed; SME importers are counted (234,023, US Census) but mid-market shippers are not yet. |
| `shp_mult` | Shipper amount recovered vs importer path | 0.77 | ASSUMED | A domestic mid-market shipper has no ocean D&D. Business-case year-1 example: fuel-surcharge recovery $16K (business case, EIA-based) + accessorial and detention invoice audit $24K (assumed) = $40K vs $52K for an importer = 0.77. |
| `car_rec` | Carrier: amount recovered per carrier ($K/yr) | 39.475 / 39.475 / 39.475 / 39.475 / 39.475 / 39.475 / 39.475 | ASSUMED | market-researcher research/02 and 05 (2026-10-17): $471.60 fee per power unit x 16.7 units = $7,895 per carrier at a 20% fee, so recovered = $7,895 / 20% = $39.5K. Built on assumed inputs (400 stops per truck, $100 per detained stop, 30% winnable); ATRI 39.3% detention rate sourced. |
| `car_share` | Carrier: contingency share (no platform fee) | 20% | ASSUMED | Fee used in the research carrier model and in gtm.md. |
| `partner` | Partner commission on carrier revenue (factoring / ELD channel) | 20% | ASSUMED | Carriers come through a channel partner, not direct sales; commission booked in the Sales department. |
| `churn` | Annual logo churn | 20% / 15% / 30% | ASSUMED | Share of start-of-year accounts lost in the year. Benchmarkit median GRR 88% implies ~12% revenue churn for SaaS; a contingency service is easy to switch off, so 20% base. |
| `rmult` | Revenue per account vs base path | 1 / 1.15 / 0.8 | ASSUMED | Bull: larger recoveries and early platform-fee adoption. Bear: recoveries 20% lower. |
| `scale` | Headcount and spend scale vs base plan | 1 / 1.1 / 0.85 | ASSUMED | Applied to every role except the founder, and to other operating costs from year 2. |
| `freeze` | Hold headcount and spend at prior-year level from year (0 = never) | 0 / 0 / 3 | ASSUMED | Bear cost response: if the tranche-2 milestone is missed, hold at year-2 levels (investor-pack financial plan section 4 describes this but the workbook did not model it). |
| `fdur` | Number of years the hold lasts | 0 / 0 / 2 | ASSUMED | Bear: years 3 and 4 held at year-2 levels, then the scaled plan resumes. A permanent hold would leave 2 claims analysts serving 235 accounts, which is not credible. |
| `varc` | Variable cost of revenue (% of revenue) | 8% / 7% / 10% | ASSUMED | New input: LLM inference, OCR and per-container event data. Unmeasured; replaces the gross-margin-% input of the prior workbook. |
| `new_Base` | New shipper + importer accounts won - Base | 6 / 30 / 75 / 120 / 165 / 200 / 235 | ASSUMED | Plan input from the investor-pack workbook (grade C). No pipeline exists yet. |
| `new_Bull` | New shipper + importer accounts won - Bull | 8 / 40 / 100 / 160 / 215 / 260 / 300 | ASSUMED | Plan input from the investor-pack workbook (grade C). No pipeline exists yet. |
| `new_Bear` | New shipper + importer accounts won - Bear | 4 / 16 / 35 / 55 / 75 / 90 / 105 | ASSUMED | Plan input from the investor-pack workbook (grade C). No pipeline exists yet. |
| `car_Base` | New carrier accounts via partner - Base | 0 / 0 / 15 / 30 / 50 / 70 / 90 | ASSUMED | Small partner-led segment starting later (base: factoring partner from year 3; bull: partner signed in year 2; bear: partner slips to year 5). |
| `car_Bull` | New carrier accounts via partner - Bull | 0 / 10 / 30 / 60 / 90 / 120 / 150 | ASSUMED | Small partner-led segment starting later (base: factoring partner from year 3; bull: partner signed in year 2; bear: partner slips to year 5). |
| `car_Bear` | New carrier accounts via partner - Bear | 0 / 0 / 0 / 0 / 10 / 20 / 30 | ASSUMED | Small partner-led segment starting later (base: factoring partner from year 3; bull: partner signed in year 2; bear: partner slips to year 5). |
| `hc_ceo` | Founder / CEO - headcount plan | 1 / 1 / 1 / 1 / 1 / 1 / 1 | ASSUMED | Department: G&A. Plan from the investor-pack workbook (grade C). |
| `sal_ceo` | Founder / CEO - annual pay (NOK) | 1.2e+06 | ASSUMED | NOK pay held below market until Series A; equals the $140K loaded in the prior workbook at 10.5 NOK/USD. |
| `sq_ceo` | Founder / CEO - year-1 start quarter (1-4) | 1 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_swe` | Software engineers - headcount plan | 2 / 3 / 5 / 8 / 10 / 12 / 13 | ASSUMED | Department: Engineering. Plan from the investor-pack workbook (grade C). |
| `sal_swe` | Software engineers - annual pay (NOK) | 969,240 | SOURCED | SSB average monthly earnings, information and communication, Nov 2025: NOK 80,770 x 12, https://www.ssb.no/arbeid-og-lonn/lonn-og-arbeidskraftkostnader/statistikk/lonn, accessed 2026-10-17. |
| `sq_swe` | Software engineers - year-1 start quarter (1-4) | 2 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_ml` | ML / data engineers - headcount plan | 1 / 1 / 2 / 3 / 3 / 4 / 4 | ASSUMED | Department: Engineering. Plan from the investor-pack workbook (grade C). |
| `sal_ml` | ML / data engineers - annual pay (NOK) | 1.06e+06 | ASSUMED | SSB sector average plus ~9% for specialist skills (ratio kept from the prior workbook). |
| `sq_ml` | ML / data engineers - year-1 start quarter (1-4) | 3 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_sec` | Security engineer - headcount plan | 1 / 1 / 1 / 2 / 2 / 3 / 3 | ASSUMED | Department: Security. Plan from the investor-pack workbook (grade C). |
| `sal_sec` | Security engineer - annual pay (NOK) | 1.06e+06 | ASSUMED | As ML / data engineers. |
| `sq_sec` | Security engineer - year-1 start quarter (1-4) | 2 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_ae` | Account executives (US) - headcount plan | 0 / 1 / 3 / 5 / 7 / 8 / 9 | ASSUMED | Department: Sales. Plan from the investor-pack workbook (grade C). |
| `sal_ae` | Account executives (US) - annual pay (USD) | 161,000 | ASSUMED | On-target earnings, set so the loaded cost equals the $230K in the prior workbook. Not re-verified. |
| `sq_ae` | Account executives (US) - year-1 start quarter (1-4) | 1 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_se` | Sales engineer (US) - headcount plan | 0 / 1 / 1 / 2 / 2 / 3 / 3 | ASSUMED | Department: Sales. Plan from the investor-pack workbook (grade C). |
| `sal_se` | Sales engineer (US) - annual pay (USD) | 124,900 | SOURCED | BLS Occupational Outlook Handbook, sales engineers median $124,900 (May 2025), https://www.bls.gov/ooh/sales/sales-engineers.htm, accessed 2026-10-17. |
| `sq_se` | Sales engineer (US) - year-1 start quarter (1-4) | 1 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_cs` | Claims analysts / customer success (US) - headcount plan | 1 / 2 / 4 / 7 / 10 / 13 / 16 | ASSUMED | Department: Claims operations (COGS). Plan from the investor-pack workbook (grade C). |
| `sal_cs` | Claims analysts / customer success (US) - annual pay (USD) | 70,000 | ASSUMED | Analyst base pay ~$70K (prior workbook, grade C). |
| `sq_cs` | Claims analysts / customer success (US) - year-1 start quarter (1-4) | 3 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_mkt` | Marketing (US) - headcount plan | 0 / 0 / 1 / 1 / 2 / 2 / 2 | ASSUMED | Department: Marketing. Plan from the investor-pack workbook (grade C). |
| `sal_mkt` | Marketing (US) - annual pay (USD) | 105,000 | ASSUMED | Estimate; loaded $150K as in the prior workbook. |
| `sq_mkt` | Marketing (US) - year-1 start quarter (1-4) | 1 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `hc_fin` | Finance, legal operations, people - headcount plan | 0 / 1 / 1 / 2 / 2 / 3 / 3 | ASSUMED | Department: G&A. Plan from the investor-pack workbook (grade C). |
| `sal_fin` | Finance, legal operations, people - annual pay (NOK) | 1.12e+06 | ASSUMED | SSB sector average plus ~15%; loaded $130K at 10.5 NOK/USD in the prior workbook. |
| `sq_fin` | Finance, legal operations, people - year-1 start quarter (1-4) | 1 | ASSUMED | Hiring quarter for year-1 hires; drives the year-1 quarterly budget. |
| `o_host` | Cloud hosting, data feeds and tooling [COGS] | 45 / 80 / 140 / 220 / 300 / 370 / 430 | ASSUMED | Terraform footprint plus container-event data fees (prior workbook, grade C). |
| `o_sec` | Security programme (SOC 2, pen tests, tooling, insurance) [Security] | 120 / 150 / 170 / 190 / 210 / 230 / 250 | ASSUMED | SOC 2 Type II first year $50-110K and pen tests $15-35K each (vendor blogs, grade C, not re-verified). |
| `o_legal` | Legal and regulatory [G&A] | 150 / 110 / 120 / 140 / 150 / 160 / 170 | ASSUMED | US entity, customer contracts, FMC and data-protection counsel (grade C). |
| `o_mkt` | Marketing programmes and events [Marketing] | 30 / 90 / 200 / 320 / 420 / 480 / 520 | ASSUMED | Trade shows (TIA, CSCMP, TPM), content, list data (grade C). Channel CAC from digital-marketing pending. |
| `o_trav` | Travel and customer visits [Sales] | 60 / 100 / 150 / 200 / 240 / 270 / 300 | ASSUMED | US customer and partner visits (grade C). |
| `o_off` | Office, software, admin, accounting [G&A] | 50 / 80 / 110 / 150 / 180 / 210 / 240 | ASSUMED | Estimate (grade C). |

## Open questions for the owner

1. Opening cash and share capital at seed close (`cash0` is set to 0).
2. Founder pay: the model uses NOK 1.2M (about $156K loaded at today's rate). Confirm or replace.
3. Whether the Norwegian AS or a Delaware C-corporation will employ the US staff; this changes payroll taxes and the 22% tax rate.
4. Whether development cost should be capitalised under Norwegian GAAP; the model expenses it all.
