# Claim outcomes: recording what happened after "ready to demand"

> **Status: implemented (REQ-20261020-claim-outcomes), pre-product, synthetic data only.** Outcomes are
> entered by people. There is no automatic reconciliation against carrier remittances, credit notes, bank
> feeds or accounting systems, and no outbound network path exists to fetch any of that. Every figure the
> Recovery section shows is therefore "what your team typed in", and the user-visible copy says so.

## 1. Why a table, and why human-entered

The claim lifecycle ends at `SEND_READY`: after a demand is marked ready, the schema recorded nothing
(ADR 0007 gap, see `docs/innovation-thesis.md` on the hosted-platform branch and the insights page's "not
tracked" list, G1/G4/G9). Without an outcome record the product cannot say whether an identified amount was
ever accepted, credited or paid, so no learned ranking, carrier-acceptance figure or recovery rate can be
built on honest ground.

The smallest honest step is a **human-entered, append-only** record per claim. Human-entered because the
product holds no payment data and must not pretend to; append-only because an outcome is a statement made by a
named person at a point in time (a correction is a new statement, the latest one counts), and because the
existing audit model (`approvals`, `audit_events`) already works that way.

## 2. The table `claim_outcomes` (migration `20261020000000_claim_outcomes`)

| Column | Type | Rule |
| --- | --- | --- |
| `id`, `tenant_id`, `claim_id` | uuid | composite FK `(claim_id, tenant_id) -> claims(id, tenant_id)`, `ON DELETE RESTRICT`; unique `(id, tenant_id)` |
| `kind` | text | `OUTCOME` (default) or `AUDITED_NO_FINDING` (CHECK). The second kind records that an invoice was audited and nothing was found, so audited volume can be counted (G9). Chosen over a boolean so a third kind can be added without a column change. |
| `recorded_by_id`, `recorded_at` | uuid, timestamptz | the person and the moment of the entry (server clock) |
| `sent_at` | timestamptz, null | when the demand was sent, as entered |
| `channel` | text | `EMAIL`, `PORTAL`, `PHONE`, `MAIL`, `OTHER` (CHECK) |
| `carrier_response` | text | `NONE_YET`, `ACCEPTED`, `PARTIAL`, `REJECTED`, `DISPUTED`, `WITHDRAWN` (CHECK) |
| `credited_cents`, `paid_cents` | integer, null | `>= 0` (CHECK); null means "not entered", never zero |
| `closed_at` | timestamptz, null | when the team considers the claim closed |
| `note` | text | at most 500 characters (CHECK); single line, control and bidi characters refused by the API |
| `version` | integer | `>= 1`; always 1 because rows are never updated |

Consistency CHECK `claim_outcomes_kind_consistent`: an `AUDITED_NO_FINDING` row has `channel = 'OTHER'`,
`carrier_response = 'NONE_YET'`, no `sent_at` and no amounts.

Guards: `claim_outcomes_append_only` and `claim_outcomes_no_truncate` (`fr_append_only`, every role);
`claim_outcomes_guard` (`BEFORE INSERT`, `SECURITY DEFINER`, tenant matched explicitly): `OUTCOME` needs a claim
in `SEND_READY`, `AUDITED_NO_FINDING` any analysed claim (`status <> 'AWAITING_ANALYSIS'`); a claim of another
tenant or a missing claim raises `claim_outcome_claim_invalid`. Security: `ENABLE` + `FORCE ROW LEVEL SECURITY`,
policy `claim_outcomes_tenant_isolation` (`tenant_id = fr_current_tenant()`), `REVOKE ALL FROM PUBLIC`,
`GRANT SELECT, INSERT` to `freight_app` (no UPDATE, DELETE or TRUNCATE). In `TENANT_MODELS` and `TenantTx`.

## 3. API

- `GET /api/v1/claims/:id/outcomes` (`claims:read`): newest first, at most 200 rows, `recordedBy` id and name.
- `POST /api/v1/claims/:id/outcomes` (`outcomes:record`: OWNER, ADMIN, MANAGER, REVIEWER): strict body
  `ClaimOutcomeBody` (a discriminated union on `kind`), 201 with the row, 409 `invalid_state` when the claim is
  not in the right state, 404 for an unknown id and, byte for byte the same, for another tenant's id. The write
  runs under the claim row lock (`lockClaimForUpdate`), appends `claim.outcome_recorded` (kind, channel, response,
  cents, instants, outcome id; never the note) and commits with it. No API-key scope; Origin and CSRF checks apply.
- `GET /api/v1/insights/recovery` (`insights:read`): the Recovery section (section 4).

## 4. The Recovery section of the executive dashboard

Over the period (`recorded_at` in `[from, to)`), the **latest `OUTCOME` row of each claim** decides that claim's
response. The section reports: claims with an outcome and their identified cents; the same by response;
credited and paid cents with the number of claims that carry a value; the recovery rate as floored basis points
of `credited / identified` (null when nothing was identified); the per-finding-type table; reviewer hours; and
the count of claims with an `AUDITED_NO_FINDING` row.

- **By finding type.** Credited money belongs to a claim, not to a finding. A claim whose current packet holds
  exactly one `rule_id` contributes to that rule's row; a claim with several rule ids goes into one "Several
  finding types" row instead of being split by a formula. Findings are counted as sent, accepted, partly accepted
  or rejected by the claim's latest response.
- **Reviewer hours** are an approximation stated in the UI: for each claim with an outcome, the time from the
  creation of its current evidence packet to its latest `SEND_READY` approval, floored at 0 and capped at 8 hours
  per claim (so idle calendar time does not inflate it). Credited cents per reviewer-hour is credited cents
  divided by that sum, floored. It is not time tracking and the copy says so.

The `basis` field of the response is the literal `human_entered`.

## 5. Not done, by design

- No reconciliation, import or integration of payment data; the "not tracked" list on the insights page still
  names it (G1 reworded).
- Outcomes are not part of the claims CSV/XLSX export: its column list is pinned byte-exact by the acceptance
  oracle (`exp-basic`, `exports.int`), so adding columns means a contract change for the export consumers. The
  per-claim list route and the Recovery section are the readers for now.
- No edit or delete, anywhere. A wrong entry is corrected by a new entry.