/* eslint-disable */
// Part 3: property-based invariants P1..P7 (seeded pseudo-random sequences of 200 operations).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Session, allAudit, buildTestApp, claimId, closeApps, sessionFor, strip } from './helpers/client.js';
import { RANK, has, type Role } from './helpers/matrix.js';
import { moneyFromFindings, validatePacket } from './helpers/packet.js';
import { reseed } from './helpers/seed.js';
import { newUser, uniq, userId } from './helpers/users.js';

const SEED = Number(process.env.ACC_SEED ?? 20261008);
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

let app: FastifyInstance;
let m: Session, owner: Session, gxm: Session, gxo: Session, admin: Session;
beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
  admin = await sessionFor(app, ACCOUNTS.ADMIN);
  gxm = await sessionFor(app, 'manager@globex.test');
  gxo = await sessionFor(app, 'owner@globex.test');
  console.log(`[invariants] base seed=${SEED}`);
});
afterAll(closeApps);

describe('P1 isolation', () => {
  it(`no cross-tenant identifiers in 200 random operations (seed ${SEED + 1})`, async () => {
    const r = rng(SEED + 1);
    const harvest = async (list: Session, users: Session) => {
      const claims = (await list.get('/claims?pageSize=100')).body.items;
      const us = (await users.get('/users?pageSize=100')).body.items;
      return {
        claims,
        tokens: new Set<string>([...claims.flatMap((c: any) => [c.id, c.claimNumber]), ...us.flatMap((u: any) => [u.id, u.email, u.name])].filter((s: string) => s && s.length >= 5)),
      };
    };
    const A = await harvest(m, owner);
    const G = await harvest(gxm, gxo);
    const aOnly = [...A.tokens].filter((t) => !G.tokens.has(t));
    const gOnly = [...G.tokens].filter((t) => !A.tokens.has(t));
    expect(aOnly.length).toBeGreaterThan(20);
    expect(gOnly.length).toBeGreaterThan(5);
    const actors: Array<[Session, string[], string[]]> = [[m, gOnly, A.claims.map((c: any) => c.id)], [owner, gOnly, A.claims.map((c: any) => c.id)], [gxm, aOnly, G.claims.map((c: any) => c.id)], [gxo, aOnly, G.claims.map((c: any) => c.id)]];
    for (let i = 0; i < 200; i++) {
      const [s, foreign, own] = pick(r, actors);
      const foreignIds = (s === m || s === owner ? G.claims : A.claims).map((c: any) => c.id);
      const op = Math.floor(r() * 7);
      let res;
      if (op === 0) res = await s.get(`/claims?pageSize=${1 + Math.floor(r() * 100)}&sort=${pick(r, ['createdAt', 'claimNumber', 'carrierName'])}:${pick(r, ['asc', 'desc'])}`);
      else if (op === 1) res = await s.get(`/claims/${pick(r, foreignIds)}`);
      else if (op === 2) res = await s.get(`/claims/${pick(r, own)}`);
      else if (op === 3) res = await s.get(`/claims/${pick(r, foreignIds)}/packet`);
      else if (op === 4) res = await s.get('/approvals?pageSize=100');
      else if (op === 5) res = await s.get(`/claims?q=${pick(r, ['CLM', 'GLX', 'acme', 'globex', 'LD-'])}&pageSize=100`);
      else res = s === owner || s === gxo ? await s.get('/audit/events?limit=100') : await s.get(`/claims/${pick(r, foreignIds)}`);
      for (const t of foreign) expect(res.text.includes(t), `seed ${SEED + 1} op#${i}: leaked ${t}`).toBe(false);
    }
  }, 180000);
});

interface Model { status: string; rev: number; pending: boolean }
describe('P2 state machine / P3 immutability / P4 money / P5 audit', () => {
  it(`200 random workflow operations obey the model (seed ${SEED + 2})`, async () => {
    reseed();
    app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
    m = await sessionFor(app, ACCOUNTS.MANAGER);
    owner = await sessionFor(app, ACCOUNTS.OWNER);
    const r = rng(SEED + 2);
    const nums = ['CLM-0003', 'CLM-0004', 'CLM-0013', 'CLM-0015', 'CLM-0019', 'CLM-0022'];
    const ids = new Map<string, string>();
    const model = new Map<string, Model>();
    const frozen = new Map<string, string>(); // `${claim}:${rev}` -> hash|letter|findings
    for (const n of nums) {
      const id = await claimId(m, n);
      ids.set(n, id);
      const p = (await m.get(`/claims/${id}/packet`)).body;
      model.set(n, { status: p.status, rev: p.revision, pending: p.findings.some((f: any) => f.needsHumanReview) });
    }
    const maxSeq = async () => (await owner.get('/audit/events?limit=1')).body.items[0]?.seq ?? 0;
    const tag = (i: number) => `seed ${SEED + 2} op#${i}`;
    for (let i = 0; i < 200; i++) {
      const n = pick(r, nums);
      const id = ids.get(n)!;
      const st = model.get(n)!;
      const action = pick(r, ['approve', 'reject', 'send', 'edit', 'approve', 'edit']);
      const useStale = r() < 0.2 && st.rev > 1;
      const rev = useStale ? st.rev - 1 : st.rev;
      const before = await maxSeq();
      let res: any;
      let expectStatus: number[] = [];
      let ok = false;
      if (action === 'edit') {
        res = await m.post(`/claims/${id}/packet/revisions`, { baseRevision: rev, demandLetter: `random letter ${uniq()}`, reason: 'property based edit reason' });
        if (useStale) expectStatus = [409];
        else if (st.status === 'SEND_READY') expectStatus = [409];
        else { expectStatus = [201]; ok = true; }
      } else {
        const path = action;
        const body: any = { packetRevision: rev, reason: 'property based action reason' };
        if (action === 'approve' && st.pending) body.acknowledgePendingFindings = true;
        res = await m.post(`/claims/${id}/packet/${path}`, body);
        const okState = action === 'send' ? st.status === 'APPROVED' : st.status === 'PENDING_REVIEW';
        if (useStale || !okState) { expectStatus = [409]; } else { expectStatus = [200]; ok = true; }
      }
      expect(expectStatus, `${tag(i)} ${action} on ${n} (model ${JSON.stringify(st)} stale=${useStale}) got ${res.status} ${res.text}`).toContain(res.status);
      const after = await maxSeq();
      expect(after - before, `${tag(i)} P5 audit delta for ${action} status ${res.status}`).toBe(ok ? 1 : 0);
      if (ok) {
        if (action === 'edit') { st.rev += 1; st.status = 'PENDING_REVIEW'; }
        else st.status = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'SEND_READY';
      }
      // invariants over the whole claim
      const c = (await m.get(`/claims/${id}`)).body;
      const latest = (await m.get(`/claims/${id}/packet`)).body;
      validatePacket(latest);
      expect(latest.revision, tag(i)).toBe(st.rev);
      expect(latest.status, `${tag(i)} model`).toBe(st.status);
      expect(c.status, `${tag(i)} P2 claim.status == latest revision status`).toBe(latest.status);
      const live: string[] = [];
      for (let k = 1; k <= latest.revision; k++) {
        const pk = (await m.get(`/claims/${id}/packet?revision=${k}`)).body;
        expect(pk.revision, `${tag(i)} contiguous revisions`).toBe(k);
        if (pk.status !== 'SUPERSEDED') live.push(pk.status);
        else expect(k, `${tag(i)} only older revisions may be SUPERSEDED`).toBeLessThan(latest.revision);
        const fp = `${pk.integrity.contentHash}|${pk.demandLetter}|${JSON.stringify(pk.findings)}`;
        const key = `${n}:${k}`;
        if (frozen.has(key)) expect(fp, `${tag(i)} P3 revision ${key} immutable`).toBe(frozen.get(key));
        else frozen.set(key, fp);
        expect(pk.integrity.valid, `${tag(i)} integrity ${key}`).toBe(true);
        const { rec, pend } = moneyFromFindings(pk);
        expect(pk.recoverableCents, `${tag(i)} P4`).toBe(rec);
        expect(pk.pendingReviewCents, `${tag(i)} P4`).toBe(pend);
      }
      expect(live.length, `${tag(i)} exactly one live revision`).toBe(1);
    }
    expect((await owner.get('/audit/verify')).body.valid).toBe(true);
    // P4 across every claim
    for (const c of (await m.get('/claims?pageSize=100')).body.items) {
      const p = (await m.get(`/claims/${c.id}/packet`)).body;
      const { rec, pend } = moneyFromFindings(p);
      expect([c.recoverableCents, c.pendingReviewCents]).toEqual([rec, pend]);
      expect(c.recoverableCents).toBeGreaterThanOrEqual(0);
    }
  }, 900000);
});

describe('P6 authorization monotonicity', () => {
  it(`random role changes never enlarge the allowed route set beyond the matrix (seed ${SEED + 6})`, async () => {
    const rnd = rng(SEED + 6);
    const RAND = '00000000-0000-4000-8000-0000000000f1';
    const target = await newUser(app, owner, 'VIEWER');
    const tid = await userId(owner, target.email);
    const u = await (await import('./helpers/client.js')).login(app, target.email, target.password);
    const cid = await claimId(m, 'CLM-0010');
    const probes: Array<[string, string, string, () => unknown]> = [
      ['claims:read', 'GET', '/claims', () => undefined],
      ['claims:assign', 'POST', `/claims/${cid}/assign`, () => ({ assigneeId: RAND })],
      ['packets:edit', 'POST', `/claims/${cid}/packet/revisions`, () => ({ baseRevision: 9999, demandLetter: 'x', reason: 'monotonic probe reason' })],
      ['packets:approve', 'POST', `/claims/${cid}/packet/approve`, () => ({ packetRevision: 9999, reason: 'monotonic probe reason' })],
      ['demands:send', 'POST', `/claims/${cid}/packet/send`, () => ({ packetRevision: 9999, reason: 'monotonic probe reason' })],
      ['users:read', 'GET', '/users', () => undefined],
      ['users:manage', 'POST', `/users/${RAND}/disable`, () => ({ reason: 'monotonic probe reason' })],
      ['audit:read', 'GET', '/audit/events', () => undefined],
    ];
    const allowed = async () => {
      const set = new Set<string>();
      for (const [perm, method, path, body] of probes) {
        const res = await u.as(method, path, { body: body() });
        if (res.status !== 403 && res.status !== 401) set.add(perm);
        expect(res.status, `${perm}`).not.toBe(401);
      }
      return set;
    };
    let cur: Role = 'VIEWER';
    let prev = await allowed();
    for (let i = 0; i < 40; i++) {
      const next = pick(rnd, ['MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as Role[]);
      if (next === cur) continue;
      const ch = await owner.patch(`/users/${tid}/role`, { role: next, reason: `monotonic step ${i} ${uniq()}` });
      expect(ch.status, `seed ${SEED + 6} step ${i}: ${ch.text}`).toBe(200);
      const now = await allowed();
      const want = new Set(probes.map((p) => p[0]).filter((p) => has(next, p)));
      expect([...now].sort(), `seed ${SEED + 6} step ${i}: ${cur}->${next}`).toEqual([...want].sort());
      if (RANK[next]! < RANK[cur]!) for (const p of now) expect(prev.has(p), `monotonic: ${p} appeared after demotion ${cur}->${next}`).toBe(true);
      prev = now;
      cur = next;
    }
    void admin;
  }, 300000);
});

describe('P7 idempotence of reads', () => {
  it(`repeating any GET yields identical bodies (seed ${SEED + 7})`, async () => {
    const r = rng(SEED + 7);
    const list: any[] = (await m.get('/claims?pageSize=100')).body.items;
    const gets: Array<() => string> = [
      () => '/claims',
      () => `/claims?pageSize=${1 + Math.floor(r() * 50)}&sort=${pick(r, ['createdAt', 'claimNumber', 'status', 'recoverableCents'])}:${pick(r, ['asc', 'desc'])}`,
      () => `/claims?q=${pick(r, ['CLM', 'LD-', 'acme', 'zzz'])}`,
      () => `/claims/${pick(r, list).id}`,
      () => `/claims/${pick(r, list).id}/packet`,
      () => '/approvals?pageSize=100',
      () => `/approvals?status=${pick(r, ['APPROVED', 'PENDING_REVIEW'])}`,
    ];
    const scrub = (b: any) => JSON.parse(JSON.stringify(strip(b), (k, v) => (k === 'waitingSince' ? undefined : v)));
    const stateBefore = JSON.stringify(scrub((await m.get('/claims?pageSize=100')).body));
    for (let i = 0; i < 200; i++) {
      const p = pick(r, gets)();
      const a = await m.get(p);
      const b = await m.get(p);
      expect(a.status, `seed ${SEED + 7} op#${i} ${p}`).toBe(b.status);
      expect(scrub(a.body), `seed ${SEED + 7} op#${i} ${p}`).toEqual(scrub(b.body));
    }
    expect(JSON.stringify(scrub((await m.get('/claims?pageSize=100')).body))).toBe(stateBefore);
    const kinds = new Set((await allAudit(owner, 'action=packet.')).map((e) => e.action));
    expect([...kinds].every((k) => k === 'packet.viewed' || k === 'packet.revision_created')).toBe(true);
  }, 300000);
});