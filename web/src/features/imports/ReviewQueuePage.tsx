/**
 * Review queue (N12 `/import/review`, import:review): documents in NEEDS_REVIEW, oldest first; a review
 * dialog with per-field Confirm/Correct/Reject, manual keying for image/no-field documents (type + add
 * field), and Accept/Reject document dialogs (reason >= 10 trimmed characters). No optimistic updates:
 * every change refetches; 409 shows "This item changed. Reload to continue."
 */
import {
  ExtractedField,
  ImportDocumentDetail,
  ReviewQueuePage as ReviewQueueSchema,
  fieldKeysFor,
  type ExtractedFieldDto,
  type ImportDocumentDetailDto,
  type KnownDocType,
  type ReviewQueueItemDto,
} from '@fr/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useApi, useCan, useToast } from '../../app-context';
import { Dialog } from '../../components/ui/Dialog';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime } from '../../lib/format';

import { FieldsTable } from './FieldsTable';
import { CONFIDENCE_NOTE, DOC_TYPE_TEXT, INVALID_VALUE_TEXT, REASON_TEXT, STALE_TEXT, fieldLabel } from './import-format';

const PAGE_SIZE = 25;
const FAILED_TEXT = 'The action failed. Please try again.';
const MANUAL_REASONS = new Set(['IMAGE_NO_TEXT_LAYER', 'NO_FIELDS', 'UNKNOWN_DOC_TYPE']);

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return STALE_TEXT;
    if (e.status === 400 || e.status === 422) return INVALID_VALUE_TEXT;
  }
  return FAILED_TEXT;
}

export function ReviewQueuePage() {
  const api = useApi();
  const canReview = useCan('import:review');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ReviewQueueItemDto | null>(null);
  const queue = useQuery({
    queryKey: ['reviews', page],
    queryFn: () => api.get(`/api/v1/reviews?page=${page}&pageSize=${PAGE_SIZE}`, ReviewQueueSchema),
    placeholderData: keepPreviousData,
    enabled: canReview,
  });

  if (!canReview) {
    return (
      <section className="card p-6">
        <h1 className="mb-2 text-lg font-semibold">Review queue</h1>
        <p className="muted">You do not have permission to review imported documents.</p>
      </section>
    );
  }

  const total = queue.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">Review queue</h1>
        <Link to="/import" className="text-[var(--color-accent)]">
          Import documents
        </Link>
      </div>
      {queue.isError ? (
        <div className="card flex items-center justify-between gap-3 p-4">
          <p role="alert" className="text-[var(--color-danger)]">
            The review queue could not be loaded.
          </p>
          <button type="button" className="btn" onClick={() => void queue.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="card overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Reason</th>
                <th scope="col">Waiting since</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.data?.items.map((item) => (
                <tr key={item.documentId}>
                  <td className="max-w-72">
                    <SafeText value={item.displayName} />
                    {item.batchLabel ? (
                      <span className="muted block text-xs">
                        <SafeText value={item.batchLabel} />
                      </span>
                    ) : null}
                  </td>
                  <td className="text-sm">{item.reviewReasons.map((r) => REASON_TEXT[r] ?? r).join(', ')}</td>
                  <td className="num muted whitespace-nowrap">{formatDateTime(item.waitingSince)}</td>
                  <td>
                    <button type="button" className="btn" onClick={() => setOpen(item)}>
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {queue.data && queue.data.items.length === 0 ? <p className="muted p-6 text-center">Nothing is waiting for review.</p> : null}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <span className="muted num text-sm">
          Page {page} of {lastPage}
        </span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous page
        </button>
        <button type="button" className="btn" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
          Next page
        </button>
      </div>
      {open ? <ReviewDialog item={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

type FieldAction = 'CONFIRM' | 'CORRECT' | 'REJECT';

function ReviewDialog({ item, onClose }: { item: ReviewQueueItemDto; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const base = `/api/v1/imports/${item.batchId}/documents/${item.documentId}`;
  const docKey = ['import-doc', item.documentId];
  const doc = useQuery({ queryKey: docKey, queryFn: () => api.get(base, ImportDocumentDetail), retry: false });
  const [pending, setPending] = useState<{ field: ExtractedFieldDto; action: FieldAction } | null>(null);
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: docKey }), queryClient.invalidateQueries({ queryKey: ['reviews'] })]);
  };
  const onError = async (e: unknown) => {
    setError(errorText(e));
    if (e instanceof ApiError && e.status === 409) await refresh();
  };

  if (decision && doc.data) {
    return (
      <DecisionDialog
        kind={decision}
        doc={doc.data}
        path={base}
        onCancel={() => setDecision(null)}
        onDone={async (text) => {
          toast(text, 'success');
          await refresh();
          onClose();
        }}
      />
    );
  }

  const d = doc.data;
  const reviewable = d?.status === 'NEEDS_REVIEW';
  const manual = d ? d.reviewReasons.some((r) => MANUAL_REASONS.has(r)) && !d.fields.some((f) => f.origin === 'EXTRACTED') : false;

  return (
    <Dialog title={`Review ${item.displayName}`} onClose={onClose} wide>
      {doc.isError ? (
        <p role="alert">This document could not be loaded.</p>
      ) : !d ? (
        <div className="skeleton h-32" aria-hidden="true" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="muted text-sm">
            {DOC_TYPE_TEXT[d.docType]} - {d.reviewReasons.map((r) => REASON_TEXT[r] ?? r).join(', ') || 'No open reasons'}. Fields below{' '}
            {Math.round(d.reviewThreshold * 100)}% need review. {CONFIDENCE_NOTE}
          </p>
          <FieldsTable
            fields={d.fields}
            actions={(f) =>
              reviewable && f.status === 'PROPOSED' && f.needsReview ? (
                <>
                  {(['CONFIRM', 'CORRECT', 'REJECT'] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="btn"
                      onClick={() => {
                        setError(null);
                        setPending({ field: f, action: a });
                      }}
                    >
                      {`${a === 'CONFIRM' ? 'Confirm' : a === 'CORRECT' ? 'Correct' : 'Reject'} ${fieldLabel(f.key)}`}
                    </button>
                  ))}
                </>
              ) : null
            }
          />
          {pending ? (
            <FieldActionForm
              key={`${pending.field.id}-${pending.action}`}
              pending={pending}
              path={base}
              onCancel={() => setPending(null)}
              onDone={async () => {
                setPending(null);
                await refresh();
              }}
              onError={onError}
            />
          ) : null}
          {reviewable && manual ? <ManualEntry doc={d} path={base} onDone={refresh} onError={onError} /> : null}
          {error ? (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            {reviewable ? (
              <>
                <button type="button" className="btn btn-danger" onClick={() => setDecision('reject')}>
                  Reject document
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setDecision('accept')}>
                  Accept document
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function FieldActionForm({
  pending,
  path,
  onCancel,
  onDone,
  onError,
}: {
  pending: { field: ExtractedFieldDto; action: FieldAction };
  path: string;
  onCancel: () => void;
  onDone: () => Promise<void>;
  onError: (e: unknown) => Promise<void>;
}) {
  const api = useApi();
  const valueId = useId();
  const reasonId = useId();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const { field, action } = pending;
  const mutation = useMutation({
    mutationFn: () =>
      api.post(
        `${path}/fields/${field.id}/resolve`,
        { action, reason: reason.trim(), ...(action === 'CORRECT' ? { correctedValue: value } : {}) },
        ExtractedField,
      ),
    onSuccess: onDone,
    onError,
  });
  const ok = reason.trim().length >= 10 && (action !== 'CORRECT' || (value.trim().length > 0 && value.length <= 2000));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && !mutation.isPending) mutation.mutate();
  };
  const label = action === 'CORRECT' ? 'Save correction' : action === 'CONFIRM' ? 'Save confirmation' : 'Save rejection';
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
      <p className="text-sm font-medium">{`${action === 'CORRECT' ? 'Correct' : action === 'CONFIRM' ? 'Confirm' : 'Reject'} ${fieldLabel(field.key)}`}</p>
      {action === 'CORRECT' ? (
        <div>
          <label className="label" htmlFor={valueId}>
            Corrected value
          </label>
          <input id={valueId} className="input" maxLength={2000} value={value} onChange={(e) => setValue(e.target.value)} data-autofocus />
        </div>
      ) : null}
      <div>
        <label className="label" htmlFor={reasonId}>
          Reason
        </label>
        <input id={reasonId} className="input" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ok || mutation.isPending}>
          {label}
        </button>
      </div>
    </form>
  );
}

function ManualEntry({ doc, path, onDone, onError }: { doc: ImportDocumentDetailDto; path: string; onDone: () => Promise<void>; onError: (e: unknown) => Promise<void> }) {
  const api = useApi();
  const typeId = useId();
  const keyId = useId();
  const valueId = useId();
  const reasonId = useId();
  const [docType, setDocType] = useState<KnownDocType | ''>(doc.docType === 'OTHER' ? '' : doc.docType);
  const known = doc.docType === 'OTHER' ? null : doc.docType;
  const keys = known ? fieldKeysFor(known) : [];
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const setType = useMutation({
    mutationFn: () => api.request('PATCH', path, { body: { docType }, schema: ImportDocumentDetail }),
    onSuccess: onDone,
    onError,
  });
  const add = useMutation({
    mutationFn: () => api.post(`${path}/fields`, { key, value, reason: reason.trim() }, ExtractedField),
    onSuccess: async () => {
      setValue('');
      setReason('');
      await onDone();
    },
    onError,
  });
  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3">
      <p className="text-sm font-medium">Manual entry</p>
      {doc.fields.length === 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor={typeId}>
              Document type
            </label>
            <select id={typeId} className="input w-52" value={docType} onChange={(e) => setDocType(e.target.value as KnownDocType)}>
              <option value="" disabled hidden>
                Choose a type
              </option>
              <option value="INVOICE">Invoice</option>
              <option value="RATE_CONFIRMATION">Rate confirmation</option>
              <option value="BILL_OF_LADING">Bill of lading</option>
            </select>
          </div>
          <button type="button" className="btn" disabled={!docType || docType === doc.docType || setType.isPending} onClick={() => setType.mutate()}>
            Set type
          </button>
        </div>
      ) : null}
      {known ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key && value.trim() && reason.trim().length >= 10 && !add.isPending) add.mutate();
          }}
        >
          <div>
            <label className="label" htmlFor={keyId}>
              Field
            </label>
            <select id={keyId} className="input w-56" value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="" disabled hidden>
                Choose a field
              </option>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {fieldLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={valueId}>
              Value
            </label>
            <input id={valueId} className="input w-48" maxLength={2000} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor={reasonId}>
              Reason for adding
            </label>
            <input id={reasonId} className="input w-64" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={!key || !value.trim() || reason.trim().length < 10 || add.isPending}>
            Add field
          </button>
        </form>
      ) : null}
    </div>
  );
}

function DecisionDialog({
  kind,
  doc,
  path,
  onCancel,
  onDone,
}: {
  kind: 'accept' | 'reject';
  doc: ImportDocumentDetailDto;
  path: string;
  onCancel: () => void;
  onDone: (text: string) => Promise<void>;
}) {
  const api = useApi();
  const reasonId = useId();
  const confirmAllId = useId();
  const [reason, setReason] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api.post(
        `${path}/${kind}`,
        kind === 'accept' ? { reason: reason.trim(), ...(confirmAll ? { confirmRemaining: true } : {}) } : { reason: reason.trim() },
        ImportDocumentDetail,
      ),
    onSuccess: () => onDone(kind === 'accept' ? 'Document accepted.' : 'Document rejected.'),
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? STALE_TEXT : FAILED_TEXT),
  });
  const ok = reason.trim().length >= 10 && !mutation.isPending;
  return (
    <Dialog title={kind === 'accept' ? 'Accept document' : 'Reject document'} onClose={onCancel}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) mutation.mutate();
        }}
      >
        <p className="text-sm">
          <SafeText value={doc.displayName} />
        </p>
        <div>
          <label className="label" htmlFor={reasonId}>
            Reason
          </label>
          <input id={reasonId} className="input" required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
          <p className="muted mt-1 text-xs">At least 10 characters. Recorded in the audit trail.</p>
        </div>
        {kind === 'accept' ? (
          <div className="flex items-start gap-2">
            <input id={confirmAllId} type="checkbox" checked={confirmAll} onChange={(e) => setConfirmAll(e.target.checked)} className="mt-1" />
            <label htmlFor={confirmAllId} className="text-sm">
              Confirm all remaining flagged fields
            </label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={kind === 'accept' ? 'btn btn-primary' : 'btn btn-danger'} disabled={!ok}>
            Confirm
          </button>
        </div>
      </form>
    </Dialog>
  );
}
