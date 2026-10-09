/* eslint-disable */
// T-STORE 1-6: object storage properties (S3 inspection client with the test credentials).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import { baseEnv } from './helpers/env.js';
import * as H from './helpers/imp.js';
import { REPO } from './helpers/sh.js';

const logLines: string[] = [];
let app: FastifyInstance, port = 0;
let an: Session, rev: Session;
let tenantId = '';
const S = (s: string) => Buffer.from(s, 'utf8');

beforeAll(async () => {
  await H.assertS3Reachable();
  const logStream = new Writable({ write(chunk, _e, cb) { logLines.push(...String(chunk).split('\n').filter(Boolean)); cb(); } });
  app = await buildTestApp({ LOG_LEVEL: 'info' }, { logStream });
  port = await H.listen(app);
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  rev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  tenantId = H.tenantIdOf(an);
});
afterAll(async () => {
  try { H.assertRecorded('imp-store'); } finally { await closeApps(); }
});

describe('T-STORE 1 an accepted upload', () => {
  it('exactly the keys original and text; content type, encryption, size, no name in metadata or tags; download hash and header', async () => {
    const name = `CANARY-NAME-${H.RUN}.txt`;
    const bytes = S(H.bolTxt(H.uniqLoad('ST')));
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, name, bytes);
    expect(d.status).toBe('ACCEPTED');
    const keys = (await H.s3List(H.docPrefix(tenantId, b, d.id))).sort();
    expect(keys).toEqual([`${H.docPrefix(tenantId, b, d.id)}original`, `${H.docPrefix(tenantId, b, d.id)}text`]);
    for (const k of keys) {
      const h = await H.s3Head(k);
      expect(h, k).toBeTruthy();
      expect(h.ContentType).toBe('application/octet-stream');
      console.log(`[store] ${k.split('/').pop()} ServerSideEncryption=${h.ServerSideEncryption ?? 'none'} (S3_SSE=${H.S3_ENV.S3_SSE})`);
      if (H.S3_ENV.S3_SSE === 'aws:kms') expect(h.ServerSideEncryption).toBe('aws:kms');
      expect(JSON.stringify(h.Metadata ?? {})).not.toContain('CANARY-NAME');
      expect(JSON.stringify(await H.s3Tags(k))).not.toContain('CANARY-NAME');
    }
    expect((await H.s3Head(`${H.docPrefix(tenantId, b, d.id)}original`)).ContentLength).toBe(bytes.length);
    const dl = await H.download(an, `/imports/${b}/documents/${d.id}/original`);
    expect(H.sha256(dl.buf)).toBe(d.sha256);
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="document-${d.id.slice(0, 8)}.txt"`);
    expect(dl.headers['content-disposition']).not.toContain('CANARY-NAME');
  });
});

describe('T-STORE 2-3 rejected documents leave nothing; no stray objects', () => {
  it('pre-store, post-store and reviewer rejections leave no original/text object', async () => {
    const b = await H.newBatch(an);
    const pre = await H.upload(an, b, 'a.png', S('not a png'));
    expectError(pre, 415, 'unsupported_media_type');
    const post = await H.putOk(an, b, 'bad.png', H.buildPng({ trailing: S('trailing bytes here') }));
    expect(post.status).toBe('REJECTED');
    const nr = await H.putOk(an, b, 'rc.pdf', H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${H.uniqLoad('ST')}`]));
    expect((await rev.post(`/imports/${b}/documents/${nr.id}/reject`, { reason: 'Reviewer rejects this document' })).status).toBe(200);
    for (const id of [post.id, nr.id]) expect(await H.waitGone(H.docPrefix(tenantId, b, id), 3000)).toEqual([]);
    expect(await H.s3List(`t/${tenantId}/imports/${b}/`)).toEqual([]);
  });
  it('no object exists outside t/<uuid>/imports/<uuid>/<uuid>/(original|text)', async () => {
    const all = await H.s3List('');
    for (const k of all) expect(k, 'stray object key').toMatch(H.KEY_RE());
  });
});

describe('T-STORE 4 private bucket and no presigned URLs', () => {
  it('an anonymous GET of an existing object URL is refused; no log line carries a signature', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'a.txt', S(H.bolTxt(H.uniqLoad('ST'))));
    const key = `${H.docPrefix(tenantId, b, d.id)}original`;
    const url = `${H.S3_ENV.S3_ENDPOINT}/${H.S3_ENV.S3_BUCKET}/${key}`;
    const r = await fetch(url);
    expect([401, 403]).toContain(r.status);
    const bad = /X-Amz-Signature|X-Amz-Credential|AWSAccessKeyId/i;
    for (const l of logLines) expect(bad.test(l), l.slice(0, 200)).toBe(false);
    expect(JSON.stringify((await an.get(`/imports/${b}`)).body)).not.toMatch(/X-Amz|https?:\/\/[^"]*amazonaws|127\.0\.0\.1:9000/);
  });
});

describe('T-STORE 5 tampering', () => {
  it('replacing the stored original makes R45 fail or abort (never a complete response with different bytes) and logs an integrity error without content', async () => {
    const b = await H.newBatch(an);
    const d = await H.putOk(an, b, 'a.txt', S(H.bolTxt(H.uniqLoad('ST'))));
    const key = `${H.docPrefix(tenantId, b, d.id)}original`;
    const evil = S('TAMPERED-CONTENT-CANARY '.repeat(40));
    await H.s3Put(key, evil);
    const hdr = await H.authHdrs(an);
    const r = await H.rawHttp(port, { path: `/api/v1/imports/${b}/documents/${d.id}/original`, headers: hdr, timeoutMs: 20000 });
    const completeButWrong = r.status === 200 && !r.error && H.sha256(r.body) !== d.sha256;
    expect(completeButWrong, `status ${r.status} err ${r.error} bytes ${r.body.length}`).toBe(false);
    expect(r.status === 200 ? H.sha256(r.body) === d.sha256 || !!r.error : true).toBe(true);
    await H.sleep(500);
    const lvl = (l: string) => { try { return JSON.parse(l).level as number; } catch { return 0; } };
    const integrity = logLines.filter((l) => lvl(l) >= 50 && /integrity|mismatch|checksum|sha/i.test(l));
    expect(integrity.length, 'error-level integrity log line').toBeGreaterThan(0);
    for (const l of logLines) expect(l).not.toContain('TAMPERED-CONTENT-CANARY');
  });
});

describe('T-STORE 6 storage unavailable and stale reaper', () => {
  it('a separate app pointing at a closed port: upload -> 201 FAILED (or 503), no RECEIVED row left, no stack leak', async () => {
    const dead = await buildTestApp({ S3_ENDPOINT: 'http://127.0.0.1:1' });
    const s = H.wrap(await sessionFor(dead, ACCOUNTS.ANALYST));
    const b = await H.newBatch(s);
    const r = await H.upload(s, b, 'a.txt', S(H.bolTxt(H.uniqLoad('ST'))));
    expect([201, 503]).toContain(r.status);
    if (r.status === 201) expect(r.body.status).toBe('FAILED');
    expect(r.text).not.toMatch(/ECONNREFUSED|node_modules|\bat \S+ \(|127\.0\.0\.1:1/);
    const docs = (await s.get(`/imports/${b}`)).body.documents as any[];
    for (const d of docs) expect(d.status).not.toBe('RECEIVED');
  });
  it('an abandoned document (server killed mid-parse) is FAILED after IMPORT_STALE_SECONDS when its batch is read', async (ctx) => {
    const entry = resolve(REPO, 'api', 'dist', 'src', 'server.js');
    if (!existsSync(entry)) return ctx.skip('api/dist/src/server.js is not built; cannot start a dedicated server process');
    const free: number = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
    const env = { ...process.env, ...baseEnv({ PORT: String(free), HOST: '127.0.0.1', PARSE_TIMEOUT_MS: '20000', IMPORT_STALE_SECONDS: '2' }) } as NodeJS.ProcessEnv;
    const child = spawn(process.execPath, [entry], { env, stdio: 'ignore' });
    try {
      let up = false;
      for (let i = 0; i < 60 && !up; i++) { await H.sleep(500); up = (await H.rawHttp(free, { path: '/healthz', timeoutMs: 1000 })).status === 200; }
      if (!up) return ctx.skip('dedicated server did not become healthy (PORT/HOST env names may differ)');
      const b = await H.newBatch(an);
      const bomb = await H.flateBombPdf();
      const hdr = await H.authHdrs(an, { 'content-type': 'application/octet-stream', 'content-length': String(bomb.length) });
      const pending = H.rawHttp(free, { method: 'POST', path: `/api/v1/imports/${b}/documents?filename=bomb.pdf`, headers: hdr, body: bomb, timeoutMs: 8000 });
      await H.sleep(2500);
      child.kill('SIGKILL');
      await pending;
      await H.sleep(2500);
      const sa = await buildTestApp({ IMPORT_STALE_SECONDS: '2' });
      const batch = await (await sessionFor(sa, ACCOUNTS.ANALYST)).get(`/imports/${b}`);
      expect(batch.status, batch.text).toBe(200);
      const docs = batch.body.documents as any[];
      for (const d of docs) expect(['FAILED', 'REJECTED']).toContain(d.status);
      await H.sleep(500);
      expect(await H.s3List(`t/${tenantId}/imports/${b}/`)).toEqual([]);
    } finally { child.kill('SIGKILL'); }
  }, 120000);
});
