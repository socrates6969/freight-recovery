/* eslint-disable */
// REQ-20261011-charge-intelligence Tier H (written now; run after the owner's go-ahead): T7 charge lines (CI-A01..A04),
// T8 label memory (CI-A05..A12), T11 RBAC / API keys / precedence / rate limit (CI-R01..R05), T12 cross-tenant
// (CI-X01), T13 audit (CI-U01 label + view events, CI-U02). Part C C5-C9, C14. Black-box: HTTP, audit rows over SQL,
// owner SQL only to reach the 2,000-label limit. Expected suggestions come from the test-owned C3 oracle.
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, ALL_ROLES, Client, type RoleName, type Session, buildTestApp, closeApps, expectError, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { oExamples, oSuggest } from './helpers/charge-oracle.js';
import { withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

/** C9 (fix round 1): lower-case hex sha256 of the UTF-8 normalized text. */
const sha = (norm: string) => createHash('sha256').update(norm, 'utf8').digest('hex');
const PJR_SHA = '90390b8eef4ab864e8dd66f589172060e75ebb2a2a11c44c601ef27f36158c77';
const LIMIT_MSG = 'This organization has reached the maximum number of charge labels.';
const B1_LINES: [string, string][] = [['Linehaul', '1500.00'], ['Fuel surcharge', '300.00'], ['Sort and segregate', '85.00'], ['Lumper fee', '150.00'], ['Scale ticket', '12.00'], ['Appointment fee', '40.00']];
export const k1Files = (load: string, lines: [string, string][] = B1_LINES, total: string | undefined = '2087.00') => [
  A.invoiceFile(load, lines, total === undefined ? {} : { total }),
  A.rateFile(load, { linehaul: '1500.00', fuel: '300.00', acc: 'Appointment' }),
];

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let gx: Session; // Globex MANAGER (has charge_labels:manage in its own tenant)
let gxv: Session;
let k1: A.Made;
let C: any;
let R: any;
let tid = '';
let seq0 = 0;
const putLabel = (s: Session, body: unknown, o: any = {}) => I.put(s, '/charge-labels', body, o);
const lines = (s: Session, id: string) => s.get(`/claims/${id}/charge-lines`);
const oracleFor = async (labels: any[] = []) => {
  const ex = oExamples(C.SEED_V2, labels);
  return (q: string) => oSuggest(ex, q, C.SEED_V2_SOURCES);
};
async function clearLabels(tenantId: string) {
  await withAdmin(async (c) => { await c.query('delete from charge_labels where tenant_id = $1', [tenantId]); });
}
async function labelRows(tenantId: string) {
  return withAdmin(async (c) => (await c.query('select id, normalized_text, description, category, version from charge_labels where tenant_id = $1 order by normalized_text', [tenantId])).rows);
}

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  C = await import('@fr/shared/charge-intel');
  R = await import('@fr/shared');
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  SS = {} as Record<RoleName, Session>;
  for (const r of ALL_ROLES) SS[r] = await sessionFor(app, ACCOUNTS[r]);
  gx = await sessionFor(app, I.GLOBEX.MANAGER);
  gxv = await sessionFor(app, I.GLOBEX.VIEWER);
  tid = SS.OWNER.user.tenant.id;
  const load = H.uniqLoad('K1');
  k1 = await A.makeClaim(SS.ANALYST, SS.REVIEWER, k1Files(load), 'SHIPPER', load);
  seq0 = await I.lastSeq(tid);
}, 180000);
afterAll(async () => { try { await K.revokeActive(SS.OWNER); } finally { await closeApps(); reseed(); } });

describe('T7 charge lines (C5, C6)', () => {
  it('CI-A01 VIEWER gets the strict ChargeLinesResponse with oracle suggestions (AWAITING_ANALYSIS)', async () => {
    await clearLabels(tid);
    const seq = await I.lastSeq(tid);
    const r = await lines(SS.VIEWER, k1.claimId);
    expect(r.status, r.text).toBe(200);
    expect(R.ChargeLinesResponse.parse(r.body)).toEqual(r.body);
    // REQ-20261012-hardening C3 (additive): required `influence`, null for a claim without a claim.analyzed event (HD-C01).
    expect(Object.keys(r.body).sort()).toEqual(['claimId', 'classifierVersion', 'influence', 'lines', 'seedVersion', 'threshold']);
    expect(r.body.influence).toBeNull();
    expect([r.body.claimId, r.body.classifierVersion, r.body.seedVersion, r.body.threshold]).toEqual([k1.claimId, 'charge-knn-v1', 'tariff-seed-v2', 0.3]);
    const o = await oracleFor();
    expect(r.body.lines.map((l: any) => [l.index, l.description, l.amount, l.ruleCategory, l.label])).toEqual([
      [0, 'Linehaul', '1500.00', 'linehaul', null], [1, 'Fuel surcharge', '300.00', 'fuel', null], [2, 'Sort and segregate', '85.00', 'other', null],
      [3, 'Lumper fee', '150.00', 'accessorial', null], [4, 'Scale ticket', '12.00', 'other', null], [5, 'Appointment fee', '40.00', 'other', null],
    ]);
    for (const l of r.body.lines) expect(l.suggestion, l.description).toEqual(o(l.description));
    const by = (d: string) => r.body.lines.find((l: any) => l.description === d).suggestion;
    expect(by('Linehaul').abstained).toBe(true);
    expect([by('Sort and segregate').category, by('Sort and segregate').similarity]).toEqual(['accessorial', 0.836]);
    expect([by('Appointment fee').category, by('Appointment fee').similarity]).toEqual(['accessorial', 0.825]);
    expect(by('Scale ticket').abstained).toBe(true);
    // CI-A04: one intelligence.viewed per 200
    const ev = await I.eventsSince(tid, seq);
    expect(ev.map((e) => e.action)).toEqual(['intelligence.viewed']);
    expect(ev[0]!.metadata).toEqual({ kind: 'charge_lines', claimId: k1.claimId, returned: 6 });
    expect([ev[0]!.target_type, ev[0]!.target_id]).toEqual(['claim', k1.claimId]);
  });
  it('CI-A02 a claim with no accepted invoice -> lines []', async () => {
    const load = H.uniqLoad('K2');
    const made = await A.makeClaim(SS.ANALYST, SS.REVIEWER, [A.rateFile(load, { linehaul: '1500.00' })], 'SHIPPER', load);
    const r = await lines(SS.VIEWER, made.claimId);
    expect(r.status, r.text).toBe(200);
    expect(r.body.lines).toEqual([]);
  });
  it('CI-A03 unknown, non-UUID and other-tenant claim -> identical 404', async () => {
    const unknown = await lines(SS.VIEWER, I.RAND_UUID);
    A.expectExact(unknown, 404, 'not_found', 'unknown');
    for (const r of [await lines(SS.VIEWER, 'not-a-uuid'), await lines(gx, k1.claimId), await lines(gxv, k1.claimId)]) I.expectIdentical404(r, unknown);
  });
  it('CI-A01 after analysis the view is still available', async () => {
    const load = H.uniqLoad('K3');
    const made = await A.makeClaim(SS.ANALYST, SS.REVIEWER, k1Files(load), 'SHIPPER', load);
    expect((await A.analyze(SS.ANALYST, made.claimId)).status).toBe(201);
    const r = await lines(SS.VIEWER, made.claimId);
    expect(r.status, r.text).toBe(200);
    expect(r.body.lines).toHaveLength(6);
  });
});

describe('T8 label memory (C5, C6, C9)', () => {
  let pjr = '';
  it('CI-A05 PUT trims and creates (REVIEWER)', async () => {
    await clearLabels(tid);
    const seq = await I.lastSeq(tid);
    const r = await putLabel(SS.REVIEWER, { description: '  Pallet jack rental ', category: 'accessorial' });
    expect(r.status, r.text).toBe(200);
    expect(R.SetChargeLabelResponse.parse(r.body)).toEqual(r.body);
    expect(r.body.outcome).toBe('created');
    expect(r.body.label).toMatchObject({ description: 'Pallet jack rental', normalizedText: 'pallet jack rental', category: 'accessorial', version: 1 });
    expect(r.body.label.id).toMatch(A.UUID_RE);
    expect(Object.keys(r.body.label).sort()).toEqual(['category', 'createdAt', 'description', 'id', 'normalizedText', 'updatedAt', 'version']);
    pjr = r.body.label.id;
    const ev = await I.eventsSince(tid, seq);
    expect(ev.map((e) => e.action)).toEqual(['charge_label.set']);
    expect(ev[0]!.metadata).toEqual({ labelId: pjr, category: 'accessorial', outcome: 'created', normalizedTextSha256: PJR_SHA });
    expect(sha('pallet jack rental'), 'CI-U05 pinned value').toBe(PJR_SHA);
    expect([ev[0]!.target_type, ev[0]!.target_id, ev[0]!.actor_id]).toEqual(['charge_label', pjr, SS.REVIEWER.user.id]);
  });
  it('CI-A06 same normalized text: unchanged (no event), then changed (version 2, event)', async () => {
    const seq = await I.lastSeq(tid);
    const u = await putLabel(SS.REVIEWER, { description: 'PALLET JACK RENTAL!!', category: 'accessorial' });
    expect(u.status, u.text).toBe(200);
    expect([u.body.outcome, u.body.label.id, u.body.label.version, u.body.label.description]).toEqual(['unchanged', pjr, 1, 'Pallet jack rental']);
    expect(await I.eventsSince(tid, seq), 'unchanged writes no event').toEqual([]);
    const c = await putLabel(SS.MANAGER, { description: 'PALLET JACK RENTAL!!', category: 'other' });
    expect(c.status, c.text).toBe(200);
    expect([c.body.outcome, c.body.label.id, c.body.label.version, c.body.label.description, c.body.label.category, c.body.label.normalizedText]).toEqual(['changed', pjr, 2, 'PALLET JACK RENTAL!!', 'other', 'pallet jack rental']);
    const ev = await I.eventsSince(tid, seq);
    expect(ev.map((e) => e.action)).toEqual(['charge_label.set']);
    expect(ev[0]!.metadata).toEqual({ labelId: pjr, category: 'other', previousCategory: 'accessorial', outcome: 'changed', normalizedTextSha256: PJR_SHA });
    // restore for CI-A12
    expect((await putLabel(SS.REVIEWER, { description: 'Pallet jack rental', category: 'accessorial' })).body.outcome).toBe('changed');
  });
  it('CI-A07 list ordering and pagination; pageSize 101 -> 400', async () => {
    await clearLabels(tid);
    for (let i = 0; i < 30; i++) expect((await putLabel(SS.REVIEWER, { description: `Probe label ${String(29 - i).padStart(2, '0')}`, category: 'accessorial' })).status).toBe(200);
    const seq = await I.lastSeq(tid);
    const p1 = await SS.VIEWER.get('/charge-labels');
    expect(p1.status, p1.text).toBe(200);
    expect(R.ChargeLabelsList.parse(p1.body)).toEqual(p1.body);
    expect([p1.body.page, p1.body.pageSize, p1.body.total, p1.body.items.length]).toEqual([1, 25, 30, 25]);
    const p2 = await SS.VIEWER.get('/charge-labels?page=2&pageSize=25');
    expect([p2.body.page, p2.body.items.length]).toEqual([2, 5]);
    const all = [...p1.body.items, ...p2.body.items].map((x: any) => x.normalizedText);
    expect(all).toEqual(Array.from({ length: 30 }, (_, i) => `probe label ${String(i).padStart(2, '0')}`));
    expect((await SS.VIEWER.get('/charge-labels?pageSize=100')).body.items).toHaveLength(30);
    A.expectExact(await SS.VIEWER.get('/charge-labels?pageSize=101'), 400, 'validation_error');
    A.expectExact(await SS.VIEWER.get('/charge-labels?page=0'), 400, 'validation_error');
    A.expectExact(await SS.VIEWER.get('/charge-labels?bogus=1'), 400, 'validation_error');
    expect(await I.eventsSince(tid, seq), 'the label list writes no event').toEqual([]);
  });
  it('CI-A08 validation 400', async () => {
    const seq = await I.lastSeq(tid);
    const before = await labelRows(tid);
    const bad: unknown[] = [{}, { description: 'x' }, { category: 'other' }, { description: 'x', category: 'other', extra: 1 }, { description: 'x', category: 'Other' }, { description: 'x', category: 'unknown' },
      { description: '', category: 'other' }, { description: '   ', category: 'other' }, { description: '---', category: 'other' }, { description: 'a'.repeat(201), category: 'other' },
      { description: 'a\u0000b', category: 'other' }, { description: 'a‮b', category: 'other' }, { description: 'a\nb', category: 'other' }, [], 'x', null];
    for (const b of bad) A.expectExact(await putLabel(SS.REVIEWER, b), 400, 'validation_error', JSON.stringify(b));
    expect(await labelRows(tid)).toEqual(before);
    expect(await I.eventsSince(tid, seq)).toEqual([]);
  });
  it('CI-A09 DELETE 204 empty; second delete, unknown and non-UUID -> 404; gone from list and suggestions', async () => {
    await clearLabels(tid);
    const c = await putLabel(SS.REVIEWER, { description: 'Sort and segregate', category: 'other' });
    const id = c.body.label.id;
    expect((await lines(SS.VIEWER, k1.claimId)).body.lines[2].suggestion.nearest.origin).toBe('tenant');
    const seq = await I.lastSeq(tid);
    const d = await SS.REVIEWER.destroy(`/charge-labels/${id}`);
    expect(d.status, d.text).toBe(204);
    expect(d.text).toBe('');
    const ev = await I.eventsSince(tid, seq);
    expect(ev.map((e) => e.action)).toEqual(['charge_label.deleted']);
    expect(ev[0]!.metadata).toEqual({ labelId: id, category: 'other', normalizedTextSha256: sha('sort and segregate') });
    expect(ev[0]!.metadata.normalizedTextSha256).toMatch(/^[0-9a-f]{64}$/);
    const again = await SS.REVIEWER.destroy(`/charge-labels/${id}`);
    A.expectExact(again, 404, 'not_found');
    I.expectIdentical404(await SS.REVIEWER.destroy(`/charge-labels/${I.RAND_UUID}`), again);
    I.expectIdentical404(await SS.REVIEWER.destroy('/charge-labels/not-a-uuid'), again);
    expect((await SS.VIEWER.get('/charge-labels')).body.total).toBe(0);
    const l = (await lines(SS.VIEWER, k1.claimId)).body.lines[2];
    expect([l.label, l.suggestion.category, l.suggestion.nearest.origin]).toEqual([null, 'accessorial', 'seed']);
  });
  it('CI-A10 limit 2,000: new text -> 409 (nothing written); update allowed; after one DELETE a new PUT works', async () => {
    await clearLabels(tid);
    const owner = SS.OWNER.user.id;
    await withAdmin(async (c) => {
      await c.query(`insert into charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, created_at, updated_by_id, updated_at, version)
        select gen_random_uuid(), $1, 'limit probe ' || g, 'Limit probe ' || g, 'accessorial', $2, now(), $2, now(), 1 from generate_series(1, 2000) g`, [tid, owner]);
    });
    const seq = await I.lastSeq(tid);
    const r = await putLabel(SS.REVIEWER, { description: 'One more label', category: 'other' });
    expect(r.status, r.text).toBe(409);
    expect(Object.keys(r.body.error).sort()).toEqual(['code', 'message', 'requestId']);
    expect([r.body.error.code, r.body.error.message]).toEqual(['label_limit_reached', LIMIT_MSG]);
    expect((await labelRows(tid)).length).toBe(2000);
    expect(await I.eventsSince(tid, seq)).toEqual([]);
    const upd = await putLabel(SS.REVIEWER, { description: 'Limit probe 7', category: 'other' });
    expect([upd.status, upd.body.outcome]).toEqual([200, 'changed']);
    const victim = (await SS.VIEWER.get('/charge-labels?pageSize=1')).body.items[0].id;
    expect((await SS.REVIEWER.destroy(`/charge-labels/${victim}`)).status).toBe(204);
    const ok = await putLabel(SS.REVIEWER, { description: 'One more label', category: 'other' });
    expect([ok.status, ok.body.outcome]).toEqual([200, 'created']);
    await clearLabels(tid);
  }, 120000);
  it('CI-A11 five parallel PUTs of the same new text -> one row, one created, one event, never 500', async () => {
    await clearLabels(tid);
    const seq = await I.lastSeq(tid);
    const rs = await Promise.all([SS.OWNER, SS.ADMIN, SS.MANAGER, SS.REVIEWER, SS.REVIEWER].map((s) => putLabel(s, { description: 'Concurrent probe', category: 'accessorial' })));
    for (const r of rs) expect(r.status, r.text).toBe(200);
    expect(rs.filter((r) => r.body.outcome === 'created')).toHaveLength(1);
    expect(rs.filter((r) => r.body.outcome === 'unchanged')).toHaveLength(4);
    expect(new Set(rs.map((r) => r.body.label.id)).size).toBe(1);
    expect((await labelRows(tid)).length).toBe(1);
    expect((await I.eventsSince(tid, seq, 'charge_label.')).length).toBe(1);
  });
  it('CI-A12 the charge-line view reflects labels', async () => {
    await clearLabels(tid);
    const c = await putLabel(SS.REVIEWER, { description: 'Pallet jack rental', category: 'accessorial' });
    const load = H.uniqLoad('K12');
    const made = await A.makeClaim(SS.ANALYST, SS.REVIEWER, k1Files(load, [['Linehaul', '1500.00'], ['Pallet jack rental', '60.00'], ['PALLET JACK RENTAL!!', '61.00']], undefined), 'SHIPPER', load);
    const r = await lines(SS.VIEWER, made.claimId);
    expect(r.status, r.text).toBe(200);
    for (const l of r.body.lines.slice(1)) {
      expect(l.label, l.description).toEqual({ id: c.body.label.id, category: 'accessorial' });
      expect([l.suggestion.category, l.suggestion.similarity, l.suggestion.nearest.origin, l.suggestion.nearest.labelId, l.suggestion.nearest.sourceLabel]).toEqual(['accessorial', 1, 'tenant', c.body.label.id, "Your team's label"]);
    }
    expect(r.body.lines[0].label).toBeNull();
    const o = await oracleFor([{ id: c.body.label.id, description: 'Pallet jack rental', category: 'accessorial' }]);
    for (const l of r.body.lines) expect(l.suggestion).toEqual(o(l.description));
  });
});

describe('T11 RBAC, API keys, precedence, rate limit (C7, C8, C14)', () => {
  const MANAGE: RoleName[] = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'];
  it('CI-R01 matrix', async () => {
    await clearLabels(tid);
    for (const role of ALL_ROLES) {
      const s = SS[role];
      const read = ['PLATFORM_DEV', 'SUPER_ADMIN'].includes(role) ? 403 : 200;
      const manage = MANAGE.includes(role);
      expect((await lines(s, k1.claimId)).status, `${role} charge-lines`).toBe(read);
      expect((await s.get('/charge-labels')).status, `${role} list`).toBe(read);
      const p = await putLabel(s, { description: `Matrix probe ${role}`, category: 'other' });
      expect(p.status, `${role} put ${p.text}`).toBe(manage ? 200 : 403);
      if (!manage) expectError(p, 403, 'forbidden');
      const target = (await putLabel(SS.OWNER, { description: `Matrix delete ${role}`, category: 'other' })).body.label.id;
      const d = await s.destroy(`/charge-labels/${target}`);
      expect(d.status, `${role} delete ${d.text}`).toBe(manage ? 204 : 403);
      if (!manage) expectError(d, 403, 'forbidden');
    }
  });
  it('CI-R02 /me lists charge_labels:manage exactly for OWNER, ADMIN, MANAGER, REVIEWER', async () => {
    for (const role of ALL_ROLES) {
      const me = await SS[role].get('/me');
      expect(me.body.permissions.includes('charge_labels:manage'), role).toBe(MANAGE.includes(role));
    }
  });
  it('CI-R03 an API key with every scope -> 403 forbidden on all four routes', async () => {
    const k = await K.mkKey(SS.OWNER, [...K.SCOPES]);
    const id = (await putLabel(SS.OWNER, { description: 'Key probe target', category: 'other' })).body.label.id;
    for (const [m, p, b] of [['GET', `/claims/${k1.claimId}/charge-lines`], ['GET', '/charge-labels'], ['PUT', '/charge-labels', { description: 'Key probe', category: 'other' }], ['DELETE', `/charge-labels/${id}`]] as const) {
      expectError(await K.keyReq(app, k.secret, m, p, b === undefined ? {} : { body: b }), 403, 'forbidden');
    }
    expect((await SS.VIEWER.get('/charge-labels?pageSize=100')).body.items.some((x: any) => x.id === id), 'key DELETE removed nothing').toBe(true);
  });
  it('CI-R04 precedence: CSRF/origin 403 -> 401 -> 403 -> 400 -> 404 (flag off)', async () => {
    const body = { description: 'Precedence probe', category: 'other' };
    for (const s of [SS.REVIEWER, SS.VIEWER]) {
      expectError(await putLabel(s, body, { csrf: false }), 403, 'csrf_failed');
      expectError(await putLabel(s, body, { headers: { origin: H.ORIGIN_BAD } }), 403, 'origin_not_allowed');
      expectError(await s.destroy(`/charge-labels/${I.RAND_UUID}`, { csrf: false }), 403, 'csrf_failed');
    }
    const anon = new Client(app);
    expectError(await anon.send('GET', '/charge-labels'), 401);
    expectError(await anon.send('GET', `/claims/${k1.claimId}/charge-lines`), 401);
    expectError(await putLabel(SS.ANALYST, { description: '', category: 'nope' }), 403, 'forbidden');
    expectError(await SS.ANALYST.destroy('/charge-labels/not-a-uuid'), 403, 'forbidden');
    const off = await buildTestApp({ FLAGS_CACHE_TTL_MS: '0' });
    const dev = I.onApp(off, SS.PLATFORM_DEV);
    await I.setFlag(dev, 'intelligence.charge_suggestions', false, 'acceptance charge flag off');
    try {
      const rv = I.onApp(off, SS.REVIEWER);
      A.expectExact(await putLabel(rv, { description: '', category: 'nope' }), 400, 'validation_error');
      A.expectExact(await I.onApp(off, SS.VIEWER).get('/charge-labels?pageSize=101'), 400, 'validation_error');
      expectError(await putLabel(I.onApp(off, SS.ANALYST), body), 403, 'forbidden');
      A.expectExact(await putLabel(rv, body), 404, 'not_found');
      A.expectExact(await rv.destroy(`/charge-labels/${I.RAND_UUID}`), 404, 'not_found');
      A.expectExact(await rv.get('/charge-labels'), 404, 'not_found');
      A.expectExact(await lines(rv, k1.claimId), 404, 'not_found');
    } finally {
      await I.setFlag(dev, 'intelligence.charge_suggestions', true, 'acceptance charge flag on');
    }
  }, 120000);
  it('CI-R05 intelligence bucket: the 4th request -> 429 with Retry-After before permission and validation', async () => {
    const rl = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_INTELLIGENCE_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const v = I.onApp(rl, SS.VIEWER, '10.9.9.1');
    expect((await v.get('/charge-labels')).status).toBe(200);
    expect((await lines(v, k1.claimId)).status).toBe(200);
    expect((await v.get('/charge-labels?page=2')).status).toBe(200);
    const r = await putLabel(v, { description: '', category: 'nope' });
    expectError(r, 429, 'rate_limited');
    expect(r.headers['retry-after']).toBeTruthy();
    const other = I.onApp(rl, SS.MANAGER, '10.9.9.2');
    expect((await other.get('/charge-labels')).status, 'another user is unaffected').toBe(200);
  }, 60000);
});

describe('T12 cross-tenant (CI-X01)', () => {
  it('tenant B cannot list, read, change or delete tenant A labels', async () => {
    await clearLabels(tid);
    const a = await putLabel(SS.REVIEWER, { description: 'Pallet jack rental', category: 'accessorial' });
    const aRow = (await labelRows(tid))[0];
    const list = await gx.get('/charge-labels?pageSize=100');
    expect(list.status).toBe(200);
    expect(list.body.items.some((x: any) => x.id === a.body.label.id)).toBe(false);
    const del = await gx.destroy(`/charge-labels/${a.body.label.id}`);
    I.expectIdentical404(del, await gx.destroy(`/charge-labels/${I.RAND_UUID}`));
    const b = await putLabel(gx, { description: 'Pallet jack rental', category: 'other' });
    expect([b.status, b.body.outcome]).toEqual([200, 'created']);
    expect(b.body.label.id).not.toBe(a.body.label.id);
    expect((await labelRows(tid))[0]).toEqual(aRow);
    await clearLabels(gx.user.tenant.id);
  });
});

describe('T13 audit hygiene (CI-U02)', () => {
  it('no audit metadata written by this file contains a label description or normalized text', async () => {
    const leaks = await withAdmin(async (c) => (await c.query(`select action, metadata::text as m from audit_events where tenant_id = $1 and seq > $2 and (metadata::text ilike '%pallet%' or metadata::text ilike '%probe%' or metadata::text ilike '%segregate%')`, [tid, seq0])).rows);
    expect(leaks).toEqual([]);
    const actions = await withAdmin(async (c) => (await c.query(`select distinct action from audit_events where tenant_id = $1 and seq > $2 and action like 'charge_label.%'`, [tid, seq0])).rows.map((r: any) => r.action).sort());
    expect(actions).toEqual(['charge_label.deleted', 'charge_label.set']);
    const v = await SS.OWNER.get('/audit/verify');
    expect(v.status, v.text).toBe(200);
    expect(v.body.valid).toBe(true);
  });
});

describe('T17 CI-A20 label cap race (C10 fix round 1: inserts/deletes serialized per tenant)', () => {
  const fill = async (n: number) => {
    await clearLabels(tid);
    await withAdmin(async (c) => {
      await c.query(`insert into charge_labels (id, tenant_id, normalized_text, description, category, created_by_id, created_at, updated_by_id, updated_at, version)
        select gen_random_uuid(), $1, 'race fill ' || g, 'Race fill ' || g, 'accessorial', $2, now(), $2, now(), 1 from generate_series(1, $3::int) g`, [tid, SS.OWNER.user.id, n]);
    });
  };
  it('1,995 labels + 20 concurrent new PUTs -> exactly 5 created, 15 x 409, 2,000 rows; repeated 5 times', async () => {
    const writers = [SS.OWNER, SS.ADMIN, SS.MANAGER, SS.REVIEWER];
    for (let round = 0; round < 5; round++) {
      await fill(1995);
      const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => putLabel(writers[i % 4]!, { description: `Race new ${round} ${i}`, category: 'other' })));
      for (const r of rs) expect([200, 409], `round ${round}: ${r.status} ${r.text}`).toContain(r.status);
      expect(rs.filter((r) => r.status === 200 && r.body.outcome === 'created'), `round ${round}`).toHaveLength(5);
      const refused = rs.filter((r) => r.status === 409);
      expect(refused).toHaveLength(15);
      for (const r of refused) expect([r.body.error.code, r.body.error.message]).toEqual(['label_limit_reached', LIMIT_MSG]);
      expect((await labelRows(tid)).length, `round ${round} rows`).toBe(2000);
    }
  }, 300000);
  it('concurrent DELETE + PUTs at the cap never leave more than 2,000 rows', async () => {
    for (let round = 0; round < 5; round++) {
      await fill(2000);
      const victim = (await SS.VIEWER.get('/charge-labels?pageSize=1')).body.items[0].id;
      const rs = await Promise.all([
        SS.REVIEWER.destroy(`/charge-labels/${victim}`),
        ...Array.from({ length: 6 }, (_, i) => putLabel([SS.OWNER, SS.MANAGER, SS.REVIEWER][i % 3]!, { description: `Race swap ${round} ${i}`, category: 'other' })),
      ]);
      for (const r of rs) expect([200, 204, 409], `${r.status} ${r.text}`).toContain(r.status);
      expect(rs[0]!.status).toBe(204);
      const created = rs.slice(1).filter((r) => r.status === 200).length;
      expect(created).toBeLessThanOrEqual(1);
      const n = (await labelRows(tid)).length;
      expect(n, `round ${round}`).toBeLessThanOrEqual(2000);
      expect(n).toBe(1999 + created);
    }
    await clearLabels(tid);
  }, 300000);
});
