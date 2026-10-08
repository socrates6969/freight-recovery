/* eslint-disable */
// T-CSRF-01..03
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, APP_ORIGIN, Client, buildTestApp, claimId, closeApps, expectError, sessionFor, type RoleName } from './helpers/client.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
});
afterAll(closeApps);

const RAND = '00000000-0000-4000-8000-0000000000aa';
interface Case { id: string; method: string; path: (c: Record<string, string>) => string; body?: (c: Record<string, string>) => unknown; role: RoleName }

// Well-formed bodies that are harmless when the CSRF check passes (they fail later: 401/404/409/422).
const CASES: Case[] = [
  { id: 'R4 login', method: 'POST', path: () => '/auth/login', body: () => ({ email: 'nobody@acme.test', password: 'Wrong-Password-1234!' }), role: 'MANAGER' },
  { id: 'R5 mfa verify', method: 'POST', path: () => '/auth/mfa/verify', body: () => ({ mfaToken: 'x'.repeat(43), code: '123456' }), role: 'MANAGER' },
  { id: 'R6 enroll start', method: 'POST', path: () => '/auth/mfa/enroll/start', body: () => ({ enrollToken: 'x'.repeat(43) }), role: 'MANAGER' },
  { id: 'R7 enroll verify', method: 'POST', path: () => '/auth/mfa/enroll/verify', body: () => ({ enrollToken: 'x'.repeat(43), code: '123456' }), role: 'MANAGER' },
  { id: 'R8 refresh', method: 'POST', path: () => '/auth/refresh', body: () => ({}), role: 'MANAGER' },
  { id: 'R9 logout', method: 'POST', path: () => '/auth/logout', body: () => ({}), role: 'MANAGER' },
  { id: 'R10 forgot', method: 'POST', path: () => '/auth/forgot', body: () => ({ email: 'nobody@acme.test' }), role: 'MANAGER' },
  { id: 'R11 reset', method: 'POST', path: () => '/auth/reset', body: () => ({ token: 'x'.repeat(43), password: 'Another-Long-Pass-77!' }), role: 'MANAGER' },
  { id: 'R12 invite inspect', method: 'POST', path: () => '/auth/invites/inspect', body: () => ({ token: 'x'.repeat(43) }), role: 'MANAGER' },
  { id: 'R13 invite accept', method: 'POST', path: () => '/auth/invites/accept', body: () => ({ token: 'x'.repeat(43), name: 'Nobody', password: 'Another-Long-Pass-77!' }), role: 'MANAGER' },
  { id: 'R14 change password', method: 'POST', path: () => '/auth/change-password', body: () => ({ currentPassword: 'Wrong-Password-1234!', newPassword: 'Another-Long-Pass-77!' }), role: 'MANAGER' },
  { id: 'R17 invite', method: 'POST', path: () => '/users/invites', body: () => ({ email: 'csrf-never@acme.test', role: 'NOT_A_ROLE' }), role: 'ADMIN' },
  { id: 'R19 revoke invite', method: 'DELETE', path: () => `/users/invites/${RAND}`, role: 'ADMIN' },
  { id: 'R20 role', method: 'PATCH', path: () => `/users/${RAND}/role`, body: () => ({ role: 'VIEWER', reason: 'csrf probe reason' }), role: 'ADMIN' },
  { id: 'R21 disable', method: 'POST', path: () => `/users/${RAND}/disable`, body: () => ({ reason: 'csrf probe reason' }), role: 'ADMIN' },
  { id: 'R22 enable', method: 'POST', path: () => `/users/${RAND}/enable`, body: () => ({ reason: 'csrf probe reason' }), role: 'ADMIN' },
  { id: 'R23 mfa reset', method: 'POST', path: () => `/users/${RAND}/mfa/reset`, body: () => ({ reason: 'csrf probe reason' }), role: 'ADMIN' },
  { id: 'R29 assign', method: 'POST', path: (c) => `/claims/${c.claim}/assign`, body: () => ({ assigneeId: RAND }), role: 'MANAGER' },
  { id: 'R30 revision', method: 'POST', path: (c) => `/claims/${c.claim}/packet/revisions`, body: () => ({ baseRevision: 9999, demandLetter: 'csrf probe letter', reason: 'csrf probe reason' }), role: 'MANAGER' },
  { id: 'R31 approve', method: 'POST', path: (c) => `/claims/${c.claim}/packet/approve`, body: () => ({ packetRevision: 9999, reason: 'csrf probe reason' }), role: 'MANAGER' },
  { id: 'R32 reject', method: 'POST', path: (c) => `/claims/${c.claim}/packet/reject`, body: () => ({ packetRevision: 9999, reason: 'csrf probe reason' }), role: 'MANAGER' },
  { id: 'R33 send', method: 'POST', path: (c) => `/claims/${c.claim}/packet/send`, body: () => ({ packetRevision: 9999, reason: 'csrf probe reason' }), role: 'MANAGER' },
];

describe('T-CSRF-01 every unsafe-method route enforces the double-submit token', () => {
  let ctx: Record<string, string> = {};
  beforeAll(async () => {
    const m = await sessionFor(app, ACCOUNTS.MANAGER);
    ctx = { claim: await claimId(m, 'CLM-0010') };
  });
  for (const k of CASES) {
    it(k.id, async () => {
      const s = await sessionFor(app, ACCOUNTS[k.role]);
      const run = (csrf: any) => {
        const c = new Client(app);
        return c.send(k.method, k.path(ctx), { token: s.token, body: k.body?.(ctx), csrf });
      };
      for (const mode of [false, 'header-only', 'mismatch', 'tamper'] as const) {
        const r = await run(mode);
        expectError(r, 403, 'csrf_failed');
      }
      const ok = await run('auto');
      expect(ok.body?.error?.code, `${k.id} with valid pair: ${ok.text}`).not.toBe('csrf_failed');
    });
  }
  it('safe methods need no token', async () => {
    const s = await sessionFor(app, ACCOUNTS.MANAGER);
    expect((await new Client(app).get('/me', { token: s.token })).status).toBe(200);
  });
  it('rejected approve leaves the claim untouched (valid body, bad token)', async () => {
    const m = await sessionFor(app, ACCOUNTS.MANAGER);
    const id = ctx.claim!;
    const before = await m.get(`/claims/${id}`);
    const r = await new Client(app).post(`/claims/${id}/packet/approve`, { packetRevision: 1, reason: 'csrf negative must not apply' }, { token: m.token, csrf: 'tamper' });
    expectError(r, 403, 'csrf_failed');
    const after = await m.get(`/claims/${id}`);
    expect(after.body.status).toBe(before.body.status);
    expect(after.body.status).toBe('PENDING_REVIEW');
    expect(after.body.updatedAt).toBe(before.body.updatedAt);
    const pk = await m.get(`/claims/${id}/packet`);
    expect(pk.body.approvals.filter((a: any) => a.action === 'APPROVE')).toHaveLength(0);
  });
});

describe('T-CSRF-02 Origin and Fetch-Metadata', () => {
  const probe = (headers: Record<string, string>, csrf: any = 'auto') =>
    new Client(app).post('/auth/forgot', { email: 'nobody@acme.test' }, { headers, csrf });
  it('foreign Origin is rejected before CSRF, matching Origin and same-origin/none are allowed', async () => {
    expectError(await probe({ origin: 'https://evil.example' }), 403, 'origin_not_allowed');
    expectError(await probe({ origin: 'https://evil.example' }, false), 403, 'origin_not_allowed'); // checked first
    expect((await probe({ origin: APP_ORIGIN })).status).toBe(202);
    expect((await probe({ 'sec-fetch-site': 'same-origin' })).status).toBe(202);
    expect((await probe({ 'sec-fetch-site': 'none' })).status).toBe(202);
    const cross = await probe({ 'sec-fetch-site': 'cross-site' });
    expect(cross.status).toBe(403);
    expect(['origin_not_allowed', 'csrf_failed']).toContain(cross.body.error.code);
  });
});

describe('T-CSRF-03 CORS', () => {
  it('no Access-Control-Allow-* on GET with foreign Origin; OPTIONS preflight not permissive', async () => {
    const g = await new Client(app).get('/healthz', { headers: { origin: 'https://evil.example' } });
    for (const k of Object.keys(g.headers)) expect(k.toLowerCase().startsWith('access-control-')).toBe(false);
    const g2 = await new Client(app).get('/auth/csrf', { headers: { origin: 'https://evil.example' } });
    expect(g2.headers['access-control-allow-origin']).toBeUndefined();
    const o = await app.inject({ method: 'OPTIONS', url: '/api/v1/auth/login', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    for (const k of Object.keys(o.headers)) expect(k.toLowerCase().startsWith('access-control-allow-')).toBe(false);
    expect(o.statusCode).toBeGreaterThanOrEqual(400);
    // positive control: same-origin GET works
    expect((await new Client(app).get('/healthz', { headers: { origin: APP_ORIGIN } })).status).toBe(200);
  });
});