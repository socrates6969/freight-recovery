/* eslint-disable */
// T-VAL-01..06
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, type Session, buildTestApp, claimId, closeApps, expectError, sessionFor } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import { reseed } from './helpers/seed.js';
import { deepKeys, uniq } from './helpers/users.js';

const RAND = '00000000-0000-4000-8000-0000000000ee';
let app: FastifyInstance;
let m: Session, admin: Session, owner: Session;
beforeAll(async () => {
  reseed();
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  m = await sessionFor(app, ACCOUNTS.MANAGER);
  admin = await sessionFor(app, ACCOUNTS.ADMIN);
  owner = await sessionFor(app, ACCOUNTS.OWNER);
});
afterAll(closeApps);

describe('T-VAL-01 strict schemas', () => {
  it('unknown keys / wrong types -> 400 validation_error with details paths only and no echoed values', async () => {
    const c = new Client(app);
    const canary = 'canary-9a1x7';
    const cid = await claimId(m, 'CLM-0021');
    const cases: Array<[string, () => Promise<any>]> = [
      ['R4 unknown key', () => c.post('/auth/login', { email: `${canary}@acme.test`, password: `${canary}-Password!`, extra: canary })],
      ['R4 wrong type', () => c.post('/auth/login', { email: 12345, password: canary })],
      ['R17 unknown key', () => admin.post('/users/invites', { email: `${canary}@acme.test`, role: 'VIEWER', extra: canary })],
      ['R30 unknown key', () => m.post(`/claims/${cid}/packet/revisions`, { baseRevision: 1, demandLetter: canary, reason: `${canary} reason`, extra: canary })],
      ['R31 unknown key', () => m.post(`/claims/${cid}/packet/approve`, { packetRevision: 1, reason: `${canary} reason`, extra: canary })],
      ['R31 wrong type', () => m.post(`/claims/${cid}/packet/approve`, { packetRevision: canary, reason: `${canary} reason` })],
      ['R26 unknown query key', () => m.get(`/claims?${canary}=1`)],
    ];
    for (const [label, p] of cases) {
      const r = await p();
      expectError(r, 400, 'validation_error');
      expect(Array.isArray(r.body.error.details), label).toBe(true);
      expect(r.body.error.details.length, label).toBeGreaterThan(0);
      for (const d of r.body.error.details) {
        expect(Object.keys(d).sort(), label).toEqual(['code', 'path']);
        expect(typeof d.path).toBe('string');
        expect(typeof d.code).toBe('string');
      }
      expect(r.text.includes(canary), `${label} must not echo values`).toBe(false);
    }
    expect((await m.get('/claims?page=1')).status).toBe(200); // control
  });
});

describe('T-VAL-02 body limits and content types', () => {
  it('BODY_LIMIT_BYTES+1 -> 413; wrong media types and malformed/empty bodies are 4xx not 500', async () => {
    const small = await buildTestApp({ BODY_LIMIT_BYTES: '1024', LOCKOUT_THRESHOLD: '50' });
    const c = new Client(small);
    const mk = (n: number) => JSON.stringify({ email: 'a@acme.test', password: 'p', pad: 'x'.repeat(n) });
    const base = mk(0).length;
    const under = mk(1024 - base);
    expect(under.length).toBe(1024);
    const ok = await c.post('/auth/login', undefined, { raw: under, headers: { 'content-type': 'application/json' } });
    expect(ok.status, 'at-limit body is not a 413').not.toBe(413);
    const over = await c.post('/auth/login', undefined, { raw: mk(1025 - base), headers: { 'content-type': 'application/json' } });
    expectError(over, 413, 'payload_too_large');
    const cc = new Client(app);
    const txt = await cc.post('/auth/login', undefined, { raw: 'email=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect([400, 415]).toContain(txt.status);
    expect(txt.body.error).toBeTruthy();
    const plain = await cc.post('/auth/login', undefined, { raw: '{"email":"a@b.test","password":"x"}', headers: { 'content-type': 'text/plain' } });
    expect([400, 415]).toContain(plain.status);
    const mal = await cc.post('/auth/login', undefined, { raw: '{"email": ', headers: { 'content-type': 'application/json' } });
    expectError(mal, 400);
    const empty = await cc.post('/auth/login', undefined, { raw: '', headers: { 'content-type': 'application/json' } });
    expect(empty.status).toBe(400);
    const none = await cc.send('POST', '/auth/login', {});
    expect(none.status).toBe(400);
    expect((await cc.post('/auth/login', { email: 'manager@acme.test', password: 'Synthetic-Pass-2026!' })).status).toBe(200); // control
  });
});

describe('T-VAL-03 hostile query/path values', () => {
  const NASTY = ["' OR 1=1 --", '"; DROP TABLE claims; --', '%', '_', '\\', '%27', 'a\u0000b', 'x'.repeat(10000), '../../etc/passwd', '${7*7}', '{{7*7}}', '\u202e'];
  it('never 500; % _ \\ are literals; sort injection rejected; claims table intact', async () => {
    const detail = new Map<string, any>();
    for (const c of (await m.get('/claims?pageSize=100')).body.items) detail.set(c.id, { ...c, ...(await m.get(`/claims/${c.id}`)).body });
    const rows = [...detail.values()];
    for (const q of NASTY) {
      const r = await m.get(`/claims?q=${encodeURIComponent(q)}`);
      expect(r.status, `q=${q.slice(0, 20)}`).toBeLessThan(500);
      if (r.status === 200 && q.length <= 100) {
        const want = rows.filter((c) => [c.claimNumber, c.loadNumber, c.invoiceNumber, c.carrierName, c.shipperName].some((f) => String(f).toLowerCase().includes(q.toLowerCase()))).length;
        expect(r.body.total, `literal match semantics for q=${JSON.stringify(q)}`).toBe(want);
      }
      for (const [key, val] of [['status', q], ['sort', q], ['assigneeId', q], ['perspective', q]] as const) {
        const rr = await m.get(`/claims?${key}=${encodeURIComponent(val)}`);
        expect(rr.status, `${key}=${val.slice(0, 20)}`).toBeLessThan(500);
        expect([200, 400]).toContain(rr.status);
        if (key !== 'sort' || val !== q) continue;
        expect(rr.status).toBe(400);
      }
      const id = await m.get(`/claims/${encodeURIComponent(q)}`);
      expect(id.status, `id=${q.slice(0, 20)}`).toBeLessThan(500);
      expect([400, 404, 414]).toContain(id.status); // 414 = URI too long for the 10k-char value
    }
    expectError(await m.get('/claims?sort=createdAt;drop'), 400, 'validation_error');
    expectError(await m.get(`/claims?sort=${encodeURIComponent('createdAt:asc,id:desc')}`), 400, 'validation_error');
    const pct = await m.get('/claims?q=%25');
    const us = await m.get('/claims?q=_');
    const everything = (await m.get('/claims?pageSize=100')).body.total;
    expect(pct.body.total).toBeLessThan(everything);
    expect(us.body.total).toBeLessThan(everything);
    const n = await withAdmin(async (c) => (await c.query(`select count(*)::int n from claims`)).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(32); // 26 Acme + 6 Globex: nothing was dropped
  }, 120000);
});

describe('T-VAL-04 reasons and letters', () => {
  const BAD_CHARS = ['\u0000', '\u0007', '\u001f', '\u007f', '\u0085', '\u009f', '\u202a', '\u202e', '\u2066', '\u2069'];
  it('control/bidi characters in reasons -> 400 (validation precedes lookup); whitespace-only -> 400', async () => {
    const cid = await claimId(m, 'CLM-0021');
    for (const ch of BAD_CHARS) {
      const reason = `valid prefix ${ch} valid suffix`;
      expectError(await admin.patch(`/users/${RAND}/role`, { role: 'VIEWER', reason }), 400, 'validation_error');
      expectError(await admin.post(`/users/${RAND}/disable`, { reason }), 400, 'validation_error');
      expectError(await admin.post(`/users/${RAND}/enable`, { reason }), 400, 'validation_error');
      expectError(await admin.post(`/users/${RAND}/mfa/reset`, { reason }), 400, 'validation_error');
      expectError(await m.post(`/claims/${cid}/packet/revisions`, { baseRevision: 1, demandLetter: 'fine', reason }), 400, 'validation_error');
      expectError(await m.post(`/claims/${cid}/packet/approve`, { packetRevision: 1, reason }), 400, 'validation_error');
      expectError(await m.post(`/claims/${cid}/packet/reject`, { packetRevision: 1, reason }), 400, 'validation_error');
      expectError(await m.post(`/claims/${cid}/packet/send`, { packetRevision: 1, reason }), 400, 'validation_error');
    }
    const ws = '                    ';
    expectError(await admin.post(`/users/${RAND}/disable`, { reason: ws }), 400, 'validation_error');
    expect((await admin.post(`/users/${RAND}/disable`, { reason: 'clean reason text' })).status).toBe(404); // control: same route, clean reason reaches lookup
  });
  it('demand letter: controls and bidi stripped (newlines kept), never echoed', async () => {
    const cid = await claimId(m, 'CLM-0021');
    const base = (await m.get(`/claims/${cid}/packet`)).body.revision;
    const r = await m.post(`/claims/${cid}/packet/revisions`, { baseRevision: base, demandLetter: 'ab\u202Ecd\u0007ef\n\u0085gh\u2066ij\u007fkl', reason: 'strip control characters check' });
    expect(r.status, r.text).toBe(201);
    const p = (await m.get(`/claims/${cid}/packet`)).body;
    expect(p.demandLetter).toBe('abcdef\nghijkl');
    expect(JSON.stringify(p).match(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/)).toBeNull();
  });
});

describe('T-VAL-05 mass assignment', () => {
  it('extra privileged keys -> 400 and no effect', async () => {
    const cid = await claimId(m, 'CLM-0021');
    const before = JSON.stringify((await m.get(`/claims/${cid}`)).body);
    const gx = RAND;
    const cases = [
      m.post(`/claims/${cid}/assign`, { assigneeId: null, status: 'APPROVED' }),
      m.post(`/claims/${cid}/assign`, { assigneeId: null, tenantId: gx }),
      m.post(`/claims/${cid}/packet/revisions`, { baseRevision: 1, demandLetter: 'x', reason: 'mass assignment attempt', status: 'APPROVED', createdBy: gx }),
      m.post(`/claims/${cid}/packet/approve`, { packetRevision: 1, reason: 'mass assignment attempt', id: gx, status: 'SEND_READY' }),
      admin.post('/users/invites', { email: `ma-${uniq()}@acme.test`, role: 'VIEWER', tenantId: gx }),
      admin.post('/users/invites', { email: `ma-${uniq()}@acme.test`, role: 'VIEWER', status: 'ACCEPTED' }),
      admin.patch(`/users/${RAND}/role`, { role: 'VIEWER', reason: 'mass assignment attempt', id: gx }),
      admin.post(`/users/${RAND}/disable`, { reason: 'mass assignment attempt', role: 'OWNER' }),
    ];
    for (const r of await Promise.all(cases)) expectError(r, 400, 'validation_error');
    expect(JSON.stringify((await m.get(`/claims/${cid}`)).body)).toBe(before);
  });
});

describe('T-VAL-06 internal fields never leak', () => {
  it('forbidden keys absent from R15, R16, R18, R24, R26-R28, R34', async () => {
    const cid = await claimId(m, 'CLM-0001');
    const FORBIDDEN = ['passwordHash', 'tokenHash', 'ciphertext', 'nonce', 'lastUsedStep', 'password_hash', 'token_hash', 'secret', 'mfaSecret', 'refreshToken'];
    const rs = [await m.get('/me'), await admin.get('/users?pageSize=100'), await admin.get('/users/invites'), await owner.get('/audit/events?limit=100'), await m.get('/claims'), await m.get(`/claims/${cid}`), await m.get(`/claims/${cid}/packet`), await m.get('/approvals')];
    for (const r of rs) {
      expect(r.status).toBe(200);
      const keys = deepKeys(r.body);
      for (const k of FORBIDDEN) expect(keys.has(k), `key ${k}`).toBe(false);
    }
    expect(rs.map((r) => r.text).join('')).not.toMatch(/\$argon2/);
  });
});