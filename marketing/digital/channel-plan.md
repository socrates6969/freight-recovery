# Paid and performance channel plan for scoup.ai

> **Status: plan only. The product, scoup.ai, is pre-product.** We have no live website, no ad account history, no
> traffic, no leads and no paying customers. Every cost figure below is a third-party benchmark with a source line, or a
> budget we propose, labeled as our decision. No figure in this file is a result we measured. Owner: `digital-marketing`
> agent, step 1 of the investor package. Last edited 2026-10-17.

## Who we sell to first

The owner has decided that scoup.ai sells first to **mid-market shippers** and **SME importers**. Carriers move to a later
phase, reached through partners rather than paid media. This plan targets the two first segments only:

- **Mid-market shippers** with roughly $5M to $50M of annual freight spend (an assumed band from the business plan; no
  public source counts them, per `research/02-industries.md`). Buyers: transportation and logistics managers, AP managers
  and controllers, and CFOs or VPs of finance, who receive carrier invoices with accessorials on top of the agreed rate. What
  scoup.ai checks for them: invoice lines against the rate confirmation, unsupported detention and accessorial charges,
  and fuel surcharge against the carrier's own surcharge table and the diesel index.
- **SME importers**, of which the US Census counts 234,023 (under 500 employees) among 240,535 identified importing
  companies in 2024; how many import by ocean container is `UNKNOWN — needs primary research`. Buyers: import and logistics
  managers, customs coordinators, and AP managers or controllers who receive ocean demurrage and detention (D&D) invoices. What scoup.ai checks for
  them: each D&D invoice against the FMC billing rule, which fixes required invoice content and sets 30-day windows to
  issue and to dispute (46 CFR part 541; a 2025 court decision vacated only the section on who may be billed).

Source: U.S. Census Bureau, A Profile of U.S. Importing and Exporting Companies, 2023-2024 (CB26-73), https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17
Source: Thompson Hine, Court Sets Aside Part of FMC's Demurrage and Detention Billing Rule, https://www.thompsonhine.com/insights/court-sets-aside-part-of-fmcs-demurrage-and-detention-billing-rule/, accessed 2026-10-17

The two segments overlap: many mid-market manufacturers and wholesalers both import by container and ship domestically
by truck. The financial model's revenue per account is built on exactly that importer-shipper profile (D&D plus fuel
surcharge, `financial/assumptions.md`), so an account that buys both checks is the target case, not an edge case.
Messaging, capability claims and the name rule follow `creative-concepts.md` and `marketing`'s positioning.

## Why paid channels come second

Our go-to-market starts with founder-led design-partner outreach, and `marketing`'s launch order puts no paid acquisition
ahead of a partner confirming leakage; paid tests stay locked until milestone G3 (`marketing/marketing-plan.md`). Paid
channels here are small, time-boxed message tests, not growth spend. Beyond that lock, four preconditions gate every test: at least one design partner has confirmed leakage on its own closed invoices; the landing
page and calculator are live; the conversion events below fire; and at least five design-partner conversations have given
us the words buyers use.

One conversion ladder applies to every channel so the numbers stay comparable:

1. **Lead**: a form submission with a work email (design-partner form, calculator, checklist or sample download).
2. **Qualified conversation**: a 20-minute call with someone who approves or disputes freight or D&D invoices.
3. **Leakage review**: the prospect shares closed invoices (20 to 50 loads, or a quarter of D&D invoices) under NDA.
4. **Pilot**: live checks on new invoices, human-approved.
5. **Paying account**: the pilot converts to a paid relationship.

The survival metric is cost per qualified conversation, the earliest step a 6-week test can observe.

## Channel 1: LinkedIn Ads (both segments; Year 1)

**Audience.** Two ad sets. Shipper set: job functions logistics, transportation, supply chain and accounts payable, with
titles such as transportation manager, logistics manager, AP manager, controller and CFO or VP of finance, at
manufacturers, distributors and retailers in a company-size band that approximates $5M to $50M of freight spend. Importer set: titles such as import
manager, logistics manager, customs compliance, AP manager and controller, at manufacturers and wholesalers under 500
employees. LinkedIn exposes neither freight spend nor import volume, so both proxies must be validated on the first leads.

**Why it fits.** LinkedIn is the one paid platform that targets these job functions directly. It is expensive, and its
value shows later in the funnel: Metadata reports $10.20 of pipeline per $1 of LinkedIn lead-gen spend, against $7.97
across all channels in its sample.

**Cost benchmarks.** CPC $9.39, CPM $63.19, CTR 0.67%, cost per lead $202 (2025 data, all-industry B2B, not freight). The
same publisher gives lead-form campaigns at $193 per lead against $346 for landing-page campaigns, document ads at $142
against $265 for video, and a LinkedIn cost per customer of $58,572. The report summary states that the median advertiser
paid $376 per lead (cheapest decile $109, most expensive $1,340). Metadata's pages give the sample as 153 advertisers in
one place and 138 in another; we treat the figures as directional. We found no published LinkedIn benchmark for freight,
logistics or importing.

Source: Metadata.io, What LinkedIn ads cost, https://metadata.io/resources/blog/what-linkedin-ads-cost, accessed 2026-10-17
Source: Metadata.io, 2026 B2B Paid Media Benchmark Report, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17
Source: Webtonic, Trucking and logistics LinkedIn Ads statistics, https://www.webtonic.io/blog/trucking-and-logistics-linkedin-ads-statistics, accessed 2026-10-17

**Test budget (our decision).** $4,500 over 6 weeks, about $107 per day, split 60/40 between the shipper and importer ad
sets ($2,700 and $1,800). Format: document ads (the synthetic accessorial packet, the synthetic D&D invoice check) with
LinkedIn lead forms, the two lowest-cost formats in the benchmark. Expected volume at $202: $4,500 / $202 = 22 leads (our
arithmetic), too few to estimate conversion rates. The test can kill a message; it cannot prove a channel.

**Kill criteria.** Stop an ad set if, after half its budget, cost per lead exceeds $376 (the benchmark median), or if its
first 10 leads yield no qualified conversation. Stop the channel if, at week 6, cost per qualified conversation exceeds
$2,020 (twice the $1,010 implied by $202 / 0.20 in `cac-targets.md`).

## Channel 2: Google Search (both segments, high intent only; Year 1)

**Audience.** People searching buyer-intent phrases. Shipper ad group: accessorial audit, freight invoice audit for
mid-size shippers, detention charge dispute, fuel surcharge audit. Importer ad group: demurrage and detention dispute,
D&D invoice audit, FMC demurrage invoice requirements, container detention charges dispute. Purely informational
queries stay with organic content (`marketing/seo/**`).

**Why it fits.** Search catches intent and tests headlines fast. The FMC rule gives importer searches a concrete hook (an
invoice missing required content, a 30-day dispute window). The weakness is volume; monthly searches for every phrase are
`UNKNOWN — needs primary research` (Keyword Planner once an Ads account exists).

**Cost benchmarks.** LocaliQ's 2026 search benchmarks: Business Services average CPC $5.87, conversion rate 4.85%, cost
per lead $93.69; Industrial and Commercial $5.87, 8.20%, $75.19; all industries $5.42, 8.18%, $66.69. These cover a broad,
mostly small-business advertiser base. Metadata's B2B sample, counting CRM-matched leads, puts Google Ads at $524 per
lead. We plan on the Metadata figure and treat LocaliQ as the optimistic bound.

Source: LocaliQ, 2026 Search Advertising Benchmarks, https://localiq.com/blog/search-advertising-benchmarks/, accessed 2026-10-17
Source: Metadata.io, 2026 B2B Paid Media Benchmark Report, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17
Attempted: WordStream, Google Ads benchmarks, https://www.wordstream.com/blog/ws/2025/04/02/google-ads-benchmarks, returned HTTP 403 on 2026-10-17; not used.

**Test budget (our decision).** $3,000 over 6 weeks, exact and phrase match, US only, split evenly between the two ad
groups, each landing on its solution page. At $5.87 per click the budget buys 511 clicks ($3,000 / $5.87, our arithmetic).
If search volume cannot absorb it, the unspent budget is the finding.

**Kill criteria.** Stop an ad group if cost per lead exceeds $524 after $750, if impressions stay under 500 in its first
two weeks, or if no lead becomes a qualified conversation by week 6.

## Channel 3: Industry events (Manifest in Year 1; TPM as the importer event)

**Audience and fit.** For a founder-led company a pre-booked meeting at an event is already a qualified conversation.

- **Manifest** (Las Vegas, February 8 to 10, 2027) targets shippers, logistics technology buyers, startups and investors:
  the best single fit for the shipper segment and for the seed raise. Partner registration is $1,995 until November 20,
  2026, then $2,195 (early), $2,495 (late) and $2,695 on site. Exhibitor prices are not public. A vendor listing for the
  2026 edition claimed 7,200+ attendees and 2,000+ shippers; we have not seen a 2027 figure.
- **TPM** (Journal of Commerce, S&P Global; Long Beach, February 28 to March 3, 2027) gathers the ocean container trade,
  from importers and exporters (beneficial cargo owners) to carriers, forwarders, ports and customs brokers, with "more
  than 2,300 attendees" per S&P Global. It is the importer segment's natural event. Registration fees are `UNKNOWN —
  needs primary research` (the TPM site returned HTTP 403 on 2026-10-17).
- **TIA Capital Ideas** (brokers and 3PLs) and **SMC3 JumpStart** (LTL-heavy) fit the later broker and carrier phases,
  not the first segments, and are not planned.

Source: Manifest, partner page and 2027 media kit, https://partner.manife.st/, accessed 2026-10-17
Source: Exotec, Manifest 2026 event listing, https://www.exotec.com/events/manifest-2026, accessed 2026-10-17
Source: Journal of Commerce, TPM about page (search-result excerpt; site returned 403), https://tpm.joc.com/en/about, accessed 2026-10-17
Source: S&P Global, TPM to celebrate 25th anniversary in 2025 (press release), https://press.spglobal.com/2024-12-16-TPM,-S-P-Globals-Premier-Shipping-and-Supply-Chain-Conference,-to-Celebrate-25th-Anniversary-in-2025, accessed 2026-10-17

**Budget (allocation by `marketing`).** Year 1: the Manifest pass, $1,995, from marketing programmes; travel (our assumed
$1,500) on the separate sales-travel line. TPM 2027 falls in the same month; attending both is a decision for
`marketing` once TPM's fee is known. Our recommendation: if the importer segment produces more design-partner
conversations than the shipper segment by January 2027, swap Manifest for TPM rather than add a second event.

**Kill criteria.** Pre-book meetings through the attendee app and outreach; judge the event on qualified conversations
held. At $3,495 all-in, Manifest must produce at least 4 ($874 each, our arithmetic: $3,495 / 4), or we skip the next
edition.

## Channel 4: Trade publications (Year 2)

**Audience and fit.** JOC reaches the ocean and import trade, the importer segment. DC Velocity reaches distribution and
warehouse operators, and FreightWaves reaches shipper logistics staff as well as brokers and carriers. Trade newsletters
carry editorial credibility, but they sell at flat rates that resist small tests.

**Cost benchmarks.** None of these publishers lists rates publicly. FreightWaves calls its options "starting points for
conversation" and reports 1.02M unique visitors and 2.36M pageviews a month (search-result excerpt). DC Velocity states it
reaches over 330,000 logistics professionals a month. Rates for JOC, DC Velocity and FreightWaves are `UNKNOWN — needs
primary research` (request rate cards from S&P Global, Agile Business Media and FreightWaves).

Source: FreightWaves, advertising page (search-result excerpt), https://freightwaves.com/?p=99359, accessed 2026-10-17
Source: Terrapinn, City Freight Show USA partner profile: DC Velocity, https://www.terrapinn.com/conference/city-freight-show-usa/partner-dc-velocity.stm, accessed 2026-10-17

**Test budget (our decision, Year 2).** A $3,000 cap for one newsletter placement: JOC first if the importer segment leads,
DC Velocity if the shipper segment leads. No sponsored articles until we have a measured story.

**Kill criteria.** Repeat a publication only if its cost per lead is at or below $202 and at least one lead becomes a
qualified conversation within 30 days.

## Channel 5: Retargeting (both segments; Year 2)

**Audience.** Visitors to the solution pages, the calculator or the sample packets who did not convert.

**Why it fits and cost.** Metadata reports retargeting at $196 per lead with $9.60 of pipeline per $1, the best ratio in
its sample. The binding constraint is audience size: LinkedIn needs at least 300 matched members before a segment serves,
which a new pre-product site may not reach in Year 1. Retargeting is not funded in the Year-1 programmes budget.

Source: Metadata.io, 2026 B2B Paid Media Benchmark Report, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17
Source: LinkedIn, Matched Audiences audience size requirements, https://www.linkedin.com/help/lms/answer/a423690, accessed 2026-10-17

**Test budget (our decision, Year 2).** $1,000, switched on only when a segment passes 300 matched members. **Kill:** stop
if retargeting cost per lead exceeds cold LinkedIn cost per lead in the same period.

## Later phase: carriers and partner channels (not budgeted)

Carriers are a later, partner-led segment by owner decision, so every carrier-specific test moves out of Years 1 and 2:
participation in carrier Facebook groups and forums, Overdrive and CCJ newsletter slots, and broker-focused events such
as TIA Capital Ideas. Meta ads for carriers are dropped entirely for now, per `marketing`. The research behind them stays valid for that
phase: 72,053 active interstate for-hire carriers run 5 to 100 power units (FMCSA census queried by `market-researcher`),
Metadata reports a Facebook CPM of $15.50 against LinkedIn's $63.19, and detention tools such as FleetOptos and GeoStamp
sell through the Geotab and Motive marketplaces, which require an integration scoup.ai does not have.

Partner channels for the first segments are also later: customs brokers and freight forwarders (for importers) and
carrier-factoring firms (for carriers). No partner exists today. Per `marketing`'s go-to-market rule, referral terms come
only after a pilot and no material implies a partnership before one is signed.

Source: FMCSA, Company Census File (dataset az4n-8mr2), https://data.transportation.gov/resource/az4n-8mr2.json, accessed 2026-10-17
Source: Metadata.io, What LinkedIn ads cost, https://metadata.io/resources/blog/what-linkedin-ads-cost, accessed 2026-10-17

## Summary and sequencing

Funding follows the split `finance` set and `marketing` allocated (`marketing/marketing-plan.md`, section 6): Year-1
marketing programmes total $30.0K, with sales travel budgeted separately at $60K.

| Channel | Segments | Benchmark CPL used | Test budget | Funding | Window | Primary kill trigger |
|---|---|---|---|---|---|---|
| LinkedIn Ads | Shipper 60%, importer 40% | $202 (median $376) | $4,500 | Year 1 | 6 weeks | CPL > $376 at half budget |
| Google Search | Shipper and importer ad groups | $524 (LocaliQ $93.69 best case) | $3,000 | Year 1 | 6 weeks | CPL > $524 after $750 per group |
| Manifest 2027 (attend) | Shipper, investors | n/a | $1,995 pass + $1,500 travel (sales line) | Year 1 | one event | < 4 qualified conversations |
| Trade newsletter (JOC or DC Velocity) | Leading segment | none public | $3,000 cap | Year 2 | one send | CPL > $202 |
| Retargeting | Both | $196 | $1,000 | Year 2 | when audience ≥ 300 | CPL above cold LinkedIn |
| Carrier tests (communities, Overdrive/CCJ; Meta dropped) | Carriers | n/a | none | Later phase | n/a | n/a |

Year 1, charged to programmes: $4,500 + $3,000 + $1,995 = $9,495, 32% of the $30.0K. Year 2: $3,000 + $1,000 = $4,000,
down from $5,500 because the $1,500 carrier Meta test moved to the later phase. TPM 2027 would add an unknown fee if
`marketing` chooses it over or alongside Manifest.

Order of operations: (1) outreach and the first five design-partner conversations, in both segments; (2) site, calculator
and conversion events live; (3) LinkedIn and Google tests in parallel, two segments each, so we learn which segment
responds to paid messages; (4) Manifest (or TPM) in February 2027; (5) in Year 2, one trade placement in the leading
segment and retargeting once audiences qualify.

## Measurement

Every ad carries UTM tags that include the segment; every form asks the respondent's role and whether they import by
container, ship domestically by truck, or both. Qualified conversations are logged in the CRM sheet with source and
segment and uploaded back to LinkedIn and Google as offline conversions. Privacy rules follow
`marketing/seo-and-growth.md`: EU/EEA consent for every tag, no pre-ticked boxes, and the LinkedIn Insight Tag loads only
after consent.

## Open questions

- Keyword volumes for the shipper and importer phrases: `UNKNOWN — needs primary research`.
- Number of SME importers that import by ocean container: `UNKNOWN — needs primary research`.
- Count of mid-market shippers by freight spend: `UNKNOWN — needs primary research` (no public dataset).
- TPM 2027 registration fee and whether `marketing` swaps or adds it: `UNKNOWN — needs primary research`.
- Rate cards for JOC, DC Velocity and FreightWaves: `UNKNOWN — needs primary research`.
- A freight- or import-specific paid-media benchmark: none found; our tests will be the first data.
