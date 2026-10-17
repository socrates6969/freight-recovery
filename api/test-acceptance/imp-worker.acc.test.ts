/* eslint-disable */
// T-IMP-WORKER 1-5: parser isolation and limits (own apps: PARSE_TIMEOUT_MS=2500, PARSE_MEMORY_MB=128).
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';

const MS = 2500;
const ALLOWED = ['parse_timeout', 'parse_memory', 'text_too_large', 'malformed_pdf'];
const logLines: string[] = [];
let app: FastifyInstance, port = 0;
let an: Session, gx: Session;
const S = (s: string) => Buffer.from(s, 'utf8');

beforeAll(async () => {
  await H.assertS3Reachable();
  const logStream = new Writable({ write(chunk, _e, cb) { logLines.push(...String(chunk).split('\n').filter(Boolean)); cb(); } });
  app = await buildTestApp({ PARSE_TIMEOUT_MS: String(MS), PARSE_MEMORY_MB: '128', LOG_LEVEL: 'info' }, { logStream });
  port = await H.listen(app);
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  gx = H.wrap(await sessionFor(app, 'manager@globex.test'));
});
afterAll(async () => {
  try { H.assertRecorded('imp-worker'); } finally { await closeApps(); }
});

const bomb = (() => { let p: Promise<Buffer> | null = null; return () => (p ??= H.flateBombPdf()); })();
async function upBomb(s: Session, pdf: Buffer) {
  const b = await H.newBatch(s);
  const r = await H.upload(s, b, 'heavy' + b.slice(0, 4) + '.pdf', Buffer.concat([pdf, Buffer.from('% ' + b)]));
  return { b, r };
}
const expectRejected = (r: any, label: string) => {
  expect(r.status, `${label}: ${r.text.slice(0, 200)}`).toBe(201);
  expect(r.body.status, label).toBe('REJECTED');
  expect(ALLOWED, `${label}: ${r.body.rejectReason}`).toContain(r.body.rejectReason);
  expect(r.ms, label).toBeLessThanOrEqual(MS + 5000);
};

describe('T-IMP-WORKER 1 resource-bomb PDFs', () => {
  it('flate bomb, 20 nested filters and a 5000-deep tree are REJECTED with an allowed reason within PARSE_TIMEOUT_MS + 5 s', async () => {
    const cases: [string, Buffer][] = [['flate bomb', await bomb()], ['nested filters', await H.nestedFlatePdf(20)], ['deep tree', H.deepKidsPdf(5000)]];
    for (const [label, pdf] of cases) {
      const { r } = await upBomb(an, pdf);
      expectRejected(r, label);
    }
  }, 180000);
});

describe('T-IMP-WORKER 2 isolation from the event loop and other tenants', () => {
  it('during a hostile parse /healthz stays 200 (p95 < 1 s) and another tenant upload completes < 5 s', async () => {
    const pdf = await bomb();
    const b = await H.newBatch(an);
    const hostile = H.upload(an, b, 'bomb.pdf', pdf);
    const lat: number[] = [];
    let stop = false;
    const poll = (async () => {
      while (!stop) {
        const r = await H.rawHttp(port, { path: '/healthz', timeoutMs: 5000 });
        expect(r.status).toBe(200);
        lat.push(r.ms);
        await H.sleep(200);
      }
    })();
    await H.sleep(300);
    const gb = await H.newBatch(gx);
    const t0 = Date.now();
    const other = await H.upload(gx, gb, 'ok.txt', S(H.bolTxt(H.uniqLoad('WK'))));
    const otherMs = Date.now() - t0;
    const h = await hostile;
    stop = true;
    await poll;
    expect(other.status, other.text).toBe(201);
    expect(otherMs).toBeLessThan(5000);
    expect(h.status).toBe(201);
    lat.sort((x, y) => x - y);
    expect(lat.length).toBeGreaterThan(0);
    expect(lat[Math.floor(lat.length * 0.95) - 1] ?? lat[lat.length - 1]!, `healthz latencies ${lat.join(',')}`).toBeLessThan(1000);
  }, 120000);
});

describe('T-IMP-WORKER 3 parse concurrency and queue timeout', () => {
  it('PARSE_MAX_CONCURRENCY=1, PARSE_QUEUE_TIMEOUT_MS=200: 3 simultaneous bombs -> >= 1 parser_busy with integer Retry-After, no stray rows/objects', async () => {
    const a = await buildTestApp({ PARSE_TIMEOUT_MS: String(MS), PARSE_MEMORY_MB: '128', PARSE_MAX_CONCURRENCY: '1', PARSE_QUEUE_TIMEOUT_MS: '200' });
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    // the pre-scan now rejects true bombs instantly, so occupy the single parse slot with legitimate heavy documents
    const pdf = H.buildPdf(Array.from({ length: 50 }, (_, p) => Array.from({ length: 45 }, (_, l) => `Line ${p} ${l} lorem ipsum dolor sit amet ${p * l}`)), { compress: true });
    const batches: string[] = [];
    for (let i = 0; i < 8; i++) batches.push(await H.newBatch(s));
    const rs = await Promise.all(batches.map((b) => H.upload(s, b, 'heavy' + b.slice(0, 4) + '.pdf', Buffer.concat([pdf, Buffer.from('% ' + b)]))));
    const busy = rs.map((r, i) => ({ r, b: batches[i]! })).filter((x) => x.r.status === 503);
    expect(busy.length, rs.map((r) => r.status).join(',')).toBeGreaterThanOrEqual(1);
    for (const { r, b } of busy) {
      expectError(r, 503, 'parser_busy');
      expect(String(r.headers['retry-after'])).toMatch(/^\d+$/);
      const docs = (await s.get(`/imports/${b}`)).body.documents as any[];
      for (const d of docs) expect(d.status).toBe('FAILED');
      expect(await H.s3List(`t/${H.tenantIdOf(s)}/imports/${b}/`)).toEqual([]);
    }
    const nb = await H.newBatch(s);
    const t0 = Date.now();
    const ok = await H.upload(s, nb, 'ok.txt', S(H.bolTxt(H.uniqLoad('WK'))));
    expect(ok.status, ok.text).toBe(201);
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 120000);
});

describe('T-IMP-WORKER 4-5 stability and no leakage', () => {
  it('after 20 consecutive bomb uploads a baseline upload is as fast as before (3x) and /readyz is 200', async () => {
    const base = async () => { const ms: number[] = []; for (let i = 0; i < 7; i++) { const b = await H.newBatch(an); ms.push((await H.upload(an, b, 'ok.txt', S(H.bolTxt(H.uniqLoad('WK'))))).ms); } return ms.sort((x, y) => x - y)[3]!; };
    const before = await base();
    const pdf = await bomb();
    for (let i = 0; i < 20; i++) { const { r } = await upBomb(an, pdf); expect([201, 503]).toContain(r.status); }
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    const after = await base();
    expect(after, `before ${before} after ${after}`).toBeLessThanOrEqual(3 * Math.max(before, 1));
  }, 300000);
  it('responses and logs of hostile cases contain only fixed codes: no stack trace, path or parser library name', () => {
    H.assertRecorded('imp-worker-scan');
    const bad = /node_modules|\bat [\w$.<>]+ \(|\sat\s\S+:\d+:\d+|\/usr\/|[A-Za-z]:[\/](Users|Windows)|Error:|pdfjs|pdf-lib|unpdf|pdfminer|pdfplumber/;
    for (const l of logLines) expect(bad.test(l), `log line leaks: ${l.slice(0, 300)}`).toBe(false);
    expect(logLines.length).toBeGreaterThan(0);
  });
});
