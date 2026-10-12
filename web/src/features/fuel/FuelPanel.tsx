/**
 * Claim sheet tab "Fuel" (REQ-20261011-fuel-outlook, Part C F6, F15). Shows the fuel-check preview of the
 * claim (status text, posted price, expected, billed, difference and the calculation lines) and, for users
 * with `claims:analyze` while the claim is AWAITING_ANALYSIS, the fuel inputs form (ship date, miles, fuel
 * table). Errors are fixed texts by status/code; untrusted strings render as text.
 */
import { FUEL_NOTE, FUEL_STATUS_TEXT, FUEL_TEXT, FscTableList, FuelCheckView, SetFuelInputsBody, SetFuelInputsResponse, type ClaimFuelInputsDto, type FscTableDto } from '@fr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { ApiError } from '../../api/client';
import { useApi, useCan, useToast } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

const FUEL_TABLE_UNAVAILABLE = 'The fuel table does not exist or is archived.';

/** Fixed alert text (F15) by status and code; never the server's message. */
export function fuelInputErrorText(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  const code = e instanceof ApiError ? e.code : '';
  if (status === 403) return FUEL_TEXT.forbidden;
  if (status === 409) return FUEL_TEXT.locked;
  if (status === 422 && code === 'miles_required') return FUEL_STATUS_TEXT.miles_missing;
  if (status === 422 && code === 'fuel_table_unavailable') return FUEL_TABLE_UNAVAILABLE;
  if (status === 429) return FUEL_TEXT.rateLimited;
  return FUEL_TEXT.failed;
}

const is404 = (e: unknown) => e instanceof ApiError && e.status === 404;

interface FormProps {
  initial: ClaimFuelInputsDto | null;
  tables: readonly FscTableDto[];
  tablesLoaded: boolean;
  pending: boolean;
  onSave: (body: { shipDate: string; miles: string | null; fscTableId: string }) => void;
  onClear: () => void;
  onInvalid: () => void;
}

/** The fuel inputs form; its initial state is the stored inputs (re-mounted when they change). */
function FuelInputsForm({ initial, tables, tablesLoaded, pending, onSave, onClear, onInvalid }: FormProps) {
  const ids = useId();
  const [shipDate, setShipDate] = useState(initial?.shipDate ?? '');
  const [miles, setMiles] = useState(initial?.miles ?? '');
  const [tableId, setTableId] = useState(initial?.fscTableId ?? '');
  const submit = () => {
    const body = { shipDate, miles: miles.trim() === '' ? null : miles.trim(), fscTableId: tableId };
    if (!SetFuelInputsBody.safeParse(body).success) {
      onInvalid();
      return;
    }
    onSave(body);
  };
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col text-sm" htmlFor={`${ids}-date`}>
        {FUEL_TEXT.shipDate}
        <input id={`${ids}-date`} className="input" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
      </label>
      <label className="flex flex-col text-sm" htmlFor={`${ids}-miles`}>
        {FUEL_TEXT.miles}
        <input id={`${ids}-miles`} className="input" type="text" inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} />
      </label>
      <label className="flex flex-col text-sm" htmlFor={`${ids}-table`}>
        {FUEL_TEXT.table}
        <select id={`${ids}-table`} className="input" value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="" />
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {FUEL_TEXT.save}
      </button>
      {initial ? (
        <button type="button" className="btn" disabled={pending} onClick={onClear}>
          {FUEL_TEXT.clear}
        </button>
      ) : null}
      {tablesLoaded && tables.length === 0 ? <p className="muted w-full text-sm">{FUEL_TEXT.noTables}</p> : null}
    </form>
  );
}

export function FuelPanel({ claimId, claimStatus, onUnavailable }: { claimId: string; claimStatus: string | null; onUnavailable: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const canAnalyze = useCan('claims:analyze');
  const editable = canAnalyze && claimStatus === 'AWAITING_ANALYSIS';
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['fuel-check', claimId],
    queryFn: () => api.get(`/api/v1/claims/${encodeURIComponent(claimId)}/fuel-check`, FuelCheckView),
    retry: false,
  });
  const tables = useQuery({
    queryKey: ['fuel-tables'],
    queryFn: () => api.get('/api/v1/fuel-tables', FscTableList),
    retry: false,
    enabled: editable,
  });
  useEffect(() => {
    if (q.isError && is404(q.error)) onUnavailable();
  }, [q.isError, q.error, onUnavailable]);
  const inputs = q.data?.inputs ?? null;

  const onDone = async (text: string) => {
    setError(null);
    toast(text, 'success');
    await qc.invalidateQueries({ queryKey: ['fuel-check', claimId] });
  };
  const save = useMutation({
    mutationFn: (body: unknown) => api.put(`/api/v1/claims/${encodeURIComponent(claimId)}/fuel-inputs`, body, SetFuelInputsResponse),
    onSuccess: () => onDone(FUEL_TEXT.saved),
    onError: (e) => setError(fuelInputErrorText(e)),
  });
  const clear = useMutation({
    mutationFn: () => api.delete(`/api/v1/claims/${encodeURIComponent(claimId)}/fuel-inputs`),
    onSuccess: () => onDone(FUEL_TEXT.saved),
    onError: (e) => setError(fuelInputErrorText(e)),
  });

  const r = q.data?.result;
  const tableItems = tables.data?.items ?? [];
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">{FUEL_TEXT.heading}</h3>
      <p className="muted mb-3 text-sm">{FUEL_NOTE}</p>
      {error ? <p role="alert">{error}</p> : null}
      {q.isError && !is404(q.error) ? <p role="alert">{FUEL_TEXT.failed}</p> : null}
      {!q.data ? (
        q.isError ? null : <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        <>
          {r ? <p role="status">{FUEL_STATUS_TEXT[r.status]}</p> : null}
          {q.data.table ? (
            <p className="text-sm">
              {`${FUEL_TEXT.table}: `}
              <SafeText value={q.data.table.name} />
            </p>
          ) : null}
          {r && r.postedDate !== null ? (
            <dl className="my-2 grid grid-cols-[160px_1fr] gap-1 text-sm">
              <dt className="muted">Price posted</dt>
              <dd className="num">{`${r.postedDate}: $${r.price ?? ''} per gallon`}</dd>
              {r.expected !== null ? (
                <>
                  <dt className="muted">Expected</dt>
                  <dd className="num">{`$${r.expected}`}</dd>
                </>
              ) : null}
              <dt className="muted">Billed</dt>
              <dd className="num">{`$${r.billed ?? ''}`}</dd>
              {r.difference !== null ? (
                <>
                  <dt className="muted">Difference</dt>
                  <dd className="num">{`$${r.difference}`}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {r && r.calculation.length > 0 ? (
            <ol className="my-2 flex list-decimal flex-col gap-1 pl-5 text-sm" aria-label="Calculation">
              {r.calculation.map((line, i) => (
                <li key={i}>
                  <SafeText value={line} />
                </li>
              ))}
            </ol>
          ) : null}
          {editable ? (
            <FuelInputsForm
              key={`${inputs?.version ?? 0}:${inputs?.updatedAt ?? ''}`}
              initial={inputs}
              tables={tableItems}
              tablesLoaded={tables.isSuccess}
              pending={save.isPending || clear.isPending}
              onSave={(body) => save.mutate(body)}
              onClear={() => clear.mutate()}
              onInvalid={() => setError(FUEL_TEXT.failed)}
            />
          ) : (
            <p className="muted mt-3 text-sm">{FUEL_TEXT.locked}</p>
          )}
        </>
      )}
    </section>
  );
}
