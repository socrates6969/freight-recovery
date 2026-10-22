# scoup.ai market analysis

> **Status, 22 October 2026: pre-revenue.** Market figures below are either footnoted public
> data or our own model, and say which. Competitor detail comes from
> `research/01-competitors.md` and `research/05-market-size.md` on the `docs/research` branch
> (17 October 2026); items rechecked on 22 October are footnoted here. Ledger:
> [`data-and-sources.md`](data-and-sources.md).

## 1. The big numbers, and why they are not our market

| Figure | Value | What it is | What it is not |
|---|---|---|---|
| US business logistics costs, 2025 | $2.40T, 7.8% of GDP[^cscmp] (2024 restated to $2.43T; the 2025 edition had $2.58T) | All US spend on moving and storing goods | A fee pool |
| Trucking share | 36.8%, about $883B[^cscmp] | Truck freight spend | Overbilled money |
| Truck detention cost, 2023 | $15.1B[^atri] | Cost of trucks waiting, mostly lost productivity | Recoverable dollars |
| Ocean D&D, nine carriers | about $15.4B, Apr 2020 to Mar 2025[^fmc] | Charges collected | Overcharges or refunds |

These describe the bills scoup.ai's customers receive. Most of that money is correctly billed.

## 2. Bottom-up size: accounts x revenue per account

![Market size](figures/market-size.png)

*Figure 1. Spend in the system (grey) versus the fees scoup.ai could earn (blue). Sources as
footnoted; SAM and TAM from the model.*

| Segment | US accounts | Revenue per account (Y7, model) | Annual fee pool | In plan |
|---|---|---|---|---|
| Mid-market shippers ($5-50M freight spend) | 19,932 | $27.6K | $550M | Years 1+ |
| Small and mid-size ocean importers | 12,833 | $30.8K | $395M | Years 1+ |
| **SAM** | **32,765** | | **$945M** | |
| Carriers with 5-100 trucks | 72,053 | $7.9K | $569M | Partner channel, year 3+ |
| Freight brokers | 28,438 | $12.0K (assumed) | $341M | Not modelled |
| **TAM** | **133,256** | | **$1.86B** | |

How the counts were made:[^counts]
- **Shippers.** Census counts 19,932 US manufacturers, wholesalers and retailers with
  $100M-$999.9M of receipts (2022). At an average 4.68% freight-to-sales ratio (a 2008 survey)
  that band spends roughly $5-50M on freight. At 2% the count is 9,366; at 10% it is 35,349.
- **Importers.** Census lists 234,023 small and mid-size importers (2024). We cap the count at
  12,833: the FMC D&D total ($3.08B a year) divided by a $240K annual D&D exposure per
  account. With the sourced US import volume (28.08M TEU in 2025)[^teu] that exposure is
  closer to $219K for a 2,000-TEU importer, which would raise the cap to about 14,000; we keep
  the lower figure.
- **Carriers.** FMCSA census file, active interstate for-hire carriers with 5-100 power units
  and a recent filing.

Overlap between shippers and importers is unknown, so the SAM lies between **$0.55B and
$0.95B**. The base case's 605 accounts in year 7 are about 1.8% of SAM accounts.

**Freight audit market estimates are unusable.** SkyQuest says $284.5M (2024), Astute Analytica
$727.1M (2023), Mordor Intelligence $0.97B (2025), Technavio gives only growth (+$651.2M,
2025-2030), and Market Intelo $6.8B (2025).[^fap] No method is shown. We do not cite a total.

**Error rates are vendor claims.** "1-9% of invoice value" and "3-25% of invoices" come from
companies that sell audits. We found no independent study, and the model does not use one.

## 3. Competitors

| Company | What it sells | Customers | Price (public?) | Gap scoup.ai aims at |
|---|---|---|---|---|
| Loop | AI freight audit and payment; $95M Series C, Apr 2026[^loop] | Enterprise shippers, 3PLs | Not public | Per-charge disputes for smaller shippers |
| Cass Information Systems | Freight audit and payment; FY2025 revenue $190.8M, $36.4B of freight processed[^cass] | Large shippers | Not public | Does not market disputes |
| Intelligent Audit | Multimodal audit; Catalyst for small parcel shippers | Enterprise; SMB parcel | Subscription by volume, modes, carriers; 90-day trial[^ia] | No truck-accessorial or D&D dispute product found |
| Trax | Global freight audit and spend management | Multinationals | Not public | Moving up-market and abroad |
| CTSI-Global, nVision Global | Services-led freight audit and payment | Large shippers | Not public | Analyst cost per small account |
| BlueCargo | Port and drayage D&D audit and disputes | Large shippers, drayage | Not public | Truck charges and mid-market importers |
| Hey Bubba, FleetOptos | ELD-based detention capture for carriers | Small fleets | Not public | Stop at the timestamp; no cited packet |
| Freehand | AI agents for enterprise supply-chain spend; $75M Series B, Jul 2026[^freehand] | Fortune 500 | Not public | Enterprise focus |

Only one adjacent firm publishes a price: parcel-refund auditor Refund Retriever charges 40-50%
of refunds won.[^rr] Freight audit firms do not publish prices.

## 4. Where agents create an advantage

The incumbents' constraint at small accounts is analyst time per disputed charge, not
software. Agents change that in four ways, each still to be measured:

1. **Coverage.** Check every invoice line, not a sample.
2. **Speed.** Flag a claim on arrival, well inside the 180-day truck window[^13710] and the
   30-day minimum D&D window.[^cfr]
3. **Cost per claim.** An agent drafts the packet; a person reviews it in minutes. Small
   claims become worth filing.
4. **A second check.** Money is computed by tested code and recomputed by the separate Reviewer
   agent; only confirmed findings reach the Claim draft and a person. Synthetic tests show the
   rules work as designed (0 of 45 clean invoices claimed; 90 of 90 injected overcharges
   flagged); real-world performance is unmeasured.

This is not a moat on its own. Any well-funded competitor can build agents. What may compound
is the record of which claims, with which evidence, got paid by which carriers; it exists only
after real volume.

## 5. Threats

- Loop or Intelligent Audit add a mid-market dispute product.
- BlueCargo extends from ports to inland truck charges.
- Forwarders and customs brokers, who already hold importers' documents, offer D&D recovery
  themselves. They are also the most natural channel partner.
- Customers bring the work in-house once they see the evidence format.

## 6. Likely acquirers (speculation)

Freight audit and payment firms (Cass, Loop, Trax), visibility and TMS vendors, large
forwarders. Adjacency logic only; no contact or intent.

---

[^cscmp]: CSCMP / Kearney, State of Logistics 2026, via SCDigest, https://www.scdigest.com/firstthoughts/26-06-26.php?cid=23144, published 2026-06-26, accessed 2026-10-22. $883B is our arithmetic.
[^atri]: ATRI, https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, published 2024-09-10, accessed 2026-10-19.
[^fmc]: Federal Maritime Commission, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-19.
[^counts]: research/05-market-size.md (docs/research branch, 2026-10-17), from U.S. Census SUSB 2022, https://www2.census.gov/programs-surveys/susb/tables/2022/us_naicssector_large_rcptsize_2022.xlsx; Census "A Profile of U.S. Importing and Exporting Companies, 2023-2024", https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf (2026-05-05); FMCSA Company Census File, https://data.transportation.gov/resource/az4n-8mr2.json; all accessed 2026-10-17.
[^teu]: Descartes Global Shipping Report, January 2026 release, https://www.descartes.com/resources/knowledge-center/descartes-releases-january-global-shipping-report-december-us-0, accessed 2026-10-22 via trade-press coverage (secondary).
[^fap]: Mordor Intelligence, https://www.mordorintelligence.com/industry-reports/freight-audit-and-payment-market; Astute Analytica (2024-03-19); GII/SkyQuest, https://www.giikorea.co.kr/report/sky1913174-freight-audit-payment-market-size-share-growth.html; Market Intelo, https://marketintelo.com/report/freight-audit-and-payment-market; Technavio, https://www.technavio.com/report/freight-audit-and-payment-market-industry-analysis; all accessed 2026-10-22; vendor claims.
[^loop]: Loop, https://www.loop.com/article/loop-raises-95m-series-c-to-scale-its-ai-platform-across-the-supply-chain, published 2026-04-17, accessed 2026-10-22.
[^cass]: Cass 8-K exhibit 99.1, https://www.sec.gov/Archives/edgar/data/708781/000070878126000002/cass-20251231xexx991.htm, published 2026-01-22, accessed 2026-10-22.
[^ia]: Intelligent Audit FAQ, https://www.intelligentaudit.com/faq, accessed 2026-10-22.
[^freehand]: Crunchbase News, https://news.crunchbase.com/transportation/freehand-pando-enterprise-supply-chain-spend-management-startup/, July 2026, accessed 2026-10-22 (secondary).
[^rr]: Refund Retriever, Pricing, https://www.refundretriever.com/pricing, accessed 2026-10-22.
[^13710]: 49 U.S.C. § 13710(a)(3)(B), https://www.law.cornell.edu/uscode/text/49/13710, accessed 2026-10-22.
[^cfr]: 46 CFR 541.8, https://www.ecfr.gov/current/title-46/chapter-IV/subchapter-B/part-541, checked 2026-10-19.