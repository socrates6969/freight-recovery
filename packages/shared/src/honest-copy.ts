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
