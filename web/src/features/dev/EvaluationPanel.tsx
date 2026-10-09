import { EVAL_DETERMINISTIC_NOTE, EVAL_NOTE } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useApi } from '../../app-context';
import { Dialog } from '../../components/ui/Dialog';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime } from '../../lib/format';

import { DEV_QUERY, ErrorState, Labelled, Loading, RefreshButton, percent1 } from './dev-common';

function RunDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['dev', 'eval-run', id], queryFn: () => api.evalRun(id), ...DEV_QUERY });
  const d = q.data;
  return (
    <Dialog title={`Run ${id.slice(0, 8)}`} onClose={onClose} wide>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !d ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="muted text-sm">{EVAL_NOTE}</p>
          <dl>
            <Labelled label="Cases">{d.cases}</Labelled>
            <Labelled label="Runs per case (k)">{d.k}</Labelled>
            <Labelled label="Per-run pass rate">{percent1(d.perRunPassRate)}</Labelled>
            <Labelled label="Cases passing all k runs">{d.passHatKCount}</Labelled>
            <Labelled label="pass^k">{percent1(d.passHatK)}</Labelled>
            <Labelled label="95% interval (Wilson)">{`${percent1(d.wilson95.low)} - ${percent1(d.wilson95.high)}`}</Labelled>
            <Labelled label="Flaky cases">{d.flakyCaseCount}</Labelled>
          </dl>
          {d.deterministicCases === d.cases ? <p className="text-sm">{EVAL_DETERMINISTIC_NOTE}</p> : null}
          <table className="data-table text-sm" aria-label="Case results">
            <thead>
              <tr>
                {['Case', 'Category', 'Passed', 'Distinct outputs', 'First failure'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.results.map((r) => (
                <tr key={r.caseId}>
                  <td className="break-anywhere font-mono text-xs">
                    <SafeText value={r.caseId} />
                  </td>
                  <td>
                    <SafeText value={r.category} />
                  </td>
                  <td className="num">{`${r.runsPassed}/${r.k}`}</td>
                  <td className="num">{r.distinctOutputs}</td>
                  <td>{r.firstFailureCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

export function EvaluationPanel() {
  const api = useApi();
  const q = useQuery({ queryKey: ['dev', 'eval-runs'], queryFn: () => api.evalRuns(), ...DEV_QUERY });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Evaluation runs</h2>
        <RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />
      </div>
      <p className="muted mb-3 text-sm">{EVAL_NOTE}</p>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : q.data.items.length === 0 ? (
        <p className="muted">No evaluation runs recorded.</p>
      ) : (
        <table className="data-table text-sm" aria-label="Runs">
          <thead>
            <tr>
              {['Run', 'Set', 'k', 'Cases', 'pass^k', 'Finished', 'Details'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs">{r.id.slice(0, 8)}</td>
                <td>
                  <SafeText value={`${r.evalSetId} v${r.evalSetVersion}`} />
                </td>
                <td className="num">{r.k}</td>
                <td className="num">{r.cases}</td>
                <td className="num">{percent1(r.passHatK)}</td>
                <td>{formatDateTime(r.finishedAt)}</td>
                <td>
                  <button type="button" className="btn" onClick={() => setOpen(r.id)}>
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open ? <RunDialog id={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
