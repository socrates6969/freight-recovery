# 03 Feature matrix

Status: pre-product. The scoup.ai row describes code that exists in the build worktree and runs on synthetic data only; it has never been deployed or used by a customer. "partial" in the scoup.ai row means "built and tested on synthetic data, not proven in use".

Research date: 2026-10-17.

## Cell rules

- `yes`: the company documents the capability on its own site or in a cited source (see 01-competitors.md for URLs).
- `partial`: documented, but limited in a way stated in the notes (one mode, one telematics vendor, enterprise only, roadmap language).
- `no`: we checked and the capability is absent. We use `no` only where we looked for something specific and could see it missing: a pricing page with no price, a product whose stated scope excludes it, or scoup.ai code without it.
- `unknown`: not documented in anything we read. Absence of marketing is not evidence of absence, so most undocumented cells are `unknown`, not `no`.

## Columns

| Code | Capability |
|---|---|
| C1 | Sells to carriers (claims for money owed to the carrier) |
| C2 | Captures detention time from ELD or geofence data |
| C3 | Builds a claim packet where each figure cites its source document |
| C4 | Extracts detention or accessorial terms from rate confirmations or contracts |
| C5 | Audits shipper-side freight invoices against rates |
| C6 | Validates accessorial charges specifically |
| C7 | Tracks disputes to resolution (status, deadlines) |
| C8 | Audits ocean demurrage and detention invoices |
| C9 | Checks D&D invoices against the FMC billing rule (OSRA) |
| C10 | Pays carriers (freight payment) |
| C11 | Requires a second person to approve outgoing claims (four-eyes) |
| C12 | Fuel-surcharge outlook or forecast |
| C13 | Publishes prices |

## Matrix

| Company | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 | C13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Loop | unknown | unknown | unknown | partial | yes | unknown | unknown | unknown | unknown | yes | unknown | unknown | no |
| Cass Information Systems | unknown | unknown | unknown | unknown | yes | unknown | unknown | unknown | unknown | yes | unknown | unknown | no |
| Trax Technologies | unknown | unknown | unknown | partial | yes | yes | unknown | unknown | unknown | unknown | unknown | unknown | no |
| CTSI-Global | unknown | unknown | unknown | unknown | yes | unknown | unknown | unknown | unknown | yes | unknown | unknown | no |
| nVision Global | unknown | unknown | unknown | unknown | yes | unknown | partial | partial | unknown | yes | unknown | unknown | no |
| Intelligent Audit | unknown | unknown | unknown | unknown | yes | yes | unknown | partial | unknown | unknown | unknown | unknown | no |
| BlueCargo | partial | unknown | partial | unknown | yes | unknown | yes | yes | yes | yes | unknown | unknown | no |
| Hey Bubba | yes | yes | partial | partial | no | unknown | unknown | no | no | unknown | unknown | unknown | no |
| FleetOptos | yes | partial | unknown | partial | no | unknown | unknown | no | no | unknown | unknown | unknown | no |
| scoup.ai (pre-product) | partial | no | partial | partial | partial | partial | partial | partial | partial | no | partial | partial | no |

## Evidence for every cell that is not `unknown`

Sources and URLs for each company are in 01-competitors.md; all were accessed 2026-10-17.

Loop. C4 partial: the home page lists "parcel contract intelligence", which covers parcel contracts, not truckload rate confirmations. C5 yes: "freight audit". C10 yes: "carrier payments". C13 no: https://loop.com/pricing returned HTTP 404 and the site shows no prices.

Cass. C5 yes: "Freight Audit". C10 yes: "Freight Payment". C13 no: the freight audit page shows no prices.

Trax. C4 partial: "Invoice-Contract Intelligence" appears on the AI roadmap page as a direction, not a shipped feature. C5 yes: global freight audit. C6 yes: its blog says the audit flags "missing or incorrect accessorial fees". C13 no: no prices published.

CTSI-Global. C5 yes and C10 yes: "Freight Audit + Payment" on the home page. C13 no: no prices published.

nVision Global. C5 yes and C10 yes: "Freight Audit and Payment". C7 partial: "Freight Claims" is a documented service, but it concerns cargo loss and damage, not detention or accessorial disputes. C8 partial: a company blog post explains D&D invoice auditing; we found no product page for it. C13 no: no prices published.

Intelligent Audit. C5 yes: multimodal audit per its FAQ. C6 yes: the FAQ says it "reviews accessorial charges". C8 partial: a published case study on D&D invoice validation, not a stated product line. C13 no: the FAQ describes a subscription without publishing prices, and Catalyst plan prices are not shown.

BlueCargo. C1 partial: lists "Drayage Carriers & Brokers" among customers, but only for port and drayage charges. C3 partial: markets "Dispute resolution with evidence-backed documentation"; we could not see whether each figure is tied to a source. C5 yes and C10 yes: "Freight Audit & Pay (pre-audit and post-audit)". C7 yes: dispute resolution with a claimed "95% Dispute Success" (vendor claim). C8 yes: D&D is its core. C9 yes: invoice validation "against OSRA invoice requirements". C13 no: no prices published.

Hey Bubba. C1 yes and C2 yes: logs detention claims from ELD geofence crossings for owner-operators and fleets. C3 partial: "logs the detention claim with timestamps attached", which attaches evidence but does not describe per-figure citations. C4 partial: "detention terms recorded at booking"; the page does not say whether terms are read from documents or typed in. C5, C8, C9 no: its stated customers are carriers, and shipper invoice audit and ocean D&D are outside that scope. C13 no: https://bubba.ai/pricing returned HTTP 404.

FleetOptos. C1 yes: detention billing for trucking fleets. C2 partial: Geotab telematics only. C4 partial: "applies contract-specific billing rules (free time allowances, hourly rates)"; extraction from documents is not described. C5, C8, C9 no: the listing scopes it to fleets running Geotab. C13 no: the marketplace listing shows no price.

The scoup.ai row (pre-product, synthetic data only). Evidence is code in the build worktree (C:\Users\mariu\ventures\freight-recovery-build, branch feat/hardening), not customer use.
- C1 partial: claims module (api/src/claims) builds detention and accessorial packets.
- C2 no: we found no ELD or geofence integration in api/src; timestamps come from uploaded documents.
- C3 partial: findings carry hash citations to source fields (api/src/claims/analysis.ts).
- C4 partial: the import pipeline extracts fields from documents (api/src/imports/parse); extraction accuracy on real rate confirmations is unmeasured.
- C5 partial: the fuel check compares charged surcharge with the carrier’s schedule and diesel data (api/src/intelligence/fuel.ts); there is no general rate-contract audit.
- C6 partial: charge intelligence classifies invoice lines into charge categories with tenant labels (api/src/intelligence/charges.ts).
- C7 partial: claim state machine (api/src/claims/state-machine.ts) tracks status; deadline tracking is shown for ocean D&D below.
- C8 partial and C9 partial: ocean D&D audit runs (api/src/ocean-dd/audit-run.ts), including the 30-day issuance limit under 46 CFR 541.7.
- C10 no: the product does not move money.
- C11 partial: four-eyes rules refuse approve or reject transitions to any author of the claim (api/src/claims/service.ts, REQ-20261009-four-eyes).
- C12 partial: fuel-surcharge tables and outlook routes exist (api/src/intelligence/fuel.ts, outlook-routes.ts).
- C13 no: no published pricing; pre-product.

## Reading the matrix

The column that separates the groups is C1. The six FAP firms document shipper-side audit and payment and say nothing about carrier claims, while the two carrier tools document geofence capture and nothing on the shipper side. C3 and C4, the cited packet and term extraction, have no `yes` from any competitor; that is consistent with Gaps 1 and 2 in 04-gaps.md, with the caveat that most cells are `unknown` rather than confirmed absences. C9 has exactly one `yes` (BlueCargo), which is why we call Gap 3 partial. The scoup.ai row has more `partial` cells than any competitor has `yes` cells, and that should be read as breadth of prototype, not proof of capability: nothing in the scoup.ai row has met a real document or a real counterparty.
