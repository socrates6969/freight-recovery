/* eslint-disable */
// T-AUD-IMP, T-LOG-IMP, T-HDR-IMP.
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, sessionFor, type Session } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import { reseed } from './helpers/seed.js';

const logLines: string[] = [];
let app: FastifyInstance;
let an: Session, rev: Session, owner: Session, gxOwner: Session;
const CN = `CANARYNAME${H.RUN}`, CV = `CANARYVALUE${H.RUN}`, CC = `CANARYCORR${H.RUN}`, CT = `CANARYTEXT${H.RUN}`;
const S = (s: string) => Buffer.from(s, 'utf8');
beforeAll(async () => {
  await H.assertS3Reachable();
  const logStream = new Writable({ write(c, _e, cb) { logLines.push(...String(c).split('\n').filter(Boolean)); cb(); } });
  app = await buildTestApp({ LOG_LEVEL: 'debug' }, { logStream });
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  rev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  owner = H.wrap(await sessionFor(app, ACCOUNTS.OWNER));
  gxOwner = await sessionFor(app, 'owner@globex.test');
});
afterAll(async () => { try { H.assertRecorded('imp-audit'); } finally { await closeApps(); reseed(); } });

describe('T-AUD-IMP every N10 action has its event; metadata whitelist; chain verifies', () => {
  it('drives every action, scans the whole audit table for canaries', async () => {
    const seq = await H.lastSeq(owner);
    const load = H.uniqLoad('AU');
    const b = await H.newBatch(an, CN);
    const pre = await H.upload(an, b, `${CN}.exe`, S('x'));
    expect(pre.status).toBe(415);
    const ok = await H.putOk(an, b, `${CN}.txt`, S(`DOCUMENT: FREIGHT INVOICE\nInvoice Number: INV-AU\nCarrier: ${CV}\nShipper: ${CT}\nLoad Number: ${load}\nCharge: Linehaul | 5.00\n`));
    await H.download(an, `/imports/${b}/documents/${ok.id}/original`);
    const pdf = await H.putOk(an, b, 'rc.pdf', H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${load}`, `Carrier: ${CV}`]));
    const f = pdf.fields.find((x: any) => x.key === 'rate_confirmation.carrier').id;
    await rev.post(`/imports/${b}/documents/${pdf.id}/fields/${f}/resolve`, { action: 'CORRECT', correctedValue: CC, reason: 'canary correction reason' });
    await H.acceptDoc(rev, b, pdf.id);
    const rej = await H.putOk(an, b, 'rc2.pdf', H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${H.uniqLoad('AU')}`]));
    await rev.post(`/imports/${b}/documents/${rej.id}/reject`, { reason: 'canary reject reason' });
    const img = await H.putOk(an, b, 'scan.png', H.buildPng());
    await rev.patch(`/imports/${b}/documents/${img.id}`, { docType: 'RATE_CONFIRMATION' });
    await rev.post(`/imports/${b}/documents/${img.id}/fields`, { key: 'rate_confirmation.load_number', value: CC, reason: 'canary add reason' });
    await H.commit(an, b);
    const b2 = await H.newBatch(an);
    await H.putOk(an, b2, 'b.txt', S(H.bolTxt(load)));
    await H.commit(an, b2);
    await H.download(rev, '/exports/claims?format=csv&q=' + CV);
    const ev = await H.auditSince(owner, seq);
    const names = new Set(ev.map((e) => e.action));
    for (const a of ['import.batch_created', 'import.document_received', 'import.document_rejected', 'import.document_parsed', 'import.document_downloaded', 'review.field_resolved', 'review.field_added', 'review.doctype_set', 'review.document_accepted', 'review.document_rejected', 'import.committed', 'claim.created_from_import', 'claim.documents_linked', 'export.started', 'export.completed']) expect(names.has(a), a).toBe(true);
    for (const e of ev) { expect(e.actor?.id, e.action).toBeTruthy(); expect(e.hash).toBeTruthy(); }
    const dump = await withAdmin(async (c) => (await c.query(`select metadata::text m from audit_events`)).rows.map((r: any) => r.m).join('\n'));
    for (const k of [CN, CV, CC, CT, 'Linehaul']) expect(dump.includes(k), `canary ${k} in audit metadata`).toBe(false);
    for (const t of [owner, gxOwner]) expect((await t.get('/audit/verify')).body.valid).toBe(true);
  }, 180000);
});

describe('T-LOG-IMP / T-HDR-IMP', () => {
  it('no log line carries file names, canaries, Authorization, cookies, S3 credentials, presigned URLs or the filename query', async () => {
    expect(logLines.length).toBeGreaterThan(0);
    const bad: string[] = [CN, CV, CC, CT, "filename=", "X-Amz-", H.S3_ENV.S3_SECRET_ACCESS_KEY!, 'fr_rt=', 'fr_csrf='];
    for (const l of logLines) {
      for (const k of bad) expect(l.includes(k), `log leaks ${k}: ${l.slice(0, 200)}`).toBe(false);
      expect(/authorization/i.test(l) && /bearer/i.test(l)).toBe(false);
    }
  });
  it('OPTIONS gives no CORS headers; HEAD/TRACE do not bypass auth', async () => {
    for (const p of ['/api/v1/imports', '/api/v1/exports/claims', '/api/v1/reviews']) {
      const o = await app.inject({ method: 'OPTIONS', url: p });
      for (const k of Object.keys(o.headers)) expect(k.startsWith('access-control-')).toBe(false);
      for (const m of ['HEAD', 'TRACE']) { const r = await app.inject({ method: m as any, url: p }); expect([401, 403, 404, 405]).toContain(r.statusCode); }
    }
  });
  it('recorder scan over every response of this file', () => { H.assertRecorded('imp-audit-final'); });
});
