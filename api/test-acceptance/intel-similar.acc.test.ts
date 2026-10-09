/* eslint-disable */
// T11 (T-SIM-01..10): similar past claims (similar-v1). Exact ranking, accounting, determinism, isolation, oracle, honesty.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

const MIN = 60_000;
let app: FastifyInstance;
let A: I.Fx, B: I.Fx;
let SS: Record<RoleName, Session>;
let ids: Record<string, string> = {};
const NOW = Date.now();
const T1 = NOW - 90 * MIN;
const RULES = (...r: string[]) => r.map((x) => `TST-${x}`);
const X_CARRIER = 'Blue  Ridge Carriers';

const spec = (num: string, status: string, carrier: string, perspective: 'SHIPPER' | 'CARRIER', rec: number, pend: number, ageMin: number, extra: Partial<I.ClaimSpec> = {}): I.ClaimSpec => ({ num, status, carrier, perspective, rec, pend, ageMs: ageMin * MIN, ...extra });
async function seedA() {
  await I.clearTenantClaims(A.id);
  const ins = await I.insertClaims(A.id, A.ownerId, [
    spec('SIM-X', 'PENDING_REVIEW', X_CARRIER, 'SHIPPER', 50000, 0, 30, { packets: [{ findings: RULES('ALPHA', 'BETA') }] }),
    spec('S1', 'APPROVED', 'blue ridge carriers', 'SHIPPER', 20000, 5000, 1, { packets: [{ findings: RULES('ALPHA', 'BETA', 'ALPHA'), sources: ['INVOICE', 'INVOICE', 'RATE_CONFIRMATION'] }], approvals: [T1 - 120 * MIN, T1] }),
    spec('S2', 'SEND_READY', 'Blue Ridge Carriers', 'CARRIER', 50000, 0, 2, { packets: [{ findings: RULES('ALPHA') }] }),
    spec('S3', 'APPROVED', 'Other Co', 'SHIPPER', 50000, 0, 3, { packets: [{ findings: RULES('ALPHA', 'GAMMA') }] }),
    spec('S4', 'REJECTED', 'Other Co', 'SHIPPER', 50000, 0, 4, { packets: [{ findings: RULES('GAMMA') }] }),
    spec('S5', 'APPROVED', 'Blue Ridge Carriers', 'SHIPPER', 0, 0, 5, { packets: [{ findings: RULES('ALPHA', 'BETA') }, { findings: [] }] }),
    spec('S6', 'REJECTED', 'BLUE RIDGE CARRIERS', 'CARRIER', 1, 0, 6, { packets: [{ findings: RULES('DELTA') }] }),
    spec('S8', 'PENDING_REVIEW', 'Blue Ridge Carriers', 'SHIPPER', 50000, 0, 7, { packets: [{ findings: RULES('ALPHA', 'BETA') }] }),
    spec('S9', 'APPROVED', 'Zed', 'SHIPPER', 5000, 0, 8, { packets: [{ findings: RULES('ALPHA', 'BETA') }] }),
    spec('S10', 'AWAITING_ANALYSIS', 'Blue Ridge Carriers', 'SHIPPER', 0, 0, 9, { packets: null }),
  ], NOW);
  ids = Object.fromEntries(ins.map((x) => [x.spec.num, x.id]));
  await I.clearTenantClaims(B.id);
  const [b1] = await I.insertClaims(B.id, B.ownerId, [spec('SIM-B1', 'APPROVED', 'Blue Ridge Carriers', 'SHIPPER', 50000, 0, 3, { packets: [{ findings: RULES('ALPHA', 'BETA') }] })], NOW);
  ids['SIM-B1'] = b1!.id;
}
beforeAll(async () => {
  app = await buildTestApp();
  A = await I.fixtureTenant(app, 'intel-fixture-a', 'Intel Fixture A (synthetic)');
  B = await I.fixtureTenant(app, 'intel-fixture-b', 'Intel Fixture B (synthetic)');
  SS = await I.seededOn(app);
  for (const r of Object.keys(SS) as RoleName[]) SS[r] = I.recorded(SS[r]);
  await seedA();
}, 300000);
afterAll(async () => { try { await I.resetFlags(); I.assertHonest('intel-similar'); } finally { await closeApps(); reseed(); } });

const sim = async (s: Session, claim: string, qs = '') => {
  const r = await s.get(`/claims/${claim}/similar${qs ? `?${qs}` : ''}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
};
const byNum = (b: any) => b.items.map((x: any) => x.claim.claimNumber);

describe('T-SIM-01 exact ranking', () => {
  it('scores, order, matches and handling are hand-computed', async () => {
    const b = await sim(A.manager, ids['SIM-X']!, 'limit=10');
    expect(byNum(b)).toEqual(['S1', 'S2', 'S9', 'S5', 'S3', 'S6']);
    expect(b.items.map((x: any) => x.similarityPercent)).toEqual([92, 70, 51, 45, 38, 35]);
    const m = Object.fromEntries(b.items.map((x: any) => [x.claim.claimNumber, x.matches]));
    expect(m.S1).toEqual([
      { key: 'same_carrier', points: 35, detail: 'Same carrier' },
      { key: 'shared_rules', points: 40, detail: 'Shared rules: TST-ALPHA, TST-BETA' },
      { key: 'similar_amount', points: 7, detail: 'Amounts $500.00 and $250.00' },
      { key: 'same_perspective', points: 10, detail: 'Same perspective (SHIPPER)' },
    ]);
    expect(m.S2).toEqual([
      { key: 'same_carrier', points: 35, detail: 'Same carrier' },
      { key: 'shared_rules', points: 20, detail: 'Shared rules: TST-ALPHA' },
      { key: 'similar_amount', points: 15, detail: 'Amounts $500.00 and $500.00' },
    ]);
    expect(m.S9).toEqual([
      { key: 'shared_rules', points: 40, detail: 'Shared rules: TST-ALPHA, TST-BETA' },
      { key: 'similar_amount', points: 1, detail: 'Amounts $500.00 and $50.00' },
      { key: 'same_perspective', points: 10, detail: 'Same perspective (SHIPPER)' },
    ]);
    expect(m.S5).toEqual([{ key: 'same_carrier', points: 35, detail: 'Same carrier' }, { key: 'same_perspective', points: 10, detail: 'Same perspective (SHIPPER)' }]);
    expect(m.S3).toEqual([
      { key: 'shared_rules', points: 13, detail: 'Shared rules: TST-ALPHA' },
      { key: 'similar_amount', points: 15, detail: 'Amounts $500.00 and $500.00' },
      { key: 'same_perspective', points: 10, detail: 'Same perspective (SHIPPER)' },
    ]);
    expect(m.S6).toEqual([{ key: 'same_carrier', points: 35, detail: 'Same carrier' }]);
    for (const x of b.items) expect(x.matches.reduce((s: number, y: any) => s + y.points, 0), x.claim.claimNumber).toBe(x.similarityPercent);
    for (const n of ['S4', 'S8', 'S10', 'SIM-X', 'SIM-B1']) expect(byNum(b)).not.toContain(n);
    const h = Object.fromEntries(b.items.map((x: any) => [x.claim.claimNumber, x.handling]));
    expect(h.S1).toEqual({ finalStatus: 'APPROVED', ruleIds: RULES('ALPHA', 'BETA'), sourceDocTypes: ['INVOICE', 'RATE_CONFIRMATION'], findingCount: 3, decidedAt: new Date(T1).toISOString() });
    expect(h.S2).toEqual({ finalStatus: 'SEND_READY', ruleIds: RULES('ALPHA'), sourceDocTypes: [], findingCount: 1, decidedAt: null });
    expect(h.S5).toEqual({ finalStatus: 'APPROVED', ruleIds: [], sourceDocTypes: [], findingCount: 0, decidedAt: null });
    expect(h.S6).toEqual({ finalStatus: 'REJECTED', ruleIds: RULES('DELTA'), sourceDocTypes: [], findingCount: 1, decidedAt: null });
  });
});

describe('T-SIM-02 limit and defaults', () => {
  it('default five, limit bounds, fixed weights and texts', async () => {
    const b = await sim(A.manager, ids['SIM-X']!);
    expect(byNum(b)).toEqual(['S1', 'S2', 'S9', 'S5', 'S3']);
    expect(byNum(await sim(A.manager, ids['SIM-X']!, 'limit=1'))).toEqual(['S1']);
    expectError(await A.manager.get(`/claims/${ids['SIM-X']}/similar?limit=11`), 400, 'validation_error');
    expectError(await A.manager.get(`/claims/${ids['SIM-X']}/similar?limit=0`), 400, 'validation_error');
    expect(b.weights).toEqual({ sameCarrier: 35, sharedRules: 40, similarAmount: 15, samePerspective: 10 });
    expect(b.minPercent).toBe(30);
    expect(b.version).toBe('similar-v1');
    expect(b.label).toBe(I.SIMILAR_NOTE);
    expect(b.reason).toBeNull();
    expect(b.claimId).toBe(ids['SIM-X']);
  });
});

describe('T-SIM-03 candidate accounting', () => {
  it('counts decided claims with a packet; the candidate limit keeps the most recent ones', async () => {
    const b = await sim(A.manager, ids['SIM-X']!);
    expect(b.candidatesConsidered).toBe(7);
    expect(Number.isFinite(b.computeMs) && b.computeMs >= 0 && b.computeMs < 60000).toBe(true);
    const fill = await I.insertClaims(A.id, A.ownerId, Array.from({ length: 12 }, (_, i) => spec(`FIL-${i}`, 'APPROVED', 'Filler Co', 'CARRIER', 100, 0, 0, { ageMs: (i + 1) * 1000, packets: [{ findings: RULES('FILL') }] })), NOW);
    try {
      const limited = await buildTestApp({ SIMILAR_CANDIDATE_LIMIT: '10' });
      const lb = await sim(I.onApp(limited, A.manager), ids['SIM-X']!);
      expect(lb.items).toEqual([]);
      expect(lb.candidatesConsidered).toBe(10);
      const full = await sim(A.manager, ids['SIM-X']!);
      expect(byNum(full)).toEqual(['S1', 'S2', 'S9', 'S5', 'S3']);
      expect(full.candidatesConsidered).toBe(19);
    } finally {
      await I.removeClaims(A.id, fill.map((f) => f.id));
    }
  }, 60000);
});

describe('T-SIM-04 determinism and purity', () => {
  it('identical repeated answers; limit truncates without reordering; no claim row changes', async () => {
    const snap = () => withAdmin(async (c) => (await c.query(`select id, updated_at, version from claims where tenant_id=$1 order by id`, [A.id])).rows);
    const before = await snap();
    const a = await sim(A.manager, ids['SIM-X']!, 'limit=10');
    const b = await sim(A.manager, ids['SIM-X']!, 'limit=10');
    const c = await sim(A.manager, ids['SIM-X']!, 'limit=10');
    expect(b.items).toEqual(a.items);
    expect(c.items).toEqual(a.items);
    expect((await sim(A.manager, ids['SIM-X']!, 'limit=3')).items).toEqual(a.items.slice(0, 3));
    expect(await snap()).toEqual(before);
  });
});

describe('T-SIM-05 no packet', () => {
  it('a claim without a packet answers with reason no_packet', async () => {
    const b = await sim(A.manager, ids['S10']!);
    expect(b.items).toEqual([]);
    expect(b.reason).toBe('no_packet');
    expect(b.candidatesConsidered).toBe(0);
    expect(b.computeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('T-SIM-06 tenant isolation', () => {
  it('no cross-tenant candidates or identifiers; foreign ids are indistinguishable from unknown ids', async () => {
    const own = await sim(B.manager, ids['SIM-B1']!);
    expect(own.items).toEqual([]);
    const a = await A.manager.get(`/claims/${ids['SIM-X']}/similar?limit=10`);
    expect(a.text.includes('SIM-B1')).toBe(false);
    expect(a.text.includes(B.id)).toBe(false);
    expect(a.text.includes(ids['SIM-B1']!)).toBe(false);
    const foreign = await A.manager.get(`/claims/${ids['SIM-B1']}/similar`);
    const unknown = await A.manager.get(`/claims/${I.RAND_UUID}/similar`);
    const junk = await A.manager.get('/claims/not-a-uuid/similar');
    I.expectIdentical404(foreign, unknown);
    I.expectIdentical404(foreign, junk);
  });
});

describe('T-SIM-07 roles, flag, audit', () => {
  it('all tenant roles may read; platform roles may not; one audit event per success; the flag hides the route', async () => {
    const acmeClaim = (await SS.MANAGER.get('/claims?pageSize=1')).body.items[0].id;
    for (const s of [A.owner, A.manager, A.viewer, A.analyst]) expect((await s.get(`/claims/${ids['SIM-X']}/similar`)).status, s.email).toBe(200);
    for (const s of [SS.ADMIN, SS.REVIEWER]) expect((await s.get(`/claims/${acmeClaim}/similar`)).status, s.email).toBe(200);
    expectError(await SS.PLATFORM_DEV.get(`/claims/${ids['SIM-X']}/similar`), 403, 'forbidden');
    expectError(await SS.SUPER_ADMIN.get(`/claims/${ids['SIM-X']}/similar`), 403, 'forbidden');
    expectError(await new Client(app).get(`/claims/${ids['SIM-X']}/similar`), 401, 'unauthenticated');
    const seq = await I.lastSeq(A.id);
    const r = await A.manager.get(`/claims/${ids['SIM-X']}/similar?limit=2`);
    const ev = await I.eventsSince(A.id, seq);
    expect(ev.map((e) => e.action)).toEqual(['intelligence.viewed']);
    expect(I.keysOf(ev[0]!.metadata)).toEqual(['claimId', 'kind', 'returned']);
    expect(ev[0]!.metadata).toEqual({ kind: 'similar', claimId: ids['SIM-X'], returned: r.body.items.length });
    const s2 = await I.lastSeq(A.id);
    expectError(await A.manager.get(`/claims/${ids['SIM-X']}/similar?limit=0`), 400, 'validation_error');
    expectError(await A.manager.get(`/claims/${I.RAND_UUID}/similar`), 404, 'not_found');
    expect((await I.eventsSince(A.id, s2)).filter((e) => e.action === 'intelligence.viewed').length).toBe(0);
    const off = await buildTestApp({ FLAGS_CACHE_TTL_MS: '0' });
    const dev = I.onApp(off, SS.PLATFORM_DEV);
    await I.setFlag(dev, 'intelligence.similar_claims', false, 'acceptance similar off');
    try {
      expectError(await I.onApp(off, A.manager).get(`/claims/${ids['SIM-X']}/similar`), 404, 'not_found');
    } finally {
      await I.setFlag(dev, 'intelligence.similar_claims', true, 'acceptance similar on');
    }
  }, 60000);
});
describe('T-SIM-08 carrier normalization', () => {
  it('case and whitespace variants are the same carrier; a one-character difference is not', async () => {
    const [s11, s12] = await I.insertClaims(A.id, A.ownerId, [
      spec('S11', 'APPROVED', ' blue   RIDGE carriers ', 'SHIPPER', 50000, 0, 0, { ageMs: 500, packets: [{ findings: RULES('ALPHA', 'BETA') }] }),
      spec('S12', 'APPROVED', 'Blue Ridge Carrier', 'SHIPPER', 50000, 0, 0, { ageMs: 600, packets: [{ findings: RULES('ALPHA', 'BETA') }] }),
    ], NOW);
    try {
      const b = await sim(A.manager, ids['SIM-X']!, 'limit=10');
      const x11 = b.items.find((x: any) => x.claim.id === s11!.id);
      const x12 = b.items.find((x: any) => x.claim.id === s12!.id);
      expect(x11.matches.find((m: any) => m.key === 'same_carrier')?.points).toBe(35);
      expect(x11.similarityPercent).toBe(100);
      expect(x12.matches.find((m: any) => m.key === 'same_carrier')).toBeUndefined();
      expect(x12.similarityPercent).toBe(65);
    } finally {
      await I.removeClaims(A.id, [s11!.id, s12!.id]);
    }
  });
});

describe('T-SIM-09 randomized oracle', () => {
  it('60 random candidates and 5 random targets agree with an independent implementation of the contract', async () => {
    await I.clearTenantClaims(B.id);
    const rnd = I.rng(I.SEED);
    const carriers = ['Alpha Freight', 'Beta Haulage', 'Gamma Lines', 'Delta Transport'];
    const noise = (s: string) => {
      const c = rnd.int(4);
      const t = c === 1 ? s.toUpperCase() : c === 2 ? s.toLowerCase() : s;
      return rnd.int(3) === 0 ? `  ${t.replace(' ', '   ')} ` : t;
    };
    const universe = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
    const rules = () => universe.filter(() => rnd.int(3) === 0).map((r) => `TST-${r}`);
    const amounts = [0, 100, 5000, 20000, 20000, 75000, 150000, 200000];
    const statuses = ['APPROVED', 'APPROVED', 'SEND_READY', 'REJECTED', 'PENDING_REVIEW', 'AWAITING_ANALYSIS'];
    const specs: I.ClaimSpec[] = Array.from({ length: 65 }, (_, i) => {
      const status = rnd.pick(statuses);
      const total = rnd.pick(amounts);
      const rec = rnd.int(2) ? total : Math.floor(total / 2);
      return { num: `RS-${String(i).padStart(3, '0')}`, status, carrier: noise(rnd.pick(carriers)), perspective: rnd.pick(['SHIPPER', 'CARRIER'] as const), rec, pend: total - rec, ageMs: (1 + rnd.int(20)) * MIN, packets: status === 'AWAITING_ANALYSIS' ? null : [{ findings: rules() }] };
    });
    await I.insertClaims(B.id, B.ownerId, specs, NOW);
    const all = await I.loadOClaims(B.id);
    const targets = all.filter((c) => c.hasPacket).slice(0, 5);
    expect(targets.length).toBe(5);
    for (const t of targets) {
      const want = I.oracleSimilar(t, all, 10, 500);
      const got = await sim(B.manager, t.id, 'limit=10');
      expect(got.candidatesConsidered, t.num).toBe(want.considered);
      expect(got.items.map((x: any) => x.claim.id), `${t.num} order`).toEqual(want.items.map((x) => x.id));
      got.items.forEach((x: any, i: number) => {
        expect(x.similarityPercent, `${t.num} #${i}`).toBe(want.items[i]!.pct);
        expect(x.matches).toEqual(want.items[i]!.matches);
      });
    }
  }, 120000);
});

describe('T-SIM-10 honesty', () => {
  it('no forbidden claims, documented keys only, exact label', async () => {
    const b = await sim(A.manager, ids['SIM-X']!, 'limit=10');
    expect(I.HONEST_RE.test(JSON.stringify(b))).toBe(false);
    const ks = I.allKeys(b);
    for (const k of ['probability', 'accuracy', 'speedup', 'cached', 'cache', 'confidence', 'predicted']) expect(ks.has(k), k).toBe(false);
    expect(b.label).toBe(I.SIMILAR_NOTE);
    expect(Object.keys(b).sort()).toEqual(['candidatesConsidered', 'claimId', 'computeMs', 'items', 'label', 'minPercent', 'reason', 'version', 'weights']);
    for (const it of b.items) {
      expect(Object.keys(it).sort()).toEqual(['claim', 'handling', 'matches', 'similarityPercent']);
      expect(Object.keys(it.claim).sort()).toEqual(['carrierName', 'claimNumber', 'id', 'pendingReviewCents', 'perspective', 'recoverableCents', 'status', 'updatedAt']);
      expect(Object.keys(it.handling).sort()).toEqual(['decidedAt', 'finalStatus', 'findingCount', 'ruleIds', 'sourceDocTypes']);
      expect(['APPROVED', 'SEND_READY', 'REJECTED']).toContain(it.handling.finalStatus);
    }
  });
});