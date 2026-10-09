/* eslint-disable */
// T7 (T-FLAG-01..11): feature flags. One file, serial; defaults are restored before and after.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, buildTestApp, closeApps, expectError, login, type RoleName, type Session } from './helpers/client.js';
import { appDb, inRollback, tryQuery, withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let dev: Session;
let claimId = '';
const K = 'intelligence.similar_claims';
const getFlags = async () => (await dev.get('/platform/flags')).body.items as any[];
const flag = async (key: string) => (await getFlags()).find((f) => f.key === key);
const flip = async (key: string, reason = 'acceptance flag flip') => {
  const f = await flag(key);
  const r = await I.put(dev, `/platform/flags/${key}`, { enabled: !f.enabled, expectedVersion: f.version, reason });
  return { r, before: f };
};

beforeAll(async () => {
  app = await buildTestApp({ FLAGS_CACHE_TTL_MS: '0' });
  SS = await I.seededOn(app);
  dev = SS.PLATFORM_DEV;
  claimId = (await SS.MANAGER.get('/claims?pageSize=1')).body.items[0].id;
  await I.resetFlags();
});
afterAll(async () => { try { await I.resetFlags(); I.assertHonest('dev-flags'); } finally { await closeApps(); } });

describe('T-FLAG-01 registry', () => {
  it('exactly three items ordered by key, with fixed descriptions and untouched defaults', async () => {
    const r = await dev.get('/platform/flags');
    expect(r.status).toBe(200);
    expect(r.body.items.map((f: any) => f.key)).toEqual([...I.FLAG_KEYS]);
    for (const f of r.body.items) {
      expect(Object.keys(f).sort()).toEqual(['defaultEnabled', 'description', 'enabled', 'key', 'lastReason', 'tenantVisible', 'updatedAt', 'updatedBy', 'version']);
      expect(f.description).toBe(I.FLAG_DESCRIPTIONS[f.key]);
      expect(f.defaultEnabled).toBe(true);
      expect(f.tenantVisible).toBe(true);
      expect(f.enabled).toBe(true);
      expect(f.version).toBe(1);
      expect(f.updatedAt).toBeNull();
      expect(f.updatedBy).toBeNull();
      expect(f.lastReason).toBeNull();
    }
  });
});

describe('T-FLAG-02 change', () => {
  it('a change bumps the version, records who and why, and is audited in the platform chain', async () => {
    const f0 = await flag(K);
    const seq = await I.lastSeq(null);
    const reason = 'disable for acceptance test';
    const r = await I.put(dev, `/platform/flags/${K}`, { enabled: false, expectedVersion: f0.version, reason });
    expect(r.status, r.text).toBe(200);
    expect(r.body.enabled).toBe(false);
    expect(r.body.version).toBe(f0.version + 1);
    expect(r.body.updatedBy).toEqual({ id: dev.user.id, name: dev.user.name });
    expect(r.body.lastReason).toBe(reason);
    expect(Math.abs(Date.now() - Date.parse(r.body.updatedAt))).toBeLessThan(30000);
    expect(await flag(K)).toEqual(r.body);
    const ev = (await I.eventsSince(null, seq)).filter((e) => e.action === 'platform.flag_changed');
    expect(ev.length).toBe(1);
    expect(ev[0]!.actor_id).toBe(dev.user.id);
    expect(I.keysOf(ev[0]!.metadata)).toEqual(['from', 'key', 'reason', 'to', 'version']);
    expect(ev[0]!.metadata).toEqual({ key: K, from: true, to: false, version: f0.version + 1, reason });
    const list = await SS.SUPER_ADMIN.get('/platform/audit/events?limit=5&action=platform.flag_changed');
    expect(list.status, list.text).toBe(200);
    expect(list.body.items[0].action).toBe('platform.flag_changed');
    expect(list.body.items[0].metadata.key).toBe(K);
    const v = await SS.SUPER_ADMIN.get('/platform/audit/verify');
    expect(v.body.valid).toBe(true);
    const back = await I.put(dev, `/platform/flags/${K}`, { enabled: true, expectedVersion: f0.version + 1, reason: 'restore after acceptance test' });
    expect(back.status).toBe(200);
    expect(back.body.version).toBe(f0.version + 2);
  });
});

describe('T-FLAG-03 optimistic concurrency', () => {
  it('a stale expectedVersion is a 409 stale_revision and changes nothing', async () => {
    const f = await flag(K);
    const seq = await I.lastSeq(null);
    const r = await I.put(dev, `/platform/flags/${K}`, { enabled: !f.enabled, expectedVersion: f.version - 1, reason: 'stale version probe' });
    expectError(r, 409, 'stale_revision');
    expect(await flag(K)).toEqual(f);
    expect((await I.eventsSince(null, seq)).filter((e) => e.action === 'platform.flag_changed').length).toBe(0);
  });
  it('two simultaneous writers with the same version: exactly one wins (5 rounds)', async () => {
    for (let round = 0; round < 5; round++) {
      const f = await flag(K);
      const body = { enabled: !f.enabled, expectedVersion: f.version, reason: `race round ${round} acceptance` };
      const res = await Promise.all([I.put(dev, `/platform/flags/${K}`, body), I.put(dev, `/platform/flags/${K}`, body)]);
      const st = res.map((x) => x.status).sort();
      expect(st, res.map((x) => x.text).join(' | ')).toEqual([200, 409]);
      expectError(res.find((x) => x.status === 409)!, 409, 'stale_revision');
      const after = await flag(K);
      expect(after.version).toBe(f.version + 1);
    }
    await I.resetFlags();
  }, 60000);
});

describe('T-FLAG-04 no-op', () => {
  it('writing the current value is a 409 conflict with no version change and no audit event', async () => {
    const f = await flag(K);
    const seq = await I.lastSeq(null);
    const r = await I.put(dev, `/platform/flags/${K}`, { enabled: f.enabled, expectedVersion: f.version, reason: 'no-op probe for test' });
    expectError(r, 409, 'conflict');
    expect((await flag(K)).version).toBe(f.version);
    expect((await I.eventsSince(null, seq)).filter((e) => e.action === 'platform.flag_changed').length).toBe(0);
  });
});

describe('T-FLAG-05 unknown keys', () => {
  it('cannot be created', async () => {
    for (const k of ['intelligence.nope', 'INTELLIGENCE.WORKLIST', '..%2Fadmin', 'x']) {
      const r = await I.put(dev, `/platform/flags/${k}`, { enabled: true, expectedVersion: 1, reason: 'unknown key probe' });
      expectError(r, 404, 'not_found');
    }
    const n = await withAdmin(async (c) => Number((await c.query(`select count(*)::int n from feature_flags`)).rows[0].n));
    expect(n).toBe(3);
  });
});

describe('T-FLAG-06 validation', () => {
  it('reason length bounds, trimming and hostile characters', async () => {
    const put = async (reason: string) => {
      const f = await flag(K);
      return I.put(dev, `/platform/flags/${K}`, { enabled: !f.enabled, expectedVersion: f.version, reason });
    };
    const r10 = await put('a'.repeat(10));
    expect(r10.status, r10.text).toBe(200);
    const r500 = await put('b'.repeat(500));
    expect(r500.status, r500.text).toBe(200);
    const rt = await put('   trim me please   ');
    expect(rt.status, rt.text).toBe(200);
    expect(rt.body.lastReason).toBe('trim me please');
    for (const bad of ['bidi \u202eoverride reason', 'control\u0007character reason', 'tab\tcharacter reason', 'x'.repeat(9), 'y'.repeat(501)]) expectError(await put(bad), 400, 'validation_error');
    await I.resetFlags();
  });
});

describe('T-FLAG-07 authorization and CSRF', () => {
  it('only PLATFORM_DEV may write; failures change nothing', async () => {
    const f = await flag(K);
    const seq = await I.lastSeq(null);
    const body = { enabled: !f.enabled, expectedVersion: f.version, reason: 'authorization probe reason' };
    for (const role of ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as RoleName[]) expectError(await I.put(SS[role], `/platform/flags/${K}`, body), 403, 'forbidden');
    expectError(await new Client(app).send('PUT', `/platform/flags/${K}`, { body }), 401, 'unauthenticated');
    expectError(await I.put(dev, `/platform/flags/${K}`, body, { csrf: false }), 403, 'csrf_failed');
    expectError(await I.put(dev, `/platform/flags/${K}`, body, { csrf: 'tamper' }), 403, 'csrf_failed');
    expectError(await I.put(dev, `/platform/flags/${K}`, body, { csrf: 'mismatch' }), 403, 'csrf_failed');
    expect(await flag(K)).toEqual(f);
    const ev = await I.eventsSince(null, seq);
    expect(ev.filter((e) => e.action === 'platform.flag_changed').length).toBe(0);
    for (const e of ev.filter((x) => x.action !== 'platform.dashboard_viewed')) expect(e.action).toBe('authz.denied'); // dashboard views come from this test's own flag reads
  });
});
describe('T-FLAG-08 effect on tenant routes', () => {
  const unknown = async (s: Session) => I.stripReq((await s.get(`/claims/${I.RAND_UUID}`)).body);
  const probes: Array<[string, (s: Session) => Promise<any>]> = [
    ['intelligence.worklist', (s) => s.get('/intelligence/worklist')],
    ['intelligence.similar_claims', (s) => s.get(`/claims/${claimId}/similar`)],
    ['intelligence.provenance', (s) => s.get(`/claims/${claimId}/provenance`)],
  ];
  it('switching a flag off hides exactly its own route for every tenant role, in every tenant', async () => {
    const roles: RoleName[] = ['OWNER', 'MANAGER', 'VIEWER', 'ANALYST'];
    const gx = I.onApp(app, await I.baseSession(I.GLOBEX.MANAGER));
    for (const [key] of probes) {
      await I.setFlag(dev, key, false, 'acceptance switch off');
      for (const role of roles) {
        for (const [k2, call] of probes) {
          const r = await call(SS[role]);
          if (k2 === key) {
            expectError(r, 404, 'not_found');
            expect(I.stripReq(r.body), `${role} ${k2} off is indistinguishable from unknown`).toEqual(await unknown(SS[role]));
          } else {
            expect(r.status, `${role} ${k2} (only ${key} is off)`).toBe(200);
          }
        }
      }
      const feats = (await SS.MANAGER.get('/features')).body.flags;
      expect(Object.keys(feats).sort()).toEqual([...I.FLAG_KEYS]);
      for (const k of I.FLAG_KEYS) expect(feats[k], k).toBe(k !== key);
      const probe = probes.find((p) => p[0] === key)![1];
      // the flag is global: a user of another tenant sees the same state
      const gxFeat = await gx.get('/features');
      expect(gxFeat.body.flags[key]).toBe(false);
      expect((await probe(SS.PLATFORM_DEV)).status).toBe(403);
      await I.setFlag(dev, key, true, 'acceptance switch on');
      for (const role of roles) expect((await probe(SS[role])).status, `${role} ${key} back on`).toBe(200);
    }
  }, 120000);
});

describe('T-FLAG-09 cache TTL', () => {
  it('the cache lags by at most TTL on another instance; the writing instance sees its own change at once', async () => {
    const A = await buildTestApp({ FLAGS_CACHE_TTL_MS: '0' });
    const B = await buildTestApp({ FLAGS_CACHE_TTL_MS: '2000' });
    const devA = I.onApp(A, SS.PLATFORM_DEV);
    const devB = I.onApp(B, SS.PLATFORM_DEV);
    const mgrA = I.onApp(A, SS.MANAGER);
    const mgrB = I.onApp(B, SS.MANAGER);
    const key = 'intelligence.provenance';
    const feat = async (s: Session) => (await s.get('/features')).body.flags[key];
    expect(await feat(mgrB)).toBe(true);
    const f = (await devA.get('/platform/flags')).body.items.find((x: any) => x.key === key);
    const t0 = Date.now();
    const r = await I.put(devA, `/platform/flags/${key}`, { enabled: false, expectedVersion: f.version, reason: 'cache ttl acceptance probe' });
    expect(r.status, r.text).toBe(200);
    expect(await feat(mgrA)).toBe(false);
    const seen = await I.waitFor(async () => (await feat(mgrB)) === false, 5000, 250);
    expect(seen).toBe(true);
    expect(Date.now() - t0).toBeLessThanOrEqual(2000 + 1500 + 1000);
    const f2 = (await devB.get('/platform/flags')).body.items.find((x: any) => x.key === key);
    const r2 = await I.put(devB, `/platform/flags/${key}`, { enabled: true, expectedVersion: f2.version, reason: 'cache ttl restore probe' });
    expect(r2.status, r2.text).toBe(200);
    expect(await feat(mgrB)).toBe(true);
    await I.resetFlags();
  }, 60000);
});

describe('T-FLAG-10 flags never gate security', () => {
  it('with all three flags off, authentication, claims, approvals, import, export and platform routes behave as before', async () => {
    for (const k of I.FLAG_KEYS) await I.setFlag(dev, k, false, 'acceptance all off probe');
    const viewer = await login(app, 'viewer@acme.test');
    expect((await viewer.get('/me')).status).toBe(200);
    const rf = await viewer.client.post('/auth/refresh', {});
    expect(rf.status, rf.text).toBe(200);
    const m = SS.MANAGER;
    expect((await m.get('/claims?pageSize=5')).status).toBe(200);
    expect((await m.get(`/claims/${claimId}`)).status).toBe(200);
    expect((await m.get(`/claims/${claimId}/packet`)).status).toBe(200);
    expect((await m.get('/approvals')).status).toBe(200);
    expect((await m.get('/imports')).status).toBe(200);
    expect((await m.get('/exports/claims?format=csv')).status).toBe(200);
    expect((await dev.get('/platform/pipeline')).status).toBe(200);
    expect((await dev.get('/platform/flags')).status).toBe(200);
    await I.resetFlags();
  }, 60000);
});

describe('T-FLAG-11 database guarantees', () => {
  const snapshot = () => withAdmin(async (c) => (await c.query(`select key, enabled, version, last_reason from feature_flags order by key`)).rows);
  it('the runtime role cannot change flags without system mode; system mode may only increment the version by one', async () => {
    const before = await snapshot();
    const a = await appDb();
    try {
      expect((await a.query(`select * from feature_flags`)).rows.length).toBe(3);
      const upd = await tryQuery(a, `update feature_flags set enabled = not enabled`);
      expect(upd.ok ? upd.rowCount : 0).toBe(0);
      expect((await tryQuery(a, `insert into feature_flags (key, enabled, version) values ('intelligence.extra', true, 1)`)).ok).toBe(false);
      const gone = await tryQuery(a, `delete from feature_flags`);
      expect(gone.ok ? gone.rowCount : 0).toBe(0);
      expect((await tryQuery(a, `truncate feature_flags`)).ok).toBe(false);
      expect(await snapshot()).toEqual(before);
      const sys = async (sql: string) => inRollback(a, async () => {
        await a.query(`select set_config('app.system','on',true)`);
        return tryQuery(a, sql);
      });
      expect((await sys(`update feature_flags set key = 'intelligence.other' where key = 'intelligence.worklist'`)).ok).toBe(false);
      expect((await sys(`update feature_flags set version = version + 2 where key = 'intelligence.worklist'`)).ok).toBe(false);
      const okInc = await sys(`update feature_flags set version = version + 1 where key = 'intelligence.worklist'`);
      expect(okInc.ok, okInc.error).toBe(true);
      expect(okInc.rowCount).toBe(1);
    } finally {
      await a.end();
    }
    await withAdmin(async (c) => {
      expect((await tryQuery(c, `delete from feature_flags`)).ok).toBe(false);
      expect((await tryQuery(c, `truncate feature_flags`)).ok).toBe(false);
    });
    expect(await snapshot()).toEqual(before);
  });
});