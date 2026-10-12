// @vitest-environment jsdom
// REQ-20261011-fuel-outlook Tier H web, SHOULD-HAVE S1/S2: T16 Fuel tab (CI-W10), Fuel tables page (CI-W11), Outlook
// page (CI-W12), untrusted names (CI-W13). Part C F15 screens. AppRoot with a scripted fetch serving contract-shaped
// DTOs. Set ACC_SKIP_FUEL_UI=1 when S1 was cut and ACC_SKIP_S2=1 when S2 was cut (recorded in test-plan.md).
import { screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderApp, setupDom } from './helpers/render.js';
import { PERMS, createStub, json, mkClaim, type RoleName } from './helpers/stub.js';

const SKIP = process.env.ACC_SKIP_FUEL_UI === '1';
const S2 = process.env.ACC_SKIP_S2 !== '1';
const WAIT = { timeout: 5000 };
const FEATS: Record<string, boolean> = { 'intelligence.charge_suggestions': true, 'intelligence.cost_outlook': true, 'intelligence.fuel_check': true, 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true };
const FUEL_NOTE = 'The fuel check recomputes the surcharge from your fuel table and the public weekly U.S. diesel price for the ship date. A difference is a finding for review, not a confirmed amount.';
const STATUS_FINDING = 'The billed fuel surcharge differs from the fuel table. Review the finding.';
const TXT = {
  locked: 'Fuel inputs can only change before the claim is analysed.', save: 'Save fuel inputs', forbidden: 'You do not have permission to change fuel inputs.',
  rateLimited: 'Too many requests. Try again later.', failed: 'Could not save the fuel inputs. Try again.', milesMissing: 'Miles are required for a per-mile fuel table.',
  unavailable: 'The fuel table does not exist or is archived.',
};
const OUTLOOK_NOTE = 'Forecasts are shown only at horizons where a model beat "no change" in a walk-forward backtest on public data; other horizons show "no change" with a range. Not a guarantee.';
const SERVER_TEXT = 'SERVER-SIDE-DETAIL-MUST-NOT-RENDER';
const NOW = '2026-10-11T10:00:00.000Z';
const TID = '00000000-0000-4000-8000-00000000f001';
const T1 = { id: TID, name: 'Std DOE table', kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' }, version: 1, archived: false, createdAt: NOW, updatedAt: NOW };
const TP = { ...T1, id: '00000000-0000-4000-8000-00000000f002', name: 'Pct table', kind: 'rows', unit: 'percent', params: { rows: [{ atLeast: '5.00', rate: '30' }, { atLeast: '6.00', rate: '32.5' }, { atLeast: '6.50', rate: '34' }] } };
const CALC = [
  'Ship date 2026-10-07: the U.S. average diesel price posted 2026-10-05 applies 2026-10-07 to 2026-10-13 (Monday posting applies Wednesday to Tuesday).',
  'Fuel table \'Std DOE table\' v1: ceil(($6.199 - $1.20) / $0.06) = 84 step(s) x $0.01 per mile = $0.84 per mile.',
  'Difference: $435.00 - $420.00 = $15.00.',
];
const result = {
  checkVersion: 'fsc-v1', status: 'finding', priceSeries: 'diesel_us', postedDate: '2026-10-05', price: '6.199', effectiveFrom: '2026-10-07', effectiveTo: '2026-10-13',
  rate: '0.84', expected: '420.00', billed: '435.00', difference: '15.00', direction: 'overcharge', alternative: { postedDate: '2026-09-28', price: '6.382', weeks: 1, later: false },
  calculation: CALC, priceImport: { id: '00000000-0000-4000-8000-00000000f0aa', sha256: 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf', retrievedAt: '2026-10-11', sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW' },
};
const hz = (h: number, unit: string, targetDate: string, method: string, reason: string, p: [string, string, string], cov: number, fsc: null | { point: string; low: string; high: string } = null) => ({
  h, unit, targetDate, method, reason, point: p[0], low: p[1], high: p[2], backtest: { candidate: method, origins: 779, maeRatio: 0.85, dm: 5.64, coverage: cov, coverageHits: 1, coverageCases: 1 }, fsc,
});
function outlook(withFsc: boolean) {
  const f = (a: string, b: string, c: string) => (withFsc ? { point: a, low: b, high: c } : null);
  return {
    outlookVersion: 'outlook-v1', note: OUTLOOK_NOTE,
    fscTable: withFsc ? { id: TID, name: 'Std DOE table', version: 1, unit: 'per_mile', current: '0.84' } : null,
    series: [
      {
        key: 'diesel_us', label: 'U.S. average diesel price', unit: 'USD per gallon', frequency: 'weekly', status: 'ok',
        citation: 'U.S. Energy Information Administration, US Diesel Sales Price [GASDESW], retrieved from FRED, Federal Reserve Bank of St. Louis',
        provenance: { importId: '00000000-0000-4000-8000-00000000f0aa', sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW', retrievedAt: '2026-10-11', sha256: result.priceImport.sha256, rowCount: 1699, firstDate: '1994-03-21', lastDate: '2026-10-05', sourceKind: 'bundled' }, // sourceKind: hardening C8.2 (additive; strict client parse)
        latest: { date: '2026-10-05', value: '6.199' }, backtestYears: { from: 2011, to: 2026 },
        horizons: [
          hz(1, 'week', '2026-10-12', 'ar2', 'model_beats_naive', ['6.124', '5.903', '6.392'], 0.779, f('0.83', '0.79', '0.87')),
          hz(4, 'week', '2026-11-02', 'combo', 'model_beats_naive', ['6.136', '5.301', '7.175'], 0.789, f('0.83', '0.69', '1.00')),
          hz(8, 'week', '2026-11-30', 'naive', 'naive_by_design', ['6.199', '4.777', '8.189'], 0.778, f('0.84', '0.60', '1.17')),
          hz(13, 'week', '2027-01-04', 'naive', 'naive_by_design', ['6.199', '4.384', '9.395'], 0.769, f('0.84', '0.54', '1.37')),
        ],
      },
      {
        key: 'ppi_tl', label: 'Producer price index, long-distance truckload', unit: 'index (Jun 1992 = 100)', frequency: 'monthly', status: 'ok',
        citation: 'U.S. Bureau of Labor Statistics, Producer Price Index by Industry: General Freight Trucking, Long-Distance Truckload [PCU4841214841212], retrieved from FRED, Federal Reserve Bank of St. Louis',
        provenance: { importId: '00000000-0000-4000-8000-00000000f0bb', sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU4841214841212', retrievedAt: '2026-10-11', sha256: '83894390a4fd80d6033f9d18299e97b27e670427bbb5e6aa090cdca0d4a44bea', rowCount: 411, firstDate: '1992-06-01', lastDate: '2026-08-01', sourceKind: 'bundled' }, // sourceKind: hardening C8.2 (additive; strict client parse)
        latest: { date: '2026-08-01', value: '215.105' }, backtestYears: { from: 2009, to: 2026 },
        horizons: [hz(1, 'month', '2026-09-01', 'ar2', 'model_beats_naive', ['218.0', '210.9', '225.9'], 0.74)],
      },
    ],
  };
}
const err = (status: number, code: string) => json(status, { error: { code, message: SERVER_TEXT, requestId: 'r' } });

setupDom();
/** /me serves the shared RBAC matrix (the API's source of truth, F12). The step-4 `PERMS` fixture predates
 *  `claims:analyze` for ANALYST and `settings:manage` for OWNER/ADMIN, so it cannot drive the fuel screens. */
let MATRIX: Record<string, readonly string[]> = {};
beforeAll(async () => { MATRIX = ((await import('@fr/shared')) as unknown as { PERMISSION_MATRIX: Record<string, readonly string[]> }).PERMISSION_MATRIX; });

interface StubO { status?: string; features?: Record<string, boolean>; check?: () => Response; put?: () => Response; tables?: unknown[] }
function mkStub(role: RoleName, o: StubO = {}) {
  const c = mkClaim(1, { status: o.status ?? 'AWAITING_ANALYSIS', latestPacket: o.status === 'PENDING_REVIEW' ? { revision: 1, status: 'PENDING_REVIEW' } : null });
  const stub = createStub({ role, claims: [c] });
  const calls: { method: string; path: string; body: unknown }[] = [];
  let tables = o.tables ?? [T1, TP];
  stub.on('GET', /\/api\/v1\/me$/, () => json(200, { user: stub.user, permissions: [...(MATRIX[role] ?? [])] }));
  stub.on('GET', /\/features$/, () => json(200, { flags: o.features ?? FEATS }));
  stub.on('GET', /\/claims\/[^/]+\/charge-lines$/, () => err(404, 'not_found'));
  stub.on('GET', /\/claims\/[^/]+\/fuel-check$/, () => (o.check ? o.check() : json(200, { claimId: c.id, inputs: { claimId: c.id, shipDate: '2026-10-07', miles: '500.0', fscTableId: TID, version: 1, updatedAt: NOW }, table: T1, result })));
  stub.on('PUT', /\/claims\/[^/]+\/fuel-inputs$/, (call) => { calls.push({ method: 'PUT', path: call.path, body: call.body }); return o.put ? o.put() : json(200, { inputs: { claimId: c.id, shipDate: '2026-10-07', miles: '500.0', fscTableId: TID, version: 2, updatedAt: NOW }, outcome: 'changed' }); });
  stub.on('GET', /\/fuel-tables(\?.*)?$/, () => json(200, { items: tables }));
  stub.on('POST', /\/fuel-tables$/, (call) => { calls.push({ method: 'POST', path: call.path, body: call.body }); return json(201, { ...T1, id: '00000000-0000-4000-8000-00000000f003', ...(call.body as object) }); });
  stub.on('PUT', /\/fuel-tables\/[^/]+$/, (call) => { calls.push({ method: 'PUT', path: call.path, body: call.body }); const { expectedVersion: _ev, ...b } = call.body as Record<string, unknown>; return json(200, { ...TP, ...b, version: 2 }); }); // FscTable has no expectedVersion (F10)
  stub.on('DELETE', /\/fuel-tables\/[^/]+$/, (call) => { calls.push({ method: 'DELETE', path: call.path, body: null }); tables = tables.filter((t) => !call.path.endsWith((t as { id: string }).id)); return new Response(null, { status: 204 }); });
  stub.on('GET', /\/outlook(\?.*)?$/, (call) => json(200, outlook(call.query.has('fscTableId'))));
  return { stub, c, calls };
}
async function openFuel(stub: ReturnType<typeof createStub>) {
  const r = await renderApp(stub, ['/claims']);
  await r.user.click(await screen.findByRole('link', { name: 'CLM-0001' }, WAIT));
  const dlg = await screen.findByRole('dialog', { name: 'Claim CLM-0001' }, WAIT);
  const tabs = await within(dlg).findAllByRole('tab', {}, WAIT);
  const names = tabs.map((t) => t.textContent?.trim());
  await r.user.click(await within(dlg).findByRole('tab', { name: 'Fuel' }, WAIT));
  return { ...r, dlg, names };
}

describe.skipIf(SKIP)('T16 web (F15 screens)', () => {
  it('CI-W10 Fuel tab after Charges: note, status, amounts and calculation; ANALYST edits on AWAITING_ANALYSIS', async () => {
    const { stub } = mkStub('ANALYST');
    const { dlg, names } = await openFuel(stub);
    expect(names.indexOf('Fuel')).toBe(names.indexOf('Charges') + 1);
    await within(dlg).findByText(FUEL_NOTE, {}, WAIT);
    expect(within(dlg).getByText(STATUS_FINDING)).toBeTruthy();
    for (const t of ['$420.00', '$435.00', ...CALC]) expect(within(dlg).getAllByText(t, { exact: false }).length, t).toBeGreaterThan(0);
    expect(within(dlg).getByLabelText('Ship date')).toBeTruthy();
    expect(within(dlg).getByLabelText('Miles')).toBeTruthy();
    expect(within(dlg).getByLabelText('Fuel table')).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: TXT.save })).toBeTruthy();
  });
  it('CI-W10 PENDING_REVIEW shows the locked text and no controls; VIEWER has no controls', async () => {
    for (const [role, status] of [['ANALYST', 'PENDING_REVIEW'], ['VIEWER', 'AWAITING_ANALYSIS']] as const) {
      const { stub } = mkStub(role, { status });
      const { dlg, view } = await openFuel(stub);
      await within(dlg).findByText(FUEL_NOTE, {}, WAIT);
      if (status === 'PENDING_REVIEW') expect(within(dlg).getByText(TXT.locked)).toBeTruthy();
      expect(within(dlg).queryByRole('button', { name: TXT.save }), role).toBeNull();
      view.unmount();
    }
  });
  it('CI-W10 a 404 hides the tab after selecting it', async () => {
    const { stub } = mkStub('ANALYST', { check: () => err(404, 'not_found') });
    const { dlg } = await openFuel(stub);
    await waitFor(() => expect(within(dlg).queryByRole('tab', { name: 'Fuel' })).toBeNull(), WAIT);
  });
  it.each([
    [403, 'forbidden', TXT.forbidden], [409, 'invalid_state', TXT.locked], [422, 'miles_required', TXT.milesMissing],
    [422, 'fuel_table_unavailable', TXT.unavailable], [429, 'rate_limited', TXT.rateLimited], [500, 'internal', TXT.failed],
  ] as const)('CI-W10 save error %i %s -> alert text; server text never shown', async (status, code, text) => {
    const { stub } = mkStub('ANALYST', { put: () => err(status, code) });
    const { dlg, user } = await openFuel(stub);
    await user.click(await within(dlg).findByRole('button', { name: TXT.save }, WAIT));
    const alert = await within(dlg).findByRole('alert', {}, WAIT);
    await waitFor(() => expect(alert.textContent).toContain(text), WAIT);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });
  it('CI-W11 Fuel tables page: OWNER adds/archives, rows round-trip as "atLeast,rate" lines; REVIEWER read-only; nav iff flag', async () => {
    const { stub, calls } = mkStub('OWNER');
    const r = await renderApp(stub, ['/settings/fuel-tables']);
    await screen.findByRole('heading', { name: 'Fuel tables' }, WAIT);
    await screen.findByText('Std DOE table', {}, WAIT); // the list loads after the heading
    expect(screen.getByRole('button', { name: 'Add fuel table' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fuel tables' })).toBeTruthy();
    const editPct = screen.getAllByRole('button', { name: /edit/i }).find((b) => (b.getAttribute('aria-label') ?? b.closest('tr')?.textContent ?? '').includes('Pct table'));
    if (editPct) {
      await r.user.click(editPct);
      const area = (await screen.findAllByRole('textbox', {}, WAIT)).find((t) => (t as HTMLTextAreaElement).value.includes('6.00,32.5')) as HTMLTextAreaElement | undefined;
      expect(area?.value.split(/\r?\n/).filter(Boolean)).toEqual(['5.00,30', '6.00,32.5', '6.50,34']);
      await r.user.click(screen.getByRole('button', { name: 'Save fuel table' }));
      await screen.findByText('Fuel table saved.', {}, WAIT);
      const put = calls.find((x) => x.method === 'PUT');
      expect(put?.body).toMatchObject({ params: TP.params, expectedVersion: 1 });
    } else {
      throw new Error('no edit control for the rows table');
    }
    const archive = screen.getAllByRole('button', { name: /Archive/ })[0];
    if (!archive) throw new Error('no Archive control');
    await r.user.click(archive);
    const confirm = screen.queryByRole('button', { name: /confirm|archive/i });
    if (confirm && confirm !== archive) await r.user.click(confirm);
    await screen.findByText('Fuel table archived.', {}, WAIT);
    expect(calls.some((x) => x.method === 'DELETE')).toBe(true);
    r.view.unmount();
    const rv = mkStub('REVIEWER');
    const r2 = await renderApp(rv.stub, ['/settings/fuel-tables']);
    await screen.findByText('Std DOE table', {}, WAIT);
    expect(screen.queryByRole('button', { name: 'Add fuel table' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Archive/ })).toBeNull();
    r2.view.unmount();
    const off = mkStub('OWNER', { features: { ...FEATS, 'intelligence.fuel_check': false } });
    const r3 = await renderApp(off.stub, ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    expect(screen.queryByRole('link', { name: 'Fuel tables' })).toBeNull();
    r3.view.unmount();
    expect(PERMS.REVIEWER).toBeDefined();
  });
  it('CI-W12 Outlook page: note once, backtest text, labels, ranges, rangeText, provenance; nav iff flag', async () => {
    const { stub } = mkStub('VIEWER');
    const r = await renderApp(stub, ['/outlook']);
    await screen.findByRole('heading', { name: 'Cost outlook' }, WAIT);
    await screen.findByText('Backtested on public data 2011-2026; not a guarantee.', {}, WAIT); // the outlook loads after the heading
    expect(screen.getAllByText(OUTLOOK_NOTE)).toHaveLength(1);
    expect(screen.getByText('Backtested on public data 2009-2026; not a guarantee.')).toBeTruthy();
    for (const t of ['Trend model', 'Average of trend model and no change', 'No change', 'Beat "no change" in the backtest', 'No model beat "no change" at this horizon'])
      expect(screen.getAllByText(t, { exact: false }).length, t).toBeGreaterThan(0);
    for (const t of ['6.124', '5.903 - 6.392', '7.175', '218.0', '210.9 - 225.9']) expect(screen.getAllByText(t, { exact: false }).length, t).toBeGreaterThan(0);
    expect(screen.getAllByText('80% range. In the backtest, 78% of outcomes fell inside ranges built this way.', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('file sha256 aca8fefdbb54', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Data: U.S. Energy Information Administration', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Outlook' })).toBeTruthy();
    if (S2) {
      await r.user.selectOptions(await screen.findByLabelText('Fuel table', {}, WAIT), TID); // the table list loads after the outlook
      for (const t of ['0.83', '0.79', '0.87', '1.37']) await screen.findAllByText(t, { exact: false }, WAIT);
    }
    r.view.unmount();
    const off = mkStub('VIEWER', { features: { ...FEATS, 'intelligence.cost_outlook': false } });
    const r2 = await renderApp(off.stub, ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    expect(screen.queryByRole('link', { name: 'Outlook' })).toBeNull();
    r2.view.unmount();
  });
  it('CI-W13 an untrusted table name renders as text', async () => {
    const hostile = { ...T1, name: '<img src=x onerror=alert(1)>' };
    const { stub } = mkStub('OWNER', { tables: [hostile] });
    const r = await renderApp(stub, ['/settings/fuel-tables']);
    await screen.findByText('<img src=x onerror=alert(1)>', {}, WAIT);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    r.view.unmount();
  });
});

// REQ-20261012-hardening T7 HD-W08 / HD-W10 (Part C C6, C7.6, C7.8).
describe.skipIf(SKIP)('HD-W08 / HD-W10 fuel tables limit text and price source kind', () => {
  const LIMIT = 'This organization has reached the maximum of 50 fuel tables. Archived tables count toward this limit.';
  const KIND = { fetch: 'Downloaded from FRED by the import command.', bundled: 'From the files bundled with the product, checked against their pinned sha256.', file: 'Imported from a file supplied by the operator; the product did not download it.' } as const;
  it('HD-W08 create answers 409 fuel_table_limit_reached -> FUEL_TABLE_LIMIT_TEXT; server text never shown', async () => {
    const { stub } = mkStub('OWNER');
    stub.on('POST', /\/fuel-tables$/, () => err(409, 'fuel_table_limit_reached'));
    const r = await renderApp(stub, ['/settings/fuel-tables']);
    await screen.findByText('Std DOE table', {}, WAIT);
    await r.user.click(screen.getByRole('button', { name: 'Add fuel table' }));
    await r.user.type(await screen.findByLabelText('Name', {}, WAIT), 'Limit probe table');
    await r.user.type(screen.getByLabelText('Base price'), '1.20');
    await r.user.type(screen.getByLabelText('Step size'), '0.06');
    await r.user.type(screen.getByLabelText('Rate per step'), '0.01');
    await r.user.click(screen.getByRole('button', { name: 'Save fuel table' }));
    await waitFor(() => expect(screen.queryAllByRole('alert').some((a) => (a.textContent ?? '').includes(LIMIT))).toBe(true), WAIT);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    r.view.unmount();
  });
  for (const kind of ['bundled', 'file', 'fetch'] as const) {
    it(`HD-W10 sourceKind ${kind}: the matching paragraph under each provenance line; provenance line unchanged`, async () => {
      const { stub } = mkStub('VIEWER');
      stub.on('GET', /\/outlook(\?.*)?$/, () => {
        const o = outlook(false);
        return json(200, { ...o, series: o.series.map((s) => ({ ...s, provenance: { ...s.provenance, sourceKind: kind } })) });
      });
      const r = await renderApp(stub, ['/outlook']);
      await screen.findByText('Backtested on public data 2011-2026; not a guarantee.', {}, WAIT);
      const paras = screen.getAllByText(KIND[kind]);
      expect(paras).toHaveLength(2);
      for (const p of paras) expect(p.tagName.toLowerCase()).toBe('p');
      for (const other of Object.keys(KIND) as (keyof typeof KIND)[]) if (other !== kind) expect(document.body.textContent).not.toContain(KIND[other]);
      expect(screen.getAllByText('file sha256 aca8fefdbb54', { exact: false }).length, 'provenance line unchanged').toBeGreaterThan(0);
      r.view.unmount();
    });
  }
});
