/**
 * Integration (PostgreSQL): when the mail transport fails,
 *  - POST /auth/forgot answers exactly like it does for an unknown email (202, same body, timing floor),
 *    leaves no reset token behind, and records `delivery_failed` in the account's audit chain;
 *  - POST /users/invites fails cleanly with 503 and rolls back (no invite, no mail row).
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as MailerModule from '../../src/auth/mailer.js';

vi.mock('../../src/auth/mailer.js', async (importOriginal) => {
  const real = await importOriginal<typeof MailerModule>();
  class BrokenOutboxMailer {
    send(): Promise<void> {
      return Promise.reject(new Error('smtp-relay-internal-detail 550'));
    }
  }
  return { ...real, OutboxMailer: BrokenOutboxMailer };
});

const { buildApp } = await import('../../src/app.js');
const { totpCodeAt } = await import('../../src/security/totp.js');

const appUrl = process.env['TEST_DATABASE_URL'];
const adminUrl = process.env['TEST_ADMIN_DATABASE_URL'];
let app: FastifyInstance;
let admin: pg.Client;
let csrf = '';
const H = (token?: string) => ({ cookie: `fr_csrf=${csrf}`, 'x-csrf-token': csrf, ...(token ? { authorization: `Bearer ${token}` } : {}) });

describe.skipIf(!appUrl || !adminUrl)('mail transport failure (PostgreSQL)', () => {
  beforeAll(async () => {
    app = await buildApp({ DATABASE_URL: appUrl ?? '', NODE_ENV: 'test', LOG_LEVEL: 'silent', COOKIE_SECURE: 'false', RATE_LIMIT_AUTH_MAX: '1000' });
    await app.ready();
    csrf = ((await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' })).json() as { csrfToken: string }).csrfToken;
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    await app?.close();
  });

  it('forgot-password: known account with failing mailer is indistinguishable from an unknown email', async () => {
    const resets = async () =>
      (await admin.query("SELECT count(*)::int AS n FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email = 'reset2@acme.test'")).rows[0].n as number;
    const before = await resets();
    const t0 = Date.now();
    const known = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: H(), payload: { email: 'reset2@acme.test' } });
    const t1 = Date.now();
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: H(), payload: { email: 'nobody-at-all@acme.test' } });
    const t2 = Date.now();
    expect([known.statusCode, known.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(known.statusCode).toBe(202);
    expect(known.body).not.toContain('smtp');
    expect(t1 - t0).toBeGreaterThanOrEqual(140);
    expect(t2 - t1).toBeGreaterThanOrEqual(140);
    expect(await resets()).toBe(before);
    const audit = await admin.query(
      "SELECT a.chain_key, a.actor_id, a.metadata->>'status' AS status FROM audit_events a JOIN users u ON a.target_id = u.id::text WHERE u.email = 'reset2@acme.test' AND a.action = 'auth.password.reset_requested' ORDER BY a.created_at DESC LIMIT 1",
    );
    expect(audit.rows[0]?.status).toBe('delivery_failed');
    expect(String(audit.rows[0]?.chain_key)).toMatch(/^t:/u);
    expect(audit.rows[0]?.actor_id).toBeNull();
  }, 60_000);

  it('invite: 503 with a fixed message, nothing persisted', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: H(), payload: { email: 'owner@acme.test', password: 'Synthetic-Pass-2026!' } });
    const mfaToken = (login.json() as { mfaToken: string }).mfaToken;
    let token = '';
    for (let i = 0; i < 3 && !token; i += 1) {
      const v = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/verify', headers: H(), payload: { mfaToken, code: totpCodeAt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', Date.now()) } });
      if (v.statusCode === 200) token = (v.json() as { accessToken: string }).accessToken;
      else await new Promise((r) => setTimeout(r, 30_500 - (Date.now() % 30_000)));
    }
    expect(token).not.toBe('');
    const email = `mailfail-${Date.now()}@acme.test`;
    const r = await app.inject({ method: 'POST', url: '/api/v1/users/invites', headers: H(token), payload: { email, role: 'VIEWER' } });
    expect(r.statusCode).toBe(503);
    expect((r.json() as { error: { code: string } }).error.code).toBe('service_unavailable');
    expect(r.body).not.toContain('smtp');
    const left = await admin.query('SELECT (SELECT count(*)::int FROM invites WHERE email = $1) AS invites, (SELECT count(*)::int FROM mail_outbox WHERE to_email = $1) AS mails', [email]);
    expect(left.rows[0]).toEqual({ invites: 0, mails: 0 });
  }, 180_000);
});
