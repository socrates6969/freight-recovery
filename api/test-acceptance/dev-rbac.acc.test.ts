/* eslint-disable */
// T3 (T-RBAC-01..08): route x role matrix, evaluation order, /me, strict schemas, headers, rate limits, config knobs.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ROLES, Client, TENANT_ROLES, buildTestApp, closeApps, expectError, expectSecurityHeaders, type RoleName, type Session } from './helpers/client.js';
import { SECRETS, baseEnv } from './helpers/env.js';
import * as I from './helpers/intel.js';
import { EXPECTED } from './helpers/matrix.js';
import { prodEnv, startupError } from './helpers/prod.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
beforeAll(async () => {
  app = await buildTestApp();
  SS = await I.seededOn(app);
});
afterAll(async () => { try { I.assertHonest('dev-rbac'); } finally { await closeApps(); } });

const DEV: RoleName[] = ['PLATFORM_DEV'];
const BOTH: RoleName[] = ['PLATFORM_DEV', 'SUPER_ADMIN'];
const SUPER: RoleName[] = ['SUPER_ADMIN'];
const TENANT = TENANT_ROLES;
interface Rt { id: string; m: string; path: string; who: RoleName[]; ok: number; body?: unknown }
const ROUTES: Rt[] = [
  { id: 'R60', m: 'GET', path: '/platform/pipeline', who: BOTH, ok: 200 },
  { id: 'R61', m: 'GET', path: '/platform/telemetry', who: BOTH, ok: 200 },
  { id: 'R62', m: 'GET', path: '/platform/logs', who: DEV, ok: 200 },
  { id: 'R63', m: 'GET', path: '/platform/flags', who: DEV, ok: 200 },
  { id: 'R64', m: 'PUT', path: '/platform/flags/intelligence.nope', who: DEV, ok: 404, body: { enabled: true, expectedVersion: 1, reason: 'acceptance rbac probe' } },
  { id: 'R65', m: 'GET', path: '/platform/eval/runs', who: DEV, ok: 200 },
  { id: 'R66', m: 'GET', path: `/platform/eval/runs/${I.RAND_UUID}`, who: DEV, ok: 404 },
  { id: 'R67', m: 'GET', path: '/platform/audit/events', who: SUPER, ok: 200 },
  { id: 'R68', m: 'GET', path: '/platform/audit/verify', who: SUPER, ok: 200 },
  { id: 'R70', m: 'GET', path: '/features', who: TENANT, ok: 200 },
  { id: 'R71', m: 'GET', path: '/intelligence/worklist', who: TENANT, ok: 200 },
  { id: 'R72', m: 'GET', path: `/claims/${I.RAND_UUID}/similar`, who: TENANT, ok: 404 },
  { id: 'R73', m: 'GET', path: `/claims/${I.RAND_UUID}/provenance`, who: TENANT, ok: 404 },
];

describe('T-RBAC-01 route x role matrix', () => {
  for (const r of ROUTES) {
    it(`${r.id} ${r.m} ${r.path.replace(I.RAND_UUID, ':id')}`, async () => {
      for (const role of ALL_ROLES) {
        const res = await SS[role].as(r.m, r.path, r.body === undefined ? {} : { body: r.body });
        if (r.who.includes(role)) expect(res.status, `${r.id} ${role}: ${res.text}`).toBe(r.ok);
        else expectError(res, 403, 'forbidden');
      }
      const anon = new Client(app);
      const a = await anon.send(r.m, r.path, r.body === undefined ? {} : { body: r.body });
      expectError(a, 401, 'unauthenticated');
    }, 60000);
  }
});

describe('T-RBAC-02 evaluation order', () => {
  it('permission before validation; auth before validation; validation 400 with details', async () => {
    expectError(await SS.OWNER.get('/platform/pipeline?window=2h'), 403, 'forbidden');
    expectError(await new Client(app).get('/platform/pipeline?window=2h'), 401, 'unauthenticated');
    const bad = await SS.PLATFORM_DEV.get('/platform/pipeline?window=2h');
    expectError(bad, 400, 'validation_error');
    expect(bad.body.error.details, 'validation_error carries details').toBeTruthy();
  });
  it('R64: no CSRF header -> 403 csrf_failed; foreign Origin -> 403 origin_not_allowed', async () => {
    const body = { enabled: false, expectedVersion: 1, reason: 'acceptance csrf probe' };
    expectError(await I.put(SS.PLATFORM_DEV, '/platform/flags/intelligence.worklist', body, { csrf: false }), 403, 'csrf_failed');
    expectError(await I.put(SS.PLATFORM_DEV, '/platform/flags/intelligence.worklist', body, { headers: { origin: 'https://evil.example' } }), 403, 'origin_not_allowed');
  });
});

describe('T-RBAC-03 /me permissions', () => {
  it('every role lists exactly the oracle permission set (steps 1-3 plus the step 4 additions)', async () => {
    for (const role of ALL_ROLES) {
      const me = await SS[role].get('/me');
      expect(me.status).toBe(200);
      expect([...me.body.permissions].sort(), role).toEqual([...EXPECTED[role]].sort());
    }
  });
  it('named expectations', async () => {
    const perms = async (r: RoleName) => (await SS[r].get('/me')).body.permissions as string[];
    const dev = await perms('PLATFORM_DEV');
    for (const p of ['platform:health', 'platform:logs', 'platform:flags', 'platform:eval']) expect(dev).toContain(p);
    expect(dev).not.toContain('platform:audit');
    const sa = await perms('SUPER_ADMIN');
    expect(sa).toContain('platform:health');
    expect(sa).toContain('platform:audit');
    for (const p of ['platform:eval', 'platform:logs', 'platform:flags']) expect(sa).not.toContain(p);
    for (const r of TENANT) {
      const p = await perms(r);
      expect(p.some((x) => x.startsWith('platform:')), r).toBe(false);
      expect(p.includes('apikeys:manage'), `${r} apikeys:manage`).toBe(r === 'OWNER' || r === 'ADMIN');
    }
  });
});

describe('T-RBAC-04 strict schemas', () => {
  const dev = () => SS.PLATFORM_DEV;
  it('unknown query keys are rejected on every route that takes a query', async () => {
    const probes: Array<[RoleName, string]> = [['PLATFORM_DEV', '/platform/pipeline'], ['PLATFORM_DEV', '/platform/logs'], ['PLATFORM_DEV', '/platform/eval/runs'], ['SUPER_ADMIN', '/platform/audit/events'], ['MANAGER', '/intelligence/worklist'], ['MANAGER', `/claims/${I.RAND_UUID}/similar`]];
    for (const [role, p] of probes) expectError(await SS[role].get(`${p}?zzz=1`), 400, 'validation_error');
  });
  it('out-of-range query values', async () => {
    const cases: Array<[RoleName, string]> = [
      ['PLATFORM_DEV', '/platform/pipeline?window=48h'],
      ['PLATFORM_DEV', '/platform/logs?limit=0'], ['PLATFORM_DEV', '/platform/logs?limit=201'], ['PLATFORM_DEV', '/platform/logs?level=verbose'], ['PLATFORM_DEV', '/platform/logs?requestId=not-a-uuid'],
      ['PLATFORM_DEV', '/platform/eval/runs?limit=51'], ['PLATFORM_DEV', '/platform/eval/runs?limit=0'],
      ['MANAGER', '/intelligence/worklist?pageSize=0'], ['MANAGER', '/intelligence/worklist?pageSize=101'], ['MANAGER', '/intelligence/worklist?page=0'],
      ['MANAGER', '/intelligence/worklist?status=SEND_READY'], ['MANAGER', '/intelligence/worklist?status=PENDING_REVIEW,BOGUS'], ['MANAGER', '/intelligence/worklist?perspective=BOTH'],
      ['MANAGER', `/claims/${I.RAND_UUID}/similar?limit=0`], ['MANAGER', `/claims/${I.RAND_UUID}/similar?limit=11`],
    ];
    for (const [role, p] of cases) expectError(await SS[role].get(p), 400, 'validation_error');
  });
  it('R64 bodies', async () => {
    const ok = { enabled: false, expectedVersion: 1, reason: 'acceptance validation probe' };
    const bodies: Array<[string, unknown]> = [
      ['missing expectedVersion', { enabled: false, reason: ok.reason }],
      ['negative version', { ...ok, expectedVersion: -1 }],
      ['non-boolean enabled', { ...ok, enabled: 'yes' }],
      ['extra key tenantId', { ...ok, tenantId: I.RAND_UUID }],
      ['reason 9 chars', { ...ok, reason: 'x'.repeat(9) }],
      ['reason 501 chars', { ...ok, reason: 'x'.repeat(501) }],
      ['reason with newline', { ...ok, reason: 'first line\nsecond line' }],
    ];
    for (const [label, b] of bodies) expectError(await I.put(dev(), '/platform/flags/intelligence.worklist', b), 400, 'validation_error');
  });
});

describe('T-RBAC-05 headers', () => {
  it('200 and error responses carry the C1 header set; preflight gets no permissive answer', async () => {
    const probes: Array<[RoleName, string]> = [
      ['PLATFORM_DEV', '/platform/pipeline'], ['PLATFORM_DEV', '/platform/logs'], ['PLATFORM_DEV', '/platform/flags'], ['PLATFORM_DEV', '/platform/eval/runs'],
      ['SUPER_ADMIN', '/platform/audit/events'], ['MANAGER', '/features'], ['MANAGER', '/intelligence/worklist'], ['MANAGER', `/claims/${I.RAND_UUID}/similar`], ['MANAGER', `/claims/${I.RAND_UUID}/provenance`],
    ];
    for (const [role, p] of probes) {
      const ok = await SS[role].get(p);
      expectSecurityHeaders(ok, { hsts: null });
      const denied = await SS[role === 'MANAGER' ? 'PLATFORM_DEV' : 'MANAGER'].get(p);
      expect(denied.status).toBe(403);
      expectSecurityHeaders(denied, { hsts: null });
    }
    for (const p of ['/platform/pipeline', '/intelligence/worklist']) {
      const pre = await new Client(app).send('OPTIONS', p, { headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
      for (const k of Object.keys(pre.headers)) expect(k.toLowerCase().startsWith('access-control-'), `${p}: ${k}`).toBe(false);
    }
  });
});

describe('T-RBAC-06 rate limits', () => {
  it('RATE_LIMIT_PLATFORM_MAX=3: the 4th R60 by the same user -> 429 with integer Retry-After; another user unaffected', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_PLATFORM_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const sup = I.onApp(a, SS.SUPER_ADMIN);
    for (let i = 0; i < 3; i++) expect((await dev.get('/platform/pipeline')).status).toBe(200);
    const r = await dev.get('/platform/pipeline');
    expectError(r, 429, 'rate_limited');
    expect(r.headers['retry-after']).toMatch(/^\d+$/);
    expect((await sup.get('/platform/pipeline')).status).toBe(200);
  });
  it('RATE_LIMIT_INTELLIGENCE_MAX=2: the 3rd R71 by the same user -> 429; a different user is unaffected', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_INTELLIGENCE_MAX: '2', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const mgr = I.onApp(a, SS.MANAGER);
    const vw = I.onApp(a, SS.VIEWER);
    for (let i = 0; i < 2; i++) expect((await mgr.get('/intelligence/worklist')).status).toBe(200);
    const r = await mgr.get('/intelligence/worklist');
    expectError(r, 429, 'rate_limited');
    expect(r.headers['retry-after']).toMatch(/^\d+$/);
    expect((await vw.get('/intelligence/worklist')).status).toBe(200);
  });
});

describe('T-RBAC-07 configuration knobs', () => {
  const secrets = Object.values(SECRETS).filter((s) => s.length >= 8).concat(['local-dev-only']);
  const bad: Array<[string, Record<string, string>]> = [
    ['LOG_BUFFER_SIZE=10', { LOG_BUFFER_SIZE: '10' }], ['LOG_BUFFER_SIZE=5001', { LOG_BUFFER_SIZE: '5001' }],
    ['FLAGS_CACHE_TTL_MS=-1', { FLAGS_CACHE_TTL_MS: '-1' }], ['FLAGS_CACHE_TTL_MS=60001', { FLAGS_CACHE_TTL_MS: '60001' }],
    ['INTELLIGENCE_PENDING_WEIGHT_PERCENT=101', { INTELLIGENCE_PENDING_WEIGHT_PERCENT: '101' }], ['INTELLIGENCE_PENDING_WEIGHT_PERCENT=-1', { INTELLIGENCE_PENDING_WEIGHT_PERCENT: '-1' }],
    ['INTELLIGENCE_PENDING_WEIGHT_PERCENT=2.5', { INTELLIGENCE_PENDING_WEIGHT_PERCENT: '2.5' }],
    ['SIMILAR_CANDIDATE_LIMIT=9', { SIMILAR_CANDIDATE_LIMIT: '9' }], ['SIMILAR_CANDIDATE_LIMIT=2001', { SIMILAR_CANDIDATE_LIMIT: '2001' }],
    ['RATE_LIMIT_PLATFORM_MAX=0', { RATE_LIMIT_PLATFORM_MAX: '0' }],
  ];
  for (const [label, patch] of bad) {
    it(`refuses to start: ${label}`, async () => {
      const err = await startupError(baseEnv(patch));
      expect(err, `${label} must be refused`).toBeTruthy();
      expect(err!.message).not.toBe('__TIMEOUT__');
      for (const s of secrets) expect(err!.message.includes(s), 'error leaks a secret').toBe(false);
    }, 40000);
  }
  const good: Array<Record<string, string>> = [
    { LOG_BUFFER_SIZE: '50' }, { LOG_BUFFER_SIZE: '5000' }, { FLAGS_CACHE_TTL_MS: '0' }, { FLAGS_CACHE_TTL_MS: '60000' },
    { INTELLIGENCE_PENDING_WEIGHT_PERCENT: '0' }, { INTELLIGENCE_PENDING_WEIGHT_PERCENT: '100' }, { SIMILAR_CANDIDATE_LIMIT: '10' }, { SIMILAR_CANDIDATE_LIMIT: '2000' },
  ];
  for (const patch of good) {
    it(`starts: ${JSON.stringify(patch)}`, async () => {
      const a = await buildTestApp(patch);
      expect((await a.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    }, 40000);
  }
  it('production ceiling: FLAGS_CACHE_TTL_MS=30001 is refused naming the variable; 30000 raises no complaint about it', async () => {
    // Production start-up is refused for MAIL_TRANSPORT in this build (see config suite), so the 30000 case is asserted
    // as: no complaint about FLAGS_CACHE_TTL_MS (ambiguity reported in test-plan.md).
    const over = await startupError({ ...prodEnv(), FLAGS_CACHE_TTL_MS: '30001' });
    expect(over, '30001 must be refused in production').toBeTruthy();
    expect(over!.message).toContain('FLAGS_CACHE_TTL_MS');
    const at = await startupError({ ...prodEnv(), FLAGS_CACHE_TTL_MS: '30000' });
    if (at) expect(at.message.includes('FLAGS_CACHE_TTL_MS'), `30000 must be acceptable: ${at.message.slice(0, 300)}`).toBe(false);
  }, 60000);
});

describe('T-RBAC-08 existing behavior unchanged', () => {
  it('R35/R36/R37 answer as before for all roles', async () => {
    for (const role of ALL_ROLES) {
      const h = await SS[role].get('/platform/health');
      if (role === 'PLATFORM_DEV' || role === 'SUPER_ADMIN') expect(h.status, role).toBe(200);
      else expectError(h, 403, 'forbidden');
      const t = await SS[role].get('/platform/tenants');
      if (role === 'SUPER_ADMIN') expect(t.status).toBe(200);
      else expectError(t, 403, 'forbidden');
    }
    const acme = (await SS.SUPER_ADMIN.get('/platform/tenants')).body.items.find((x: any) => /Acme/.test(x.name));
    for (const role of ALL_ROLES) {
      const r = await SS[role].get(`/platform/tenants/${acme.id}/claims?reason=acceptance+probe+reason`);
      if (role === 'SUPER_ADMIN') expect(r.status).toBe(200);
      else expectError(r, 403, 'forbidden');
    }
  });
});
