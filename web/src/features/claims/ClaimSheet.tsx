import { ClaimDetail, ClaimDocumentsResponse, ClaimSummary, Packet, displayText, type PacketDto } from '@fr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useApi, useCan, useSession, useToast } from '../../app-context';
import { ExportMenu } from '../../components/ui/ExportMenu';
import { SafeText } from '../../components/ui/SafeText';
import { useFocusTrap } from '../../components/ui/use-focus-trap';
import { formatDateTime, formatDay, formatUsdCents, STATUS_LABEL } from '../../lib/format';

const TABS = ['Summary', 'Evidence', 'History', 'Documents'] as const;
export const NO_PACKET_TEXT = 'No evidence packet yet. Analysis has not run for this claim.';
const DOC_TYPE_LABEL: Record<string, string> = { INVOICE: 'Invoice', RATE_CONFIRMATION: 'Rate confirmation', BILL_OF_LADING: 'Bill of lading', OTHER: 'Other' };
type Tab = (typeof TABS)[number];

export const DISCLAIMER_TEXT = 'Draft for human review. Not legal advice. Nothing is sent from this app.';

export const VERIFIER_TEXT: Record<string, { text: string; tone: string }> = {
  NOT_RUN: { text: 'Not independently verified', tone: 'badge' },
  PASSED: { text: 'Verifier passed', tone: 'badge badge-success' },
  FAILED: { text: 'Verifier failed', tone: 'badge badge-danger' },
  NEEDS_REVIEW: { text: 'Verifier needs review', tone: 'badge badge-warn' },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-1">
      <dt className="muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function EvidencePanel({ packet }: { packet: PacketDto }) {
  const verifier = VERIFIER_TEXT[packet.verifier.status] ?? VERIFIER_TEXT['NOT_RUN'];
  const sourceName = new Map(packet.sources.map((s) => [s.id, s.filename]));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className={verifier?.tone}>
          {verifier?.text}
        </span>
        <span className={packet.integrity.valid ? 'badge badge-success' : 'badge badge-danger'}>
          {packet.integrity.valid ? 'Integrity verified' : 'Integrity mismatch'}
        </span>
        <span className="badge num">Revision {packet.revision}</span>
      </div>
      <p className="rounded-md bg-[var(--color-warn-tint)] p-3 text-sm text-[var(--color-warn)]">{DISCLAIMER_TEXT}</p>

      <section>
        <h3 className="mb-2 font-semibold">Timeline</h3>
        <ol className="flex flex-col gap-1">
          {packet.timeline.map((t) => (
            <li key={t.id} className="grid grid-cols-[180px_1fr] gap-3">
              <span className="num muted">{formatDateTime(t.occurredAt)}</span>
              <span>
                <SafeText value={t.label} />
                {t.sourceId ? (
                  <span className="muted">
                    {' '}
                    (<SafeText value={sourceName.get(t.sourceId) ?? ''} />)
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Sources</h3>
        <table className="data-table text-sm">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Type</th>
              <th scope="col">SHA-256</th>
              <th scope="col" className="text-right">
                Size
              </th>
            </tr>
          </thead>
          <tbody>
            {packet.sources.map((s) => (
              <tr key={s.id}>
                <td className="max-w-48">
                  <SafeText value={s.filename} />
                </td>
                <td>{s.docType.replaceAll('_', ' ').toLowerCase()}</td>
                <td className="font-mono text-xs break-all">
                  <SafeText value={s.sha256} />
                </td>
                <td className="num text-right">{s.sizeBytes} B</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Calculation</h3>
        {packet.findings.length === 0 ? <p className="muted">No findings for this perspective.</p> : null}
        <div className="flex flex-col gap-4">
          {packet.findings.map((f) => (
            <article key={f.id} className="rounded-md border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="font-medium">
                  <SafeText value={f.title} />
                </h4>
                <span className="num font-medium">{formatUsdCents(f.amountCents)}</span>
              </div>
              <p className="muted text-xs">
                <SafeText value={f.ruleId} /> - confidence <span className="num">{Math.round(f.confidence * 100)}%</span>
                {f.needsHumanReview ? <span className="badge badge-warn ml-2">Needs human review</span> : null}
              </p>
              <p className="mt-1 text-sm">
                <SafeText value={f.explanation} />
              </p>
              <ol className="mt-2 list-decimal pl-5 text-sm">
                {f.calculation.map((step, i) => (
                  <li key={i}>
                    <SafeText value={step} />
                  </li>
                ))}
              </ol>
              {f.citations.length > 0 ? (
                <ul className="muted mt-2 text-xs">
                  {f.citations.map((c, i) => (
                    <li key={i}>
                      <SafeText value={c.locator} />: <SafeText value={c.excerpt} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Governing clause</h3>
        {packet.findings.filter((f) => f.governingClause).length === 0 ? <p className="muted">No governing clause cited.</p> : null}
        <div className="flex flex-col gap-3">
          {packet.findings.map((f) =>
            f.governingClause ? (
              <figure key={f.id} className="rounded-md bg-[var(--color-surface)] p-3 text-sm">
                <figcaption className="muted mb-1 text-xs">
                  <SafeText value={f.governingClause.label} /> - <SafeText value={sourceName.get(f.governingClause.sourceId) ?? ''} />,{' '}
                  <SafeText value={f.governingClause.locator} />
                </figcaption>
                <blockquote className="font-mono">
                  <SafeText value={f.governingClause.excerpt} />
                </blockquote>
              </figure>
            ) : null,
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Draft demand letter</h3>
        <pre className="safe-text max-h-96 overflow-auto rounded-md bg-[var(--color-surface)] p-3 text-xs whitespace-pre-wrap">{displayText(packet.demandLetter)}</pre>
      </section>
    </div>
  );
}

export function ClaimSheet() {
  const { id = '' } = useParams();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const canAssign = useCan('claims:assign');
  const canExportPackets = useCan('export:packets');
  const me = useSession((s) => s.user);
  const [tab, setTab] = useState<Tab>('Summary');
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const tabIds = useId();

  const close = () => void navigate(`/claims${location.search}`);
  useFocusTrap(ref, true, close, () =>
    /^[0-9a-fA-F-]{1,64}$/u.test(id) ? document.querySelector<HTMLElement>(`a[data-claim-id="${id}"]`) : null,
  );

  const claim = useQuery({ queryKey: ['claim', id], queryFn: () => api.get(`/api/v1/claims/${encodeURIComponent(id)}`, ClaimDetail), retry: false });
  const hasPacket = claim.data ? claim.data.latestPacket !== null : false;
  const packet = useQuery({
    queryKey: ['packet', id],
    queryFn: () => api.get(`/api/v1/claims/${encodeURIComponent(id)}/packet`, Packet),
    retry: false,
    enabled: hasPacket,
  });
  const documents = useQuery({
    queryKey: ['claim-documents', id],
    queryFn: () => api.get(`/api/v1/claims/${encodeURIComponent(id)}/documents`, ClaimDocumentsResponse),
    retry: false,
    enabled: tab === 'Documents',
  });

  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => api.post(`/api/v1/claims/${encodeURIComponent(id)}/assign`, { assigneeId }, ClaimSummary),
    onSuccess: async () => {
      toast('Assignment updated.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['claim', id] });
      await queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (e) =>
      toast(e instanceof ApiError && e.status === 422 ? 'That person cannot be assigned to this claim.' : 'Assignment failed.', 'error'),
  });

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length] ?? 'Summary';
      setTab(next);
      document.getElementById(`${tabIds}-${next}`)?.focus();
    }
  };

  const c = claim.data;
  const title = c ? `Claim ${c.claimNumber}` : 'Claim';

  return (
    <>
      <div className="overlay" aria-hidden="true" onClick={close} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="sheet">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {c ? (
              <>
                Claim <SafeText value={c.claimNumber} />
              </>
            ) : (
              title
            )}
          </h2>
          <div className="flex items-start gap-2">
            {canExportPackets && hasPacket ? (
              <ExportMenu
                label="Export packet"
                fallbackName="freight-recovery-packets"
                pathFor={(f) => `/api/v1/exports/packets?format=${f}&claimId=${encodeURIComponent(id)}`}
              />
            ) : null}
            <button type="button" className="btn" onClick={close}>
              <X size={16} aria-hidden="true" />
              Close
            </button>
          </div>
        </div>
        <div className="px-6 py-4">
          {claim.isError ? (
            <p role="alert">This claim could not be loaded.</p>
          ) : !c ? (
            <div className="skeleton h-40" aria-hidden="true" />
          ) : (
            <>
              <div role="tablist" aria-label="Claim sections" className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
                {TABS.map((t) => (
                  <button
                    key={t}
                    id={`${tabIds}-${t}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    aria-controls={`${tabIds}-${t}-panel`}
                    tabIndex={tab === t ? 0 : -1}
                    onClick={() => setTab(t)}
                    onKeyDown={onTabKey}
                    className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? 'border-[var(--color-accent)] font-medium' : 'muted border-transparent'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id={`${tabIds}-${tab}-panel`} aria-labelledby={`${tabIds}-${tab}`} tabIndex={0}>
                {tab === 'Summary' ? (
                  <dl>
                    <Field label="Claim">
                      <SafeText value={c.claimNumber} className="num" />
                    </Field>
                    <Field label="Load">
                      <SafeText value={c.loadNumber ?? '—'} />
                    </Field>
                    <Field label="Invoice">
                      <SafeText value={c.invoiceNumber ?? '—'} /> <span className="muted">{formatDay(c.invoiceDate)}</span>
                    </Field>
                    <Field label="Carrier">
                      <SafeText value={c.carrierName} />
                    </Field>
                    <Field label="Shipper">
                      <SafeText value={c.shipperName} />
                    </Field>
                    <Field label="Perspective">{c.perspective === 'SHIPPER' ? 'Shipper' : 'Carrier'}</Field>
                    <Field label="Status">
                      <span className="badge">{STATUS_LABEL[c.status] ?? c.status}</span>
                    </Field>
                    <Field label="Amount claimed">
                      <span className="num">{formatUsdCents(c.amountClaimedCents)}</span>
                    </Field>
                    <Field label="Recoverable (confirmed)">
                      <span className="num font-medium">{formatUsdCents(c.recoverableCents)}</span>
                    </Field>
                    <Field label="Pending review (not claimed)">
                      <span className="num">{formatUsdCents(c.pendingReviewCents)}</span>
                    </Field>
                    <Field label="Assignee">
                      <div className="flex flex-wrap items-center gap-2">
                        {c.assignee ? <SafeText value={c.assignee.name} /> : <span className="muted">Unassigned</span>}
                        {canAssign && me ? (
                          <>
                            <button type="button" className="btn" disabled={assign.isPending || c.assignee?.id === me.id} onClick={() => assign.mutate(me.id)}>
                              Assign to me
                            </button>
                            <button type="button" className="btn" disabled={assign.isPending || !c.assignee} onClick={() => assign.mutate(null)}>
                              Unassign
                            </button>
                          </>
                        ) : null}
                      </div>
                    </Field>
                  </dl>
                ) : null}
                {tab === 'Evidence' ? (
                  !hasPacket ? (
                    <p className="muted">{NO_PACKET_TEXT}</p>
                  ) : packet.isError ? (
                    <p role="alert">The evidence packet could not be loaded.</p>
                  ) : packet.data ? (
                    <EvidencePanel packet={packet.data} />
                  ) : (
                    <div className="skeleton h-40" aria-hidden="true" />
                  )
                ) : null}
                {tab === 'History' ? (
                  !hasPacket ? (
                    <p className="muted">No review actions yet.</p>
                  ) : packet.data ? (
                    packet.data.approvals.length === 0 ? (
                      <p className="muted">No review actions yet.</p>
                    ) : (
                      <ol className="flex flex-col gap-3">
                        {packet.data.approvals.map((a) => (
                          <li key={a.id} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                            <div className="flex flex-wrap justify-between gap-2">
                              <span className="font-medium">
                                {a.action.replace('_', ' ').toLowerCase()} - revision <span className="num">{a.packetRevision}</span>
                              </span>
                              <span className="muted num">{formatDateTime(a.createdAt)}</span>
                            </div>
                            <p className="muted text-xs">
                              <SafeText value={a.actor.name} /> ({a.actor.role.toLowerCase()}) - {STATUS_LABEL[a.fromStatus] ?? a.fromStatus} to{' '}
                              {STATUS_LABEL[a.toStatus] ?? a.toStatus}
                            </p>
                            <p className="mt-1">
                              <SafeText value={a.reason} />
                            </p>
                          </li>
                        ))}
                      </ol>
                    )
                  ) : (
                    <div className="skeleton h-24" aria-hidden="true" />
                  )
                ) : null}
                {tab === 'Documents' ? (
                  documents.isError ? (
                    <p role="alert">The documents could not be loaded.</p>
                  ) : !documents.data ? (
                    <div className="skeleton h-24" aria-hidden="true" />
                  ) : documents.data.items.length === 0 ? (
                    <p className="muted">No imported documents are linked to this claim.</p>
                  ) : (
                    <table className="data-table text-sm">
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Type</th>
                          <th scope="col">SHA-256</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.data.items.map((d) => (
                          <tr key={d.id}>
                            <td className="max-w-56">
                              <SafeText value={d.displayName} />
                            </td>
                            <td>{DOC_TYPE_LABEL[d.docType] ?? d.docType}</td>
                            <td className="font-mono text-xs break-all">
                              <SafeText value={d.sha256} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
