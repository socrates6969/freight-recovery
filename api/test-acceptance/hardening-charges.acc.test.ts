/* eslint-disable */
// REQ-20261012-hardening Tier H: T6 Charges view influence HD-C01..HD-C05, label race HD-C06 (SC-8), outlook source
// kind HD-O01 (Part C C3, C8). Black-box over HTTP; label rows and price imports over SQL.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Res, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import { withAdmin } from './helpers/db.js';
import * as X from './helpers/hardening.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let O1: Session, AD: Session, M1: Session, AN1: Session, V1: Session, R1: Session, DEV: Session, GX: Session;
let tid = '';
let R: any;
const lines = (s: Session, id: string) => s.get(`/claims/${id}/charge-lines`);
const CONFLICT_MSG = 'The request conflicts with the current state.'; // ERROR_MESSAGES.conflict (C0.7, unchanged)

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  R = await import('@fr/shared');
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0', PRICE_CACHE_TTL_MS: '0' });
  O1 = await sessionFor(app, ACCOUNTS.OWNER);
  AD = await sessionFor(app, ACCOUNTS.ADMIN);
  M1 = await sessionFor(app, ACCOUNTS.MANAGER);
  AN1 = await sessionFor(app, ACCOUNTS.ANALYST);
  V1 = await sessionFor(app, ACCOUNTS.VIEWER);
  R1 = await sessionFor(app, ACCOUNTS.REVIEWER);
  DEV = await sessionFor(app, ACCOUNTS.PLATFORM_DEV);
  GX = await sessionFor(app, I.GLOBEX.MANAGER);
  tid = O1.user.tenant.id;
  await X.clearLabels(tid);
}, 180000);
afterAll(async () => { try { await I.setFlag(DEV, 'intelligence.charge_suggestions', true, 'hardening restore'); } finally { await closeApps(); reseed(); } });

describe('T6 influence in the Charges view (C3)', () => {
  let inf: X.Influenced;
  let x = '';
  it('HD-C01 awaiting claim: influence null; lines as before; strict schema', async () => {
    const aw = await A.makeClaim(AN1, M1, X.pjFiles(H.uniqLoad('HC1')), 'SHIPPER');
    const r = await lines(V1, aw.claimId);
    expect(r.status, r.text).toBe(200);
    expect(R.ChargeLinesResponse.parse(r.body)).toEqual(r.body);
    expect(r.body.influence).toBeNull();
    expect(r.body.lines.map((l: any) => [l.index, l.description, l.amount, l.ruleCategory])).toEqual([[0, 'Linehaul', '1500.00', 'linehaul'], [1, X.PJ, '60.00', 'other']]);
  }, 120000);
  it('HD-C02 influenced claim: influence.labels = [{labelId X, description, category}] in stored order', async () => {
    x = await X.putLabelOk(R1, X.PJ, 'accessorial', 'created');
    inf = await X.influenced(tid, AN1, M1, AN1, [x], 'HC2');
    const r = await lines(V1, inf.made.claimId);
    expect(r.status, r.text).toBe(200);
    expect(R.ChargeLinesResponse.parse(r.body)).toEqual(r.body);
    expect(r.body.influence).toEqual({ labels: (inf.event.metadata.learnedLabelIds as string[]).map((id) => (id === x ? { labelId: x, description: X.PJ, category: 'accessorial' } : expect.anything())) });
    expect(r.body.influence.labels.map((l: any) => l.labelId)).toEqual(inf.event.metadata.learnedLabelIds);
    // C3: each line's label/suggestion come from one consistent read: the labelled line shows the label X
    const pj = r.body.lines.find((l: any) => l.description === X.PJ);
    expect(pj.label).toEqual({ id: x, category: 'accessorial' });
    expect(pj.suggestion.nearest?.labelId).toBe(x);
  }, 120000);
  it('HD-C02b the current label values are shown (category changed after the analysis)', async () => {
    expect(await X.putLabelOk(R1, X.PJ, 'other', 'changed')).toBe(x);
    const r = await lines(V1, inf.made.claimId);
    expect(r.body.influence.labels.find((l: any) => l.labelId === x)).toEqual({ labelId: x, description: X.PJ, category: 'other' });
  });
  it('HD-C03 after X is deleted: description and category null', async () => {
    expect((await O1.destroy(`/charge-labels/${x}`)).status).toBe(204);
    const r = await lines(V1, inf.made.claimId);
    expect(r.status, r.text).toBe(200);
    expect(r.body.influence.labels.find((l: any) => l.labelId === x)).toEqual({ labelId: x, description: null, category: null });
  });
  it('HD-C04 claim analysed with no label influence: influence {labels: []}', async () => {
    const c = await A.smallClaim(AN1, M1, 'HC4');
    await X.analyzeOk(AN1, c.claimId);
    const r = await lines(V1, c.claimId);
    expect(r.status, r.text).toBe(200);
    expect(r.body.influence).toEqual({ labels: [] });
  }, 120000);
  it('HD-C05 404 rules unchanged (flag off, other tenant, non-UUID) byte-identical to unknown id; VIEWER reads 200', async () => {
    const unknown = await lines(V1, I.RAND_UUID);
    I.expectIdentical404(unknown, await lines(GX, inf.made.claimId));
    I.expectIdentical404(unknown, await lines(V1, 'not-a-uuid'));
    await I.setFlag(DEV, 'intelligence.charge_suggestions', false, 'hardening HD-C05');
    try {
      I.expectIdentical404(unknown, await lines(V1, inf.made.claimId));
    } finally {
      await I.setFlag(DEV, 'intelligence.charge_suggestions', true, 'hardening HD-C05 restore');
    }
    expect((await lines(V1, inf.made.claimId)).status).toBe(200);
  });
});

describe('HD-C06 label race (C8.1): never 500', () => {
  it('20 rounds: two users PUT the same description concurrently while a third deletes it (even rounds) or also PUTs (odd rounds)', async () => {
    await X.clearLabels(tid);
    const all: Res[] = [];
    for (let round = 0; round < 20; round++) {
      const desc = `Race hardening ${H.RUN} ${round}`;
      let rs: Res[];
      if (round % 2 === 0) {
        const id = await X.putLabelOk(O1, desc, 'accessorial', 'created');
        rs = await Promise.all([X.putLabel(M1, desc, 'other'), X.putLabel(R1, desc, 'detention'), O1.destroy(`/charge-labels/${id}`)]);
        expect([204, 404], `round ${round} delete: ${rs[2]!.text}`).toContain(rs[2]!.status);
      } else {
        rs = await Promise.all([X.putLabel(M1, desc, 'other'), X.putLabel(R1, desc, 'detention'), X.putLabel(AD, desc, 'accessorial')]);
      }
      for (const r of rs.slice(0, round % 2 === 0 ? 2 : 3)) {
        expect([200, 409], `round ${round}: ${r.status} ${r.text}`).toContain(r.status);
        if (r.status === 409) {
          expect(['conflict', 'label_limit_reached']).toContain(r.body.error.code);
          if (r.body.error.code === 'conflict') expect(Object.keys(r.body.error).sort()).toEqual(['code', 'message', 'requestId']);
        }
      }
      all.push(...rs);
      const n = await withAdmin(async (c) => Number((await c.query('select count(*)::int n from charge_labels where tenant_id = $1', [tid])).rows[0].n));
      expect(n).toBeLessThanOrEqual(2000);
      const dup = await withAdmin(async (c) => Number((await c.query(`select count(*)::int n from charge_labels where tenant_id = $1 and description = $2`, [tid, desc])).rows[0].n));
      expect(dup, `round ${round}: at most one label per text`).toBeLessThanOrEqual(1);
    }
    X.no500(all, 'HD-C06');
    const conflicts = all.filter((r) => r.status === 409 && r.body?.error?.code === 'conflict');
    console.log(`[HD-C06] ${all.length} responses, ${conflicts.length} x 409 conflict (message ${conflicts[0]?.body.error.message ?? 'n/a'})`);
    for (const r of conflicts) expect(r.body.error.message).toBe(CONFLICT_MSG);
    await X.clearLabels(tid);
  }, 300000);
});

describe('HD-O01 outlook provenance sourceKind (C8.2)', () => {
  it('after the seed, each non-null provenance.sourceKind equals the stored source_kind of that import (bundled); strict schema', async () => {
    const r = await V1.get('/outlook');
    expect(r.status, r.text).toBe(200);
    expect(R.OutlookResponse.parse(r.body)).toEqual(r.body);
    const provs = (r.body.series as any[]).map((s) => s.provenance).filter(Boolean);
    expect(provs.length).toBeGreaterThan(0);
    for (const p of provs) {
      const row = await withAdmin(async (c) => (await c.query('select source_kind from price_imports where id = $1', [p.importId])).rows[0]);
      expect(p.sourceKind).toBe(row.source_kind);
      expect(p.sourceKind).toBe('bundled');
    }
  });
});
