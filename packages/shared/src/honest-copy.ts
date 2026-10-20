/**
 * Fixed texts (Q8). The single source for every label the API returns and every note the UI renders on
 * the Dev dashboard and the Recovery intelligence screens. Each text states the basis of what is shown;
 * none claims learning, speed-up or accuracy.
 */

const WORKLIST_NOTE_TEMPLATE =
  "Ranked by a fixed formula over this tenant's own claim data: confirmed recoverable amount plus {W}% of the amount still pending human review. This is a work-order aid, not a forecast of what will be recovered.";

/** WORKLIST_NOTE with `{W}` substituted (W = integer percent 0..100). */
export function worklistNote(w: number): string {
  if (!Number.isInteger(w) || w < 0 || w > 100) throw new RangeError('worklistNote: W must be an integer 0..100');
  return WORKLIST_NOTE_TEMPLATE.replace('{W}', String(w));
}

export const WORKLIST_NOTE = WORKLIST_NOTE_TEMPLATE;

export const SIMILAR_NOTE =
  "Similar claims are matched by fixed rules on this tenant's own data. Final status shows how your team handled the claim, not whether the carrier paid.";

export const PROVENANCE_NOTE = 'Confidence is a rule-based parse score, not an accuracy measure.';

export const NO_ACCURACY_NOTE = 'No accuracy figures are shown because none have been measured on real customer data.';

export const EVAL_NOTE =
  'Results are computed on synthetic fixtures checked into the repository. They test whether the pipeline reproduces known answers and whether repeated runs agree. They are not an accuracy measure on real customer documents.';

export const EVAL_DETERMINISTIC_NOTE =
  'Every case produced identical output on all runs, so pass^k equals pass^1 for this deterministic pipeline.';

export const TELEMETRY_NOTE = 'Counters cover this API instance since it started and reset on restart.';

export const LOGS_NOTE = 'Recent records from this API instance only. Messages and fields are filtered; customer data is never shown.';

export const PIPELINE_NOTE =
  'Aggregates across all tenants. No customer data is shown. Files rejected before storage appear only in request telemetry.';

// ---------------------------------------------------------------------------------------------
// REQ-20261018-exec-dashboard: executive insights page. Rendered verbatim by the web; the D1/D2 labels are
// also the API `label` fields. Outcome words appear only in INSIGHTS_OUTCOME_DISCLAIMER.
// ---------------------------------------------------------------------------------------------

export const INSIGHTS_OUTCOME_DISCLAIMER =
  'Credited and paid amounts are outcomes your team typed in by hand; nothing is reconciled against payments. Every other amount on this page was identified in carrier or terminal invoices, is pending your review, or was approved for a demand by your team. None of it is money recovered, saved or won.';

export const INSIGHTS_TEXT = Object.freeze({
  title: 'Insights',
  forbidden: 'You do not have permission to view insights.',
  empty: 'No claims match these filters.',
  ddWindowLabel:
    'Days left in the regulatory minimum dispute window: 46 CFR 541.8(a) gives at least 30 calendar days from the invoice date. A carrier tariff may allow more.',
  invoiceAgeLabel: 'Freight invoice age: days since the invoice date. No dispute window is stored for truck freight.',
  billingParty: 'Billing party',
  notTrackedHeading: 'Not tracked yet',
  periodNote: 'Period: from the start date up to, not including, the end date (UTC).',
  intakeScopeNote: 'Document counts cover all imported documents; the claim type and perspective filters do not apply.',
} as const);

export interface InsightsNotTracked {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

export const INSIGHTS_NOT_TRACKED: readonly InsightsNotTracked[] = Object.freeze([
  Object.freeze({ id: 'G1', title: 'Money paid or credited by carriers, reconciled', reason: 'Only outcomes typed in by your team are recorded; no remittance or payment data is matched to claims.' }),
  Object.freeze({ id: 'G2', title: 'Freight dispute windows', reason: 'No contract or tariff dispute window is stored for truck freight.' }),
  Object.freeze({ id: 'G3', title: 'Leakage by lane', reason: 'Claims have no origin or destination.' }),
  Object.freeze({ id: 'G4', title: 'Carrier response time', reason: 'Outcomes carry the dates your team entered, not when the carrier actually answered.' }),
  Object.freeze({ id: 'G5', title: 'Cost and return of using this service', reason: 'No billing or fee data is held in the product.' }),
  Object.freeze({ id: 'G6', title: 'Breakdown by business unit, site or team', reason: 'Claims are not assigned to teams.' }),
  Object.freeze({ id: 'G7', title: 'Exact history of the open backlog', reason: 'Amounts are current values; past amounts are not stored.' }),
  Object.freeze({ id: 'G8', title: 'Comparisons with other companies', reason: "Not offered: your data is never compared with other customers' data." }),
  Object.freeze({
    id: 'G9',
    title: 'Overcharge as a share of audited freight spend',
    reason: 'Invoices audited with no finding are counted only when your team records them, and invoice totals are not stored on claims.',
  }),
  Object.freeze({ id: 'G10', title: 'Invoice payment due dates', reason: 'Freight invoices are read without a payment due date.' }),
]);
