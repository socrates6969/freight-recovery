/**
 * Integration (real PostgreSQL, migrated + seeded): REQ-20261012-hardening fix round 1 (Part C C10, C12-C14).
 * - change-password reads and feeds the login lockout record (wrong attempts 1..N -> 401, N+1 -> 429 even with
 *   the right password), audits auth.password.change_failed, and a lock started here blocks /auth/login;
 * - a known device (live fr_rt of the same user) may log in during a lockout (knownDevice: true audited); a
 *   foreign or missing cookie keeps the 429;
 * - promotion to an MFA-required role revokes password-only sessions (sessionsRevoked in user.role_changed);
 * - an invite for an account of another tenant is answered like an unknown email, plus one platform-chain
 *   invite.existing_account event.
 * Uses the seeded synthetic users; lockout rows and role changes are restored afterwards.
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { emailHash, normalizeEmail } from '../../src/security/crypto.js';

import { Client, PW, adminUrl, canRunDb, step4Env } from './step4-helpers.js';

const THRESHOLD = 3;
const env = () => step4Env({ LOCKOUT_THRESHOLD: String(THRESHOLD), LOCKOUT_BASE_SECONDS: '60', LOCKOUT_MAX_SECONDS: '600', ENABLE_DEV_OUTBOX: 'true' });

type Inject = Awaited<ReturnType<FastifyInstance['inject']>>;
const errorOf = (r: Inject) => (r.json() as { error: { code: string; message: string } }).error;
const refreshCookieOf = (r: Inject): string | null => {
  const raw = r.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const c of list) {
    const m = /^fr_rt=([^;]*)/u.exec(c);
    if (m?.[1]) return m[1];
  }
  return null;
};

describe.skipIf(!canRunDb)('auth fix round 1 (PostgreSQL)', () => {
  let app: FastifyInstance;
  let admin: pg.Client;
  let c: Client;
  let pepper = '';
  const touched = new Set<string>();

  const eh = (email: string) => emailHash(pepper, normalizeEmail(email));
  const clearLock = async (email: string) => admin.query(`DELETE FROM login_lockouts WHERE email_hash = $1`, [eh(email)]);

  beforeAll(async () => {
    pepper = loadConfig({ ...process.env, ...env() } as Record<string, string>).refreshPepper;
    app = await buildApp(env());
    await app.ready();
    c = await new Client(app).init();
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
  }, 180_000);

  beforeEach(async () => {
    for (const e of touched) await clearLock(e);
  });

  afterAll(async () => {
    if (admin) {
      for (const e of touched) await clearLock(e);
      await admin.end();
    }
    await app?.close();
  });

  const changePassword = (token: string, currentPassword: string) =>
    c.send('POST', '/api/v1/auth/change-password', token, { currentPassword, newPassword: 'Synthetic-Never-Applied-2026!x' });

  it('change-password: wrong attempts 1..N answer 401 and are audited; N+1 answers 429 even with the right password; login is locked too', async () => {
    const email = 'viewer@acme.test';
    touched.add(email);
    await clearLock(email);
    const token = await c.login(email);
    const userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]?.id ?? '';
    const before = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.password.change_failed' AND target_id = $1`, [userId])).rows[0]?.n ?? 0;
    for (let i = 1; i <= THRESHOLD; i += 1) {
      const r = await changePassword(token, 'Definitely-Wrong-Password-1!');
      expect([i, r.statusCode, errorOf(r).code]).toEqual([i, 401, 'invalid_credentials']);
    }
    const events = (
      await admin.query<{ actor_id: string; target_type: string; metadata: Record<string, unknown> }>(
        `SELECT actor_id, target_type, metadata FROM audit_events WHERE action = 'auth.password.change_failed' AND target_id = $1 ORDER BY seq`,
        [userId],
      )
    ).rows;
    expect(events.length - before).toBe(THRESHOLD);
    expect(events.at(-1)).toEqual({ actor_id: userId, target_type: 'user', metadata: {} });
    const locked = await changePassword(token, PW);
    expect([locked.statusCode, errorOf(locked).code]).toEqual([429, 'account_locked']);
    expect(locked.headers['retry-after']).toBeDefined();
    // The password did not change (still the seed password) and login is locked for this email.
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: new Client(app).headers(), payload: { email, password: PW } });
    expect(login.statusCode).toBe(429);
  });

  it('known device: a live fr_rt of the same user passes the lock (knownDevice audited); none or another user’s cookie stays 429', async () => {
    const email = 'reviewer@acme.test';
    const other = 'analyst@acme.test';
    touched.add(email);
    touched.add(other);
    await clearLock(email);
    const fresh = await new Client(app).init();
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: fresh.headers(), payload: { email, password: PW } });
    expect(first.statusCode, first.body).toBe(200);
    const myCookie = refreshCookieOf(first);
    expect(myCookie).not.toBeNull();
    const otherLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: fresh.headers(), payload: { email: other, password: PW } });
    const otherCookie = refreshCookieOf(otherLogin);

    for (let i = 0; i < THRESHOLD; i += 1) {
      await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: fresh.headers(), payload: { email, password: 'Definitely-Wrong-Password-1!' } });
    }
    const withCookie = (cookie: string | null, password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { ...fresh.headers(), cookie: `fr_csrf=${fresh.csrf}${cookie ? `; fr_rt=${cookie}` : ''}` },
        payload: { email, password },
      });
    expect((await withCookie(null, PW)).statusCode).toBe(429);
    expect((await withCookie(otherCookie, PW)).statusCode).toBe(429);
    expect((await withCookie('not-a-real-token', PW)).statusCode).toBe(429);
    const wrong = await withCookie(myCookie, 'Definitely-Wrong-Password-1!');
    expect([wrong.statusCode, errorOf(wrong).code]).toEqual([401, 'invalid_credentials']);
    const ok = await withCookie(myCookie, PW);
    expect(ok.statusCode, ok.body).toBe(200);
    const userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]?.id ?? '';
    const ev = (
      await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'auth.login.success' AND actor_id = $1 ORDER BY seq DESC LIMIT 1`, [userId])
    ).rows[0];
    expect(ev?.metadata['knownDevice']).toBe(true);
    // The presented cookie was only checked: its token row is still unused and not revoked.
    const { createHmac } = await import('node:crypto');
    const row = (
      await admin.query<{ used_at: Date | null; revoked_at: Date | null }>(`SELECT used_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`, [
        createHmac('sha256', pepper).update(myCookie ?? '').digest('hex'),
      ])
    ).rows[0];
    expect(row).toEqual({ used_at: null, revoked_at: null });
    // Success cleared the lock.
    expect((await admin.query(`SELECT 1 FROM login_lockouts WHERE email_hash = $1`, [eh(email)])).rowCount).toBe(0);
  });

  it('promotion to an MFA-required role revokes the subject’s password-only sessions; other changes revoke nothing', async () => {
    const owner = await c.login('owner@acme.test');
    const subjectEmail = 'viewer@acme.test';
    const subjectId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [subjectEmail])).rows[0]?.id ?? '';
    const subjectToken = await new Client(app).init().then((x) => x.login(subjectEmail));
    const role = (await admin.query<{ role: string }>(`SELECT role::text AS role FROM memberships WHERE user_id = $1`, [subjectId])).rows[0]?.role ?? 'VIEWER';
    try {
      // A change to a role without the MFA requirement revokes nothing.
      const toAnalyst = await app.inject({ method: 'PATCH', url: `/api/v1/users/${subjectId}/role`, headers: c.headers(owner), payload: { role: 'ANALYST', reason: 'Synthetic role change for a test.' } });
      expect(toAnalyst.statusCode, toAnalyst.body).toBe(200);
      const plain = (
        await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'user.role_changed' AND target_id = $1 ORDER BY seq DESC LIMIT 1`, [subjectId])
      ).rows[0];
      expect(plain?.metadata['sessionsRevoked']).toBe(0);
      const promote = await app.inject({ method: 'PATCH', url: `/api/v1/users/${subjectId}/role`, headers: c.headers(owner), payload: { role: 'ADMIN', reason: 'Synthetic promotion for a test.' } });
      expect(promote.statusCode, promote.body).toBe(200);
      const ev = (
        await admin.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'user.role_changed' AND target_id = $1 ORDER BY seq DESC LIMIT 2`, [subjectId])
      ).rows;
      expect((ev[0]?.metadata['sessionsRevoked'] as number) >= 1).toBe(true);
      expect(ev[0]?.metadata['toRole']).toBe('ADMIN');
      const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${subjectToken}` } });
      expect(me.statusCode).toBe(401);
      const live = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [subjectId])).rows[0]?.n;
      expect(live).toBe(0);
      const reasons = (await admin.query<{ r: string }>(`SELECT DISTINCT revoked_reason AS r FROM refresh_tokens WHERE user_id = $1 AND revoked_reason = 'role_requires_mfa'`, [subjectId])).rows;
      expect(reasons).toHaveLength(1);
    } finally {
      await app.inject({ method: 'PATCH', url: `/api/v1/users/${subjectId}/role`, headers: c.headers(owner), payload: { role, reason: 'Restore the seeded role after a test.' } });
    }
  });

  it('an invite for another tenant’s account looks like any invite; one platform-chain invite.existing_account event', async () => {
    const owner = await c.login('owner@acme.test');
    const foreign = 'owner@globex.test';
    const own = 'viewer@acme.test';
    const mine = await c.send('POST', '/api/v1/users/invites', owner, { email: own, role: 'VIEWER' });
    expect([mine.statusCode, errorOf(mine).code]).toEqual([409, 'conflict']);
    const before = (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'invite.existing_account'`)).rows[0]?.n ?? 0;
    const r = await c.send('POST', '/api/v1/users/invites', owner, { email: foreign, role: 'VIEWER' });
    expect(r.statusCode, r.body).toBe(201);
    const body = r.json() as { id: string; email: string; role: string; expiresAt: string };
    expect(Object.keys(body).sort()).toEqual(['email', 'expiresAt', 'id', 'role']);
    const unknown = await c.send('POST', '/api/v1/users/invites', owner, { email: `zz-unknown-${Date.now()}@example.test`, role: 'VIEWER' });
    expect(unknown.statusCode, unknown.body).toBe(201);
    const tenantEvents = (
      await admin.query<{ id: string; keys: string[] }>(
        `SELECT target_id AS id, ARRAY(SELECT jsonb_object_keys(metadata) ORDER BY 1) AS keys FROM audit_events WHERE action = 'invite.created' AND target_id = ANY($1::text[])`,
        [[body.id, (unknown.json() as { id: string }).id]],
      )
    ).rows;
    expect(tenantEvents.map((e) => e.keys)).toEqual([
      ['inviteId', 'role'],
      ['inviteId', 'role'],
    ]);
    const platform = (
      await admin.query<{ tenant_id: string | null; metadata: Record<string, unknown> }>(`SELECT tenant_id, metadata FROM audit_events WHERE action = 'invite.existing_account' ORDER BY seq DESC LIMIT 1`)
    ).rows[0];
    expect((await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'invite.existing_account'`)).rows[0]?.n).toBe(before + 1);
    expect(platform).toEqual({ tenant_id: null, metadata: { inviteId: body.id } });
    // Clean up: revoke both invites.
    for (const id of [body.id, (unknown.json() as { id: string }).id]) await app.inject({ method: 'DELETE', url: `/api/v1/users/invites/${id}`, headers: c.headers(owner) });
  });
});
