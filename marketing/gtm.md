# scoup.ai go-to-market (pre-product)

> **Status.** Pre-product: synthetic data only, never deployed, no customers, no revenue. Everything
> below is a plan. Sales cycles, conversion rates and price acceptance are hypotheses to be measured in
> the design-partner programme, and each is labelled. Segment counts come from
> `research/02-industries.md` (owner: `market-researcher`); only counts that drive a GTM decision are
> repeated here, with their source lines. Positioning and messaging: `marketing-plan.md` sections 2-3.
> Name: always lowercase **scoup.ai** (`brand/README.md`).
>
> **Owner decision, 2026-10-17: shipper- and importer-first.** Mid-market shippers and small and
> mid-size ocean importers are the primary segments. Carriers move to a later phase, reached through
> factoring and broker partners. This reverses the business plan's carrier-first working hypothesis
> (`business-plan.md` section 2), and this file is rewritten accordingly.

## 1. Principles

Three rules shape every segment. First, we sell a free review of past invoices before we sell anything
else, because a vendor with no customers earns trust only by doing work on the buyer's own files.
Second, pricing is contingency on dollars actually recovered or avoided, so the buyer's downside is the
time it takes to share closed invoices (`business-plan.md` section 4). Third, the founder sells until
roughly the first 20 accounts (`business-plan.md` section 5); no sales hire before CAC is measured.

Why shipper- and importer-first suits that model: the buyer holds the invoices and pays them, so a
review needs no counterparty's cooperation, and the money found is the buyer's own spend. The cost of
the choice is competition. Unlike the carrier side, where no freight audit and payment firm sells
(`research/01-competitors.md`), the shipper side is contested by Loop and Intelligent Audit, and ocean
detention and demurrage (D&D) by BlueCargo. Section 3 sets out how we compete there.

## 2. Segments

### Segment A: mid-market shippers (primary)

- **Profile.** US manufacturers and distributors with $5M-$50M annual freight spend (ASSUMPTION band
  from `business-plan.md`), mostly truckload and LTL, paying carrier and broker invoices through AP
  either without a freight audit programme or with an audit vendor that does not argue disputed
  accessorial lines.
- **Size.** 19,932 firms (manufacturing 5,971; wholesale 8,798; retail 5,163), average freight spend
  about $9.53M. This is a modelled count: `market-researcher` converted the $5-50M freight-spend band to
  a $100M-$1B revenue band at an assumed 4.68% freight-to-sales ratio and counted Census SUSB 2022 firms
  in those classes. At 2% the count is 9,366; at 10% it is 35,349 (`research/02-industries.md`,
  `research/05-market-size.md`). There is no independent shipper survey on accessorial disputes.
  Source: U.S. Census Bureau, Statistics of U.S. Businesses 2022, https://www2.census.gov/programs-surveys/susb/tables/2022/us_naicssector_large_rcptsize_2022.xlsx, accessed 2026-10-17
- **Buyer titles.** Director or manager of transportation/logistics (champion); AP manager or
  controller (daily user and approver); CFO or VP finance (economic buyer).
- **Trigger events.** A freight-cost overrun flagged at month-end close; a year-end audit questioning
  accessorial spend; a carrier or broker contract renegotiation; dropping or switching a freight audit
  vendor; a new controller asking why accessorials are paid without support.
- **Channel.** Founder LinkedIn aimed at logistics and finance titles; warm introductions through
  accountants, fractional CFOs and supply-chain associations; search content on accessorial disputes
  (owner: `seo`); later, introductions from carrier partners on shared lanes.
- **Sales motion.** Free review of three months of paid carrier invoices against the rate
  confirmations that authorized them; confirmed findings separated from items needing review; then a
  contingency pilot on new invoices. Expect a second approver (finance) and a security questionnaire
  before any live data.
- **Price point.** Pilot: 25% of dollars recovered or short-paid with support, no platform fee. From
  model year 2: hybrid, an annual platform fee of $6K per account rising to $17K by year 7, plus a
  contingency share falling from 17% to 12%. All ASSUMED in the financial model (`financial/assumptions.md`,
  inputs `share` and `fee`), which governs every price in this package. No freight competitor publishes
  a contingency rate (`research/01-competitors.md`), so there is no market check yet.
- **Sales cycle (hypothesis).** 8-16 weeks from first call to signed pilot: two to four weeks for NDA
  and security questions, three to six for the invoice review, two to four for pilot terms with finance.
  Our estimate, not a benchmark.

### Segment B: small and mid-size ocean importers (primary, paired with A)

- **Profile.** US manufacturers and wholesalers with fewer than 500 employees that import in ocean
  containers and receive container detention and demurrage invoices from ocean carriers and terminals.
  Many also ship domestically, so they belong to Segment A as well; that overlap is the point.
- **Size.** 234,023 SME importers in 2024 across all modes (Census); the number importing by ocean
  container is UNKNOWN — needs primary research. `market-researcher` estimates that the FMC D&D pool
supports only about 12,833 importers at the business case's exposure per account
(`research/05-market-size.md` section 5), which is the more useful planning number.
  Source: U.S. Census Bureau, "A Profile of U.S. Importing and Exporting Companies, 2023-2024", release CB26-73, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17
- **Buyer titles.** Import or logistics manager (champion); AP manager or controller (user); owner or
  CFO (economic buyer at the smaller end).
- **Trigger events.** A D&D invoice spike after port congestion; an invoice arriving late or missing
  required fields; a 30-day dispute window about to close; a forwarder passing D&D charges through
  without detail.
- **Why the trigger is real.** Under the FMC billing rule, "Failure of the billing party to abide by the
  invoice content and timing requirements relieves the billed party's obligation to pay", and the billed
  party "has 30 calendar days from the date of issuance to request mitigation, refund, or waiver". After
  the D.C. Circuit's September 2025 ruling, only 46 C.F.R. 541.4 was vacated; the rest remains in force.
  Source: Thompson Hine, "FMC Issues Final Rule on Billing Requirements and Practices for Detention and Demurrage Invoices", https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17
  Source: Thompson Hine, "Court sets aside part of FMC's demurrage and detention billing rule", 26 September 2025, https://www.thompsonhine.com/insights/court-sets-aside-part-of-fmcs-demurrage-and-detention-billing-rule/, accessed 2026-10-17
- **Channel.** Customs brokers and freight forwarders as referral partners. They hold the importer
  relationship and the documents, and `market-researcher` found none selling priced D&D recovery. They
  are also a substitute, and when a forwarder acts as an NVOCC it is itself the billing party, so a
  referral from it is unlikely for its own invoices (`research/01-competitors.md`). We approach customs
  brokers first and forwarders only for charges billed by ocean carriers and terminals; importer associations and trade events; search content on the FMC rule and the
  30-day window; founder LinkedIn.
- **Sales motion.** Free check of the last 90 days of D&D invoices against the rule's content and
  timing requirements, with a dispute deadline list; then a contingency pilot. Nothing is disputed
  without the importer's approval.
- **Price point.** Same path as Segment A: 25% of charges waived or refunded in the pilot, then the
  hybrid platform fee plus 17% falling to 12% (ASSUMED, `financial/assumptions.md`).
- **Sales cycle (hypothesis).** 4-10 weeks: the 30-day window creates urgency, but the smallest
  importers rely on their forwarder and may need its cooperation. Our estimate.
- **Economics caution.** `research/02-industries.md` estimates the SME D&D slice alone at a $0.93M a
  year ceiling by year 5 on assumed inputs, and concludes D&D is "a feature that deepens an importer
  account, not a standalone business". We sell it as the importer's way in, alongside domestic
  accessorial review, not as a separate product line.

### Segment C (later phase): carriers, through factoring and broker partners

- **Profile.** US for-hire truckload carriers with 5-100 power units: 72,053 active interstate carriers
  filed an MCS-150 update since 17 October 2024 (FMCSA census, queried by `market-researcher`).
  Source: FMCSA, Company Census File (dataset az4n-8mr2), https://data.transportation.gov/resource/az4n-8mr2.json, accessed 2026-10-17
- **Why later, and why through partners.** The owner chose to sell first to the party that pays. Carriers
  remain valuable: the same engine builds their detention packets, and no freight audit and payment
  firm serves them. But a founder selling one carrier at a time cannot reach 72,053 accounts. Factoring
  firms, which buy carriers' invoices and absorb unpaid accessorials, and brokers, two-thirds of whom
  "paid detention only when they could collect the fee from the shipper or consignee" (DAT, 2016), can
  each bring many carriers at once.
  Source: DAT Solutions, 14 July 2016, https://www.dat.com/company/news-events/news-releases/63-percent-of-drivers-are-detained-for-more-than-3-hours-per-stop-dat-solutions, accessed 2026-10-17
- **Partner titles.** Factoring: head of operations or carrier relations; collections manager.
  Brokers: VP operations; carrier-relations or accessorials team lead. 28,438 active brokerage
  authorities in January 2024 (`research/02-industries.md`).
  Source: FreightCaviar, "Brush Pass Research: 7.8% fewer brokerages than a year ago", 24 January 2024, https://freightcaviar.com/brush-pass-research-7-8-fewer-brokerages-than-a-year-ago, accessed 2026-10-17
- **Motion.** After shipper pilots exist, offer partners a co-offer: their carriers get packets a
  broker can forward to the shipper unchanged. Referral share or platform fee agreed only after a
  partner pilot; no exclusivity before G3.
- **Price point.** Carriers: 20% contingency, no platform fee (ASSUMED, `financial/assumptions.md`,
  input `car_share`). Partner terms: UNKNOWN — needs primary
  research in partner conversations.
- **Timing.** Partner conversations may start in phase 3 to learn; signed partnerships target phase 4
  or later.
- **Caution.** DAT's 2016 survey found only 20% of responding brokers ranked detention a top-five
  problem, against 84% of carriers. Brokers may feel this less than the carriers they pay.

## 3. Winning in a contested segment

The shipper side is where funded competitors already sell. We do not try to out-feature them. We win
deals where four conditions hold, and we walk away where they do not: the buyer wants no platform fee
until money is found; the buyer cannot or will not integrate a TMS or ERP feed; the pain is disputed
truckload or LTL accessorials and D&D lines rather than parcel or payment processing; and the buyer
wants to see, per line, why a charge is wrong before short-paying it.

| Competitor | Their offer to our segment (sourced) | Where they win | Where we win | Our talk track |
|---|---|---|---|---|
| **Loop** | AI freight audit and payments; "99% of freight and parcel audits" automated; $160M raised; model described by Sacra as "platform fees with usage- or volume-based components" (analyst inference); merged with Data2Logistics (founded 1964, Fort Myers, FL; mid-market book) on 18 August 2025 and acquired StrategIQ; says implementation takes "as fast as 31 days" (`research/01-competitors.md`) | Buyers who want audit, payment and visibility in one platform; buyers with data feeds ready to connect | No platform fee before money is found; no integration for the pilot (we work from the invoices and rate confirmations the buyer already has); a per-line evidence packet for each disputed charge | "Keep your audit and pay process. Send us the lines you are unsure about, and we will show you, line by line, which ones the rate confirmation does not support." |
| **Intelligent Audit Catalyst** | For companies shipping under $10M a year, "a free trial for 90 days" then "one of our three Catalyst plans" (prices not published); launched June 2025; the Catalyst page says "Simple. Quick. Affordable." and lists "Automated parcel audit with direct carrier integrations" first, with nothing on truckload accessorials or D&D; main offer priced as "a subscription model based on annual shipment volume, modes, and # of carriers" | Parcel-heavy shippers; buyers who want breadth (claims, sourcing, visibility); a known brand | Truckload and LTL accessorial and detention disputes; a contingency pilot instead of a subscription trial; shippers above the $10M Catalyst line who find an enterprise programme too heavy | "If parcel is your main spend, Catalyst may suit you better. If your problem is truckload accessorials and detention you cannot verify, that is all we do." |
| **BlueCargo** (ocean D&D) | Invoice checks "against OSRA invoice requirements", "Dispute resolution with evidence-backed documentation"; claims "1 in 5 Top US Shippers"; named customers include GE Appliances and Samsung; "95% Dispute Success" (vendor claim, grade C) | Large importers at major ports; terminal and rail data connections | SME importers below its customer profile; one workflow covering container D&D and the truck detention and accessorials on the same shipments (whether importers want them combined is untested) | "Check every D&D invoice against the FMC rule before the 30-day window closes, and handle the trucking side of the same shipments in the same packet." |

Two adjacent players matter on the importer side. Portcast offers a D&D invoice module and a free
carrier-by-carrier D&D rate tool, a likely lead magnet for the same SME importers; our importer
calculator (`brand/calculator-variants.md`) answers a different question, what is at stake and what
would pass the 30-day window. Forwarders and customs brokers run dispute intake but sell no priced D&D
recovery that `market-researcher` found; they are both a channel and a substitute (Segment B).

Sources: `research/01-competitors.md` and `research/04-gaps.md`, which carry the full source lines,
including:
- Source: Intelligent Audit, FAQ, https://www.intelligentaudit.com/faq, accessed 2026-10-17
- Source: Sacra, Loop company profile, https://sacra.com/c/loop, accessed 2026-10-17
- Source: BlueCargo, home page, https://www.bluecargo.io/home-tests, accessed 2026-10-17
- Source: FreightWaves, "Loop and Data2Logistics merge to unlock profit in the supply chain", https://www.freightwaves.com/news/loop-and-data2logistics-merge-to-unlock-profit-in-the-supply-chain, accessed 2026-10-17
- Source: Portcast, home page, https://www.portcast.io/, accessed 2026-10-17

Rules for using this table: competitor facts are re-checked on the vendor's own page the week they
are used with a prospect; we never claim a competitor's performance beyond what it publishes; we say
where they are stronger before we say where we differ; and we never imply a competitor's customers
are unhappy. The "coexist" message matters most: a shipper with an audit vendor already can add us for
disputed lines only, so our first deal does not require displacing anyone.

## 4. The first 100 customers, by profile

No company is named as a target. Naming real shippers or importers before they agree to talk would be
a list of strangers, and the package's synthetic-data rule rules out picking them from real shipment
records. In the business plan's base case the company ends Year 3 with 80 paying accounts and Year 4
with 180 (`investor-brief.md` section 9.2, illustrative), so account 100 falls early in Year 4 of that
model.

| Cohort | Accounts | Mix (our planning split) | Typical profile | How they arrive | Who sells |
|---|---|---|---|---|---|
| 1. Design partners turned pilots | 1-5 | 3 shippers, 2 importers | Shippers with $10-30M freight spend whose AP team has disputed accessorials before; importers receiving D&D invoices at least monthly, ideally also shipping domestically by truck | Warm introductions through accountants, fractional CFOs, forwarders and personal network | Founder |
| 2. Founder-led early accounts | 6-20 | 9 shippers, 6 importers | Same profiles, widening to $5-10M shippers whose controller handles freight invoices directly | Referrals from cohort 1, customs-broker and forwarder introductions, founder LinkedIn, association events | Founder, plus the first customer-success hire when review volume demands it |
| 3. Repeatable accounts | 21-100 | 43 shippers, 22 importers, 15 carriers | Shippers and importers reached through search content and referral partners; carriers brought in batches by one factoring or broker partner | Content, referral partners, small paid tests after G3, the later carrier partner channel | First dedicated sales hire (planned 9-18 months post-seed, `investor-brief.md` section 8.3) plus founder |

Arithmetic: shippers 3 + 9 + 43 = 55; importers 2 + 6 + 22 = 30; carriers 0 + 0 + 15 = 15; total 100.
An importer that also ships domestically counts once, under the pain that brought it in. The split is
our planning choice following the owner's decision; it is not a forecast.

Common traits across the shipper and importer accounts, used as the qualification test in section 6:
they pay carrier, broker or ocean-carrier invoices themselves; they can export three months of paid
invoices with the rate confirmations or contracts behind them; a named person will approve every
short-pay or dispute; and they accept contingency pricing.

## 5. Design-partner recruitment plan

**Goal.** 3-5 design partners, at least two shippers and at least one importer, each sharing three
months of paid invoices (or 20-50 closed loads) read-only under an NDA agreed first.

**What partners get.** A review of their own invoices: each accessorial, detention and D&D line checked
against what authorized it, confirmed findings separated from items needing review, the arithmetic
shown, and for importers a list of FMC-rule issues and open dispute deadlines. Nothing to buy. What we
get: corrections to our rules, the measured recoverable share for gate G1, and permission (if granted)
to use anonymised results later.

**Preconditions before the first outreach message.**
1. The scoup.ai domain registered and a real contact address on the site (brand Gaps 8 and 10).
2. NDA, data-handling, retention and deletion terms drafted by counsel (legal sits in G&A, `finance`).
3. A synthetic sample packet for a shipper accessorial review and one for a D&D invoice check.
4. A recorded decision with counsel on how partner files are handled before the security status
   page's "Not yet" items close.

**Sourcing, in priority order.**
1. Personal and second-degree network: anyone running transportation, AP or imports at a manufacturer
   or distributor.
2. Accountants and fractional CFOs who serve mid-market manufacturers; one introduction each to a
   client with visible freight cost.
3. Two or three customs brokers or forwarders, asked to introduce importers who complain about D&D.
4. Founder LinkedIn posts walking through a synthetic accessorial check and a synthetic D&D invoice
   check against the FMC rule.
5. Individually researched outreach to companies matching the cohort 1 profile, through their
   published business contact. No purchased lists, no automated sequences.

**Outreach sequence (per account).** Message 1 names the likely situation (accessorials paid without
support, or D&D invoices close to the dispute window), asks for a 20-minute call, states the
pre-product status in the first two lines, and asks them not to send documents yet. One follow-up after
a week with the matching synthetic sample. Then stop. Opt-outs recorded (CAN-SPAM; GDPR/ePrivacy for
EU/EEA contacts, since the operator is in Norway).

**The first call (agenda).** How invoices are approved today; how many carrier, broker and D&D invoices a
month; where the rate confirmations and contracts live; what happened to the last disputed line;
whether an audit vendor is already in place (if so, the coexist offer); whether they would share three
months under an NDA. The sample packet comes last.

**Timeline (hypothesis, from the start of phase 1).**

| Weeks | Milestone |
|---|---|
| 1-2 | Preconditions done; target list of 60 profile-matched shippers and importers |
| 3-7 | Outreach; 15 first calls held |
| 6-10 | NDAs and security questions cleared with 3-5 partners; invoices received |
| 9-14 | Reviews delivered; partner feedback logged; G1 decision |
| 14-18 | Pilot terms offered where findings are material |

The timeline is two weeks longer than a carrier-first plan would need, because shippers bring a finance
approver and a security questionnaire. The 60 / 15 / 3-5 figures are the pre-registered targets in
`marketing-plan.md` section 7.

**Stop rule.** If 60 personalised contacts produce fewer than two NDAs, we stop and revisit the offer
and the segment before contacting more accounts.

## 6. Qualification test

A shipper or importer qualifies for a design partnership or pilot only if all five hold. The list
follows the business plan's qualification (`investor-brief.md` section 6.3), adapted to the payer side.

1. Pays carrier, broker or ocean-carrier invoices itself, with rate confirmations, contracts or tariffs
   in writing.
2. Willing to share three months of paid invoices (or 20-50 closed loads) read-only under an NDA.
3. Plausibly material leakage: accessorials or detention paid without checking the authorizing
   document, or D&D invoices paid without checking the FMC rule's requirements.
4. A named person who approves every short-pay or dispute.
5. Accepts that the product is pre-product, the review runs on our prototype, and nothing is sent on
   its behalf.

## 7. Segment summary

| | A. Mid-market shippers (primary) | B. SME ocean importers (primary) | C. Carriers via partners (later) |
|---|---|---|---|
| Size | 19,932 (modelled; 9,366-35,349 by freight-to-sales ratio) | 234,023 SME importers, all modes; ~12,833 supported by the FMC D&D pool | 72,053 carriers with 5-100 trucks; 28,438 brokerages |
| Economic buyer | CFO / VP finance | Owner or CFO | Factoring or broker head of operations (partner) |
| Champion / user | Transportation manager; AP manager | Import/logistics manager; AP | Collections or carrier-relations lead |
| Trigger | Freight overrun at close; audit questions; vendor change | D&D spike; non-compliant invoice; 30-day window | Rising accessorial disputes on purchased or brokered loads |
| Channel | LinkedIn, accountants and fractional CFOs, associations, search | Customs brokers and forwarders, importer events, search | Partner introductions, after shipper pilots exist |
| Motion | Free 3-month invoice review, contingency pilot, then hybrid | Free 90-day D&D check, contingency pilot | Co-offer after a partner pilot |
| Price (ASSUMED, financial model) | 25% pilot; from year 2, $6K-17K annual platform fee + 17% falling to 12% | Same as A | 20% for carriers, no platform fee; partner terms UNKNOWN |
| Sales cycle (hypothesis) | 8-16 weeks to pilot | 4-10 weeks to pilot | 3-6 months to partner agreement |
| Main competitors | Loop; Intelligent Audit (incl. Catalyst) | BlueCargo; Intelligent Audit D&D validation | Hey Bubba, FleetOptos, TMS detention modules |

Price source: `fr-wt/finance/financial/assumptions.md` (inputs `share`, `fee`, `car_share`), which
supersedes the earlier `business-plan.md` section 4 path (20%, then $1-2K a month plus 10-12%). The only
public contingency reference finance found is in parcel audit (Refund Retriever, 40-50%), a different
market.
Contingency is an established model in the industry; one audit firm states its "compensation is
limited to a contingent share of the actual savings generated by our services".
Source: Lojistic, Freight audit FAQ, https://www.lojistic.com/shipping-faqs/ftl-ltl-ocean-rail-air-freight-audit-questions, accessed 2026-10-17

## 8. Open questions

- The shipper count (19,932) rests on a 4.68% freight-to-sales ratio from 2008; refreshing that ratio
  is the first sizing task (`research/02-industries.md`). No independent shipper survey on accessorial
  disputes exists, so design-partner calls are the first demand evidence on this side.
- Share of SME importers that import by ocean container: UNKNOWN — needs primary research.
- Whether importers want container D&D and truck accessorials handled in one workflow (untested;
  `research/04-gaps.md`).
- Whether shippers accept a 25% pilot contingency against Loop's platform fees and Intelligent Audit's
  subscriptions, and whether a coexist offer (disputed lines only) is enough to start.
- Whether customs brokers and forwarders will refer importers, and on what terms.
- Factoring and broker partner terms for the later carrier channel.
- Target CAC by segment. `finance` sets a blended target ($13.4K in year 2, $15.0K in year 3;
  `marketing-plan.md` section 6); pilots should record cost per account by segment.
