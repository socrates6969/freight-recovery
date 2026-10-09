import { ClaimsPage as ClaimsPageSchema, type ClaimSortField } from '@fr/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router-dom';

import { useApi, useCan } from '../../app-context';
import { ExportMenu } from '../../components/ui/ExportMenu';
import { SafeText } from '../../components/ui/SafeText';
import { formatDateTime, formatUsdCents, STATUS_LABEL } from '../../lib/format';

const COLUMNS: { label: string; field: ClaimSortField }[] = [
  { label: 'Claim', field: 'claimNumber' },
  { label: 'Load', field: 'loadNumber' },
  { label: 'Carrier', field: 'carrierName' },
  { label: 'Status', field: 'status' },
  { label: 'Recoverable', field: 'recoverableCents' },
  { label: 'Updated', field: 'updatedAt' },
];
const STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY', 'AWAITING_ANALYSIS'] as const;
const DEFAULT_SORT = 'createdAt:desc';
const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

/** Only whitelisted, well-formed keys from the URL reach the API query string. */
export function claimsApiQuery(params: URLSearchParams): string {
  const out = new URLSearchParams();
  const q = params.get('q')?.trim();
  if (q) out.set('q', q.slice(0, 100));
  const status = params.get('status');
  if (status && (STATUSES as readonly string[]).includes(status)) out.set('status', status);
  const perspective = params.get('perspective');
  if (perspective === 'SHIPPER' || perspective === 'CARRIER') out.set('perspective', perspective);
  const sort = params.get('sort');
  if (sort && /^[A-Za-z]+:(asc|desc)$/u.test(sort)) out.set('sort', sort);
  const page = Number(params.get('page') ?? '1');
  out.set('page', String(Number.isInteger(page) && page > 0 ? page : 1));
  out.set('pageSize', String(PAGE_SIZE));
  return out.toString();
}

/** Export request for the current list: the same whitelisted q/status/perspective/sort, no paging. */
export function claimsExportPath(params: URLSearchParams, format: 'csv' | 'xlsx'): string {
  const q = new URLSearchParams(claimsApiQuery(params));
  q.delete('page');
  q.delete('pageSize');
  q.set('format', format);
  return `/api/v1/exports/claims?${q.toString()}`;
}

export function ClaimsPage() {
  const api = useApi();
  const canExport = useCan('export:claims');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const apiQuery = claimsApiQuery(params);
  const sort = params.get('sort') ?? DEFAULT_SORT;
  const [sortField, sortDir] = sort.split(':') as [string, 'asc' | 'desc'];
  const page = Number(new URLSearchParams(apiQuery).get('page'));

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const nextParams = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') nextParams.delete(k);
      else nextParams.set(k, v);
    }
    if (resetPage) nextParams.delete('page');
    setParams(nextParams, { replace: true });
  };

  useEffect(() => {
    const current = params.get('q') ?? '';
    if (search === current) return undefined;
    const id = setTimeout(() => update({ q: search.trim() || null }), DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const claims = useQuery({
    queryKey: ['claims', apiQuery],
    queryFn: () => api.get(`/api/v1/claims?${apiQuery}`, ClaimsPageSchema),
    placeholderData: keepPreviousData,
  });

  const toggleSort = (field: string) => {
    const dir = sortField === field && sortDir === 'asc' ? 'desc' : 'asc';
    update({ sort: `${field}:${dir}` });
  };

  const total = claims.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const listSearch = params.toString();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">Claims</h1>
        <div className="flex items-start gap-3">
          <p className="muted num pt-2 text-sm">{claims.data ? `${total} claims` : ''}</p>
          {canExport ? <ExportMenu label="Export" fallbackName="freight-recovery-claims" pathFor={(f) => claimsExportPath(params, f)} /> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          className="input max-w-xs"
          aria-label="Search claims"
          placeholder="Search claim, load, invoice, carrier, shipper"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-44" aria-label="Status" value={params.get('status') ?? ''} onChange={(e) => update({ status: e.target.value || null })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="input w-40" aria-label="Perspective" value={params.get('perspective') ?? ''} onChange={(e) => update({ perspective: e.target.value || null })}>
          <option value="">All perspectives</option>
          <option value="SHIPPER">Shipper</option>
          <option value="CARRIER">Carrier</option>
        </select>
      </div>

      {claims.isError ? (
        <div className="card flex items-center justify-between gap-3 p-4">
          <p role="alert" className="text-[var(--color-danger)]">
            Claims could not be loaded.
          </p>
          <button type="button" className="btn" disabled={claims.isFetching} onClick={() => void claims.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="card max-h-[70vh] overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const active = sortField === c.field;
                  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
                  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <th key={c.field} aria-sort={ariaSort} scope="col" className={c.field === 'recoverableCents' ? 'text-right' : ''}>
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(c.field)}>
                        {c.label}
                        <Icon size={12} aria-hidden="true" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {claims.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} aria-hidden="true">
                      {COLUMNS.map((c) => (
                        <td key={c.field}>
                          <div className="skeleton w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                : claims.data?.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/claims/${c.id}${listSearch ? `?${listSearch}` : ''}`} data-claim-id={c.id} className="num font-medium text-[var(--color-accent)]">
                          <SafeText value={c.claimNumber} />
                        </Link>
                      </td>
                      <td className="num max-w-40">
                        <SafeText value={c.loadNumber ?? '—'} />
                      </td>
                      <td className="max-w-64">
                        <SafeText value={c.carrierName} />
                      </td>
                      <td>
                        <span className="badge">{STATUS_LABEL[c.status] ?? c.status}</span>
                      </td>
                      <td className="num text-right">{formatUsdCents(c.recoverableCents)}</td>
                      <td className="num muted whitespace-nowrap">{formatDateTime(c.updatedAt)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {claims.data && claims.data.items.length === 0 ? <p className="muted p-6 text-center">No claims match these filters.</p> : null}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <span className="muted num text-sm">
          Page {page} of {lastPage}
        </span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
          Previous page
        </button>
        <button type="button" className="btn" disabled={page >= lastPage} onClick={() => update({ page: String(page + 1) }, false)}>
          Next page
        </button>
      </div>
      <Outlet />
    </div>
  );
}
