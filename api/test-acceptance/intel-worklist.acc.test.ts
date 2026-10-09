/* eslint-disable */
// T10 (T-WORK-01..12): the prioritised worklist (priority-v1). Exact order, explanations, oracle, isolation, audit, safety.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
let app: FastifyInstance;
let A: I.Fx, B: I.Fx;
let SS: Record<RoleName, Session>;
let ids: Record<string, string> = {};
const NOW = Date.now();

async function seedA() {
  await I.clearTenantClaims(A.id);
  const S = (num: string, status: string, perspective: 'SHIPPER' | 'CARRIER', rec: number, pend: number, ageMs: number, review = 0, extra: Partial<I.ClaimSpec> = {}): I.ClaimSpec => ({ num, status, perspective, rec, pend, ageMs, review, ...extra });
  const ins = await I.insertClaims(A.id, A.ownerId, [
    S('INT-A', 'PENDING_REVIEW', 'SHIPPER', 100000, 0, DAY + HOUR),
    S('INT-B', 'PENDING_REVIEW', 'SHIPPER', 50000, 200000, 2 * HOUR, 2),
    S('INT-C', 'APPROVED', 'CARRIER', 100000, 0, 3 * DAY + HOUR, 0, { id: C1 }),
    S('INT-D', 'PENDING_REVIEW', 'CARRIER', 0, 3, 5 * HOUR, 1),
    S('INT-E', 'PENDING_REVIEW', 'CARRIER', 1, 7, 30 * 60_000, 1),
    S('INT-F', 'REJECTED', 'SHIPPER', 999999, 0, HOUR),
    S('INT-G', 'SEND_READY', 'SHIPPER', 777777, 0, HOUR),
    S('INT-H', 'APPROVED', 'CARRIER', 100000, 0, 3 * DAY + HOUR, 0, { id: C2 }),
    S('INT-I', 'AWAITING_ANALYSIS', 'SHIPPER', 0, 0, HOUR, 0, { packets: null }),
    S('INT-J', 'AWAITING_ANALYSIS', 'CARRIER', 0, 0, HOUR, 0, { packets: null }),
  ], NOW);
  ids = Object.fromEntries(ins.map((x) => [x.spec.num, x.id]));
}
beforeAll(async () => {
  app = await buildTestApp();
  A = await I.fixtureTenant(app, 'intel-fixture-a', 'Intel Fixture A (synthetic)');
  B = await I.fixtureTenant(app, 'intel-fixture-b', 'Intel Fixture B (synthetic)');
  SS = await I.seededOn(app);
  for (const r of Object.keys(SS) as RoleName[]) SS[r] = I.recorded(SS[r]);
  await seedA();
}, 300000);
afterAll(async () => { try { await I.resetFlags(); I.assertHonest('intel-worklist'); } finally { await closeApps(); reseed(); } });

const list = async (s: Session, qs = '') => {
  const r = await s.get(`/intelligence/worklist${qs ? `?${qs}` : ''}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
};
const nums = (b: any) => b.items.map((x: any) => x.claim.claimNumber);

describe('T-WORK-01 exact order and values (W=25)', () => {
  it('ranks the six eligible claims by the integer formula and the documented tie-breaks', async () => {
    const b = await list(A.manager);
    expect(Object.keys(b).sort()).toEqual(['formula', 'generatedAt', 'items', 'label', 'notRanked', 'page', 'pageSize', 'total']);
    expect(b.total).toBe(6);
    expect(nums(b)).toEqual(['INT-C', 'INT-H', 'INT-A', 'INT-B', 'INT-E', 'INT-D']);
    expect(b.items.map((x: any) => x.score.valueCents)).toEqual([100000, 100000, 100000, 100000, 2, 0]);
    expect(b.items.map((x: any) => x.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(b.notRanked).toEqual({ awaitingAnalysis: 2 });
    for (const n of ['INT-F', 'INT-G', 'INT-I', 'INT-J']) expect(nums(b)).not.toContain(n);
    expect(b.formula).toEqual({ version: 'priority-v1', pendingWeightPercent: 25 });
    expect(b.label).toBe(I.WORKLIST_NOTE(25));
    expect(b.items[0].claim.id).toBe(C1);
    expect(b.items[1].claim.id).toBe(C2);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(25);
  });
});

describe('T-WORK-02 explanations', () => {
  it('parts sum to the value; why lines, next actions, counts and waiting days are exact', async () => {
    const b = await list(A.manager);
    const by = Object.fromEntries(b.items.map((x: any) => [x.claim.claimNumber, x]));
    expect(by['INT-B'].score.parts).toEqual([
      { key: 'confirmed_recoverable', inputCents: 50000, weightPercent: 100, contributionCents: 50000 },
      { key: 'pending_review', inputCents: 200000, weightPercent: 25, contributionCents: 50000 },
    ]);
    for (const x of b.items) expect(x.score.parts.reduce((s: number, p: any) => s + p.contributionCents, 0), x.claim.claimNumber).toBe(x.score.valueCents);
    expect(by['INT-B'].why).toEqual(['Confirmed recoverable $500.00 (counted at 100%)', 'Pending human review $2,000.00 (counted at 25%)', '2 findings need human review before approval', 'Waiting 0 days (not part of the score)']);
    expect(by['INT-A'].why).toEqual(['Confirmed recoverable $1,000.00 (counted at 100%)', 'Waiting 1 day (not part of the score)']);
    expect(by['INT-C'].why).toEqual(['Confirmed recoverable $1,000.00 (counted at 100%)', 'Approved and waiting to be marked send-ready', 'Waiting 3 days (not part of the score)']);
    expect(by['INT-H'].why).toEqual(by['INT-C'].why);
    expect(by['INT-D'].why).toEqual(['Pending human review $0.03 (counted at 25%)', '1 finding needs human review before approval', 'Waiting 0 days (not part of the score)']);
    expect(by['INT-E'].why).toEqual(['Confirmed recoverable $0.01 (counted at 100%)', 'Pending human review $0.07 (counted at 25%)', '1 finding needs human review before approval', 'Waiting 0 days (not part of the score)']);
    expect(Object.fromEntries(b.items.map((x: any) => [x.claim.claimNumber, x.nextAction]))).toEqual({
      'INT-B': 'RESOLVE_FINDINGS', 'INT-D': 'RESOLVE_FINDINGS', 'INT-E': 'RESOLVE_FINDINGS', 'INT-A': 'REVIEW_AND_APPROVE', 'INT-C': 'MARK_SEND_READY', 'INT-H': 'MARK_SEND_READY',
    });
    expect(Object.fromEntries(b.items.map((x: any) => [x.claim.claimNumber, x.pendingFindingsCount]))).toEqual({ 'INT-B': 2, 'INT-D': 1, 'INT-E': 1, 'INT-A': 0, 'INT-C': 0, 'INT-H': 0 });
    expect(Object.fromEntries(b.items.map((x: any) => [x.claim.claimNumber, x.waitingDays]))).toEqual({ 'INT-B': 0, 'INT-D': 0, 'INT-E': 0, 'INT-A': 1, 'INT-C': 3, 'INT-H': 3 });
    for (const x of b.items) {
      expect(Object.keys(x).sort()).toEqual(['claim', 'nextAction', 'pendingFindingsCount', 'rank', 'score', 'waitingDays', 'waitingSince', 'why']);
      expect(x.claim.currency).toBe('USD');
      expect(x.score.version).toBe('priority-v1');
      expect(x.waitingSince).toBe(x.claim.updatedAt ?? x.waitingSince);
    }
  });
});

describe('T-WORK-03 weight knob', () => {
  it('W=0 and W=100 reorder as hand-computed and the label follows the instance', async () => {
    const a0 = await buildTestApp({ INTELLIGENCE_PENDING_WEIGHT_PERCENT: '0' });
    const b0 = await list(I.onApp(a0, A.manager));
    expect(nums(b0)).toEqual(['INT-C', 'INT-H', 'INT-A', 'INT-B', 'INT-E', 'INT-D']);
    expect(b0.items.map((x: any) => x.score.valueCents)).toEqual([100000, 100000, 100000, 50000, 1, 0]);
    expect(b0.formula.pendingWeightPercent).toBe(0);
    expect(b0.label).toBe(I.WORKLIST_NOTE(0));
    for (const x of b0.items.filter((y: any) => y.claim.pendingReviewCents > 0)) expect(x.why.some((w: string) => w.endsWith('(counted at 0%)') && w.startsWith('Pending human review')), x.claim.claimNumber).toBe(true);
    const a100 = await buildTestApp({ INTELLIGENCE_PENDING_WEIGHT_PERCENT: '100' });
    const b1 = await list(I.onApp(a100, A.manager));
    expect(nums(b1)).toEqual(['INT-B', 'INT-C', 'INT-H', 'INT-A', 'INT-E', 'INT-D']);
    expect(b1.items.map((x: any) => x.score.valueCents)).toEqual([250000, 100000, 100000, 100000, 8, 3]);
    expect(b1.formula.pendingWeightPercent).toBe(100);
    expect(b1.label).toBe(I.WORKLIST_NOTE(100));
  }, 60000);
});
describe('T-WORK-04 filters and pagination', () => {
  it('status and perspective filters rank within the filtered ordering; pages concatenate to the unpaged list', async () => {
    expect(nums(await list(A.manager, 'status=APPROVED'))).toEqual(['INT-C', 'INT-H']);
    const pr = await list(A.manager, 'status=PENDING_REVIEW');
    expect(nums(pr)).toEqual(['INT-A', 'INT-B', 'INT-E', 'INT-D']);
    expect(pr.total).toBe(4);
    expect(pr.items.map((x: any) => x.rank)).toEqual([1, 2, 3, 4]);
    expect(nums(await list(A.manager, 'status=PENDING_REVIEW,APPROVED'))).toEqual(nums(await list(A.manager)));
    expect(nums(await list(A.manager, 'perspective=SHIPPER'))).toEqual(['INT-A', 'INT-B']);
    expect(nums(await list(A.manager, 'perspective=CARRIER'))).toEqual(['INT-C', 'INT-H', 'INT-E', 'INT-D']);
    const all: string[] = [];
    const expectPages = [['INT-C', 'INT-H'], ['INT-A', 'INT-B'], ['INT-E', 'INT-D'], []];
    for (let p = 1; p <= 4; p++) {
      const b = await list(A.manager, `pageSize=2&page=${p}`);
      expect(nums(b), `page ${p}`).toEqual(expectPages[p - 1]);
      expect(b.total).toBe(6);
      expect(b.page).toBe(p);
      expect(b.pageSize).toBe(2);
      expect(b.items.map((x: any) => x.rank)).toEqual(expectPages[p - 1]!.map((_, i) => (p - 1) * 2 + i + 1));
      all.push(...nums(b));
    }
    expect(all).toEqual(nums(await list(A.manager)));
  });
});

describe('T-WORK-05 zero value included and last', () => {
  it('a claim worth nothing is listed after every other claim', async () => {
    const [k] = await I.insertClaims(A.id, A.ownerId, [{ num: 'INT-K', status: 'PENDING_REVIEW', perspective: 'SHIPPER', rec: 0, pend: 0, ageMs: HOUR, packets: [{ findings: [] }] }], NOW);
    try {
      const b = await list(A.manager);
      expect(b.total).toBe(7);
      expect(nums(b)).toEqual(['INT-C', 'INT-H', 'INT-A', 'INT-B', 'INT-E', 'INT-D', 'INT-K']);
      expect(b.items[6].score.valueCents).toBe(0);
      expect(b.items[5].score.valueCents).toBe(0);
    } finally {
      await I.removeClaims(A.id, [k!.id]);
    }
    expect((await list(A.manager)).total).toBe(6);
  });
});

describe('T-WORK-06 oracle on seeded data', () => {
  it('Acme and Globex managers: the response equals an independent computation from the public claim and packet APIs', async () => {
    await H.assertS3Reachable();
    const an = SS.ANALYST;
    const batch = await H.newBatch(an);
    const load = H.uniqLoad('WK');
    for (const [n, body] of [['invoice.txt', H.invoiceTxt(load)], ['rate_confirmation.txt', H.rateTxt(load)], ['bol.txt', H.bolTxt(load)]] as Array<[string, string]>) {
      const d = await H.putOk(an, batch, n, Buffer.from(body));
      expect(d.status, d.reviewReasons).toBe('ACCEPTED');
    }
    const cm = await H.commit(an, batch, 'SHIPPER');
    expect(cm.status, cm.text).toBe(200);
    const gx = I.recorded(I.onApp(app, await I.baseSession(I.GLOBEX.MANAGER)));
    for (const mgr of [SS.MANAGER, gx]) {
      const claims: any[] = [];
      for (let p = 1; p < 20; p++) {
        const r = await mgr.get(`/claims?pageSize=100&page=${p}`);
        expect(r.status).toBe(200);
        claims.push(...r.body.items);
        if (r.body.items.length < 100) break;
      }
      const eligible = claims.filter((c) => ['PENDING_REVIEW', 'APPROVED'].includes(c.status));
      const oc: I.OClaim[] = [];
      for (const c of eligible) {
        const pk = await mgr.get(`/claims/${c.id}/packet`);
        expect(pk.status).toBe(200);
        oc.push({ id: c.id, num: c.claimNumber, status: c.status, perspective: c.perspective, carrier: c.carrierName, rec: c.recoverableCents, pend: c.pendingReviewCents, updatedAt: Date.parse(c.updatedAt), pendingFindings: pk.body.findings.filter((f: any) => f.needsHumanReview).length, hasPacket: true, rules: [] });
      }
      const want = I.oraclePriority(oc, 25);
      const got: any[] = [];
      for (let p = 1; p < 20; p++) {
        const b = await list(mgr, `pageSize=100&page=${p}`);
        got.push(...b.items);
        if (p === 1) {
          expect(b.total).toBe(eligible.length);
          expect(b.notRanked.awaitingAnalysis).toBe(claims.filter((c) => c.status === 'AWAITING_ANALYSIS').length);
        }
        if (b.items.length < 100) break;
      }
      expect(got.length).toBe(want.length);
      got.forEach((g, i) => {
        expect(g.claim.id, `rank ${i + 1}`).toBe(want[i]!.id);
        expect(g.rank).toBe(want[i]!.rank);
        expect(g.score.valueCents).toBe(want[i]!.value);
        expect(g.score.parts).toEqual(want[i]!.parts);
        expect(g.pendingFindingsCount).toBe(want[i]!.pendingFindingsCount);
      });
    }
    expect((await list(SS.MANAGER)).notRanked.awaitingAnalysis).toBeGreaterThanOrEqual(1);
  }, 180000);
});

describe('T-WORK-07 randomized oracle', () => {
  it('300 random claims in fixture tenant B, with ties and amounts near 2^31', async () => {
    await I.clearTenantClaims(B.id);
    const rnd = I.rng(I.SEED);
    const amounts = [0, 0, 1, 50, 100, 5000, 100000, 250000, 4999999, 5000000, 2147483647, 2147483000];
    const ages = Array.from({ length: 25 }, () => rnd.int(90 * 24) * HOUR + 30 * 60_000);
    const statuses = ['PENDING_REVIEW', 'PENDING_REVIEW', 'APPROVED', 'APPROVED', 'REJECTED', 'SEND_READY', 'AWAITING_ANALYSIS'];
    const specs: I.ClaimSpec[] = Array.from({ length: 300 }, (_, i) => {
      const status = rnd.pick(statuses);
      return { num: `RND-${String(i).padStart(4, '0')}`, status, perspective: rnd.pick(['SHIPPER', 'CARRIER'] as const), rec: rnd.pick(amounts), pend: rnd.pick(amounts), ageMs: rnd.pick(ages), review: rnd.int(4), ...(status === 'AWAITING_ANALYSIS' ? { packets: null } : {}) };
    });
    await I.insertClaims(B.id, B.ownerId, specs, NOW);
    const oc = await I.loadOClaims(B.id);
    const want = I.oraclePriority(oc, 25);
    const got: any[] = [];
    for (let p = 1; p < 10; p++) {
      const b = await list(B.manager, `pageSize=100&page=${p}`);
      got.push(...b.items);
      if (p === 1) expect(b.total).toBe(want.length);
      if (b.items.length < 100) break;
    }
    expect(got.map((g) => g.claim.id)).toEqual(want.map((w) => w.id));
    got.forEach((g, i) => {
      expect(g.score.valueCents, `rank ${i + 1}`).toBe(want[i]!.value);
      expect(g.score.parts).toEqual(want[i]!.parts);
      expect(g.pendingFindingsCount).toBe(want[i]!.pendingFindingsCount);
    });
    expect(want.some((w) => w.value > 2 ** 31)).toBe(true);
    const again = await list(B.manager, 'pageSize=100&page=1');
    expect(again.items.map((x: any) => x.claim.id)).toEqual(got.slice(0, 100).map((g) => g.claim.id));
  }, 120000);
});

describe('T-WORK-08 tenant isolation', () => {
  it('each tenant sees only its own claims; foreign query keys and headers have no effect', async () => {
    const a = await list(A.manager, 'pageSize=100');
    const b = await list(B.manager, 'pageSize=100');
    expect(nums(a).every((n: string) => n.startsWith('INT-'))).toBe(true);
    expect(nums(b).every((n: string) => n.startsWith('RND-'))).toBe(true);
    const gx = I.recorded(I.onApp(app, await I.baseSession(I.GLOBEX.MANAGER)));
    for (const s of [SS.MANAGER, gx]) {
      const x = await list(s, 'pageSize=100');
      for (const n of nums(x)) expect(n.startsWith('INT-') || n.startsWith('RND-'), n).toBe(false);
    }
    expectError(await A.manager.get(`/intelligence/worklist?tenantId=${B.id}`), 400, 'validation_error');
    expectError(await A.manager.get('/intelligence/worklist?foo=1'), 400, 'validation_error');
    const plain = await A.manager.get('/intelligence/worklist');
    const hdr = await A.manager.get('/intelligence/worklist', { headers: { 'x-tenant-id': B.id } });
    const norm = (r: any) => I.stripReq({ ...r.body, generatedAt: undefined });
    expect(norm(hdr)).toEqual(norm(plain));
  });
});

describe('T-WORK-09 roles and flag', () => {
  it('all six tenant roles may read; platform roles may not; the flag hides the route', async () => {
    for (const s of [A.owner, SS.ADMIN, A.manager, SS.REVIEWER, A.analyst, A.viewer]) expect((await s.get('/intelligence/worklist')).status, s.email).toBe(200);
    expectError(await SS.PLATFORM_DEV.get('/intelligence/worklist'), 403, 'forbidden');
    expectError(await SS.SUPER_ADMIN.get('/intelligence/worklist'), 403, 'forbidden');
    expectError(await new Client(app).get('/intelligence/worklist'), 401, 'unauthenticated');
    const off = await buildTestApp({ FLAGS_CACHE_TTL_MS: '0' });
    const dev = I.onApp(off, SS.PLATFORM_DEV);
    await I.setFlag(dev, 'intelligence.worklist', false, 'acceptance worklist off');
    try {
      const unk = I.stripReq((await I.onApp(off, A.manager).get(`/claims/${I.RAND_UUID}`)).body);
      for (const s of [A.owner, A.manager, A.viewer, A.analyst, SS.ADMIN, SS.REVIEWER]) {
        const r = await I.onApp(off, s).get('/intelligence/worklist');
        expectError(r, 404, 'not_found');
        expect(I.stripReq(r.body)).toEqual(unk);
      }
    } finally {
      await I.setFlag(dev, 'intelligence.worklist', true, 'acceptance worklist on');
    }
  }, 60000);
});

describe('T-WORK-10 audit', () => {
  it('one successful call appends one intelligence.viewed event; rejected calls append none', async () => {
    const seq = await I.lastSeq(A.id);
    const r = await A.manager.get('/intelligence/worklist?pageSize=3');
    expect(r.status).toBe(200);
    const ev = await I.eventsSince(A.id, seq);
    expect(ev.map((e) => e.action)).toEqual(['intelligence.viewed']);
    expect(I.keysOf(ev[0]!.metadata)).toEqual(['kind', 'returned']);
    expect(ev[0]!.metadata).toEqual({ kind: 'worklist', returned: r.body.items.length });
    expect(ev[0]!.actor_id).toBe(A.manager.user.id);
    const s2 = await I.lastSeq(A.id);
    expectError(await A.manager.get('/intelligence/worklist?pageSize=0'), 400, 'validation_error');
    expectError(await A.manager.get(`/intelligence/worklist?x=1`), 400, 'validation_error');
    expect((await I.eventsSince(A.id, s2)).filter((e) => e.action === 'intelligence.viewed').length).toBe(0);
    const v = await A.owner.get('/audit/verify');
    expect(v.status).toBe(200);
    expect(v.body.valid).toBe(true);
  });
});

describe('T-WORK-11 resource safety', () => {
  it('2000 more eligible claims: one page of 100 in order, bounded; pageSize above 100 rejected', async () => {
    const rnd = I.rng(I.SEED + 11);
    const specs: I.ClaimSpec[] = Array.from({ length: 2000 }, (_, i) => ({ num: `BIG-${String(i).padStart(5, '0')}`, status: rnd.pick(['PENDING_REVIEW', 'APPROVED']), perspective: rnd.pick(['SHIPPER', 'CARRIER'] as const), rec: rnd.int(5) * 1000, pend: rnd.int(5) * 1000, ageMs: (1 + rnd.int(60)) * HOUR, review: rnd.int(2) }));
    await I.insertClaims(B.id, B.ownerId, specs, NOW);
    const want = I.oraclePriority(await I.loadOClaims(B.id), 25);
    const t0 = Date.now();
    const b = await list(B.manager, 'pageSize=100');
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(b.items.length).toBe(100);
    expect(b.total).toBe(want.length);
    expect(b.items.map((x: any) => x.claim.id)).toEqual(want.slice(0, 100).map((w) => w.id));
    const vals = b.items.map((x: any) => x.score.valueCents);
    expect(vals).toEqual([...vals].sort((x: number, y: number) => y - x));
    expectError(await B.manager.get('/intelligence/worklist?pageSize=101'), 400, 'validation_error');
  }, 180000);
});

describe('T-WORK-12 honesty', () => {
  it('no forbidden claims, the exact label, and no learned-sounding fields', async () => {
    const bodies = [await list(A.manager), await list(A.manager, 'status=APPROVED'), await list(A.manager, 'perspective=CARRIER&pageSize=2&page=2'), await list(B.manager, 'pageSize=100')];
    for (const b of bodies) {
      expect(I.HONEST_RE.test(JSON.stringify(b))).toBe(false);
      expect(b.label).toBe(I.WORKLIST_NOTE(25));
      const ks = I.allKeys(b);
      for (const k of ['probability', 'expected', 'accuracy', 'confidence', 'likelihood', 'predicted']) expect(ks.has(k), k).toBe(false);
      for (const it of b.items) {
        expect(Object.keys(it.score).sort()).toEqual(['parts', 'valueCents', 'version']);
        const withoutScore: any = { ...it };
        delete withoutScore.score;
        expect(I.allKeys(withoutScore).has('score'), 'score only as the documented object').toBe(false);
        expect(Object.keys(it.claim).sort()).toEqual(['assignee', 'carrierName', 'claimNumber', 'currency', 'id', 'latestPacket', 'loadNumber', 'perspective', 'pendingReviewCents', 'recoverableCents', 'status'].sort());
      }
    }
  });
});