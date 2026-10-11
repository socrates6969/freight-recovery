// REQ-20261011-fuel-outlook Tier H (written now; run after the owner's go-ahead): T9 fuel tables (CI-A01..A07),
// T10 fuel inputs, fuel-check view and analysis (CI-A10..A17), T13 fuel_check flag (CI-X02), T15 audit (CI-U01,
// CI-U02) for the fuel events. Part C F4-F6, F10-F13, F16. Black-box: HTTP, audit rows over SQL; owner SQL only to
// clear this file's fuel rows. Expected texts come from test-spec CI-F01 (verified against the test-owned oracle).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, ALL_ROLES, Client, type RoleName, type Res, type Session, buildTestApp, closeApps, expectError, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { oParamsSha } from './helpers/canon-oracle.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

const SHA_DIESEL = 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf';
const URL_DIESEL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW';
const CITE = 'U.S. Energy Information Administration, US Diesel Sales Price [GASDESW], retrieved from FRED, Federal Reserve Bank of St. Louis';
const MSGS: Record<string, string> = {
  fuel_table_limit_reached: 'This organization has reached the maximum number of fuel tables.',
  fuel_table_unavailable: 'The fuel table does not exist or is archived.',
  miles_required: 'Miles are required for a per-mile fuel table.',
};
const T1_BODY = { name: 'Std DOE table', kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' } };
const F1_CALC = [
  'Ship date 2026-10-07: the U.S. average diesel price posted 2026-10-05 applies 2026-10-07 to 2026-10-13 (Monday posting applies Wednesday to Tuesday).',
  `Price posted 2026-10-05: $6.199 per gallon (${CITE}; file sha256 aca8fefdbb54).`,
  "Fuel table 'Std DOE table' v1: ceil(($6.199 - $1.20) / $0.06) = 84 step(s) x $0.01 per mile = $0.84 per mile.",
  'Expected: 500.0 miles x $0.84 per mile = $420.00.',
  "Billed fuel lines: 'Fuel surcharge' $435.00 = $435.00.",
  'Difference: $435.00 - $420.00 = $15.00.',
  'The billed amount equals the table result for the price posted 2026-09-28 ($6.382), 1 week(s) earlier than the applicable posting.',
];
const F1_EXPL = "Billed fuel surcharge $435.00 vs $420.00 from fuel table 'Std DOE table' for ship date 2026-10-07. Verify the table, the miles and the ship date before disputing.";
const F1_RESULT = {
  checkVersion: 'fsc-v1', status: 'finding', priceSeries: 'diesel_us', postedDate: '2026-10-05', price: '6.199', effectiveFrom: '2026-10-07', effectiveTo: '2026-10-13',
  rate: '0.84', expected: '420.00', billed: '435.00', difference: '15.00', direction: 'overcharge',
  alternative: { postedDate: '2026-09-28', price: '6.382', weeks: 1, later: false }, calculation: F1_CALC,
};
const KEYS = {
  // fix round 1 (F13 amended): paramsSha256 added to the three fsc_table.* events
  created: ['effectiveOffsetDays', 'fscTableId', 'kind', 'paramsSha256', 'priceSeries', 'unit', 'version'],
  updated: ['changedFields', 'effectiveOffsetDays', 'fscTableId', 'kind', 'paramsSha256', 'previousVersion', 'priceSeries', 'unit', 'version'],
  archived: ['fscTableId', 'paramsSha256', 'version'],
  inputsSet: ['claimId', 'fscTableId', 'miles', 'outcome', 'shipDate', 'version'],
  inputsCleared: ['claimId'],
  viewed: ['claimId', 'kind', 'status'],
};
/** T18 CI-R01 pin (also reproduced by the test-owned oracle in fuel-revisions.acc.test.ts). */
const H_T1 = '04961e79258db6b0b90d91abffe44269ed433f203dece2e8883b5b0e1939181c';
const H_T1_RATE2 = oParamsSha({ ...T1_BODY.params, ratePerStep: '0.02' });
const f1Files = (load: string, fuel = '435.00', total = '2585.00') => [A.invoiceFile(load, [['Linehaul', '2150.00'], ['Fuel surcharge', fuel]], { total }), A.rateFile(load, { linehaul: '2150.00' })];

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let gxo: Session;
let R: Record<string, { parse(v: unknown): unknown }>;
let tid = '';
let gtid = '';
let t1 = '';
const tables = (s: Session, qs = '') => s.get(`/fuel-tables${qs}`);
const createTable = (s: Session, body: unknown, o = {}) => s.post('/fuel-tables', body, o);
const updateTable = (s: Session, id: string, body: unknown, o = {}) => I.put(s, `/fuel-tables/${id}`, body, o);
const putInputs = (s: Session, claimId: string, body: unknown, o = {}) => I.put(s, `/claims/${claimId}/fuel-inputs`, body, o);
const fuelCheck = (s: Session, claimId: string) => s.get(`/claims/${claimId}/fuel-check`);
function expectCode(r: Res, status: number, code: string, label = '') {
  expect(r.status, `${label} ${r.text}`).toBe(status);
  expect(r.body?.error?.code, label).toBe(code);
  const m = MSGS[code];
  if (m) expect(r.body.error.message, label).toBe(m);
  expect(r.text, `${label}: no internals`).not.toMatch(/SQLSTATE|prisma|stack|\.ts:\d+|P0001/i);
}
async function clearFuel(tenantId: string) {
  await withAdmin(async (c) => {
    await c.query('delete from claim_fuel_inputs where tenant_id = $1', [tenantId]);
    await c.query('delete from fsc_tables where tenant_id = $1', [tenantId]);
  });
}
async function newTable(s: Session, body: Record<string, unknown>): Promise<string> {
  const r = await createTable(s, body);
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
}
const uniq = (p: string) => `${p} ${Math.random().toString(36).slice(2, 8)}`;
async function f1Claim(tag: string, fuel = '435.00', total = '2585.00') {
  const load = H.uniqLoad(tag);
  return A.makeClaim(SS.ANALYST, SS.REVIEWER, f1Files(load, fuel, total), 'SHIPPER', load);
}
function noNamesIn(evs: I.Ev[]) {
  for (const e of evs) {
    const t = JSON.stringify(e.metadata);
    for (const banned of ['Std DOE table', 'Fuel surcharge', 'Linehaul', 'Edit probe']) expect(t.includes(banned), `${e.action} metadata contains ${banned}`).toBe(false);
  }
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  R = (await import('@fr/shared')) as unknown as typeof R;
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', PRICE_CACHE_TTL_MS: '0', FLAGS_CACHE_TTL_MS: '0' });
  SS = {} as Record<RoleName, Session>;
  for (const r of ALL_ROLES) SS[r] = await sessionFor(app, ACCOUNTS[r]);
  gxo = await sessionFor(app, I.GLOBEX.OWNER);
  tid = SS.OWNER.user.tenant.id;
  gtid = gxo.user.tenant.id;
  await clearFuel(tid);
  await clearFuel(gtid);
}, 180000);
afterAll(async () => { try { await K.revokeActive(SS.OWNER); } finally { await closeApps(); reseed(); } });

describe('T9 fuel tables (F4, F10, F13)', () => {
  it('CI-A01 OWNER creates T1: 201 FscTable, defaults, list, audit fsc_table.created with the exact keys', async () => {
    const seq = await I.lastSeq(tid);
    const r = await createTable(SS.OWNER, T1_BODY);
    expect(r.status, r.text).toBe(201);
    expect(R.FscTable?.parse(r.body)).toEqual(r.body);
    expect(r.body).toMatchObject({ name: 'Std DOE table', kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, params: T1_BODY.params, version: 1, archived: false });
    t1 = r.body.id;
    const { effectiveOffsetDays: _o, ...noOffset } = T1_BODY;
    const d = await createTable(SS.ADMIN, { ...noOffset, name: 'Default offset table' });
    expect(d.status, d.text).toBe(201);
    expect(d.body.effectiveOffsetDays).toBe(2);
    const list = await tables(SS.VIEWER);
    expect(list.status, list.text).toBe(200);
    expect(R.FscTableList?.parse(list.body)).toEqual(list.body);
    expect(list.body.items.map((x: { name: string }) => x.name)).toEqual(['Default offset table', 'Std DOE table']);
    const ev = await I.eventsSince(tid, seq, 'fsc_table.');
    expect(ev.map((e) => e.action)).toEqual(['fsc_table.created', 'fsc_table.created']);
    expect(I.keysOf(ev[0]?.metadata)).toEqual(KEYS.created);
    expect(ev[0]?.metadata).toEqual({ fscTableId: t1, version: 1, kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', effectiveOffsetDays: 2, paramsSha256: H_T1 });
    expect(oParamsSha(T1_BODY.params), 'oracle reproduces the CI-R01 pin').toBe(H_T1);
    expect([ev[0]?.target_type, ev[0]?.target_id]).toEqual(['fsc_table', t1]);
    noNamesIn(ev);
  });
  it('CI-A02 PUT with expectedVersion: version 2 + audit; stale 409; identical content -> 200 without audit', async () => {
    const id = await newTable(SS.OWNER, { ...T1_BODY, name: 'Edit probe' });
    const seq = await I.lastSeq(tid);
    const body = { ...T1_BODY, name: 'Edit probe', params: { ...T1_BODY.params, ratePerStep: '0.02' }, expectedVersion: 1 };
    const u = await updateTable(SS.OWNER, id, body);
    expect(u.status, u.text).toBe(200);
    expect(u.body.version).toBe(2);
    expect(u.body.params.ratePerStep).toBe('0.02');
    const ev = await I.eventsSince(tid, seq, 'fsc_table.');
    expect(ev.map((e) => e.action)).toEqual(['fsc_table.updated']);
    expect(I.keysOf(ev[0]?.metadata)).toEqual(KEYS.updated);
    expect(ev[0]?.metadata).toMatchObject({ fscTableId: id, version: 2, previousVersion: 1, changedFields: ['params'], paramsSha256: H_T1_RATE2 });
    expectCode(await updateTable(SS.OWNER, id, body), 409, 'stale_revision');
    const seq2 = await I.lastSeq(tid);
    const same = await updateTable(SS.OWNER, id, { ...body, expectedVersion: 2 });
    expect(same.status, same.text).toBe(200);
    expect(same.body.version).toBe(2);
    expect(await I.eventsSince(tid, seq2, 'fsc_table.')).toEqual([]);
    const multi = await updateTable(SS.OWNER, id, { ...body, name: 'Edit probe 2', effectiveOffsetDays: 0, expectedVersion: 2 });
    expect(multi.status, multi.text).toBe(200);
    expect((await I.eventsSince(tid, seq2, 'fsc_table.updated'))[0]?.metadata.changedFields).toEqual(['effectiveOffsetDays', 'name']);
  });
  it('CI-A03 validation errors -> 400', async () => {
    const bad: [string, unknown][] = [
      ['mpg with unit percent', { ...T1_BODY, name: uniq('v1'), kind: 'mpg', unit: 'percent', params: { basePrice: '1.25', mpg: '6', decimals: 2 } }],
      ['rows not increasing', { ...T1_BODY, name: uniq('v2'), kind: 'rows', unit: 'percent', params: { rows: [{ atLeast: '6.00', rate: '32' }, { atLeast: '5.00', rate: '30' }] } }],
      ['201 rows', { ...T1_BODY, name: uniq('v3'), kind: 'rows', unit: 'percent', params: { rows: Array.from({ length: 201 }, (_, i) => ({ atLeast: `${1 + Math.floor(i / 100)}.${String(i % 100).padStart(2, '0')}`, rate: '1' })) } }],
      ['name with a control character', { ...T1_BODY, name: 'Bad\u0007name' }],
      ['name with a bidi character', { ...T1_BODY, name: 'Bad‮name' }],
      ['name of 81 characters', { ...T1_BODY, name: 'x'.repeat(81) }],
      ['extra key', { ...T1_BODY, name: uniq('v4'), extra: 1 }],
      ["priceSeries 'ppi_tl'", { ...T1_BODY, name: uniq('v5'), priceSeries: 'ppi_tl' }],
      ['effectiveOffsetDays 7', { ...T1_BODY, name: uniq('v6'), effectiveOffsetDays: 7 }],
      ['params not matching the kind', { ...T1_BODY, name: uniq('v7'), kind: 'mpg', params: T1_BODY.params }],
      ['per-mile rate 10', { ...T1_BODY, name: uniq('v8'), params: { ...T1_BODY.params, ratePerStep: '10' } }],
    ];
    for (const [label, body] of bad) A.expectExact(await createTable(SS.OWNER, body), 400, 'validation_error', label);
    const ok = await createTable(SS.OWNER, { ...T1_BODY, name: 'x'.repeat(80) });
    expect(ok.status, '80 characters are allowed').toBe(201);
  });
  it('CI-A04 duplicate name -> 409 conflict', async () => {
    expectCode(await createTable(SS.ADMIN, T1_BODY), 409, 'conflict');
  });
  it('CI-A05 cap of 50 (archived included); 20 concurrent POSTs at 45 never exceed 50', async () => {
    const fx = await I.fixtureTenant(app, `fuelcap${Date.now() % 100000}`, 'Fuel Cap Synthetic');
    for (let i = 0; i < 45; i++) await newTable(fx.owner, { ...T1_BODY, name: `Cap ${i}` });
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => createTable(fx.owner, { ...T1_BODY, name: `Race ${i}` })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(5);
    for (const r of rs.filter((x) => x.status !== 201)) expectCode(r, 409, 'fuel_table_limit_reached');
    const n = await withAdmin(async (c) => (await c.query('select count(*)::int n from fsc_tables where tenant_id = $1', [fx.id])).rows[0].n as number);
    expect(n).toBe(50);
    const anyId = (await tables(fx.owner)).body.items[0].id as string;
    expect((await fx.owner.destroy(`/fuel-tables/${anyId}`)).status).toBe(204);
    expectCode(await createTable(fx.owner, { ...T1_BODY, name: 'Cap 51' }), 409, 'fuel_table_limit_reached', 'archived tables count');
  }, 180000);
  it('CI-A06 DELETE archives (204, idempotent, one audit event); PUT on archived 409 invalid_state; hidden without includeArchived', async () => {
    const id = await newTable(SS.OWNER, { ...T1_BODY, name: 'Archive probe' });
    const seq = await I.lastSeq(tid);
    expect((await SS.OWNER.destroy(`/fuel-tables/${id}`)).status).toBe(204);
    expect((await SS.OWNER.destroy(`/fuel-tables/${id}`)).status).toBe(204);
    const ev = await I.eventsSince(tid, seq, 'fsc_table.');
    expect(ev.map((e) => e.action)).toEqual(['fsc_table.archived']);
    expect(ev[0]?.metadata).toEqual({ fscTableId: id, version: 1, paramsSha256: H_T1 });
    expectCode(await updateTable(SS.OWNER, id, { ...T1_BODY, name: 'Archive probe', expectedVersion: 1 }), 409, 'invalid_state');
    expect((await tables(SS.VIEWER)).body.items.some((x: { id: string }) => x.id === id)).toBe(false);
    const all = await tables(SS.VIEWER, '?includeArchived=true');
    expect(all.body.items.find((x: { id: string }) => x.id === id)?.archived).toBe(true);
  });
  it('CI-A07 roles: MANAGER/REVIEWER/ANALYST/VIEWER read only; platform roles and API keys 403', async () => {
    for (const role of ['MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as const) {
      const s = SS[role];
      expect((await tables(s)).status, role).toBe(200);
      expectError(await createTable(s, { ...T1_BODY, name: uniq('r') }), 403, 'forbidden');
      expectError(await updateTable(s, t1, { ...T1_BODY, expectedVersion: 1 }), 403, 'forbidden');
      expectError(await s.destroy(`/fuel-tables/${t1}`), 403, 'forbidden');
    }
    for (const role of ['PLATFORM_DEV', 'SUPER_ADMIN'] as const) {
      expectError(await tables(SS[role]), 403, 'forbidden');
      expectError(await createTable(SS[role], { ...T1_BODY, name: uniq('p') }), 403, 'forbidden');
    }
    for (const scopes of [['claims.read'], [...K.SCOPES]]) {
      const k = await K.mkKey(SS.OWNER, scopes);
      expectError(await K.keyReq(app, k.secret, 'GET', '/fuel-tables'), 403, 'forbidden');
      expectError(await K.keyReq(app, k.secret, 'GET', '/outlook'), 403, 'forbidden');
    }
  });
});

describe('T10 fuel inputs, fuel-check view and analysis (F5, F6, F10, F13)', () => {
  let c1: A.Made;
  beforeAll(async () => { c1 = await f1Claim('FU1'); }, 180000);
  it('CI-A10 PUT fuel-inputs: created (miles 500.0, v1, audit) -> unchanged (no audit) -> changed (v2)', async () => {
    const seq = await I.lastSeq(tid);
    const r = await putInputs(SS.ANALYST, c1.claimId, { shipDate: '2026-10-07', miles: '500', fscTableId: t1 });
    expect(r.status, r.text).toBe(200);
    expect(R.SetFuelInputsResponse?.parse(r.body)).toEqual(r.body);
    expect(r.body.outcome).toBe('created');
    expect(r.body.inputs).toMatchObject({ claimId: c1.claimId, shipDate: '2026-10-07', miles: '500.0', fscTableId: t1, version: 1 });
    let ev = await I.eventsSince(tid, seq, 'claim.fuel_inputs');
    expect(ev.map((e) => e.action)).toEqual(['claim.fuel_inputs_set']);
    expect(I.keysOf(ev[0]?.metadata)).toEqual(KEYS.inputsSet);
    expect(ev[0]?.metadata).toEqual({ claimId: c1.claimId, fscTableId: t1, shipDate: '2026-10-07', miles: '500.0', outcome: 'created', version: 1 });
    const seq2 = await I.lastSeq(tid);
    const same = await putInputs(SS.ANALYST, c1.claimId, { shipDate: '2026-10-07', miles: '500.0', fscTableId: t1 });
    expect([same.status, same.body.outcome, same.body.inputs.version]).toEqual([200, 'unchanged', 1]);
    expect(await I.eventsSince(tid, seq2, 'claim.fuel_inputs')).toEqual([]);
    const ch = await putInputs(SS.ANALYST, c1.claimId, { shipDate: '2026-10-07', miles: '501.5', fscTableId: t1 });
    expect([ch.status, ch.body.outcome, ch.body.inputs.version, ch.body.inputs.miles]).toEqual([200, 'changed', 2, '501.5']);
    const back = await putInputs(SS.ANALYST, c1.claimId, { shipDate: '2026-10-07', miles: '500.0', fscTableId: t1 });
    expect([back.body.outcome, back.body.inputs.version]).toEqual(['changed', 3]);
    ev = await I.eventsSince(tid, seq2, 'claim.fuel_inputs');
    expect(ev.map((e) => e.metadata.outcome)).toEqual(['changed', 'changed']);
  });
  it('CI-A11 error cases', async () => {
    const archived = await newTable(SS.OWNER, { ...T1_BODY, name: 'Archived for inputs' });
    expect((await SS.OWNER.destroy(`/fuel-tables/${archived}`)).status).toBe(204);
    const other = await newTable(gxo, { ...T1_BODY, name: 'Globex table' });
    const body = { shipDate: '2026-10-07', miles: '500', fscTableId: t1 };
    expectCode(await putInputs(SS.ANALYST, c1.claimId, { ...body, fscTableId: archived }), 422, 'fuel_table_unavailable');
    expectCode(await putInputs(SS.ANALYST, c1.claimId, { ...body, fscTableId: other }), 422, 'fuel_table_unavailable');
    expectCode(await putInputs(SS.ANALYST, c1.claimId, { ...body, miles: null }), 422, 'miles_required');
    const gClaim = (await withAdmin(async (c) => (await c.query('select id from claims where tenant_id = $1 limit 1', [gtid])).rows[0]?.id)) as string | undefined;
    const unknown = await putInputs(SS.ANALYST, I.RAND_UUID, body);
    expectCode(unknown, 404, 'not_found');
    if (gClaim) I.expectIdentical404(unknown, await putInputs(SS.ANALYST, gClaim, body));
    expectCode(await putInputs(SS.ANALYST, 'not-a-uuid', body), 404, 'not_found');
    for (const [label, b] of [['2026-02-30', { ...body, shipDate: '2026-02-30' }], ['extra key', { ...body, extra: 1 }], ['miles 0', { ...body, miles: '0' }], ['miles 10000.1', { ...body, miles: '10000.1' }], ['miles 2 decimals', { ...body, miles: '500.25' }]] as const) A.expectExact(await putInputs(SS.ANALYST, c1.claimId, b), 400, 'validation_error', label);
    const pending = await f1Claim('FU-PEND');
    expect((await putInputs(SS.ANALYST, pending.claimId, body)).status).toBe(200);
    expect((await A.analyze(SS.ANALYST, pending.claimId)).status).toBe(201);
    expectCode(await putInputs(SS.ANALYST, pending.claimId, body), 409, 'invalid_state');
    expectCode(await SS.ANALYST.destroy(`/claims/${pending.claimId}/fuel-inputs`), 409, 'invalid_state');
    expect((await fuelCheck(SS.VIEWER, pending.claimId)).status, 'inputs readable in every status').toBe(200);
  }, 180000);
  it('CI-A12 GET fuel-check: FuelCheckView with the CI-F01 result and provenance; audit intelligence.viewed', async () => {
    const seq = await I.lastSeq(tid);
    const r = await fuelCheck(SS.VIEWER, c1.claimId);
    expect(r.status, r.text).toBe(200);
    expect(R.FuelCheckView?.parse(r.body)).toEqual(r.body);
    expect(r.body.claimId).toBe(c1.claimId);
    expect(r.body.inputs).toMatchObject({ shipDate: '2026-10-07', miles: '500.0', fscTableId: t1 });
    expect(r.body.table).toMatchObject({ id: t1, name: 'Std DOE table', version: 1 });
    const { priceImport, ...rest } = r.body.result;
    expect(rest).toEqual(F1_RESULT);
    expect(A.UUID_RE.test(priceImport.id)).toBe(true);
    expect([priceImport.sha256, priceImport.retrievedAt, priceImport.sourceUrl]).toEqual([SHA_DIESEL, '2026-10-11', URL_DIESEL]);
    const ev = await I.eventsSince(tid, seq, 'intelligence.viewed');
    expect(ev).toHaveLength(1);
    expect(I.keysOf(ev[0]?.metadata)).toEqual(KEYS.viewed);
    expect(ev[0]?.metadata).toEqual({ kind: 'fuel_check', claimId: c1.claimId, status: 'finding' });
  });
  it('CI-A13 analyze: FSC review finding stored with the fuel-line citation, pending 1500, letter silent, claim.analyzed fuel metadata', async () => {
    const seq = await I.lastSeq(tid);
    const r = await A.analyze(SS.ANALYST, c1.claimId);
    expect(r.status, r.text).toBe(201);
    expect(r.body.analysis).toMatchObject({ fuelCheckStatus: 'finding', fuelFindingsCount: 1, findingsCount: 1, pendingFindingsCount: 1 });
    expect([r.body.claim.recoverableCents, r.body.claim.pendingReviewCents]).toEqual([0, 1500]);
    const p = (await SS.VIEWER.get(`/claims/${c1.claimId}/packet`)).body;
    const f = p.findings.find((x: { ruleId: string }) => x.ruleId === 'FSC-INDEX-MISMATCH');
    expect(f).toMatchObject({ title: 'Fuel surcharge differs from the fuel table (review)', direction: 'OVERCHARGE', amountCents: 1500, explanation: F1_EXPL, calculation: F1_CALC, confidence: 0.7, needsHumanReview: true, governingClause: null });
    const inv = c1.docs.find((d: { docType: string }) => d.docType === 'INVOICE');
    const src = p.sources.find((s: { docType: string }) => s.docType === 'INVOICE').id as string;
    expect(f.citations).toEqual([await A.lineCitation(SS.VIEWER, c1, inv, 'Fuel surcharge', src)]);
    expect(p.demandLetter).not.toContain('Fuel surcharge differs');
    const ev = (await I.eventsSince(tid, seq, 'claim.analyzed')).filter((e) => e.target_id === c1.claimId);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.metadata).toMatchObject({ fuelCheckStatus: 'finding', fscTableId: t1, fscTableVersion: 1, priceDate: '2026-10-05', fuelFindingsCount: 1, paramsSha256: H_T1 });
    expect(ev[0]?.metadata.priceImportId, 'F13 (amended): always null in step 7').toBeNull();
    expect(I.keysOf(ev[0]?.metadata)).toEqual([...A.P7_ANALYZED_KEYS].sort());
    noNamesIn(ev);
  });
  it('CI-A14 parity-unchanged: a twin claim without inputs equals the flag-off result (no_inputs vs off)', async () => {
    const proj = async (made: A.Made) => {
      const p = (await SS.VIEWER.get(`/claims/${made.claimId}/packet`)).body;
      return {
        findings: p.findings.map((x: Record<string, unknown>) => [x.ruleId, x.amountCents, x.explanation, x.calculation, x.needsHumanReview, x.confidence]),
        totals: [p.recoverableCents, p.pendingReviewCents], letter: String(p.demandLetter).split(made.load).join('<LOAD>'),
      };
    };
    const twin = await f1Claim('FU-TWIN');
    const seq = await I.lastSeq(tid);
    const a = await A.analyze(SS.ANALYST, twin.claimId);
    expect(a.body.analysis).toMatchObject({ fuelCheckStatus: 'no_inputs', fuelFindingsCount: 0 });
    const dev = I.onApp(app, SS.PLATFORM_DEV);
    const off = await f1Claim('FU-OFF');
    expect((await putInputs(SS.ANALYST, off.claimId, { shipDate: '2026-10-07', miles: '500', fscTableId: t1 })).status).toBe(200);
    await I.setFlag(dev, 'intelligence.fuel_check', false, 'acceptance fuel flag off (parity)');
    try {
      const b = await A.analyze(SS.ANALYST, off.claimId);
      expect(b.body.analysis).toMatchObject({ fuelCheckStatus: 'off', fuelFindingsCount: 0 });
      expect(await proj(off)).toEqual(await proj(twin));
      // T18 CI-R02: paramsSha256 is null without inputs and with the flag off
      const evs = await I.eventsSince(tid, seq, 'claim.analyzed');
      for (const id of [twin.claimId, off.claimId]) expect(evs.find((e) => e.target_id === id)?.metadata.paramsSha256, id).toBeNull();
    } finally {
      await I.setFlag(dev, 'intelligence.fuel_check', true, 'acceptance fuel flag on');
    }
  }, 180000);
  it('CI-A15 bulk analyze over two claims with inputs: one FSC finding each (price-read counter: not exposed, skipped)', async () => {
    const a = await f1Claim('FU-B1');
    const b = await f1Claim('FU-B2');
    for (const c of [a, b]) expect((await putInputs(SS.ANALYST, c.claimId, { shipDate: '2026-10-07', miles: '500', fscTableId: t1 })).status).toBe(200);
    const r = await A.bulk(SS.MANAGER, { limit: 100 });
    expect(r.status, r.text).toBe(200);
    for (const c of [a, b]) {
      const p = (await SS.VIEWER.get(`/claims/${c.claimId}/packet`)).body;
      expect(p.findings.filter((x: { ruleId: string }) => x.ruleId === 'FSC-INDEX-MISMATCH'), c.claimNumber).toHaveLength(1);
    }
  }, 180000);
  it('CI-A16 the current table version is used; an archived table gives table_archived and no finding', async () => {
    const tv = await newTable(SS.OWNER, { ...T1_BODY, name: 'Versioned table' });
    const c = await f1Claim('FU-V2');
    expect((await putInputs(SS.ANALYST, c.claimId, { shipDate: '2026-10-07', miles: '500', fscTableId: tv })).status).toBe(200);
    expect((await updateTable(SS.OWNER, tv, { ...T1_BODY, name: 'Versioned table', params: { ...T1_BODY.params, ratePerStep: '0.02' }, expectedVersion: 1 })).status).toBe(200);
    const seq = await I.lastSeq(tid);
    const r = await A.analyze(SS.ANALYST, c.claimId);
    expect(r.status, r.text).toBe(201);
    const ev = (await I.eventsSince(tid, seq, 'claim.analyzed')).filter((e) => e.target_id === c.claimId);
    expect(ev[0]?.metadata).toMatchObject({ fscTableId: tv, fscTableVersion: 2, fuelCheckStatus: 'finding', paramsSha256: H_T1_RATE2 });
    const ta = await newTable(SS.OWNER, { ...T1_BODY, name: 'Archived later' });
    const c2 = await f1Claim('FU-ARCH');
    expect((await putInputs(SS.ANALYST, c2.claimId, { shipDate: '2026-10-07', miles: '500', fscTableId: ta })).status).toBe(200);
    expect((await SS.OWNER.destroy(`/fuel-tables/${ta}`)).status).toBe(204);
    const r2 = await A.analyze(SS.ANALYST, c2.claimId);
    expect(r2.body.analysis).toMatchObject({ fuelCheckStatus: 'table_archived', fuelFindingsCount: 0 });
    expect((await SS.VIEWER.get(`/claims/${c2.claimId}/packet`)).body.findings.some((x: { ruleId: string }) => x.ruleId === 'FSC-INDEX-MISMATCH')).toBe(false);
  }, 180000);
  it('CI-A17 roles for inputs and the view; DELETE clears (204, idempotent, one audit event)', async () => {
    const c = await f1Claim('FU-ROLE');
    const body = { shipDate: '2026-10-07', miles: '500', fscTableId: t1 };
    expect((await putInputs(SS.ANALYST, c.claimId, body)).status).toBe(200);
    expectError(await putInputs(SS.VIEWER, c.claimId, body), 403, 'forbidden');
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as const) expect((await fuelCheck(SS[role], c.claimId)).status, role).toBe(200);
    for (const role of ['PLATFORM_DEV', 'SUPER_ADMIN'] as const) {
      expectError(await fuelCheck(SS[role], c.claimId), 403, 'forbidden');
      expectError(await putInputs(SS[role], c.claimId, body), 403, 'forbidden');
    }
    const k = await K.mkKey(SS.OWNER, [...K.SCOPES]);
    expectError(await K.keyReq(app, k.secret, 'GET', `/claims/${c.claimId}/fuel-check`), 403, 'forbidden');
    const seq = await I.lastSeq(tid);
    expect((await SS.ANALYST.destroy(`/claims/${c.claimId}/fuel-inputs`)).status).toBe(204);
    expect((await SS.ANALYST.destroy(`/claims/${c.claimId}/fuel-inputs`)).status).toBe(204);
    const ev = await I.eventsSince(tid, seq, 'claim.fuel_inputs');
    expect(ev.map((e) => e.action)).toEqual(['claim.fuel_inputs_cleared']);
    expect(ev[0]?.metadata).toEqual({ claimId: c.claimId });
    expect((await fuelCheck(SS.VIEWER, c.claimId)).body).toMatchObject({ inputs: null, table: null, result: { status: 'no_inputs' } });
  }, 180000);
});

describe('T11/T13 precedence, rate limit and the fuel_check flag (F11, F14, F16)', () => {
  it('precedence: CSRF/origin 403 -> 401 -> 403 -> 400 -> 404 (flag off)', async () => {
    for (const s of [SS.OWNER, SS.VIEWER]) {
      expectError(await createTable(s, T1_BODY, { csrf: false }), 403, 'csrf_failed');
      expectError(await createTable(s, T1_BODY, { headers: { origin: H.ORIGIN_BAD } }), 403, 'origin_not_allowed');
    }
    const anon = new Client(app);
    expectError(await anon.send('GET', '/fuel-tables'), 401);
    expectError(await anon.send('GET', `/claims/${I.RAND_UUID}/fuel-check`), 401);
    expectError(await createTable(SS.VIEWER, { bogus: true }), 403, 'forbidden');
  });
  it('CI-X02 fuel_check off: fuel routes 404 after 401/403/400; analysis is step 6 (off); outlook ?fscTableId 404', async () => {
    const dev = I.onApp(app, SS.PLATFORM_DEV);
    const c = await f1Claim('FU-XOFF');
    await I.setFlag(dev, 'intelligence.fuel_check', false, 'acceptance fuel flag off');
    try {
      A.expectExact(await createTable(SS.OWNER, { bogus: true }), 400, 'validation_error');
      expectError(await createTable(SS.VIEWER, T1_BODY), 403, 'forbidden');
      for (const r of [await tables(SS.VIEWER), await createTable(SS.OWNER, { ...T1_BODY, name: uniq('off') }), await updateTable(SS.OWNER, t1, { ...T1_BODY, expectedVersion: 1 }), await SS.OWNER.destroy(`/fuel-tables/${t1}`),
        await fuelCheck(SS.VIEWER, c.claimId), await putInputs(SS.ANALYST, c.claimId, { shipDate: '2026-10-07', miles: '500', fscTableId: t1 }), await SS.ANALYST.destroy(`/claims/${c.claimId}/fuel-inputs`),
        await SS.VIEWER.get(`/outlook?fscTableId=${t1}`)]) A.expectExact(r, 404, 'not_found');
      const a = await A.analyze(SS.ANALYST, c.claimId);
      expect(a.body.analysis).toMatchObject({ fuelCheckStatus: 'off', fuelFindingsCount: 0 });
      expect((await SS.VIEWER.get('/outlook')).status, 'outlook itself is unaffected').toBe(200);
    } finally {
      await I.setFlag(dev, 'intelligence.fuel_check', true, 'acceptance fuel flag on');
    }
  }, 180000);
  it('F16 intelligence bucket: the 4th fuel request -> 429 before permission and validation', async () => {
    const rl = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_INTELLIGENCE_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000', PRICE_CACHE_TTL_MS: '0' });
    const v = I.onApp(rl, SS.VIEWER, '10.9.7.1');
    expect((await v.get('/fuel-tables')).status).toBe(200);
    expect((await v.get('/outlook')).status).toBe(200);
    expect((await v.get('/fuel-tables')).status).toBe(200);
    const r = await createTable(v, { bogus: true });
    expectError(r, 429, 'rate_limited');
    expect(r.headers['retry-after']).toBeTruthy();
  }, 60000);
});

describe('T18 CI-R07 API keys (F12)', () => {
  it('a tenant API key with every scope gets 403 forbidden on all 8 step-7 routes (valid bodies); only apikey.use_denied may be written', async () => {
    const c = await f1Claim('FU-KEY');
    const k = await K.mkKey(SS.OWNER, [...K.SCOPES]);
    const seq = await I.lastSeq(tid);
    const routes: [string, string, unknown][] = [
      ['GET', '/fuel-tables', undefined], ['POST', '/fuel-tables', { ...T1_BODY, name: 'Key probe' }],
      ['PUT', `/fuel-tables/${t1}`, { ...T1_BODY, expectedVersion: 1 }], ['DELETE', `/fuel-tables/${t1}`, undefined],
      ['GET', `/claims/${c.claimId}/fuel-check`, undefined], ['PUT', `/claims/${c.claimId}/fuel-inputs`, { shipDate: '2026-10-07', miles: '500', fscTableId: t1 }],
      ['DELETE', `/claims/${c.claimId}/fuel-inputs`, undefined], ['GET', '/outlook', undefined],
    ];
    for (const [m, p, body] of routes) expectError(await K.keyReq(app, k.secret, m, p, body === undefined ? {} : { body }), 403, 'forbidden');
    expect((await I.eventsSince(tid, seq)).map((e) => e.action).filter((a) => a !== 'apikey.use_denied')).toEqual([]);
    expect((await tables(SS.VIEWER)).body.items.some((x: { name: string }) => x.name === 'Key probe')).toBe(false);
  });
});

describe('T15 audit chain (F13)', () => {
  it('CI-U01 tenant chain verifies; CI-U02 refusals and outlook reads wrote nothing', async () => {
    const seq = await I.lastSeq(tid);
    expectCode(await createTable(SS.ADMIN, T1_BODY), 409, 'conflict');
    expect((await SS.VIEWER.get('/outlook')).status).toBe(200);
    A.expectExact(await createTable(SS.OWNER, { bogus: true }), 400, 'validation_error');
    expect(await I.eventsSince(tid, seq)).toEqual([]);
    const v = await SS.OWNER.get('/audit/verify');
    expect(v.body.valid, v.text).toBe(true);
    noNamesIn(await I.eventsSince(tid, 0, 'fsc_table.'));
    noNamesIn(await I.eventsSince(tid, 0, 'claim.fuel_inputs'));
  });
});
