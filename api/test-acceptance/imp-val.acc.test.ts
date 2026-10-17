/* eslint-disable */
// T-VAL-IMP: strict validation on the new routes.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, buildTestApp, closeApps, expectError, sessionFor, type Session } from './helpers/client.js';
import * as H from './helpers/imp.js';

let app: FastifyInstance;
let an: Session, rev: Session;
let b = '', d = '', f = '';
const R = 'validation probe reason';
beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  an = H.wrap(await sessionFor(app, ACCOUNTS.ANALYST));
  rev = H.wrap(await sessionFor(app, ACCOUNTS.REVIEWER));
  b = await H.newBatch(an);
  const doc = await H.putOk(an, b, 'rc.pdf', H.buildPdf(['DOCUMENT: RATE CONFIRMATION', `Load Number: ${H.uniqLoad('VL')}`, 'Linehaul Rate: 5.00']));
  d = doc.id; f = doc.fields[0].id;
});
afterAll(async () => {
  try { H.assertRecorded('imp-val'); } finally { await closeApps(); }
});
const P = () => `/imports/${b}/documents/${d}`;

describe('T-VAL-IMP unknown keys', () => {
  it('unknown body keys -> 400 on R40, R46-R50, R52', async () => {
    const calls: [Session, string, string, any][] = [
      [an, 'POST', '/imports', { label: 'x', extra: 1 }],
      [rev, 'PATCH', P(), { docType: 'INVOICE', extra: 1 }],
      [rev, 'POST', `${P()}/fields`, { key: 'rate_confirmation.carrier', value: 'x', reason: R, extra: 1 }],
      [rev, 'POST', `${P()}/fields/${f}/resolve`, { action: 'CONFIRM', reason: R, extra: 1 }],
      [rev, 'POST', `${P()}/accept`, { reason: R, extra: 1 }],
      [rev, 'POST', `${P()}/reject`, { reason: R, extra: 1 }],
      [an, 'POST', `/imports/${b}/commit`, { perspective: 'SHIPPER', extra: 1 }],
    ];
    for (const [s, m, p, body] of calls) expectError(await s.as(m, p, { body }), 400, 'validation_error');
  });
  it('unknown query keys -> 400 on R41, R43, R51, R54-R56', async () => {
    for (const [s, p] of [[an, '/imports?bogus=1'], [rev, '/reviews?bogus=1'], [rev, '/exports/claims?format=csv&bogus=1'], [rev, '/exports/packets?format=csv&bogus=1'], [rev, '/exports/outcomes?format=csv&bogus=1'], [rev, '/exports/claims?format=csv&page=1']] as [Session, string][]) expectError(await s.get(p), 400, 'validation_error');
    expectError(await H.upload(an, b, 'a.txt', Buffer.from('x'), { extraQuery: 'bogus=1' }), 400, 'validation_error');
  });
});

describe('T-VAL-IMP types and sizes', () => {
  it('wrong types and oversized strings -> 400', async () => {
    expectError(await an.post('/imports', { label: 5 }), 400, 'validation_error');
    expectError(await an.post('/imports', { label: 'x'.repeat(121) }), 400, 'validation_error');
    expectError(await an.post('/imports', { label: 'two\nlines' }), 400, 'validation_error');
    expect((await an.post('/imports', { label: 'x'.repeat(120) })).status).toBe(201);
    expectError(await rev.post(`${P()}/fields/${f}/resolve`, { action: 'CONFIRM', reason: 'x'.repeat(2001) }), 400, 'validation_error');
    expectError(await rev.post(`${P()}/fields/${f}/resolve`, { action: 'CORRECT', correctedValue: 'x'.repeat(1001), reason: R }), 400, 'validation_error');
    expectError(await rev.post(`${P()}/fields/${f}/resolve`, { action: 'DELETE', reason: R }), 400, 'validation_error');
    expectError(await rev.post(`${P()}/accept`, { reason: R, confirmRemaining: 'yes' }), 400, 'validation_error');
    expectError(await rev.patch(P(), { docType: 'OTHER' }), 400, 'validation_error');
    expectError(await an.post(`/imports/${b}/commit`, { perspective: 'shipper' }), 400, 'validation_error');
  });
  it('pageSize over 100 -> 400 and page 0 -> 400 on list routes', async () => {
    for (const [s, p] of [[an, '/imports?pageSize=101'], [an, '/imports?page=0'], [rev, '/reviews?pageSize=101']] as [Session, string][]) expectError(await s.get(p), 400, 'validation_error');
    expect((await an.get('/imports?pageSize=100')).status).toBe(200);
  });
  it('non-UUID path ids behave like the step 1-2 routes (same status and error code)', async () => {
    const ref = await an.get('/claims/not-a-uuid');
    for (const p of ['/imports/not-a-uuid', `/imports/${b}/documents/not-a-uuid`, `/imports/not-a-uuid/documents/${d}/original`, '/claims/not-a-uuid/documents']) {
      const r = await an.get(p);
      expect(r.status, p).toBe(ref.status);
      expect(r.body?.error?.code, p).toBe(ref.body?.error?.code);
    }
    expect([400, 404]).toContain(ref.status);
  });
  it('export query validation: format missing or invalid -> 400; invalid action, dates -> 400; list shape limits', async () => {
    for (const q of ['', 'format=pdf', 'format=CSV', 'format=csv,xlsx']) expectError(await rev.get(`/exports/claims?${q}`), 400, 'validation_error');
    for (const q of ['format=csv&action=DELETE', 'format=csv&from=yesterday', 'format=csv&to=2025-13-45']) expectError(await rev.get(`/exports/outcomes?${q}`), 400, 'validation_error');
  });
});
