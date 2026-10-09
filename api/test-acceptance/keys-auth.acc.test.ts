/* eslint-disable */
// T16 part 2 (T-KEY-05, 09, 10, 11): scope matrix over every contract route, indistinguishable failures, creator effects, CSRF and cookies.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ORIGIN, Client, buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let A: I.Fx;
let gxOwner: Session;
const made: string[] = [];
const mk = async (owner: Session, scopes: string[], over: Record<string, unknown> = {}) => { const m = await K.mkKey(owner, scopes, over); made.push(m.key.id); return m; };
const body = (n: string) => Buffer.from(H.invoiceTxt(H.uniqLoad(n)));

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  SS = await I.seededOn(app);
  A = await I.fixtureTenant(app, 'intel-fixture-a', 'Intel Fixture A (synthetic)');
  gxOwner = I.onApp(app, await I.baseSession(I.GLOBEX.OWNER));
}, 300000);
afterAll(async () => {
  try {
    for (const o of [SS.OWNER, gxOwner, A.owner]) await K.revokeActive(o);
    I.assertHonest('keys-auth');
  } finally {
    await closeApps();
    reseed();
  }
});

describe('T-KEY-05 scope enforcement matrix', () => {
  it('the nine key-enabled routes answer like the underlying permission; every other route in the contract is refused even for a key with all scopes', async () => {
    const kRead = await mk(SS.OWNER, ['claims.read']);
    const kExp = await mk(SS.OWNER, ['exports.claims']);
    const kImp = await mk(SS.OWNER, ['imports.write']);
    const kAll = await mk(SS.OWNER, ['claims.read', 'exports.claims', 'imports.write']);
    const claim = (await SS.VIEWER.get('/claims?pageSize=1')).body.items[0].id;
    const batch = await H.newBatch(SS.ANALYST);
    const d0 = await H.putOk(SS.ANALYST, batch, 'invoice.txt', body('K5'));
    interface R { id: string; scope: string; m: string; p: string; user: Session; raw?: () => Buffer; json?: unknown; ok: number }
    const routes: R[] = [
      { id: 'R26', scope: 'claims.read', m: 'GET', p: '/claims?pageSize=5', user: SS.VIEWER, ok: 200 },
      { id: 'R27', scope: 'claims.read', m: 'GET', p: `/claims/${claim}`, user: SS.VIEWER, ok: 200 },
      { id: 'R53', scope: 'claims.read', m: 'GET', p: `/claims/${claim}/documents`, user: SS.VIEWER, ok: 200 },
      { id: 'R54', scope: 'exports.claims', m: 'GET', p: '/exports/claims?format=csv', user: SS.ANALYST, ok: 200 },
      { id: 'R40', scope: 'imports.write', m: 'POST', p: '/imports', user: SS.ANALYST, json: { label: 'matrix' }, ok: 201 },
      { id: 'R41', scope: 'imports.write', m: 'GET', p: '/imports', user: SS.ANALYST, ok: 200 },
      { id: 'R42', scope: 'imports.write', m: 'GET', p: `/imports/${batch}`, user: SS.ANALYST, ok: 200 },
      { id: 'R43', scope: 'imports.write', m: 'POST', p: `/imports/${batch}/documents?filename=invoice.txt`, user: SS.ANALYST, raw: () => body('K5u'), ok: 201 },
      { id: 'R44', scope: 'imports.write', m: 'GET', p: `/imports/${batch}/documents/${d0.id}`, user: SS.ANALYST, ok: 200 },
    ];
    const keys: Array<[string, K.Made, string[]]> = [['K_read', kRead, ['claims.read']], ['K_exp', kExp, ['exports.claims']], ['K_imp', kImp, ['imports.write']], ['K_all', kAll, ['claims.read', 'exports.claims', 'imports.write']]];
    for (const r of routes) {
      const userRes = r.m === 'POST' && r.raw ? await H.upload(r.user, batch, 'invoice.txt', r.raw()) : await r.user.as(r.m, r.p, r.json === undefined ? {} : { body: r.json });
      expect(userRes.status, `user baseline ${r.id}: ${userRes.text.slice(0, 200)}`).toBe(r.ok);
      for (const [label, key, scopes] of keys) {
        const res = await K.keyReq(app, key.secret, r.m, r.p, r.raw ? { raw: r.raw() } : r.json === undefined ? {} : { body: r.json });
        if (scopes.includes(r.scope)) {
          expect(res.status, `${label} ${r.id}: ${res.text.slice(0, 200)}`).toBe(r.ok);
          if (userRes.body && typeof userRes.body === 'object' && !Array.isArray(userRes.body)) expect(Object.keys(res.body ?? {}).sort(), `${label} ${r.id} body shape`).toEqual(Object.keys(userRes.body).sort());
          if (r.id === 'R54') expect(res.headers['content-type']).toBe(userRes.headers['content-type']);
        } else {
          expectError(res, 403, 'forbidden');
        }
      }
    }
    const u = I.RAND_UUID;
    const other: Array<[string, string, string, unknown?]> = [
      ['R16', 'GET', '/users'], ['R17', 'POST', '/users/invites', { email: 'k5@acme.test', role: 'VIEWER' }], ['R18', 'GET', '/users/invites'], ['R19', 'DELETE', `/users/invites/${u}`],
      ['R20', 'PATCH', `/users/${u}/role`, { role: 'VIEWER', reason: 'matrix probe reason' }], ['R21', 'POST', `/users/${u}/disable`, { reason: 'matrix probe reason' }], ['R22', 'POST', `/users/${u}/enable`, { reason: 'matrix probe reason' }], ['R23', 'POST', `/users/${u}/mfa/reset`, { reason: 'matrix probe reason' }],
      ['R24', 'GET', '/audit/events'], ['R25', 'GET', '/audit/verify'],
      ['R28', 'GET', `/claims/${claim}/packet`], ['R29', 'POST', `/claims/${claim}/assign`, { assigneeId: null }], ['R30', 'POST', `/claims/${claim}/packet/revisions`, { baseRevision: 1, demandLetter: 'x', reason: 'matrix probe reason' }],
      ['R31', 'POST', `/claims/${claim}/packet/approve`, { packetRevision: 1, reason: 'matrix probe reason' }], ['R32', 'POST', `/claims/${claim}/packet/reject`, { packetRevision: 1, reason: 'matrix probe reason' }], ['R33', 'POST', `/claims/${claim}/packet/send`, { packetRevision: 1, reason: 'matrix probe reason' }],
      ['R34', 'GET', '/approvals'], ['R35', 'GET', '/platform/health'], ['R36', 'GET', '/platform/tenants'], ['R37', 'GET', `/platform/tenants/${u}/claims?reason=matrix+probe+reason`],
      ['R45', 'GET', `/imports/${batch}/documents/${d0.id}/original`], ['R46', 'PATCH', `/imports/${batch}/documents/${d0.id}`, { docType: 'INVOICE' }], ['R47', 'POST', `/imports/${batch}/documents/${d0.id}/fields`, { key: 'invoice.total', value: '1.00', reason: 'matrix probe reason' }],
      ['R48', 'POST', `/imports/${batch}/documents/${d0.id}/fields/${u}/resolve`, { action: 'CONFIRM', reason: 'matrix probe reason' }], ['R49', 'POST', `/imports/${batch}/documents/${d0.id}/accept`, { reason: 'matrix probe reason' }], ['R50', 'POST', `/imports/${batch}/documents/${d0.id}/reject`, { reason: 'matrix probe reason' }],
      ['R51', 'GET', '/reviews'], ['R52', 'POST', `/imports/${batch}/commit`, { perspective: 'SHIPPER' }],
      ['R55', 'GET', '/exports/packets?format=csv'], ['R56', 'GET', '/exports/outcomes?format=csv'],
      ['R60', 'GET', '/platform/pipeline'], ['R61', 'GET', '/platform/telemetry'], ['R62', 'GET', '/platform/logs'], ['R63', 'GET', '/platform/flags'], ['R64', 'PUT', '/platform/flags/intelligence.worklist', { enabled: false, expectedVersion: 1, reason: 'matrix probe reason' }],
      ['R65', 'GET', '/platform/eval/runs'], ['R66', 'GET', `/platform/eval/runs/${u}`], ['R67', 'GET', '/platform/audit/events'], ['R68', 'GET', '/platform/audit/verify'],
      ['R70', 'GET', '/features'], ['R71', 'GET', '/intelligence/worklist'], ['R72', 'GET', `/claims/${claim}/similar`], ['R73', 'GET', `/claims/${claim}/provenance`],
      ['R80', 'POST', '/api-keys', { name: 'x', scopes: ['claims.read'] }], ['R81', 'GET', '/api-keys'], ['R82', 'POST', `/api-keys/${kRead.key.id}/revoke`, { reason: 'matrix probe reason' }],
      ['R15', 'GET', '/me'], ['R14', 'POST', '/auth/change-password', { currentPassword: 'x', newPassword: 'y' }],
    ];
    for (const [id, m, p, b] of other) {
      const res = await K.keyReq(app, kAll.secret, m, p, b === undefined ? {} : { body: b });
      expect(res.status, `${id} ${m} ${p} with K_all: ${res.text.slice(0, 200)}`).toBe(403);
      expect(res.body?.error?.code, id).toBe('forbidden');
    }
    const refresh = await K.keyReq(app, kAll.secret, 'POST', '/auth/refresh', { body: {} });
    expect([401, 403], 'a key must not authenticate anything on the auth routes (spec: 403, or 401 for public routes)').toContain(refresh.status);
    expect(refresh.setCookies).toEqual([]);
    expect((await SS.OWNER.get('/api-keys')).body.items.find((x: any) => x.id === kRead.key.id).status).toBe('ACTIVE');
  }, 300000);
});
describe('T-KEY-09 failure indistinguishability', () => {
  it('every kind of authentication failure answers with the same 401; a missing scope is a distinct 403', async () => {
    const { s: admin } = await K.newSession(app, A.owner, 'ADMIN');
    const outcomes: Array<[string, any]> = [];
    outcomes.push(['unknown key id', await K.keyReq(app, K.fakeKey('0123456789abcdef'), 'GET', '/claims')]);
    const real = await mk(A.owner, ['claims.read']);
    const { keyId } = K.splitKey(real.secret);
    outcomes.push(['wrong secret', await K.keyReq(app, `fr_live_${keyId}_${'Q'.repeat(43)}`, 'GET', '/claims')]);
    outcomes.push(['malformed', await K.keyReq(app, 'fr_live_x', 'GET', '/claims')]);
    const revoked = await mk(A.owner, ['claims.read']);
    expect((await A.owner.post(`/api-keys/${revoked.key.id}/revoke`, { reason: 'indistinguishability probe' })).status).toBe(200);
    outcomes.push(['revoked', await K.keyReq(app, revoked.secret, 'GET', '/claims')]);
    const expired = await mk(A.owner, ['claims.read']);
    await withAdmin(async (c) => { await c.query('ALTER TABLE api_keys DISABLE TRIGGER USER'); try { await c.query(`update api_keys set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = $1`, [expired.key.id]); } finally { await c.query('ALTER TABLE api_keys ENABLE TRIGGER USER'); } });
    outcomes.push(['expired', await K.keyReq(app, expired.secret, 'GET', '/claims')]);
    const byAdmin = await mk(admin, ['claims.read']);
    expect((await A.owner.post(`/users/${admin.user.id}/disable`, { reason: 'indistinguishability probe' })).status).toBe(200);
    outcomes.push(['creator disabled', await K.keyReq(app, byAdmin.secret, 'GET', '/claims')]);
    const gxKey = await mk(gxOwner, ['claims.read']);
    expect((await K.keyReq(app, gxKey.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    await withAdmin((c) => c.query(`update tenants set status='SUSPENDED' where id=$1`, [gxOwner.user.tenant.id]));
    try {
      outcomes.push(['tenant suspended', await K.keyReq(app, gxKey.secret, 'GET', '/claims')]);
    } finally {
      await withAdmin((c) => c.query(`update tenants set status='ACTIVE' where id=$1`, [gxOwner.user.tenant.id]));
    }
    const ref = outcomes[0]![1];
    expectError(ref, 401, 'unauthenticated');
    for (const [label, r] of outcomes) {
      expect(r.status, label).toBe(401);
      expect(I.stripReq(r.body), label).toEqual(I.stripReq(ref.body));
      const [x, y] = K.sameHeaders(ref, r);
      expect(y, `${label} headers`).toEqual(x);
      expect(r.setCookies, label).toEqual([]);
    }
    const noScope = await K.keyReq(app, real.secret, 'GET', '/imports');
    expectError(noScope, 403, 'forbidden');
    expect(I.stripReq(noScope.body)).not.toEqual(I.stripReq(ref.body));
    expect((await A.owner.post(`/users/${admin.user.id}/enable`, { reason: 'indistinguishability cleanup' })).status).toBe(200);
  }, 240000);
});

describe('T-KEY-10 creator effects', () => {
  it('demotion keeps a key only while the creator still holds the underlying permission; disabling the creator stops it, re-enabling restores it', async () => {
    const { s: admin } = await K.newSession(app, A.owner, 'ADMIN');
    const kc = await mk(admin, ['claims.read']);
    const ki = await mk(admin, ['imports.write']);
    expect((await K.keyReq(app, kc.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    expect((await K.keyReq(app, ki.secret, 'GET', '/imports')).status).toBe(200);
    const demote = await A.owner.patch(`/users/${admin.user.id}/role`, { role: 'VIEWER', reason: 'creator effects probe' });
    expect(demote.status, demote.text).toBe(200);
    expect((await K.keyReq(app, kc.secret, 'GET', '/claims?pageSize=1')).status, 'claims.read survives (VIEWER holds claims:read)').toBe(200);
    expectError(await K.keyReq(app, ki.secret, 'GET', '/imports'), 401, 'unauthenticated');
    const off = await A.owner.post(`/users/${admin.user.id}/disable`, { reason: 'creator effects probe' });
    expect(off.status, off.text).toBe(200);
    expectError(await K.keyReq(app, kc.secret, 'GET', '/claims?pageSize=1'), 401, 'unauthenticated');
    const on = await A.owner.post(`/users/${admin.user.id}/enable`, { reason: 'creator effects restore' });
    expect(on.status, on.text).toBe(200);
    expect((await K.keyReq(app, kc.secret, 'GET', '/claims?pageSize=1')).status, 'keys are not revoked implicitly').toBe(200);
    expect((await A.owner.get('/api-keys')).body.items.find((x: any) => x.id === kc.key.id).status).toBe('ACTIVE');
  }, 240000);
  it.skip('a scope above the creator permissions cannot be requested: not testable because OWNER and ADMIN hold all three underlying permissions', () => undefined);
});

describe('T-KEY-11 CSRF and cookies', () => {
  it('key requests need no CSRF and set no cookies; user requests still need CSRF; mixed credentials never fall back; Origin is still checked', async () => {
    const imp = await mk(SS.OWNER, ['imports.write']);
    const r = await K.keyReq(app, imp.secret, 'POST', '/imports', { body: { label: 'no csrf needed' } });
    expect(r.status, r.text).toBe(201);
    expect(r.setCookies).toEqual([]);
    expect(r.headers['set-cookie']).toBeUndefined();
    expectError(await SS.ANALYST.post('/imports', { label: 'user needs csrf' }, { csrf: false }), 403, 'csrf_failed');
    const withCsrfCookie = await K.keyReq(app, imp.secret, 'POST', '/imports', { body: { label: 'cookie present' }, headers: { cookie: 'fr_csrf=abc.def' } });
    expect(withCsrfCookie.status).toBe(201);
    const bad = K.fakeKey();
    const mixed = await SS.ANALYST.client.send('GET', '/claims', { headers: { authorization: `Bearer ${bad}`, 'x-access-token': SS.ANALYST.token, 'x-auth-token': SS.ANALYST.token } });
    expectError(mixed, 401, 'unauthenticated');
    const mixedPost = await SS.ANALYST.client.send('POST', '/imports', { body: { label: 'mixed' }, headers: { authorization: `Bearer ${bad}` } });
    expectError(mixedPost, 401, 'unauthenticated');
    const evil = await K.keyReq(app, imp.secret, 'POST', '/imports', { body: { label: 'evil origin' }, headers: { origin: 'https://evil.example' } });
    expectError(evil, 403, 'origin_not_allowed');
    const good = await K.keyReq(app, imp.secret, 'POST', '/imports', { body: { label: 'own origin' }, headers: { origin: APP_ORIGIN } });
    expect(good.status, good.text).toBe(201);
  }, 120000);
});