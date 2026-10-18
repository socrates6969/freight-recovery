# Open questions

Status: pre-product. The product, scoup.ai, uses synthetic data only, never deployed, no paying customers. This file lists every figure we could not source and every URL we could not reach during the 2026-10-17 research pass, so the next pass (or a paid data purchase) can close them. Nothing here was replaced with a guess.

## UNKNOWN values (needs primary research)

| # | Question | Where it is used | Suggested route |
|---|---|---|---|
| 1 | How many US shippers have $5M to $50M annual freight spend? Now MODELLED at 19,932 (Census SUSB 2022 revenue classes x Establish 2008 freight-to-sales ratio of 4.68%); 9,366 at 2%, 35,349 at 10%. Needs a current ratio or a direct count | 02, 05 (SAM core) | Buy a firmographic list (D&B, ZoomInfo) filtered by industry and revenue; request a current Establish logistics-cost figure |
| 2 | How many US importers move goods by ocean container, and how many are SMEs? | 02 (importers) | Census importer data by mode is not in the public profile; try USA Trade Online or a bill-of-lading dataset |
| 3 | Does the FMC’s $15.4B D&D figure cover US trades only? | 02, 05 | Ask FMC or read the underlying data notes on the FMC D&D page |
| 4 | What share of unpaid detention is winnable with an evidence packet? (assumed 30%) | 02, 05 | Design-partner closed files; this is the business plan’s G1 milestone |
| 5 | What share of mid-market shipper spend is recoverable unsupported accessorials? (assumed 1%) | 02, 05 | Design-partner closed files |
| 6 | What share of D&D charges is recoverable through a dispute? (assumed 10%) | 02, 05 | Importer pilot; also try to open the FMC docket 22-04 comments that cite a 30% to 40% inaccuracy rate |
| 7 | What contingency rate do competitors charge, if any? (assumed 20%) | 02, 05 | Sales calls or buyer interviews; no competitor publishes one |
| 8 | Current billable detention per detained stop (assumed $100; newest public fee figure is ATRI’s 2019 average of $63.71 an hour) | 05 | ATRI’s 2024 full report (purchase or request), or carrier interviews |
| 9 | Stops per power unit per year (assumed 400) | 02, 05 | ATRI operational cost report, or ELD data from a design partner |
| 10 | Freight brokerage gross revenue and a 2025-2026 broker count | 02 (brokers) | FMCSA Licensing and Insurance data; TIA reports |
| 11 | Trax founding year | 01 | Trax press kit or LinkedIn |
| 12 | Hey Bubba founding year, HQ and funding | 01 | Company contact, Crunchbase |
| 13 | FleetOptos / Calcutiv LLC founding year and HQ | 01 | Company contact, state business registry |
| 14 | Pricing for every profiled competitor | 01, 03 | Not public for any of the nine; requires sales conversations or buyer interviews |
| 15 | An independent shipper survey on accessorial and FSC overcharge rates (partly answered 2026-10-17: RXO 2024 survey of 750 shippers and carriers covers workload and attitudes, not overcharge rates; CSCMP, Gartner, ARC, APQC and NASSTRAC sources not found) | 02, 04 | Logistics Management, CSCMP, or Gartner research; the Transplace study page was unreachable (see below) |
| 16 | Outside demand evidence for four-eyes approval, fuel-surcharge outlook and charge prioritisation | 04 | Buyer interviews |
| 17 | Average power units of the 57,712 general-freight carriers (we used the 5 to 100 band average of 16.74) | 05 | Re-run the FMCSA query with the general-freight filter and avg(power_units) |
| 18 | Size of the freight audit and payment market (repo figure ~$3.1B not reproduced; live estimates span $284.5M to $6.8B) | 05 | Do not use until a method-transparent source is found |
| 19 | Current transportation-cost-to-sales ratio for mid-size manufacturers, wholesalers and retailers (we use Establish 2008, 4.68%; a 2014 figure of 4.43% appears only in a slide deck we could not open) | 02, 05 | Establish Inc. current report; Tompkins Supply Chain Consortium |
| 20 | Overlap between the 19,932 mid-market shippers and the SME importers | 05 (SAM range $0.55B to $0.95B) | Match import records (bill-of-lading data) to firm size |
| 21 | Prices of Intelligent Audit Catalyst’s three plans | 01 | Sign up for the free trial or ask sales |
| 22 | Whether forwarders or customs brokers sell priced D&D recovery services | 01 | Calls to five to ten mid-size forwarders and brokers |
| 23 | Data2Logistics customer mix by size (CB Insights summary says large to small and medium-sized) | 01 | Open the CB Insights or PitchBook profile |
| 24 | Number of US importers bringing in 500 to 5,000 TEU a year (public bound 4,160 to 20,279; FMC-pool cap 12,833 used) | 02, 05, finance | Buy bill-of-lading data (PIERS, ImportGenius, Descartes Datamyne) and count consignees by annual TEU |

## Not re-verified this session

- project44, FourKites and TMS-embedded audit (Oracle, Blue Yonder, MercuryGate) as adjacent competitors or partners. Carried over from the repo’s market analysis.
- Cass Q1 2025 ($8.6B) and Q4 2025 ($9.2B) transportation dollar volumes came from search-indexed copies of the releases; the Q2 and Q3 figures were read from SEC EDGAR. Re-read Q1 and Q4 from EDGAR before use.
- Loop’s Series C was confirmed through AlphaMaven and Sacra, not through a Loop or Valor press release.
- Census SME manufacturer (39,214) and wholesaler (86,789) importer counts were read from chart labels in the release PDF, not from a data table.

## Names in the brief we could not verify or dropped

- "Fenix Parcel": no verifiable company found under that name. Parcel refund auditing is outside our wedge.
- Kpler: a commodity and maritime data company; no evidence it sells D&D invoice auditing. Dropped.
- Portcast: real and relevant, but kept in the adjacent list because pricing, customers and dispute volumes could not be confirmed.

## Unreachable URLs (attempted 2026-10-17)

| URL | Result | What we wanted |
|---|---|---|
| https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/2025-09/FMCSA%20Pocket%20Guide%202024-v6%20508%20.pdf | HTTP 403 (curl returned an HTML block page) | Carrier counts by fleet size; replaced by our own query of the FMCSA census file |
| https://ai.fmcsa.dot.gov/registrationstatistics | HTTP 403 | Registration statistics |
| https://www.cts.umn.edu/sites/cts.umn.edu/files/2025-04/dan_murray_atri_trucking_101_v3.pdf | HTTP 403 | ATRI fleet-size and industry figures |
| https://www.businesswire.com/news/home/20260122966914/en | HTTP 403 | Cass Q4 2025 results |
| https://www2.fmc.gov/readingroom/docs/22-04/22-04_Comments_USA_Rice.pdf/ | HTTP 403 | Primary shipper comment on D&D dispute burden |
| https://www.supplychain247.com/article/transplace_study_takes_deep_dive_into_various_accessorial_charges_for_shipp | HTTP 403 | Transplace accessorial study |
| https://loop.com/pricing | HTTP 404 | Loop pricing |
| https://www.portcast.io/pricing | HTTP 404 | Portcast pricing |
| https://bubba.ai/pricing | HTTP 404 | Hey Bubba pricing |
| https://api.census.gov/data/2022/cbp | redirect to "Missing Key" page | Establishment counts by size for manufacturing and wholesale |
| https://www.inboundlogistics.com/articles/allen-company-selects-nvision-global/ | no readable text returned by curl | Evidence of nVision mid-size customers |
| https://dhl.com/content/dam/dhl/local/us/dhl-global-forwarding/documents/pdf/us-dgf-fmc-dds-mitigation.pdf | file did not parse as PDF text | DHL D&D dispute service details |
| https://cassinfo.com/freight-audit-payment | reachable, but content is rendered by JavaScript; raw HTML had no figures | Cass scale figures; we used the SEC filings instead |

## Method tried and rejected

The BEA 2023 summary use table (https://apps.bea.gov/industry/iTables%20Static%20Files/AllTablesSUP.zip) was tested as a source for freight cost as a share of output. In its purchasers’-price framework, freight on purchased goods is folded into the goods rows, so truck transportation shows as 0.03% of manufacturing output. That reflects the accounting convention, not shippers’ freight bills, so we did not use it. The files are kept outside the repo, in the session scratchpad.

## Research-quality note

One page-summary result was discarded. A fetch of the Surface Transportation Board notice of 16 April 2019 (https://www.govinfo.gov/content/pkg/FR-2019-04-16/pdf/2019-07522.pdf) returned a quotation that does not appear in the document when we extracted its text. We removed it and checked every quotation in 02 and 04 against raw page text. Figures marked "(vendor page)" in 01 were read through a summarizing fetch and should be spot-checked against the live page before publication.
