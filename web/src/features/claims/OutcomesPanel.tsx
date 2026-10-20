/**
 * REQ-20261020-claim-outcomes: the Outcomes tab of a SEND_READY claim. A "Record outcome" form (users holding
 * `outcomes:record`) and the newest-first list of recorded outcomes. Amounts are typed as dollars and sent
 * as integer cents; dates are calendar days sent as UTC midnight instants. Rows are append-only: the copy
 * says so, and the list never offers an edit or delete action.
 */
import {
  CARRIER_RESPONSES,
  CARRIER_RESPONSE_TEXT,
  ClaimOutcomeList,
  ClaimOutcomeView,
  OUTCOME_CHANNELS,
  OUTCOME_CHANNEL_TEXT,
  OUTCOME_KIND_TEXT,
  OUTCOME_NOTE_MAX,
  OUTCOME_TEXT,
  type CarrierResponse,
  type ClaimOutcomeBodyInput,
  type ClaimOutcomeViewDto,
  type OutcomeChannel,
} from '@fr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { useApi, useCan, useToast } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime, formatDay, formatUsdCents } from '../../lib/format';

const AMOUNT_RE = /^(\d{1,9})(?:\.(\d{1,2}))?$/u;
export const AMOUNT_ERROR = 'Enter an amount in dollars, for example 1234.56, or leave it empty.';

/** Dollars text to integer cents: '' -> null (not entered); invalid -> undefined. */
export function parseUsd(input: string): number | null | undefined {
  const v = input.trim().replace(/,/gu, '');
  if (v === '') return null;
  const m = AMOUNT_RE.exec(v);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** A date input value (YYYY-MM-DD) as the UTC midnight instant; '' -> null. */
export function dayToInstant(day: string): string | null {
  return day === '' ? null : `${day}T00:00:00.000Z`;
}

function outcomesPath(claimId: string): string {
  return `/api/v1/claims/${encodeURIComponent(claimId)}/outcomes`;
}

interface FormState {
  channel: OutcomeChannel;
  carrierResponse: CarrierResponse;
  credited: string;
  paid: string;
  sentAt: string;
  closedAt: string;
  note: string;
}

const EMPTY: FormState = { channel: 'EMAIL', carrierResponse: 'NONE_YET', credited: '', paid: '', sentAt: '', closedAt: '', note: '' };

function RecordForm({ claimId }: { claimId: string }) {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ids = { channel: useId(), response: useId(), credited: useId(), paid: useId(), sentAt: useId(), closedAt: useId(), note: useId() };
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const record = useMutation({
    mutationFn: (body: ClaimOutcomeBodyInput) => api.post(outcomesPath(claimId), body, ClaimOutcomeView),
    onSuccess: async () => {
      toast(OUTCOME_TEXT.success, 'success');
      setForm(EMPTY);
      await queryClient.invalidateQueries({ queryKey: ['claim-outcomes', claimId] });
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? OUTCOME_TEXT.conflict : OUTCOME_TEXT.failed),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const creditedCents = parseUsd(form.credited);
    const paidCents = parseUsd(form.paid);
    if (creditedCents === undefined || paidCents === undefined) {
      setError(AMOUNT_ERROR);
      return;
    }
    record.mutate({
      kind: 'OUTCOME',
      channel: form.channel,
      carrierResponse: form.carrierResponse,
      sentAt: dayToInstant(form.sentAt),
      creditedCents,
      paidCents,
      closedAt: dayToInstant(form.closedAt),
      note: form.note.trim(),
    });
  };

  return (
    <form onSubmit={submit} aria-label={OUTCOME_TEXT.heading} className="mb-6 flex flex-col gap-3">
      <h3 className="font-semibold">{OUTCOME_TEXT.heading}</h3>
      <p className="muted text-sm">{OUTCOME_TEXT.intro}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor={ids.channel}>
            Sent by
          </label>
          <select id={ids.channel} className="input" value={form.channel} onChange={(e) => set('channel', e.target.value as OutcomeChannel)}>
            {OUTCOME_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {OUTCOME_CHANNEL_TEXT[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={ids.response}>
            Carrier response
          </label>
          <select id={ids.response} className="input" value={form.carrierResponse} onChange={(e) => set('carrierResponse', e.target.value as CarrierResponse)}>
            {CARRIER_RESPONSES.map((c) => (
              <option key={c} value={c}>
                {CARRIER_RESPONSE_TEXT[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={ids.credited}>
            Credited (USD)
          </label>
          <input id={ids.credited} className="input num" inputMode="decimal" value={form.credited} onChange={(e) => set('credited', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={ids.paid}>
            Paid (USD)
          </label>
          <input id={ids.paid} className="input num" inputMode="decimal" value={form.paid} onChange={(e) => set('paid', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={ids.sentAt}>
            Sent on
          </label>
          <input id={ids.sentAt} type="date" className="input" value={form.sentAt} onChange={(e) => set('sentAt', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={ids.closedAt}>
            Closed on
          </label>
          <input id={ids.closedAt} type="date" className="input" value={form.closedAt} onChange={(e) => set('closedAt', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={ids.note}>
          Note (optional, {OUTCOME_NOTE_MAX} characters)
        </label>
        <input id={ids.note} className="input" maxLength={OUTCOME_NOTE_MAX} value={form.note} onChange={(e) => set('note', e.target.value)} />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={record.isPending}>
          {OUTCOME_TEXT.heading}
        </button>
        <span className="muted text-xs">{OUTCOME_TEXT.appendOnly}</span>
      </div>
    </form>
  );
}

function OutcomeRow({ o }: { o: ClaimOutcomeViewDto }) {
  const noFinding = o.kind === 'AUDITED_NO_FINDING';
  return (
    <li className="rounded-md border border-[var(--color-border)] p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-medium">{noFinding ? OUTCOME_KIND_TEXT[o.kind] : `${CARRIER_RESPONSE_TEXT[o.carrierResponse]} - ${OUTCOME_CHANNEL_TEXT[o.channel]}`}</span>
        <span className="muted num">{formatDateTime(o.recordedAt)}</span>
      </div>
      {noFinding ? null : (
        <p className="num text-xs">
          Credited {o.creditedCents === null ? 'not entered' : formatUsdCents(o.creditedCents)}; paid {o.paidCents === null ? 'not entered' : formatUsdCents(o.paidCents)}; sent{' '}
          {formatDay(o.sentAt)}; closed {formatDay(o.closedAt)}
        </p>
      )}
      <p className="muted text-xs">
        Recorded by <SafeText value={o.recordedBy.name} />
      </p>
      {o.note ? (
        <p className="mt-1">
          <SafeText value={o.note} />
        </p>
      ) : null}
    </li>
  );
}

export function OutcomesPanel({ claimId }: { claimId: string }) {
  const api = useApi();
  const canRecord = useCan('outcomes:record');
  const list = useQuery({ queryKey: ['claim-outcomes', claimId], queryFn: () => api.get(outcomesPath(claimId), ClaimOutcomeList), retry: false });
  return (
    <div>
      {canRecord ? <RecordForm claimId={claimId} /> : null}
      <h3 className="mb-2 font-semibold">{OUTCOME_TEXT.listHeading}</h3>
      {list.isError ? (
        <p role="alert">The outcomes could not be loaded.</p>
      ) : !list.data ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : list.data.items.length === 0 ? (
        <p className="muted">{OUTCOME_TEXT.listEmpty}</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label={OUTCOME_TEXT.listHeading}>
          {list.data.items.map((o) => (
            <OutcomeRow key={o.id} o={o} />
          ))}
        </ol>
      )}
    </div>
  );
}