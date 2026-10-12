/**
 * Hardening (REQ-20261012-hardening, Part C C6): fixed transparency copy rendered verbatim by the web app (as
 * text nodes). Lives outside the frozen engine directories so their pins stay unchanged; every existing copy
 * constant keeps its value. No string here makes a measured-quality claim.
 */
import type { AnalysisFailureReason } from './analysis-failure.js';
import type { FourEyesClaimBasis } from './four-eyes.js';

/** Why an analysis could not be stored (C4.1), by reason code. */
export const ANALYSIS_FAILURE_TEXT: Readonly<Record<AnalysisFailureReason, string>> = Object.freeze({
  input_values:
    'The extracted values of this claim cannot be analysed automatically. Accepted documents cannot be changed, so the claim stays awaiting analysis.',
  amount_out_of_range: 'The computed amounts are negative or larger than the product can store, so nothing was saved.',
  fuel_check: 'The fuel check produced amounts that cannot be stored. Clear the fuel inputs or choose another fuel table, then analyze again.',
});

/** The persistent claim-sheet note about failed analyses (C7.2). */
export function analysisFailureNote(lastFailedAtDisplay: string, failedAttempts: number, reasonText: string): string {
  return `Last analysis attempt failed on ${lastFailedAtDisplay} (${failedAttempts} failed attempt${failedAttempts === 1 ? '' : 's'} so far). ${reasonText}`;
}

/** Bulk dialog intro (C7.4). */
export const BULK_ANALYZE_INTRO =
  'Analyzes up to 10 claims awaiting analysis, oldest first. Claims whose analysis failed before are tried after the others.';

/** Why a bulk run stopped (C5.2). */
export const BULK_STOPPED_TEXT: Readonly<Record<'limit' | 'budget' | 'candidates', string>> = Object.freeze({
  limit: 'Stopped after the batch limit.',
  budget: 'Stopped early: your analysis budget is used up for now. Try again later.',
  candidates: 'All candidate claims in this run were tried.',
});

/** Shown instead of Approve/Reject, by the four-eyes basis that applies to the viewer (C7.1). */
export const FOUR_EYES_CLAIM_BASIS_TEXT: Readonly<Record<FourEyesClaimBasis, string>> = Object.freeze({
  revision_author: 'You created a revision of this claim (by editing, analyzing or running the D&D audit). Another approver must approve it.',
  dd_invoice_editor: 'You entered or edited the D&D invoice of this claim. Another approver must approve it.',
  label_author: 'You set a team charge label that influenced this analysis. Another approver must approve it.',
});

/** A finding's confidence is a fixed per-rule setting, not a probability (C7.3). */
export function findingConfidenceText(confidence: number): string {
  return `rule setting ${confidence.toFixed(2)} (fixed per rule; not a measured probability)`;
}

/** Charges tab: team labels recorded by the analysis (C7.5). */
export const LEARNED_INFLUENCE_TEXT = Object.freeze({
  heading: 'Team labels that influenced this analysis',
  none: 'No team label influenced this analysis.',
  deleted: 'Deleted label',
  note: 'A team label can only move findings to human review or add review items. It never adds confirmed money.',
});

/** A label PUT answered 409 conflict (C8.1). */
export const CHARGE_LABEL_CONFLICT_TEXT = 'This label was changed at the same time by someone else. Reload and try again.';

/** A fuel-table create answered 409 fuel_table_limit_reached (C7.6). */
export const FUEL_TABLE_LIMIT_TEXT = 'This organization has reached the maximum of 50 fuel tables. Archived tables count toward this limit.';

/** How a D&D preset's figures were checked (C7.7). */
export const DD_PRESET_VERIFICATION_TEXT = Object.freeze({
  primary: "Checked against the carrier's published tariff document.",
  primary_search_extract:
    "Read from the carrier's published tariff through a search-engine extract; the document itself was not downloaded. Verify before use.",
  secondary: "Reported by a trade publication, not the carrier's own tariff. Verify against the carrier's tariff before use.",
});

/** Where the active price import came from (C8.2), by source kind. */
export const PRICE_SOURCE_KIND_TEXT = Object.freeze({
  fetch: 'Downloaded from FRED by the import command.',
  bundled: 'From the files bundled with the product, checked against their pinned sha256.',
  file: 'Imported from a file supplied by the operator; the product did not download it.',
});
