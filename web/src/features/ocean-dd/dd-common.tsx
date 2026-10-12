/**
 * Shared pieces of the Ocean D&D page (REQ-20261011-ocean-dd, Part B, C18): fixed error texts by status and
 * code (never the server's message), money formatting, simple labelled inputs and the catalog queries.
 */
import { DD_TEXT, DdCalendarList, DdTariffList } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';

import { ApiError } from '../../api/client';
import { useApi } from '../../app-context';

/** C18: 403 forbidden, 409 conflict (limit for dd_limit_reached), 422 invalid, 429 rate limited, else failed. */
export function ddErrorText(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  const code = e instanceof ApiError ? e.code : '';
  if (status === 403) return DD_TEXT.forbidden;
  if (status === 409 && code === 'dd_limit_reached') return DD_TEXT.limit;
  if (status === 409) return DD_TEXT.conflict;
  if (status === 422) return DD_TEXT.invalid;
  if (status === 429) return DD_TEXT.rateLimited;
  return DD_TEXT.failed;
}

/** `$d.dd` of non-negative integer cents. */
export function usd(cents: number): string {
  const c = Math.max(0, Math.trunc(cents));
  return `$${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

export function TextField({ label, value, onChange, wide, inputMode }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean; inputMode?: 'decimal' | 'numeric' }) {
  const id = useId();
  return (
    <label className={`flex flex-col text-sm${wide ? ' w-full' : ''}`} htmlFor={id}>
      {label}
      <input id={id} className="input" type="text" value={value} onChange={(e) => onChange(e.target.value)} {...(inputMode ? { inputMode } : {})} />
    </label>
  );
}

export function AreaField({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  const id = useId();
  return (
    <label className="flex w-full flex-col text-sm" htmlFor={id}>
      {label}
      <textarea id={id} className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <label className="flex flex-col text-sm" htmlFor={id}>
      {label}
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="my-3 rounded-md border p-3">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </section>
  );
}

/** Tariffs and calendars of the tenant (first 100, name order) for lists and selects. */
export function useDdCatalogs() {
  const api = useApi();
  const tariffs = useQuery({ queryKey: ['dd', 'tariffs'], queryFn: () => api.get('/api/v1/dd/tariffs?pageSize=100', DdTariffList), retry: false });
  const calendars = useQuery({ queryKey: ['dd', 'calendars'], queryFn: () => api.get('/api/v1/dd/calendars?pageSize=100', DdCalendarList), retry: false });
  return { tariffs, calendars };
}

/** Lines or `;`-separated items, trimmed, empty items dropped. */
export function listOf(text: string): string[] {
  return text
    .split(/[\n;]/u)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
