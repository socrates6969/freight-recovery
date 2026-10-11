/**
 * Fuel tables page (REQ-20261011-fuel-outlook, Part C F15; route /settings/fuel-tables). Lists the tenant's
 * carrier fuel-surcharge schedules. Users with `settings:manage` can add, edit (sending `expectedVersion`)
 * and archive. A rows table is edited as one `atLeast,rate` pair per line, parsed client-side into the DTO
 * and validated with the shared schema before sending. Errors are fixed texts; names render as text.
 */
import {
  FSC_KINDS,
  FSC_UNITS,
  FUEL_TABLES_TEXT,
  FscTable,
  FscTableBody,
  FscTableList,
  type FscKind,
  type FscTableDto,
  type FscUnit,
} from '@fr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { ApiError } from '../../api/client';
import { useApi, useCan, useToast } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

const KIND_LABEL: Record<FscKind, string> = { step: 'Step table', mpg: 'Miles per gallon', rows: 'Price rows' };
const UNIT_LABEL: Record<FscUnit, string> = { per_mile: 'Per mile', percent: 'Percent of linehaul' };
const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Fixed alert text (F15) by status and code; never the server's message. */
export function fuelTableErrorText(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  const code = e instanceof ApiError ? e.code : '';
  if (status === 403) return FUEL_TABLES_TEXT.forbidden;
  if (status === 409 && code === 'fuel_table_limit_reached') return FUEL_TABLES_TEXT.limit;
  if (status === 409 && code === 'stale_revision') return FUEL_TABLES_TEXT.stale;
  if (status === 409 && code === 'conflict') return FUEL_TABLES_TEXT.nameTaken;
  return FUEL_TABLES_TEXT.failed;
}

interface FormState {
  name: string;
  kind: FscKind;
  unit: FscUnit;
  offset: number;
  basePrice: string;
  stepSize: string;
  ratePerStep: string;
  bracket: 'above_base' | 'from_base';
  mpg: string;
  decimals: 2 | 3 | 4;
  rows: string;
}

const EMPTY: FormState = { name: '', kind: 'step', unit: 'per_mile', offset: 2, basePrice: '', stepSize: '', ratePerStep: '', bracket: 'above_base', mpg: '', decimals: 2, rows: '' };

function fromTable(t: FscTableDto): FormState {
  const p = t.params as Record<string, unknown>;
  const rows = Array.isArray(p['rows']) ? (p['rows'] as { atLeast: string; rate: string }[]).map((r) => `${r.atLeast},${r.rate}`).join('\n') : '';
  return {
    name: t.name,
    kind: t.kind,
    unit: t.unit,
    offset: t.effectiveOffsetDays,
    basePrice: typeof p['basePrice'] === 'string' ? p['basePrice'] : '',
    stepSize: typeof p['stepSize'] === 'string' ? p['stepSize'] : '',
    ratePerStep: typeof p['ratePerStep'] === 'string' ? p['ratePerStep'] : '',
    bracket: p['bracket'] === 'from_base' ? 'from_base' : 'above_base',
    mpg: typeof p['mpg'] === 'string' ? p['mpg'] : '',
    decimals: p['decimals'] === 3 ? 3 : p['decimals'] === 4 ? 4 : 2,
    rows,
  };
}

/** One `atLeast,rate` pair per non-empty line. */
export function parseRows(text: string): { atLeast: string; rate: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => {
      const [atLeast = '', rate = ''] = l.split(',').map((x) => x.trim());
      return { atLeast, rate };
    });
}

/** The request body of a form (validated with the shared schema), or null when invalid. */
export function tableBody(f: FormState): Record<string, unknown> | null {
  const params =
    f.kind === 'step'
      ? { basePrice: f.basePrice.trim(), stepSize: f.stepSize.trim(), ratePerStep: f.ratePerStep.trim(), bracket: f.bracket }
      : f.kind === 'mpg'
        ? { basePrice: f.basePrice.trim(), mpg: f.mpg.trim(), decimals: f.decimals }
        : { rows: parseRows(f.rows) };
  const body = { name: f.name, kind: f.kind, unit: f.unit, priceSeries: 'diesel_us', effectiveOffsetDays: f.offset, params };
  return FscTableBody.safeParse(body).success ? body : null;
}

function TableForm({ initial, pending, onSubmit, onCancel }: { initial: FormState; pending: boolean; onSubmit: (f: FormState) => void; onCancel: () => void }) {
  const ids = useId();
  const [f, setF] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: 'basePrice' | 'stepSize' | 'ratePerStep' | 'mpg', label: string) => (
    <label className="flex flex-col text-sm" htmlFor={`${ids}-${k}`}>
      {label}
      <input id={`${ids}-${k}`} className="input" type="text" inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  return (
    <form
      className="my-3 flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
    >
      <label className="flex flex-col text-sm" htmlFor={`${ids}-name`}>
        Name
        <input id={`${ids}-name`} className="input" type="text" value={f.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label className="flex flex-col text-sm" htmlFor={`${ids}-kind`}>
        Kind
        <select id={`${ids}-kind`} className="input" value={f.kind} onChange={(e) => set('kind', e.target.value as FscKind)}>
          {FSC_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm" htmlFor={`${ids}-unit`}>
        Unit
        <select id={`${ids}-unit`} className="input" value={f.unit} onChange={(e) => set('unit', e.target.value as FscUnit)}>
          {FSC_UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm" htmlFor={`${ids}-offset`}>
        Price applies from
        <select id={`${ids}-offset`} className="input" value={f.offset} onChange={(e) => set('offset', Number(e.target.value))}>
          {DAY.map((d, i) => (
            <option key={d} value={i}>
              {`${d} to ${DAY[(i + 6) % 7] ?? ''}`}
            </option>
          ))}
        </select>
      </label>
      {f.kind !== 'rows' ? text('basePrice', 'Base price') : null}
      {f.kind === 'step' ? (
        <>
          {text('stepSize', 'Step size')}
          {text('ratePerStep', 'Rate per step')}
          <label className="flex flex-col text-sm" htmlFor={`${ids}-bracket`}>
            Steps
            <select id={`${ids}-bracket`} className="input" value={f.bracket} onChange={(e) => set('bracket', e.target.value === 'from_base' ? 'from_base' : 'above_base')}>
              <option value="above_base">Each step or part above the base</option>
              <option value="from_base">First step at the base</option>
            </select>
          </label>
        </>
      ) : null}
      {f.kind === 'mpg' ? (
        <>
          {text('mpg', 'Miles per gallon')}
          <label className="flex flex-col text-sm" htmlFor={`${ids}-decimals`}>
            Decimals
            <select id={`${ids}-decimals`} className="input" value={f.decimals} onChange={(e) => set('decimals', Number(e.target.value) === 3 ? 3 : Number(e.target.value) === 4 ? 4 : 2)}>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
        </>
      ) : null}
      {f.kind === 'rows' ? (
        <label className="flex w-full flex-col text-sm" htmlFor={`${ids}-rows`}>
          Rows (one price,rate per line)
          <textarea id={`${ids}-rows`} className="input" rows={6} value={f.rows} onChange={(e) => set('rows', e.target.value)} />
        </label>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {FUEL_TABLES_TEXT.save}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

export function FuelTablesPage() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan('settings:manage');
  const [editing, setEditing] = useState<FscTableDto | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['fuel-tables', 'all'], queryFn: () => api.get('/api/v1/fuel-tables?includeArchived=true', FscTableList), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['fuel-tables'] });
  const save = useMutation({
    mutationFn: async ({ target, body }: { target: FscTableDto | 'new'; body: Record<string, unknown> }) =>
      target === 'new'
        ? api.post('/api/v1/fuel-tables', body, FscTable)
        : api.put(`/api/v1/fuel-tables/${encodeURIComponent(target.id)}`, { ...body, expectedVersion: target.version }, FscTable),
    onSuccess: async () => {
      setError(null);
      setEditing(null);
      toast(FUEL_TABLES_TEXT.saved, 'success');
      await refresh();
    },
    onError: (e) => setError(fuelTableErrorText(e)),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/fuel-tables/${encodeURIComponent(id)}`),
    onSuccess: async () => {
      setError(null);
      toast(FUEL_TABLES_TEXT.archived, 'success');
      await refresh();
    },
    onError: (e) => setError(fuelTableErrorText(e)),
  });
  const submit = (target: FscTableDto | 'new', f: FormState) => {
    const body = tableBody(f);
    if (body === null) {
      setError(FUEL_TABLES_TEXT.failed);
      return;
    }
    save.mutate({ target, body });
  };

  return (
    <main className="p-6">
      <h1 className="mb-2 text-xl font-semibold">{FUEL_TABLES_TEXT.heading}</h1>
      <p className="muted mb-4 text-sm">{FUEL_TABLES_TEXT.note}</p>
      {error ? <p role="alert">{error}</p> : null}
      {canManage && editing === null ? (
        <button type="button" className="btn btn-primary mb-3" onClick={() => setEditing('new')}>
          {FUEL_TABLES_TEXT.add}
        </button>
      ) : null}
      {canManage && editing !== null ? (
        <TableForm
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          initial={editing === 'new' ? EMPTY : fromTable(editing)}
          pending={save.isPending}
          onSubmit={(f) => submit(editing, f)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {q.isError ? (
        <p role="alert">{FUEL_TABLES_TEXT.failed}</p>
      ) : !q.data ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <table className="data-table text-sm" aria-label={FUEL_TABLES_TEXT.heading}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Unit</th>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              {canManage ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((t) => (
              <tr key={t.id}>
                <td>
                  <SafeText value={t.name} />
                </td>
                <td>{KIND_LABEL[t.kind]}</td>
                <td>{UNIT_LABEL[t.unit]}</td>
                <td className="num">{t.version}</td>
                <td>{t.archived ? 'Archived' : 'Active'}</td>
                {canManage ? (
                  <td className="flex gap-2">
                    {!t.archived ? (
                      <>
                        <button type="button" className="btn" onClick={() => setEditing(t)}>
                          Edit
                        </button>
                        <button type="button" className="btn" disabled={archive.isPending} onClick={() => archive.mutate(t.id)}>
                          {FUEL_TABLES_TEXT.archive}
                        </button>
                      </>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
