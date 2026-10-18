# scoup.ai business plan

> **Status, stated once and meant everywhere below.** The product, scoup.ai (repository name `freight-recovery`), is pre-product. It runs on synthetic data only, has never been deployed, has no customers and has no revenue. No accuracy, security or recovery rate in this plan has been measured on a real claim. Every forward figure is a plan output from `financial/model.xlsx` (owner: `finance`) or arithmetic on stated inputs from `research/` (owner: `market-researcher`), and each one points at the file and line it came from. Where we could not trace a number, we say `UNKNOWN — needs primary research`.
>
> Date: 2026-10-17. Author: founder (Marius Carlsson). Supersedes the 1,398-word plan and the 5,553-word investor brief in the main checkout; section 15 lists what changed.

**How to read the references.** A reference such as `financial/scenarios.md` § "Headline comparison" means that section of the file, as frozen for this package on 2026-10-18. Paths are relative to the package: `research/` (`fr-wt/research/research/`), `financial/` (`fr-wt/finance/financial/`), `marketing/` (`fr-wt/marketing/marketing/`), `marketing/digital/` (`fr-wt/digital/marketing/digital/`) and `architecture/` (`fr-wt/architecture/docs/architecture/`, with ADRs, `docs/innovation-thesis.md` and `docs/exec-dashboard-spec.md` in `fr-wt/architecture/docs/`). Code references point at `ventures/freight-recovery-build` at commit `ed3d126` (branch `feat/hardening`), which does not change, so they keep line numbers.

## 1. Executive summary

Mid-size US importers pay container demurrage and detention (D&D) invoices they have a legal right to dispute, and mid-market shippers spend accounting hours checking truck accessorial charges by hand. Since 28 May 2024 the Federal Maritime Commission's billing rule has said that a D&D invoice failing its content and timing requirements relieves the billed party of the obligation to pay, and gives the billed party 30 calendar days to dispute. The nine largest ocean carriers collected about $15.4B in D&D charges between April 2020 and March 2025, or $3.08B a year (our arithmetic: $15.4B / 5).
Source: Thompson Hine, "FMC Issues Final Rule on Billing Requirements and Practices for Detention and Demurrage Invoices", https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17
Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17

On the truck side the documented pain is workload, not fraud. In RXO's November 2024 survey of 750 shippers and carriers, "61% of shippers agree that managing accessorial requests is one of the biggest time-wasters for their accounting team", yet 70% think carriers are usually honest and 67% think they pay the industry standard. RXO is a freight broker, not a neutral party, and no independent source measures how often accessorial lines are wrong (`research/04-gaps.md`, Gap 5).
Source: RXO, "What Shippers & Carriers Really Think About Trucking Accessorials (Original Research)", https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17

We have built software that turns an invoice and the documents behind it into a cited packet: each finding shows its arithmetic and points at the line of the document it rests on, and nothing counts as ready to send until a second person who did not prepare it has approved it. The best-evidenced part is the ocean D&D audit, which checks invoices against seven rules coded from the FMC rule and the customer's own tariff and tracks the 30-day window in the draft letter. The shipper audit checks each accessorial, fuel-surcharge and linehaul line against the shipper's own rate confirmation and fuel table. The TypeScript platform has 97 API routes, PostgreSQL row-level security on 26 tables, a hash-chained audit log and 136 acceptance test files (section 12). It has run only on synthetic data. It does not yet send anything, record what a counterparty paid, or read free-layout documents, and section 3 marks those gaps as roadmap.

Our core buyers, by the owner's decision of 2026-10-17, are mid-size importers (around 2,000 TEU, or about $67.5M of containerized imports a year) and mid-market shippers with $5M to $50M of freight spend; many companies are both. Carriers come later through factoring and broker partners. Research sizes the serviceable market at $945.4M a year across 32,765 accounts (19,932 modelled mid-market shippers and 12,833 mid-size importers, the most the FMC D&D pool can support); the base plan needs 1.8% of those accounts by year 7 (section 6). This is the contested side of the market: Loop has raised $160M and is buying mid-size books of business, Intelligent Audit sells Catalyst to smaller shippers (parcel first), and BlueCargo sells D&D disputes to large importers (`research/01-competitors.md`). We compete only where the buyer wants no fee until money is found, no integration for the pilot, truckload, LTL and D&D lines rather than parcel, and a line-by-line reason before it short-pays (section 7). Whether shippers will pay to have accessorial review taken off AP's desk is the main question the pilots must answer; the lead pilot measure is AP time per invoice, before and with the product, and we claim no figure until it is measured.

We are raising a **$7.0M seed in two tranches**: $4.0M at close and $3.0M at about month 23, released only when five customers pay, recovery is measured on real invoices, ARR passes $0.5M and acquisition cost has been measured (`financial/use-of-funds.md` § "The raise"). In the base case revenue reaches $16.91M in year 7 on 805 accounts (304 shippers, 301 importers and 200 carriers through a partner), average monthly net burn peaks at $188.6K in year 4, and EBITDA turns positive in year 6 (`financial/scenarios.md` § "Headline comparison"; `financial/budget.md` § "Net burn by year (base case)"). The base case rests on one assumption that outside evidence contradicts: it spends $0.73 of sales and marketing per $1 of new direct ARR, against a Benchmarkit 2024 median of $2.00, and our digital-marketing review found benchmark paid channels convert leads to customers at about one sixth of the rate we assumed (section 7). At the median the plan would need $38.49M of equity rather than $9.80M; at the sourced pessimistic cost of $31K per customer it would need a $9.98M seed and $18.67M of equity (`financial/scenarios.md` § "Sensitivities on the base case"). We show these problems in the open, and the tranche structure exists so that acquisition cost is measured on real pilots before most of the money is spent.
Source: Benchmarkit, 2025 SaaS Performance Metrics, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-17
Source: Metadata.io, 2026 B2B Paid Media Benchmark Report, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17

## 2. The problem

> The owner set the plan to shipper- and importer-first on 2026-10-17: mid-market shippers and mid-size importers are the core segments, and carriers are a later, partner-led channel.

### Who has it

Two groups pay for freight they should not, and both sit below the audit programmes that the largest shippers buy. The first is the mid-size US importer paying ocean carriers, terminals and forwarders for containers that sat past their free days. The finance model's example importer brings in about 2,000 TEU a year, which research values at about $67.5M of containerized imports ($33.7K per TEU on 2023 BTS and S&P figures). No public source counts importers by container volume; the Census Bureau counts by employment, and the plausible range for importers of this size is 4,160 (the 250-to-499-employee class) to 20,279 (all importers with 100 or more employees). Research notes that this profile is closer to a Census "large" importer than to a typical small one (`research/02-industries.md` § "Ocean importers paying container demurrage and detention" (bullet "Importers by size")).
Source: U.S. Census Bureau, "A Profile of U.S. Importing and Exporting Companies, 2023-2024", release CB26-73, 5 May 2026, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17
Source: Bureau of Transportation Statistics, containerized vessel imports 2023, as cited in `research/02-industries.md` § "Ocean importers paying container demurrage and detention" (bullet "Importers by size")
Source: U.S. Census Bureau, "A Profile of U.S. Importing and Exporting Companies, 2023-2024", release CB26-73, 5 May 2026, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17

The second is the mid-market shipper with $5M to $50M of annual freight spend: a manufacturer, distributor or retailer whose accounts-payable team receives carrier invoices carrying detention, lumper, liftgate, reweigh and redelivery charges on top of the agreed rate, and pays most of them without checking them against the rate confirmation (`research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)"). Many of these companies are both: they import containers through a port and then move the goods by truck. Nobody publishes how many such shippers exist; research models 19,932 of them from Census revenue classes and a 2008 freight-to-sales ratio, a count that ranges from 9,366 to 35,349 as that ratio moves (`research/05-market-size.md` § "2. Counts of buyers"; section 6). A third group, the small carrier owed detention it never collects, has the problem from the other side; we come to it as a channel in section 7.

### How often it happens

For importers the frequency shows in dispute volume. Harbor Trucking Association members disputed more than 3 million detention and demurrage charges in 2020, and 65% of surveyed members said the most common reason was "no available appointments".
Source: Supply Chain Dive, Harbor Trucking Association survey coverage, https://www.supplychaindive.com/news/detention-demurrage-port-congestion-fees-Harbor-Trucking-Association-TradeLanes/594406/, accessed 2026-10-17 (`research/04-gaps.md` § "Gap 3")

Since 28 May 2024 every one of those invoices is also a compliance question. Under the Federal Maritime Commission's billing rule, "Failure of the billing party to abide by the invoice content and timing requirements relieves the billed party's obligation to pay an invoice for detention and demurrage charges", and the billed party has 30 calendar days from issuance to request mitigation, refund or waiver. A September 2025 D.C. Circuit decision vacated only the section on who may be billed; the content and dispute provisions stand.
Source: Thompson Hine, "FMC Issues Final Rule on Billing Requirements and Practices for Detention and Demurrage Invoices", https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17
Source: Thompson Hine, 26 September 2025, https://www.thompsonhine.com/insights/court-sets-aside-part-of-fmcs-demurrage-and-detention-billing-rule/, accessed 2026-10-17

For truck accessorials on the shipper side, the best independent evidence measures workload rather than error. RXO, a freight broker with no audit product to sell (but not neutral either), surveyed 750 shippers and carriers in November 2024: "61% of shippers agree that managing accessorial requests is one of the biggest time-wasters for their accounting team", 65% see a moderate and 19% a significant impact on their freight budget, and 71% are actively working to reduce accessorial spend. The same survey cuts against an overcharge pitch: "70% of shippers agree that carriers are usually honest when requesting accessorials", only 8% saw outright dishonesty, and 67% think they pay the industry standard (`research/04-gaps.md` § "Gap 5").
Source: RXO, "What Shippers & Carriers Really Think About Trucking Accessorials (Original Research)", https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17
How often those lines are actually wrong is not measured anywhere independent we could find; the 3% to 10% of invoices and 1% to 9% of spend that circulate trace back to audit vendors and stay grade C (`research/04-gaps.md` § "Gap 5"). So the shipper problem we can document is the hours spent checking each accessorial and fuel line against the terms; the money recoverable from that checking is an assumption.

### What it costs today

At the top line, the nine largest ocean carriers collected about $15.4B in D&D charges between April 2020 and March 2025, an average of $3.08B a year (our arithmetic: $15.4B / 5), and detention cost US trucking $15.1B in 2023, most of it lost productivity rather than invoiced charges (`research/05-market-size.md` § "1. Why the headline numbers are not the TAM"). Neither figure is our market; both show how much money moves through the invoices we check.
Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17

For one account the finance model uses a single worked example, and every percentage in it is a guess. A mid-size importer-shipper bringing in 2,000 TEU a year faces $240K of D&D charges; if 15% of them are non-compliant or wrongly calculated, it is paying $36K it could dispute, and fuel-surcharge overbilling on its truck freight adds $16K, for $52K a year (`financial/assumptions.md` § "The inputs that move the answer most"; `research/05-market-size.md` § "3. Revenue per account: the finance model’s path"). For a truck-only shipper, research's cross-check starts from the band's average freight spend of $9.53M: at 1% recoverable, the low end of audit vendors' own 1% to 9% claims (grade C), that is about $95.3K a year (`research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)"; `research/05-market-size.md` § "5.1 Shippers: does the model’s recovery path fit?"). Finance takes a more cautious path for shippers: $16K of fuel-surcharge and $24K of assumed accessorial and detention recovery, $40K in year 1, or 77% of the importer amount (`financial/assumptions.md` input `shp_mult`).

Today that money is lost in three ways. AP pays the invoice because nobody has time to compare it with the rate confirmation or the tariff. A logistics manager disputes the largest items by email, without the clause or the calculation attached, and misses the 30-day window on the rest. Or the company buys an enterprise audit programme priced for spend it does not have. None of the three produces a dispute the carrier or terminal must answer on the evidence.

The numbers that decide whether this is a business are the 15% non-compliant share, the 1.0% recoverable share and the $52K importer and $40K shipper recoveries. None has been measured, and the first job of the design-partner phase is to replace them with figures from a partner's closed invoices (`research/05-market-size.md` § "6. What would change these numbers most").

## 3. The product as built, screen by screen

Everything in this section describes code that exists at commit `ed3d126` and has run only on synthetic fixtures, locally (`architecture/overview.md` § "8. What is not verified"). Items that do not exist carry the label **Roadmap**. The product is a React 19 web app over a Fastify 5 API and PostgreSQL 16, with the money arithmetic in a shared TypeScript package and the original Python core kept as the reference the TypeScript engines must match exactly (`architecture/overview.md` § "1. System context", ADR 0003). One design decision shapes every screen: all money arithmetic is deterministic rule code, and there is no trained model and no LLM call at runtime (ADR 0008). Each finding carries a rule id, an amount, a step-by-step calculation and a flag saying whether a human must review it. We chose this so that a payer's dispute team asking "how did you get this number" gets the same answer every time.

### Sign-in and account security (`/login`, `/login/mfa`, `/forgot`, `/reset`, `/invite`)

Staff sign in with a password hashed by argon2id and, for owners, admins and platform roles, a mandatory TOTP second factor. Access tokens live ten minutes and are held in memory only; the refresh cookie is `HttpOnly`, `Secure` and `SameSite=Strict`, and a reused refresh token revokes its whole family. Five failed logins start a lockout that doubles up to 15 minutes (`architecture/overview.md` § "5. Authentication and authorisation"). Invites, password recovery and user management sit behind the same pipeline. Machine clients use scoped tenant API keys, which 9 of the 97 routes accept (`architecture/api-surface.md` § "1. Summary").

### Import and document review (`/import`, `/import/review`)

A user uploads rate confirmations, BOLs, invoices and similar files. The API sniffs the real file type and parses it in a separate child process with limits on time, memory, output, pages and pixels (`architecture/overview.md` § "6. Trust boundaries"). Extracted fields land in a review queue, where a reviewer confirms, corrects or rejects each field, sets the document type and accepts or rejects the document. The person who uploaded or edited a document cannot accept it. Accepted documents are then committed into claims (`architecture/api-surface.md` § "`api/src/imports/routes.ts`"). The honest limit: the only extraction provider today is deterministic and reads `Key: Value` text. Real carrier PDFs with complex layouts, scans and photos "will extract poorly until a layout-aware or OCR provider exists", which ADR 0008 calls "the largest functional gap between the codebase and a paying customer". **Roadmap:** an OCR or layout-aware extraction provider behind the existing provider interface, recorded per document and held to the same evaluation gates.

### Claims table and claim sheet (`/claims`, `/claims/:id`)

The claims table lists, searches, filters and sorts claims, and supports single and bulk analysis. Opening a claim shows a sheet with tabs for the evidence packet, analysis, linked documents and intelligence. Analysing a claim runs the detention and invoice-check engines and creates packet revision 1, which holds the findings, the source of every number, a timeline and an integrity hash (`architecture/api-surface.md` § "`api/src/claims/routes.ts`"). The packet includes a draft demand letter in Markdown. Editing a packet creates a new revision and returns the claim to review; earlier revisions are superseded, never overwritten (`architecture/data-model.md` § "4. Status machines"). The invoice checks classify each charge line, find duplicates and flag accessorials that the rate confirmation did not authorise (`packages/shared/src/analysis/invoice-checks.ts`).

### Approval queue (`/approvals`)

Every packet waits here for a person. Approval requires a written reason and the packet's current content hash, so nobody can approve a version they did not see. Anyone who authored any revision of the packet, set a team charge label that influenced its analysis, or entered the ocean invoice behind it cannot approve or reject it; the service checks this and a database trigger backs it up (`architecture/overview.md` § "5. Authentication and authorisation", migration `20261011000000_four_eyes`). After approval, "send" marks the packet send-ready only when the hash still matches. **It sends nothing.** No email, portal submission or payment leaves the system (`architecture/overview.md` § "6. Trust boundaries"). **Roadmap:** delivery of approved demands on the customer's own letterhead and channel, under customer-controlled send settings.

### Intelligence worklist (`/intelligence`) and charge suggestions

The worklist ranks open claims with `priority-v1`, a documented weighted sum of stored amounts, and each claim can show similar past claims (`similar-v1`) and a provenance summary. On a claim, `charge-knn-v1` compares charge names with labelled examples and suggests which lines look like accessorials; team labels refine it. These suggestions only add review items and never change a rule's money output (ADR 0008). CI checks the classifier against a seed set on every build, as a regression check and not an accuracy figure (`.github/workflows/web-ci.yml`, step "Charge classifier evaluation").

### Fuel tables and fuel check (`/settings/fuel-tables`)

A tenant enters its fuel-surcharge tables. For a claim with a ship date, miles and a table, the fuel check recomputes the surcharge and reports the difference from what was billed (`architecture/api-surface.md` § "`api/src/intelligence/fuel-routes.ts`").

### Cost outlook (`/outlook`)

The outlook page projects diesel and truckload price series from bundled public data. CI runs a walk-forward backtest on that data and fails the build if coverage falls outside 70% to 90% (`web-ci.yml`, "Cost outlook backtest gate"). This is a planning aid, and our research found no buyer asking for it (`research/04-gaps.md` § "Candidate gaps without outside demand evidence"), so we do not sell it.

### Ocean D&D (`/ocean`)

A user records D&D tariffs, terminal calendars and invoices, or imports them from CSV, and runs an audit. The audit applies seven rules (`packages/shared/src/ocean-dd/constants.ts`): total mismatch, period arithmetic, tariff overcharge, two checks under 46 CFR 545 (return refused, container availability), late issue under 46 CFR 541.7, and missing invoice content under 46 CFR 541.6. The audit creates an `OCEAN_DD` claim with packet revision 1 and a letter, which then goes through the same approval queue (`architecture/api-surface.md` § "`api/src/ocean-dd/routes.ts`"). An audited invoice becomes immutable (`architecture/data-model.md` § "4. Status machines").

### Exports and audit trail

Claims, packet findings and decision history stream out as CSV or XLSX with spreadsheet-formula neutralisation (`architecture/api-surface.md` § "`api/src/exports/routes.ts`"). Every change appends to a per-tenant SHA-256 hash chain in the same transaction, and a verify endpoint recomputes it (`architecture/overview.md` § "7. Audit trail").

### What is not built

These are the gaps between the codebase and the product the pitch describes, and each is **Roadmap**:

- **Dispute deadlines for truck claims.** No column stores a filing deadline or dispute window; only the ocean engine knows the 30-day minimum of 46 CFR 541.8(a) (`architecture/data-model.md` § "5. What the schema does not hold").
- **Outcomes after send-ready.** Nothing records that a demand went out, what the counterparty answered or what it paid, so "dollars recovered" cannot be computed from the system today (`architecture/data-model.md` § "5. What the schema does not hold").
- **Billing.** No plan, subscription, invoice or contingency-fee table exists (`architecture/data-model.md` § "5. What the schema does not hold").
- **Executive summary page.** Specified in `docs/exec-dashboard-spec.md`, not built (`architecture/overview.md` § "2.3 Web app (`web/src/`)").
- **Telematics and TMS integrations**, so geofence timestamps arrive automatically rather than by upload.
- **Deployment.** The AWS Terraform has passed `fmt` and `validate` only and has never been applied (`architecture/overview.md` § "2.5 Infrastructure (`infra/`)").

## 4. Competitive landscape

Market-researcher profiled nine companies in three groups, and the full entries with sources are in `research/01-competitors.md`. We summarise them here by what each one would mean to a buyer comparing us. Pricing is published by none of the nine (`research/01-competitors.md` each company's "Pricing tiers" line); we did not estimate any.

**Freight audit and payment (FAP) firms, selling to shippers.** Loop (founded 2021, San Francisco) has raised $160M, including a $95M Series C on 17 April 2026, bought Data2Logistics and StrategIQ Commerce in 2025, and names Michael Kors, General Mills and Macy's as customers; an analyst estimate puts its annualised revenue at $44M in March 2026, which we treat as grade C (`research/01-competitors.md` § "Loop"). Cass Information Systems (founded 1906, St. Louis, public on Nasdaq) processed $36.5B of transportation spend in 2025 on its own filings (§ "Cass Information Systems"). Trax (Irving, Texas) sells global audit to multinationals and bought EM6 in Europe in November 2025 (§ "Trax Technologies"). CTSI-Global (Memphis) and nVision Global (Atlanta area) are services-led; CTSI's headcount of roughly 220 has barely changed since 1999 (§ "CTSI-Global"), and nVision states it manages more than $7.3B of freight spend (§ "nVision Global"). Intelligent Audit (Rochelle Park, New Jersey) prices by subscription and launched Catalyst in June 2025 for shippers under $10M a year, parcel first (§ "Intelligent Audit"). The pages of all six describe auditing invoices against contract rates and paying carriers. None describes building a counterparty-ready dispute for one accessorial, and none sells to carriers (§ "What the set tells us").

**The ocean D&D specialist.** BlueCargo (founded 2018, $11M round in 2023) audits container fees at US ports, markets "Dispute resolution with evidence-backed documentation" and checks invoices "against OSRA invoice requirements", and claims "$350M+ in Detention & Demurrage Savings" and "95% Dispute Success" (vendor claims, grade C). Its customers include GE Appliances, Samsung, Flexport and J.B. Hunt (`research/01-competitors.md` § "BlueCargo"). It is the strongest competitor to our ocean module and we do not pretend otherwise.

**Carrier-side detention tools.** Hey Bubba records dwell time from ELD geofences, captures detention terms at booking and notifies the broker while the truck is still at the dock, connecting to "100+ ELDs" (vendor page); its core product is an AI voice dispatcher (§ "Hey Bubba (Bubba AI)"). FleetOptos, on the Geotab marketplace, "applies contract-specific billing rules (free time allowances, hourly rates)" and has zero reviews (§ "FleetOptos (Calcutiv LLC)"). Detention Source is an iOS geofence app with no verified company details (§ "Adjacent, not profiled in full"). These tools capture the clock and stop at the claim line.

**Adjacent.** Portcast (Singapore, $6.5M Series A in November 2024) is a container visibility platform with a D&D validation module (§ "Adjacent, not profiled in full"). project44, FourKites and TMS-embedded audit modules were not re-verified this session and sit in market-researcher's open questions (§ "Adjacent, not profiled in full").

The research feature matrix (`research/03-feature-matrix.md`) records, cell by cell, which of these firms document each capability. The pattern it shows is the one this plan has to work against: the shipper-side firms have scale, capital and customers in the segment we now lead with, and they sell audit and payment rather than a cited dispute per charge; the carrier-side tools serve the party owed the money but stop at the timestamp. The two firms most able to close our gap from above are Loop, because of its capital, and Intelligent Audit, because it is already moving down-market (`research/01-competitors.md` § "What the set tells us"). Hey Bubba already sells detention capture to small carriers, the segment we will reach later through partners, and we treat it as a likely integration partner rather than a rival (`research/01-competitors.md` § "Hey Bubba (Bubba AI)").

## 5. Our advantage

Our advantage is narrow, and we state it at the width we can defend. The architect's innovation thesis, revised for the shipper- and importer-first plan, names three mechanisms that exist in the code today and ranks them by the strength of the outside evidence behind the gap each one answers (`docs/innovation-thesis.md`, section 1). None has been measured on a real invoice.

**I1. An accessorial and surcharge audit against the shipper's own contract terms, ending in a cited short-pay packet.** Every claim carries a shipper or carrier perspective, and six deterministic shipper rules look for money billed above what the contract supports: linehaul above the rate confirmation (`INV-LINEHAUL-RATE`), a wrong fuel surcharge (`INV-FUEL-SURCHARGE`), an accessorial not on the confirmation's authorised list (`INV-ACCESSORIAL-UNAUTH`), a duplicate line (`INV-DUPLICATE`), a total that does not add up (`INV-TOTAL-MISMATCH`) and detention billed beyond what the appointment, arrival and departure times support (`DET-OVERBILLED`). The fuel check recomputes the surcharge from the shipper's own table and the public weekly diesel price for the ship date, with the price series' provenance recorded. Each finding carries its arithmetic in exact decimals and points back to the invoice line and the rate-confirmation field it rests on, and approval binds to a content hash, so the AP team can short-pay or dispute with the evidence attached (`docs/innovation-thesis.md`, section 2). The competitive gap is documented: Loop sells to enterprise accounts, Intelligent Audit's smaller-shipper product is parcel-first, and CTSI-Global and nVision Global are services-led. Research has since found independent demand evidence, and it reshapes the pitch: in RXO's 2024 survey, 61% of shippers call accessorial requests one of their accounting team's biggest time-wasters, but 70% think carriers are usually honest (`research/04-gaps.md`, Gap 5). We therefore sell I1 as taking accessorial review off AP's desk, not as catching carriers overbilling. Its lead pilot measure is AP time per invoice: minutes the partner's accounting team spends verifying one invoice's accessorial and fuel lines, timed before the pilot and measured with the product from upload to a decided packet; we state no figure until it is measured (`docs/innovation-thesis.md`, I1, "Buyer it converts"). The size of the recoverable overcharge stays an assumption, 1% of freight spend, until design partners' invoices replace it.

**I2. A regulation-coded ocean D&D audit for mid-size importers.** The FMC rule is code with a pinned eCFR version and seven named rules, checked against the customer's own tariff and terminal calendar. An audit freezes the invoice, creates a claim with citations, the CFR clauses, a timeline and a draft letter that reminds the sender of the 30-day window, and a CSV import takes up to 50 invoices at a time, so an importer needs no integration to start (`docs/innovation-thesis.md`, section 3). This has the strongest outside evidence of the three: the FMC's own figures, a law-firm analysis of the rule and a trade-association survey of 3 million disputed charges (`research/04-gaps.md` § "Gap 3"). BlueCargo sells the same checks to large importers; we found nobody packaging them for the mid-size importers below BlueCargo's customer profile. Research sizes this as a feature that wins the importer account rather than a business on its own (`research/02-industries.md` § "Ocean importers paying container demurrage and detention"). One finding changes the delivery: a forwarder acting as an NVOCC is often the billing party, and CastleGate Forwarding, for example, takes D&D disputes "by entering a ticket through our website in Partner Home". The code already treats the billing party as data, so a forwarder's invoice audits the same way; routing the packet into a forwarder's ticket system does not exist (`docs/innovation-thesis.md`, I2, "Who receives the dispute").
Source: CastleGate Forwarding, Regulatory, https://castlegateforwarding.com/resources/regulatory, accessed 2026-10-17

**I3. One claims queue for the same shipper's truck and ocean charges.** Freight claims and ocean D&D claims share one table, the same packet structure, the same approval state machine and content-hash binding, the same four-eyes rules, the same per-tenant audit chain, the same exports and the same worklist (`docs/innovation-thesis.md`, section 4). For a controller who must answer for every short-payment, that is one record instead of two vendors. No competitor we profiled ties the D&D dispute window into a workflow that also handles truck charges for the same shipments (`research/04-gaps.md` § "Gap 3"), but we have no buyer quote asking for it, and the architect calls it "a retention argument more than a moat". Claims of the two kinds are not yet linked to a common shipment; "the same shipment" is a human association today.

**Later segment.** The carrier-side mechanisms, a cited detention packet for the carrier who is owed money, broker detention terms as reviewed data and a packet a broker can use on both sides of a load, keep their research backing (Gaps 1, 2 and 4, the strongest outside demand evidence in the research) and move to the later, partner-led carrier channel (`docs/innovation-thesis.md`, section 5).

Three cautions keep this honest. First, the rules are not secret; what takes time is every dollar traceable to a byte range in the customer's own documents, a fuel check pinned to a public price series with provenance, an approval record nobody can argue was altered, and the exact-parity test net against an independent Python implementation (`docs/innovation-thesis.md`, section 2). Against enterprise audit firms our argument is price and fit for a team too small for a managed programme, and that argument has not been tested. Second, the code stops short in named places: extraction reads only labelled `Key: Value` lines; master agreements and multi-lane rate tables outside the rate confirmation are not modelled; lumper and reweigh receipts have no rule that reads them; and invoices with no finding are not recorded, so overcharge as a share of audited spend cannot be reported yet (gap G9 in `docs/exec-dashboard-spec.md`). Third, four-eyes approval as a selling point, the fuel-surcharge outlook and a dispute-outcome data advantage remain hypotheses without outside demand evidence (`docs/innovation-thesis.md`, section 6).

## 6. Market: TAM, SAM and SOM

Market-researcher's final sizing values each segment at finance's year-7 revenue per account for that segment: $27.6K for a shipper, $30.8K for an importer, $7,895 for a carrier, and an assumed $12,000 a year for a broker (`research/05-market-size.md` § 4). It replaces three earlier versions, and we use none of their figures (§ 5.4 of the same file). The account counts are sourced or modelled as stated below; every revenue input is assumed. We keep ATRI's $15.1B, the FMC's $15.4B and the $883.2B of US trucking spend out of the TAM, because they describe the problem, not revenue we could earn (§ 1 of the same file).

**Mid-market shippers: 19,932 accounts (modelled).** No public dataset counts US shippers by freight spend, so research built one. A shipper spending $5M to $50M on freight, at an average transportation cost of 4.68% of sales, has revenue of about $106.8M to $1.068B ($5M / 4.68% and $50M / 4.68%). The Census Bureau's Statistics of US Businesses counted 19,932 firms with $100M to $999.9M of receipts in manufacturing (5,971), wholesale (8,798) and retail (5,163) in 2022; their receipts total $4,057.4B, so their estimated freight spend is $189.9B, or $9.53M per firm (`research/05-market-size.md` § 2). The 4.68% ratio comes from a 2008 survey; at 2% the count would be 9,366 and at 10% it would be 35,349, which makes this the most fragile count in the plan.
Source: U.S. Census Bureau, Statistics of U.S. Businesses 2022, https://www2.census.gov/programs-surveys/susb/tables/2022/us_naicssector_large_rcptsize_2022.xlsx, accessed 2026-10-17
Source: DC Velocity, "Logistics costs and services 2008", https://www.dcvelocity.com/articles/31001-logistics-costs-and-services-2008, accessed 2026-10-17

**Mid-size importers: 12,833 accounts (capped).** At the model's $36K of D&D recovered per account, all 234,023 small and medium importers in the Census count would need $8.42B a year, 2.7 times the $3.08B the nine largest ocean carriers collect. Spread across accounts with the business case's $240K exposure, the pool supports $3.08B / $240K = 12,833 importers (`research/05-market-size.md` § 5.2). That cap falls inside research's public bound of 4,160 to 20,279 importers of the 2,000-TEU size the model describes (`research/02-industries.md` § "Ocean importers paying container demurrage and detention" (bullet "Importers by size")).
Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17
Source: U.S. Census Bureau, release CB26-73, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17

| Segment | Accounts | Year-7 revenue per account | Revenue at 100% | In |
|---|---|---|---|---|
| Mid-market shippers ($5M to $50M freight spend) | 19,932 | $27.6K | $550.1M | SAM |
| Mid-size importers, capped by the FMC D&D pool | 12,833 | $30.8K | $395.3M | SAM |
| **SAM** | **32,765** | | **$945.4M** | |
| Carriers, 5 to 100 power units (later, partner channel) | 72,053 | $7.9K | $568.9M | TAM only |
| Freight brokers (no evidence yet that they buy) | 28,438 | $12.0K (assumed) | $341.3M | TAM only |
| **TAM** | **133,256** | | **$1,855.5M** | |

Table and arithmetic: `research/05-market-size.md` § 4 (19,932 x $27.6K = $550.1M; 12,833 x $30.8K = $395.3M; 72,053 x $7,895 = $568.9M; 28,438 x $12,000 = $341.3M). Carrier and broker counts: FMCSA census file and FreightCaviar, with source lines in section 8.

**SAM: $945.4M a year, range $0.55B to $0.95B** (`research/05-market-size.md` § "4. TAM, SAM, SOM (the package numbers)"). Some mid-size manufacturers and wholesalers also import by container, so the two core groups overlap by an unknown amount; if every capped importer were also in the shipper count, SAM would fall to 19,932 accounts and $550.1M.

**TAM: $1.86B a year.** It adds the 72,053 carriers we will reach later through partners and the 28,438 brokers we have not tested. Counting all 234,023 small and medium importers instead of the 12,833 cap would add $6.81B, and we do not, for the reason above (`research/05-market-size.md` § 4).

**SOM: finance's base case.** By year 7: 805 accounts and $16.91M of revenue. Of these, 605 are direct accounts inside the SAM (304 shippers and 301 importers, $15.58M of revenue) and 200 are carriers won through a channel partner ($1.33M). The 605 direct accounts are 1.8% of the SAM's accounts (bull 2.6%, bear 0.7%), and their revenue is 1.6% of the SAM pool (bull 2.6%, bear 0.5%). By segment: shippers are 1.5% of the modelled count and earn 1.3% of $550.1M; importers are 2.3% of the cap and earn 2.1% of $395.3M; carriers are 0.3% of 72,053 (`research/05-market-size.md` § 4; `financial/scenarios.md` § "Market size and share of SAM").

**Cross-checks.** The average shipper in the band spends $9.53M on freight; at an assumed 1% recoverable it recovers about $95.3K a year, inside the model's $52K-to-$115K path, though a $5M shipper would recover $50K and a $50M shipper $500K at the same rate (`research/05-market-size.md` § 5.1). Finance's shipper path is more cautious: a shipper recovers 77% of an importer's amount because it has no ocean D&D, built from $16K of fuel-surcharge and $24K of assumed accessorial and detention recovery (`financial/assumptions.md`, input `shp_mult`).

**What would change these numbers most.** The freight-to-sales ratio behind the shipper count, the amount recovered per account and the fee path, the number of 2,000-TEU importers, and the overlap between shippers and importers (`research/05-market-size.md` § 6). Design partners' closed invoices can replace the recovery figures; a purchased firmographic list and bill-of-lading data can replace the counts.

## 7. Who we sell to and how

Marketing rewrote the go-to-market for the owner's decision (`marketing/gtm.md`, header note and sections 1-3). Because that file is still being revised, we cite it by section rather than line.

### Buyers

**Mid-market shippers (primary).** US manufacturers and distributors with $5M to $50M of freight spend, mostly truckload and LTL, paying carrier and broker invoices through AP with no audit programme or with one that does not argue disputed accessorial lines. The champion is the transportation or logistics director, the AP manager or controller uses and approves, and the CFO or VP finance is the economic buyer. Triggers include a freight-cost overrun at month-end close, a year-end audit questioning accessorial spend, a contract renegotiation, or a new controller asking why accessorials are paid without support (`marketing/gtm.md` § 2, Segment A).

**Mid-size ocean importers (primary, paired with shippers).** Manufacturers and wholesalers bringing in roughly 2,000 TEU a year (about $67.5M of containerized imports) that import in containers and receive D&D invoices from ocean carriers and terminals; many also ship domestically, and that overlap is the point. The champion is the import or logistics manager. The trigger is concrete: an invoice spike after congestion, an invoice missing required fields, or a 30-day dispute window about to close (`marketing/gtm.md` § 2, Segment B).

**Carriers (later, through partners).** Carriers move to a later phase, reached through factoring firms and brokers who can each bring many carriers at once. A founder selling one carrier at a time cannot reach 72,053 accounts, and research's carrier fee of $7,895 a year cannot carry paid acquisition (`marketing/gtm.md` § 2, Segment C; `marketing/digital/cac-targets.md` section "CAC ceilings"). Partner conversations may start in phase 3 to learn; signed partnerships come in phase 4 or later.

### Sales motion and price point

We sell a free review before we sell anything. A shipper shares three months of paid carrier invoices and the rate confirmations that authorised them; an importer shares the last 90 days of D&D invoices and gets a list of dispute deadlines. We return confirmed findings separated from items needing review, then offer a contingency pilot on new invoices. Nothing is disputed or short-paid without the customer's approval (`marketing/gtm.md` § 2). Pricing follows finance's model, the one price path in this plan: a 25% contingency on dollars recovered during pilots, then a recovery share falling to 17% in year 2, 14% in year 3 and 12% from year 4, alongside a platform fee of $6K a year in year 2 rising to $17K by year 7 (`financial/assumptions.md`, inputs `fee` and `share`). Both are assumptions; no freight competitor publishes its price (`research/01-competitors.md`), and the pilots will test them. Expected cycles are 8 to 16 weeks to a shipper pilot, because finance approves and security asks questions first, and 4 to 10 weeks for an importer, because the 30-day window creates urgency (`marketing/gtm.md` § 2). The founder sells until about the first 20 accounts (`marketing/gtm.md` § 1).

### Why the shipper segment is contested

We chose the harder market on purpose, and we should say how hard it is. On the carrier side no freight audit and payment firm sells at all; on the shipper side two funded firms already do (`marketing/gtm.md` § 1).

**Loop** has raised $160M, including a $95M Series C on 17 April 2026, and bought Data2Logistics and StrategIQ Commerce in 2025, which brings it mid-size books of business directly. An analyst estimate puts its annualised revenue at $44M in March 2026 (grade C) (`research/01-competitors.md` § "Loop"). It sells audit, payment and visibility on one platform, and it is the company best placed to build exactly what we build.

**Intelligent Audit** launched Catalyst in June 2025 for companies shipping under $10M a year, with "a free trial for 90 days" followed by one of three plans whose prices are not published; its main offer is "a subscription model based on annual shipment volume, modes, and # of carriers". Catalyst is parcel-first (`research/01-competitors.md` § "Intelligent Audit"). It is the incumbent moving down-market most actively (`research/01-competitors.md` § "Intelligent Audit").

On the importer side **BlueCargo** checks invoices "against OSRA invoice requirements", sells "Dispute resolution with evidence-backed documentation", claims "1 in 5 Top US Shippers" and "95% Dispute Success" (vendor claims, grade C), and names GE Appliances and Samsung as customers (`research/01-competitors.md` § "BlueCargo").
Source: Intelligent Audit, FAQ, https://www.intelligentaudit.com/faq, accessed 2026-10-17
Source: AlphaMaven, "Loop raises $95M Series C", https://alpha-maven.com/story/venture-capital/loop-raises-95m-series-c, accessed 2026-10-17
Source: BlueCargo, home page, https://www.bluecargo.io/home-tests, accessed 2026-10-17

### How we win there

We do not try to out-feature them. Marketing's rule is to win deals where four conditions hold and walk away where they do not: the buyer wants no platform fee until money is found; the buyer cannot or will not connect a TMS or ERP feed; the pain is disputed truckload or LTL accessorials and D&D lines rather than parcel or payment processing; and the buyer wants to see, line by line, why a charge is wrong before short-paying it (`marketing/gtm.md` § 3). Against each competitor that becomes a specific position:

- **Against Loop, coexist.** "Keep your audit and pay process. Send us the lines you are unsure about." No platform fee before money is found, no integration for the pilot, and a per-line evidence packet for each disputed charge (`marketing/gtm.md` § 3). A shipper already paying an audit vendor can add us for the disputes that vendor does not argue.
- **Against Catalyst, specialise.** We say plainly that a parcel-heavy shipper may be better served by Catalyst. We sell contingency instead of subscription, to truckload and LTL shippers and to those above the $10M Catalyst line who find an enterprise programme too heavy (`marketing/gtm.md` § 3).
- **Against BlueCargo, go smaller and wider.** SME importers below its customer profile, and one workflow covering container D&D and the truck charges on the same shipments; whether importers want those combined is untested (`marketing/gtm.md` § 3; `research/04-gaps.md` § "Gap 3").

Three things could still beat us. Loop could ship a dispute module with its capital and installed base; Intelligent Audit could extend Catalyst from parcel to truckload accessorials; and a buyer may simply prefer a known brand to a pre-product vendor. Our response is speed on the narrow wedge, a quarterly re-check of every competitor's own pages, and evidence: anonymised results from design partners who agree to share them (`marketing/gtm.md` § 5). We will tell investors if either incumbent announces a cited-dispute product, because it would narrow our advantage to speed and the parity-tested rule base.

### Message

The message rests on three brand pillars, in this order: **Proof attached** leads; **A person decides** answers the trust objection; and **Built for the loads big audit programs skip** positions us against the incumbents (`marketing/marketing-plan.md` §§ 2-3). For shippers, marketing switched the lead to workload, following the RXO evidence: "Take accessorial review off AP's desk. Every line checked against the rate confirmation, with the source attached." The overbilling line ("carriers are overbilling you") survives only as an A/B alternate, because 70% of shippers in the same survey think carriers are usually honest (`research/04-gaps.md`, Gap 5). For importers the lead is the rule and the clock: check every D&D invoice against the FMC requirements before the 30-day window closes. The proof we offer today is a synthetic sample packet with the arithmetic printed step by step. The lead pilot measure for shippers is AP time per invoice, before and with the product (`docs/innovation-thesis.md`, I1); we claim no figure until it is measured. We do not describe any result as money recovered by the product: the system records nothing after a packet is marked send-ready (`docs/exec-dashboard-spec.md`; `architecture/data-model.md` § 5).

### The acquisition-cost problem, stated plainly

The digital-marketing team tested our funnel assumption against the best outside benchmark we have, and it did not hold. Our plan assumes 2.1% of leads become paying accounts (20% to a qualified call, 35% of those to a free review, 50% to a pilot, 60% to paying). Metadata's 2026 benchmark reports a LinkedIn cost per lead of $202 and a cost per customer of $58,572, which implies a lead-to-customer rate of 0.345%, about one sixth of ours (`marketing/digital/cac-targets.md` § "Funnel assumptions").
Source: Metadata.io, What LinkedIn ads cost, https://metadata.io/resources/blog/what-linkedin-ads-cost, accessed 2026-10-17
Source: Metadata.io, 2026 B2B Paid Media Benchmark Report, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17

Shipper-first does not escape this; it changes which number matters. At year-3 economics a 12-month payback on gross profit allows a fully loaded CAC of $13,206 for an importer and $11,578 for a shipper, and after reserving two thirds for founder time and the free review the media target is $4,402 and $3,859 per account; at year-2 economics, with a 20.6% gross margin, it is only $1,229 and $1,044 (`marketing/digital/cac-targets.md` § "CAC ceilings: what we can afford"). LinkedIn at benchmark costs $9,619 per account even at our 2.1% rate and $58,572 at 0.345%, and even Google Search at LocaliQ's business-services cost per lead lands just above both year-3 targets (`marketing/digital/cac-targets.md` § "Modeled CAC per channel"). No benchmark channel reaches the year-2 targets, so in year 2 paid channels remain message tests (`marketing/digital/cac-targets.md` § "Targets we will hold the tests to"). Metadata also puts the paid-media cost of a small-company customer at $31K and of a mid-market customer at $103K (`marketing/digital/cac-targets.md` § "Funnel assumptions"), and a mid-market shipper may sit nearer the second figure.

The finance model reaches the same conclusion from the other direction. The base case spends $0.73 of sales and marketing per $1 of new direct ARR in year 3, against a Benchmarkit 2024 median of $2.00. At the median, year-3 CAC would be $41.0K, LTV to CAC 1.5x and payback 40 months, and the whole plan would need an $11.86M seed and $38.49M of equity with no break-even within seven years (`financial/unit-economics.md` § "The benchmark test"; `financial/scenarios.md` § "Sensitivities on the base case"). At the sourced pessimistic CAC of $31K, year-3 LTV to CAC falls from 4.1x to 2.0x, payback stretches from 14.5 to 30.1 months, and the plan needs a $9.98M seed and $18.67M of equity, with EBITDA positive only in year 7 (`financial/unit-economics.md` § "The pessimistic case (sourced)").
Source: Benchmarkit, 2025 SaaS Performance Metrics, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-17

### Our answer to it

We do not plan to buy customers with ads. The plan rests on acquisition paths that cost founder time and partner goodwill rather than media, and on measuring their real cost before money scales.

1. **Founder outreach with a stop rule.** Personally researched contacts with shippers and importers that match the profile, with pre-registered targets for calls, qualification and signed design partners, and a stop rule if contacts produce too few NDAs (`marketing/gtm.md` § 5; `marketing/marketing-plan.md` § 7).
2. **The free review as the conversion step.** A prospect who sees findings on its own invoices converts on evidence rather than a demo. The review's cost belongs in fully loaded CAC, which finance owns (`marketing/digital/cac-targets.md` § "Method").
3. **Referral partners who already see the invoices.** Accountants and fractional CFOs for shippers; customs brokers and freight forwarders for importers, who see D&D invoices but rarely dispute them (`marketing/gtm.md` § 2).
4. **Search content on the FMC rule, the 30-day window and accessorial disputes**, which reaches buyers when the trigger happens (`marketing/gtm.md` § 2; `marketing/seo/`).

Paid channels are limited to message tests in year 1 and held at test-level spend until a channel beats its target (`marketing/marketing-plan.md` § 6; `marketing/digital/cac-targets.md` § "Targets we will hold the tests to"). Tranche 2 of the seed is released only when five customers pay, and we will report acquisition cost on the first ten deals alongside that milestone (`financial/use-of-funds.md` § "Milestones per tranche"). If founder-led CAC looks like the benchmark rather than the plan, we will know at roughly month 23 with tranche-1 money still in the bank.

## 8. Industries we monetize

We lead with two segments, mid-market shippers and small and medium ocean importers, and treat them as one buyer wherever a company does both. Carriers and brokers come later, through partners. For each segment we give its size, our ceiling and the competitors active there. Shipper ceilings use finance's revenue per account; importer, carrier and broker ceilings also show research's own bottom-up fees as a cross-check, which are not package numbers (`research/02-industries.md` reconciliation note at the top).

### Mid-market shippers, $5M to $50M of freight spend (core segment)

**Size.** 19,932 firms (manufacturing 5,971, wholesale 8,798, retail 5,163), modelled from Census SUSB 2022 receipts classes of $100M to $999.9M and a 4.68% transport-to-sales ratio from a 2008 Establish survey. Their receipts were $4,057.4B in 2022, so their estimated freight spend is $189.9B, about 21% of the $883.2B US trucking spend (`research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)"). At 2% or 10% freight-to-sales the count would be 9,366 or 35,349 (`research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)").
Source: U.S. Census Bureau, Statistics of U.S. Businesses 2022, https://www2.census.gov/programs-surveys/susb/tables/2022/us_naicssector_large_rcptsize_2022.xlsx, accessed 2026-10-17
Source: DC Velocity, "Logistics costs and services 2008", https://www.dcvelocity.com/articles/31001-logistics-costs-and-services-2008, accessed 2026-10-17

**Our ceiling.** 19,932 x $27.6K = $550.1M a year at 100% penetration, using finance's year-7 shipper revenue per account. The average firm spends $9.53M on freight and, at an assumed 1% recoverable, recovers about $95.3K a year (`research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)"). The base plan's 304 shippers in year 7 are 1.5% of the modelled count (our arithmetic: 304 / 19,932), earning $7.40M (`financial/scenarios.md` § "Base case ($M unless stated)").

**Competitors here.** Loop (now carrying Data2Logistics, which served small, mid-size and enterprise customers), Intelligent Audit (Catalyst for small businesses, parcel only so far), CTSI-Global and nVision Global (services-led) and Cass (enterprise-weighted) (`research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)"). This is the contested segment; section 7 sets out how we compete in it.

**Why they buy.** Workload: in RXO's 2024 survey, 61% of shippers called accessorial requests one of their accounting team's biggest time-wasters and 84% saw a moderate or significant budget impact, while 70% thought carriers usually honest, so the pain is checking time more than fraud (`research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)").

### Small and medium ocean importers (core segment)

**Size.** $3.08B a year of D&D collected by the nine largest carriers (FMC, five-year average). The Census Bureau counted 240,535 US importers in 2024, 234,023 of them small or medium, carrying $884B of $2,926B in known import value, or 30.2%; how many import by ocean container is `UNKNOWN — needs primary research` (`research/02-industries.md` § "Ocean importers paying container demurrage and detention"). The FMC pool supports about 12,833 importer accounts at the business case's $240K exposure (`research/05-market-size.md` § "5.2 Importers: the FMC D&D pool caps the count").

**Our ceiling.** 12,833 x $30.8K = $395.3M a year (`research/05-market-size.md` § "4. TAM, SAM, SOM (the package numbers)"). Research's bottom-up cross-check is far smaller: $3.08B x 10% recoverable x 20% fee = $61.6M for the whole market, $18.6M for SMEs, and $0.93M at 5% of that slice by year 5, which is why research calls D&D "a feature that deepens an importer account, not a standalone business" (`research/02-industries.md` § "Ocean importers paying container demurrage and detention"). Finance's base plan earns $8.18M from 301 importers in year 7 (`financial/scenarios.md` § "Base case ($M unless stated)"), well above that cross-check, because each account also buys the fuel and accessorial checks and because the business case assumes a 2,000 TEU importer; how many importers of that size exist is an open question (`financial/scenarios.md` § "Open questions").

**Competitors here.** BlueCargo, Portcast (adjacent), Intelligent Audit and nVision Global (`research/02-industries.md` § "Ocean importers paying container demurrage and detention").

**Why they buy.** Under the FMC rule an invoice that fails the content and timing requirements relieves the billed party of the obligation to pay, and the billed party has 30 calendar days from issuance to dispute (`research/02-industries.md` § "Ocean importers paying container demurrage and detention").

### Small and mid-size truckload carriers (later, partner-led channel)

**Size.** FMCSA lists 72,053 active interstate for-hire carriers with 5 to 100 power units that filed an update since 17 October 2024, together running 1,206,250 power units (`research/02-industries.md` § "Small and mid-size for-hire truckload carriers (5 to 100 power units)").
Source: FMCSA, Company Census File (dataset az4n-8mr2), https://data.transportation.gov/resource/az4n-8mr2.json, accessed 2026-10-17

**Our ceiling.** Research's bottom-up gives $471.60 of fees per truck, $7,895 per average carrier, $568.9M at 100% penetration and $17.1M at 3% by year 5 (`research/02-industries.md` § "Small and mid-size for-hire truckload carriers (5 to 100 power units)"). Finance adds carriers through a factoring partner from year 3 at $7,895 less a 20% commission: 200 carriers and $1.33M of revenue in the base case's year 7, 8% of revenue (`financial/scenarios.md` § "Base case ($M unless stated)"; `financial/unit-economics.md` § "Carriers (partner-led)").

**Competitors here.** Hey Bubba, FleetOptos and Detention Source; none of the freight audit and payment firms sells to carriers (`research/02-industries.md` § "Small and mid-size for-hire truckload carriers (5 to 100 power units)").

**Why they buy.** The money is plainly owed and lost for want of proof; in DAT's 2016 survey 84% of carriers named detention a top-five business problem (`research/02-industries.md` § "Small and mid-size for-hire truckload carriers (5 to 100 power units)"). Small carriers have small software budgets, which is why they are priced on contingency and reached through partners.

### Freight brokers and 3PLs (later, as partners)

**Size.** 28,438 active brokerage authorities in January 2024; brokerage revenue is `UNKNOWN — needs primary research` (`research/02-industries.md` § "Freight brokers and 3PLs").
Source: FreightCaviar, 24 January 2024, https://freightcaviar.com/brush-pass-research-7-8-fewer-brokerages-than-a-year-ago, accessed 2026-10-17

**Our ceiling.** As a software sale at an assumed $12,000 a year, $341.3M at 100% penetration and $3.4M at 1% by year 5 (`research/02-industries.md` § "Freight brokers and 3PLs"). Brokers stay out of SAM until a pilot shows they buy.

**Competitors here.** Loop and BlueCargo, with TMS vendors as the default substitute (`research/02-industries.md` § "Freight brokers and 3PLs").

**Why they might buy, and why they might not.** Two-thirds of brokers in DAT's survey paid detention only when they could collect it from the shipper, so a packet a broker can forward unchanged helps them keep carriers without absorbing the cost; the same survey found only 20% of brokers ranked detention a top-five problem, against 84% of carriers (`research/02-industries.md` § "Freight brokers and 3PLs").

Factoring firms join brokers as the partners who bring carriers; their referral share is `UNKNOWN — needs primary research` (`marketing/gtm.md` § 2, Segment C).

## 9. Scenarios: bull, base and bear

Finance rebuilt the model for the owner's decision. It now shows the segment mix explicitly: new direct accounts split evenly between mid-market shippers and mid-size importers, carriers added through a partner from year 3 at $7,895 a year less a 20% commission, and one set of costs shared by all three cases (`financial/scenarios.md` § "What differs between the cases"; `financial/unit-economics.md` § "Carriers (partner-led)"). Year 1 is the first twelve months after the seed closes.

| Input | Bull | Base | Bear |
|---|---|---|---|
| New shipper + importer accounts, Y1..Y7 | 8, 40, 100, 160, 215, 260, 300 | 6, 30, 75, 120, 165, 200, 235 | 4, 16, 35, 55, 75, 90, 105 |
| New carrier accounts via partner, Y1..Y7 | 0, 10, 30, 60, 90, 120, 150 | 0, 0, 15, 30, 50, 70, 90 | 0, 0, 0, 0, 10, 20, 30 |
| Annual logo churn | 15% | 20% | 30% |
| Revenue per account vs base path | x 1.15 | x 1.00 | x 0.80 |
| Headcount and spend scale | x 1.10 | x 1.00 | x 0.85 |
| Variable cost of revenue | 7% | 8% | 10% |
| Hiring hold | none | none | years 3-4 at year-2 level |

Table: `financial/scenarios.md` § "What differs between the cases".

| Output | Bull | Base | Bear |
|---|---|---|---|
| Revenue Y1 / Y3 / Y5 / Y7 ($M) | 0.05 / 2.41 / 12.14 / 27.92 | 0.03 / 1.46 / 7.44 / 16.91 | 0.02 / 0.53 / 2.37 / 5.13 |
| Revenue mix Y7 (shippers / importers / carriers) | 42% / 47% / 10% | 44% / 48% / 8% | 45% / 50% / 5% |
| Accounts end Y7 (shippers / importers / carriers) | 424 / 423 / 374 | 304 / 301 / 200 | 118 / 116 / 49 |
| ARR end Y7 ($M) | 31.85 | 19.25 | 5.78 |
| First EBITDA-positive year | Y5 (+$2.93M) | Y6 (+$1.23M) | not within 7 years |
| Month ARR reaches $2.5M | 31 | 38 | 57 |
| Seed need incl. 20% buffer ($M) | 5.14 | 6.91 | 6.06 |
| Seven-year equity need incl. buffer ($M) | 5.59 | 9.80 | 23.88 |

Table: `financial/scenarios.md` § "Headline comparison".

**Base.** Design partners convert, importers add the container-fee and fuel checks, and a factoring partner brings carriers from year 3 (`financial/scenarios.md` § "What differs between the cases"). Revenue grows from $0.03M in year 1 to $16.91M in year 7 on 805 accounts; importers earn the most per account ($30.8K in year 7), shippers $27.6K and carriers $7.9K, so carriers are a quarter of the accounts and 8% of revenue (`financial/scenarios.md` § "Reading the cases"). ARR passes the $2.5M Series A bar in month 38, and EBITDA turns positive in year 6.

**Bull.** Higher recoveries, lower churn and a carrier partner signed in year 2 bring the milestone to month 31 and EBITDA break-even to year 5. The $7.0M seed alone would fund this case to profitability, so the Series A becomes optional growth capital (`financial/scenarios.md` § "Reading the cases").

**Bear.** Half the direct account wins, 20% lower revenue per account and 30% churn leave ARR at $771K after year 3 and $5.8M after year 7. The two-year hiring hold keeps the company at eleven people in years 3 and 4; when it ends, costs outrun revenue and EBITDA falls to -$5.34M by year 7 (`financial/scenarios.md` § "Reading the cases"). This is not a venture business, and finance shows it to make the checkpoint below real.

**Pessimistic acquisition cases, next to the base.** Finance ran three more cases on the base plan (`financial/scenarios.md` § "Sensitivities on the base case"):

| Change from base | Seed need ($M) | Seven-year equity ($M) | Milestone month | Year-7 EBITDA ($M) |
|---|---|---|---|---|
| None (base) | 6.91 | 9.80 | 38 | 4.05 |
| Direct accounts -20% every year | 7.59 | 13.86 | 40 | 1.19 |
| Revenue per account -20% | 7.62 | 14.12 | 40 | 0.99 |
| CAC $31K on direct accounts (Metadata 2026) | 9.98 | 18.67 | 38 | 1.12 |
| Sales and marketing at the $2.00 benchmark | 11.86 | 38.49 | 38 | -5.32 |
| Every account a carrier at $7,895 | 9.34 | 36.01 | 54 | -7.26 |

### The trigger that tells us which case we are in

The trigger is the tranche-2 checkpoint, around month 23 in the base case. Finance's year-end ARR in year 2 is $0.97M in the bull case, $0.56M in the base case and $0.24M in the bear case, against a $0.50M release threshold (`financial/scenarios.md` §§ "Base case", "Bull case" and "Bear case" (ARR rows); `financial/use-of-funds.md` § "The raise"). We read the checkpoint on four measures together.

1. **ARR at the checkpoint against $0.5M.** Above roughly $0.9M points to bull; $0.5M to $0.9M points to base; below $0.5M is bear and tranche 2 does not release. The band edges are our reading of finance's year-2 figures, not model outputs.
2. **Measured recovery per account** against the $52K importer and $40K shipper assumptions for year 1 (`financial/assumptions.md` § "The inputs that move the answer most" and input `shp_mult`). A 20% shortfall in revenue per account alone raises the seed need to $7.62M and moves the milestone to month 40.
3. **Sales and marketing per $1 of new direct ARR on the first ten deals** against the plan's $0.73 in year 3 (`financial/unit-economics.md` § "The benchmark test"). This is the measure that matters most: at the $2.00 benchmark the seven-year equity need is $38.49M.
4. **Shipper sales cycle and win rate** against the 8-to-16-week hypothesis (`marketing/gtm.md` § 2). Slow shipper cycles with healthy importer wins would point to an importer-led mix, which earns more per account; slow cycles on both point to bear.

If these measures read bear, we stop or pivot with tranche-1 money left; on tranche 1 alone, with headcount held at year-2 levels, cash runs out around month 33 (`financial/use-of-funds.md` § "If the milestones are missed"). If recoveries are healthy but acquisition cost is not, the most likely pivot is to sell through referral partners (accountants and fractional CFOs for shippers, customs brokers and forwarders for importers) instead of founder-led direct sales, which keeps the product and changes the channel.

## 10. Risks and how we prevail

Each risk names what we do about it and what that costs in money or time. Costs come from finance's plan inputs or marketing's budget; none is a quote from a vendor.

**1. Customers cost far more to acquire than the plan assumes.** This is the largest risk in the plan (section 7). Outside benchmarks imply a lead-to-customer rate one sixth of ours; at a $31K CAC the seven-year equity need rises from $9.80M to $18.67M, and at the $2.00 benchmark to $38.49M (`financial/scenarios.md` § "Sensitivities on the base case"). *Mitigation:* founder-led outreach with a pre-registered stop rule, the free review, referral partners who already see the invoices, and paid tests held at test-level spend (`marketing/marketing-plan.md` § 6). *Cost:* $90.0K of year-1 sales and marketing in total, of which $60.0K is travel (`financial/budget.md` § "Budget by department and quarter"), plus founder time we do not price. The measured answer arrives at the tranche-2 checkpoint, about month 23.

**2. The recoverable pool is smaller than our inputs assume.** The 15% non-compliant share of D&D charges, the 1.0% recoverable share of truck spend and the $52K importer and $40K shipper recoveries are all unmeasured (`financial/assumptions.md` § "The inputs that move the answer most" and input `shp_mult`; `research/02-industries.md` § "Mid-market shippers ($5M to $50M annual freight spend)"), and research flags its own 10% D&D recoverable input as the one to test first (`research/02-industries.md` § "Ocean importers paying container demurrage and detention"). *Mitigation:* measure first. Three to five shipper and importer design partners share closed invoices under NDA, and we deliver free reviews before any sales spend, with a kill trigger if the recoverable slice is trivial (gate G1; `marketing/gtm.md` § 5). *Cost:* the first US claims analyst from Q3 of year 1 at $100.0K loaded (`financial/budget.md` § "Hiring plan, year 1") and about two quarters of calendar time before we commit sales spend.

**3. Extraction fails on real carrier documents.** The only extraction provider reads labelled `Key: Value` text, and ADR 0008 calls this the largest functional gap between the code and a paying customer. *Mitigation:* add a layout-aware or OCR provider behind the existing provider interface, recorded per document and held to the same CI evaluation gates, with a reviewer confirming every field until the correction rate is measured. *Cost:* the ML / data engineer hired in Q3 of year 1 at $137.8K loaded a year (`financial/budget.md` § "Hiring plan, year 1"), and a variable cost of revenue of 8% that finance reserves for inference, OCR and data fees (`financial/assumptions.md` input `varc`).

**4. A buyer's security team says no, or a real file is exposed.** No external penetration test or compliance review has taken place, and the platform has run only locally (`architecture/overview.md` § "8. What is not verified"). *Mitigation:* an external penetration test and SOC 2 readiness work before the first real customer file is loaded, as the first non-payroll line we fund (`financial/use-of-funds.md` § "Milestones per tranche"; `financial/budget.md` § "What each line contains"). *Cost:* a $120K security programme in year 1 plus a security engineer from Q2 at $137.8K loaded (`financial/budget.md` § "What each line contains"), which together are 21.8% of year-1 spend (`financial/budget.md` § "Budget by department and quarter").

**5. An incumbent closes our gap first.** Loop has $160M, an installed base and recent acquisitions of mid-size books; Intelligent Audit is already selling Catalyst to smaller shippers; BlueCargo owns evidence-backed D&D disputes for large importers (`research/01-competitors.md` §§ "Loop", "Intelligent Audit" and "BlueCargo"). Any of them could add a cited, per-line dispute for the mid-market. *Mitigation:* sell where we fit and walk away elsewhere (section 7), position against Loop as a dispute layer that coexists with an audit vendor, re-check every competitor's own pages each quarter, and build design-partner evidence before they move. *Cost:* the quarterly review in founder time; no budget line. If Loop or Intelligent Audit announces a cited-dispute product for our segment, we expect our advantage to narrow to speed and the parity-tested rule base, and we will say so to investors.

**6. Shippers will not short-pay carriers they depend on.** A shipper may hesitate to dispute a carrier or broker that moves its freight reliably, as a carrier may hesitate to chase a shipper; we have no buyer testimony either way (`research/04-gaps.md` § "Candidate gaps without outside demand evidence"). *Mitigation:* nothing is disputed or short-paid without a named person's approval and a content-hash match, which is built; the customer chooses which findings to act on, and the packet lets it raise a charge with the clause attached rather than a bare refusal. Customer-controlled send settings are roadmap. *Cost:* one approval per claim, whose time we will record as reviewer minutes per claim in pilots (`financial/unit-economics.md`, "What would change these numbers first").

**7. The founder lacks freight-audit domain experience.** The earlier brief stated it plainly, and it remains true (investor brief section 8.1, main checkout). *Mitigation:* a freight-billing practitioner reviews our rules, explainers and packet format before the first outreach, and every rule correction from design partners is logged. *Cost:* $4,000 in the year-1 marketing budget for the domain-expert reviewer (`marketing/marketing-plan.md` § "6. Budget"). A senior domain hire or advisor is not in finance's headcount plan; adding one is an open question for the owner (section 16).

**8. Legal or regulatory exposure.** Handling customers' confidential rate data, writing demand letters on their behalf and the FMC rule all need counsel; we stay out of money movement and freight brokering until counsel confirms the line. *Mitigation:* NDA, data-handling, retention and deletion terms drafted by counsel before any document changes hands (`marketing/gtm.md` § "5. Design-partner recruitment plan"). *Cost:* $150K of legal and regulatory spend in year 1, covering the US entity, customer contracts, FMC and data-protection counsel (`financial/budget.md` § "What each line contains").

**9. Shipper sales are slower and contested.** Shipper pilots need a finance approver and a security questionnaire, with a hypothesised 8-to-16-week cycle, and the segment is where Loop and Intelligent Audit sell (`marketing/gtm.md` § 2; section 7). Slower cycles could cut the account wins the model assumes; each 20% shortfall adds about $0.7M to the seed need and two months to the Series A milestone (`financial/scenarios.md` § "Sensitivities on the base case"). *Mitigation:* pair each shipper with its import side so that the 30-day D&D window creates urgency, use referral partners who already see the invoices, and ask finance to model the account mix and cycle by segment before the raise closes. *Cost:* no extra budget; the time cost is read at the G1 decision in quarter 3.

**10. The brand name is not yet cleared.** No trademark search for scoup.ai is recorded and the domain appears unregistered (`marketing/marketing-plan.md` § "8. Risks"). *Mitigation:* register the domain and run the trademark search before any printed material or paid media. *Cost:* $2,000 for the domain and site fixes in year 1 (`marketing/marketing-plan.md` § "6. Budget"); the trademark search cost is `UNKNOWN — needs primary research`.

## 11. Use of funds

We are raising a $7.0M seed in two tranches and plan an $8.5M Series A once ARR reaches $2.5M (`financial/use-of-funds.md` § "The raise").

| Round | Amount | Timing | Condition |
|---|---|---|---|
| Seed, tranche 1 | $4.0M | At close | none |
| Seed, tranche 2 | $3.0M | Base case around month 23 | Five paying customers, recovery measured on real invoices, ARR above $0.5M |
| Series A | $8.5M | Milestone month 38, close by about month 44 | ARR of $2.5M |

The seed size is a model output, not a valuation target. The deepest point of the base-case cash curve before a Series A arriving mid-way through year 4 is $5.76M; with a 20% buffer that is $6.91M, rounded up to $7.0M (`financial/use-of-funds.md` § "The raise"). Both tranches with no Series A last 49 months in the base case; tranche 1 alone lasts about 32 months (`financial/use-of-funds.md` § "The raise"). Average monthly net burn in the base case is $81.4K in year 1, $131.3K in year 2, $172.8K in year 3, $188.6K in year 4 and $106.7K in year 5, and free cash flow is positive from year 6. In the bull case it is $80K, $122K, $123K and $63K in years 1 to 4; in the bear case $82K, $137K, $149K and $106K (`financial/budget.md` § "Net burn by year (base case)"; `financial/scenarios.md` § "Headline comparison").

**Where the seed goes in years 1 to 3** (`financial/use-of-funds.md` § "Where the seed goes"):

| Use | $K | Share |
|---|---|---|
| Engineering (software, ML / data) | 1,498.0 | 23.2% |
| G&A (founder, finance and legal operations, counsel, office) | 1,340.4 | 20.8% |
| Sales (account executives from year 2, sales engineer, travel, partner commission) | 1,224.8 | 19.0% |
| Cost of revenue (claims analysts, hosting and data, variable cost) | 941.9 | 14.6% |
| Security (engineer, pen tests, SOC 2, insurance) | 835.8 | 12.9% |
| Marketing (hire from year 3, programmes) | 401.1 | 6.2% |
| Working capital | 157.1 | 2.4% |
| Equipment | 57.0 | 0.9% |
| **Gross uses** | **6,456.0** | 100% |
| Less revenue earned, years 1-3 | -1,830.1 | |
| **Net use of cash, years 1-3** | **4,625.9** | |
| Remaining at the start of year 4 | 2,374.1 | |

The order of priority is fixed: independent security verification and counsel before any real customer data, then design-partner validation, then product hardening and integrations, then go-to-market (`financial/use-of-funds.md` § "Where the seed goes"). Year 1 spends $1,025.2K, about $85K a month, and ends with six people (the founder, two software engineers, a security engineer, an ML / data engineer and one US claims analyst) and six paying design-partner accounts, three shippers and three importers (`financial/budget.md` § "Year-1 budget" and § "Hiring plan, year 1").

**Tranche 1 buys evidence:** a passed external penetration test and SOC 2 readiness under way before the first real file; a gold evaluation set of 100 or more realistic detention, demurrage and fuel-surcharge cases with known answers and a measured pass rate on it; three to five shipper and importer design partners with recoverable dollars measured on their files; and the first paying contingency accounts with recovery rate, time per claim and analyst minutes per claim recorded (`financial/use-of-funds.md` § "Milestones per tranche"). **Tranche 2 buys repeatability:** the first US account executive and sales engineer, more claims analysts and platform-fee pricing, released only on the milestone and with acquisition cost on the first ten deals reported (`financial/use-of-funds.md` § "Milestones per tranche"). **The Series A buys scale:** account executives to nine and claims staff to sixteen by year 7, plus TMS, ELD and carrier-tracking integrations. The base case needs only $2.8M of further equity after the seed; we size the Series A at $8.5M because a 20% shortfall in direct accounts raises the seven-year need to $13.86M. It does not cover acquisition at paid-media prices: $18.67M at a $31K CAC, $38.49M at the $2.00 benchmark (`financial/use-of-funds.md` § "Milestones per tranche").

For orientation only, at the Q1 2026 median US seed pre-money of $18.4M (PitchBook via WaveUp, grade C, not re-verified), $7.0M would buy 27.6% before any option pool; our round is more than twice the median seed in that source, so the median price may not apply, and terms are for the lead investor (`financial/use-of-funds.md` § "The raise").

## 12. Why our software production is strong

We make no claim here that the repository does not show, and no claim about accuracy or production security, which nobody has measured. What the repository does show is a way of building that a carrier's dispute team, a shipper's IT reviewer and an investor's technical diligence can each check line by line.

### Team model

The codebase was written by one founder directing a pipeline of AI coding agents with separated roles: a planner that writes the specification and a separate test specification, a builder that implements from the specification, a tester that writes black-box acceptance tests from the test specification without reading the builder's reasoning, a read-only reviewer that acts as the quality gate, a read-only security reviewer, a scriber that keeps the architecture record, and a shipper that alone touches git. The role definitions live in the founder's Claude Code configuration rather than in the repository. The repository carries the trace: `ARCHITECTURE.md` (4,099 lines) records each run by requirement id, for example `REQ-20261009-four-eyes` and `REQ-20261010-step5-analysis`, with what was delivered, what was deferred and every registered deviation (`ARCHITECTURE.md L64, L365, L1249`). The 134 commits on `feat/hardening` run from 5 to 12 October 2026. We count this model as a strength for speed and for the separation of the person who writes code from the one who tests it, and as a risk for depth of domain judgement, which is why risk 7 exists. Finance's plan adds human engineers from Q2 of year 1 (`financial/budget.md` § "Hiring plan, year 1").

### Quality gates the repository enforces

**Tenant isolation that fails closed.** Twenty-six tables carry `FORCE ROW LEVEL SECURITY` across the 11 migrations, and with no tenant set in a transaction a query sees zero rows. The API connects as `freight_app`, a role with `NOSUPERUSER NOBYPASSRLS NOINHERIT` and data-manipulation grants only. A Prisma extension injects the tenant into every query, removes raw SQL from the tenant client, and throws on any model nobody has classified (`architecture/overview.md` § "4. Tenancy and row-level security"; ADR 0002; `api/src/db/tenant.ts`). Tests named for the property exist: `api/test/cross-tenant-failclosed.test.ts` and `api/test/integration/audit-failclosed.int.test.ts`.

**Four-eyes approvals enforced twice.** An author of any packet revision, a charge-label author whose label influenced the analysis, or the editor of the ocean invoice behind a claim cannot approve or reject it, and an uploader cannot accept their own document. The service refuses first; a database trigger, `approvals_four_eyes_guard`, raises `four_eyes_required` if the service is ever bypassed (`api/prisma/migrations/20261011000000_four_eyes/migration.sql L1-22`; ADR 0005). Unit and integration suites cover it (`api/test/four-eyes-units.test.ts`, `api/test/integration/four-eyes.int.test.ts`).

**Acceptance tests and evaluation gates in CI.** The TypeScript monorepo has 225 test files, 136 of them acceptance tests across `api/test-acceptance`, `packages/shared/test-acceptance` and `web/test-acceptance`. The CI job runs lint, typecheck, unit tests, migrations, seed, build, three evaluation gates on synthetic sets (extraction, charge classifier, cost-outlook backtest), the integration and acceptance suites against the Python reference, and a dependency audit, in that order (`.github/workflows/web-ci.yml L127-159`). The evaluation gates are labelled in the workflow itself as regression checks and "not an accuracy measure".

**Exact parity with an independent implementation.** The TypeScript money rules must produce string-identical output to the Python reference core, apart from registered divergences listed in `ARCHITECTURE.md`; in CI a missing Python interpreter fails the suite (`architecture/overview.md` § "2.4 Python reference core (`src/freight_recovery/`)"; ADR 0003).

**A hash-locked supply chain.** Python dependencies install only with `pip install --require-hashes --no-deps`; `requirements.txt` carries 957 SHA-256 hashes and `requirements-dev.txt` 1,155, and `pip-audit` checks all three lock files on every run (`.github/workflows/ci.yml L35, L69-83`). Node dependencies install with `npm ci --ignore-scripts`, a script verifies that no package runs an install script, and `npm audit signatures` checks registry signatures (`web-ci.yml L127-128, L159`). GitHub Actions are pinned to commit SHAs and the CI MinIO image to a digest (`web-ci.yml L99-118`).

**A tamper-evident record.** Every mutating request appends to a per-tenant SHA-256 hash chain in the same transaction, and triggers block updates and deletes on the audit, approval and packet tables (`architecture/overview.md` § "7. Audit trail"; ADR 0004).

### What is not yet verified

The suites have run locally on Windows against fresh PostgreSQL 16.15 and MinIO. GitHub CI for the latest commits, the container images, the compose stack, Playwright end-to-end tests and any AWS deployment remain unverified, and no external penetration test or compliance review has taken place (`architecture/overview.md` § "8. What is not verified"). The audit chain's heads are not yet anchored outside the database (`architecture/overview.md` § "7. Audit trail"). Closing these is the first use of tranche 1.

## 13. Growth expectations, years 1 to 7

These are finance's base-case outputs with the segment split the owner set (`financial/scenarios.md` § "Base case ($M unless stated)"). They are plans for a company with no customers and no pipeline; finance labels the account-win inputs as carried over from the investor-pack workbook, grade C (`financial/assumptions.md` input `new_Base`). The drivers column is ours.

| Year | Shippers / importers / carriers at year end | Total accounts | Revenue | ARR, year end | Headcount | Main driver |
|---|---|---|---|---|---|---|
| 1 | 3 / 3 / 0 | 6 | $0.03M | $0.07M | 6 | Shipper and importer design partners convert to paid pilots; founder sells; security and extraction work before scale |
| 2 | 17 / 17 / 0 | 34 | $0.33M | $0.56M | 11 | Platform fee starts; tranche 2 funds the first account executive and sales engineer |
| 3 | 52 / 51 / 15 | 118 | $1.46M | $2.23M | 19 | Referral partners and search content add direct accounts; a factoring partner brings the first carriers; gross margin reaches 60% |
| 4 | 102 / 101 / 42 | 245 | $3.76M | $5.02M | 31 | Series A at the $2.5M ARR milestone (month 38) funds sales and claims staff |
| 5 | 165 / 163 / 84 | 412 | $7.44M | $9.24M | 39 | Importers add container-fee and fuel checks; revenue per account grows with recovered amounts |
| 6 | 232 / 230 / 137 | 599 | $11.80M | $13.87M | 49 | First EBITDA-positive year (+$1.23M) as revenue outgrows the claims team |
| 7 | 304 / 301 / 200 | 805 | $16.91M | $19.25M | 54 | Gross margin 79%; EBITDA $4.05M |

Revenue per account follows one fee path with a segment multiplier. An importer earns the platform fee plus the amount recovered times our share: in year 3, $10.0K + $85K x 14% = $21.9K. A shipper recovers 77% of that amount because it has no ocean D&D, so it earns $10.0K + $85K x 0.77 x 14% = $19.2K. A carrier earns $39.5K recovered x 20% = $7.9K, less a 20% partner commission (`financial/unit-economics.md` § "Worked arithmetic, year 3"). The blended direct account earns $20.5K in year 3, $26.1K in year 5 and $29.2K in year 7, with CAC of $15.0K, $17.9K and $18.5K and LTV to CAC of 4.1x, 5.4x and 6.2x (`financial/unit-economics.md` § "Direct accounts (shippers and SME importers): definitions and base-case values"). Net revenue retention is 102.3% in year 3 and falls to 84.2% in year 7, because 20% churn outweighs the growth in revenue per account and the plan counts on no expansion beyond that path (`financial/unit-economics.md` § "Direct accounts (shippers and SME importers): definitions and base-case values"). Headcount grows from six to 54, with engineers to 13, claims analysts to 16 and account executives to 9 by year 7 (`financial/assumptions.md` inputs `hc_swe`, `hc_cs` and `hc_ae`). Bull and bear paths and the pessimistic acquisition cases are in section 9.

**What still has to hold.** The direct account wins (6, 30 and 75 in years 1 to 3) were carried over from the earlier plan, before the shipper decision; shipper cycles of 8 to 16 weeks may slow them, and a 20% shortfall in direct accounts adds about $0.7M to the seed need and two months to the milestone (`financial/scenarios.md` § "Sensitivities on the base case"). The 304 shippers in year 7 are 1.5% of the 19,932 modelled shippers (our arithmetic), a count that moves between 9,366 and 35,349 with the freight-to-sales ratio. The 301 importers assume enough 500-to-5,000 TEU importers exist, a count nobody has published (`financial/scenarios.md` § "Open questions"). The $15.0K CAC in year 3 depends on founder-led and partner channels, not paid media (section 7).

## 14. Pipeline

### Current state

There is no sales pipeline. We have no customers, no paying pilots, no signed design partners, no NDAs and no letters of intent, and we have not yet contacted a prospect. The product has never processed a real shipment record; every packet it has produced came from synthetic fixtures. We are at the design-partner stage, and the four preconditions marketing set before the first outreach message are still open: a real contact address on the site, NDA and data-handling terms drafted by counsel, a synthetic sample packet to attach, and a file-intake process that meets our own security commitments or an interim arrangement recorded with counsel (`marketing/gtm.md` § "5. Design-partner recruitment plan"). We say this first because an investor will find it anyway, and because every number in sections 9 and 13 depends on the next four quarters replacing assumptions with measurements.

### The next four quarters

Quarters count from the seed close, as in finance's budget (`financial/budget.md` § "Year-1 budget").

**Quarter 1: preconditions and first conversations.** Close the four outreach preconditions, register the domain and run the trademark search, and commission the external penetration test and SOC 2 readiness work (`financial/budget.md` § "What each line contains"). Build a target list of profile-matched shippers and importers from the founder's network, referral partners (accountants, fractional CFOs, customs brokers, forwarders) and public company data, contact them personally, and hold the first calls against marketing's pre-registered targets (`marketing/gtm.md` § 5; `marketing/marketing-plan.md` § 7). The founder is the only full-time person this quarter (`financial/budget.md` § "Hiring plan, year 1"). Exit measure: calls held against target, and marketing's stop rule on NDAs per contact (`marketing/gtm.md` § 5).

**Quarter 2: design partners and files.** Sign NDAs with three to five design partners, shippers and importers, and receive three months of paid carrier invoices with their rate confirmations or 90 days of D&D invoices from each (`marketing/gtm.md` §§ 2 and 5). Two software engineers and a security engineer join (`financial/budget.md` § "Hiring plan, year 1"). Engineering priority is extraction on the partners' real document layouts and the gold evaluation set of 100 or more realistic cases with known answers (`financial/use-of-funds.md` § "Milestones per tranche"). Exit measure: files received from three or more partners, and the penetration test passed before any of those files is loaded.

**Quarter 3: free reviews and the G1 decision.** Deliver a free review to each partner, log every rule correction, and measure the recoverable share on their files, which replaces the assumed 15% non-compliant D&D share, the 1.0% recoverable share of truck spend and the $52K per account (`marketing/gtm.md` § "5. Design-partner recruitment plan"; `financial/use-of-funds.md` § "Milestones per tranche"). The ML / data engineer and the first US claims analyst join (`financial/budget.md` § "Hiring plan, year 1"). Exit measure: the G1 gate, material and evidence-backed unrecovered dollars on at least one partner's closed files, or the kill trigger if the recoverable slice is trivial.

**Quarter 4: first paid pilots.** Offer contingency pilot terms where the findings are material (`marketing/gtm.md` § 5), and run the first live claims with human approval, recording recovery rate, time per claim and analyst minutes per claim (`financial/use-of-funds.md` § "Milestones per tranche"). Build outcome recording, so that "dollars recovered" can be computed from the system rather than from a spreadsheet (`architecture/data-model.md` § "5. What the schema does not hold"). Finance's base case ends year 1 with three shippers, three importers and $0.07M of ARR (`financial/scenarios.md` § "Base case ($M unless stated)"). Exit measure: three or more paying pilots (gate G3), with the cost of acquiring each recorded by source so that the tranche-2 checkpoint around month 23 is read on measured numbers.

## 15. What changed from the earlier drafts

The 1,398-word business plan and 5,553-word investor brief in the main checkout were written before this package's research and finance work, and several of their figures no longer hold. The seed is $7.0M in two tranches, sized from finance's cash curve, where the brief said $2.0M to $3.0M (`financial/use-of-funds.md` § "The raise"; investor brief section 9.3). Base-case year-5 revenue is $7.44M on 412 accounts, where the brief showed $10.20M on 330 accounts at a $40K contract value (`financial/scenarios.md` § "Base case ($M unless stated)"). The brief's blended CAC of about $25K and LTV to CAC of 5.2x are superseded by finance's $15.0K year-3 CAC and 4.1x, which we now show next to the benchmark that undercuts them (`financial/unit-economics.md` § "Direct accounts (shippers and SME importers): definitions and base-case values"). The freight-audit market size of about $3.1B quoted in the old market analysis could not be reproduced and is dropped (`research/05-market-size.md` § "1. Why the headline numbers are not the TAM"). Market sizing is research's final version: a $945.4M SAM on 32,765 shipper and importer accounts. Three earlier versions ($971.8M TAM / $474.2M SAM / $14.6M SOM; $10.30B / $8.99B; $4.10B / $1.01B) were withdrawn and do not appear in this plan as package numbers (`research/05-market-size.md` § 5.4). The old plan's "Freight Recovery" name is replaced by scoup.ai. The brief described a product that "tracks" deadlines and outcomes; the code does not yet do either for truck claims, and section 3 now says so. On 2026-10-17 the owner set the plan to shipper- and importer-first; sections 1, 2, 5 to 10, 13 and 14 were rewritten for it, and carriers became a later, partner-led channel.

## 16. Open questions

1. **Will shippers pay?** The independent evidence for the shipper audit measures workload, not overcharges, and comes from a broker's survey; no independent source gives an accessorial overcharge rate. AP time per invoice and recovered dollars on design partners' invoices are the pilot's main test (`research/04-gaps.md` § "Gap 5"; `docs/innovation-thesis.md`, I1).
2. **The mid-market shipper count.** 19,932 is a model built on a 2008 freight-to-sales ratio and moves between 9,366 and 35,349 with that ratio; a purchased firmographic list or a current ratio would replace it (`research/05-market-size.md` § "2. Counts of buyers").
3. **The number of 2,000-TEU importers.** No public source counts importers by container volume; the public bound is 4,160 to 20,279, and an exact count needs bill-of-lading data (`research/02-industries.md` § "Ocean importers paying container demurrage and detention", bullet "Importers by size").
4. **Recovery inputs.** The 15% non-compliant share of D&D charges, the 1.0% recoverable share of truck spend, and the $52K importer and $40K shipper year-1 recoveries are assumed, and measurable only from design partners' closed invoices (`financial/assumptions.md` § "The inputs that move the answer most" and input `shp_mult`).
5. **Price acceptance.** Whether shippers and importers accept a 25% pilot contingency and then a platform fee with a 12% to 17% share, and what referral partners expect: `UNKNOWN — needs primary research` (`financial/assumptions.md`, inputs `fee` and `share`; `marketing/gtm.md` § 2).
6. **Fully loaded CAC by segment**, including founder time and the free review, which neither marketing nor finance has yet modelled (`marketing/digital/cac-targets.md` § "Open questions").
7. **The shipper-importer overlap**, which sets the SAM anywhere from $0.55B to $0.95B (`research/05-market-size.md` § "4. TAM, SAM, SOM (the package numbers)").
8. **A senior freight-domain hire or advisor**, which finance's headcount plan does not include; an owner decision.
9. **Entity and opening cash.** Whether US staff are employed by the Norwegian AS or a Delaware subsidiary, and the opening cash at close, which the model sets to zero (`financial/assumptions.md` § "Open questions for the owner").
10. **Trademark search cost and outcome** for scoup.ai: `UNKNOWN — needs primary research`.
