/**
 * Step 4 observability units (A4, A8.2, A8.4): metrics registry (buckets, nearest-rank upper bounds,
 * cardinality bound, method normalization), derived-log ring buffer (whitelist, message rule, hostile
 * lines) and the logger tee / serializers.
 */
import { Writable } from 'node:stream';

import { LogView, Telemetry } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import { createLogger, scrub, serializeReq, serializeRes } from '../src/logging.js';
import { DURATION_BOUNDS, MAX_ROUTE_KEYS, MetricsRegistry, ZERO_PARSER_COUNTERS } from '../src/observability/metrics.js';
import { LogRingBuffer, WITHHELD, deriveRecord, safeEvent } from '../src/observability/ring-buffer.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const START = new Date('2026-10-09T11:00:00.000Z');
const snap = (m: MetricsRegistry) =>
  m.snapshot({ parser: ZERO_PARSER_COUNTERS, flags: { 'priority-v1': true, 'similar-v1': false }, now: NOW, startedAt: START, version: '0.1.0', nodeVersion: 'v22' });

describe('MetricsRegistry', () => {
  it('buckets by first bound >= d, per-bucket counts, sums and nearest-rank upper bounds', () => {
    const m = new MetricsRegistry();
    for (const d of [1, 5, 5.0001, 10, 30, 99, 100, 101, 4000, 9999]) m.observeRequest({ method: 'GET', route: '/x', status: 200, durationMs: d });
    const s = snap(m);
    const r = s.routes[0];
    expect(r?.durationBuckets.map((b) => b.count)).toEqual([2, 2, 0, 1, 2, 1, 0, 0, 0, 1, 1]);
    expect(r?.durationBuckets.map((b) => b.leMs)).toEqual([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, null]);
    expect(r?.durationBuckets.reduce((a, b) => a + b.count, 0)).toBe(10);
    // p50: rank ceil(5) = 5 -> cumulative 2,4,4,5 -> bucket 50. p95: rank ceil(9.5) = 10 -> last (+Inf) -> null.
    expect(r?.p50UpperBoundMs).toBe(50);
    expect(r?.p95UpperBoundMs).toBeNull();
    expect(Telemetry.safeParse(s).success).toBe(true);
    expect(DURATION_BOUNDS).toHaveLength(11);
  });

  it('counts totals, status classes and 401/403/429; telemetry total equals the sum of route counts', () => {
    const m = new MetricsRegistry();
    const statuses = [200, 201, 304, 401, 403, 404, 429, 500, 503];
    statuses.forEach((st, i) => m.observeRequest({ method: 'GET', route: `/r${i % 3}`, status: st, durationMs: 1 }));
    const s = snap(m);
    expect(s.requests).toEqual({ total: 9, byStatusClass: { '2xx': 2, '3xx': 1, '4xx': 4, '5xx': 2 }, unauthenticated401: 1, forbidden403: 1, rateLimited429: 1 });
    expect(s.routes.reduce((a, r) => a + r.count, 0)).toBe(9);
    for (const r of s.routes) {
      expect(Object.values(r.byStatusClass).reduce((a, b) => a + b, 0)).toBe(r.count);
    }
    expect(s.instance.uptimeSeconds).toBe(3600);
  });

  it('bounds cardinality: random routes and methods produce at most 200 entries', () => {
    const m = new MetricsRegistry();
    for (let i = 0; i < 5000; i += 1) m.observeRequest({ method: i % 2 ? `X${i}` : 'GET', route: `/random/${i}`, status: 404, durationMs: 1 });
    m.observeRequest({ method: 'BREW', route: '(unmatched)', status: 404, durationMs: 1 });
    const s = snap(m);
    expect(s.routes.length).toBeLessThanOrEqual(200);
    expect(s.routes.length).toBe(MAX_ROUTE_KEYS + 1);
    expect(s.routes.some((r) => r.route === '(other)' && r.method === 'ANY')).toBe(true);
    expect(s.routes.every((r) => ['GET', 'OTHER', 'ANY'].includes(r.method))).toBe(true);
    expect(s.requests.total).toBe(5001);
    expect(Telemetry.safeParse(s).success).toBe(true);
  });

  it('sorts routes by count desc, then route asc, then method asc', () => {
    const m = new MetricsRegistry();
    for (const [method, route, n] of [['GET', '/b', 2], ['POST', '/a', 2], ['GET', '/a', 2], ['GET', '/c', 5]] as const) {
      for (let i = 0; i < n; i += 1) m.observeRequest({ method, route, status: 200, durationMs: 1 });
    }
    expect(snap(m).routes.map((r) => `${r.method} ${r.route}`)).toEqual(['GET /c', 'GET /a', 'POST /a', 'GET /b']);
  });

  it('components: fixed rules, no learned model, calls/errors, avg candidates only for similar-v1', () => {
    const m = new MetricsRegistry();
    m.observeComponent('priority-v1', { durationMs: 3, error: false });
    m.observeComponent('priority-v1', { durationMs: 30, error: true });
    m.observeComponent('similar-v1', { durationMs: 7, error: false, candidates: 10 });
    m.observeComponent('similar-v1', { durationMs: 7, error: false, candidates: 21 });
    const c = snap(m).components;
    expect(c.map((x) => [x.id, x.method, x.learnedModel, x.enabled, x.calls, x.errors])).toEqual([
      ['priority-v1', 'fixed_rules', false, true, 2, 1],
      ['similar-v1', 'fixed_rules', false, false, 2, 0],
    ]);
    expect(c[0]?.avgCandidatesConsidered).toBeNull();
    expect(c[1]?.avgCandidatesConsidered).toBe(15.5);
    expect(c[0]?.p50UpperBoundMs).toBe(5);
  });

  it('parser average queue wait is null without jobs', () => {
    const m = new MetricsRegistry();
    expect(snap(m).parser.avgQueueWaitMs).toBeNull();
    const s = m.snapshot({ parser: { ...ZERO_PARSER_COUNTERS, jobs: 4, queueWaitMs: 10 }, flags: { 'priority-v1': true, 'similar-v1': true }, now: NOW, startedAt: START, version: 'v', nodeVersion: 'n' });
    expect(s.parser.avgQueueWaitMs).toBe(2.5);
  });
});

const line = (o: Record<string, unknown>) => JSON.stringify({ level: 30, time: '2026-10-09T12:00:00.000Z', msg: 'request completed', ...o });
const RID = '0b6f4a4e-7a59-4c8d-9b7a-1f2e3d4c5b6a';

describe('LogRingBuffer and the message rule', () => {
  it('keeps only the eight whitelisted, validated fields', () => {
    const rec = deriveRecord(
      JSON.parse(
        line({
          res: { requestId: RID, method: 'GET', route: '/api/v1/claims/:id', statusCode: 200, durationMs: 1.25, path: '/api/v1/claims/123?q=x' },
          req: { headers: { authorization: 'Bearer x' } },
          tenantId: 'secret-tenant',
          email: 'a@b.c',
        }),
      ),
    );
    expect(rec).toEqual({ time: '2026-10-09T12:00:00.000Z', level: 'info', requestId: RID, method: 'GET', route: '/api/v1/claims/:id', statusCode: 200, durationMs: 1.25, event: 'request completed' });
  });

  it('withholds hostile messages', () => {
    for (const msg of [
      'user alice@example.com logged in',
      'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc',
      'hash 0123456789abcdef0123456789abcdef',
      `doc ${RID} parsed`,
      'line1\nline2',
      'ansi \u001b[31mred',
      'bidi ‮evil',
      'x'.repeat(10000),
      'key fr_live_0123',
      '',
      '<script>',
    ]) {
      expect([msg.slice(0, 30), safeEvent(msg)]).toEqual([msg.slice(0, 30), WITHHELD]);
    }
    expect(safeEvent('parse job finished')).toBe('parse job finished');
    expect(safeEvent(42)).toBe(WITHHELD);
  });

  it('drops malformed lines, unknown levels and bad times; ignores prototype-pollution keys', () => {
    const ring = new LogRingBuffer(10);
    ring.ingest('not json\n{"level":30}\n');
    ring.ingest(JSON.stringify({ level: 35, time: '2026-10-09T12:00:00.000Z', msg: 'x' }));
    ring.ingest(JSON.stringify({ level: 30, time: 'yesterday', msg: 'x' }));
    ring.ingest('{"level":30,"time":"2026-10-09T12:00:00.000Z","msg":"ok","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    ring.ingest(line({ res: { statusCode: 9.9e300, durationMs: -1, method: 'BREW', route: '/a?b=c', requestId: 'not-uuid' } }));
    const { items } = ring.query({ level: 'trace', limit: 10 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ statusCode: null, durationMs: null, method: null, route: null, requestId: null });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    ring.ingest(undefined as unknown as string);
  });

  it('is bounded, newest first, filters by minimum level and exact request id', () => {
    const ring = new LogRingBuffer(3);
    for (let i = 0; i < 5; i += 1) ring.ingest(line({ level: i % 2 ? 50 : 30, msg: `event ${i}`, req: { requestId: i === 4 ? RID : undefined } }));
    const all = ring.query({ level: 'trace', limit: 100 });
    expect(all.items.map((r) => r.event)).toEqual(['event 4', 'event 3', 'event 2']);
    expect(ring.query({ level: 'error', limit: 100 }).items.map((r) => r.event)).toEqual(['event 3']);
    expect(ring.query({ level: 'trace', limit: 100, requestId: RID.toUpperCase() }).items.map((r) => r.event)).toEqual(['event 4']);
    expect(ring.query({ level: 'trace', limit: 1 }).items).toHaveLength(1);
    const view = { scope: 'this_instance_recent_window', bufferCapacity: 3, returned: all.items.length, oldestTime: all.oldestTime, items: all.items };
    expect(LogView.safeParse(view).success).toBe(true);
  });
});

describe('logger tee and serializers', () => {
  it('writes to the stream AND the ring; the ring never sees raw fields', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const ring = new LogRingBuffer(50);
    const log = createLogger('info', sink, ring);
    log.info({ res: { statusCode: 200, request: { id: RID, method: 'GET', url: '/a?token=x', routeOptions: { url: '/a' } } }, apiKey: 'fr_live_abc', note: 'key fr_live_0123456789abcdef_x' }, 'request completed');
    expect(lines.join('')).not.toContain('fr_live_');
    const items = ring.query({ level: 'info', limit: 10 }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ route: '/a', statusCode: 200, method: 'GET', requestId: RID, event: 'request completed' });
  });

  it('a throwing tee never breaks logging', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger('info', sink, {
      ingest() {
        throw new Error('boom');
      },
    });
    log.info('still logged');
    expect(lines.join('')).toContain('still logged');
  });

  it('serializeRes adds only the route pattern; key material is scrubbed from paths and strings', () => {
    expect(serializeRes({ statusCode: 200, elapsedTime: 2, request: { id: 'r', method: 'GET', url: '/x/1?q', routeOptions: { url: '/x/:id' } } })).toEqual({
      statusCode: 200,
      requestId: 'r',
      method: 'GET',
      path: '/x/1',
      route: '/x/:id',
      durationMs: 2,
    });
    expect(serializeReq({ id: 'r', method: 'GET', url: '/x/fr_live_0123456789abcdef_aaaa', ip: '1.1.1.1' })['path']).toBe('/x/[REDACTED]');
    expect(scrub({ a: { b: ['Bearer fr_live_0123456789abcdef_secretpart'] }, msg: 'fr_live_x' })).toEqual({ a: { b: ['Bearer [REDACTED]'] }, msg: '[REDACTED]' });
  });
});
