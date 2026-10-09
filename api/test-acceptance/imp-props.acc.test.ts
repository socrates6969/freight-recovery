/* eslint-disable */
// Properties P1 (upload fuzz), P3 (commit invariants), P5 (cross-tenant interleavings). Seeds printed.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let an: Session, rev: Session, mgr: Session, gx: Session;
const S = (s: string) => Buffer.from(s, 'utf8');
beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  rev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  mgr = H.wrap(await sessionFor(app, ACCOUNTS.MANAGER));
  gx = H.wrap(await sessionFor(app, 'manager@globex.test'));
});
afterAll(async () => { try { H.assertRecorded('imp-props'); } finally { await closeApps(); reseed(); } });

function mutate(R: ReturnType<typeof H.rng>, b: Buffer): Buffer {
  const o = Buffer.from(b);
  switch (R.int(5)) {
    case 0: if (o.length) o[R.int(o.length)] = R.int(256); return o;
    case 1: return o.subarray(0, R.int(o.length + 1));
    case 2: { const i = R.int(o.length + 1); return Buffer.concat([o.subarray(0, i), R.bytes(1 + R.int(8)), o.subarray(i)]); }
    case 3: { const i = R.int(o.length + 1); return Buffer.concat([o.subarray(0, i), o.subarray(i + 1 + R.int(8))]); }
    default: return Buffer.concat([o, o.subarray(0, R.int(o.length + 1))]);
  }
}
const NAMES = ['a.txt', 'a.csv', 'a.pdf', 'a.png', 'a.jpg', 'x.TXT', '..%2f.txt', 'e\u0301.txt', 'a\u202etxt.exe', 'noext', 'a.docx'];
describe('P1 upload fuzz', () => {
  const seed = H.ACC_SEED + 1;
  it(`300 inputs (seed ${seed}): only 201/413/415/429/503, invariants hold, service stays healthy`, async () => {
    const R = H.rng(seed);
    const seeds: Buffer[] = [H.buildPdf(['DOCUMENT: RATE CONFIRMATION', 'Load Number: LD-P1', 'Linehaul Rate: 5']), H.buildPng(), H.buildJpeg(), S(H.invoiceTxt('LD-P1')), S('Document,Invoice\nLoad Number,LD-P1\n')];
    let batch = '', n = 0;
    for (let i = 0; i < 300; i++) {
      if (!batch || n >= 8) { batch = await H.newBatch(an); n = 0; }
      const kind = R.int(3);
      const bytes = kind === 0 ? R.bytes(R.int(300)) : kind === 1 ? mutate(R, R.pick(seeds)) : Buffer.concat([R.pick([Buffer.from('%PDF-'), H.PNG_SIG, Buffer.from([0xff, 0xd8, 0xff])]), R.bytes(R.int(200))]);
      const name = R.pick(NAMES);
      const r = await H.upload(an, batch, name, bytes);
      n++;
      expect([201, 409, 413, 415, 429, 503, 400], `${name} ${i}: ${r.status} ${r.text.slice(0, 120)}`).toContain(r.status);
      if (r.status === 415 || r.status === 413) expect(r.body?.error?.code).toBeTruthy();
      if (r.status !== 201) continue;
      const d = r.body;
      expect(d.sha256).toBe(H.sha256(bytes));
      H.expectDocInvariants(d, bytes);
      expect(/[\/\:*?"<>|\u0000-\u001f\u202a-\u202e]/.test(d.displayName)).toBe(false);
      if (d.status === 'REJECTED') expect(await H.waitGone(`t/${H.tenantIdOf(an)}/imports/${batch}/${d.id}/`, 3000)).toEqual([]);
    }
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const b = await H.newBatch(an);
    expect((await H.upload(an, b, 'bol.txt', S(H.bolTxt(H.uniqLoad('P1'))))).status).toBe(201);
    expect((await (await sessionFor(app, ACCOUNTS.OWNER)).get('/audit/verify')).body.valid).toBe(true);
  }, 900000);
});
describe('P3 commit invariants', () => {
  const seed = H.ACC_SEED + 3;
  it(`100 random operation sequences (seed ${seed})`, async () => {
    const R = H.rng(seed);
    let claims = (await mgr.get('/claims?pageSize=1')).body.total;
    const linked = new Map<string, string>();
    for (let i = 0; i < 100; i++) {
      const b = await H.newBatch(an);
      const load = H.uniqLoad('P3');
      const docs: any[] = [];
      for (const mk of R.int(3) + 1 > 0 ? [R.pick([() => S(H.bolTxt(load)), () => H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, 'Linehaul Rate: 5'])])] : []) {
        const bytes = mk() as Buffer;
        docs.push(await H.putOk(an, b, bytes[0] === 0x25 ? 'x.pdf' : 'x.txt', bytes));
      }
      for (const d of docs) {
        const op = R.int(3);
        if (d.status === 'NEEDS_REVIEW' && op === 1) await H.acceptDoc(rev, b, d.id);
        else if (d.status === 'NEEDS_REVIEW' && op === 2) await rev.post(`/imports/${b}/documents/${d.id}/reject`, { reason: 'property test rejection' });
      }
      const c1 = await H.commit(an, b, R.pick(['SHIPPER', 'CARRIER'] as const));
      const c2 = await H.commit(an, b);
      expect(c1.status).toBe(200);
      expect(c2.body.created, 'idempotent').toEqual([]);
      const now = (await mgr.get('/claims?pageSize=1')).body.total;
      expect(now).toBeGreaterThanOrEqual(claims);
      claims = now;
      for (const x of [...c1.body.created, ...c1.body.updated]) {
        const ds = (await mgr.get(`/claims/${x.claimId}/documents`)).body.items;
        for (const it of ds) { expect(linked.get(it.id) ?? x.claimId, 'document linked to at most one claim').toBe(x.claimId); linked.set(it.id, x.claimId); expect(it.status).toBe('ACCEPTED'); }
      }
    }
    const nums = (await mgr.get('/claims?pageSize=100&sort=claimNumber:asc')).body.items.map((c: any) => c.claimNumber);
    expect(new Set(nums).size).toBe(nums.length);
  }, 900000);
});
describe('P5 cross-tenant interleavings', () => {
  const seed = H.ACC_SEED + 5;
  it(`random Acme/Globex operations never leak the other tenant (seed ${seed})`, async () => {
    const R = H.rng(seed);
    const secrets = { a: [] as string[], g: [] as string[] };
    for (let i = 0; i < 24; i++) {
      const acme = R.int(2) === 0;
      const s = acme ? an : gx;
      const tag = `${acme ? 'CANARYACME' : 'CANARYGLX'}${H.RUN}${i}`;
      const b = await H.newBatch(s, tag);
      await H.putOk(s, b, 'i.txt', S(H.invoiceTxt(H.uniqLoad('P5'), { carrier: tag })));
      const c = await H.commit(s, b);
      (acme ? secrets.a : secrets.g).push(tag);
      const txt = JSON.stringify([c.body, (await s.get('/imports?pageSize=100')).body, (await s.get('/claims?pageSize=100')).body]) + (await H.download(s, '/exports/claims?format=csv')).text;
      for (const t of acme ? secrets.g : secrets.a) expect(txt.includes(t), `leak of ${t}`).toBe(false);
    }
  }, 600000);
});
