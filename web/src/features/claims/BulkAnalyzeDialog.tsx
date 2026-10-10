import { ANALYSIS_NOTE, ANALYSIS_TEXT, ANALYZE_AUTHOR_NOTE, ANALYZE_BATCH_DEFAULT, BulkAnalyzeResponse, type BulkAnalyzeResponseDto } from '@fr/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { useApi } from '../../app-context';
import { Dialog } from '../../components/ui/Dialog';
import { SafeText } from '../../components/ui/SafeText';

import { analyzeErrorText } from './AnalyzeClaimSection';

/**
 * Bulk analyze dialog (step 5, S2/P10): analyzes up to 10 AWAITING_ANALYSIS claims, oldest first, and
 * shows the per-request summary. Claim numbers are untrusted text (SafeText).
 */
export function BulkAnalyzeDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const introId = useId();
  const [result, setResult] = useState<BulkAnalyzeResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The Analyze/Cancel buttons are replaced by Close once a result is shown: keep focus inside the dialog.
  useEffect(() => {
    if (result) closeRef.current?.focus();
  }, [result]);
  const run = useMutation({
    mutationFn: () => api.post('/api/v1/claims/analyze-awaiting', { limit: ANALYZE_BATCH_DEFAULT }, BulkAnalyzeResponse),
    onMutate: () => setError(null),
    onSuccess: async (r) => {
      setResult(r);
      await Promise.all([['claims'], ['approvals']].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    onError: (e) => setError(analyzeErrorText(e)),
  });

  return (
    <Dialog title={ANALYSIS_TEXT.bulkTitle} onClose={onClose} describedBy={introId}>
      <div className="flex flex-col gap-3">
        <p id={introId}>{ANALYSIS_TEXT.bulkIntro}</p>
        <p className="muted text-sm">{ANALYSIS_NOTE}</p>
        <p className="muted text-sm">{ANALYZE_AUTHOR_NOTE}</p>
        {result ? (
          <div role="status" className="rounded-md bg-[var(--color-surface)] p-3 text-sm">
            <p>{ANALYSIS_TEXT.bulkSummary(result.analyzed.length, result.skipped.length, result.failed.length, result.remaining)}</p>
            {result.failed.length > 0 ? (
              <p>
                {ANALYSIS_TEXT.bulkFailedPrefix}
                <SafeText value={result.failed.map((f) => f.claimNumber).join(', ')} />
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {result ? (
            <button ref={closeRef} type="button" className="btn" onClick={onClose}>
              {ANALYSIS_TEXT.bulkClose}
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                {ANALYSIS_TEXT.bulkCancel}
              </button>
              <button type="button" className="btn btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>
                {run.isPending ? ANALYSIS_TEXT.busy : ANALYSIS_TEXT.bulkConfirm}
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
