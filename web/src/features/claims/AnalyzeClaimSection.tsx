import { ANALYSIS_FAILURE_TEXT, ANALYSIS_NOTE, ANALYSIS_TEXT, ANALYZE_AUTHOR_NOTE, isAnalysisFailureReason } from '@fr/shared';

import { ApiError } from '../../api/client';

/** Fixed alert text for a failed analyze request (P10): never the server's message. */
export function analyzeErrorText(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 409) return ANALYSIS_TEXT.conflict;
  if (status === 422) {
    // Hardening (C7.2): the reason code in `details` selects a fixed text; anything else falls back.
    const d = e instanceof ApiError ? e.details[0] : undefined;
    return d && d.path === 'analysis' && isAnalysisFailureReason(d.code) ? ANALYSIS_FAILURE_TEXT[d.code] : ANALYSIS_TEXT.invalid;
  }
  if (status === 403) return ANALYSIS_TEXT.forbidden;
  if (status === 429) return ANALYSIS_TEXT.rateLimited;
  return ANALYSIS_TEXT.failed;
}

/**
 * Analyze action of an AWAITING_ANALYSIS claim (step 5, P10): the button, the fixed notes (findings are
 * drafts for human review; the requester becomes the revision-1 author) and an inline alert on error.
 * Rendered only for users holding `claims:analyze` (the server enforces the permission).
 */
export function AnalyzeClaimSection({ pending, errorText, onAnalyze }: { pending: boolean; errorText: string | null; onAnalyze: () => void }) {
  return (
    <section aria-label="Analysis" className="mt-4 flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
      <div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={onAnalyze}>
          {pending ? ANALYSIS_TEXT.busy : ANALYSIS_TEXT.button}
        </button>
      </div>
      <p className="muted text-sm">{ANALYSIS_NOTE}</p>
      <p className="muted text-sm">{ANALYZE_AUTHOR_NOTE}</p>
      {errorText ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {errorText}
        </p>
      ) : null}
    </section>
  );
}
