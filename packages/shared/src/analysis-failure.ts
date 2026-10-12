/**
 * Hardening (REQ-20261012-hardening, C4.1): reason codes of a refused analysis (422 analysis_input_invalid).
 * A leaf module (no imports) so both `dto.ts` (ClaimDetail) and `analysis-dto.ts` can use it without an
 * import cycle; re-exported from the package root through `analysis-dto.ts`.
 */
export const ANALYSIS_FAILURE_REASONS = ['input_values', 'amount_out_of_range', 'fuel_check'] as const;
export type AnalysisFailureReason = (typeof ANALYSIS_FAILURE_REASONS)[number];

/** True iff `v` is one of ANALYSIS_FAILURE_REASONS. */
export function isAnalysisFailureReason(v: unknown): v is AnalysisFailureReason {
  return typeof v === 'string' && (ANALYSIS_FAILURE_REASONS as readonly string[]).includes(v);
}
