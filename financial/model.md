# Freight Recovery - Financial Model

> **Status: pre-product. This is a planning scaffold, not a forecast.** There is no revenue, no customer, and no measured recovery rate. **Every input below is an ASSUMPTION** unless a source and grade are shown. The outputs are arithmetic consequences of those assumptions. "$1B" is shown only as a what-would-have-to-be-true calculation and is **not** promised or expected. No comparable-company valuations are asserted here.
>
> Grades: A primary/audited; B reputable secondary; C blog/vendor/aggregator.

## 1. Unit economics (per account, per year)

| Line | Base | Basis |
|---|---|---|
| Customer freight spend (shipper-side example) | $20M | ASSUMPTION (mid-market band) |
| Recoverable errors/unauthorized accessorials | 1.0% of spend = $200K | ASSUMPTION; audit-vendor claim is 1-3% (grade C), low end used |
| Contingency fee | 20% | ASSUMPTION; 15-30% typical per vendors (grade C) |
| **Revenue per account (ACV)** | **$40K** | = 200K x 20% |
| Gross margin | 60% Y1-2, rising to 70% Y5 | ASSUMPTION. AI products reported ~45-53% GM in 2025-26 (ICONIQ via SaaStr, grade A/B); human-in-loop review is the swing factor. Unmeasured for us. |
| Gross profit per account (at 65%) | ~$26K | |
| Blended CAC per account (Y3+) | $25K | ASSUMPTION; founder-led sales early is cheaper but unscalable |
| CAC payback | ~12 months on gross profit, plus ~3-4 months recovery-cycle lag, so ~15-16 months | Derived; public private-SaaS median is ~18-20 months (KeyBanc/Benchmarkit, grade B/C) |
| Logo churn | 20%/yr base (35% in bear) | ASSUMPTION; contingency can be switched off easily, or be sticky; unknown |
| LTV (GP / churn) | $26K / 0.20 = **$130K** (bear: $26K/0.35 = $74K) | Derived |
| LTV:CAC | **5.2x** base; 3.0x at 35% churn | Derived. Rule-of-thumb target is 3x+ (grade C). Treat 5.2x as optimistic: it rests on the 1% recovery assumption being real. |

**Sensitivity that matters most:** recoverable % of spend. At 0.5% instead of 1.0%, ACV halves to $20K and the whole model needs twice the accounts. First task of the venture is to measure this number on a partner's closed files.

**Revenue-quality caveat:** contingency revenue is variable and lagged. Investors generally pay less for it than for contracted subscription ARR. Section 4 shows the valuation both ways. The plan is to convert to hybrid platform-fee-plus-contingency as soon as customers accept it.

**Carrier-side accounts** (not modeled separately) will have lower ACV (smaller detention volumes) and lower CAC if sold through channels. Not enough information to model; leave for after discovery.

## 2. Five-year revenue build (three scenarios)

Method: revenue = average accounts during the year x ACV (Y1 x0.5 for pilot ramp). "Run-rate" = year-end accounts x ACV, the ARR-equivalent used in valuation math.

### Base case (ACV $40K)

| | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Year-end paying accounts (ASSUMPTION) | 5 | 25 | 80 | 180 | 330 |
| Revenue | $0.05M | $0.60M | $2.10M | $5.20M | $10.20M |
| Year-end run-rate | $0.20M | $1.00M | $3.20M | $7.20M | $13.20M |

### Bull case (ACV $55K: larger shippers plus carrier-network effects)

| | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Year-end accounts | 8 | 45 | 160 | 400 | 800 |
| Revenue | $0.11M | $1.46M | $5.64M | $15.40M | $33.00M |
| Year-end run-rate | $0.44M | $2.48M | $8.80M | $22.00M | $44.00M |

### Bear case (ACV $30K; slower sales; recoverable % lower)

| | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Year-end accounts | 2 | 8 | 20 | 40 | 65 |
| Revenue | $0.02M | $0.15M | $0.42M | $0.90M | $1.58M |
| Year-end run-rate | $0.06M | $0.24M | $0.60M | $1.20M | $1.95M |

Bear is a lifestyle-sized outcome and would not support venture funding beyond seed; it is also the case in which the venture should stop or pivot (see kill triggers in `business/business-plan.md`).

## 3. Capital needs

Two methods, shown side by side:

**(a) Bottom-up for the seed (ASSUMPTIONS):** 4-5 people (operator/CEO, 2 engineers, freight-ops/customer lead, part-time ops), fully loaded ~$150K average = ~$0.6-0.75M/yr, plus infrastructure, model usage, legal, travel ~$0.15-0.25M/yr. About $0.8-1.0M/yr, so ~$2.0-2.5M for 24-30 months. **Seed target: $2.0-3.0M**, sized to reach ~$3M run-rate (about 80 accounts, base Y3), which is where a Series A conversation becomes realistic. Note that the typical Series A bar of $2-4M ARR (grade C) is reached in base Y3, not Y2; plan the seed for 30 months or expect a bridge.

**(b) Top-down cross-check via burn multiple:** capital burned is roughly burn multiple x net new ARR. Burn multiple 1.5 is a "good-to-OK" level (grade C benchmarks).

| Scenario | Y5 run-rate | Capital at 1.5x | Comment |
|---|---|---|---|
| Base | $13.2M | ~$20M | Roughly seed ~$2.5M + Series A ~$10-14M (median software Series A $14.4M at $80M post-money, Carta via secondary, grade B) + a small B. Dilution ~18% at Series A per Carta (grade B). |
| Bull | $44M | ~$66M | Needs Series B and likely C. |
| Bear | $1.95M | ~$4M at 2.0x | Seed only; stops there. |

**No working capital** is assumed because the product does not touch the customer's money (we do not move funds). If a payments layer is added later, that changes materially.

Non-dilutive options to investigate (Norway-based operator): Innovation Norway and Research Council of Norway programs. Not researched in detail; see `fundraising/README.md`.

## 4. ARR-to-valuation math

Valuation = ARR x multiple. The user's planning range is **8-15x ARR**. Reference points (from earlier research, `scratchpad` notes, grade A/B/C as stated there): public cloud-software median ~4.1x EV/NTM revenue in Jan 2026 (Clouded Judgement, grade A); public >22% growers ~12.4x (A); a "planning" rule for strong AI apps of 8-15x and decent ones 5-8x was our own synthesis; the "10-50x" headline multiples are from hot companies and SEO blogs (grade C) and are **not** used.

### Year-5 run-rate valuation by scenario

| Scenario | Y5 run-rate | at 8x | at 15x | Haircut view: 4-6x (contingency treated as variable revenue) |
|---|---|---|---|---|
| Base | $13.2M | $106M | $198M | $53M-$79M |
| Bull | $44.0M | $352M | $660M | $176M-$264M |
| Bear | $1.95M | $16M | $29M | not meaningful; 8x+ is unrealistic at this scale or growth |

Important: 8-15x is only defensible for growth-stage companies with high growth, 70%+ gross margin, and strong net revenue retention. A base-case company growing ~80% in Y5 with a contingency model deserves the low end or below. Take the haircut column as at least as likely as the 8-15x column.

### What would $1B require? (what-would-have-to-be-true, not a forecast)

| Multiple | ARR needed | Accounts at $40K | Accounts at $55K |
|---|---|---|---|
| 8x | $125M | 3,125 | 2,273 |
| 15x | $66.7M | 1,667 | 1,212 |

Even the bull case ($44M run-rate in Y5) falls short of $1B at 15x ($660M). **The base case does not approach $1B.** A $1B outcome would require the contingency wedge to expand into a broader freight-spend platform (payments, TMS-adjacent, or network effects) with thousands of accounts. The honest planning stance: build a durable, profitable niche business that is also an attractive acquisition target; treat anything larger as upside.

### Founder-ownership reality check (ESTIMATE, grade B/C)

Carta-reported medians suggest founder ownership of ~56% after seed, ~36% after A, ~27% after B (grade C via aggregators). A $200M outcome with ~35% founder stake is ~$70M gross, before preferences and tax and split among founders. Meaningful, but not a $1B outcome.

## 5. Base / bull / bear summary

| | Base | Bull | Bear |
|---|---|---|---|
| Key assumption | 1.0% recovery, 20% fee, ACV $40K | larger accounts, ACV $55K, network effects | 0.75% or less recovery, ACV $30K, slow sales |
| Y5 year-end run-rate | $13.2M | $44.0M | $1.95M |
| Capital to get there | ~$20M | ~$66M | ~$4M |
| Value at 8-15x (before haircut) | $106M-$198M | $352M-$660M | $16M-$29M (unrealistic) |
| What it means | Strong niche business or acquisition candidate | Category leader; $1B still not reached | Stop or pivot after seed |

## 6. What this model does not know (and the first measurements)

1. Real recoverable % of spend / billed detention (measure on design-partner closed files).
2. Real win rate and cycle time of disputes.
3. Real cost per claim (inference plus human review) and thus gross margin.
4. Number of reachable accounts in the target segment.
5. Whether customers accept contingency, hybrid, or neither.

Until 1-3 are measured, this document should be shown only as a framework, labeled "assumptions, not forecast".
