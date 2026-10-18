# Year-1 budget

Date: 2026-10-17. Status: draft for owner review. Model: `financial/model.xlsx`, tab OpEx, section "Year-1 budget by department and quarter". Base case, US dollars in thousands, quarters counted from the seed close.

Year 1 is a build-and-prove year. We start it with no customers, and the budget buys three things in this order: a product hardened enough for real customer data, a security programme that lets a shipper's IT team say yes, and design-partner recoveries that turn our assumed recovery rates into measured ones. We spend $1,025.2K in total, about $85K a month, and we plan to end the year with six people and six paying design-partner accounts: three mid-market shippers and three SME importers, in line with the shipper- and importer-first decision.

## Budget by department and quarter

| Department | Q1 | Q2 | Q3 | Q4 | Year 1 | Share |
|---|---|---|---|---|---|---|
| Engineering | 0.0 | 63.0 | 97.5 | 97.5 | 258.0 | 25.2% |
| Security | 30.0 | 64.5 | 64.5 | 64.5 | 223.4 | 21.8% |
| Sales | 15.0 | 15.0 | 15.0 | 15.0 | 60.0 | 5.9% |
| Marketing | 7.5 | 7.5 | 7.5 | 7.5 | 30.0 | 2.9% |
| G&A | 89.0 | 89.0 | 89.0 | 89.0 | 356.0 | 34.7% |
| Claims operations (cost of revenue) | 11.9 | 11.9 | 36.9 | 36.9 | 97.8 | 9.5% |
| **Total spend** | **153.5** | **250.9** | **310.4** | **310.4** | **1,025.2** | 100% |

Revenue in year 1 is $34.5K: an average of 1.5 shippers at $10.0K and 1.5 importers at $13.0K during the year. The operating loss before depreciation is $990.7K. After receivables, payables and $18K of laptops, free cash flow is -$976.7K, an average net burn of $81.4K a month. The model does not split revenue by quarter; quarterly burn equals quarterly spend less roughly $10K of revenue per quarter.

## Net burn by year (base case)

Average monthly net burn = MAX(0, -free cash flow) / 12, from `model.xlsx`, Cash Flow tab, row "Average monthly net burn". Bull and bear are in `scenarios.md`.

| | Y1 | Y2 | Y3 | Y4 | Y5 | Y6 | Y7 |
|---|---|---|---|---|---|---|---|
| Free cash flow ($K) | -976.7 | -1,575.6 | -2,073.6 | -2,263.3 | -1,279.9 | +538.8 | +3,254.5 |
| Average monthly net burn ($K) | 81.4 | 131.3 | 172.8 | 188.6 | 106.7 | 0 | 0 |

## What each line contains

**Engineering ($258.0K).** Two software engineers from Q2 at a loaded $126.0K a year each, and one ML / data engineer from Q3 at $137.8K. Norwegian pay is the Statistics Norway average for information and communication (NOK 969,240 a year) times a 1.22 employer loading, converted at 9.3817 NOK per USD. The ML premium is assumed. Q1 has no engineering payroll because the founder builds through the first quarter while hiring.

**Security ($223.4K).** A security engineer from Q2 ($137.8K loaded) and a $120K security programme spread evenly: the first external penetration test, SOC 2 readiness work, tooling and insurance. The earlier use-of-funds plan put an independent security audit first, and the internal pre-audit found real defects (a ReDoS vector, missing tenant isolation, input-validation gaps), so security is the first non-payroll line we fund.

**Sales ($60.0K).** Travel to US design partners and freight-industry meetings only. No sales hire until year 2; the founder sells.

**Marketing ($30.0K).** Programmes only: content, list data and one trade-show presence. No marketing hire until year 3. Digital-marketing channel costs, when they arrive, will be checked against this line.

**G&A ($356.0K).** Founder pay ($156.1K loaded; NOK 1.2M assumed, held below market until Series A), legal and regulatory ($150K: US entity, customer contracts, FMC and data-protection counsel) and office, software, admin and accounting ($50K).

**Claims operations ($97.8K, cost of revenue).** One US claims analyst from Q3 ($100K loaded: $70K wage / 0.70), hosting, data feeds and tooling ($45K) and variable cost (8% of revenue, $2.8K).

Source: Statistics Norway, Earnings, https://www.ssb.no/arbeid-og-lonn/lonn-og-arbeidskraftkostnader/statistikk/lonn, accessed 2026-10-17
Source: Norges Bank, Exchange rates USD/NOK monthly (Sep 2026 average 9.3817), https://data.norges-bank.no/api/data/EXR/M.USD.NOK.SP, accessed 2026-10-17
Source: US Bureau of Labor Statistics, Employer Costs for Employee Compensation June 2026 (benefits 30.0%), https://www.bls.gov/news.release/ecec.nr0.htm, accessed 2026-10-17

## Hiring plan, year 1

| Role | Start | Loaded cost per year | Year-1 cost |
|---|---|---|---|
| Founder / CEO | Q1 | $156.1K | $156.1K |
| Software engineer x 2 | Q2 | $126.0K each | $189.1K |
| Security engineer | Q2 | $137.8K | $103.4K |
| ML / data engineer | Q3 | $137.8K | $68.9K |
| Claims analyst (US) | Q3 | $100.0K | $50.0K |
| **Total, 6 people** | | | **$567.4K** |

People cost is 55% of year-1 spend. The remaining $457.8K is programmes and services.

## Controls

The budget is released in two parts. Tranche 1 of the seed ($4.0M) funds years 1 and 2 on its own and, without tranche 2, runs out around month 32 (cumulative free cash flow is -$2,552.3K at the end of year 2 and year 3 burns $2,073.6K, so 24 + 12 x ($4,000K - $2,552.3K) / $2,073.6K = 32.4). Tranche 2 ($3.0M) is released when five customers pay, recovery is measured on real invoices and ARR passes $0.5M. If that milestone slips, the plan holds headcount and spending at year-2 levels (the bear-case response in `scenarios.md`). Any change to these figures should be made on the Assumptions tab of `model.xlsx`; the budget table above is a formula output and recalculates.
