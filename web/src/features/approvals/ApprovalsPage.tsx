import { ApprovalsPage as ApprovalsPageSchema, Packet, TransitionResponse, type ApprovalItemDto } from '@fr/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useApi, useCan, useToast } from '../../app-context';
import { Dialog } from '../../components/ui/Dialog';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime, formatUsdCents, STATUS_LABEL } from '../../lib/format';

type Action = 'Approve' | 'Reject' | 'Edit' | 'Send';
const PAGE_SIZE = 25;
export const STALE_MESSAGE = 'This item changed. Reload to continue.';
export const SEND_NOTICE = 'This marks the demand as ready to send. No email is sent from this app.';
const ACK_LABEL = 'I acknowledge findings pending human review';

function endpointFor(action: Action, id: string): string {
  const base = `/api/v1/claims/${encodeURIComponent(id)}/packet`;
  if (action === 'Edit') return `${base}/revisions`;
  if (action === 'Approve') return `${base}/approve`;
  if (action === 'Reject') return `${base}/reject`;
  return `${base}/send`;
}

const DONE_TEXT: Record<Action, string> = {
  Approve: 'Approved',
  Reject: 'Rejected',
  Edit: 'New revision created for',
  Send: 'Marked send-ready:',
};

function ActionDialog({ action, item, onClose }: { action: Action; item: ApprovalItemDto; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const letterId = useId();
  const ackId = useId();
  const noticeId = useId();
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsAck = action === 'Approve' && item.pendingFindingsCount > 0;

  const packet = useQuery({
    queryKey: ['packet', item.id],
    queryFn: () => api.get(`/api/v1/claims/${encodeURIComponent(item.id)}/packet`, Packet),
    enabled: action === 'Edit',
  });
  const letterValue = letter ?? packet.data?.demandLetter ?? '';

  const mutation = useMutation({
    mutationFn: () => {
      const body =
        action === 'Edit'
          ? { baseRevision: item.packetRevision, demandLetter: letterValue, reason: reason.trim() }
          : action === 'Approve'
            ? { packetRevision: item.packetRevision, reason: reason.trim(), ...(needsAck ? { acknowledgePendingFindings: ack } : {}) }
            : { packetRevision: item.packetRevision, reason: reason.trim() };
      return api.post(endpointFor(action, item.id), body, TransitionResponse);
    },
    onSuccess: async () => {
      toast(`${DONE_TEXT[action]} ${item.claimNumber}.`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['approvals'] }),
        queryClient.invalidateQueries({ queryKey: ['claims'] }),
        queryClient.invalidateQueries({ queryKey: ['claim', item.id] }),
        queryClient.invalidateQueries({ queryKey: ['packet', item.id] }),
      ]);
      onClose();
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setError(STALE_MESSAGE);
        await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      } else if (e instanceof ApiError && e.status === 422) setError(e.message);
      else if (e instanceof ApiError && e.status === 403) setError('You do not have permission to perform this action.');
      else setError('The action failed. Please try again.');
    },
  });

  const reasonOk = reason.trim().length >= 10;
  const canConfirm = reasonOk && (!needsAck || ack) && (action !== 'Edit' || letterValue.trim().length > 0) && !mutation.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canConfirm) mutation.mutate();
  };

  return (
    <Dialog title={`${action} ${item.claimNumber}`} onClose={onClose} {...(action === 'Send' ? { describedBy: noticeId } : {})}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {action === 'Send' ? (
          <p id={noticeId} className="rounded-md bg-[var(--color-surface)] p-3 text-sm">
            {SEND_NOTICE}
          </p>
        ) : null}
        {action === 'Edit' ? (
          <div>
            <label className="label" htmlFor={letterId}>
              Demand letter
            </label>
            <textarea
              id={letterId}
              className="input min-h-48 font-mono text-xs"
              maxLength={20000}
              value={letterValue}
              disabled={packet.isPending}
              onChange={(e) => setLetter(e.target.value)}
            />
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor={reasonId}>
            Reason
          </label>
          <input id={reasonId} className="input" required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
          <p className="muted mt-1 text-xs">At least 10 characters. Recorded in the audit trail.</p>
        </div>
        {needsAck ? (
          <div className="flex items-start gap-2">
            <input id={ackId} type="checkbox" required checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            <label htmlFor={ackId} className="text-sm">
              {ACK_LABEL}
            </label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canConfirm}>
            Confirm
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ApprovalsPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const canApprove = useCan('packets:approve');
  const canEdit = useCan('packets:edit');
  const canSend = useCan('demands:send');
  const [open, setOpen] = useState<{ action: Action; item: ApprovalItemDto } | null>(null);
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const queue = useQuery({
    queryKey: ['approvals', 'queue', page],
    queryFn: () => api.get(`/api/v1/approvals?status=PENDING_REVIEW,APPROVED&page=${page}&pageSize=${PAGE_SIZE}`, ApprovalsPageSchema),
    placeholderData: keepPreviousData,
  });
  const total = queue.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const setPage = (p: number) => setParams(p > 1 ? { page: String(p) } : {}, { replace: true });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Approvals</h1>
      {queue.isError ? (
        <p role="alert" className="card p-4 text-[var(--color-danger)]">
          The approval queue could not be loaded.
        </p>
      ) : (
        <div className="card max-h-[70vh] overflow-auto">
          <table className="data-table" aria-label="Approval queue">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Carrier</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">
                  Recoverable
                </th>
                <th scope="col" className="text-right">
                  Pending findings
                </th>
                <th scope="col">Waiting since</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="num font-medium">
                    <SafeText value={item.claimNumber} />
                  </td>
                  <td className="max-w-56">
                    <SafeText value={item.carrierName} />
                  </td>
                  <td>
                    <span className="badge">{STATUS_LABEL[item.status] ?? item.status}</span>
                  </td>
                  <td className="num text-right">{formatUsdCents(item.recoverableCents)}</td>
                  <td className="num text-right">{item.pendingFindingsCount}</td>
                  <td className="num muted whitespace-nowrap">{formatDateTime(item.waitingSince)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {item.status === 'PENDING_REVIEW' && canApprove ? (
                        <>
                          <button type="button" className="btn" onClick={() => setOpen({ action: 'Approve', item })}>
                            Approve
                          </button>
                          <button type="button" className="btn btn-danger" onClick={() => setOpen({ action: 'Reject', item })}>
                            Reject
                          </button>
                        </>
                      ) : null}
                      {item.status === 'PENDING_REVIEW' && canEdit ? (
                        <button type="button" className="btn" onClick={() => setOpen({ action: 'Edit', item })}>
                          Edit
                        </button>
                      ) : null}
                      {item.status === 'APPROVED' && canSend ? (
                        <button type="button" className="btn" onClick={() => setOpen({ action: 'Send', item })}>
                          Send
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {queue.isPending ? <div className="skeleton m-4 h-24" aria-hidden="true" /> : null}
          {queue.data && queue.data.items.length === 0 ? <p className="muted p-6 text-center">Nothing is waiting for review.</p> : null}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <span className="muted num text-sm">
          Page {page} of {lastPage}
        </span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous page
        </button>
        <button type="button" className="btn" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
          Next page
        </button>
      </div>
      {open ? <ActionDialog action={open.action} item={open.item} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
