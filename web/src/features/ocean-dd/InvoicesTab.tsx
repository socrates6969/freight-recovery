/**
 * Invoices tab (Part B): paged list with status chips, New invoice, the invoice detail (checks and findings
 * of `preview`, Run audit for DRAFT invoices to users with `claims:analyze`, edit/delete for DRAFTs to users
 * with `dd_invoices:manage`). Success of the audit shows DD_TEXT.audited and links to the claim.
 */
import { DD_NOTE, DD_TEXT, DdAuditResponse, DdInvoiceDetail, DdInvoiceList, type DdInvoiceDetailDto } from '@fr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useApi, useCan, useToast } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

import { AuditView } from './AuditView';
import { ddErrorText, usd } from './dd-common';
import { InvoiceEditor } from './InvoiceEditor';

const PAGE_SIZE = 25;

function InvoiceDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan('dd_invoices:manage');
  const canAnalyze = useCan('claims:analyze');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['dd', 'invoice', id], queryFn: () => api.get(`/api/v1/dd/invoices/${encodeURIComponent(id)}`, DdInvoiceDetail), retry: false });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['dd', 'invoices'] });
    await qc.invalidateQueries({ queryKey: ['dd', 'invoice', id] });
  };
  const run = useMutation({
    mutationFn: () => api.post(`/api/v1/dd/invoices/${encodeURIComponent(id)}/audit`, {}, DdAuditResponse),
    onSuccess: async (r) => {
      setError(null);
      setClaimId(r.claim.id);
      toast(DD_TEXT.audited, 'success');
      await refresh();
    },
    onError: (e) => setError(ddErrorText(e)),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/api/v1/dd/invoices/${encodeURIComponent(id)}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['dd', 'invoices'] });
      onBack();
    },
    onError: (e) => setError(ddErrorText(e)),
  });

  if (q.isError) return <p role="alert">{ddErrorText(q.error)}</p>;
  const d: DdInvoiceDetailDto | undefined = q.data;
  if (!d) return <div className="skeleton h-24" aria-hidden="true" />;
  if (editing) {
    return (
      <InvoiceEditor
        existing={d}
        onDone={() => {
          setEditing(false);
          void refresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  const linked = claimId ?? d.claimId;
  return (
    <section aria-label="Invoice">
      <button type="button" className="btn mb-2" onClick={onBack}>
        Back to invoices
      </button>
      <h2 className="text-lg font-semibold">
        Invoice <SafeText value={d.invoice.invoiceNumber} />
      </h2>
      <p className="text-sm">
        <SafeText value={d.invoice.billingPartyName} /> <span className="badge">{d.status}</span>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {linked ? (
        <p className="text-sm">
          <Link to={`/claims/${linked}`}>Open the claim{d.claimNumber ? ' ' : ''}</Link>
          {d.claimNumber ? <SafeText value={d.claimNumber} /> : null}
        </p>
      ) : null}
      {d.status === 'DRAFT' ? (
        <div className="my-2 flex flex-wrap items-center gap-2">
          {canAnalyze ? (
            <>
              <button type="button" className="btn btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>
                {DD_TEXT.runAudit}
              </button>
              <span className="muted text-sm">{DD_TEXT.auditNote}</span>
            </>
          ) : null}
          {canManage ? (
            <>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className="btn" disabled={del.isPending} onClick={() => del.mutate()}>
                {DD_TEXT.delete}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <AuditView result={d.preview} labels={d.preview.containers.map((c) => c.label)} />
    </section>
  );
}

export function InvoicesTab() {
  const api = useApi();
  const canManage = useCan('dd_invoices:manage');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const q = useQuery({ queryKey: ['dd', 'invoices', page], queryFn: () => api.get(`/api/v1/dd/invoices?page=${page}&pageSize=${PAGE_SIZE}`, DdInvoiceList), retry: false });
  if (open === 'new') return <InvoiceEditor existing={null} onDone={(d) => setOpen(d.id)} onCancel={() => setOpen(null)} />;
  if (open !== null) return <InvoiceDetailView id={open} onBack={() => setOpen(null)} />;
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE_SIZE)) : 1;
  return (
    <section aria-label={DD_TEXT.invoices}>
      <p className="muted mb-2 text-sm">{DD_NOTE}</p>
      {canManage ? (
        <button type="button" className="btn btn-primary mb-3" onClick={() => setOpen('new')}>
          {DD_TEXT.newInvoice}
        </button>
      ) : null}
      {q.isError ? (
        <p role="alert">{ddErrorText(q.error)}</p>
      ) : !q.data ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <>
          <table className="data-table text-sm" aria-label={DD_TEXT.invoices}>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Billing party</th>
                <th scope="col">Invoice date</th>
                <th scope="col">Total due</th>
                <th scope="col">Containers</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="link" onClick={() => setOpen(r.id)}>
                      <SafeText value={r.invoiceNumber} />
                    </button>
                  </td>
                  <td>
                    <SafeText value={r.billingPartyName} />
                  </td>
                  <td className="num">{r.invoiceDate ?? ''}</td>
                  <td className="num">{r.totalDueCents === null ? '' : usd(r.totalDueCents)}</td>
                  <td className="num">{r.containerCount}</td>
                  <td>
                    <span className="badge">{r.status === 'AUDITED' ? 'Audited' : 'Draft'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 ? (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button type="button" className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
