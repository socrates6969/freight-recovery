# 05 Market size: TAM, SAM, SOM inputs

Status: pre-product. The product, scoup.ai, uses synthetic data only, has never been deployed and has no paying customers. Version 3, 2026-10-17: rebuilt for the owner’s shipper- and importer-first strategy. Mid-market shippers and SME importers form the SAM; carriers are a separate later segment. Revenue per account is the finance model’s (finance worktree: financial/assumptions.md, financial/unit-economics.md, financial/scenarios.md). Cross-checks that use other methods are labelled as such in section 5. No figure below is a forecast of our revenue, and none has been checked against a customer’s closed files.

Research date: 2026-10-17. Every input carries a grade.
- SOURCED-A: primary public data (regulator, statistical agency, SEC filing, our own query of a government dataset).
- SOURCED-B: reputable third-party research or trade survey, read at or near the primary.
- SOURCED-C: vendor or market-report claim; method not visible.
- ASSUMED: our number; untested; must be replaced by pilot data.

## 1. Why the headline numbers are not the TAM

Three large numbers get quoted for this market, and none of them is revenue we could earn. ATRI’s $15.1B is the cost of waiting, mostly lost productivity. The FMC’s $15.4B is what ocean carriers collected over five years, most of it legitimately owed. The $883.2B trucking figure is all US truck spend. We keep them because they show scale, and we keep them out of the TAM because they describe the problem, not our addressable fee pool.

| Input | Value | Grade | Source |
|---|---|---|---|
| Detention cost to US trucking, 2023 | $15.1B ($3.6B direct expense + $11.5B lost productivity) | SOURCED-B | ATRI, released 10 Sept 2024 |
| Share of stops with detention, 2023 | 39.3% | SOURCED-B | ATRI, same |
| Fleets that charge detention | 94.5% | SOURCED-B | ATRI, same |
| Share of detention invoices paid | fewer than 50% | SOURCED-B | ATRI, same |
| US business logistics costs, 2025 | $2.40T | SOURCED-B | CSCMP / Kearney 2026 State of Logistics |
| Trucking share of logistics spend, 2025 | 36.8%, so $883.2B (our arithmetic: 2.40T x 0.368) | SOURCED-B | same |
| Ocean D&D collected by nine largest carriers, Apr 2020 to Mar 2025 | $15.4B, an average of $3.08B a year (our arithmetic: 15.4 / 5) | SOURCED-A | FMC |
| Freight audit and payment market size | conflicting: $284.5M (2024, SkyQuest via GII); $6.8B (2025, Market Intelo); +$651.2M growth 2026-2030 at 11.2% CAGR (Technavio) | SOURCED-C | report landing pages |

Sources for the table:
Source: American Transportation Research Institute, "New Research Documents Substantial Financial and Safety Impacts from Truck Driver Detention", https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, accessed 2026-10-17
Source: SCDigest, coverage of the 2026 CSCMP State of Logistics report, https://www.scdigest.com/firstthoughts/26-06-26.php?cid=23144, accessed 2026-10-17
Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17
Source: GII (SkyQuest), Freight Audit and Payment Market, https://www.giikorea.co.kr/report/sky1913174-freight-audit-payment-market-size-share-growth.html, accessed 2026-10-17
Source: Market Intelo, Freight Audit and Payment Market Research Report 2034, https://marketintelo.com/report/freight-audit-and-payment-market, accessed 2026-10-17
Source: Technavio, Freight Audit and Payment Market, https://www.technavio.com/report/freight-audit-and-payment-market-industry-analysis, accessed 2026-10-17

Changes against figures already in the repo:
- ATRI $15.1B: confirmed against the live ATRI release. The repo graded it B from trade press; we read ATRI’s own release, so the components are now confirmed ($3.6B + $11.5B).
- Freight audit market "~$3.1B, ~6.8% growth" (market-analysis.md): not reproduced. The live report pages we reached give $284.5M, $6.8B and a growth-only figure, a 24-fold spread between the two size estimates. The repo figure should be dropped from investor material; if a FAP market number is needed, cite the spread and say why it is unusable.
- Trucking spend: the repo used no trucking-spend figure. The 2025 edition of State of Logistics put 2024 logistics at $2.58T; the 2026 edition restates 2024 at $2.43T and reports $2.40T for 2025. Use the 2026 edition.

## 2. Counts of buyers

| Input | Value | Grade | Source |
|---|---|---|---|
| Active interstate for-hire carriers, all sizes | 532,506 | SOURCED-A | FMCSA Company Census File, our query |
| Same, 5 to 100 power units, MCS-150 updated since 17 Oct 2024 | 72,053 carriers, 1,206,250 power units (average 16.7) | SOURCED-A | same |
| Same, 5 to 100 power units, no recency filter | 80,296 | SOURCED-A | same |
| Same, 11 to 100 power units, recent filers | 32,676 | SOURCED-A | same |
| US importing companies, 2024 | 240,535 (234,023 SME, 6,512 large) | SOURCED-A | Census CB26-73 |
| SME share of known import value, 2024 | $884B of $2,926B = 30.2% (our arithmetic) | SOURCED-A | same |
| Active freight brokerage authorities, Jan 2024 | 28,438 | SOURCED-B | Carrier Details / Brush Pass via FreightCaviar |
| US firms with $100M to $999.9M receipts in manufacturing, wholesale and retail, 2022 | 19,932 (manufacturing 5,971; wholesale 8,798; retail 5,163) | SOURCED-A | Census SUSB 2022, receipts-size classes |
| Transportation cost as a share of sales, average company | 4.68% | SOURCED-B (2008) | Establish Inc. survey via DC Velocity |
| US shippers with $5M to $50M annual freight spend | 19,932 (modelled: $5M / 4.68% = $106.8M to $50M / 4.68% = $1.068B, rounded to the $100M to $999.9M Census classes); 9,366 at 2% freight-to-sales, 35,349 at 10% | ASSUMED (built from the two rows above) | 02-industries.md |
| Receipts of those 19,932 firms, 2022 | $4,057.4B; estimated freight spend $4,057.4B x 4.68% = $189.9B; average $9.53M per firm | SOURCED-A receipts, ASSUMED ratio | Census SUSB 2022 |

Source: FMCSA, Company Census File (dataset az4n-8mr2), https://data.transportation.gov/resource/az4n-8mr2.json, accessed 2026-10-17 (query script: research/scripts/fmcsa_carrier_counts.sh)
Source: U.S. Census Bureau, "A Profile of U.S. Importing and Exporting Companies, 2023-2024", 5 May 2026, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17
Source: FreightCaviar, 24 January 2024, https://freightcaviar.com/brush-pass-research-7-8-fewer-brokerages-than-a-year-ago, accessed 2026-10-17
Source: U.S. Census Bureau, Statistics of U.S. Businesses 2022, https://www2.census.gov/programs-surveys/susb/tables/2022/us_naicssector_large_rcptsize_2022.xlsx, accessed 2026-10-17 (extraction: research/scripts/susb_shipper_counts.py)
Source: DC Velocity, "Logistics costs and services 2008", https://www.dcvelocity.com/articles/31001-logistics-costs-and-services-2008, accessed 2026-10-17


The repo’s market analysis said the carrier and shipper counts were "not sourced yet". Both are now filled: carriers from the FMCSA census file, shippers from a model built on Census revenue classes. The shipper figure is a modelled count, not a list of firms, and it moves a lot with the freight-to-sales ratio.

## 3. Revenue per account: the finance model’s path

The investor package uses the finance model’s revenue per account by segment. The table shows the importer path; the model sets a shipper at 77% of the importer’s recovery (no ocean D&D), giving $27.6K in year 7, and a carrier at a flat $7,895 through a channel partner (financial/scenarios.md). Section 5 tests whether these fit each segment.

| Input | Y1 | Y2 | Y3 | Y4 | Y5 | Y6 | Y7 | Status |
|---|---|---|---|---|---|---|---|---|
| Platform fee ($K) | 0 | 6 | 10 | 13 | 15 | 16 | 17 | ASSUMED (finance input "fee") |
| Amount recovered for the customer ($K) | 52 | 70 | 85 | 95 | 105 | 110 | 115 | ASSUMED (finance input "recov") |
| Recovery share | 25% | 17% | 14% | 12% | 12% | 12% | 12% | ASSUMED (finance input "share") |
| Revenue per account, importer, base ($K) | 13.0 | 17.9 | 21.9 | 24.4 | 27.6 | 29.2 | 30.8 | model output |
| Revenue per account, shipper, base ($K) | 10.0 | 15.2 | 19.2 | 21.8 | 24.7 | 26.2 | 27.6 | model output |
| Revenue per account, carrier via partner ($K) | 7.9 | 7.9 | 7.9 | 7.9 | 7.9 | 7.9 | 7.9 | model output |

Revenue per account = platform fee + amount recovered x recovery share. Year 3: $10.0K + $85K x 14% = $21.9K. The year-1 recovery of $52K is the business case’s mid-size importer-shipper ($36K of non-compliant D&D on a $240K exposure, plus $16K of fuel-surcharge overbilling). Bull is 1.15x base and bear 0.8x (finance input "rmult").
Source: finance worktree, financial/assumptions.md (inputs fee, recov, share, rmult), financial/unit-economics.md and financial/scenarios.md, dated 2026-10-17

## 4. TAM, SAM, SOM (the package numbers)

Definitions. SAM is the core market under the shipper- and importer-first strategy: mid-market shippers plus the SME importers the D&D pool can support. TAM adds the segments we would serve later or have not tested: carriers and brokers. SOM is the finance base case. Every figure uses the finance model’s year-7 revenue per account for its segment (financial/scenarios.md): shipper $27.6K, SME importer $30.8K, carrier $7.9K ($7,895, through a channel partner). The model has no broker segment; for brokers we use $12,000 a year, ASSUMED; derived from a superseded price path (the business plan’s old phase-2 platform fee of $1,000 a month); finance’s model has no broker segment.

| Segment | Accounts | Year-7 revenue per account | Annual revenue at 100% | In |
|---|---|---|---|---|
| Mid-market shippers ($5M to $50M freight spend) | 19,932 | $27.6K | $550.1M | SAM core |
| SME ocean importers, capped by the FMC D&D pool | 12,833 | $30.8K | $395.3M | SAM core |
| **SAM** | **32,765** | | **$945.4M** | |
| Carriers, 5 to 100 power units (later, partner channel) | 72,053 | $7.9K | $568.9M | TAM only |
| Freight brokers (no evidence yet that they buy) | 28,438 | $12.0K (ASSUMED; derived from a superseded price path; finance’s model has no broker segment) | $341.3M | TAM only |
| **TAM** | **133,256** | | **$1,855.5M** | |

Arithmetic: 19,932 x $27.6K = $550.1M; 12,833 x $30.8K = $395.3M; SAM = $945.4M. 72,053 x $7,895 = $568.9M; 28,438 x $12,000 = $341.3M; TAM = $945.4M + $568.9M + $341.3M = $1,855.5M.

- **SAM: $945.4M a year** (32,765 accounts). The two core groups overlap by an unknown amount, because some mid-size wholesalers and manufacturers also import by container. If every capped importer were also in the shipper count, SAM would fall to 19,932 accounts and $550.1M. We report the range $0.55B to $0.95B.
- **TAM: $1.86B a year** (133,256 accounts). Counting all 234,023 SME importers instead of the 12,833 cap would add 221,190 accounts at $30.8K, a further $6.81B; section 5.2 explains why we do not.
- **SOM: the finance base case (segment-split model).** Year 7: 805 accounts and $16.91M revenue ($19.25M year-end ARR). Of these, 605 are direct accounts in the SAM (304 mid-market shippers and 301 SME importers, $15.58M revenue) and 200 are carriers won through a channel partner ($1.33M), which count against the carrier segment, not the SAM. Year 5: 412 accounts (165 shippers, 163 importers, 84 carriers) and $7.44M revenue. Bull year 7: 1,221 accounts (424 shippers, 423 importers, 374 carriers) and $27.92M.
- **Shares, year 7 base:** direct accounts 605 / 32,765 = 1.8% of SAM accounts (bull 847 = 2.6%); shippers 304 / 19,932 = 1.5%; importers 301 / 12,833 = 2.3%; carriers 200 / 72,053 = 0.3% of the carrier segment. By revenue: direct $15.58M / $945.4M = 1.6% of SAM; shippers $7.40M / $550.1M = 1.3%; importers $8.18M / $395.3M = 2.1%; carriers $1.33M / $568.9M = 0.2%; total $16.91M / $1,855.5M = 0.9% of TAM.
Source: finance worktree, financial/scenarios.md, base and bull case tables, dated 2026-10-17

Alignment with finance: the model uses 32,765 SAM accounts and 133,256 TAM accounts and the same segment rates (financial/scenarios.md, section "Market size and share of SAM"). The 12,833 capped importers are the mid-size importers the model’s importer revenue path assumes (about $36K of D&D recovery each; see 02-industries.md, "Importers by size").

## 5. Cross-checks (separate methods, not package numbers)

### 5.1 Shippers: does the model’s recovery path fit?

Average freight spend in the shipper band is $9.53M (section 2). At 1% recoverable unsupported accessorials and errors (ASSUMED; audit vendors claim 1% to 9%, grade C), a typical shipper recovers $95.3K a year. The model’s recovery path runs from $52K (year 1) to $115K (year 7), so the shipper cross-check lands inside it. At the ends of the band the fit breaks: a $5M-spend shipper recovers $50K and a $50M-spend shipper $500K at the same 1%.

### 5.2 Importers: the FMC D&D pool caps the count

At the model’s $36K D&D recovery per account, all 234,023 SME importers would need $36K x 234,023 = $8.42B a year, 2.7 times the $3.08B the nine largest carriers collect in D&D a year (FMC, April 2020 to March 2025 average). If the whole pool were spread across accounts with the business case’s $240K exposure, it would support $3.08B / $240K = 12,833 importer accounts. That is the cap used in the SAM. It is generous, since it assumes every D&D dollar sits with an importer of that size.
Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17

### 5.3 Carriers: detention-dollar bottom-up

Inputs: 400 stops per power unit per year (ASSUMED) x 39.3% detained (SOURCED-B, ATRI) x $100 billable per detained stop (ASSUMED; ATRI’s 2019 average fee was $63.71 an hour) x 50% unpaid (SOURCED-B as a floor) x 30% winnable (ASSUMED) = $2,358 per power unit a year, or $39.5K per average carrier of 16.74 power units. At the model’s year-3 terms that is $10.0K + 14% x $39.5K = $15.5K of revenue, 29% below the model’s $21.9K. The finance model prices a partner-channel carrier at a flat $7,895 a year, which is this method’s fee per average carrier at a 20% contingency ($39.5K recovered x 20%). The TAM carrier row uses that rate: 72,053 x $7,895 = $568.9M.
Source for $63.71: J. J. Keller Compliance Network, 5 September 2019, https://jjkellercompliancenetwork.com/news/atri-driver-detention-frequency-length-on-the-rise, accessed 2026-10-17

### 5.4 Superseded figures

Earlier versions of this file were sent on 2026-10-17 and are withdrawn. Version 1: TAM excluding shippers $971.8M, SAM $474.2M, year-5 SOM $14.6M (20% fee, $40,000 shipper contract). Version 2: TAM $10.30B, SAM $8.99B (carriers plus all SME importers), capped SAM $2.17B, on 334,514 accounts that excluded shippers. Neither should appear in the package. Version 3 as first sent applied a flat $30.8K to every segment: SAM $1.01B (range $0.61B to $1.01B), TAM $4.10B (carriers $2,219.2M, brokers $875.9M at $30.8K). It was replaced on 2026-10-17 by the segment rates above so that market size and the finance model agree; the flat figures are superseded.

## 6. What would change these numbers most

Four inputs drive the package numbers, and all four are assumed or dated. The freight-to-sales ratio behind the shipper count comes from a 2008 survey; a purchased firmographic list filtered by revenue and industry, or a current Establish figure, would replace it. The amount recovered per account and the fee path can only come from design partners’ closed files. The overlap between mid-market shippers and SME importers decides where SAM falls between $0.55B and $0.95B, and an import-records dataset matched to firm size would settle it. Carriers matter for TAM only, and their own cross-check says the model path overstates them.
