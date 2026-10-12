/**
 * Fixed UI copy of the step-5 analysis actions (Part C P10). The web renders these texts verbatim; none
 * claims accuracy: findings are rule outputs on extracted fields that need human review.
 */

export const ANALYSIS_NOTE = 'Runs fixed rules on the accepted document fields. Findings are drafts for human review, not verified results.';

export const ANALYZE_AUTHOR_NOTE = 'You will be recorded as the author of revision 1, so another approver must approve it.';

export const ANALYSIS_TEXT = Object.freeze({
  button: 'Analyze claim',
  busy: 'Analyzing...',
  success: 'Analysis complete. Revision 1 is ready for review.',
  conflict: 'This claim is no longer awaiting analysis or has no accepted documents. Reload to continue.',
  invalid: 'The extracted values of this claim cannot be analysed automatically.',
  forbidden: 'You do not have permission to analyze claims.',
  rateLimited: 'Too many requests. Try again later.',
  failed: 'Analysis failed. Try again.',
  bulkButton: 'Analyze awaiting claims',
  bulkTitle: 'Analyze awaiting claims',
  bulkIntro: 'Analyzes up to 10 claims awaiting analysis, oldest first.',
  bulkConfirm: 'Analyze',
  bulkCancel: 'Cancel',
  bulkClose: 'Close',
  bulkSummary: (a: number, s: number, f: number, r: number): string => `Analyzed ${a}. Skipped ${s}. Could not analyze ${f}. ${r} still awaiting analysis.`,
  bulkFailedPrefix: 'Could not analyze: ',
});
