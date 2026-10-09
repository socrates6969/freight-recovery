/* eslint-disable */
// T5 (T-TEL-01..09): in-process telemetry; every scenario uses its own private instance.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';
import { REPO } from './helpers/sh.js';

let SS: Record<RoleName, Session>;
beforeAll(async () => {
  SS = await I.seededOn(await I.sharedApp());
});
afterAll(async () => { try { I.assertHonest('dev-telemetry'); } finally { await closeApps(); reseed(); } });

const get = (a: FastifyInstance, url: string) => a.inject({ method: 'GET', url });
const snap = async (s: Session) => {
  const r = await s.get('/platform/telemetry');
  expect(r.status, r.text).toBe(200);
  return r.body;
};
const sumRoutes = (t: any) => t.routes.reduce((a: number, r: any) => a + r.count, 0);

describe('T-TEL-01 exact counting by delta', () => {
  it('counts exactly the requests issued between two snapshots', async () => {
    const a = await buildTestApp();
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const owner = I.onApp(a, SS.OWNER);
    const s0 = await snap(dev);
    for (let i = 0; i < 3; i++) expect((await get(a, '/healthz')).statusCode).toBe(200);
    for (let i = 0; i < 2; i++) expect((await get(a, '/readyz')).statusCode).toBe(200);
    expect((await new Client(a).get('/claims')).status).toBe(401);
    expect((await owner.get('/platform/logs')).status).toBe(403);
    expect((await get(a, '/no-such-path-91')).statusCode).toBe(404);
    const s1 = await snap(dev);
    const d = (m: string, route: string) => I.countOf(s1, m, route) - I.countOf(s0, m, route);
    const dc = (m: string, route: string, cls: string) => I.classOf(s1, m, route, cls) - I.classOf(s0, m, route, cls);
    expect(d('GET', '/healthz')).toBe(3);
    expect(dc('GET', '/healthz', '2xx')).toBe(3);
    expect(d('GET', '/readyz')).toBe(2);
    expect(d('GET', '/api/v1/claims')).toBe(1);
    expect(dc('GET', '/api/v1/claims', '4xx')).toBe(1);
    expect(d('GET', '/api/v1/platform/logs')).toBe(1);
    expect(dc('GET', '/api/v1/platform/logs', '4xx')).toBe(1);
    expect(d('GET', '(unmatched)')).toBe(1);
    expect(dc('GET', '(unmatched)', '4xx')).toBe(1);
    expect(d('GET', '/api/v1/platform/telemetry')).toBe(1);
    expect(s1.requests.unauthenticated401 - s0.requests.unauthenticated401).toBe(1);
    expect(s1.requests.forbidden403 - s0.requests.forbidden403).toBe(1);
    expect(s1.requests.rateLimited429 - s0.requests.rateLimited429).toBe(0);
    expect(s1.requests.total - s0.requests.total).toBe(sumRoutes(s1) - sumRoutes(s0));
    expect(s1.requests.total - s0.requests.total).toBe(9);
  }, 60000);
});

describe('T-TEL-02 internal consistency', () => {
  it('buckets, percentiles, sums and ordering follow Q5.2', async () => {
    const a = await buildTestApp();
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const mgr = I.onApp(a, SS.MANAGER);
    for (let i = 0; i < 6; i++) { await get(a, '/healthz'); await mgr.get('/claims?pageSize=5'); }
    await mgr.get('/intelligence/worklist');
    await new Client(a).get('/claims');
    const t = await snap(dev);
    const cls = ['2xx', '3xx', '4xx', '5xx'];
    const total: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    for (const r of t.routes) {
      expect(cls.reduce((x, c) => x + r.byStatusClass[c], 0), `${r.method} ${r.route} classes`).toBe(r.count);
      expect(r.durationBuckets.map((b: any) => b.leMs)).toEqual(I.BOUNDS);
      expect(r.durationBuckets.reduce((x: number, b: any) => x + b.count, 0)).toBe(r.count);
      expect(r.p50UpperBoundMs).toBe(I.nearestRankBound(r.durationBuckets, r.count, 50));
      expect(r.p95UpperBoundMs).toBe(I.nearestRankBound(r.durationBuckets, r.count, 95));
      for (const c of cls) total[c]! += r.byStatusClass[c];
    }
    expect(t.requests.total).toBe(sumRoutes(t));
    expect(t.requests.byStatusClass).toEqual(total);
    const order = [...t.routes].sort((x: any, y: any) => y.count - x.count || (x.route < y.route ? -1 : x.route > y.route ? 1 : 0) || (x.method < y.method ? -1 : x.method > y.method ? 1 : 0));
    expect(t.routes.map((r: any) => `${r.method} ${r.route}`)).toEqual(order.map((r: any) => `${r.method} ${r.route}`));
    expect(t.components.map((c: any) => c.id)).toEqual(['priority-v1', 'similar-v1']);
    for (const c of t.components) {
      expect(c.durationBuckets.reduce((x: number, b: any) => x + b.count, 0)).toBe(c.calls);
      expect(c.p50UpperBoundMs).toBe(I.nearestRankBound(c.durationBuckets, c.calls, 50));
      expect(c.p95UpperBoundMs).toBe(I.nearestRankBound(c.durationBuckets, c.calls, 95));
    }
  }, 60000);
});

describe('T-TEL-03 route patterns only', () => {
  it('concrete ids, query strings and hostile paths never appear', async () => {
    const a = await buildTestApp();
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const mgr = I.onApp(a, SS.MANAGER);
    const id = (await mgr.get('/claims?pageSize=1')).body.items[0].id;
    const r = await mgr.get(`/claims/${id}?token=needle-q-77`);
    expect([200, 404]).toContain(r.status);
    await get(a, '/zz/needle-path-55@example.com');
    const rt = await dev.get('/platform/telemetry');
    expect(rt.text).toContain('/api/v1/claims/:id');
    for (const n of [id, 'needle-q-77', 'needle-path-55', 'example.com']) expect(rt.text.includes(n), n).toBe(false);
    expect(I.countOf(rt.body, 'GET', '(unmatched)')).toBeGreaterThanOrEqual(1);
  }, 60000);
});

describe('T-TEL-04 cardinality bound', () => {
  it('300 distinct unmatched URLs and unusual methods stay bounded', async () => {
    const a = await buildTestApp();
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    for (let i = 0; i < 300; i++) await get(a, `/zz/unmatched-${i}-${i * 7}`);
    for (const m of ['PROPFIND', 'TRACE', 'FOO']) {
      for (let i = 0; i < 10; i++) {
        try { await a.inject({ method: m as any, url: `/zz/odd-${i}` }); } catch { /* the framework may refuse unknown verbs */ }
      }
    }
    const t = await snap(dev);
    expect(t.routes.length).toBeLessThanOrEqual(200);
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'OTHER', 'ANY']);
    for (const r of t.routes) expect(allowed.has(r.method), r.method).toBe(true);
    const un = t.routes.filter((r: any) => r.route === '(unmatched)');
    expect(new Set(un.map((r: any) => r.method)).size).toBe(un.length);
    expect(un.reduce((x: number, r: any) => x + r.count, 0)).toBeGreaterThanOrEqual(300);
  }, 120000);
});
describe('T-TEL-05 components', () => {
  it('calls are counted at the scoring step; avgCandidatesConsidered is the mean of the returned values', async () => {
    const a = await buildTestApp({ FLAGS_CACHE_TTL_MS: '0' });
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const mgr = I.onApp(a, SS.MANAGER);
    const claim = (await mgr.get('/claims?pageSize=1')).body.items[0].id;
    const s0 = await snap(dev);
    const [p0, s0c] = s0.components;
    expect([p0.id, s0c.id]).toEqual(['priority-v1', 'similar-v1']);
    for (const c of s0.components) {
      expect(c.method).toBe('fixed_rules');
      expect(c.learnedModel).toBe(false);
      expect(c.enabled).toBe(true);
      expect(c.calls).toBe(0);
    }
    expect(s0c.avgCandidatesConsidered).toBeNull();
    for (let i = 0; i < 2; i++) expect((await mgr.get('/intelligence/worklist')).status).toBe(200);
    const cands: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await mgr.get(`/claims/${claim}/similar`);
      expect(r.status, r.text).toBe(200);
      cands.push(r.body.candidatesConsidered);
    }
    expectError(await mgr.get('/intelligence/worklist?pageSize=0'), 400, 'validation_error');
    expectError(await mgr.get(`/claims/${I.RAND_UUID}/similar`), 404, 'not_found');
    const s1 = await snap(dev);
    const [p1, q1] = s1.components;
    expect(p1.calls - p0.calls).toBe(2);
    expect(q1.calls - s0c.calls).toBe(3);
    expect(p1.errors - p0.errors).toBe(0);
    expect(q1.errors - s0c.errors).toBe(0);
    expect(p1.avgCandidatesConsidered).toBeNull();
    expect(Math.abs(q1.avgCandidatesConsidered - cands.reduce((x, y) => x + y, 0) / cands.length)).toBeLessThan(1e-9);
  }, 60000);
});

describe('T-TEL-06 parser counters', () => {
  it('one successful import job moves jobs and succeeded by exactly one', async () => {
    await H.assertS3Reachable();
    const a = await buildTestApp();
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const an = I.onApp(a, SS.ANALYST);
    const s0 = await snap(dev);
    expect(s0.parser).toEqual({ jobs: 0, succeeded: 0, rejected: 0, timeouts: 0, memoryKills: 0, failures: 0, busyRejections: 0, avgQueueWaitMs: null });
    const b = await H.newBatch(an);
    const bytes = readFileSync(resolve(REPO, 'tests', 'fixtures', 'ld5001', 'invoice.txt'));
    const up = await H.upload(an, b, 'invoice.txt', bytes);
    expect(up.status, up.text).toBe(201);
    const s1 = await snap(dev);
    expect(s1.parser.jobs - s0.parser.jobs).toBe(1);
    expect(s1.parser.succeeded - s0.parser.succeeded).toBe(1);
    for (const k of ['rejected', 'timeouts', 'memoryKills', 'failures', 'busyRejections']) expect(s1.parser[k], k).toBe(0);
  }, 60000);
});

describe('T-TEL-07 429 counting', () => {
  it('a rate-limited response is counted in requests.rateLimited429', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_PLATFORM_MAX: '2', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const sup = I.onApp(a, SS.SUPER_ADMIN);
    const s0 = await snap(sup);
    const st: number[] = [];
    for (let i = 0; i < 3; i++) st.push((await dev.get('/platform/pipeline')).status);
    expect(st).toEqual([200, 200, 429]);
    const s1 = await snap(sup);
    expect(s1.requests.rateLimited429 - s0.requests.rateLimited429).toBe(1);
  }, 60000);
});

describe('T-TEL-08 instance block', () => {
  it('start time, uptime, version, node version; instances are independent', async () => {
    const a = await buildTestApp();
    const b = await buildTestApp();
    const devA = I.onApp(a, SS.PLATFORM_DEV);
    const devB = I.onApp(b, SS.PLATFORM_DEV);
    for (let i = 0; i < 5; i++) await get(a, '/healthz');
    await I.sleep(1100);
    const ta = await snap(devA);
    const health = await devA.get('/platform/health');
    expect(Date.parse(ta.instance.startedAt)).toBeLessThanOrEqual(Date.parse(ta.generatedAt));
    expect(Math.abs(ta.instance.uptimeSeconds - (Date.parse(ta.generatedAt) - Date.parse(ta.instance.startedAt)) / 1000)).toBeLessThanOrEqual(2);
    expect(ta.instance.version).toBe(health.body.version);
    expect(ta.instance.nodeVersion).toMatch(/^v?\d+\.\d+\.\d+/);
    expect(ta.scope).toBe('this_instance_since_start');
    const tb = await snap(devB);
    expect(I.countOf(ta, 'GET', '/healthz')).toBe(5);
    expect(I.countOf(tb, 'GET', '/healthz')).toBe(0);
  }, 60000);
});

describe('T-TEL-09 audit and permission', () => {
  it('R61 is audited as a telemetry dashboard view; SUPER_ADMIN may read; tenant roles 403', async () => {
    const a = await buildTestApp();
    const dev = I.onApp(a, SS.PLATFORM_DEV);
    const sup = I.onApp(a, SS.SUPER_ADMIN);
    const seq = await I.lastSeq(null);
    expect((await dev.get('/platform/telemetry')).status).toBe(200);
    expect((await sup.get('/platform/telemetry')).status).toBe(200);
    const ev = await I.eventsSince(null, seq);
    expect(ev.map((e) => e.action)).toEqual(['platform.dashboard_viewed', 'platform.dashboard_viewed']);
    for (const e of ev) expect(e.metadata).toEqual({ section: 'telemetry' });
    expect(ev.map((e) => e.actor_role)).toEqual(['PLATFORM_DEV', 'SUPER_ADMIN']);
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as RoleName[]) expectError(await I.onApp(a, SS[role]).get('/platform/telemetry'), 403, 'forbidden');
  }, 60000);
});