/* eslint-disable */
// REQ-20261010-step5-analysis: RBAC AN-R01, R02, R04, R05, R07, the P11 rate limit (T14) and concurrency
// AN-C01/C02 (test-spec T7, T9, T14; Part C P3, P4, P9, P11). The bulk parts of R03/R04 are [S] (skipped with
// ACC_SKIP_BULK=1 when the bulk feature is cut).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, type RoleName, type Session, buildTestApp, closeApps, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import * as H from './helpers/imp.js';
import * as K from './helpers/keys.js';
import { EXPECTED } from './helpers/matrix.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
const SS = {} as Record<RoleName, Session>;
let an: Session, rv: Session, owner: Session;
const ALLOWED: RoleName[] = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST'];
const DENIED: RoleName[] = ['VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN'];

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  for (const r of Object.keys(ACCOUNTS) as RoleName[]) SS[r] = await sessionFor(app, ACCOUNTS[r]);
  an = SS.ANALYST;
  rv = SS.REVIEWER;
  owner = SS.OWNER;
}, 180000);
afterAll(async () => { try { await K.revokeActive(owner); } finally { await closeApps(); reseed(); } });

describe('AN-R01/R02 single analyze by role', () => {
  it('AN-R01: OWNER, ADMIN, MANAGER, REVIEWER, ANALYST -> 201 on their own claim; the requester is the revision-1 author', async () => {
    for (const r of ALLOWED) {
      const c = await A.smallClaim(an, rv, `R1${r[0]}`);
      const res = await A.analyze(SS[r], c.claimId);
      expect(res.status, `${r}: ${res.text}`).toBe(201);
      expect((await A.packetRows(c.claimId)).map((x) => x.created_by_id)).toEqual([SS[r].user.id]);
    }
  });
  it('AN-R02: VIEWER, PLATFORM_DEV, SUPER_ADMIN -> 403 forbidden, no side effects, authz.denied for the tenant user', async () => {
    const c = await A.smallClaim(an, rv, 'R2');
    for (const r of DENIED) {
      const before = await A.snapshot(owner, c.claimId);
      const seq0 = await H.lastSeq(owner);
      A.expectExact(await A.analyze(SS[r], c.claimId), 403, 'forbidden', r);
      expect(await A.snapshot(owner, c.claimId), `${r}: no side effects`).toBe(before);
      const ev = await A.eventsSince(owner, seq0);
      expect(ev.filter((e) => e.action === 'claim.analyzed')).toEqual([]);
      if (r === 'VIEWER') expect(ev.filter((e) => e.action === 'authz.denied' && e.actor?.id === SS[r].user.id), 'VIEWER authz.denied').toHaveLength(1);
    }
    // 403 precedes 400/404 (P3): a VIEWER with a bad body or unknown id still gets 403
    A.expectExact(await A.analyze(SS.VIEWER, H.RAND_UUID, { x: 1 }), 403, 'forbidden', 'VIEWER bad body + unknown id');
  });
});

describe.skipIf(A.SKIP_BULK)('[S] AN-R03 bulk by role', () => {
  it('allowed roles 200, others 403', async () => {
    for (const r of ALLOWED) {
      const res = await A.bulk(SS[r], { limit: 1 });
      expect(res.status, `${r}: ${res.text}`).toBe(200);
    }
    for (const r of DENIED) A.expectExact(await A.bulk(SS[r], { limit: 1 }), 403, 'forbidden', r);
    // 403 precedes 400
    A.expectExact(await A.bulk(SS.VIEWER, { limit: 0 }), 403, 'forbidden', 'VIEWER invalid body');
  });
});

describe('AN-R04 API keys never analyze', () => {
  it('a key with all three scopes (created by OWNER): single route -> 403 forbidden, claim unchanged', async () => {
    const c = await A.smallClaim(an, rv, 'R4');
    const k = await K.mkKey(owner, [...K.SCOPES]);
    const before = await A.snapshot(owner, c.claimId);
    for (const body of [{}, undefined]) {
      const r = await K.keyReq(app, k.secret, 'POST', `/claims/${c.claimId}/analyze`, body === undefined ? {} : { body });
      A.expectExact(r, 403, 'forbidden', 'api key single');
    }
    if (!A.SKIP_BULK) A.expectExact(await K.keyReq(app, k.secret, 'POST', '/claims/analyze-awaiting', { body: { limit: 1 } }), 403, 'forbidden', '[S] api key bulk');
    expect(await A.snapshot(owner, c.claimId)).toBe(before);
    await K.revokeActive(owner);
  });
});

describe('AN-R05 /me permissions', () => {
  it('claims:analyze is listed exactly for OWNER, ADMIN, MANAGER, REVIEWER, ANALYST (and the oracle agrees)', async () => {
    for (const r of Object.keys(ACCOUNTS) as RoleName[]) {
      const me = await SS[r].get('/me');
      expect(me.status, me.text).toBe(200);
      expect(me.body.permissions.includes('claims:analyze'), r).toBe(ALLOWED.includes(r));
      expect(EXPECTED[r].includes('claims:analyze'), `oracle ${r}`).toBe(ALLOWED.includes(r));
    }
  });
});

describe('AN-R07 authentication and CSRF', () => {
  it('unauthenticated -> 401 on both routes; cookie-style request without a valid CSRF token -> 403 csrf_failed', async () => {
    const c = await A.smallClaim(an, rv, 'R7');
    const before = await A.snapshot(owner, c.claimId);
    const anon = new Client(app);
    const u1 = await anon.post(`/claims/${c.claimId}/analyze`, {});
    expect(u1.status, u1.text).toBe(401);
    for (const mode of [false, 'mismatch', 'tamper'] as const) {
      const r = await new Client(app).post(`/claims/${c.claimId}/analyze`, {}, { token: SS.MANAGER.token, csrf: mode });
      expect(r.status, `${mode}: ${r.text}`).toBe(403);
      expect(r.body.error.code).toBe('csrf_failed');
    }
    if (!A.SKIP_BULK) {
      expect((await anon.post('/claims/analyze-awaiting', {})).status).toBe(401);
      const b = await new Client(app).post('/claims/analyze-awaiting', {}, { token: SS.MANAGER.token, csrf: false });
      expect(b.status).toBe(403);
      expect(b.body.error.code).toBe('csrf_failed');
    }
    expect(await A.snapshot(owner, c.claimId)).toBe(before);
  });
});

describe('T14/P11 rate limit group "analysis"', () => {
  it('RATE_LIMIT_ANALYSIS_MAX=2: the 3rd analyze request by one user -> 429 rate_limited with Retry-After (before 403/400); another user is not limited', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_ANALYSIS_MAX: '2', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const mm = await sessionFor(a, ACCOUNTS.MANAGER);
    const rr = await sessionFor(a, ACCOUNTS.REVIEWER);
    const vv = await sessionFor(a, ACCOUNTS.VIEWER);
    const s1 = await A.analyze(mm, H.RAND_UUID);
    const s2 = await A.analyze(mm, H.RAND_UUID);
    expect([s1.status, s2.status]).toEqual([404, 404]);
    const s3 = await A.analyze(mm, H.RAND_UUID, { x: 1 });
    A.expectExact(s3, 429, 'rate_limited', '3rd request');
    expect(Number(s3.headers['retry-after'])).toBeGreaterThan(0);
    if (!A.SKIP_BULK) A.expectExact(await A.bulk(mm, { limit: 1 }), 429, 'rate_limited', '[S] bulk shares the bucket');
    const other = await A.analyze(rr, H.RAND_UUID);
    expect(other.status, 'a different user is not limited').toBe(404);
    // 429 precedes 403: a VIEWER exhausting the bucket gets 429, not 403
    await A.analyze(vv, H.RAND_UUID);
    await A.analyze(vv, H.RAND_UUID);
    A.expectExact(await A.analyze(vv, H.RAND_UUID), 429, 'rate_limited', 'VIEWER 3rd');
  });
  it('.env.example documents RATE_LIMIT_ANALYSIS_MAX with a non-secret default', async () => {
    const { read } = await import('./helpers/sh.js');
    const ex = read('.env.example');
    expect(ex).toMatch(/RATE_LIMIT_ANALYSIS_MAX=\d+/);
  });
});

describe('AN-C01/C02 concurrent single analyze', () => {
  async function race(label: string) {
    const c = await A.smallClaim(an, rv, 'C');
    const v0 = (await A.dbClaim(c.claimId)).version;
    const seq0 = await H.lastSeq(owner);
    const rs = await Promise.all(ALLOWED.map((r) => A.analyze(SS[r], c.claimId)));
    for (const r of rs) expect(r.status, `${label}: ${r.text}`).not.toBe(500);
    const ok = rs.filter((r) => r.status === 201);
    expect(ok, `${label}: exactly one 201 (${rs.map((r) => r.status)})`).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 201)) A.expectExact(r, 409, 'invalid_state', label);
    const rows = await A.packetRows(c.claimId);
    expect(rows.map((x) => x.revision), `${label}: one packet`).toEqual([1]);
    expect((await A.dbClaim(c.claimId)).version, `${label}: version +1 once`).toBe(v0 + 1);
    const ev = (await A.eventsSince(owner, seq0, 'claim.analyzed')).filter((e) => e.targetId === c.claimId);
    expect(ev, `${label}: one claim.analyzed`).toHaveLength(1);
    const winner = ALLOWED[rs.findIndex((r) => r.status === 201)]!;
    expect(rows[0]!.created_by_id).toBe(SS[winner].user.id);
    expect(ev[0].actor.id).toBe(SS[winner].user.id);
    return winner;
  }
  it('AN-C01: 5 parallel analyzes by different users -> one 201, four 409, one packet, one event', async () => {
    await race('C01');
  }, 120000);
  it('AN-C02: amplified, 10 fresh claims', async () => {
    const winners: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      const w = await race(`C02 round ${i}`);
      winners[w] = (winners[w] ?? 0) + 1;
    }
    console.log(`[AN-C02] winners ${JSON.stringify(winners)}`);
    const v = await owner.get('/audit/verify');
    expect(v.body.valid).toBe(true);
  }, 600000);
});
