/**
 * Step 7 web units (REQ-20261011-fuel-outlook, F15): the claim sheet Fuel tab (flag-gated, 404 hides it,
 * status text and calculation as text, inputs form only with claims:analyze while AWAITING_ANALYSIS, fixed
 * error texts) and the Fuel tables page (list, add with schema validation, fixed 409 texts).
 */
import { FUEL_NOTE, FUEL_STATUS_TEXT, FUEL_TABLES_TEXT, FUEL_TEXT, PERMISSION_MATRIX, type Role } from '@fr/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api/client';
import { AppRoot } from '../src/app-root';
import { fuelInputErrorText } from '../src/features/fuel/FuelPanel';
import { fuelTableErrorText, parseRows, tableBody } from '../src/features/fuel/FuelTablesPage';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(1)>';
const FLAGS_ON = {
  'intelligence.charge_suggestions': true,
  'intelligence.cost_outlook': true,
  'intelligence.fuel_check': true,
  'intelligence.provenance': true,
  'intelligence.similar_claims': true,
  'intelligence.worklist': true,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const err = (status: number, code: string) => json(status, { error: { code, message: 'SERVER TEXT', requestId: 'r' } });

const claim = (status: string) => ({
  id: U(500),
  claimNumber: 'CLM-0500',
  loadNumber: null,
  invoiceNumber: null,
  carrierName: 'Carrier',
  shipperName: 'Shipper',
  perspective: 'SHIPPER',
  status,
  amountClaimedCents: 0,
  recoverableCents: 0,
  pendingReviewCents: 0,
  currency: 'USD',
  assignee: null,
  latestPacket: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  invoiceDate: null,
});

const table = {
  id: U(600),
  name: `Acme FSC ${HOSTILE}`,
  kind: 'step',
  unit: 'per_mile',
  priceSeries: 'diesel_us',
  effectiveOffsetDays: 2,
  params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' },
  version: 1,
  archived: false,
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
};

const CALC = [
  'Ship date 2026-10-07: the U.S. average diesel price posted 2026-10-05 applies 2026-10-07 to 2026-10-13 (Monday posting applies Wednesday to Tuesday).',
  `Billed fuel lines: 'Fuel ${HOSTILE}' $435.00 = $435.00.`,
];

const view = {
  claimId: U(500),
  inputs: { claimId: U(500), shipDate: '2026-10-07', miles: '500.0', fscTableId: U(600), version: 1, updatedAt: '2026-10-11T00:00:00.000Z' },
  table,
  result: {
    checkVersion: 'fsc-v1',
    status: 'finding',
    priceSeries: 'diesel_us',
    postedDate: '2026-10-05',
    price: '6.199',
    effectiveFrom: '2026-10-07',
    effectiveTo: '2026-10-13',
    rate: '0.84',
    expected: '420.00',
    billed: '435.00',
    difference: '15.00',
    direction: 'overcharge',
    alternative: null,
    calculation: CALC,
    priceImport: { id: U(700), sha256: 'a'.repeat(64), retrievedAt: '2026-10-11', sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW' },
  },
};

function setup(role: Role, opts: { status?: string; flags?: Record<string, boolean>; check?: () => Response; put?: () => Response; post?: () => Response; tables?: unknown[] } = {}) {
  const user = { id: U(1), email: 'u@x.test', name: 'Test User', role, tenant: { id: U(90), name: 'Acme (synthetic)' }, mfaEnabled: true };
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null });
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user });
    if (u === '/api/v1/me') return json(200, { user, permissions: [...PERMISSION_MATRIX[role]] });
    if (u === '/api/v1/features') return json(200, { flags: opts.flags ?? FLAGS_ON });
    if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
    if (u === `/api/v1/claims/${U(500)}`) return json(200, claim(opts.status ?? 'AWAITING_ANALYSIS'));
    if (u === `/api/v1/claims/${U(500)}/fuel-check`) return opts.check ? opts.check() : json(200, view);
    if (u.startsWith('/api/v1/fuel-tables') && method === 'GET') return json(200, { items: opts.tables ?? [table] });
    if (u === `/api/v1/claims/${U(500)}/fuel-inputs` && method === 'PUT') {
      if (opts.put) return opts.put();
      return json(200, { inputs: { ...view.inputs, miles: '510.0', version: 2 }, outcome: 'changed' });
    }
    if (u === '/api/v1/fuel-tables' && method === 'POST') return opts.post ? opts.post() : json(201, { ...table, id: U(601), name: 'New table' });
    return err(404, 'not_found');
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe('claim sheet Fuel tab', () => {
  it('shows the note, status text, numbers and calculation as text; analysts can save the inputs', async () => {
    const { fetchImpl, calls } = setup('ANALYST');
    const u = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${U(500)}`]} />);
    await u.click(await screen.findByRole('tab', { name: FUEL_TEXT.tab }));
    expect(await screen.findByRole('heading', { name: FUEL_TEXT.heading })).toBeInTheDocument();
    expect(screen.getByText(FUEL_NOTE)).toBeInTheDocument();
    expect(screen.getByText(FUEL_STATUS_TEXT.finding)).toBeInTheDocument();
    expect(container.textContent).toContain('2026-10-05: $6.199 per gallon');
    expect(container.textContent).toContain(CALC[1]);
    expect(container.ownerDocument.querySelector('script, img')).toBeNull();
    const miles = await screen.findByLabelText(FUEL_TEXT.miles);
    expect(miles).toHaveValue('500.0');
    await u.clear(miles);
    await u.type(miles, '510');
    await u.click(screen.getByRole('button', { name: FUEL_TEXT.save }));
    expect(await screen.findByText(FUEL_TEXT.saved)).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ shipDate: '2026-10-07', miles: '510', fscTableId: U(600) });
  });

  it('viewers and analysed claims show the locked text and no controls', async () => {
    const viewer = setup('VIEWER');
    const u = userEvent.setup();
    const first = render(<AppRoot fetchImpl={viewer.fetchImpl} initialEntries={[`/claims/${U(500)}`]} />);
    await u.click(await screen.findByRole('tab', { name: FUEL_TEXT.tab }));
    expect(await screen.findByText(FUEL_TEXT.locked)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: FUEL_TEXT.save })).toBeNull();
    first.unmount();
    const analysed = setup('ANALYST', { status: 'PENDING_REVIEW' });
    render(<AppRoot fetchImpl={analysed.fetchImpl} initialEntries={[`/claims/${U(500)}`]} />);
    await u.click(await screen.findByRole('tab', { name: FUEL_TEXT.tab }));
    expect(await screen.findByText(FUEL_TEXT.locked)).toBeInTheDocument();
    expect(screen.queryByLabelText(FUEL_TEXT.miles)).toBeNull();
  });

  it('server errors map to fixed texts, never server text', async () => {
    const { fetchImpl } = setup('ANALYST', { put: () => err(422, 'miles_required') });
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${U(500)}`]} />);
    await u.click(await screen.findByRole('tab', { name: FUEL_TEXT.tab }));
    await u.click(await screen.findByRole('button', { name: FUEL_TEXT.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(FUEL_STATUS_TEXT.miles_missing);
    expect(screen.queryByText('SERVER TEXT')).toBeNull();
    expect(fuelInputErrorText(new ApiError(403, 'forbidden', 'x'))).toBe(FUEL_TEXT.forbidden);
    expect(fuelInputErrorText(new ApiError(409, 'invalid_state', 'x'))).toBe(FUEL_TEXT.locked);
    expect(fuelInputErrorText(new ApiError(422, 'fuel_table_unavailable', 'x'))).toBe('The fuel table does not exist or is archived.');
    expect(fuelInputErrorText(new ApiError(429, 'rate_limited', 'x'))).toBe(FUEL_TEXT.rateLimited);
    expect(fuelInputErrorText(new Error('x'))).toBe(FUEL_TEXT.failed);
  });

  it('flag off -> no tab; 404 -> the tab disappears', async () => {
    const off = setup('ANALYST', { flags: { ...FLAGS_ON, 'intelligence.fuel_check': false } });
    const u = userEvent.setup();
    const first = render(<AppRoot fetchImpl={off.fetchImpl} initialEntries={[`/claims/${U(500)}`]} />);
    expect(await screen.findByRole('tab', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: FUEL_TEXT.tab })).toBeNull();
    first.unmount();
    const gone = setup('ANALYST', { check: () => err(404, 'not_found') });
    render(<AppRoot fetchImpl={gone.fetchImpl} initialEntries={[`/claims/${U(500)}`]} />);
    await u.click(await screen.findByRole('tab', { name: FUEL_TEXT.tab }));
    await screen.findByRole('tab', { name: 'Summary', selected: true });
    expect(screen.queryByRole('tab', { name: FUEL_TEXT.tab })).toBeNull();
  });
});

describe('Fuel tables page', () => {
  it('lists tables as text; owners add a validated table; 409 limit shows the fixed text', async () => {
    const { fetchImpl, calls } = setup('OWNER', { post: () => err(409, 'fuel_table_limit_reached') });
    const u = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/settings/fuel-tables']} />);
    expect(await screen.findByRole('heading', { name: FUEL_TABLES_TEXT.heading })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: FUEL_TABLES_TEXT.heading })).toHaveTextContent(`Acme FSC ${HOSTILE}`);
    expect(container.ownerDocument.querySelector('script, img')).toBeNull();
    expect(screen.getByRole('link', { name: FUEL_TABLES_TEXT.nav })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: FUEL_TABLES_TEXT.add }));
    await u.type(screen.getByLabelText('Name'), 'New table');
    await u.type(screen.getByLabelText('Base price'), '1.20');
    await u.type(screen.getByLabelText('Step size'), '0.06');
    await u.type(screen.getByLabelText('Rate per step'), '0.01');
    await u.click(screen.getByRole('button', { name: FUEL_TABLES_TEXT.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(FUEL_TABLES_TEXT.limit);
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/v1/fuel-tables');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      name: 'New table',
      kind: 'step',
      unit: 'per_mile',
      priceSeries: 'diesel_us',
      effectiveOffsetDays: 2,
      params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' },
    });
  });

  it('viewers see no add/edit controls; an invalid form is not sent', async () => {
    const viewer = setup('VIEWER');
    const first = render(<AppRoot fetchImpl={viewer.fetchImpl} initialEntries={['/settings/fuel-tables']} />);
    await screen.findByRole('table', { name: FUEL_TABLES_TEXT.heading });
    expect(screen.queryByRole('button', { name: FUEL_TABLES_TEXT.add })).toBeNull();
    expect(screen.queryByRole('button', { name: FUEL_TABLES_TEXT.archive })).toBeNull();
    first.unmount();
    const owner = setup('OWNER');
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={owner.fetchImpl} initialEntries={['/settings/fuel-tables']} />);
    await u.click(await screen.findByRole('button', { name: FUEL_TABLES_TEXT.add }));
    await u.click(screen.getByRole('button', { name: FUEL_TABLES_TEXT.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(FUEL_TABLES_TEXT.failed);
    expect(owner.calls.some((c) => c.method === 'POST' && c.url === '/api/v1/fuel-tables')).toBe(false);
  });

  it('rows parsing, body validation and the error mapping', () => {
    expect(parseRows(' 1.20, 0.01\n\n1.26,0.02 \n')).toEqual([
      { atLeast: '1.20', rate: '0.01' },
      { atLeast: '1.26', rate: '0.02' },
    ]);
    const base = { name: 'R', kind: 'rows', unit: 'per_mile', offset: 2, basePrice: '', stepSize: '', ratePerStep: '', bracket: 'above_base', mpg: '', decimals: 2 } as const;
    expect(tableBody({ ...base, rows: '1.20,0.01\n1.26,0.02' })).not.toBeNull();
    expect(tableBody({ ...base, rows: '1.26,0.01\n1.20,0.02' })).toBeNull();
    expect(fuelTableErrorText(new ApiError(409, 'stale_revision', 'x'))).toBe(FUEL_TABLES_TEXT.stale);
    expect(fuelTableErrorText(new ApiError(409, 'conflict', 'x'))).toBe(FUEL_TABLES_TEXT.nameTaken);
    expect(fuelTableErrorText(new ApiError(403, 'forbidden', 'x'))).toBe(FUEL_TABLES_TEXT.forbidden);
    expect(fuelTableErrorText(new ApiError(500, 'internal_error', 'x'))).toBe(FUEL_TABLES_TEXT.failed);
  });
});
