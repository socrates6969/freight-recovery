/** Claim sheet tabs "Similar" and "Provenance" (Q12). All values are rendered as text from the API. */
import { PROVENANCE_NOTE, SIMILAR_NOTE } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ApiError, step4ErrorText } from '../../api/client';
import { useApi } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

const DOC_TYPE_LABEL: Record<string, string> = { INVOICE: 'Invoice', RATE_CONFIRMATION: 'Rate confirmation', BILL_OF_LADING: 'Bill of lading', OTHER: 'Other' };

/** computeMs with at most one decimal (e.g. 3.456 -> "3.5", 2 -> "2"). */
export function computeMsText(ms: number): string {
  return String(Math.round(ms * 10) / 10);
}

function minConfidenceText(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

const is404 = (e: unknown) => e instanceof ApiError && e.status === 404;

export function SimilarPanel({ claimId, onUnavailable }: { claimId: string; onUnavailable: () => void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['similar', claimId], queryFn: () => api.similar(claimId, 5), retry: false });
  useEffect(() => {
    if (q.isError && is404(q.error)) onUnavailable();
  }, [q.isError, q.error, onUnavailable]);
  const d = q.data;
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">Similar past claims</h3>
      <p className="muted mb-3 text-sm">{SIMILAR_NOTE}</p>
      {q.isError ? (
        <p role="alert">{step4ErrorText(q.error)}</p>
      ) : !d ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <>
          {d.items.length === 0 ? (
            <p className="muted">{d.reason === 'no_packet' ? 'No evidence packet yet, so nothing to compare.' : 'No similar past claims found.'}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {d.items.map((it) => (
                <li key={it.claim.id} aria-label={it.claim.claimNumber} className="card p-3 text-sm">
                  <p className="font-medium">
                    <SafeText value={it.claim.claimNumber} /> <span className="badge badge-accent">{`${it.similarityPercent}% similar`}</span>
                  </p>
                  <p className="muted">
                    <SafeText value={it.claim.carrierName} />
                  </p>
                  <p className="mt-1 text-xs font-semibold">Why similar</p>
                  <ul className="list-disc pl-4" aria-label="Why similar">
                    {it.matches.map((m) => (
                      <li key={m.key}>
                        <SafeText value={m.detail} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">{`Handled as ${it.handling.finalStatus}`}</p>
                </li>
              ))}
            </ul>
          )}
          {d.reason === 'no_packet' ? null : <p className="muted mt-3 text-xs">{`Computed in ${computeMsText(d.computeMs)} ms over ${d.candidatesConsidered} claims`}</p>}
        </>
      )}
    </section>
  );
}

export function ProvenancePanel({ claimId, onUnavailable }: { claimId: string; onUnavailable: () => void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['provenance', claimId], queryFn: () => api.provenance(claimId), retry: false });
  useEffect(() => {
    if (q.isError && is404(q.error)) onUnavailable();
  }, [q.isError, q.error, onUnavailable]);
  const d = q.data;
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">Provenance</h3>
      <p className="muted mb-3 text-sm">{PROVENANCE_NOTE}</p>
      {q.isError ? (
        <p role="alert">{step4ErrorText(q.error)}</p>
      ) : !d ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : d.documents.length === 0 ? (
        <p className="muted">No source documents are linked to this claim.</p>
      ) : (
        <table className="data-table text-sm" aria-label="Source documents">
          <thead>
            <tr>
              {['Document', 'Type', 'Fields', 'Confirmed', 'Corrected', 'Rejected', 'Needs review', 'Lowest confidence'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.documents.map((doc) => (
              <tr key={doc.documentId}>
                <td className="max-w-56">
                  <SafeText value={doc.displayName} />
                </td>
                <td>{DOC_TYPE_LABEL[doc.docType] ?? doc.docType}</td>
                <td className="num">{doc.extractedFieldCount + doc.manualFieldCount}</td>
                <td className="num">{doc.byFieldStatus.CONFIRMED}</td>
                <td className="num">{doc.byFieldStatus.CORRECTED}</td>
                <td className="num">{doc.byFieldStatus.REJECTED}</td>
                <td className="num">{doc.unresolvedFlaggedCount}</td>
                <td className="num">{minConfidenceText(doc.minConfidence)}</td>
              </tr>
            ))}
            <tr>
              <td>Total</td>
              <td />
              <td className="num">{d.totals.fields}</td>
              <td className="num">{d.totals.confirmed}</td>
              <td className="num">{d.totals.corrected}</td>
              <td className="num">{d.totals.rejected}</td>
              <td className="num">{d.totals.unresolvedFlagged}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
