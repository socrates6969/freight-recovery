# Innovation thesis

> **Status.** Pre-product, synthetic data only, never deployed, no paying customers. Nothing below has been
> measured on a real claim. Each innovation names a mechanism that exists in code today (branch `feat/hardening`,
> `ed3d126`), the research gap it answers (`research/02-industries.md` and `research/04-gaps.md`, market-researcher,
> 2026-10-17), and how we would measure it in a pilot. Where the code stops short of the gap, we say exactly where.
>
> **Revised 2026-10-17 after the owner's decision:** scoup.ai goes to market shipper- and importer-first. Carriers
> become a later segment, reached mainly through partners. The carrier-packet innovations moved to section 5.

## 1. Summary

The lead innovations serve the two first buyers: the mid-market shipper whose accounts-payable team receives
carrier invoices with accessorials on top of the agreed rate, and the SME importer who receives ocean demurrage and
detention (D&D) invoices. We rank them by the strength of the outside evidence behind each gap, and we say where
that evidence is still thin.

| # | Innovation | Gap answered | Evidence grade | Buyer it converts |
|---|---|---|---|---|
| I1 | An accessorial and surcharge audit against the shipper's own contract terms, with a cited short-pay packet | Gap 5: auditing accessorials and fuel surcharge against the shipper's own rate confirmation and FSC table; mid-market shippers are too small for enterprise audit programmes | Outside evidence of workload (RXO survey of 750 shippers and carriers, a broker, not neutral); counter-evidence that shippers mostly trust carriers; no independent figure on overcharge rates | Controller or AP lead at a shipper with $5M to $50M freight spend |
| I2 | A regulation-coded ocean D&D invoice audit for SME importers | Gap 3: 46 CFR 541 checks and the 30-day window are sold to large importers only | Outside evidence: FMC, a law-firm analysis of the rule, a trade-association survey | Logistics or finance lead at an SME importer |
| I3 | One claims queue for the same shipper's truck and ocean charges | Gap 3, second half: no competitor ties the D&D window into a workflow that also handles truck charges for the same shipments | Competitive gap documented; no buyer quote yet | The same shipper or importer, as a reason to keep one vendor |

Carrier-side ideas (the cited detention packet for the carrier who is owed money, machine-readable broker
detention terms, a two-sided packet for brokers) keep their research backing (Gaps 1, 2 and 4) but move to
section 5 as the later segment. Ideas without outside demand evidence stay hypotheses in section 6.

The market figures that bound this, as re-verified by market-researcher: the nine largest ocean carriers collected
about $15.4 billion in D&D charges between April 2020 and March 2025 (an average of $3.08 billion a year, our
arithmetic: $15.4B / 5); 240,535 US companies imported goods in 2024, 234,023 of them small and medium enterprises
accounting for $884 billion of the $2,926 billion known import value (30.2%, market-researcher's arithmetic).
Market-researcher's serviceable market (`research/05-market-size.md`, v4, 2026-10-17) is 32,765 accounts: 19,932
mid-market shippers, modelled from the Census SUSB 2022 count of manufacturers, wholesalers and retailers with
$100M to $999.9M receipts at an ASSUMED 4.68% freight-to-sales ratio (average freight spend $9.53M), plus up to
12,833 mid-size importers (~2,000 TEU) capped by the FMC D&D pool. Priced per segment (finance `audit.md` C16), that
is $945.4M a year: 19,932 x $27.6K = $550.1M for shippers plus 12,833 x $30.8K = $395.3M for importers, within a
range of $0.55B to $0.95B. The
freight ratio is an assumption, so the shipper count is a model, not a census.

Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17
Source: U.S. Census Bureau, "A Profile of U.S. Importing and Exporting Companies, 2023-2024", release CB26-73, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17
Source: U.S. Census Bureau, Statistics of U.S. Businesses 2022, https://www2.census.gov/programs-surveys/susb/tables/2022/us_naicssector_large_rcptsize_2022.xlsx, accessed 2026-10-17 (extraction: `research/scripts/susb_shipper_counts.py`)

## 2. I1. Accessorial and surcharge audit against the shipper's own contract terms

### The gap

Mid-market shippers buy truckload and LTL capacity and receive carrier invoices that add detention, lumper,
liftgate, reweigh, redelivery and fuel charges to the agreed rate. Market-researcher found the incumbents aimed
elsewhere: Loop at enterprise accounts, Intelligent Audit's smaller-shipper product parcel-first, CTSI-Global and
nVision Global services-led (`research/04-gaps.md`, Gap 5).

The demand evidence is about **workload, not fraud**. RXO's survey of 750 shippers and carriers (25 November 2024)
found that "61% of shippers agree that managing accessorial requests is one of the biggest time-wasters for their
accounting team", that 65% of shippers see a moderate and 19% a significant budget impact from accessorials, that
"71% are actively working on reducing accessorial spend", and that "80% of shippers would rather pay higher
freight rates up front than deal with accessorials on the back end". RXO is a broker with no audit product to sell,
but it is not neutral.

The same survey carries the counter-evidence we must keep in view: "70% of shippers agree that carriers are
usually honest when requesting accessorials", only 8% saw outright dishonesty, and 67% think they pay the industry
standard. So the pitch is "verify every accessorial and fuel line against your own terms with less effort", not
"carriers overbill you". How much money that verification finds is ASSUMED (1% of freight spend in the business
case); no independent source (CSCMP, Gartner, ARC, APQC or NASSTRAC) gives an overcharge rate, and the circulating 3
to 10% error rates are vendor figures.

An older benchmark supports the premise that shippers hold their own terms: Transplace's benchmarking of more than
150 shippers found the fuel surcharge to be the accessorial shippers most commonly publish (93% per search summaries;
the article text was not readable, so we cite the headline only).

Source: RXO, "What Shippers & Carriers Really Think About Trucking Accessorials (Original Research)", https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17
Source: SupplyChainBrain, "Fuel Surcharges Are Most Common Accessorial Published by Shippers: Benchmarking", https://supplychainbrain.com/articles/18205-fuel-surcharges-are-most-common-accessorial-published-by-shippers-benchmarking, accessed 2026-10-17 (2014; headline only)

Two pieces of the carrier-side research carry over with the direction flipped. Detention terms differ by broker
and shipper (Gap 2), so a shipper checking a carrier's claim faces the same term-reading problem from the other
side. And ATRI's finding that fleets are paid on "fewer than 50 percent" of detention invoices shows how many
charges get contested. The business case's estimate of $16K a year in fuel-surcharge overbilling for a mid-size
shipper is an internal assumption, not evidence.

### The mechanism in this codebase

The shipper perspective already exists end to end. Every claim carries `perspective = 'SHIPPER'` or `'CARRIER'`,
and the shipper rules look for money billed above what the contract supports.

1. **The contract terms are extracted values with locations.** The rate-confirmation vocabulary includes
   `linehaul_rate`, `fuel_surcharge`, `authorized_accessorials`, `detention_free_hours`,
   `detention_rate_per_hour` and `detention_max_hours` (`api/src/imports/parse/deterministic.ts`). Each lands in
   `extracted_fields` with page, line, column span and excerpt, and a second person must accept the document after
   any correction (ADR 0005).
2. **Six deterministic shipper checks.** `packages/shared/src/analysis/invoice-checks.ts` and `detention.ts`
   produce `INV-LINEHAUL-RATE` (linehaul above the rate confirmation), `INV-FUEL-SURCHARGE`,
   `INV-ACCESSORIAL-UNAUTH` (an accessorial line not on the confirmation's authorised list), `INV-DUPLICATE`,
   `INV-TOTAL-MISMATCH` and `DET-OVERBILLED` (detention billed beyond what the appointment, arrival and departure
   times support). Each finding carries its arithmetic step by step, in exact decimals (ADR 0011).
3. **The fuel surcharge is checked against the shipper's own fuel table.** Shippers store their fuel-surcharge
   tables (`fsc_tables`; step, row or miles-per-gallon forms). `packages/shared/src/fuel/check.ts` recomputes the
   expected surcharge from the table and the public weekly diesel price for the ship date (EIA series via FRED,
   with provenance in `price_imports`) and raises a review-only `FSC-INDEX-MISMATCH` when the billed amount differs.
4. **Unfamiliar charge names are classified, carefully.** Carriers name accessorials inconsistently. The
   `charge-knn-v1` classifier (`packages/shared/src/charge-intel/`) maps an unrecognised line to a category using
   labelled public tariff examples and the shipper team's own labels (`charge_labels`). Suggestions only add review
   items; they never change a rule's dollar output and never reach the letter.
5. **The output is a cited short-pay or dispute packet.** Each finding points back to the invoice line and the
   rate-confirmation field it rests on (`packet_findings.citations`, clause fields), the packet lists its source
   documents with hashes, and approval binds to a content hash (ADR 0007). The AP team can short-pay or dispute
   with the evidence attached.

Where the code stops short of the gap: extraction only reads labelled `Key: Value` lines, so real carrier
invoices and rate confirmations in free layouts will extract little until a layout-aware or OCR provider exists
(ADR 0008); shipper-carrier contracts that live outside the rate confirmation (master agreements, rate tables
for many lanes) are not modelled; lumper and reweigh receipts have no rule that reads them; and invoices with no
finding are not recorded, so overcharge as a share of audited spend cannot be reported yet (gap G9 in
`docs/exec-dashboard-spec.md`).

### Why it is hard to copy

The rules themselves are not secret. Three things together take time: every dollar traceable to a byte range in
the customer's own documents, a fuel check pinned to a public price series with recorded provenance, and an
approval record a carrier cannot argue was altered. The money rules sit inside an exact-parity test net against an
independent Python implementation (ADR 0003), which is slow to build and easy to lose. Against enterprise audit
firms the argument is price and fit: a self-serve, per-document product for a team too small to buy a managed
audit programme. That argument is about our pricing and has not been tested.

### Buyer it converts, and how we would measure it

The buyer is the controller or AP lead at a shipper spending $5M to $50M a year on freight. In a design-partner
pilot, on the partner's own invoices:

- **AP time per invoice:** minutes the partner's accounting team spends verifying the accessorial and fuel lines of
  one invoice, before the pilot (timed sample) and with scoup.ai (from upload to a decided packet, `import_documents`
  and `approvals`). This is the measure the RXO evidence points to; we state no figure until it is measured.
- **Finding rate by check:** the share of audited invoices with at least one finding, per rule id, with the dollar
  value per rule. Needs a record of invoices audited with no finding (G9) to have a denominator.
- **Correction rate:** reviewer `CORRECT` actions per extracted field, per field key, from `import_review_decisions`.
- **Reviewer rejection rate:** the share of shipper packets the partner's own reviewers reject, from `approvals`,
  as an early signal of false findings.
- **Credited dollars:** what carriers actually credit after a short-pay or dispute. Needs outcome recording (G1)
  before it can be measured at all.

## 3. I2. A regulation-coded ocean D&D audit for SME importers

### The gap

Under the FMC's final rule, an invoice that fails the content and timing requirements relieves the billed party's
obligation to pay, and the billed party has at least 30 calendar days from issuance to request mitigation, refund
or waiver. The D.C. Circuit vacated only 46 CFR 541.4 in September 2025; the rest of the rule stands. BlueCargo
sells these checks to large importers ("1 in 5 Top US Shippers"); market-researcher found no competitor packaging
them for the 234,023 SME importers in the Census profile, or tying the 30-day window into a workflow that also
handles truck detention for the same shipments. Market-researcher rates this a partial gap that wins importer
accounts rather than a business on its own.

Source: Thompson Hine, FMC final rule on D&D billing, https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17
Source: Thompson Hine, 26 September 2025, https://www.thompsonhine.com/insights/court-sets-aside-part-of-fmcs-demurrage-and-detention-billing-rule/, accessed 2026-10-17
Source: BlueCargo, home page, https://www.bluecargo.io/home-tests, accessed 2026-10-17
Source: U.S. Census Bureau, release CB26-73, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17

### The mechanism in this codebase

1. **The regulation is code with a version.** `packages/shared/src/ocean-dd/regulation.ts` pins the clause text
   checked against the eCFR (`DD_REGULATION_VERSION = 'ecfr-2026-10-07'`), and `constants.ts` holds the 30-day
   limits of 541.7 and 541.8. 46 CFR 541.4 is deliberately not modelled because the court set it aside; the
   comment says so in both files.
2. **Seven named rules.** `DD_RULE_IDS`: `DD-TOTAL-MISMATCH`, `DD-PERIOD-ARITH`, `DD-TARIFF-OVERCHARGE`,
   `DD-545-RETURN-REFUSED`, `DD-545-AVAILABILITY`, `DD-541-7-LATE` and `DD-541-6-CONTENT` (`ocean-dd/audit.ts`),
   evaluated against the customer's tariff (`dd_tariffs`, with public presets and provenance in `presets.ts`) and
   a terminal calendar (`dd_calendars`).
3. **Same workflow as truck claims.** The audit run (`api/src/ocean-dd/audit-run.ts`) freezes the invoice
   (`AUDITED` is immutable in the database), creates an `OCEAN_DD` claim with packet revision 1, citations, CFR
   clauses, a timeline and a draft letter that reminds the sender of the 541.8(a) window. The claim then goes
   through the same approval gate and four-eyes rules, with invoice editors excluded from approving.
4. **Low-effort intake.** A CSV import (`ocean-dd/csv.ts`) brings in up to 50 invoices at a time, so a small
   importer does not need an integration to start.

Where the code stops short: there is no deadline alert or worklist ordering by days left (the executive dashboard
spec proposes metric D1), no feed from carriers or terminals, and container events must be typed or imported by
hand.

### Why it is hard to copy

It is not, on its own: the rule is public law and BlueCargo already checks it for enterprises. The defensible part
is narrower: one claims queue, one approval record and one audit chain covering both a shipper's ocean D&D invoices
and the truck detention on the same moves, at a price an SME can carry. That argument depends on pricing and on
I1 and I3 holding up, not on the D&D code.

### Who receives the dispute

Market-researcher found that an SME importer's first stop for a D&D dispute is often its forwarder or customs
broker, and that a forwarder acting as an NVOCC is itself the billing party: CastleGate Forwarding takes D&D
disputes "by entering a ticket through our website in Partner Home". The packet therefore has to work for a
forwarder's dispute desk as well as an ocean carrier's. The code already treats the billing party as data
(`dd_invoices.billing_party_name`, copied into `claims.carrier_name`), so a forwarder invoice audits the same way;
what does not exist is any routing of the packet into a forwarder's ticket system. Forwarders also hold the
importer relationship and the documents, which makes them a possible channel as much as a counterparty.

Source: CastleGate Forwarding, Regulatory, https://castlegateforwarding.com/resources/regulatory, accessed 2026-10-17

### Buyer it converts, and how we would measure it

The buyer is an SME importer's logistics or finance lead who receives D&D invoices and has no specialist tool.
Pilot measures, on the partner's own invoices:

- **Finding rate:** the share of audited invoices with at least one `DD-541-6-CONTENT` or `DD-541-7-LATE` finding,
  and the dollar value attached, reported per carrier.
- **Within-window rate:** the share of disputes made ready before day 30 of the invoice, from `claims.invoice_date`
  and the `SEND_READY` approval time.
- **Reviewer rejection rate:** the share of `OCEAN_DD` packets that the partner's own reviewers reject, from
  `approvals`, as an early signal of false findings.
- **Waived or refunded dollars:** needs outcome tracking (G1).

## 4. I3. One claims queue for a shipper's truck and ocean charges

### The gap

Market-researcher's Gap 3 has a second half: no profiled competitor ties the 30-day D&D window into a claims
workflow that also handles truck charges for the same shipments. BlueCargo serves D&D for large importers; the
freight audit firms treat D&D as one more audit line or not at all. An SME importer that is also a domestic
shipper today needs one tool, or one service firm, per charge type. We have no buyer quote asking for the
combination, so this is a documented competitive gap with demand still to be confirmed in interviews.

Source: BlueCargo, home page, https://www.bluecargo.io/home-tests, accessed 2026-10-17

### The mechanism in this codebase

One `claims` table holds both kinds (`claims.kind` = `FREIGHT` or `OCEAN_DD`, fixed by the trigger
`claims_kind_guard`). Both kinds share the same packet tables, the same approval state machine and content-hash
binding (ADR 0007), the same four-eyes rules (ADR 0005), the same per-tenant audit chain (ADR 0004), the same
streaming exports (`api/src/exports/`) and the same worklist. The executive dashboard spec
(`docs/exec-dashboard-spec.md`) reports both kinds side by side for a shipper executive, including the D&D
mitigation window (metric D1) next to freight invoice age (D2).

Where the code stops short: claims of the two kinds are not linked to a common shipment or bill of lading, so
"the same shipment" is a human association today; there is no shipment key in the schema.

### Why it is hard to copy

A specialist would have to add a second charge domain with its own rules and evidence; an audit firm would have
to rebuild its D&D line into a regulation-coded check. Neither is impossible. The advantage is that both already
share one approval record and one audit chain here, which matters to the controller who must answer for every
short-payment. It is a retention argument more than a moat.

### Buyer it converts, and how we would measure it

The buyer is the shipper or importer who has both kinds of charges. Pilot measures:

- **Two-kind adoption:** the share of pilot tenants that create claims of both kinds within 90 days.
- **Queue time by kind:** time from packet creation to first decision, per kind (dashboard metric T2 split by
  `kind`), to see whether one queue slows either charge type.
- **Vendor consolidation:** whether the partner drops a separate D&D or audit service during the pilot, recorded
  in interviews, not inferred.

## 5. Later segment: carriers and brokers

Carriers become a later segment, reached mainly through partners (owner decision, 2026-10-17). The research
behind these ideas is the strongest we have on the carrier side, so we keep it intact rather than discard it. The
mechanisms overlap almost completely with I1: the carrier perspective uses the same extraction, citation and
approval machinery with the carrier rules (`DET-UNBILLED`, `DET-UNDERBILLED`) instead of the shipper rules. A
partner channel (for example an ELD or factoring company) could bring these buyers without a separate sales
motion; that channel is a business question, not an architecture one.

### 5.1 A source-cited detention packet for the carrier who is owed money

#### The gap

Carrier-side tools (Hey Bubba, FleetOptos, Detention Source) record geofence arrival and departure and stop at
the timestamp; freight audit and payment firms do not sell to carriers. The demand evidence is about proof. ATRI
reports that 94.5 percent of fleets charge detention but are paid on "fewer than 50 percent of those invoices",
and drivers on a public forum describe writing arrival and departure times on the freight bill by hand so a
claim survives.

Source: American Transportation Research Institute, release of 10 September 2024, https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, accessed 2026-10-17
Source: TheTruckersReport forum, "What's the #1 reason your detention claims get denied", https://www.thetruckersreport.com/truckingindustryforum/threads/whats-the-1-reason-your-detention-claims-get-denied-poll.2529156/page-3, accessed 2026-10-17

#### The mechanism in this codebase

The packet is a chain of pointers from every dollar back to a byte range in a document the customer uploaded,
sealed so that what a person approved is provably what goes out.

1. **Every extracted value keeps its location.** `extracted_fields` stores `page`, `line`, `start_col`,
   `end_col`, `source_row` and an `excerpt` next to the value (`api/prisma/schema.prisma`; parsers in
   `api/src/imports/parse/`). The original file is stored with its `sha256`.
2. **People correct values without erasing history.** Confirm, correct and add actions write
   `import_review_decisions` with before and after hashes; a second person must accept the document
   (`api/src/imports/review-service.ts`, ADR 0005).
3. **Rules show their arithmetic.** `packages/shared/src/analysis/detention.ts` and `invoice-checks.ts` produce
   findings with a rule id, a step-by-step `calculation` and a trace of the fields they used. The carrier
   perspective has its own rules (`DET-UNBILLED`, `DET-UNDERBILLED`), so detention earned but never billed is a
   finding, not a footnote.
4. **The packet stores the pointers.** `api/src/claims/analysis.ts` turns each trace into `packet_findings.citations`
   and governing-clause fields (`clause_source_id`, `clause_excerpt`, `clause_locator`), lists the documents in
   `packet_sources` with their hashes, and orders appointment, arrival and departure in `packet_timeline_events`.
5. **Approval binds to content.** Approve records a canonical content hash; send-ready recomputes it and refuses
   on any difference (`api/src/claims/content-hash.ts`, ADR 0007).

Where the code stops short of the gap: there is no geofence or ELD log intake, a lumper receipt is only an
`OTHER` document with no rule that reads it, and extraction reads `Key: Value` text, so a real carrier PDF
with a free-form layout will extract little until a layout-aware or OCR provider exists (ADR 0008). The
two-sided version for brokers (Gap 4) needs a shareable, read-only packet view, which does not exist.

#### Why it is hard to copy

Nothing here is secret, and a funded team could rebuild it. The barrier is that the packet needs four things
that today live in different companies' products: document extraction with locations, contract-term rules,
a human review workflow with separation of duties, and a tamper-evident approval record. Tracking vendors would
have to add document intake and contract reading; audit firms would have to sell to the party they audit against.
The research names exactly these two stopping points as the reason the gap is open. The part a copier cannot
take quickly is the exact-parity test net around the money rules (ADR 0003): every rule change is checked
string-for-string against an independent implementation, which is slow to build and quick to lose.

#### Buyer it converts, and how we would measure it

The buyer is the owner or office manager of a 5 to 100 truck carrier who has ELD data and no one to turn it into
a claim. In a design-partner pilot we would measure, on the partner's own closed loads:

- **Citation coverage:** the share of packet findings whose every input field resolves to a stored source span.
  Computed from `packet_findings.citations` and `extracted_fields`; no baseline exists, so the pilot sets it.
- **Correction rate:** reviewer `CORRECT` actions per extracted field, by field key, from `import_review_decisions`.
- **Time to send-ready:** hours from the first upload to the `SEND_READY` approval, from `import_documents` and
  `approvals`.
- **Paid share of detention claims:** the outcome that matters, compared with the partner's own paid share for the
  same lanes before the pilot. This needs outcome recording (gap G1 in `docs/exec-dashboard-spec.md`) before it
  can be measured at all.

### 5.2 Broker detention terms as reviewed, cited data

#### The gap

Detention terms are not standard. Free time, hourly rate, cap, notice rules and disqualifying conditions differ
by broker and shipper and live in rate confirmations and broker policies. A carrier quoted on a public forum
was told by a broker that there is "no standard", then received a written refusal citing "company policy". The
one carrier-side competitor that mentions rules, FleetOptos, describes "contract-specific billing rules (free
time allowances, hourly rates)", which reads as hand configuration.

Source: TheTruckersReport forum, "Broker doesn't want to pay / one of those days", page 2, https://www.thetruckersreport.com/truckingindustryforum/threads/broker-doesn%E2%80%99t-want-to-pay-one-of-those-days.2519612/page-2, accessed 2026-10-17
Source: Geotab Marketplace, FleetOptos listing, https://marketplace.geotab.com/solutions/fleetoptos/, accessed 2026-10-17

#### The mechanism in this codebase

We treat a contract term as an extracted, reviewable value with a source location, not as a setting someone types
into an admin screen.

1. **Terms are extracted fields.** The rate-confirmation vocabulary includes `detention_free_hours`,
   `detention_rate_per_hour`, `detention_max_hours`, `authorized_accessorials`, `linehaul_rate` and
   `fuel_surcharge` (`api/src/imports/parse/deterministic.ts`). Each lands in `extracted_fields` with its span
   and goes through the same confirm, correct and four-eyes accept flow as section 5.1 and I1.
2. **The calculation reads the confirmed terms.** `packages/shared/src/analysis/detention.ts` starts the clock at
   the later of appointment and arrival, applies the extracted free time and cap, and writes every step into the
   finding. A second, tariff-shaped calculator (`computeTariffDetention` in `analysis/tariff-detention.ts`)
   handles tiered terms; it is pure and tested but **not yet wired** into analysis.
3. **Unfamiliar charge wording is learned per team, safely.** When an invoice line does not match the keyword
   rules, the `charge-knn-v1` classifier (`packages/shared/src/charge-intel/`) compares it with labelled examples
   and the team's own labels (`charge_labels`). These suggestions only ever add review items; they never change a
   rule's dollar output and never reach the letter, and their authors are excluded from approving the claim
   (`label_author`, ADR 0005).

Where the code stops short of the gap: terms are extracted per load, not kept as a per-broker policy that the
next load can reuse; disqualifying conditions and notice requirements (for example "no detention if the driver
left before loading") are not modelled; and extraction only recognises labelled `Key: Value` lines today.

#### Why it is hard to copy

The data shape is easy to copy. What takes time is coverage: the many ways brokers phrase free time, caps and
exclusions, with each phrasing tied to a confirmed value. That library only grows from real rate confirmations
that reviewers have corrected, and the review trail (`import_review_decisions`) is what would let us build it
without storing anyone's document text in a shared corpus. We have none of that data yet, so today this is a
design advantage, not an asset.

#### Buyer it converts, and how we would measure it

The buyer is the same carrier, specifically the person who prepares claims and today re-reads every rate
confirmation. Pilot measures, on the partner's own documents:

- **Term extraction rate:** the share of rate confirmations where all three detention terms are extracted, and the
  share of those a reviewer confirms unchanged rather than corrects, per term.
- **Setup time per new broker:** minutes from a first rate confirmation to a confirmed term set, against the
  partner's current process. We make no claim about this number until it is measured.
- **Disputed-term rate:** the share of claims where the payer contests the term itself rather than the times,
  recorded once outcome tracking (G1) exists.


### 5.3 One packet the broker can use on both sides of the load

Market-researcher's Gap 4: two-thirds of brokers in a DAT survey paid detention only when they could collect it
from the shipper, so a packet that travels carrier to broker to shipper has a use. The same survey found only 20%
of 50 brokers ranked detention a top-five problem, so demand is mixed. The code has no shareable, read-only packet
view across tenants; building one would cross the tenant boundary (ADR 0002) and needs its own design.

Source: DAT Solutions, 14 July 2016, https://www.dat.com/company/news-events/news-releases/63-percent-of-drivers-are-detained-for-more-than-3-hours-per-stop-dat-solutions, accessed 2026-10-17

## 6. Hypotheses without outside demand evidence

Market-researcher found no independent source asking for the following. We keep them out of the pitch until buyer
interviews support them.

- **Four-eyes approval on outgoing disputes** (ADR 0005). It is built and enforced in the database. Whether a small
  carrier values a second-person gate, or sees it as friction for a one-person office, is unknown.
- **Cost outlook** (`packages/shared/src/outlook/`). A forecast of fuel and freight cost from public FRED series;
  no buyer has asked for it. (The fuel-surcharge *check* is part of I1; the size of fuel-surcharge errors is still
  sourced only from vendor blogs.)
- **Priority scoring** (`priority-v1`). A fixed, documented formula; no buyer has asked for it.
- **A dispute-outcome data moat.** It does not exist: the schema records nothing after send-ready (ADR 0007), and
  there is no claim volume. Building G1 is the precondition for this hypothesis to become testable.

## 7. What we will not claim

We do not claim accuracy, recovery rates, time savings or security in production. The eval gates run on synthetic
fixtures and are regression checks, not accuracy measures. Every number in this thesis is either a sourced market
figure or a metric we would measure in a pilot.
