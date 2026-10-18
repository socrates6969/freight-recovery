# CAC targets per channel for scoup.ai

> **Status: model, not measurement.** The product, scoup.ai, is pre-product with no customers, so no CAC has been observed. Each input is
> labeled **[sourced]** (third-party benchmark, source line given) or **[assumed]** (our planning assumption, to be
> replaced by test data). All arithmetic is ours and shown in full. Companion to `channel-plan.md`. Last edited 2026-10-17.

## Method

Customer acquisition cost per channel is the channel's cost per lead divided by the share of leads that become paying
accounts. We split that share into the four steps of the conversion ladder in `channel-plan.md`, because each step can
be measured separately as pilots run, and because the steps fail for different reasons (bad targeting, weak offer,
packet quality, pricing).

CAC here is **media CAC**: ad spend or event cost only. It excludes founder time, sales salaries, tooling and the free
leakage review we run for every prospect. Fully loaded CAC is higher, and `finance` owns that number.

## Funnel assumptions

| Step | Rate | Label | Reasoning |
|---|---|---|---|
| Lead to qualified conversation | 20% | [assumed] | Many form fills will be students, vendors or companies too small to qualify |
| Qualified conversation to leakage review | 35% | [assumed] | Sharing closed invoices under NDA is a real ask of a stranger |
| Leakage review to pilot | 50% | [assumed] | A prospect who shares files is engaged; the packet must still find money |
| Pilot to paying account | 60% | [assumed] | Contingency pricing lowers the risk of saying yes |
| **Lead to paying account** | **2.1%** | [assumed, product] | 0.20 × 0.35 × 0.50 × 0.60 = 0.021 |

So one paying account needs 1 / 0.021 = 47.6 leads under these assumptions.

**A sourced check against our own assumption.** Metadata's benchmark reports a LinkedIn cost per lead of $202 and a
LinkedIn cost per customer of $58,572 across its B2B sample. Dividing the two gives an observed lead-to-customer rate of
$202 / $58,572 = 0.345%, about one sixth of our 2.1%. Their sample is broad B2B software, sales cycles and deal sizes
differ from ours, and a contingency offer with a free review may convert better. But the gap is large enough that we
carry a pessimistic case built on the 0.345% figure everywhere below. The same report puts the cost of a small-company
customer at $31k and a mid-market customer at $103k across all channels.

Source: Metadata.io, What LinkedIn ads cost, https://metadata.io/resources/blog/what-linkedin-ads-cost, accessed 2026-10-17
Source: Metadata.io, 2026 B2B Paid Media Benchmark Report, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17

## CAC ceilings: what we can afford

**Shipper and importer accounts.** By owner decision, scoup.ai sells first to mid-market shippers and SME importers, so
these targets apply to those two segments. We align to the current financial model owned by `finance`
(`financial/model.xlsx`, Revenue tab, base case; `financial/unit-economics.md`), which replaced the investor brief's
earlier $40K / 60% / $25K figures. The model now carries revenue per account by segment **[assumed, model output]**:

| Segment (checks bought) | Y1 | Y2 | Y3 | Y5 | Y7 |
|---|---|---|---|---|---|
| SME importer (D&D + fuel surcharge) | $13.0K | $17.9K | $21.9K | $27.6K | $30.8K |
| Mid-market shipper (fuel surcharge + accessorial and detention audit; 0.77 of the importer amount) | $10.0K | $15.2K | $19.2K | $24.7K | $27.6K |
| Carrier (later partner channel) | $7.9K | $7.9K | $7.9K | $7.9K | $7.9K |

Company gross margin is a model output: 20.6% in Year 2, 60.3% in Year 3, 74.6% in Year 5. A 12-month payback on gross
profit allows fully loaded CAC up to revenue per account × gross margin. We reserve two thirds of that for founder and
sales time and the free leakage review, so the media CAC target is one third (our decision):

| Account | Fully loaded ceiling (revenue × margin) | Media CAC target (÷ 3) | Max CPL (× 0.021) | Max cost per qualified conversation (× 0.105) |
|---|---|---|---|---|
| Importer, Year 3 | $21,900 × 0.603 = $13,206 | $4,402 | $92 | $462 |
| Shipper, Year 3 | $19,160 × 0.603 = $11,555 | $3,852 | $81 | $404 |
| Importer, Year 2 | $17,900 × 0.206 = $3,687 | $1,229 | $26 | $129 |
| Shipper, Year 2 | $15,160 × 0.206 = $3,123 | $1,041 | $22 | $109 |
| Importer buying only the D&D check, Year 3 [assumed] | ($10.0K + $85K × 36/52 × 14%) × 0.603 = about $11,000 | $3,667 | $77 | $385 |
| Shipper buying only the fuel check, Year 3 [assumed] | ($10.0K + $85K × 0.31 × 14%) × 0.603 = about $8,200 | $2,733 | $57 | $287 |

The two single-check rows are `finance`'s estimates from the business-case example, not model outputs: a $10.0K Year-3
platform fee plus a share of the $85K Year-3 recovery at 14%, where D&D is $36K of the $52K example (0.69) and fuel
surcharge $16K of it (0.31). Shipper figures use the model's unrounded revenue ($19.16K in Year 3, $15.16K in Year 2), as checked by `finance`. The model's plan CAC (all sales and marketing divided by new accounts) is $13.4K in Year 2 and $15.0K in Year 3,
base CAC payback on directly sold accounts is 14.5 months in Year 3 and 11.0 in Year 5, and the lifetime value of a
directly sold account is $61.9K in Year 3 and $97.5K in Year 5 (`financial/unit-economics.md`).

`finance` also ran our sourced pessimistic case through the model: at a $31K CAC (Metadata's small-company customer cost),
LTV:CAC falls to 2.0x in Year 3, payback stretches to 30.1 months, and the plan needs a $9.98M seed and $18.67M of equity
in total, against a base seed need of $6.91M (including a 20% buffer) that the planned $7.0M raise covers
(`financial/scenarios.md`, `financial/use-of-funds.md`).

**Carriers (later phase).** Carriers are now a later, partner-led segment, and the model has no separate carrier
revenue. The one carrier figure in the package is `market-researcher`'s modeled fee of $7,895 a year for an average
16.7-truck carrier (`research/02-industries.md`; most inputs assumed). At a 60% margin and the same one-third rule, its
media CAC target would be $1,579 ($7,895 × 0.60 / 3) and its maximum cost per lead $33 ($1,579 × 0.021), about a sixth of
the $202 LinkedIn benchmark. That supports the owner's decision to reach carriers through partners rather than paid media.

## Modeled CAC per channel

Base case uses our 2.1% lead-to-account rate **[assumed]**. Pessimistic case uses the 0.345% rate implied by Metadata's
LinkedIn figures **[sourced, derived]** ($202 / $58,572 = 0.0034487). CPL inputs are cited in `channel-plan.md`.

| Channel | CPL input | Label | Base media CAC (CPL / 0.021) | Pessimistic media CAC (CPL / 0.0034487) | Media target Y3 (importer / shipper) | Verdict on paper |
|---|---|---|---|---|---|---|
| LinkedIn Ads, benchmark | $202 | [sourced] | $9,619 | $58,572 | $4,402 / $3,852 | About 2.2x the importer and 2.5x the shipper target; needs CPL of $92 / $81 |
| LinkedIn Ads, median advertiser | $376 | [sourced] | $17,905 | $109,025 | $4,402 / $3,852 | Over target |
| Google Search, B2B (Metadata) | $524 | [sourced] | $24,952 | $151,939 | $4,402 / $3,852 | Over target |
| Google Search, LocaliQ Business Services | $93.69 | [sourced] | $4,461 | $27,166 | $4,402 / $3,852 | Just above both targets even in the best case |
| Retargeting | $196 | [sourced] | $9,333 | $56,832 | $4,402 / $3,852 | About 2.1x importer and 2.4x shipper target |
| Manifest 2027 (attend) | $874 per qualified conversation | [assumed: 4 conversations for $3,495] | $8,321 | $50,671 | $4,402 / $3,852 | Over at 4 conversations; at 8 ($3,495 / 8 / 0.105 = $4,161) under the importer target, over the shipper target |
| Trade newsletter slot | ≤ $202 (kill threshold) | [assumed] | ≤ $9,619 | ≤ $58,572 | $4,402 / $3,852 | Unknown until rate card |
| Carrier tests (later phase) | not planned | n/a | n/a | n/a | carrier: $1,579 | Moved out of Years 1 and 2 |
| Founder outreach and partners | $0 media | [assumed] | $0 media; founder time unpriced | same | n/a | Cheapest on media, capped by founder hours |

Event arithmetic: $3,495 / 4 = $873.75 per qualified conversation; the remaining steps convert at 0.35 × 0.50 × 0.60 =
0.105, so $873.75 / 0.105 = $8,321. Pessimistic: conversation-to-account = 0.0034487 / 0.20 = 1.72%, so
$873.75 / 0.0172 = $50,671.

## Targets we will hold the tests to

At Year-3 economics the targets imply a maximum cost per lead of **$92 for importers and $81 for shippers**, and a
maximum cost per qualified conversation of **$462 and $404**. At Year-2 economics, with a 20.6% gross margin, they fall to
$26 and $22 per lead. No benchmark channel reaches that, so in Year 2 paid channels remain message tests, and accounts
come from outreach, events and referrals.

These are far tighter than the kill criteria in `channel-plan.md` ($376 per lead, $2,020 per qualified conversation),
on purpose. Kill criteria decide whether to stop a 6-week test. Targets decide whether a channel deserves budget after the
test. A channel can survive its test and still fail its target; it then stays at test-level spend until its conversion
steps improve.

The importer account carries the higher target because it buys two checks, D&D and fuel surcharge. A shipper that buys
only the fuel check has a media target of $2,733, about 71% of the full shipper figure ($3,852), so paid media should point
shippers at the accessorial check, which `marketing` already leads with.

## What would change these numbers

Three inputs dominate. Recovered dollars per account drive revenue per account in the financial model, so a smaller
recoverable share lowers the CAC we can afford in proportion. Gross margin, a model output that moves from 20.6% in Year 2
to 60.3% in Year 3, triples the affordable CAC between those years. Lead-to-account rate swings CAC sixfold between
our base and pessimistic cases, and only real leads can settle it. Check mix matters too: an account that buys one
check instead of two can afford about 71% (shipper, fuel only) to 83% (importer, D&D only) of its full-account target, because the platform
fee does not shrink with the number of checks. Each test in `channel-plan.md` measures the first funnel step within 6 weeks; the later steps need pilots, which is why we treat every CAC above as a
target to test, not an expected result.

## Open questions

- Revenue for single-check accounts: `finance` estimates from the business-case example only; not modeled.
- Carrier revenue for the later phase: `UNKNOWN — needs primary research`; `market-researcher` models $7,895 on mostly assumed inputs.
- Funnel step rates: all four [assumed]; first measurement comes from outreach and the paid tests.
- Fully loaded CAC including founder time and the free leakage review: owned by `finance`.
- Recovery-cycle lag between pilot start and first contingency revenue, which stretches payback: owned by `finance`.
