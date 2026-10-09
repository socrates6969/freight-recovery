/* eslint-disable */
// T16 part 1 (T-KEY-01..04, 06..08): management RBAC, one-time reveal, hash-only storage, validation, isolation, revocation, expiry.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import { dumpAllText, tryQuery, withAdmin, withTriggersOff, appDb, inRollback, buildInsert } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let F: I.Fx; // fixture tenant: starts with zero keys
let gxOwner: Session;
const made: Array<{ owner: Session; id: string }> = [];
const track = (owner: Session, m: K.Made) => { made.push({ owner, id: m.key.id }); return m; };
const mk = async (owner: Session, scopes: string[], over: Record<string, unknown> = {}) => track(owner, await K.mkKey(owner, scopes, over));

beforeAll(async () => {
  app = await buildTestApp();
  SS = await I.seededOn(app);
  F = await I.fixtureTenant(app, 'intel-fixture-b', 'Intel Fixture B (synthetic)');
  gxOwner = I.onApp(app, await I.baseSession(I.GLOBEX.OWNER));
}, 300000);
afterAll(async () => {
  try {
    for (const o of [SS.OWNER, gxOwner, F.owner]) await K.revokeActive(o);
    I.assertHonest('keys-mgmt');
  } finally {
    await closeApps();
    reseed();
  }
});

describe('T-KEY-01 management RBAC', () => {
  it('only OWNER and ADMIN manage keys; others and platform roles get 403; anonymous 401; CSRF applies; a key cannot manage keys', async () => {
    const target = await mk(SS.OWNER, ['claims.read']);
    const t2 = await mk(SS.OWNER, ['claims.read']);
    const t3 = await mk(SS.OWNER, ['claims.read']);
    for (const role of ['OWNER', 'ADMIN'] as RoleName[]) {
      const c = await SS[role].post('/api-keys', { name: `rbac ${role}`, scopes: ['claims.read'], expiresInDays: 30 });
      expect(c.status, `${role}: ${c.text}`).toBe(201);
      made.push({ owner: SS.OWNER, id: c.body.key.id });
      expect((await SS[role].get('/api-keys')).status).toBe(200);
    }
    expect((await SS.OWNER.post(`/api-keys/${target.key.id}/revoke`, { reason: 'rbac owner revoke' })).status).toBe(200);
    expect((await SS.ADMIN.post(`/api-keys/${t2.key.id}/revoke`, { reason: 'rbac admin revoke' })).status).toBe(200);
    for (const role of ['MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN'] as RoleName[]) {
      expectError(await SS[role].post('/api-keys', { name: 'x', scopes: ['claims.read'] }), 403, 'forbidden');
      expectError(await SS[role].get('/api-keys'), 403, 'forbidden');
      expectError(await SS[role].post(`/api-keys/${t3.key.id}/revoke`, { reason: 'not allowed to revoke' }), 403, 'forbidden');
    }
    const anon = new Client(app);
    expectError(await anon.post('/api-keys', { name: 'x', scopes: ['claims.read'] }), 401, 'unauthenticated');
    expectError(await anon.get('/api-keys'), 401, 'unauthenticated');
    expectError(await anon.post(`/api-keys/${t3.key.id}/revoke`, { reason: 'anonymous attempt' }), 401, 'unauthenticated');
    expectError(await SS.OWNER.post('/api-keys', { name: 'no csrf', scopes: ['claims.read'] }, { csrf: false }), 403, 'csrf_failed');
    expectError(await SS.OWNER.post(`/api-keys/${t3.key.id}/revoke`, { reason: 'no csrf revoke' }, { csrf: false }), 403, 'csrf_failed');
    const all = await mk(SS.OWNER, ['claims.read', 'exports.claims', 'imports.write']);
    expectError(await K.keyReq(app, all.secret, 'POST', '/api-keys', { body: { name: 'by key', scopes: ['claims.read'] } }), 403, 'forbidden');
    expectError(await K.keyReq(app, all.secret, 'GET', '/api-keys'), 403, 'forbidden');
    expectError(await K.keyReq(app, all.secret, 'POST', `/api-keys/${t3.key.id}/revoke`, { body: { reason: 'revoked by a key' } }), 403, 'forbidden');
    expect((await SS.OWNER.get('/api-keys')).body.items.find((x: any) => x.id === t3.key.id).status).toBe('ACTIVE');
  }, 120000);
});

describe('T-KEY-02 creation and one-time reveal', () => {
  it('201 returns the secret once; nothing else ever returns it', async () => {
    const a = await mk(SS.OWNER, ['claims.read'], { name: 'ci upload', expiresInDays: 30 });
    const { key, secret, res } = a;
    expect(Object.keys(res.body).sort()).toEqual(['key', 'secret']);
    expect(secret.length).toBe(68);
    expect(key.keyId).toBe(`fr_live_${K.splitKey(secret).keyId}`);
    expect(Object.keys(key).sort()).toEqual(['createdAt', 'createdBy', 'expiresAt', 'id', 'keyId', 'lastUsedAt', 'name', 'revokeReason', 'revokedAt', 'revokedBy', 'scopes', 'status']);
    expect(key.status).toBe('ACTIVE');
    expect(key.name).toBe('ci upload');
    expect(key.scopes).toEqual(['claims.read']);
    expect(Math.abs(Date.parse(key.expiresAt) - (Date.now() + 30 * 86400_000))).toBeLessThan(60_000);
    expect(key.lastUsedAt).toBeNull();
    expect(key.createdBy).toEqual({ id: SS.OWNER.user.id, name: SS.OWNER.user.name });
    const b = await mk(SS.OWNER, ['claims.read']);
    expect(b.secret).not.toBe(secret);
    expect(b.key.keyId).not.toBe(key.keyId);
    const { secret: s43 } = K.splitKey(secret);
    const texts = [(await SS.OWNER.get('/api-keys')).text, (await SS.OWNER.post(`/api-keys/${b.key.id}/revoke`, { reason: 'one time reveal check' })).text, (await SS.ADMIN.get('/api-keys')).text];
    for (const t of texts) {
      expect(t.includes(secret)).toBe(false);
      for (let i = 0; i + 10 <= s43.length; i++) expect(t.includes(s43.slice(i, i + 10)), `secret window ${i}`).toBe(false);
      expect(/secretHash|secret_hash/.test(t)).toBe(false);
    }
  });
});

describe('T-KEY-03 hash-only storage', () => {
  it('only the HMAC digest is stored; the full key never reaches the database dump, audit rows, logs or the log view', async () => {
    const { app: la, lines } = await I.buildLogged();
    const owner = I.onApp(la, SS.OWNER);
    const dev = I.onApp(la, SS.PLATFORM_DEV);
    const m = await mk(owner, ['claims.read']);
    const { keyId, secret } = K.splitKey(m.secret);
    expect((await K.keyReq(la, m.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    expect((await K.keyReq(la, `fr_live_${keyId}_${'Q'.repeat(43)}`, 'GET', '/claims')).status).toBe(401);
    const row = await withAdmin(async (c) => (await c.query(`select secret_hash from api_keys where key_id=$1`, [keyId])).rows[0]);
    expect(row.secret_hash).toBe(K.hmacHex(secret));
    expect(row.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = await dumpAllText();
    expect(dump.includes(m.secret)).toBe(false);
    expect(dump.includes(secret)).toBe(false);
    const view = await dev.get('/platform/logs?level=trace&limit=200');
    const raw = lines.join('\n');
    for (const t of [view.text, raw]) {
      expect(t.includes(m.secret)).toBe(false);
      expect(t.includes(secret)).toBe(false);
    }
    await la.close();
  }, 120000);
});

describe('T-KEY-04 validation, expiry defaults and quota', () => {
  it('invalid bodies are rejected', async () => {
    const ok = { name: 'valid', scopes: ['claims.read'], expiresInDays: 30 };
    const bad: Array<[string, any]> = [
      ['missing name', { scopes: ok.scopes }], ['empty name', { ...ok, name: '' }], ['81-char name', { ...ok, name: 'n'.repeat(81) }], ['newline in name', { ...ok, name: 'a\nb' }],
      ['empty scopes', { ...ok, scopes: [] }], ['duplicate scopes', { ...ok, scopes: ['claims.read', 'claims.read'] }], ['unknown scope', { ...ok, scopes: ['claims.write'] }],
      ['more than 3 scopes', { ...ok, scopes: ['claims.read', 'exports.claims', 'imports.write', 'claims.read'] }],
      ['expiresInDays 0', { ...ok, expiresInDays: 0 }], ['expiresInDays 366', { ...ok, expiresInDays: 366 }], ['expiresInDays 1.5', { ...ok, expiresInDays: 1.5 }], ['extra key tenantId', { ...ok, tenantId: F.id }],
    ];
    for (const [label, b] of bad) expectError(await F.owner.post('/api-keys', b), 400, 'validation_error');
    expect((await F.owner.get('/api-keys')).body.items.filter((k: any) => k.status === 'ACTIVE').length).toBe(0);
  });
  it('null expiry is governed by API_KEY_ALLOW_NON_EXPIRING; the default TTL follows API_KEY_DEFAULT_TTL_DAYS', async () => {
    const yes = await buildTestApp({ API_KEY_ALLOW_NON_EXPIRING: 'true', API_KEY_DEFAULT_TTL_DAYS: '7' });
    const no = await buildTestApp({ API_KEY_ALLOW_NON_EXPIRING: 'false' });
    const r1 = await I.onApp(yes, F.owner).post('/api-keys', { name: 'never expires', scopes: ['claims.read'], expiresInDays: null });
    expect(r1.status, r1.text).toBe(201);
    expect(r1.body.key.expiresAt).toBeNull();
    made.push({ owner: F.owner, id: r1.body.key.id });
    expectError(await I.onApp(no, F.owner).post('/api-keys', { name: 'never expires', scopes: ['claims.read'], expiresInDays: null }), 400, 'validation_error');
    const r2 = await I.onApp(yes, F.owner).post('/api-keys', { name: 'default ttl', scopes: ['claims.read'] });
    expect(r2.status, r2.text).toBe(201);
    made.push({ owner: F.owner, id: r2.body.key.id });
    expect(Math.abs(Date.parse(r2.body.key.expiresAt) - (Date.now() + 7 * 86400_000))).toBeLessThan(60_000);
    await K.revokeActive(F.owner);
  }, 60000);
  it('API_KEY_MAX_ACTIVE=2: the third active key is refused, revoking frees a slot, and 5 concurrent creations yield exactly 2', async () => {
    const q = await buildTestApp({ API_KEY_MAX_ACTIVE: '2' });
    const owner = I.onApp(q, F.owner);
    await K.revokeActive(F.owner);
    const k1 = await K.mkKey(owner, ['claims.read']);
    await K.mkKey(owner, ['claims.read']);
    expectError(await owner.post('/api-keys', { name: 'third', scopes: ['claims.read'], expiresInDays: 30 }), 422, 'quota_exceeded');
    expect((await owner.post(`/api-keys/${k1.key.id}/revoke`, { reason: 'free a slot for quota' })).status).toBe(200);
    expect((await owner.post('/api-keys', { name: 'third again', scopes: ['claims.read'], expiresInDays: 30 })).status).toBe(201);
    await K.revokeActive(owner);
    await owner.client.ensureCsrf();
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => owner.post('/api-keys', { name: `race ${i}`, scopes: ['claims.read'], expiresInDays: 30 })));
    expect(rs.filter((r) => r.status === 201).length, rs.map((r) => r.status).join(',')).toBe(2);
    expect(rs.filter((r) => r.status === 422).length).toBe(3);
    await K.revokeActive(owner);
  }, 120000);
});
describe('T-KEY-06 tenant derivation and isolation', () => {
  it('an Acme key sees only Acme; foreign ids look unknown; smuggled tenant hints change nothing; uploads stay in Acme', async () => {
    await H.assertS3Reachable();
    const readKey = await mk(SS.OWNER, ['claims.read']);
    const impKey = await mk(SS.OWNER, ['imports.write']);
    const gxClaims = await gxOwner.get('/claims?pageSize=1');
    const gxId = gxClaims.body.items[0].id;
    const user = async (page: number) => (await SS.VIEWER.get(`/claims?pageSize=100&page=${page}`)).body.items.map((c: any) => c.id);
    const viaKey = async (page: number) => (await K.keyReq(app, readKey.secret, 'GET', `/claims?pageSize=100&page=${page}`)).body.items.map((c: any) => c.id);
    expect(await viaKey(1)).toEqual(await user(1));
    expect(await viaKey(1)).not.toContain(gxId);
    const hdr = await K.keyReq(app, readKey.secret, 'GET', '/claims?pageSize=100', { headers: { 'x-tenant-id': gxId } });
    expect(hdr.body.items.map((c: any) => c.id)).toEqual(await user(1));
    expectError(await K.keyReq(app, readKey.secret, 'GET', `/claims?tenantId=${F.id}`), 400, 'validation_error');
    const unknown = await K.keyReq(app, readKey.secret, 'GET', `/claims/${I.RAND_UUID}`);
    for (const p of [`/claims/${gxId}`, `/claims/${gxId}/documents`]) {
      const r = await K.keyReq(app, readKey.secret, 'GET', p);
      expect(r.status).toBe(404);
      if (p.endsWith(gxId)) expect(I.stripReq(r.body)).toEqual(I.stripReq(unknown.body));
    }
    const batch = await K.keyReq(app, impKey.secret, 'POST', '/imports', { body: { label: 'via key' } });
    expect(batch.status, batch.text).toBe(201);
    const up = await K.keyReq(app, impKey.secret, 'POST', `/imports/${batch.body.id}/documents?filename=${encodeURIComponent('invoice.txt')}`, { raw: Buffer.from(H.invoiceTxt(H.uniqLoad('KT'))) });
    expect(up.status, up.text).toBe(201);
    expect((await SS.ANALYST.get(`/imports/${batch.body.id}/documents/${up.body.id}`)).status).toBe(200);
    expectError(await gxOwner.get(`/imports/${batch.body.id}/documents/${up.body.id}`), 404, 'not_found');
    expectError(await I.onApp(app, await I.baseSession(I.GLOBEX.MANAGER)).get(`/imports/${batch.body.id}`), 404, 'not_found');
    const gxRevoke = await gxOwner.post(`/api-keys/${readKey.key.id}/revoke`, { reason: 'cross tenant revoke attempt' });
    expectError(gxRevoke, 404, 'not_found');
    expect((await K.keyReq(app, readKey.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    const unk = await gxOwner.post(`/api-keys/${I.RAND_UUID}/revoke`, { reason: 'unknown key id attempt' });
    expect(I.stripReq(gxRevoke.body)).toEqual(I.stripReq(unk.body));
    const gxList = (await gxOwner.get('/api-keys')).body.items.map((k: any) => k.id);
    expect(gxList).not.toContain(readKey.key.id);
    expect(gxList).not.toContain(impKey.key.id);
  }, 120000);
});

describe('T-KEY-07 revocation is immediate', () => {
  it('the very next request fails, on this and on a second instance; revocation cannot be undone', async () => {
    const other = await buildTestApp();
    const k = await mk(SS.OWNER, ['claims.read']);
    expect((await K.keyReq(app, k.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    expect((await K.keyReq(other, k.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    expectError(await SS.OWNER.post(`/api-keys/${k.key.id}/revoke`, { reason: 'short' }), 400, 'validation_error');
    const r = await SS.OWNER.post(`/api-keys/${k.key.id}/revoke`, { reason: '0123456789' });
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe('REVOKED');
    expect(r.body.revokedBy).toEqual({ id: SS.OWNER.user.id, name: SS.OWNER.user.name });
    expect(r.body.revokeReason).toBe('0123456789');
    expect(r.body.revokedAt).toBeTruthy();
    expectError(await K.keyReq(app, k.secret, 'GET', '/claims?pageSize=1'), 401, 'unauthenticated');
    expectError(await K.keyReq(other, k.secret, 'GET', '/claims?pageSize=1'), 401, 'unauthenticated');
    expectError(await SS.OWNER.post(`/api-keys/${k.key.id}/revoke`, { reason: 'second revoke attempt' }), 409, 'invalid_state');
    await withAdmin(async (c) => {
      await c.query('BEGIN');
      const out = await tryQuery(c, `update api_keys set revoked_at = null where id = $1`, [k.key.id]);
      await c.query('ROLLBACK');
      expect(out.ok, 'un-revoking must be rejected by the database').toBe(false);
    });
    const after = (await SS.OWNER.get('/api-keys')).body.items.find((x: any) => x.id === k.key.id);
    expect(after.status).toBe('REVOKED');
  }, 60000);
});

describe('T-KEY-08 expiry', () => {
  it('an expired key is refused, shown as EXPIRED and recorded as a denied use', async () => {
    const k = await mk(SS.OWNER, ['claims.read']);
    const { keyId } = K.splitKey(k.secret);
    await withTriggersOff(['api_keys'], async (c) => {
      await c.query(`update api_keys set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where key_id = $1`, [keyId]);
    });
    const tid = SS.OWNER.user.tenant.id;
    const seq = await I.lastSeq(tid);
    expectError(await K.keyReq(app, k.secret, 'GET', '/claims?pageSize=1'), 401, 'unauthenticated');
    expect((await SS.OWNER.get('/api-keys')).body.items.find((x: any) => x.id === k.key.id).status).toBe('EXPIRED');
    const ev = (await I.eventsSince(tid, seq)).filter((e) => e.action === 'apikey.use_denied');
    expect(ev.length).toBe(1);
    expect(ev[0]!.metadata.reason).toBe('expired');
    expect(JSON.stringify(ev[0]!.metadata)).toContain(keyId);
  }, 60000);
});
describe('T-KEY-17 database guarantees', () => {
  it('RLS, immutability, formats and paired revocation columns are enforced by the database', async () => {
    const k = await mk(SS.OWNER, ['claims.read']);
    const { keyId } = K.splitKey(k.secret);
    const acme = SS.OWNER.user.tenant.id;
    const gx = gxOwner.user.tenant.id;
    const a = await appDb();
    try {
      expect((await a.query(`select count(*)::int n from api_keys`)).rows[0].n).toBe(0);
      const ov = { id: 'gen_random_uuid()', tenant_id: `'${acme}'`, key_id: `'${'ab'.repeat(8)}'`, name: `'t'`, secret_hash: `'${'cd'.repeat(32)}'`, scopes: `'{claims.read}'` };
      const creator = SS.OWNER.user.id;
      const ins = await withAdmin((c) => buildInsert(c, 'api_keys', { ...ov, created_by_id: `'${creator}'` }));
      expect((await tryQuery(a, ins)).ok, 'insert without context').toBe(false);
      await a.query('BEGIN');
      await a.query(`select set_config('app.tenant_id', $1, true)`, [gx]);
      expect((await a.query(`select count(*)::int n from api_keys where tenant_id = $1`, [acme])).rows[0].n).toBe(0);
      await a.query('ROLLBACK');
      await a.query('BEGIN');
      await a.query(`select set_config('app.tenant_id', $1, true)`, [acme]);
      expect((await a.query(`select count(*)::int n from api_keys where key_id = $1`, [keyId])).rows[0].n).toBe(1);
      await a.query('ROLLBACK');
      const sys = await inRollback(a, async () => {
        await a.query(`select set_config('app.system','on',true)`);
        return tryQuery(a, `select tenant_id from api_keys where key_id = '${keyId}'`);
      });
      expect(sys.ok && sys.rows.length === 1, 'system-mode lookup by key_id').toBe(true);
    } finally {
      await a.end();
    }
    await withAdmin(async (c) => {
      for (const sql of [
        `update api_keys set secret_hash = '${'ee'.repeat(32)}' where key_id = '${keyId}'`, `update api_keys set scopes = '{exports.claims}' where key_id = '${keyId}'`,
        `update api_keys set key_id = '${'1'.repeat(16)}' where key_id = '${keyId}'`, `update api_keys set expires_at = now() + interval '400 days' where key_id = '${keyId}'`,
        `update api_keys set tenant_id = '${gx}' where key_id = '${keyId}'`, `delete from api_keys where key_id = '${keyId}'`, `truncate api_keys`,
        `update api_keys set revoked_at = now() where key_id = '${keyId}'`,
      ]) {
        await c.query('BEGIN');
        const r = await tryQuery(c, sql);
        await c.query('ROLLBACK');
        expect(r.ok, sql).toBe(false);
      }
      await c.query('BEGIN');
      const okRev = await tryQuery(c, `update api_keys set revoked_at = now(), revoked_by_id = '${SS.OWNER.user.id}', revoke_reason = 'database guarantee check' where key_id = '${keyId}'`);
      const okUse = await tryQuery(c, `update api_keys set last_used_at = now() where key_id = '${keyId}'`);
      await c.query('ROLLBACK');
      expect(okRev.ok, okRev.error).toBe(true);
      expect(okUse.ok, okUse.error).toBe(true);
      const base = { id: 'gen_random_uuid()', tenant_id: `'${acme}'`, name: `'t'`, scopes: `'{claims.read}'`, created_by_id: `'${SS.OWNER.user.id}'` };
      const good = await buildInsert(c, 'api_keys', { ...base, key_id: `'${'ab'.repeat(8)}'`, secret_hash: `'${'cd'.repeat(32)}'` });
      await c.query('BEGIN');
      const control = await tryQuery(c, good);
      await c.query('ROLLBACK');
      expect(control.ok, `control insert must succeed: ${control.error}`).toBe(true);
      for (const [label, patch] of [['key_id upper-case hex', { key_id: `'${'AB'.repeat(8)}'`, secret_hash: `'${'cd'.repeat(32)}'` }], ['key_id 15 chars', { key_id: `'${'a'.repeat(15)}'`, secret_hash: `'${'cd'.repeat(32)}'` }], ['secret_hash 63 chars', { key_id: `'${'ab'.repeat(8)}'`, secret_hash: `'${'c'.repeat(63)}'` }], ['secret_hash not hex', { key_id: `'${'ab'.repeat(8)}'`, secret_hash: `'${'g'.repeat(64)}'` }]] as Array<[string, Record<string, string>]>) {
        const sql = await buildInsert(c, 'api_keys', { ...base, ...patch });
        await c.query('BEGIN');
        const r = await tryQuery(c, sql);
        await c.query('ROLLBACK');
        expect(r.ok, label).toBe(false);
      }
    });
  }, 120000);
});

describe('T-KEY-18 platform exclusion', () => {
  it('platform roles cannot touch keys and no platform response mentions them', async () => {
    const before = (await SS.SUPER_ADMIN.get('/platform/tenants')).text;
    await mk(SS.OWNER, ['claims.read']);
    for (const role of ['PLATFORM_DEV', 'SUPER_ADMIN'] as RoleName[]) {
      expectError(await SS[role].get('/api-keys'), 403, 'forbidden');
      expectError(await SS[role].post('/api-keys', { name: 'x', scopes: ['claims.read'] }), 403, 'forbidden');
      expectError(await SS[role].post(`/api-keys/${I.RAND_UUID}/revoke`, { reason: 'platform attempt reason' }), 403, 'forbidden');
    }
    const texts: string[] = [];
    for (const [s, p] of [[SS.PLATFORM_DEV, '/platform/pipeline'], [SS.SUPER_ADMIN, '/platform/pipeline'], [SS.PLATFORM_DEV, '/platform/telemetry'], [SS.PLATFORM_DEV, '/platform/logs?level=trace&limit=200'], [SS.PLATFORM_DEV, '/platform/flags'], [SS.PLATFORM_DEV, '/platform/eval/runs'], [SS.SUPER_ADMIN, '/platform/audit/events?limit=100'], [SS.SUPER_ADMIN, '/platform/health'], [SS.SUPER_ADMIN, '/platform/tenants']] as Array<[Session, string]>) texts.push((await s.get(p)).text);
    for (const t of texts) {
      expect(/fr_live_|api_keys|secret_hash|keyCount|activeKeys/i.test(t), t.slice(0, 200)).toBe(false); // route names and the permission name in authz.denied events (apikeys:manage) are not key data (SPEC_QUESTION)
    }
    expect((await SS.SUPER_ADMIN.get('/platform/tenants')).text).toBe(before);
  });
});

describe('T-KEY-19 configuration and production guards', () => {
  const mod = async () => (await import('./helpers/prod.js'));
  it('start-up refuses a set-but-empty pepper and out-of-range knobs (outside production)', async () => {
    const { startupError } = await mod();
    const { baseEnv } = await import('./helpers/env.js');
    // Leader DECISION (step 4): a SET-BUT-EMPTY or whitespace-only pepper is a misconfiguration in ANY
    // environment; an UNSET pepper outside production falls back to the documented dev default.
    for (const blank of ['', '   ']) {
      const err = await startupError(baseEnv({ API_KEY_PEPPER: blank }));
      expect(err, `blank pepper ${JSON.stringify(blank)} must be refused`).toBeTruthy();
      expect(err!.message).not.toBe('__TIMEOUT__');
      expect(err!.message, 'error must name API_KEY_PEPPER').toContain('API_KEY_PEPPER');
    }
    const unset = baseEnv();
    delete unset.API_KEY_PEPPER;
    const unsetErr = await startupError(unset);
    expect(unsetErr, `unset pepper outside production uses the documented dev default: ${unsetErr?.message}`).toBeNull();
    for (const patch of [{ API_KEY_PEPPER: '' }, { API_KEY_MAX_ACTIVE: '0' }, { API_KEY_MAX_ACTIVE: '201' }, { RATE_LIMIT_API_KEY_MAX: '0' }, { API_KEY_DEFAULT_TTL_DAYS: '0' }, { API_KEY_DEFAULT_TTL_DAYS: '366' }]) {
      const err = await startupError(baseEnv(patch));
      expect(err, JSON.stringify(patch)).toBeTruthy();
      expect(err!.message).not.toBe('__TIMEOUT__');
      expect(err!.message.includes(K.PEPPER)).toBe(false);
    }
  }, 120000);
  it('production refuses a weak, shared or documented-dev pepper, non-expiring keys and a TTL above 365', async (ctx) => {
    const { startupError, prodEnv, devDefaults } = await mod();
    const cases: Array<[string, Record<string, string>, string]> = [
      ['pepper missing', { API_KEY_PEPPER: '' }, 'API_KEY_PEPPER'],
      ['pepper whitespace-only', { API_KEY_PEPPER: '   ' }, 'API_KEY_PEPPER'],
      ['pepper shorter than 32 bytes', { API_KEY_PEPPER: 'short-pepper-of-16' }, 'API_KEY_PEPPER'],
      ['non-expiring keys allowed', { API_KEY_ALLOW_NON_EXPIRING: 'true' }, 'API_KEY_ALLOW_NON_EXPIRING'],
      ['default TTL 366', { API_KEY_DEFAULT_TTL_DAYS: '366' }, 'API_KEY_DEFAULT_TTL_DAYS'],
    ];
    for (const [label, patch, name] of cases) {
      const env = { ...prodEnv(), ...patch };
      const err = await startupError(env);
      expect(err, `${label} must be refused`).toBeTruthy();
      expect(err!.message, `${label}: error must name ${name}`).toContain(name);
      for (const s of [env.JWT_SECRET, env.CSRF_SECRET, env.REFRESH_PEPPER, env.MFA_ENC_KEY, env.API_KEY_PEPPER]) if (s && s.length >= 12) expect(err!.message.includes(s), 'error leaks a secret').toBe(false);
    }
    const env2 = prodEnv();
    const same = await startupError({ ...env2, API_KEY_PEPPER: env2.JWT_SECRET! });
    expect(same, 'pepper equal to JWT_SECRET must be refused').toBeTruthy();
    expect(same!.message).toContain('API_KEY_PEPPER');
    const ds = devDefaults('API_KEY_PEPPER');
    if (!ds.length) {
      const msg = 'no documented public dev value for API_KEY_PEPPER found in compose.web.yml / web-ci.yml / .env.example, so the dev-pepper refusal cannot be exercised';
      if (process.env.CI === 'true' || process.env.CI === '1') throw new Error(`${msg} (CI=true: this check must not be skipped)`);
      console.warn(`[ACCEPTANCE SKIP] ${msg}`);
      return ctx.skip();
    }
    for (const d of ds) {
      const e = await startupError({ ...prodEnv(), API_KEY_PEPPER: d });
      expect(e, 'documented dev pepper must be refused in production').toBeTruthy();
      expect(e!.message).toContain('API_KEY_PEPPER');
      expect(e!.message.includes(d)).toBe(false);
    }
  }, 240000);
});