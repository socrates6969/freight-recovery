/**
 * Claim sheet tab "Charges" (REQ-20261011-charge-intelligence, Part C C13). Lists the invoice charge lines
 * with the keyword-rule class, the nearest-example suggestion and the team label. Users with
 * `charge_labels:manage` can confirm a suggestion or save another category (one PUT per action). All
 * untrusted strings render as text; server error text is never shown.
 */
import {
  CATEGORY_LABELS,
  CHARGE_CATEGORIES,
  CHARGE_LABEL_CONFLICT_TEXT,
  CHARGE_NOTE,
  CHARGE_TEXT,
  ChargeLinesResponse,
  LEARNED_INFLUENCE_TEXT,
  SetChargeLabelBody,
  SetChargeLabelResponse,
  type ChargeCategory,
  type ChargeLineViewDto,
  type ChargeLinesResponseDto,
} from '@fr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError, step4ErrorText } from '../../api/client';
import { useApi, useCan, useToast } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

const SIMILARITY_DECIMALS = 3;

const is404 = (e: unknown) => e instanceof ApiError && e.status === 404;

/** Fixed alert text by status (C13); never the server's message. */
export function chargeErrorText(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 403) return CHARGE_TEXT.forbidden;
  // Hardening (C7.5): a concurrent change (409 conflict) is not the label limit (409 label_limit_reached).
  if (status === 409) return e instanceof ApiError && e.code === 'conflict' ? CHARGE_LABEL_CONFLICT_TEXT : CHARGE_TEXT.limit;
  if (status === 429) return CHARGE_TEXT.rateLimited;
  return CHARGE_TEXT.failed;
}

/** Fix round 1 (S7): the server would refuse a label for this description (length, unsafe characters). */
export function isLabelable(description: string): boolean {
  return SetChargeLabelBody.safeParse({ description, category: 'other' }).success;
}

/** Hardening (C3, C7.5): the team labels recorded by the claim's analysis (absent when not analysed). */
export function LearnedInfluenceSection({ influence }: { influence: ChargeLinesResponseDto['influence'] }) {
  if (influence === null) return null;
  return (
    <section aria-label={LEARNED_INFLUENCE_TEXT.heading} className="mb-3">
      <h4 className="font-medium">{LEARNED_INFLUENCE_TEXT.heading}</h4>
      {influence.labels.length === 0 ? (
        <p className="muted text-sm">{LEARNED_INFLUENCE_TEXT.none}</p>
      ) : (
        <>
          <ul className="text-sm">
            {influence.labels.map((l, i) => (
              <li key={`${l.labelId}:${i}`}>
                {l.description !== null && l.category !== null ? (
                  <>
                    <SafeText value={l.description} />
                    {` (${CATEGORY_LABELS[l.category]})`}
                  </>
                ) : (
                  LEARNED_INFLUENCE_TEXT.deleted
                )}
              </li>
            ))}
          </ul>
          <p className="muted text-sm">{LEARNED_INFLUENCE_TEXT.note}</p>
        </>
      )}
    </section>
  );
}

interface SaveVars {
  index: number;
  description: string;
  category: ChargeCategory;
}

function ChargeLineRow({ line, canManage, pending, onSave }: { line: ChargeLineViewDto; canManage: boolean; pending: boolean; onSave: (v: SaveVars) => void }) {
  const s = line.suggestion;
  const [choice, setChoice] = useState<ChargeCategory>(line.label?.category ?? s.category ?? line.ruleCategory);
  const showConfirm = !s.abstained && s.category !== null && line.label?.category !== s.category;
  const disabled = pending || !isLabelable(line.description);
  return (
    <li className="border-b py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <SafeText value={line.description} className="font-medium" />
        <span className="num">${line.amount}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-sm">
        <span className="badge">{`${CHARGE_TEXT.rules}: ${CATEGORY_LABELS[line.ruleCategory]}`}</span>
        <span className="badge">
          {!s.abstained && s.category !== null ? `${CHARGE_TEXT.suggested}: ${CATEGORY_LABELS[s.category]} (${s.similarity.toFixed(SIMILARITY_DECIMALS)})` : CHARGE_TEXT.noSuggestion}
        </span>
        {line.label ? <span className="badge">{`${CHARGE_TEXT.teamLabel}: ${CATEGORY_LABELS[line.label.category]}`}</span> : null}
      </div>
      {s.nearest ? (
        <p className="muted mt-1 text-sm">
          {`${CHARGE_TEXT.nearest}: '`}
          <SafeText value={s.nearest.text} />
          {`' (`}
          <SafeText value={s.nearest.sourceLabel} />
          {')'}
        </p>
      ) : null}
      {canManage ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {showConfirm && s.category !== null ? (
            <button type="button" className="btn" disabled={disabled} onClick={() => onSave({ index: line.index, description: line.description, category: s.category ?? choice })}>
              {CHARGE_TEXT.confirm(CATEGORY_LABELS[s.category])}
            </button>
          ) : null}
          <select className="input" aria-label={CHARGE_TEXT.category} value={choice} disabled={disabled} onChange={(e) => setChoice(e.target.value as ChargeCategory)}>
            {CHARGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={disabled} onClick={() => onSave({ index: line.index, description: line.description, category: choice })}>
            {CHARGE_TEXT.save}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ChargeLinesPanel({ claimId, onUnavailable }: { claimId: string; onUnavailable: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan('charge_labels:manage');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['charge-lines', claimId],
    queryFn: () => api.get(`/api/v1/claims/${encodeURIComponent(claimId)}/charge-lines`, ChargeLinesResponse),
    retry: false,
  });
  useEffect(() => {
    if (q.isError && is404(q.error)) onUnavailable();
  }, [q.isError, q.error, onUnavailable]);
  const m = useMutation({
    mutationFn: (v: SaveVars) => api.put('/api/v1/charge-labels', { description: v.description, category: v.category }, SetChargeLabelResponse),
    onSuccess: async () => {
      setError(null);
      toast(CHARGE_TEXT.saved, 'success');
      await Promise.all([qc.invalidateQueries({ queryKey: ['charge-lines', claimId] }), qc.invalidateQueries({ queryKey: ['charge-labels'] })]);
    },
    onError: (e) => setError(chargeErrorText(e)),
  });
  const d = q.data;
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">{CHARGE_TEXT.heading}</h3>
      <p className="muted mb-3 text-sm">{CHARGE_NOTE}</p>
      {error ? <p role="alert">{error}</p> : null}
      {q.isError ? (
        <p role="alert">{step4ErrorText(q.error)}</p>
      ) : !d ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <LearnedInfluenceSection influence={d.influence} />
      )}
      {!d || q.isError ? null : d.lines.length === 0 ? (
        <p className="muted">{CHARGE_TEXT.empty}</p>
      ) : (
        <ul aria-label={CHARGE_TEXT.heading}>
          {d.lines.map((line) => (
            <ChargeLineRow
              key={`${line.index}:${line.label?.id ?? ''}:${line.label?.category ?? ''}`}
              line={line}
              canManage={canManage}
              pending={m.isPending && m.variables.index === line.index}
              onSave={(v) => m.mutate(v)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
