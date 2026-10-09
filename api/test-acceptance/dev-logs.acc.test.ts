/* eslint-disable */
// T6 (T-LOG-01..09): bounded, filtered, per-instance log view. Every scenario runs on a private instance with LOG_LEVEL=trace.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import * as I from './helpers/intel.js';

let SS: Record<RoleName, Session>;
beforeAll(async () => {
  SS = await I.seededOn(await I.sharedApp());
});
afterAll(async () => { try { I.assertHonest('dev-logs'); } finally { await closeApps(); } });

const KEYS = ['time', 'level', 'requestId', 'method', 'route', 'statusCode', 'durationMs', 'event'];
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const view = async (dev: Session, qs = 'level=trace&limit=200') => {
  const r = await dev.get(`/platform/logs?${qs}`);
  expect(r.status, r.text).toBe(200);
  return r;
};
async function priv(overrides: Record<string, string> = {}) {
  const { app, lines } = await I.buildLogged(overrides);
  return { app, lines, dev: I.onApp(app, SS.PLATFORM_DEV), mgr: I.onApp(app, SS.MANAGER) };
}
const words = (n: number) => {
  let s = '';
  while (s.length < n) s += 'abcde ';
  s = s.slice(0, n);
  return s.endsWith(' ') ? s.slice(0, -1) + 'x' : s;
};

describe('T-LOG-01 shape', () => {
  it('items are newest first with exactly the eight documented keys', async () => {
    const { app, dev, mgr } = await priv();
    await mgr.get('/claims?pageSize=3');
    await mgr.get('/features');
    const r = await view(dev);
    const b = r.body;
    expect(b.scope).toBe('this_instance_recent_window');
    expect(b.bufferCapacity).toBe(500);
    expect(b.returned).toBe(b.items.length);
    expect(b.items.length).toBeLessThanOrEqual(200);
    expect(b.items.length).toBeGreaterThan(0);
    for (const it of b.items) {
      expect(Object.keys(it).sort()).toEqual([...KEYS].sort());
      expect(LEVELS).toContain(it.level);
      expect(Number.isNaN(Date.parse(it.time))).toBe(false);
    }
    for (let i = 1; i < b.items.length; i++) expect(Date.parse(b.items[i].time)).toBeLessThanOrEqual(Date.parse(b.items[i - 1].time));
    if (b.items.length < 200) expect(b.oldestTime).toBe(b.items[b.items.length - 1].time);
    const done = b.items.filter((x: any) => x.method !== null && x.statusCode !== null);
    expect(done.length).toBeGreaterThan(0);
    const claims = done.find((x: any) => x.route === '/api/v1/claims');
    expect(claims, 'request completion record with the route pattern').toBeTruthy();
    expect(claims.method).toBe('GET');
    expect(claims.statusCode).toBe(200);
    expect(claims.durationMs).toBeGreaterThanOrEqual(0);
    for (const x of done) expect(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(x.route ?? ''), `route pattern ${x.route}`).toBe(false);
    await app.close();
  });
});

describe('T-LOG-02 hostile messages via the application logger', () => {
  it('unsafe messages are withheld and never leak into another field', async () => {
    const { app, dev } = await priv();
    const L = app.log as any;
    const m80 = words(80);
    const m81 = words(81);
    const plan: Array<[() => void, string, string]> = [
      [() => L.info('request completed'), 'info', 'request completed'],
      [() => L.info('cache miss: key_a.b-c (retry 2/3)'), 'info', 'cache miss: key_a.b-c (retry 2/3)'],
      [() => L.info('user alice-9f@example.com failed login'), 'info', '(message withheld)'],
      [() => L.info('token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc'), 'info', '(message withheld)'],
      [() => L.info('id 3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f'), 'info', '(message withheld)'],
      [() => L.info('abcdefghijklmnopqrst'), 'info', '(message withheld)'],
      [() => L.info('abcdefghijklmnopqrs'), 'info', 'abcdefghijklmnopqrs'],
      [() => L.info('line1\nline2'), 'info', '(message withheld)'],
      [() => L.info('ansi \u001b[31mred'), 'info', '(message withheld)'],
      [() => L.info('bidi \u202eevil'), 'info', '(message withheld)'],
      [() => L.info(m80), 'info', m80],
      [() => L.info(m81), 'info', '(message withheld)'],
      [() => L.info('A'.repeat(10000)), 'info', '(message withheld)'],
      [() => L.info({ password: 'hunter2-needle-1', email: 'bob-needle-2@example.com', filename: 'secret-needle-3.pdf', token: 'needle-4-tok', userAgent: 'needle-5' }, 'ok'), 'info', 'ok'],
      [() => L.error(new Error('boom needle-6@example.com'), 'handler failed'), 'error', 'handler failed'],
      [() => L.warn('lvl warn record'), 'warn', 'lvl warn record'],
      [() => L.fatal('lvl fatal record'), 'fatal', 'lvl fatal record'],
      [() => L.debug('lvl debug record'), 'debug', 'lvl debug record'],
      [() => L.trace('lvl trace record'), 'trace', 'lvl trace record'],
    ];
    for (const [w] of plan) w();
    const r = await view(dev);
    const own = r.body.items.filter((x: any) => x.method === null && x.requestId === null).reverse();
    const got = own.map((x: any) => `${x.level}|${x.event}`);
    const want = plan.map(([, lvl, ev]) => `${lvl}|${ev}`);
    const idx = got.findIndex((_: string, i: number) => want.every((w, j) => got[i + j] === w));
    expect(idx, `expected contiguous sequence\n${want.join('\n')}\nbut got\n${got.join('\n')}`).toBeGreaterThanOrEqual(0);
    for (const n of ['needle-1', 'needle-2', 'needle-3', 'needle-4', 'needle-5', 'needle-6', 'hunter2', 'alice-9f', 'eyJhbGciOi', '3f2b8c1e', 'abcdefghijklmnopqrst', 'line1', 'AAAAAAAAAAAAAAAAAAAA', '\\u001b', '\u001b', '\u202e', '\\u202e']) {
      expect(r.text.includes(n), `body leaks ${JSON.stringify(n)}`).toBe(false);
    }
    await app.close();
  });
});

describe('T-LOG-03 real traffic does not leak', () => {
  it('queries, bodies, cookies, bearer tokens, forwarded addresses and hostile paths are absent', async () => {
    const { app, dev, mgr } = await priv();
    await mgr.get('/claims?q=needle-q-11');
    await new Client(app, '10.0.0.77').post('/auth/login', { email: 'needle-13@example.com', password: 'Needle-Pass-12!' });
    await app.inject({ method: 'GET', url: '/api/v1/claims', headers: { cookie: 'fr_rt=needle-cookie-14', authorization: 'Bearer needle-bearer-15', 'x-forwarded-for': '203.0.113.99' }, remoteAddress: '198.51.100.23' });
    await app.inject({ method: 'GET', url: '/api/v1/zz-needle-16@example.com' });
    const r = await view(dev);
    for (const n of ['needle-q-11', 'needle-13', 'Needle-Pass', 'needle-cookie-14', 'needle-bearer-15', 'needle-16', '203.0.113.99', '198.51.100.23', '10.0.0.77', '10.0.0.1', '?', 'Bearer', 'Set-Cookie', 'set-cookie']) {
      expect(r.text.includes(n), `body leaks ${n}`).toBe(false);
    }
    await app.close();
  });
});

describe('T-LOG-04 capacity', () => {
  it('LOG_BUFFER_SIZE=50 keeps only the newest 50 records', async () => {
    const { app, dev } = await priv({ LOG_BUFFER_SIZE: '50' });
    for (let i = 0; i < 120; i++) app.log.info(`rec-${i}`);
    const r = await view(dev);
    expect(r.body.bufferCapacity).toBe(50);
    expect(r.body.items.length).toBe(50);
    const ev = r.body.items.map((x: any) => x.event);
    expect(ev).toContain('rec-119');
    expect(ev).not.toContain('rec-0');
    await app.close();
  });
});
describe('T-LOG-05 level filter and limit', () => {
  it('minimum level is applied at read time; limit returns the newest matching', async () => {
    const { app, dev } = await priv();
    const L = app.log as any;
    L.trace('lvl-a trace'); L.debug('lvl-b debug'); L.info('lvl-c info'); L.warn('lvl-d warn'); L.error('lvl-e error'); L.fatal('lvl-f fatal');
    const warn = (await view(dev, 'level=warn&limit=200')).body.items;
    expect(warn.every((x: any) => ['warn', 'error', 'fatal'].includes(x.level))).toBe(true);
    for (const e of ['lvl-d warn', 'lvl-e error', 'lvl-f fatal']) expect(warn.map((x: any) => x.event)).toContain(e);
    expect(warn.map((x: any) => x.event)).not.toContain('lvl-c info');
    const fatal = (await view(dev, 'level=fatal&limit=200')).body.items;
    expect(fatal.every((x: any) => x.level === 'fatal')).toBe(true);
    expect(fatal.map((x: any) => x.event)).toContain('lvl-f fatal');
    const all = (await view(dev, 'level=trace&limit=200')).body.items;
    for (const e of ['lvl-a trace', 'lvl-b debug', 'lvl-c info', 'lvl-d warn', 'lvl-e error', 'lvl-f fatal']) expect(all.map((x: any) => x.event), e).toContain(e);
    const three = (await view(dev, 'level=trace&limit=3')).body;
    expect(three.items.length).toBe(3);
    expect(three.returned).toBe(3);
    L.fatal('fatal-1'); L.fatal('fatal-2');
    expect((await view(dev, 'level=fatal&limit=1')).body.items.map((x: any) => x.event)).toEqual(['fatal-2']);
    expect((await view(dev, 'level=fatal&limit=2')).body.items.map((x: any) => x.event)).toEqual(['fatal-2', 'fatal-1']);
    await app.close();
  });
});

describe('T-LOG-06 request id filter', () => {
  it('returns only that request, and nothing for an unknown id', async () => {
    const { app, dev, mgr } = await priv();
    const r0 = await mgr.get('/claims?pageSize=2');
    const rid = r0.headers['x-request-id'] as string;
    expect(rid).toBeTruthy();
    const hit = await view(dev, `level=trace&limit=200&requestId=${rid}`);
    expect(hit.body.items.length).toBeGreaterThanOrEqual(1);
    for (const x of hit.body.items) expect(x.requestId).toBe(rid);
    const none = await view(dev, `level=trace&limit=200&requestId=${I.RAND_UUID}`);
    expect(none.body.items).toEqual([]);
    expect(none.body.returned).toBe(0);
    await app.close();
  });
});

describe('T-LOG-07 scope', () => {
  it('a record written on one instance never appears on another', async () => {
    const A = await priv();
    const B = await priv();
    A.app.log.info('only-on-instance-a');
    expect((await view(A.dev)).body.items.map((x: any) => x.event)).toContain('only-on-instance-a');
    expect((await view(B.dev)).text.includes('only-on-instance-a')).toBe(false);
    await A.app.close();
    await B.app.close();
  });
});

describe('T-LOG-08 permission and audit', () => {
  it('only PLATFORM_DEV may read; each read is audited with level, limit and returned', async () => {
    const { app, dev } = await priv();
    for (const role of ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as RoleName[]) expectError(await I.onApp(app, SS[role]).get('/platform/logs'), 403, 'forbidden');
    for (const [qs, level, limit] of [['level=warn&limit=7', 'warn', 7], ['', 'info', 100], ['limit=5', 'info', 5]] as Array<[string, string, number]>) {
      const seq = await I.lastSeq(null);
      const r = await dev.get(`/platform/logs${qs ? `?${qs}` : ''}`);
      expect(r.status, r.text).toBe(200);
      const ev = (await I.eventsSince(null, seq)).filter((e) => e.action === 'platform.logs_viewed');
      expect(ev.length).toBe(1);
      expect(I.keysOf(ev[0]!.metadata)).toEqual(['level', 'limit', 'returned']);
      expect(ev[0]!.metadata).toEqual({ level, limit, returned: r.body.returned });
      expect(ev[0]!.actor_role).toBe('PLATFORM_DEV');
    }
    await app.close();
  });
});

describe('T-LOG-09 redaction regression', () => {
  it('the raw stream still redacts credentials and request lines carry no query string', async () => {
    const { app, lines, mgr } = await priv();
    const c = new Client(app, '10.0.0.78');
    const bad = await c.post('/auth/login', { email: 'owner@acme.test', password: 'Wrong-Regression-Pass-77!' });
    expect(bad.status).toBe(401);
    const res = await mgr.get('/claims?q=zzz9regression', { headers: { cookie: 'fr_rt=cookie-canary-42', 'x-csrf-token': 'csrf-canary-43' } });
    expect([200, 400, 403]).toContain(res.status);
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(5);
    for (const s of ['Wrong-Regression-Pass-77!', 'cookie-canary-42', 'csrf-canary-43', mgr.token, 'zzz9regression']) expect(all.includes(s), `raw log leaks ${s.slice(0, 12)}`).toBe(false);
    for (const l of lines) {
      const o = JSON.parse(l);
      const walk = (x: any) => {
        if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
          if (/^(authorization|cookie|set-cookie|x-csrf-token|password|token|accessToken|refreshToken)$/i.test(k) && typeof v === 'string') expect(v).toBe('[REDACTED]');
          walk(v);
        }
      };
      walk(o);
    }
    await app.close();
  });
});