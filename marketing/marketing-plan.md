# scoup.ai marketing plan (pre-product)

> **Status.** scoup.ai is pre-product: a prototype exists, it has run on synthetic data only, it has never
> been deployed, and nobody pays for it. This plan therefore markets a design-partner programme, not a
> product. It contains no traffic, conversion, recovery or revenue results, because none exist. Every
> target below is a pre-registered hypothesis, labelled as such. Name and voice follow
> `brand/README.md` (always lowercase **scoup.ai**). Budget and target CAC are set by `finance` on
> 2026-10-17 (section 6).
>
> Inputs: `freight-recovery/business/business-plan.md`, `business/investor-brief.md`,
> `marketing/seo-and-growth.md`, `marketing/landing/*`, `fundraising/README.md` (main checkout), the
> brand worktree (`freight-recovery-brand`, branch `feat/scoup-brand`), and competitor facts checked on
> vendors' own pages on 2026-10-17, plus `research/01-competitors.md`, `02-industries.md` and
> `04-gaps.md` (owner: `market-researcher`); where this file and those disagree, the research files win.

## 1. What we are marketing, and to whom

The product takes one load's rate confirmation, bill of lading or gate record, and invoice, applies the
contract terms (clock start, free time, rounding, rate, cap, authorized accessorials), and produces an
evidence packet plus a demand letter marked DRAFT that a person must approve before anything is sent.
That is what the prototype does today on synthetic files
(`freight-recovery-brand/marketing/site/pages/how-it-works.html`).

Run from the payer's side, the same engine checks a paid invoice: each accessorial and detention line
against the rate confirmation that should have authorized it, and each container detention and
demurrage (D&D) invoice against the FMC billing rule's content and timing requirements, with dispute
deadlines tracked (`research/02-industries.md` notes the D&D checks and claims state machine exist on
synthetic data).

**Owner decision, 2026-10-17: shipper- and importer-first.** The primary buyers are mid-market shippers
(ASSUMPTION: $5M-$50M annual freight spend, `business-plan.md` section 2) that pay carrier and broker
invoices carrying accessorial lines nobody authorized, and small and mid-size ocean importers paying
D&D invoices they cannot check. The census counts 234,023 SME importers across all modes in 2024
(`research/02-industries.md`). `market-researcher` models 19,932 mid-market shippers from Census SUSB
2022 revenue classes (manufacturing 5,971, wholesale 8,798, retail 5,163; 9,366 to 35,349 depending on
the freight-to-sales ratio assumed), and estimates the FMC D&D pool supports about 12,833 importers at
the business case's size (`research/05-market-size.md`).
Carriers, whom the business plan had proposed as the opening wedge, become a later channel reached
through factoring and broker partners (`gtm.md`, Segment C). The payer holds the invoices and owns the
money found, so a free review needs no counterparty's cooperation; the price of the choice is entering
the side of the market where funded competitors already sell (section 2.2; `gtm.md` section 3).

The scale of the problem has one credible third-party anchor. ATRI's September 2024 detention study
puts the cost of driver detention to US trucking at $15.1B a year; its release says "94.5 percent of
fleets charge detention fees" yet are paid on "fewer than 50 percent of those invoices".
`market-researcher` re-verified the figure against the live source on 2026-10-17
(`research/04-gaps.md`, `research/05-market-size.md`). It is a cost of waiting, not a pool of
recoverable dollars, and external copy must say so whenever it quotes the number.

Outside voices describe the gap in the words we want to answer. A 2016 DAT survey of 257 carriers found
"Only three percent of carriers were paid on 90 percent or more of their detention claims", and that
two-thirds of brokers "paid detention only when they could collect the fee from the shipper or
consignee". The survey is ten years old; we quote it as the only per-carrier measure found, not as
current fact. A driver on TheTruckersReport (August 2025) describes the habit our packet formalises: "I
always note my arrival and departure times on my freight bill as well as a note for the reason". Broker
detention terms vary ("They all have different policy and procedures"), so a packet must cite each
counterparty's own terms rather than a generic rule.

Sources (quotes as recorded in `research/04-gaps.md`):
- Source: DAT Solutions, "63 percent of drivers are detained for more than 3 hours per stop", 14 July 2016, https://www.dat.com/company/news-events/news-releases/63-percent-of-drivers-are-detained-for-more-than-3-hours-per-stop-dat-solutions, accessed 2026-10-17
- Source: TheTruckersReport forum, detention-denial poll thread, page 3, https://www.thetruckersreport.com/truckingindustryforum/threads/whats-the-1-reason-your-detention-claims-get-denied-poll.2529156/page-3, accessed 2026-10-17
- Source: TheTruckersReport forum, "Broker doesn't want to pay / one of those days", page 2, https://www.thetruckersreport.com/truckingindustryforum/threads/broker-doesn%E2%80%99t-want-to-pay-one-of-those-days.2519612/page-2, accessed 2026-10-17
- ATRI: full source line in `research/04-gaps.md` (release of 10 September 2024).

On the importer side, the FMC reports that the nine largest ocean carriers "have collected roughly
$15.4 billion in D&D charges between April 1, 2020, and March 31, 2025" (about $3.08B a year, our
arithmetic: $15.4B / 5), and the Harbor Trucking Association reported members disputing "more than 3
million detention and demurrage charges in 2020". Under the FMC billing rule, failure to meet its
invoice content and timing requirements "relieves the billed party's obligation to pay", and the billed
party has 30 calendar days to request mitigation, refund or waiver. Only 46 C.F.R. 541.4 was vacated by
the D.C. Circuit in September 2025; the rest remains in force.

- Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17
- Source: Supply Chain Dive, Harbor Trucking Association survey coverage, https://www.supplychaindive.com/news/detention-demurrage-port-congestion-fees-Harbor-Trucking-Association-TradeLanes/594406/, accessed 2026-10-17
- Source: Thompson Hine, "FMC Issues Final Rule on Billing Requirements and Practices for Detention and Demurrage Invoices", https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17
- Source: Thompson Hine, "Court sets aside part of FMC's demurrage and detention billing rule", 26 September 2025, https://www.thompsonhine.com/insights/court-sets-aside-part-of-fmcs-demurrage-and-detention-billing-rule/, accessed 2026-10-17

## 2. Positioning

### 2.1 Positioning statement

For transportation, import and AP leads at mid-market shippers and small and mid-size importers, who
pay accessorial, detention and container D&D charges they cannot check against the document that
authorized them, scoup.ai checks each line against the rate confirmation, contract or FMC billing rule,
shows the mismatch and the arithmetic, and drafts the short-pay or dispute for a person to approve.
Enterprise freight audit and payment platforms reconcile invoices at volume for large shippers; their
smaller-shipper offers are subscriptions, and the ocean D&D specialist serves the largest importers. We
take only the lines in question, charge nothing until money is recovered or avoided during the pilot, and hold back any line we
cannot support instead of disputing it.

The statement makes four choices on purpose. It speaks to the payer, following the owner's
shipper- and importer-first decision of 2026-10-17. It names documents rather than "data", because an
AP manager recognises a rate confirmation and does not recognise a platform. It promises a checked
line, not a recovery, because we have measured no recovery. And it defines the competition by what each
option does with a disputed line, which is where we differ.

Carriers remain part of the story. The same engine builds a carrier's detention packet, and carriers
become a later channel through factoring and broker partners (`gtm.md`, Segment C). The carrier hero
line "Get paid for detention you can prove" stays on the carrier pages for that phase.

### 2.2 Named alternatives and where we stand against each

Each row quotes the vendor's own page or trade coverage, accessed 2026-10-17. "Where they are
stronger" comes first because buyers will check it, and conceding it costs us nothing we could
honestly claim.

| Alternative | What they say they do (own words) | Where they are stronger | Our opening against them |
|---|---|---|---|
| **Cass Information Systems** (enterprise freight audit and payment) | "$37 billion in freight spend processed and paid annually"; "35 million freight invoices processed and paid each year"; logos include PepsiCo, Unilever, Toyota | Scale, payment processing, six decades in the business, a payment network of "15,000+ freight carriers" | Built for enterprise shippers' payables at Fortune 500 scale, by its own logos. A $10M-spend shipper is below that profile; we offer it a review of disputed lines with no programme to adopt. |
| **Intelligent Audit** (freight audit and payment) | "#1 Freight Audit & Payment Company"; "20% of Fortune 50 companies are customers"; services include "Freight Audit & Recovery", "DeepDetectAI", "Polly Carrier Agent"; FAQ: pricing is "a subscription model based on annual shipment volume, modes, and # of carriers"; for shippers under $10M a year, Catalyst offers "a free trial for 90 days" (launched June 2025 for parcel spend) | Breadth (parcel, claims, sourcing, visibility), AI features in market, an entry offer for smaller shippers | It is moving down-market on the shipper side, so we do not claim it ignores smaller shippers. It sells subscriptions, not contingency, and Catalyst started with parcel. Our difference: truckload and LTL accessorial and detention disputes, a per-line packet a counterparty can check, and a pilot paid only on money recovered. Detail in `gtm.md` section 3. |
| **Loop** (AI freight audit and payments) | "The industry's first Logistics Data Platform"; "99% of freight and parcel audits" automated; logos include General Mills and Macy's | AI-native shipper-side automation at volume; $160M raised, including a $95M Series C in April 2026; No. 10 on the 2026 Inc. 5000 | Shipper-side and enterprise-weighted by its own logos. Its claim is audit throughput; ours is the evidence behind one disputed charge. The most direct funded competitor in our primary segment, and buying mid-size books (Data2Logistics, StrategIQ). Detail in `gtm.md` section 3. |
| **TMS detention modules** (McLeod Software, TMW Systems) | McLeod: carriers can "automatically notify and bill excessive detention time to customers"; TMW: "Detention Tracking" that can "automatically bill for detention time" | Already inside the carrier's system of record; no new vendor | They compute and bill the time. They do not assemble the rate-con clause, gate evidence and calculation steps into a packet built for a dispute, and they reach only carriers running those systems. |
| **Telematics add-ons** (FleetOptos Detention Tracker on Geotab) | "automates detention billing for trucking fleets using Geotab telematics data"; geofence dwell, contract billing rules, QuickBooks export | Automatic timestamps from the truck, which is strong evidence we do not generate | Tied to one telematics platform and focused on billing the charge. Its timestamps are an input we would cite; a partnership is likelier than a fight. |
| **Hey Bubba** (AI dispatcher with detention management, small carriers) | Records dwell from ELD geofence crossings, captures detention terms at booking, logs the claim with timestamps and notifies the broker while the truck is still at the facility; connects to "100+ ELDs" | Same buyer as our carrier segment, with the clock captured automatically inside a dispatch product used daily | It captures the clock. Its page does not describe a cited packet with the rate-con clause, BOL times and calculation, dispute deadlines, or the shipper side. A carrier on it is an integration prospect. |
| **BlueCargo** (ocean D&D audit and disputes) | Invoice checks "against OSRA invoice requirements"; "Dispute resolution with evidence-backed documentation"; claims "1 in 5 Top US Shippers"; named customers include GE Appliances and Samsung; $11M raised (2023) | The strongest D&D specialist: terminal and rail data connections, large-importer references | Serves the largest importers at major ports. Our opening is SME importers and one workflow covering container D&D and the trucking accessorials on the same shipments, which is untested demand. |
| **Status quo** (spreadsheets, email threads, write-offs) | n/a | Free, familiar, no data sharing | The real competitor. We win only if a packet takes less effort than the claim is worth, which is exactly what the design-partner programme measures. |

Sources:
- Source: Cass Information Systems, Transportation expense management, https://www.cassinfo.com/transportation-expense-management, accessed 2026-10-17
- Source: Intelligent Audit, home page, https://www.intelligentaudit.com/, accessed 2026-10-17
- Source: Loop, home page, https://loop.com, accessed 2026-10-17
- Source: Geotab Marketplace, FleetOptos listing, https://marketplace.geotab.com/solutions/fleetoptos/, accessed 2026-10-17
- Source: Bulk Transporter, "Module bills for downtime" (McLeod Software), https://www.bulktransporter.com/archive/article/21644416/wwwmcleodsoftwarecommodule-bills-for-downtime, accessed 2026-10-17
- Source: Intelligent Audit, FAQ, https://www.intelligentaudit.com/faq, accessed 2026-10-17 (via `research/01-competitors.md`)
- Source: Hey Bubba, Detention Management, https://bubba.ai/solutions/detention-management, accessed 2026-10-17 (via `research/01-competitors.md`)
- Source: Business Wire, Loop Series B, https://www.businesswire.com/news/home/20231003388240/en/, accessed 2026-10-17; AlphaMaven, "Loop raises $95M Series C", https://alpha-maven.com/story/venture-capital/loop-raises-95m-series-c, accessed 2026-10-17 (via `research/01-competitors.md`)
- Source: BlueCargo, home page, https://www.bluecargo.io/home-tests, accessed 2026-10-17 (via `research/01-competitors.md`)
- Source: Trucking Info, "TMW adds detention tracking feature", https://www.truckinginfo.com/94877/tmw-adds-detention-tracking-feature, accessed 2026-10-17 (older trade coverage; current product scope not re-checked)

Trax Technologies, CTSI-Global and nVision Global are enterprise freight audit and payment providers
in the same position as Cass for our purposes: shipper-side, no carrier offer. BlueCargo serves ocean
demurrage and detention, outside our truckload wedge for now. Full rows: `research/01-competitors.md`.
The research finding that shapes our pricing message: no competitor profiled publishes prices or a
contingency rate, and none of the freight audit and payment firms sells to carriers. With the
shipper- and importer-first decision, the rows that matter most are Loop, Intelligent Audit (including
Catalyst) and BlueCargo; the battlecard for winning against them is `gtm.md` section 3. The carrier-side
rows (TMS modules, FleetOptos, Hey Bubba) matter again when the partner channel opens in phase 4.

### 2.3 Category and the word we own

We place scoup.ai in **accessorial, detention and D&D recovery for shippers and importers**, not
"freight audit". Freight audit is the incumbents' category, defined on their terms, and entering it
invites a comparison on scale we lose. The word we want attached to the brand is **proof**; the logo,
two halves meeting exactly, draws the same idea (`brand/README.md`, section 2). The shipper hero line
is **"Take accessorial review off AP's desk. Every line checked against the rate confirmation, with the
source attached."**

We chose a workload line over the overbilling line "Stop paying accessorials that were never
authorized" (drafted in `freight-recovery/marketing/landing/outline.md`, `/accessorial-audit/`) because
the only shipper survey found points that way. In RXO's survey of 750 shippers and carriers, "61% of
shippers agree that managing accessorial requests is one of the biggest time-wasters for their
accounting team" and "71% are actively working on reducing accessorial spend", but "70% of shippers
agree that carriers are usually honest when requesting accessorials — only 8% thought there was
outright dishonesty" (`research/04-gaps.md`, gap 5). A line that implies carriers overbill argues with
what most buyers believe; a line that removes work agrees with it, and the cited packet still shows any
line that is not supported. RXO is a freight broker, not an audit vendor, so it has no audit product to
sell, but it is not neutral either. The overbilling line stays as the A/B alternate in paid tests and
as the H1 option for the `/accessorial-audit/` page, so the evidence can settle it.

Source: RXO, "What Shippers & Carriers Really Think About Trucking Accessorials (Original Research)", 25 November 2024, https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17 The importer hero line is
**"Check every D&D invoice before the 30-day window closes."** It names the deadline the FMC rule
creates without claiming any charge is invalid; the supporting line under it is "We check each
container detention and demurrage invoice against the FMC billing rule's content and timing
requirements, and list what to dispute and by when." Both lines carry the source and the "confirm with
counsel or your customs broker" note wherever the rule is described.

`seo` reports that buyers search in operational vocabulary ("rate confirmation", "detention pay") more
than "freight audit", and that "freight claim" is read as cargo loss and damage (Google Trends, relative
interest only, pulled 2026-10-17; data and script in `fr-wt/seo/marketing/seo/data/`). Headlines
therefore use "accessorial", "detention", "rate confirmation" and "D&D invoice", and avoid "claim".

## 3. Messaging by buyer

The three pillars from `brand/README.md` section 4 (Proof attached; A person decides; Built for the
loads big audit programs skip) stay constant. "Proof attached" leads for every buyer. "A person decides"
answers trust objections; `market-researcher` found no outside evidence that buyers ask for approval
controls (`research/04-gaps.md`), so it never leads.

| Buyer (title) | What keeps them up | Core message | Proof we offer today | Objection we expect, and our answer |
|---|---|---|---|---|
| Shipper transportation / logistics manager (champion) | Accessorial requests eating the team's week; lines nobody can match to a rate con; carrier relationships | "Accessorial review off your team's desk: every accessorial and detention line checked against the rate confirmation, with the source attached and the few mismatches shown." | Synthetic example: linehaul above rate con, unauthorized lumper flagged for review, not auto-disputed | "We already have an audit vendor." Keep it. Send us only the lines you are unsure about. |
| Shipper AP manager / controller (user) | Accessorial requests as a time sink (61% of shippers in RXO's survey); paying what cannot be verified; audit trail at year-end | "Approve the supported lines in minutes, short-pay the rest with a packet that shows why, and keep the record for the auditors." | Confirmed vs "needs review" split; DRAFT letters; per-document fingerprints | "This will upset our carriers." Ambiguous lines go to a person, never disputed automatically. |
| Shipper CFO / VP finance (economic buyer) | Freight cost line; vendor risk; another subscription | "A review of three months of your paid invoices costs nothing. During the pilot, we are paid only on money recovered." | Pilot terms; the honest status page | "You have no customers." Correct, which is why the first step costs nothing and uses invoices you already have. |
| Importer import / logistics manager (champion) | D&D invoices arriving late or vague; dispute windows missed | "Check every container D&D invoice against the FMC billing rule's content and timing requirements before the 30-day window closes." | Synthetic D&D invoice check with the rule's required fields marked and the deadline shown | "Our forwarder handles this." Many forwarders pass charges through; we give you the list to dispute with them or through them. |
| Importer owner / CFO (economic buyer, smaller firms) | Cash leaking to port fees they cannot challenge | "Find the D&D charges the rule says you may not owe, and the truck accessorials on the same shipments, in one review." | The same synthetic samples; contingency terms | "Is this legal advice?" No. We check invoices against published requirements and draft; you or your counsel decide. |
| Factoring or broker partner (later phase, carrier channel) | Unpaid accessorial lines on purchased or brokered loads | "Your carriers' detention lines arrive with a packet you can forward to the shipper unchanged." | Sample carrier packet; written data-handling terms | "Will this create disputes?" Uncertain lines are held back, not claimed. |

Every claim about the FMC rule in external copy carries the Thompson Hine source line from
`research/04-gaps.md` (gap 3) and the note that 46 C.F.R. 541.4 was vacated in September 2025 while the
content and dispute provisions remain in force. We describe what the rule requires; we never tell a
buyer it does not owe a specific charge, which is a legal judgement.

Messages we never use, for any buyer: a recovery percentage, a dollar figure from someone else's data,
"AI-powered", "automated recovery", integration names, certification language, competitor claims
beyond what their own pages state, or the unverifiable "~$3.1B freight audit and payment market"
figure. The site's banned-phrase test (`freight-recovery-brand/marketing/site/test.mjs`) already
enforces part of this list.

## 4. Launch plan: design-partner pilot first

A company with no product in market cannot "launch" in the usual sense, and pretending otherwise would
burn the one asset we have, which is credibility with sceptical finance buyers. The launch is a
sequence of gates taken from `business-plan.md` section 6; each phase spends only after the previous
gate has evidence behind it. The audience in phases 1-3 is shippers and importers. Carriers enter in
phase 4 through partners.

| Phase | Gate it serves | Marketing goal | What we do | What we do not do | Exit evidence |
|---|---|---|---|---|---|
| 0. Ready to talk (now) | Before G1 | Be checkable when a prospect searches for us | Register the scoup.ai domain (brand Gap 10); set a real contact address (Gap 8); align site palette with brand (Gap 2); publish synthetic sample packets for a shipper accessorial review and a D&D invoice check; draft NDA and data-handling terms with counsel; answer a standard security questionnaire honestly | Paid acquisition, press, comparison pages | A finance buyer can read the site, the status page and a sample packet, and reach a person |
| 1. Design-partner recruitment | G1 (leakage proven) | 3-5 partners (at least two shippers, one importer) sharing three months of paid invoices | Founder-led warm intros via accountants, fractional CFOs, forwarders and customs brokers; individually written outreach (`gtm.md` section 5) | Bulk email, bought lists, logos | Signed NDAs, security questions cleared, invoices received |
| 2. Invoice reviews | G1 | A written review per partner | Run the prototype; hand back packets and, for importers, the FMC-rule issue list with deadlines; record where rules were wrong | Publish any partner number without written consent | Per-partner review; recoverable share measured, or the kill trigger hit |
| 3. Contingency pilots | G3 (paid pilots) | 3+ shipper or importer partners on live invoices | Pilot agreement at the contingency rate; human approval on every short-pay or dispute; first conversations with factoring and broker partners, to learn | Claim win rates before they are measured | Dollars recovered or avoided, cycle time, review minutes per invoice |
| 4. First public proof and the carrier channel | After G3 | One consented case study; the first partner channel to carriers | Case study; FMC-rule and accessorial content and calculator (`seo`); paid message tests; a co-offer with one factoring or broker partner | Scale paid spend before CAC is measured | First inbound leads attributable to content; one signed partner |

Phases 0-2 depend on the security and legal items in the brand worktree's `security.html` "Not yet"
list, and shippers will ask about them sooner than carriers would. No real document is accepted before
handling terms are signed, and the status page says real customer data is not accepted until those
items are done. Marketing cannot shorten that dependency; it can only avoid promising around it.

## 5. Channel mix

Founder time is the scarce input (`seo-and-growth.md` section 11), so the mix is ranked by expected
design-partner conversations per founder hour, not by reach. The shares are planned allocations of
founder marketing time in phases 1-3, a decision rather than a measurement.

| Channel | Role | Planned share of founder marketing time | Starts | Notes |
|---|---|---|---|---|
| Warm introductions and individually researched outreach | Primary source of shipper and importer design partners | 45% | Phase 1 | Accountants, fractional CFOs and personal network first; named-account list from the profiles in `gtm.md` section 4; CAN-SPAM and GDPR/ePrivacy rules apply |
| Referral partners: customs brokers and freight forwarders (importers); later factoring firms and brokers (carriers) | Introductions to many accounts through one trusted party | 20% | Phase 1 for forwarders; phase 3-4 for carrier partners | Never imply a partnership before one is signed |
| Founder LinkedIn (posts and substantive comments) | Credibility with finance and logistics titles; inbound | 15% | Phase 1 | Synthetic accessorial and D&D checks worked through step by step |
| Owned content and SEO (owner: `seo`) | Discovery for accessorial-dispute and FMC D&D queries | 10% | Phase 0 foundations, phase 4 cadence | Detailed plan in `marketing/seo/**` |
| Events and associations | Meeting supply-chain, import and finance buyers in person | 5% | Phase 1-3 | Attend before sponsoring; one trade show pass in year 1 |
| Paid search and LinkedIn ads (owner: `digital-marketing`) | Message tests only | 5% | Phase 4 (after G3) | Targeting shipper and importer titles; budget in section 6 |

The order matters more than the percentages. Introductions and referral partners come first because
they reach people who already hold paid invoices; content comes second because it makes those
conversations easier; paid comes last because paying for clicks before we know which message converts
would measure nothing.

### 5.1 Lead magnets for the new audience

The calculator spec in the main checkout (`freight-recovery/marketing/landing/calculator-spec.md`)
was written carrier-first; its shipper variant has only two inputs and there is no importer variant.
We drafted a fuller shipper variant (accessorial and detention lines on paid invoices) and a new
importer D&D variant (invoices at stake and the share that would pass the 30-day window unreviewed) in
`brand/calculator-variants.md`, with worked examples and acceptance tests. The owner of
`marketing/landing/` should merge them before the calculator is built.

## 6. Budget

**Year-1 marketing programmes: $30.0K ($7.5K per quarter). Sales travel: $60.0K, a separate line.
Total Year-1 sales and marketing: $90.0K. No marketing hire until year 3.**

These are `finance`'s plan inputs for a pre-product company, not measurements
(`fr-wt/finance/financial/budget.md`; `model.xlsx`, Assumptions `o_mkt` and Unit Economics tab).
Legal work (NDA, data-handling terms, pilot agreement, claims review) sits in G&A under a $150K legal
and regulatory line, not in marketing. Marketing programmes by year in the base case ($K): 30 / 90 /
200 / 320 / 420 / 480 / 520.

Within the $30.0K, we allocate as follows. `finance` confirmed this split on 2026-10-17, on the
condition that the $7,500 of paid tests stays locked until gate G3.

| Line | Phase | What it buys | Amount |
|---|---|---|---|
| Domain registration, site fixes, sample packet page | 0 | scoup.ai domain (brand Gap 10), brand-consistent site, contact address, synthetic example | $2,000 |
| Domain-expert reviewer for explainers and packet format | 0-2 | A freight-billing practitioner checks our rules and copy | $4,000 |
| CRM, outreach tooling and list data | 1 | Tracking every conversation and its source; shipper and importer account list | $3,000 |
| Content production and design (packet template, deck template; brand Gap 9) | 0, 4 | Branded artifacts a buyer actually handles | $6,000 |
| One trade show pass (Manifest, attendance, not a booth) | 1-3 | In-person meetings with carriers, factors and associations | $1,995 |
| Paid message tests: LinkedIn $4,500 + Google $3,000 | 4 | Search and LinkedIn ads on a handful of buyer-intent phrases | $7,500 |
| Reserve | all | Unplanned content or event costs | $5,505 |
| **Total** | | | **$30,000** |

Arithmetic: 2,000 + 4,000 + 3,000 + 6,000 + 1,995 + 7,500 + 5,505 = $30,000. Founder travel to design
partners and the assumed $1,500 travel to the trade show come from the separate $60.0K sales line,
which `finance` scopes to "travel to US design partners and freight-industry meetings".

After the owner's shipper- and importer-first decision, `digital-marketing` keeps year 1 at $9,495
(LinkedIn $4,500 split 60/40 shipper/importer, Google $3,000 in one shipper and one importer ad
group, the $1,995 Manifest pass) and cuts year 2 from $5,500 to $4,000: one trade newsletter $3,000
(JOC if importers lead, DC Velocity if shippers do) and retargeting $1,000. The $1,500 Meta test for
carriers is dropped entirely, and the carrier creative is withdrawn. Paid tests in both years stay
locked until G3. On events, we follow `digital-marketing`'s
recommendation: TPM 2027 (JOC, Long Beach, 28 February-3 March 2027; fee unknown) replaces Manifest
only if importers produce more design-partner conversations than shippers by January 2027; we do not
add a second event. Both figures are inside `finance`'s programmes line (year 2: $90K).

Earlier, `digital-marketing` proposed $16,495 for paid tests and events (`fr-wt/digital/marketing/digital/channel-plan.md`).
Its LinkedIn ($4,500), Google ($3,000) and Manifest pass ($1,995; its $1,500 travel estimate moves to
the sales-travel line) fit inside the $30.0K. Its remaining lines were re-planned after the
owner's decision, as set out in the paragraph above. If phase 4 slips past year 1,
the $7,500 moves into year 2's $90K.

**Target CAC** (sales and marketing cost divided by new accounts won, base case): $13.4K in year 2,
$15.0K in year 3, $17.9K in year 5. In year 3 that equals $0.68 of sales and marketing per $1 of new
ARR, against a Benchmarkit 2024 median of $2.00. At the median, CAC would be $43.8K and the base case
would need a $12.3M seed (`finance`). The plan therefore depends on three cheap acquisition paths
staying cheap: founder-led selling, the free invoice review, and referral partners (forwarders and customs brokers now; factoring firms and brokers for the carrier channel later). Those
three are exactly what phases 1-3 test, and the CAC actually observed on the first 20 accounts
replaces this target.

Source: Benchmarkit, 2025 B2B SaaS benchmarks, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-17 (via `fr-wt/finance/financial/unit-economics.md`)

`finance` also gives a sourced pessimistic CAC of $31K per customer (media cost only, excluding sales labour), about twice the plan's ~$15K. Paid results in phase 4 are
therefore read as a message test, not as a growth channel to scale.

Source: Metadata.io, 2026 B2B Paid Media Benchmark Report (2025 data, 153 advertisers), https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17 (via `fr-wt/finance/financial/assumptions.md`, input `pess_cac`)

The business plan's earlier illustrative CAC of ~$25K and LTV:CAC of ~5.2x (`investor-brief.md`
section 6.5) are superseded by `finance`'s figures above.

Creative concepts are mapped to the three pillars in `fr-wt/digital/marketing/digital/creative-concepts.md`.

Spending rule regardless of the total: nothing in phase 4 is released until G3 evidence exists, and
legal lines are paid before any acquisition line.

## 7. How success is measured

At this stage the metric that matters is qualified conversations that turn into shared files, not
traffic. Targets below are pre-registered hypotheses for phases 1-3, set before any data so that we
cannot move them afterwards. If they are missed, the plan is revised, not the record.

| Stage | Metric | Pre-registered target (hypothesis) | Source of truth |
|---|---|---|---|
| Reach | Named accounts contacted with a personalised message | 60 accounts in phase 1 | CRM |
| Response | First calls held | 15 calls (one in four contacted) | CRM |
| Qualification | Calls meeting the qualification test in `gtm.md` section 6 | 8 qualified | CRM notes |
| Commitment | Signed NDA and paid invoices received | 3-5 design partners (at least two shippers, one importer) | Signed agreements |
| Value | Invoice reviews delivered with partner feedback recorded | One per partner | Review documents |
| Conversion | Partners moving to a contingency pilot | 3 pilots (G3) | Pilot agreements |
| Learning | Rule corrections logged from partner feedback | Every correction logged; no target count | Issue tracker |
| Channel attribution | Source of each partner conversation | 100% of conversations tagged | CRM field |

The funnel ratios in that table are our own planning guesses, not benchmarks: 60 contacted, one in four
to a call (15), about half of calls qualifying (8), and three to five of those signing. Once phase 1
ends, the observed ratios replace them and set the phase 3 plan. Web metrics (indexed pages,
calculator completions) belong to `seo` and `digital-marketing` and are reported, not targeted, until
two months of real data exist.

## 8. Risks

1. **Credibility gap.** Polished marketing for an unvalidated product erodes trust. We keep the
   pre-product notice on every page and lead with the sample packet, not claims.
2. **Contested segment.** The owner's shipper- and importer-first decision moves us onto ground where
   Loop ($160M raised), Intelligent Audit (with Catalyst for smaller shippers) and BlueCargo (ocean D&D)
   already sell. We compete only where the buyer wants no platform fee, no integration and per-line
   evidence, and offer to coexist with an existing audit vendor (`gtm.md` section 3). If that niche is
   too small, phase 1 will show it through the stop rule.
3. **Shippers fear their carriers.** A shipper may hesitate to short-pay carriers it depends on. Human
   approval and the "needs review" category are the answer.
4. **Longer, heavier sales.** Shippers bring a finance approver and security questionnaires; the honest
   status page will be read closely. The recruitment timeline in `gtm.md` section 5 allows for it.
5. **Nobody shares files.** If design partners will not share paid invoices under NDA, G1 fails. The
   kill trigger in `business-plan.md` section 6 applies; marketing does not paper over it.
6. **Recoverable share is small.** The plan's economics rest on an unmeasured recovery rate. Phase 2
   exists to measure it before any spend scales. For importers, `research/02-industries.md` puts the SME
   D&D ceiling at $0.93M a year by year 5 on assumed inputs, so D&D is sold as the importer's way in,
   not as a business of its own.
7. **Competitor drift.** Intelligent Audit is moving down-market; Loop is buying mid-size books
   (Data2Logistics, StrategIQ); Hey Bubba already sells detention capture to carriers we will later
   reach through partners. Our differentiation is narrow and must be re-checked every quarter.
8. **Trademark and domain.** No trademark search for "scoup.ai" is recorded (`brand/README.md`, Gap 7); it must
   close before printed material or paid media. The scoup.ai domain also appears unregistered (RDAP
   404 on 2026-10-17, reported by `seo`; brand Gap 10); registering it is a phase 0 item.

## 9. Open questions

- The freight-to-sales ratio behind the 19,932 shipper count (from 2008), and the share of SME
  importers that import by ocean container.
- Whether shippers accept contingency against Loop's platform fees and Intelligent Audit's
  subscriptions, and whether the coexist offer is enough to start.
- Whether importers want container D&D and truck accessorials in one workflow (untested).
- Whether customs brokers and forwarders will refer importers, and on what terms.
- For the later carrier channel: factoring and broker partner terms, and whether Hey Bubba or
  FleetOptos would partner (their timestamps in, our packets out) rather than compete.
- Pricing: the financial model (`fr-wt/finance/financial/assumptions.md`) sets a 25% pilot
  contingency for shippers and importers, then an annual platform fee of $6K rising to $17K plus 17%
  falling to 12%, and 20% for carriers. All are ASSUMED; design-partner conversations test them, and
  any change goes through `finance` so the package keeps one price path.
- Who serves as the freight-domain reviewer for copy and rules.
