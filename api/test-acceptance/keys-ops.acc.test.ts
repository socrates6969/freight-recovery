/* eslint-disable */
// T16 part 3 (T-KEY-12..16, 20): keys never in URLs or logs, rate limits, audit, last-used throttle, upload abuse limits.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, buildTestApp, closeApps, expectError, type RoleName, type Session } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let A: I.Fx, B: I.Fx;
const mk = (owner: Session, scopes: string[], over: Record<string, unknown> = {}) => K.mkKey(owner, scopes, over);
const pad = (n: number, tag: string) => Buffer.from(`DOCUMENT: BILL OF LADING\nLoad Number: ${tag}\n${'Facility: filler line\n'.repeat(200)}`).subarray(0, n);

beforeAll(async () => {
  await H.assertS3Reachable();
  app = await buildTestApp();
  SS = await I.seededOn(app);
  A = await I.fixtureTenant(app, 'intel-fixture-a', 'Intel Fixture A (synthetic)');
  B = await I.fixtureTenant(app, `intel-fixture-q-${Date.now().toString(36)}`, 'Intel Fixture Q (synthetic)'); // fresh tenant: the storage quota check needs an empty one
}, 300000);
afterAll(async () => {
  try {
    for (const o of [A.owner, B.owner, SS.OWNER]) await K.revokeActive(o);
    I.assertHonest('keys-ops');
  } finally {
    await closeApps();
    reseed();
  }
});

describe('T-KEY-12 keys never in URLs', () => {
  it('any URL containing fr_live_ is refused before other processing and never logged', async () => {
    const { app: la, lines } = await I.buildLogged();
    const owner = I.onApp(la, A.owner);
    const dev = I.onApp(la, SS.PLATFORM_DEV);
    const key = K.fakeKey('0f1e2d3c4b5a6978');
    const { keyId, secret } = K.splitKey(key);
    const valid = await mk(owner, ['claims.read']);
    const urls = [`/claims?api_key=${key}`, `/claims/${key}`, '/claims?x=fr_live_', `/imports?token=${key}`];
    for (const u of urls) {
      const answers: Array<[string, any]> = [['user', await owner.get(u)], ['anonymous', await K.keyReq(la, null, 'GET', u)], ['key', await K.keyReq(la, valid.secret, 'GET', u)]];
      for (const [label, r] of answers) {
        expectError(r, 400, 'validation_error');
        expect(r.text.includes(key) || r.text.includes(secret) || r.text.includes('fr_live_'), `${label} ${u}: response echoes the key`).toBe(false);
      }
    }
    const view = await dev.get('/platform/logs?level=trace&limit=200');
    const raw = lines.join('\n');
    for (const t of [view.text, raw]) for (const n of [key, secret, keyId]) expect(t.includes(n), `leak of ${n.slice(0, 10)}`).toBe(false);
    await la.close();
  }, 120000);
});

describe('T-KEY-13 log redaction', () => {
  it('keys are scrubbed at any depth from the raw stream and the log view', async () => {
    const { app: la, lines } = await I.buildLogged();
    const owner = I.onApp(la, A.owner);
    const dev = I.onApp(la, SS.PLATFORM_DEV);
    const good = await mk(owner, ['claims.read']);
    const bad = K.fakeKey('aa11bb22cc33dd44');
    const g = K.splitKey(good.secret);
    const b = K.splitKey(bad);
    await K.keyReq(la, good.secret, 'GET', '/claims?pageSize=1');
    await K.keyReq(la, bad, 'GET', '/claims?pageSize=1');
    await K.keyReq(la, `fr_live_${g.keyId}_${'W'.repeat(43)}`, 'GET', '/claims?pageSize=1');
    la.log.info({ auth: `Bearer ${good.secret}`, nested: { k: `x ${good.secret} y`, deeper: [{ z: bad }] } }, 'key test');
    la.log.error(new Error(`failed with ${good.secret}`), 'key error');
    const view = await dev.get('/platform/logs?level=trace&limit=200');
    const raw = lines.join('\n');
    for (const t of [raw, view.text]) {
      for (const n of [good.secret, g.secret, g.keyId, bad, b.secret, b.keyId, `fr_live_${g.keyId}`]) expect(t.includes(n), `leak of ${n.slice(0, 12)}`).toBe(false);
    }
    expect(raw.includes('[REDACTED]'), 'the redaction marker replaces the key').toBe(true);
    await la.close();
  }, 120000);
});

describe('T-KEY-14 rate limits', () => {
  it('RATE_LIMIT_API_KEY_MAX applies per key after authentication; user limits are separate', async () => {
    const lim = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_API_KEY_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const owner = I.onApp(lim, A.owner);
    const k1 = await mk(owner, ['claims.read']);
    const k2 = await mk(owner, ['claims.read']);
    for (let i = 0; i < 3; i++) expect((await K.keyReq(lim, k1.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    const r = await K.keyReq(lim, k1.secret, 'GET', '/claims?pageSize=1');
    expectError(r, 429, 'rate_limited');
    expect(r.headers['retry-after']).toMatch(/^\d+$/);
    expect((await K.keyReq(lim, k2.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await owner.get('/me')).status).toBe(200);
  }, 120000);
  it('RATE_LIMIT_API_KEY_FAIL_MAX counts failed attempts per client address and refuses even valid keys afterwards', async () => {
    const lim = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_API_KEY_FAIL_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const k = await mk(I.onApp(lim, A.owner), ['claims.read']);
    const ip = '10.77.1.1';
    for (let i = 0; i < 3; i++) expect((await K.keyReq(lim, K.fakeKey('1111222233334444'), 'GET', '/claims', { ip })).status).toBe(401);
    expectError(await K.keyReq(lim, K.fakeKey('1111222233334444'), 'GET', '/claims', { ip }), 429, 'rate_limited');
    expectError(await K.keyReq(lim, k.secret, 'GET', '/claims?pageSize=1', { ip }), 429, 'rate_limited');
    expect((await K.keyReq(lim, k.secret, 'GET', '/claims?pageSize=1', { ip: '10.77.1.2' })).status).toBe(200);
  }, 120000);
});
describe('T-KEY-15 audit', () => {
  it('creation, revocation and every kind of denied use are recorded in the key tenant chain; actors and metadata are exact', async () => {
    const tid = A.id;
    const seq0 = await I.lastSeq(tid);
    const m = await mk(A.owner, ['claims.read'], { expiresInDays: 10 });
    const hex = K.splitKey(m.secret).keyId;
    const s43 = K.splitKey(m.secret).secret;
    const created = (await I.eventsSince(tid, seq0)).filter((e) => e.action === 'apikey.created');
    expect(created.length).toBe(1);
    expect(created[0]!.actor_id).toBe(A.owner.user.id);
    expect(I.keysOf(created[0]!.metadata)).toEqual(['expiresAt', 'keyId', 'scopes']);
    expect(created[0]!.metadata.scopes).toEqual(['claims.read']);
    expect(JSON.stringify(created[0]!.metadata.keyId)).toContain(hex);
    expect(created[0]!.metadata.expiresAt).toBe(m.key.expiresAt);
    const denied = async (fn: () => Promise<any>) => {
      const s = await I.lastSeq(tid);
      await fn();
      return (await I.eventsSince(tid, s)).filter((e) => e.action === 'apikey.use_denied');
    };
    const check = (ev: I.Ev[], reason: string) => {
      expect(ev.length, reason).toBe(1);
      expect(I.keysOf(ev[0]!.metadata), reason).toEqual(['keyId', 'reason']);
      expect(ev[0]!.metadata.reason).toBe(reason);
      expect(JSON.stringify(ev[0]!.metadata.keyId)).toContain(hex);
      expect(JSON.stringify(ev[0]!.metadata).includes(s43)).toBe(false);
    };
    check(await denied(() => K.keyReq(app, `fr_live_${hex}_${'Q'.repeat(43)}`, 'GET', '/claims')), 'bad_secret');
    check(await denied(() => K.keyReq(app, m.secret, 'GET', '/exports/claims?format=csv')), 'scope');
    check(await denied(() => K.keyReq(app, m.secret, 'GET', '/features')), 'route');
    const allTenantEvents = () => withAdmin(async (c) => Number((await c.query(`select count(*)::int n from audit_events where tenant_id is not null`)).rows[0].n));
    const before = await allTenantEvents();
    expectError(await K.keyReq(app, K.fakeKey('9999888877776666'), 'GET', '/claims'), 401, 'unauthenticated');
    expect(await allTenantEvents(), 'unknown key ids are not audited per tenant').toBe(before);
    const sRev = await I.lastSeq(tid);
    expect((await A.owner.post(`/api-keys/${m.key.id}/revoke`, { reason: 'audit probe revocation' })).status).toBe(200);
    const revEv = (await I.eventsSince(tid, sRev)).filter((e) => e.action === 'apikey.revoked');
    expect(revEv.length).toBe(1);
    expect(I.keysOf(revEv[0]!.metadata)).toEqual(['keyId', 'reason']);
    expect(revEv[0]!.metadata.reason).toBe('audit probe revocation');
    check(await denied(() => K.keyReq(app, m.secret, 'GET', '/claims')), 'revoked');
    const { s: admin } = await K.newSession(app, A.owner, 'ADMIN');
    const byAdmin = await mk(admin, ['claims.read']);
    expect((await A.owner.post(`/users/${admin.user.id}/disable`, { reason: 'audit probe disable' })).status).toBe(200);
    const hexA = K.splitKey(byAdmin.secret).keyId;
    const evC = await denied(() => K.keyReq(app, byAdmin.secret, 'GET', '/claims'));
    expect(evC.length).toBe(1);
    expect(evC[0]!.metadata.reason).toBe('creator');
    expect(JSON.stringify(evC[0]!.metadata.keyId)).toContain(hexA);
    const v = await A.owner.get('/audit/verify');
    expect(v.body.valid).toBe(true);
  }, 240000);
  it('uploads through a key are attributed to the key creator and carry actor role API_KEY and viaApiKey', async () => {
    const imp = await mk(A.owner, ['imports.write']);
    const hex = K.splitKey(imp.secret).keyId;
    const seq = await I.lastSeq(A.id);
    const b = await K.keyReq(app, imp.secret, 'POST', '/imports', { body: { label: 'audit upload' } });
    expect(b.status, b.text).toBe(201);
    const up = await K.keyReq(app, imp.secret, 'POST', `/imports/${b.body.id}/documents?filename=invoice.txt`, { raw: Buffer.from(H.invoiceTxt(H.uniqLoad('KA'))) });
    expect(up.status, up.text).toBe(201);
    const ev = (await I.eventsSince(A.id, seq)).filter((e) => e.action === 'import.document_received');
    expect(ev.length).toBe(1);
    expect(ev[0]!.actor_role).toBe('API_KEY');
    expect(JSON.stringify(ev[0]!.metadata.viaApiKey)).toContain(hex);
    const row = await withAdmin(async (c) => (await c.query(`select uploaded_by_id from import_documents where id = $1`, [up.body.id])).rows[0]);
    expect(row.uploaded_by_id).toBe(A.owner.user.id);
  }, 120000);
});

describe('T-KEY-16 last used', () => {
  it('lastUsedAt is null until used, then minute-precise and written at most once per minute', async () => {
    const k = await mk(A.owner, ['claims.read']);
    const view = async () => (await A.owner.get('/api-keys')).body.items.find((x: any) => x.id === k.key.id).lastUsedAt as string | null;
    expect(await view()).toBeNull();
    expect((await K.keyReq(app, k.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    const first = await view();
    expect(first).toBeTruthy();
    const age = Date.now() - Date.parse(first!);
    expect(age).toBeGreaterThanOrEqual(-2000);
    expect(age).toBeLessThanOrEqual(65_000);
    for (let i = 0; i < 10; i++) expect((await K.keyReq(app, k.secret, 'GET', '/claims?pageSize=1')).status).toBe(200);
    const later = await view();
    expect(later === first || Date.parse(later!) - Date.parse(first!) >= 60_000, `${first} -> ${later}`).toBe(true);
  }, 60000);
});

describe('T-KEY-20 upload limits apply to keys', () => {
  it('413, 415, 409 batch_full and 422 quota behave as for users; a key without the scope is refused before the body is read', async () => {
    const lim = await buildTestApp({ IMPORT_MAX_FILE_BYTES: '2048', IMPORT_MAX_FILES_PER_BATCH: '2', TENANT_STORAGE_QUOTA_BYTES: '5000' });
    const imp = await mk(I.onApp(lim, B.owner), ['imports.write']);
    const readOnly = await mk(I.onApp(lim, B.owner), ['claims.read']);
    const batch = async () => (await K.keyReq(lim, imp.secret, 'POST', '/imports', { body: {} })).body.id as string;
    const up = (b: string, name: string, bytes: Buffer) => K.keyReq(lim, imp.secret, 'POST', `/imports/${b}/documents?filename=${encodeURIComponent(name)}`, { raw: bytes });
    const b1 = await batch();
    expect((await up(b1, 'a.txt', pad(1500, 'KL1'))).status).toBe(201);
    expectError(await up(b1, 'big.txt', Buffer.concat([pad(1500, 'KL2'), Buffer.alloc(600, 0x41)])), 413, 'payload_too_large');
    expectError(await up(b1, 'x.exe', Buffer.from('MZ not a document at all')), 415, 'unsupported_media_type');
    expect((await up(b1, 'b.txt', pad(1500, 'KL3'))).status).toBe(201);
    expectError(await up(b1, 'c.txt', pad(300, 'KL4')), 409, 'batch_full');
    const b2 = await batch();
    expect((await up(b2, 'd.txt', pad(1500, 'KL5'))).status).toBe(201);
    expectError(await up(b2, 'e.txt', pad(1500, 'KL6')), 422, 'quota_exceeded');
    const t0 = Date.now();
    const refused = await K.keyReq(lim, readOnly.secret, 'POST', `/imports/${b2}/documents?filename=z.txt`, { raw: Buffer.alloc(1_500_000, 0x41) });
    expectError(refused, 403, 'forbidden');
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 180000);
});