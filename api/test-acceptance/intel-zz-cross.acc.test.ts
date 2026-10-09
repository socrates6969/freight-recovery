/* eslint-disable */
// T14 (T-X-01, T-X-02, T-X-03, T-X-05): cross-cutting guarantees. T-X-04 (earlier suites unchanged) is the full `npm run test:acceptance` run.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeApps, type RoleName, type Session } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let A: I.Fx;
const bodies: Array<{ route: string; text: string }> = [];
beforeAll(async () => {
  app = await buildTestApp();
  SS = await I.seededOn(app);
  for (const r of Object.keys(SS) as RoleName[]) SS[r] = I.recorded(SS[r]);
  A = await I.fixtureTenant(app, 'intel-fixture-a', 'Intel Fixture A (synthetic)');
  await I.insertClaims(A.id, A.ownerId, [{ num: 'XC-1', status: 'APPROVED', perspective: 'SHIPPER', carrier: 'Cross Carrier', rec: 1000, pend: 0, ageMs: 3600_000, packets: [{ findings: ['TST-X'], sources: ['INVOICE'] }] }]);
}, 300000);
afterAll(async () => { try { await I.resetFlags(); I.assertHonest('intel-zz-cross'); } finally { await closeApps(); reseed(); } });

async function exerciseEveryPlatformRoute() {
  const dev = SS.PLATFORM_DEV, sup = SS.SUPER_ADMIN;
  const calls: Array<[string, Session, string]> = [
    ['R60', dev, '/platform/pipeline?window=7d'], ['R60s', sup, '/platform/pipeline'], ['R61', dev, '/platform/telemetry'], ['R61s', sup, '/platform/telemetry'],
    ['R62', dev, '/platform/logs?level=trace&limit=200'], ['R63', dev, '/platform/flags'], ['R65', dev, '/platform/eval/runs'],
    ['R67', sup, '/platform/audit/events?limit=100'], ['R68', sup, '/platform/audit/verify'],
  ];
  const out: Array<{ route: string; text: string }> = [];
  for (const [id, s, p] of calls) {
    const r = await s.get(p);
    expect(r.status, `${id}: ${r.text}`).toBe(200);
    out.push({ route: id, text: r.text });
  }
  const runs = (await dev.get('/platform/eval/runs')).body.items;
  if (runs.length) out.push({ route: 'R66', text: (await dev.get(`/platform/eval/runs/${runs[0].id}`)).text });
  const f = (await dev.get('/platform/flags')).body.items.find((x: any) => x.key === 'intelligence.provenance');
  const w = await I.put(dev, '/platform/flags/intelligence.provenance', { enabled: !f.enabled, expectedVersion: f.version, reason: 'cross-cutting acceptance change' });
  expect(w.status, w.text).toBe(200);
  out.push({ route: 'R64', text: w.text });
  await I.resetFlags();
  return out;
}

describe('T-X-01 platform vs tenant data separation', () => {
  it('no tenant, user, claim or file identifier occurs in any platform response', async () => {
    bodies.push(...(await exerciseEveryPlatformRoute()));
    const needles: string[] = await withAdmin(async (c) => {
      const out: string[] = [];
      for (const r of (await c.query(`select name, slug from tenants`)).rows) out.push(r.name, r.slug);
      for (const r of (await c.query(`select email, name from users where platform_role is null`)).rows) out.push(r.email, r.name);
      for (const r of (await c.query(`select claim_number from claims`)).rows) out.push(r.claim_number);
      for (const r of (await c.query(`select display_name, sha256 from import_documents`)).rows) out.push(r.display_name, r.sha256);
      for (const r of (await c.query(`select filename, sha256 from packet_sources`)).rows) out.push(r.filename, r.sha256);
      return out;
    });
    const staff: string[] = await withAdmin(async (c) => (await c.query(`select name from users where platform_role is not null`)).rows.map((r: any) => r.name));
    const list = [...new Set(needles)].filter((s) => s && s.length >= 4 && !staff.includes(s));
    expect(list.length).toBeGreaterThan(20);
    for (const b of bodies) for (const n of list) expect(b.text.includes(n), `${b.route} contains identifier ${n.slice(0, 16)}`).toBe(false);
  }, 120000);
});

describe('T-X-02 audit chains stay valid', () => {
  it('tenant chains and the platform chain verify; the platform sequence has no gaps', async () => {
    const gxOwner = I.recorded(I.onApp(app, await I.baseSession(I.GLOBEX.OWNER)));
    for (const s of [A.owner, SS.OWNER, gxOwner]) {
      const v = await s.get('/audit/verify');
      expect(v.status, v.text).toBe(200);
      expect(v.body.valid, s.email).toBe(true);
    }
    const pv = await SS.SUPER_ADMIN.get('/platform/audit/verify');
    expect(pv.status).toBe(200);
    expect(pv.body.valid).toBe(true);
    const seqs: number[] = await withAdmin(async (c) => (await c.query(`select seq::int as s from audit_events where tenant_id is null order by seq`)).rows.map((r: any) => Number(r.s)));
    expect(seqs.length).toBeGreaterThan(0);
    seqs.forEach((s, i) => expect(s, `gap before index ${i}`).toBe(i + 1));
  });
});

describe('T-X-03 read-only guarantee', () => {
  it('many intelligence reads leave claims, packets, findings and approvals untouched', async () => {
    const snap = () => withAdmin(async (c) => {
      const out: Record<string, string> = {};
      for (const t of ['claims', 'evidence_packets', 'packet_findings', 'approvals']) {
        const r = await c.query(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from "${t}" x`);
        out[t] = `${r.rows[0].n}:${r.rows[0].h}`;
      }
      return out;
    });
    const before = await snap();
    const ids = (await SS.MANAGER.get('/claims?pageSize=5')).body.items.map((c: any) => c.id);
    const aId = (await A.manager.get('/claims?pageSize=5')).body.items.map((c: any) => c.id);
    for (let i = 0; i < 4; i++) {
      await SS.MANAGER.get('/intelligence/worklist?pageSize=100');
      for (const id of ids) { await SS.MANAGER.get(`/claims/${id}/similar?limit=10`); await SS.MANAGER.get(`/claims/${id}/provenance`); }
      for (const id of aId) { await A.manager.get(`/claims/${id}/similar`); await A.manager.get(`/claims/${id}/provenance`); }
    }
    expect(await snap()).toEqual(before);
  }, 120000);
});

describe('T-X-05 honest-labeling API sweep', () => {
  it('every body of every new route avoids the forbidden claims and carries its exact fixed text', async () => {
    const w = await A.manager.get('/intelligence/worklist');
    expect(w.body.label).toBe(I.WORKLIST_NOTE(25));
    const claimId = (await A.manager.get('/claims?pageSize=1')).body.items[0].id;
    const s = await A.manager.get(`/claims/${claimId}/similar`);
    expect(s.body.label).toBe(I.SIMILAR_NOTE);
    const p = await A.manager.get(`/claims/${claimId}/provenance`);
    expect(p.body.label).toBe(I.PROVENANCE_NOTE);
    const f = await A.manager.get('/features');
    for (const r of [w, s, p, f, ...bodies.map((b) => ({ text: b.text, status: 200 }))]) expect(I.HONEST_RE.test((r as any).text), (r as any).text.slice(0, 200)).toBe(false);
    const tel = bodies.find((b) => b.route === 'R61')!;
    expect(tel.text.includes('"learnedModel":false')).toBe(true);
    expect(tel.text.includes('"method":"fixed_rules"')).toBe(true);
  });
});