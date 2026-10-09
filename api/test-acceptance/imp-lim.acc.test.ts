/* eslint-disable */
// T-IMP-LIM 1-10: size, count, quota, rate, slow senders. Each scenario with changed limits uses its OWN app instance.
import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, claimId, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

const S = (s: string) => Buffer.from(s, 'utf8');
/** Valid text document of exactly `n` bytes (header + padding lines under 4000 chars). */
function textOfSize(n: number, tag: string): Buffer {
  const head = `DOCUMENT: BILL OF LADING\nLoad Number: ${H.uniqLoad(tag)}\n`;
  let body = head;
  const pad = (k: number) => '#'.repeat(Math.max(0, k - 1)) + '\n';
  while (body.length + 1000 < n) body += pad(1000);
  const rest = n - body.length;
  body += rest > 0 ? (rest === 1 ? '\n' : pad(rest)) : '';
  return S(body.slice(0, n));
}
let admin: Session;
let acmeTenant = '';
beforeAll(async () => {
  await H.assertS3Reachable();
  reseed(); // quota scenarios need an empty tenant
  const a = await buildTestApp();
  admin = await sessionFor(a, ACCOUNTS.ADMIN);
  acmeTenant = H.tenantIdOf(admin);
});
afterAll(async () => {
  try { H.assertRecorded('imp-lim'); } finally { await closeApps(); }
});


describe('T-IMP-LIM 1 size limit enforced while streaming', () => {
  let app: FastifyInstance, port = 0, s: Session;
  beforeAll(async () => {
    app = await buildTestApp({ IMPORT_MAX_FILE_BYTES: '1048576' });
    port = await H.listen(app);
    s = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  });
  it('exactly the limit -> 201; one byte over (with Content-Length) -> 413 payload_too_large, nothing stored, audited too_large', async () => {
    const seq0 = await H.lastSeq(admin);
    const b = await H.newBatch(s);
    const ok = await H.upload(s, b, 'big.txt', textOfSize(1048576, 'LIM'));
    expect(ok.status, ok.text.slice(0, 300)).toBe(201);
    const b2 = await H.newBatch(s);
    const over = await H.upload(s, b2, 'big.txt', textOfSize(1048577, 'LIM'));
    expectError(over, 413, 'payload_too_large');
    expect((await s.get(`/imports/${b2}`)).body.documentCount).toBe(0);
    expect(await H.s3List(`t/${H.tenantIdOf(s)}/imports/${b2}/`)).toEqual([]);
    const ev = (await H.auditSince(admin, seq0, 'import.document_rejected')).filter((e) => H.evDocId(e) === null);
    expect(ev.map((e) => H.evReason(e))).toContain('too_large');
  });
  it('2 MiB sent chunked without Content-Length -> 413 (or the connection is closed) and nothing stored', async () => {
    const b = await H.newBatch(s);
    const hdr = await H.authHdrs(s, { 'content-type': 'application/octet-stream' });
    const r = await H.rawHttp(port, {
      method: 'POST', path: `/api/v1/imports/${b}/documents?filename=a.txt`, headers: hdr, timeoutMs: 30000,
      drive: (req) => {
        const chunk = Buffer.alloc(65536, 0x61);
        let sent = 0;
        const pump = () => { while (sent < 2 * 1024 * 1024) { if (req.destroyed || req.writableEnded) return; sent += chunk.length; if (!req.write(chunk)) { req.once('drain', pump); return; } } req.end(); };
        req.on('error', () => undefined);
        pump();
      },
    });
    expect(r.status === 413 || r.status === 0, `status ${r.status} err ${r.error}`).toBe(true);
    if (r.status === 413) expect(H.jsonOf(r)?.error?.code).toBe('payload_too_large');
    expect((await s.get(`/imports/${b}`)).body.documentCount).toBe(0);
    expect(await H.s3List(`t/${H.tenantIdOf(s)}/imports/${b}/`)).toEqual([]);
  });
  it('Content-Length declares 100 but 2 MiB are sent -> rejected (400/413 or reset), never stored', async () => {
    const b = await H.newBatch(s);
    const hdr = await H.authHdrs(s);
    const head = `POST /api/v1/imports/${b}/documents?filename=a.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/octet-stream\r\nContent-Length: 100\r\nAuthorization: ${hdr.authorization}\r\nX-CSRF-Token: ${hdr['x-csrf-token']}\r\nCookie: ${hdr.cookie}\r\nConnection: close\r\n\r\n`;
    const resp: string = await new Promise((resolve) => {
      let buf = '';
      const sock = net.connect(port, '127.0.0.1', () => { sock.write(head); sock.write(Buffer.alloc(2 * 1024 * 1024, 0x62), () => undefined); });
      sock.on('data', (d) => { buf += d.toString('latin1'); });
      sock.on('error', () => resolve(buf));
      sock.on('close', () => resolve(buf));
      setTimeout(() => { sock.destroy(); resolve(buf); }, 15000);
    });
    const m = /^HTTP\/1\.1 (\d{3})/.exec(resp);
    if (m) expect([201, 400, 413]).toContain(Number(m[1]));
    await H.sleep(500);
    const docs = (await s.get(`/imports/${b}`)).body.documents as any[];
    // if a 201 was returned the stored bytes are the first 100 only; the test requires that nothing beyond Content-Length is stored
    for (const d of docs) expect(d.sizeBytes).toBeLessThanOrEqual(100);
  });
});

describe('T-IMP-LIM 2-4 count, duplicates, quota', () => {
  it('IMPORT_MAX_FILES_PER_BATCH=3: the 4th upload -> 409 batch_full', async () => {
    const a = await buildTestApp({ IMPORT_MAX_FILES_PER_BATCH: '3' });
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const b = await H.newBatch(s);
    for (let i = 0; i < 3; i++) await H.putOk(s, b, `f${i}.txt`, textOfSize(500 + i, 'CNT'));
    expectError(await H.upload(s, b, 'f3.txt', textOfSize(600, 'CNT')), 409, 'batch_full');
    expect((await s.get(`/imports/${b}`)).body.documentCount).toBe(3);
  });
  it('duplicate bytes in a batch -> 409 conflict; elsewhere in the tenant -> 201 NEEDS_REVIEW DUPLICATE_OF_EARLIER', async () => {
    const a = await buildTestApp();
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const bytes = S(H.bolTxt(H.uniqLoad('DUP')));
    const b = await H.newBatch(s);
    await H.putOk(s, b, 'one.txt', bytes);
    expectError(await H.upload(s, b, 'two.txt', bytes), 409, 'conflict');
    const b2 = await H.newBatch(s);
    const d = await H.putOk(s, b2, 'three.txt', bytes);
    expect(d.reviewReasons).toContain('DUPLICATE_OF_EARLIER');
    expect(d.status).toBe('NEEDS_REVIEW');
  });
  it('5 concurrent identical uploads in one batch -> exactly one 201 and four 409, documentCount 1', async () => {
    // five simultaneous uploads exceed the default UPLOAD_MAX_CONCURRENT_PER_TENANT=4 (a sixth-style 429 is correct then), so lift the cap for this scenario
    const a = await buildTestApp({ UPLOAD_MAX_CONCURRENT_PER_TENANT: '20' });
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const bytes = S(H.bolTxt(H.uniqLoad('CONC')));
    const b = await H.newBatch(s);
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => H.upload(s, b, `c${i}.txt`, bytes)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
    expect((await s.get(`/imports/${b}`)).body.documentCount).toBe(1);
  });
});

describe('T-IMP-LIM 4 tenant storage quota', () => {
  it('quota 100000: the 4th 30000-byte upload -> 422 quota_exceeded; REJECTED docs do not count; another tenant unaffected', async () => {
    reseed(); // earlier scenarios in this file stored a 1 MiB document in the tenant
    const a = await buildTestApp({ TENANT_STORAGE_QUOTA_BYTES: '100000' });
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const gx = H.wrap(await sessionFor(a, 'manager@globex.test'));
    const b = await H.newBatch(s);
    for (let i = 0; i < 3; i++) await H.putOk(s, b, `q${i}.txt`, textOfSize(30000, `Q${i}`));
    expectError(await H.upload(s, b, 'q3.txt', textOfSize(30000, 'Q3')), 422, 'quota_exceeded');
    // a post-store REJECTED document (trailing data after IEND) must not use quota headroom (10000 left)
    const rejected = await H.putOk(s, b, 'bad.png', Buffer.concat([H.buildPng(), Buffer.alloc(6000, 0x41)]));
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectReason).toBe('trailing_data');
    const fits = await H.upload(s, b, 'q4.txt', textOfSize(9000, 'Q4'));
    expect(fits.status, fits.text).toBe(201);
    const gb = await H.newBatch(gx);
    const g = await H.upload(gx, gb, 'g.txt', textOfSize(30000, 'GQ'));
    expect(g.status, g.text).toBe(201);
  });
});

describe('T-IMP-LIM 5 concurrent uploads per tenant', () => {
  it('UPLOAD_MAX_CONCURRENT_PER_TENANT=1: a second concurrent slow upload -> 429 rate_limited; another tenant is unaffected', async () => {
    const a = await buildTestApp({ UPLOAD_MAX_CONCURRENT_PER_TENANT: '1' });
    const port = await H.listen(a);
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const gx = H.wrap(await sessionFor(a, 'manager@globex.test'));
    const body = textOfSize(2000, 'SLOW');
    const b1 = await H.newBatch(s);
    const hdr = await H.authHdrs(s, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) });
    let release: () => void = () => undefined;
    const first = H.rawHttp(port, {
      method: 'POST', path: `/api/v1/imports/${b1}/documents?filename=slow.txt`, headers: hdr, timeoutMs: 30000,
      drive: (req) => { req.flushHeaders(); req.write(body.subarray(0, 50)); release = () => { req.write(body.subarray(50)); req.end(); }; },
    });
    await H.sleep(700);
    const b2 = await H.newBatch(s);
    const second = await H.upload(s, b2, 'second.txt', textOfSize(800, 'SLOW2'));
    expectError(second, 429, 'rate_limited');
    const gb = await H.newBatch(gx);
    const other = await H.upload(gx, gb, 'g.txt', textOfSize(800, 'SLOW3'));
    expect(other.status, other.text).toBe(201);
    release();
    const done = await first;
    expect(done.status).toBe(201);
  });
});

describe('T-IMP-LIM 6 upload rate limit', () => {
  it('RATE_LIMIT_UPLOAD_MAX=3: the 4th upload by the same user -> 429 with integer Retry-After; another user is not limited', async () => {
    const a = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_UPLOAD_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const other = H.wrap(await sessionFor(a, ACCOUNTS.REVIEWER));
    const b = await H.newBatch(s);
    for (let i = 0; i < 3; i++) await H.putOk(s, b, `r${i}.txt`, textOfSize(500 + i, 'RL'));
    const r = await H.upload(s, b, 'r3.txt', textOfSize(700, 'RL'));
    expectError(r, 429, 'rate_limited');
    expect(String(r.headers['retry-after'])).toMatch(/^\d+$/);
    const ob = await H.newBatch(other);
    expect((await H.upload(other, ob, 'o.txt', textOfSize(700, 'RL2'))).status).toBe(201);
  });
});

describe('T-IMP-LIM 7-8 slow senders and early rejection (real HTTP)', () => {
  it('idle timeout: headers + 100 bytes then a stall -> the request ends within 6 s (408 or closed), nothing stored', async () => {
    const a = await buildTestApp({ UPLOAD_IDLE_TIMEOUT_SECONDS: '2' });
    const port = await H.listen(a);
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const b = await H.newBatch(s);
    const hdr = await H.authHdrs(s, { 'content-type': 'application/octet-stream', 'content-length': '5000' });
    const r = await H.rawHttp(port, {
      method: 'POST', path: `/api/v1/imports/${b}/documents?filename=idle.txt`, headers: hdr, timeoutMs: 15000,
      drive: (req) => { req.on('error', () => undefined); req.flushHeaders(); req.write(Buffer.alloc(100, 0x61)); },
    });
    expect(r.ms, `ended after ${r.ms} ms`).toBeLessThan(6000);
    expect(r.status === 408 || r.status === 0 || r.status >= 400, `status ${r.status} ${r.error}`).toBe(true);
    expect((await s.get(`/imports/${b}`)).body.documentCount).toBe(0);
    expect(await H.s3List(`t/${H.tenantIdOf(s)}/imports/${b}/`)).toEqual([]);
  });
  it('early rejection: unauthenticated / VIEWER / missing CSRF / wrong Origin declaring 50 MiB get 401/403/403/403 within 2 s', async () => {
    const a = await buildTestApp();
    const port = await H.listen(a);
    const an = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    const vw = H.wrap(await sessionFor(a, ACCOUNTS.VIEWER));
    const b = await H.newBatch(an);
    const path = `/api/v1/imports/${b}/documents?filename=a.txt`;
    const flush = (req: any) => { req.on('error', () => undefined); req.flushHeaders(); };
    const cl = { 'content-type': 'application/octet-stream', 'content-length': '52428800' };
    const good = await H.authHdrs(an, cl);
    const cases: [string, Record<string, string>, number][] = [
      ['unauthenticated', { ...cl, 'x-csrf-token': good['x-csrf-token']!, cookie: good.cookie! }, 401],
      ['viewer', await H.authHdrs(vw, cl), 403],
      ['missing CSRF', { ...cl, authorization: good.authorization! }, 403],
      ['wrong Origin', { ...good, origin: H.ORIGIN_BAD }, 403],
    ];
    for (const [label, headers, want] of cases) {
      const r = await H.rawHttp(port, { method: 'POST', path, headers, drive: flush, timeoutMs: 5000 });
      expect(r.status, `${label}: ${r.error}`).toBe(want);
      expect(r.ms, `${label} latency`).toBeLessThan(2000);
    }
  });
});

describe('T-IMP-LIM 9-10 unrelated limits and no URL import', () => {
  it('POST /claims/:id/assign keeps its body limit (70000 bytes -> 413) and rejects application/octet-stream', async () => {
    const a = await buildTestApp();
    const m = await sessionFor(a, ACCOUNTS.MANAGER);
    const id = await claimId(m, 'CLM-0012');
    const big = await m.post(`/claims/${id}/assign`, { assigneeId: H.RAND_UUID, pad: 'x'.repeat(70000) });
    expectError(big, 413, 'payload_too_large');
    const oct = await m.as('POST', `/claims/${id}/assign`, { raw: 'abc', headers: { 'content-type': 'application/octet-stream' } });
    expect([400, 415]).toContain(oct.status);
  });
  it('no route accepts a URL: POST /imports with a url key -> 400', async () => {
    const a = await buildTestApp();
    const s = H.wrap(await sessionFor(a, ACCOUNTS.ANALYST));
    expectError(await s.post('/imports', { url: 'http://127.0.0.1:9/x' }), 400, 'validation_error');
    expectError(await s.post('/imports', { label: 'ok', url: 'https://example.com/x.pdf' }), 400, 'validation_error');
  });
});
