/**
 * Integration (real PostgreSQL, migrated + seeded): tenant API keys and machine authentication (Q13, A12).
 * Hash-only storage, one-time reveal, scope/route allow-list, attribution, revocation without cache,
 * expiry, creator re-checks, indistinguishable 401s, tenant derived from the key row only, CSRF/Origin,
 * per-key and per-IP-failure limits, quota, no key material in logs.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { ApiKeyCreated, ApiKeyList } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { DEV_API_KEY_PEPPER } from '../../src/config.js';

import { Client, adminUrl, canRunDb, step4Env } from './step4-helpers.js';

const logLines: string[] = [];
const sink = () =>
  new Writable({
    write(chunk, _e, cb) {
      logLines.push(String(chunk));
      cb();
    },
  });

let app: FastifyInstance;
let admin: pg.Client;
let c: Client;
let owner = '';
let viewer = '';
let dev = '';
let acme = '';
let globexKeyRow = '';
const createdKeyIds: string[] = [];
const batches: string[] = [];

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const strip = (b: string) => b.replace(/"requestId":"[^"]+"/u, '');

async function createKey(scopes: string[], extra: Record<string, unknown> = {}) {
  const r = await c.send('POST', '/api/v1/api-keys', owner, { name: `int ${scopes.join('+')}`, scopes, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  const body = ApiKeyCreated.parse(r.json());
  createdKeyIds.push(body.key.id);
  return body;
}

async function denials(keyId: string): Promise<string[]> {
  const r = await admin.query<{ metadata: { reason: string } }>(
    `SELECT metadata FROM audit_events WHERE action = 'apikey.use_denied' AND metadata->>'keyId' = $1 ORDER BY seq`,
    [keyId],
  );
  return r.rows.map((x) => x.metadata.reason);
}

/** Owner-inserted key with a known secret (hash computed with the PUBLIC dev pepper). */
async function insertRawKey(tenantId: string, createdById: string, scopes: string[]): Promise<{ id: string; keyId: string; key: string }> {
  const keyId = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const id = randomUUID();
  await admin.query(
    `INSERT INTO api_keys (id, tenant_id, key_id, name, secret_hash, scopes, created_by_id, expires_at) VALUES ($1, $2, $3, 'raw', $4, $5, $6, now() + interval '1 day')`,
    [id, tenantId, keyId, createHmac('sha256', DEV_API_KEY_PEPPER).update(secret).digest('hex'), scopes, createdById],
  );
  createdKeyIds.push(id);
  return { id, keyId, key: `fr_live_${keyId}_${secret}` };
}

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]?.id ?? '';
}

describe.skipIf(!canRunDb)('tenant API keys (PostgreSQL)', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    acme = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'acme'`)).rows[0]?.id ?? '';
    const globex = (await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'globex'`)).rows[0]?.id ?? '';
    const globexOwner = (await admin.query<{ id: string }>(`SELECT user_id AS id FROM memberships WHERE tenant_id = $1 AND role = 'OWNER' LIMIT 1`, [globex])).rows[0]?.id ?? '';
    globexKeyRow = (await insertRawKey(globex, globexOwner, ['claims.read'])).id;
    app = await buildApp(step4Env({ LOG_LEVEL: 'info', RATE_LIMIT_UPLOAD_MAX: '1000' }), { logStream: sink() });
    await app.ready();
    c = await new Client(app).init();
    owner = await c.login('owner@acme.test');
    viewer = await c.login('viewer@acme.test');
    dev = await c.login('dev@platform.test');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (!admin) return;
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    await admin.query(`DELETE FROM api_keys WHERE id = ANY($1::uuid[])`, [createdKeyIds]);
    await admin.query(`DELETE FROM import_batches WHERE id = ANY($1::uuid[])`, [batches]);
    await admin.query(`UPDATE users SET status = 'ACTIVE' WHERE email = 'reset2@acme.test'`);
    await admin.query('COMMIT');
    await admin.end();
  });

  it('management: OWNER creates (secret once, hash only), lists without secrets; others and platform users 403; CSRF enforced', async () => {
    const created = await createKey(['claims.read']);
    expect(created.secret).toMatch(/^fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/u);
    expect(created.key.keyId).toBe(created.secret.slice(0, 24));
    expect(created.key.status).toBe('ACTIVE');
    const days = (Date.parse(created.key.expiresAt ?? '') - Date.parse(created.key.createdAt)) / 86_400_000;
    expect(days).toBe(90);
    const secretPart = created.secret.slice(25);
    const row = (await admin.query<{ secret_hash: string }>(`SELECT secret_hash FROM api_keys WHERE id = $1`, [created.key.id])).rows[0];
    expect(row?.secret_hash).toBe(createHmac('sha256', DEV_API_KEY_PEPPER).update(secretPart).digest('hex'));
    const leak = await admin.query(
      `SELECT count(*)::int AS n FROM (SELECT row_to_json(k)::text AS t FROM api_keys k UNION ALL SELECT row_to_json(a)::text FROM audit_events a) x WHERE t LIKE $1`,
      [`%${secretPart}%`],
    );
    expect(leak.rows[0]).toEqual({ n: 0 });
    const list = await c.get('/api/v1/api-keys', owner);
    const parsed = ApiKeyList.parse(list.json());
    expect(parsed.items.some((k) => k.id === created.key.id)).toBe(true);
    expect(list.body).not.toContain(secretPart);
    expect(list.body).not.toContain(row?.secret_hash ?? 'x');
    expect(parsed.items.some((k) => k.id === globexKeyRow)).toBe(false);
    for (const t of [viewer, dev]) {
      expect((await c.get('/api/v1/api-keys', t)).statusCode).toBe(403);
      expect((await c.send('POST', '/api/v1/api-keys', t, { name: 'x', scopes: ['claims.read'] })).statusCode).toBe(403);
    }
    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: bearer(owner), payload: { name: 'x', scopes: ['claims.read'] } });
    expect(noCsrf.statusCode).toBe(403);
    expect((await c.send('POST', '/api/v1/api-keys', owner, { name: 'x', scopes: ['claims.read'], expiresInDays: 400 })).statusCode).toBe(400);
    const audit = await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'apikey.created' AND target_id = $1`, [created.key.id]);
    expect(Object.keys(audit.rows[0]?.metadata ?? {}).sort()).toEqual(['expiresAt', 'keyId', 'scopes']);
  });

  it('a key works only on its scoped routes; everything else is 403 with an audited reason', async () => {
    const { secret, key } = await createKey(['claims.read']);
    const keyId = key.keyId.slice(8);
    const claims = await app.inject({ method: 'GET', url: '/api/v1/claims?pageSize=5', headers: bearer(secret) });
    expect(claims.statusCode, claims.body).toBe(200);
    const items = (claims.json() as { items: { id: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    const first = items[0]?.id ?? '';
    expect((await app.inject({ method: 'GET', url: `/api/v1/claims/${first}`, headers: bearer(secret) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/claims/${first}/documents`, headers: bearer(secret) })).statusCode).toBe(200);
    for (const url of ['/api/v1/approvals', '/api/v1/me', `/api/v1/claims/${first}/packet`, '/api/v1/api-keys', '/api/v1/audit/events', '/api/v1/users', '/api/v1/platform/pipeline', '/api/v1/intelligence/worklist', '/api/v1/features', '/healthz']) {
      expect([url, (await app.inject({ method: 'GET', url, headers: bearer(secret) })).statusCode]).toEqual([url, 403]);
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/exports/claims?format=csv', headers: bearer(secret) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/imports', headers: { ...bearer(secret), 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(403);
    const reasons = await denials(keyId);
    expect(reasons.filter((r) => r === 'route').length).toBe(10);
    expect(reasons.filter((r) => r === 'scope').length).toBe(2);
    // Tenant smuggling is ignored: the tenant comes from the key row only.
    const smuggled = await app.inject({ method: 'GET', url: '/api/v1/claims?pageSize=100', headers: { ...bearer(secret), 'x-tenant-id': randomUUID(), cookie: 'fr_csrf=x' } });
    expect(smuggled.statusCode).toBe(200);
    const ids = (smuggled.json() as { items: { id: string }[] }).items.map((i) => i.id);
    const foreign = await admin.query(`SELECT count(*)::int AS n FROM claims WHERE id = ANY($1::uuid[]) AND tenant_id <> $2`, [ids, acme]);
    expect(foreign.rows[0]).toEqual({ n: 0 });
    // Key in the URL is refused before anything else and never echoed.
    const inUrl = await app.inject({ method: 'GET', url: `/api/v1/claims?q=${secret}` });
    expect(inUrl.statusCode).toBe(400);
    expect(inUrl.body).not.toContain(secret.slice(25));
    // Origin, if present, must match.
    expect((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: { ...bearer(secret), origin: 'https://evil.example' } })).statusCode).toBe(403);
  });

  it('imports.write: unsafe requests without CSRF, attributed to the creator with role API_KEY and viaApiKey', async () => {
    const { secret, key } = await createKey(['imports.write']);
    const r = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: { ...bearer(secret), 'content-type': 'application/json' }, payload: { label: 'via key' } });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.headers['set-cookie']).toBeUndefined();
    const batchId = (r.json() as { id: string }).id;
    batches.push(batchId);
    const ev = await admin.query<{ actor_id: string; actor_role: string; metadata: Record<string, unknown> }>(
      `SELECT actor_id, actor_role, metadata FROM audit_events WHERE action = 'import.batch_created' AND target_id = $1`,
      [batchId],
    );
    expect(ev.rows[0]).toMatchObject({ actor_id: await userId('owner@acme.test'), actor_role: 'API_KEY', metadata: { viaApiKey: key.keyId.slice(8) } });
    const row = (await admin.query<{ created_by_id: string }>(`SELECT created_by_id FROM import_batches WHERE id = $1`, [batchId])).rows[0];
    expect(row?.created_by_id).toBe(await userId('owner@acme.test'));
    expect((await app.inject({ method: 'GET', url: `/api/v1/imports/${batchId}`, headers: bearer(secret) })).statusCode).toBe(200);
    // A user JWT request still needs CSRF even when a key-looking cookie or header is around.
    const jwtNoCsrf = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, payload: {} });
    expect(jwtNoCsrf.statusCode).toBe(403);
  });

  it('failures: unknown, wrong secret, malformed, revoked, expired -> identical 401 bodies; denials audited for real key ids only', async () => {
    const { secret, key } = await createKey(['claims.read']);
    const keyId = key.keyId.slice(8);
    const wrong = `${secret.slice(0, 25)}${'A'.repeat(43)}`;
    const unknown = `fr_live_${randomBytes(8).toString('hex')}_${'B'.repeat(43)}`;
    const outcomes = [];
    for (const k of [wrong, unknown, 'fr_live_short', `${secret}x`]) {
      const r = await app.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(k) });
      outcomes.push([r.statusCode, strip(r.body), r.headers['www-authenticate'] ?? null]);
    }
    expect(new Set(outcomes.map((o) => JSON.stringify(o))).size).toBe(1);
    expect(outcomes[0]?.[0]).toBe(401);
    expect(await denials(keyId)).toEqual(['bad_secret']);
    expect(await denials(unknown.slice(8, 24))).toEqual([]);

    // Revocation: effective on the very next request; second revoke 409; other tenant's id 404.
    expect((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(secret) })).statusCode).toBe(200);
    const rv = await c.send('POST', `/api/v1/api-keys/${key.id}/revoke`, owner, { reason: 'Rotating the integration key' });
    expect(rv.statusCode, rv.body).toBe(200);
    expect(rv.json()).toMatchObject({ status: 'REVOKED', revokeReason: 'Rotating the integration key', revokedBy: { id: await userId('owner@acme.test') } });
    const after = await app.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(secret) });
    expect([after.statusCode, strip(after.body)]).toEqual([401, outcomes[0]?.[1]]);
    expect((await c.send('POST', `/api/v1/api-keys/${key.id}/revoke`, owner, { reason: 'Rotating the integration key' })).json()).toMatchObject({ error: { code: 'invalid_state' } });
    const otherA = await c.send('POST', `/api/v1/api-keys/${globexKeyRow}/revoke`, owner, { reason: 'Not my tenant at all' });
    const otherB = await c.send('POST', `/api/v1/api-keys/${randomUUID()}/revoke`, owner, { reason: 'Not my tenant at all' });
    expect([otherA.statusCode, strip(otherA.body)]).toEqual([404, strip(otherB.body)]);
    expect(await denials(keyId)).toEqual(['bad_secret', 'revoked']);

    // Expiry (owner bypasses the immutability trigger only to simulate time passing).
    const exp = await createKey(['claims.read']);
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    await admin.query(`UPDATE api_keys SET expires_at = created_at + interval '1 millisecond' WHERE id = $1`, [exp.key.id]);
    await admin.query('COMMIT');
    expect((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(exp.secret) })).statusCode).toBe(401);
    expect(await denials(exp.key.keyId.slice(8))).toEqual(['expired']);
    expect((ApiKeyList.parse((await c.get('/api/v1/api-keys', owner)).json()).items.find((k) => k.id === exp.key.id))?.status).toBe('EXPIRED');
  });

  it('creator re-checks: a creator without the scope permission or a disabled creator gets 401', async () => {
    const viewerKey = await insertRawKey(acme, await userId('viewer@acme.test'), ['claims.read', 'imports.write']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(viewerKey.key) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/imports', headers: { ...bearer(viewerKey.key), 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(401);
    const disabled = await insertRawKey(acme, await userId('reset2@acme.test'), ['claims.read']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(disabled.key) })).statusCode).toBe(200);
    await admin.query(`UPDATE users SET status = 'DISABLED' WHERE email = 'reset2@acme.test'`);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(disabled.key) })).statusCode).toBe(401);
    } finally {
      await admin.query(`UPDATE users SET status = 'ACTIVE' WHERE email = 'reset2@acme.test'`);
    }
    expect(await denials(viewerKey.keyId)).toEqual(['creator']);
    expect(await denials(disabled.keyId)).toEqual(['creator']);
    const used = (await admin.query<{ last_used_at: Date | null }>(`SELECT last_used_at FROM api_keys WHERE id = $1`, [viewerKey.id])).rows[0];
    await new Promise((r) => setTimeout(r, 200));
    expect(used).toBeDefined();
    const later = (await admin.query<{ last_used_at: Date | null }>(`SELECT last_used_at FROM api_keys WHERE id = $1`, [viewerKey.id])).rows[0];
    expect(later?.last_used_at).not.toBeNull();
  });

  it('never writes key material to the logs', () => {
    const all = logLines.join('');
    expect(all.length).toBeGreaterThan(0);
    expect(/fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{20,}/u.test(all)).toBe(false);
  });

  describe('abuse limits and quota', () => {
    let limited: FastifyInstance;
    let lc: Client;

    beforeAll(async () => {
      const active = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM api_keys WHERE tenant_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, [acme])).rows[0]?.n ?? 0;
      limited = await buildApp(step4Env({ RATE_LIMIT_API_KEY_MAX: '3', RATE_LIMIT_API_KEY_FAIL_MAX: '2', API_KEY_MAX_ACTIVE: String(active + 1) }), {
        logStream: sink(),
      });
      await limited.ready();
      lc = await new Client(limited).init();
    }, 60_000);

    afterAll(async () => {
      await limited?.close();
    });

    it('quota: the second key beyond API_KEY_MAX_ACTIVE is 422 quota_exceeded', async () => {
      const ok = await lc.send('POST', '/api/v1/api-keys', owner, { name: 'quota 1', scopes: ['claims.read'] });
      expect(ok.statusCode).toBe(201);
      createdKeyIds.push((ok.json() as { key: { id: string } }).key.id);
      const over = await lc.send('POST', '/api/v1/api-keys', owner, { name: 'quota 2', scopes: ['claims.read'] });
      expect([over.statusCode, (over.json() as { error: { code: string } }).error.code]).toEqual([422, 'quota_exceeded']);
    });

    it('per key: RATE_LIMIT_API_KEY_MAX requests per minute', async () => {
      const k = await insertRawKey(acme, await userId('owner@acme.test'), ['claims.read']);
      const codes = [];
      for (let i = 0; i < 4; i += 1) codes.push((await limited.inject({ method: 'GET', url: '/api/v1/claims?pageSize=1', headers: bearer(k.key) })).statusCode);
      expect(codes).toEqual([200, 200, 200, 429]);
    });

    it('per address: failed authentications are refused before verification once over budget', async () => {
      const k = await insertRawKey(acme, await userId('owner@acme.test'), ['claims.read']);
      const bad = `fr_live_${randomBytes(8).toString('hex')}_${'C'.repeat(43)}`;
      const ip = '203.0.113.9';
      const codes = [];
      for (let i = 0; i < 3; i += 1) codes.push((await limited.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(bad), remoteAddress: ip })).statusCode);
      codes.push((await limited.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(k.key), remoteAddress: ip })).statusCode);
      codes.push((await limited.inject({ method: 'GET', url: '/api/v1/claims', headers: bearer(k.key), remoteAddress: '203.0.113.10' })).statusCode);
      expect(codes).toEqual([401, 401, 401, 429, 200]);
    });
  });
});
