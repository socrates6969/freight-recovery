# Unit economics

Date: 2026-10-17 (revised for the owner decision on segments). Status: draft for owner review. Model: `financial/model.xlsx`, tab Unit Economics. All figures are plan outputs for a pre-product company with no customers. Nothing here is measured.

Our revenue is a share of the money we recover for a customer, plus a platform fee from year 2. The owner has set the go-to-market as shipper- and importer-first, so the unit economics below are for those **direct** accounts, won by our own sales team. Carriers come later through a channel partner and are shown separately, because their acquisition cost is a commission on revenue, not sales salaries. Read years 3 to 7: in years 1 and 2 company gross margin is negative or thin because the first claims analyst and the hosting bill arrive before revenue.

## Direct accounts (shippers and SME importers): definitions and base-case values

| Metric | Formula | Year 3 | Year 5 | Year 7 |
|---|---|---|---|---|
| Revenue per direct account | (shipper ARR + importer ARR) / their accounts | $20.5K | $26.1K | $29.2K |
| Gross margin (company) | (revenue - cost of revenue) / revenue | 60.3% | 74.6% | 78.6% |
| CAC | sales and marketing excluding partner commission / new direct accounts | $15.0K | $17.9K | $18.5K |
| Gross profit per account | revenue per account x gross margin | $12.4K | $19.5K | $23.0K |
| LTV | gross profit per account / annual churn (20%) | $61.9K | $97.5K | $114.8K |
| LTV : CAC | LTV / CAC | 4.1x | 5.4x | 6.2x |
| CAC payback | CAC / (gross profit per account / 12) | 14.5 months | 11.0 months | 9.7 months |
| Net revenue retention (all segments) | sum over segments of (start accounts - lost) x this year revenue per account / start ARR | 102.3% | 90.3% | 84.2% |
| S&M per $1 of new direct ARR | S&M excluding partner commission / (new direct accounts x revenue per direct account) | $0.73 | $0.69 | $0.63 |

### Worked arithmetic, year 3

- **Revenue per account by segment.** Importer: $10.0K platform fee + $85K recovered x 14% = $21.9K. Shipper: $10.0K + $85K x 0.77 x 14% = $19.2K (no ocean demurrage and detention). Blended over 52 shippers and 51 importers: ($996.5K + $1,116.9K) / 103 = $20.5K.
- **Gross margin.** Revenue $1,464.9K. Cost of revenue $581.7K = claims-operations staff $324.5K + hosting and data $140.0K + variable cost 8% x $1,464.9K = $117.2K. Margin = 60.3%.
- **CAC.** Sales department $852.4K less $11.8K partner commission = $840.5K, plus Marketing $281.1K = $1,121.6K, over 75 new direct accounts = $15.0K.
- **LTV and payback.** $20.5K x 60.3% = $12.4K a year; / 0.20 churn = $61.9K. Payback $15.0K / ($12.4K / 12) = 14.5 months of gross profit; cash payback is about two months longer because fees are collected 60 days after invoicing.
- **Net revenue retention.** 34 accounts at the start of year 3 (17 shippers, 17 importers), 3 of each lost. The remaining 14 shippers earn $19.2K and 14 importers $21.9K: $574.9K against start ARR of $562.1K = 102.3%. Retention falls below 100% from year 4 as 20% churn outweighs the growth in revenue per account; the Benchmarkit 2024 median is 101%.

Source: Benchmarkit, 2025 SaaS Performance Metrics (2024 data: New CAC Ratio median $2.00, GRR 88%, NRR 101%, gross margin 77%), https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-17

## Carriers (partner-led)

| Metric | Formula | Year 3 | Year 5 | Year 7 |
|---|---|---|---|---|
| Revenue per carrier | recovered $39.5K x 20% | $7.9K | $7.9K | $7.9K |
| Carrier CAC | partner commission (20% of carrier revenue) / new carrier accounts | $0.8K | $2.0K | $3.0K |
| Carrier LTV | revenue per carrier x gross margin / churn | $23.8K | $29.4K | $31.0K |

The carrier fee comes from market-researcher: $471.60 per truck x 16.7 trucks per carrier = $7,895 a year, on assumed inputs (400 stops per truck, $100 per detained stop, 30% winnable). Because the partner is paid a share of revenue rather than a fee per signed carrier, carrier CAC here is the year commission spread over new carriers, a rough measure.

## Direct accounts by scenario

| Metric (year 3 / year 5) | Bull | Base | Bear |
|---|---|---|---|
| Revenue per direct account | $23.6K / $30.1K | $20.5K / $26.1K | $16.4K / $20.9K |
| Gross margin | 73.2% / 81.1% | 60.3% / 74.6% | 36.7% / 52.1% |
| CAC | $11.6K / $15.3K | $15.0K / $17.9K | $17.2K / $26.6K |
| LTV | $115.2K / $162.6K | $61.9K / $97.5K | $20.1K / $36.3K |
| LTV : CAC | 10.0x / 10.6x | 4.1x / 5.4x | 1.2x / 1.4x |
| CAC payback (months) | 8.0 / 7.5 | 14.5 / 11.0 | 34.4 / 29.2 |
| Net revenue retention | 105.4% / 95.0% | 102.3% / 90.3% | 82.8% / 78.5% |

## The pessimistic case (sourced)

Digital-marketing benchmarked paid channels (`marketing/digital/cac-targets.md`). Its assumed funnel converts 2.1% of leads into accounts (47.6 leads per account). Metadata LinkedIn data implies 0.345% ($202 per lead against $58,572 per customer), about 290 leads per customer. The same report puts the paid-media cost of a small-company customer at $31K. The model carries $31K as the pessimistic CAC for direct accounts (input `pess_cac`).

| Base case at CAC $31K | Year 3 | Year 5 | Year 7 |
|---|---|---|---|
| LTV : CAC = LTV / $31K | $61.9K / $31K = 2.0x | $97.5K / $31K = 3.1x | $114.8K / $31K = 3.7x |
| CAC payback = $31K / (gross profit per account / 12) | 30.1 months | 19.1 months | 16.2 months |

Run through the whole model (marketing spend raised until direct CAC is $31K in every year), the base case needs a $9.98M seed and $18.67M of equity over seven years, its lowest year-end cash dips to -$0.06M with the planned rounds, and EBITDA turns positive only in year 7 (+$1.12M). In the bear case, LTV : CAC at $31K is 0.6x in year 3. At LinkedIn's $58.6K per customer (reported by digital-marketing, not re-verified by us) year-3 LTV : CAC would be 1.1x.

Source: Metadata.io, 2026 B2B Paid Media Benchmark Report (2025 data, 153 advertisers), https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17

## The benchmark test

The base plan spends $0.73 of sales and marketing per $1 of new direct ARR in year 3; the 2024 Benchmarkit median is $2.00. At the median, year-3 CAC would be $2.00 x $20.5K = $41.0K, LTV : CAC 1.5x and payback 40 months. Run through the whole model, the base case would need an $11.9M seed and $38.5M of equity and would not break even within seven years.

We keep the plan CAC of about $15K because founder-led selling, a free review of past invoices that shows recoverable dollars before any contract, and partner channels carry little or no media cost. None of this is proven, and paid media is not the acquisition engine of the plan; the year-1 paid budget is a test. The tranche-2 milestone requires acquisition cost to be measured on real deals before most of the seed is spent.

## What would change these numbers first

1. Measured recoveries per importer and per shipper from design partners (replaces `recov` and `shp_mult`).
2. Win rate and sales-cycle length from the first 20 founder-led deals (replaces the implied CAC).
3. Claims-analyst minutes per claim, which sets gross margin.
4. Twelve months of retention data, which replaces the 20% churn assumption.
5. The terms of a carrier channel partner (commission, volume).
