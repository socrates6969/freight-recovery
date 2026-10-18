# Executive dashboard: specification input

> **Status.** Proposed, not built. Pre-product, synthetic data only, never deployed. This document is input for
> `fr-planner`, who turns it into `spec.md` and `test-spec.md`. Every metric below names the tables and columns
> it reads in `api/prisma/schema.prisma` on `feat/hardening` (`ed3d126`). Anything the schema cannot answer is
> listed as a **gap** in section 6, not approximated silently.

## 1. Why this page exists

The people who sign for scoup.ai are a CFO, a controller or a head of logistics at a mid-market shipper or an SME
importer (owner decision of 2026-10-17: shippers and importers first, carriers later through partners). They will not open claim sheets. They want one page that answers four questions each week: how much
money have we found in our carriers' and terminals' invoices, where is it stuck, what is about to expire, and which
carriers and charge types keep overbilling us. Today the
product has a worklist for analysts (`/intelligence`) and a platform dashboard for our own staff (`/dev`), but
nothing for a customer's executives.

The page has one hard rule that comes from the project's honesty rule: **it shows money identified and money
approved for a demand, never money recovered.** The schema stops at `SEND_READY` (ADR 0007), so nothing in the
database knows whether a carrier paid. Every dollar figure carries the label "identified" or "ready to demand",
and the page footer states in plain words that recovery outcomes are not tracked yet.

## 2. Audience and access

| Decision | Proposal | Reason |
|---|---|---|
| Permission | New permission `insights:read` in `packages/shared/src/rbac.ts` | Every route needs a declared permission (ADR 0010); a named permission lets a tenant give a CFO the page without approval rights |
| Roles that hold it | OWNER, ADMIN, MANAGER, VIEWER | VIEWER is the natural seat for an executive who must see results but must not approve packets (four-eyes, ADR 0005). REVIEWER and ANALYST already see every claim through `claims:read`; whether they also get the page is open question Q1 |
| Platform roles | None | Platform roles hold no tenant data permission; this stays true |
| API keys | No scope in the first version | No `apiKeyScope` on the new routes; exporting the numbers to a BI tool is a later decision (Q2) |
| Tenant scope | Own tenant only, through `ctx.db` (tenant transaction, RLS) | Same three layers as every tenant read (ADR 0002) |
| MFA | Unchanged | MFA stays mandatory for OWNER and ADMIN only; VIEWER and MANAGER follow existing policy |

Aggregates expose nothing a VIEWER cannot already read through `GET /api/v1/claims`, so the new permission adds
no new data exposure for the four roles. It does add a new surface for rate limiting and query cost, handled in
section 5.

## 3. Definitions

| Term | Definition (exact) |
|---|---|
| Claim | A row in `claims` for the caller's tenant |
| Kind | `claims.kind`: `FREIGHT` (truck detention, accessorial, fuel) or `OCEAN_DD` (ocean demurrage and detention) |
| Current packet | For a claim, the `evidence_packets` row with the highest `revision` (status is never `SUPERSEDED`) |
| Identified recoverable | `claims.recoverable_cents`: the sum of confirmed findings on the current packet. Equal to the current packet's `recoverable_cents`, because an edit copies amounts unchanged (`api/src/claims/service.ts`) |
| Pending review | `claims.pending_review_cents`: findings that need a human decision; never counted as identified |
| Ready to demand | Identified recoverable of claims with `status = 'SEND_READY'` |
| Approved, not yet send-ready | Identified recoverable of claims with `status = 'APPROVED'` |
| Open claim | `status IN ('AWAITING_ANALYSIS','PENDING_REVIEW','APPROVED')` |
| Closed in product | `status IN ('SEND_READY','REJECTED')` (closed in scoup.ai, not closed with the carrier) |
| Period | A half-open interval `[from, to)` on a named timestamp, in UTC, at most 366 days long |
| Carrier key | `lower(trim(claims.carrier_name))`. For `OCEAN_DD` claims this column holds the D&D invoice's billing party (`api/src/ocean-dd/audit-run.ts` copies `billingPartyName` into `carrierName`), so one key serves both kinds. For an importer the billing party is often a forwarder acting as NVOCC (`research/01-competitors.md`), so the UI calls this column "billing party", not "carrier". The display name is the most frequent original spelling in the group |

## 4. Metric catalogue

All metrics are computed per tenant, inside one read-only tenant transaction, and filtered by an optional `kind`
(`FREIGHT`, `OCEAN_DD` or both) and an optional `perspective` (`SHIPPER`, `CARRIER` or both). The page opens with
`perspective=SHIPPER`, because the first customers are shippers and importers; every `OCEAN_DD` claim is created
with `perspective = 'SHIPPER'` (`api/src/ocean-dd/audit-run.ts`), so importers see their D&D claims under the default. Money is summed as integer cents in SQL and returned as integer cents
(ADR 0011); the web app formats with `formatUsdCents`.

### 4.1 Money

| ID | Metric | Definition | Source |
|---|---|---|---|
| M1 | Identified recoverable, open | Sum of `recoverable_cents` over open claims | `claims.recoverable_cents`, `claims.status` |
| M2 | Pending review, open | Sum of `pending_review_cents` over open claims | `claims.pending_review_cents`, `claims.status` |
| M3 | Approved, not yet send-ready | Sum of `recoverable_cents` where `status = 'APPROVED'` | `claims` |
| M4 | Ready to demand (period) | Sum of `recoverable_cents` of claims whose `SEND_READY` approval falls in the period | `approvals.action = 'SEND_READY'`, `approvals.created_at`, joined to `claims.recoverable_cents` |
| M5 | Identified in period | Sum of `recoverable_cents` of claims whose first analysis packet was created in the period | `evidence_packets.revision = 1`, `evidence_packets.created_at`, `claims.recoverable_cents` |
| M6 | Rejected by our own reviewers (period) | Count and sum of `recoverable_cents` of claims whose latest decision in the period is `REJECT` | `approvals.action = 'REJECT'`, `approvals.created_at` |
| M7 | D&D share disputed | For audited D&D invoices, sum of the linked claims' `recoverable_cents` divided by sum of `total_due_cents`, shown as a percentage with both totals; omitted when the denominator is 0 or any `total_due_cents` is null in the set (the count of excluded invoices is shown) | `dd_invoices.status = 'AUDITED'`, `dd_invoices.total_due_cents`, `dd_invoices.claim_id`, `claims.recoverable_cents` |

### 4.2 Pipeline and stages

| ID | Metric | Definition | Source |
|---|---|---|---|
| S1 | Claims by stage | Count and `recoverable_cents` sum per `status` (all five states) | `claims.status` |
| S2 | Ageing in stage | For each open status, counts in buckets 0-7, 8-30, 31-60 and over 60 days since the claim entered that status. Entry time is the latest `approvals.created_at` for the claim whose `to_status` equals the current status; for `AWAITING_ANALYSIS` it is `claims.created_at`; for `PENDING_REVIEW` without an approval row it is the current packet's `created_at` | `approvals.to_status`, `approvals.created_at`, `claims.created_at`, `evidence_packets.created_at` |
| S3 | Document intake | Count of `import_documents` per `status` created in the period, and the count still `NEEDS_REVIEW` now | `import_documents.status`, `import_documents.created_at` |
| S4 | Analysis failures (period) | Count of audit events `claim.analysis_failed` in the period, grouped by `metadata.reasonCode` | `audit_events.action`, `audit_events.created_at`, `audit_events.metadata` |

### 4.3 Deadline exposure

| ID | Metric | Definition | Source |
|---|---|---|---|
| D1 | D&D mitigation window | For open `OCEAN_DD` claims with a non-null `claims.invoice_date`: days remaining until `invoice_date + 30 days` (`DD_DISPUTE_MIN_DAYS`, the 46 CFR 541.8(a) minimum). Buckets: already past, 0-7, 8-14, over 14 days. Count and `recoverable_cents` per bucket; claims with a null date counted separately as "date missing" | `claims.kind`, `claims.invoice_date`, `claims.status`, `packages/shared/src/ocean-dd/constants.ts` |
| D2 | Freight invoice age | For open `FREIGHT` claims: days since `claims.invoice_date`, buckets 0-30, 31-60, 61-90 and over 90. Labelled "invoice age", **not** deadline, because the schema holds no contract dispute window (gap G2) | `claims.kind`, `claims.invoice_date`, `claims.status` |

D1 uses the regulatory minimum only. A carrier's own tariff may allow more time; the page says "regulatory
minimum" next to the number so nobody reads it as the actual deadline.

S4 reads `audit_events` the way `api/src/audit/analysis-failures.ts` already does (tenant transaction,
`metadata ->> 'reasonCode'`), because `AuditEvent` is not a `TENANT_MODELS` entry.

### 4.4 Leakage

"Leakage" means money billed that our rules say should not have been, or money earned that was not billed,
depending on the claim's `perspective`. For the default shipper view it means overcharges: linehaul above the rate
confirmation, fuel surcharge above the shipper's own fuel table, accessorials the rate confirmation did not
authorise, duplicate lines, totals above the sum of lines, detention billed beyond the supported time, and D&D
charges that fail the tariff or 46 CFR 541 and 545.5. It is always "identified", never "confirmed by the carrier".

| ID | Metric | Definition | Source |
|---|---|---|---|
| L1 | Leakage by billing party (carrier, terminal or forwarder) | Top N carrier keys (default 10, max 50) by `recoverable_cents + pending_review_cents` over claims created in the period, with claim count, identified sum, pending sum and the share of the tenant total; the remainder is one "all other carriers" row | `claims.carrier_name`, `claims.recoverable_cents`, `claims.pending_review_cents`, `claims.created_at` |
| L2 | Leakage by finding type | Over the **current packet only** of each claim created in the period: per `rule_id`, the count of findings, the sum of `amount_cents` where `needs_human_review = false` (identified) and where it is true (pending), split by `direction` | `packet_findings.rule_id`, `.direction`, `.amount_cents`, `.needs_human_review`, `evidence_packets` (current revision), `claims.created_at` |
| L3 | Carrier by finding type | The L2 breakdown for one selected carrier key | as L1 and L2 |
| L4 | Leakage by lane | **Gap G3.** Not shown. A facility view from `extracted_fields.key = 'bol.facility'` is possible later but is not a lane | none |

L2 must not double count. An edit copies every finding into the new revision, so summing findings across all
revisions would multiply amounts by the number of edits. Only the current packet counts.

Rule ids are shown with their human title from `packet_findings.title` (the most recent title per `rule_id`),
for example a linehaul rate above the rate confirmation, unauthorised accessorials or detention beyond free time.

### 4.5 Approval throughput

| ID | Metric | Definition | Source |
|---|---|---|---|
| T1 | Decisions per week | Count of `approvals` rows per ISO week in the period, by `action` (APPROVE, REJECT, SEND_READY, EDIT) | `approvals.action`, `approvals.created_at` |
| T2 | Time to first decision | Median and 90th percentile, in hours, from a packet's `created_at` to the first APPROVE or REJECT row on that packet revision, for decisions made in the period | `evidence_packets.created_at`, `approvals.packet_id`, `approvals.packet_revision`, `approvals.created_at` |
| T3 | Approval to send-ready | Median and 90th percentile, in hours, from the APPROVE row to the SEND_READY row on the same packet revision | `approvals` |
| T4 | Review queue | Count and `recoverable_cents` sum of claims in `PENDING_REVIEW` now, and how many of them have been waiting more than 7 days (S2 entry time) | `claims`, as S2 |
| T5 | Reject rate | REJECT divided by (APPROVE + REJECT) in the period, shown with both counts; omitted below 5 decisions | `approvals.action` |

The page shows team-level numbers only. It does not rank individual reviewers, even though `approvals.actor_id`
would allow it; per-person productivity views are open question Q3.

## 5. Routes and implementation constraints

All routes are new, read-only and follow the existing conventions (`defineRoute`, Zod schemas in a new
`packages/shared/src/insights-dto.ts`, strict outgoing schemas, rate group `intelligence`).

| Method | Path | Access | Query | Returns |
|---|---|---|---|---|
| GET | `/api/v1/insights/summary` | `insights:read` | `from`, `to` (ISO dates), `kind?`, `perspective?` | M1-M7, S1, T4 |
| GET | `/api/v1/insights/stages` | `insights:read` | `kind?`, `perspective?` | S1, S2, S3, S4 (S3 and S4 also take `from`, `to`) |
| GET | `/api/v1/insights/deadlines` | `insights:read` | `kind?`, `perspective?` | D1, D2 |
| GET | `/api/v1/insights/leakage` | `insights:read` | `from`, `to`, `kind?`, `perspective?`, `by` (`carrier` or `rule`), `carrier?`, `limit?` | L1, L2, L3 |
| GET | `/api/v1/insights/throughput` | `insights:read` | `from`, `to`, `kind?`, `perspective?` | T1, T2, T3, T5 |

Web: a new route `/insights` in `web/src/app-root.tsx` and a feature folder `web/src/features/insights/`, shown in
the navigation only when the caller holds `insights:read`. Copy for every money label and the outcome disclaimer
lives in `packages/shared/src/honest-copy.ts`.

Constraints:

- No new table, column, migration, trigger or tenant model. The page reads existing data only.
- Every query runs through `ctx.db` (tenant transaction); no system-mode access.
- Reads are not audited, matching `GET /api/v1/claims`. Exports of these numbers, if added later, are audited
  like the existing export routes.
- Query cost: periods are capped at 366 days and `limit` at 50. Existing indexes cover `claims (tenant_id,
  status)`, `(tenant_id, created_at)` and `approvals (tenant_id, claim_id, created_at)`. `claims.carrier_name`
  has no index; the planner decides whether L1 needs one after measuring on the seeded data set.

## 6. Gaps: what executives will ask for that the data model cannot answer

| ID | Wanted metric | Why it is missing | Smallest data addition that would close it |
|---|---|---|---|
| G1 | **Recovered dollars** (credited or paid by the carrier), recovery rate, time to payment | Nothing is recorded after `SEND_READY` (ADR 0007) | A tenant table `claim_outcomes` (claim id, sent at, channel, carrier response, credited cents, paid cents, closed at, evidence document), append-only, with RLS and audit, entered by a person |
| G2 | Freight dispute deadlines | No contract or tariff dispute window is stored for truck freight | A per-carrier or per-contract `dispute_window_days` on a new tenant table, or a deadline field on the claim set at analysis |
| G3 | Leakage by lane | Claims and extracted fields have no origin or destination | Two extracted keys (`origin`, `destination`, normalised to city and state or UN/LOCODE) and two claim columns |
| G4 | Carrier win rate and response time | Depends on G1 | G1 |
| G5 | Cost of recovery and ROI against the scoup.ai fee | No billing, plan or fee data in the product | A billing integration; out of scope for the product database |
| G6 | Breakdown by business unit, site or team | No Team model (assumption A4) | A Team model with claim ownership |
| G7 | Exact point-in-time history of the open backlog | Claim amounts are current values; status history is reconstructable from `approvals`, amounts are not | Nightly snapshot rows, or accept reconstruction from status history only |
| G9 | Overcharge as a share of audited freight spend | Claims hold only the disputed amounts; the invoice total sits in `extracted_fields` (`invoice.total`) of linked documents and is not a claim column, and invoices with no finding never become claims | A claim column for the audited invoice total set at analysis, plus a record for invoices audited with no finding |
| G10 | Invoice payment due dates (short-pay before paying) | A shipper's leverage is to short-pay before the due date; freight invoices carry no due date in the extraction vocabulary | An `invoice.due_date` extracted field and claim column |
| G8 | Benchmarks against other customers | Deliberately absent: tenants never see other tenants' data (ADR 0002) | Not proposed |

Until G1 exists, the page must not show any figure called "recovered", "saved" or "won".

## 7. Acceptance criteria

Each criterion is written to become one or more tests. "Seed" means a synthetic fixture created by the test.
Times use a fixed clock `now`.

**Access and isolation**

- **AC-ED-01** Given a user with role OWNER, ADMIN, MANAGER or VIEWER, when they call each of the five
  `/api/v1/insights/*` routes with valid parameters, then each answers 200.
- **AC-ED-02** Given a user with role REVIEWER or ANALYST, when they call any insights route, then it answers 403
  and an `authz.denied` audit event is written (until Q1 changes the matrix).
- **AC-ED-03** Given a PLATFORM_DEV or SUPER_ADMIN user, when they call any insights route, then it answers 403.
- **AC-ED-04** Given a valid tenant API key with all three scopes, when it calls any insights route, then it
  answers 403.
- **AC-ED-05** Given no credentials, when any insights route is called, then it answers 401.
- **AC-ED-06** Given tenant A and tenant B each seeded with claims, when a tenant A user calls every insights
  route, then no response number changes when tenant B's amounts are multiplied by 1,000 and re-seeded.
- **AC-ED-07** `PERMISSION_MATRIX` grants `insights:read` to exactly OWNER, ADMIN, MANAGER and VIEWER, and the
  RBAC route-by-role test covers the five new routes.
- **AC-ED-08** Given the web app signed in as REVIEWER, ANALYST or a platform role, then no navigation item
  links to `/insights`, and opening `/insights` directly shows the existing forbidden state.

**Validation**

- **AC-ED-09** When `from` is not earlier than `to`, or the period exceeds 366 days, or `limit` exceeds 50, or
  `kind` or `by` has an unknown value, then the route answers 400 `validation_error` and lists only field paths
  and codes.

**Money**

- **AC-ED-10** Given seeded claims with known `recoverable_cents` in each of the five statuses, then M1 equals
  the sum over `AWAITING_ANALYSIS`, `PENDING_REVIEW` and `APPROVED` only.
- **AC-ED-11** Given a claim with `pending_review_cents > 0`, then that amount appears in M2 and in no other
  money metric.
- **AC-ED-12** Given SEND_READY approvals at exactly `from` and at exactly `to`, then M4 includes the first and
  excludes the second.
- **AC-ED-13** Given audited D&D invoices where one has a null `total_due_cents`, then M7 is omitted and the
  response states one excluded invoice; with all totals present, M7 equals the linked claims' identified sum
  divided by the invoices' total due.
- **AC-ED-14** Given `kind=OCEAN_DD`, then every metric counts only claims with `kind = 'OCEAN_DD'`; with no
  `kind`, both kinds count. Given `perspective=SHIPPER`, only `SHIPPER` claims count; the web page sends
  `perspective=SHIPPER` on first load and shows a control to change it.

**Stages and deadlines**

- **AC-ED-15** S1 returns all five statuses, including statuses with zero claims (count 0, sum 0).
- **AC-ED-16** Given a claim that moved to `APPROVED` 10 days before `now`, then S2 places it in the 8-30 day
  bucket of `APPROVED`; given an `AWAITING_ANALYSIS` claim created 2 days before `now`, then S2 uses
  `claims.created_at` and places it in 0-7.
- **AC-ED-17** Given open `OCEAN_DD` claims with `invoice_date` 25 and 31 days before `now`, then D1 places the
  first in 0-7 (5 days remaining) and the second in "already past"; a claim with a null `invoice_date` is counted
  only under "date missing".
- **AC-ED-18** D2 counts only open `FREIGHT` claims, never `SEND_READY` or `REJECTED` ones, and the response and
  UI label it "invoice age", never "deadline".
- **AC-ED-19** The D1 label in the UI includes the words "regulatory minimum" and cites 46 CFR 541.8(a).

**Leakage**

- **AC-ED-20** For L1, the top-N rows plus the "all other carriers" row sum exactly to the tenant total of
  `recoverable_cents + pending_review_cents` for the period.
- **AC-ED-21** Given claims with carrier names `"ACME Freight "` and `"acme freight"`, then L1 shows one group.
- **AC-ED-22** Given a claim whose packet was edited twice (three revisions, identical findings), then L2 counts
  each of its findings exactly once.
- **AC-ED-23** L2 splits each rule's amount into identified (`needs_human_review = false`) and pending
  (`needs_human_review = true`). As a consistency check, the identified amount in each claim's own direction
  (OVERCHARGE for `SHIPPER`, UNDERBILLED for `CARRIER`) summed over the same claims equals the sum of their
  `claims.recoverable_cents`; any rule where the engines define the total differently is recorded by the planner
  as a named exception, not loosened.
- **AC-ED-24** No insights response contains a lane, origin or destination field, and the UI shows G3 as "not
  tracked yet".

**Throughput**

- **AC-ED-25** T1 buckets decisions by ISO week in UTC and reports all four actions, with zero-count weeks
  present inside the period.
- **AC-ED-26** T2 measures from the decided revision's `created_at`; given an edit that creates revision 2, the
  clock for revision 2 starts at revision 2's `created_at`, not revision 1's.
- **AC-ED-27** T5 is omitted when the period has fewer than 5 APPROVE plus REJECT decisions.
- **AC-ED-28** No insights response or UI view lists individual users or `actor_id` values.

**Honesty, determinism and safety**

- **AC-ED-29** Every money figure in the rendered page carries one of the labels "identified", "pending review",
  "approved" or "ready to demand"; the words "recovered", "saved" and "won" appear only in the fixed disclaimer
  that says recovery outcomes are not tracked yet.
- **AC-ED-30** Given the same seeded data and the same `now`, two calls to each route return byte-identical
  bodies.
- **AC-ED-31** Calling all five routes changes no row in any table and appends no audit event other than
  `authz.denied` for refused callers.
- **AC-ED-32** The change adds no migration folder and leaves `api/prisma/schema.prisma` unchanged.
- **AC-ED-33** Exceeding `RATE_LIMIT_INTELLIGENCE_MAX` on the insights routes answers 429 with `Retry-After`.
- **AC-ED-34** A tenant with no claims gets 200 with zeros and empty lists from every route, and the UI shows
  empty states instead of errors.

Count: 34 acceptance criteria.

## 8. Open questions for the owner

- **Q1** Should REVIEWER and ANALYST also hold `insights:read`? They can already read every claim; the question is
  only about page clutter and who the page is for.
- **Q2** Should a read-only API-key scope (for example `insights.read`) exist so a customer can pull these numbers
  into their BI tool? That widens the machine surface (ADR 0006).
- **Q3** Do customers want per-reviewer throughput? It is computable from `approvals.actor_id` but invites
  surveillance concerns; this spec leaves it out.
- **Q4** Should G1 (`claim_outcomes`) be built before this page ships, so the first executive view can show real
  recovered money? Without it the page answers "found and approved", not "got back".
- **Q5** Is the 46 CFR 541.8(a) 30-day minimum the right default for D1, or should D1 wait for tariff-specific
  windows from `dd_tariffs.data`?
