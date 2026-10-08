/**
 * Integration (real PostgreSQL, migrated + seeded): an audit append failure makes the parent action fail
 * (500) and rolls back its business change. Run with `npm run test:integration` (needs TEST_DATABASE_URL,
 * TEST_ADMIN_DATABASE_URL and the secrets the seed used, notably MFA_ENC_KEY).
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AuditModule from '../../src/audit/audit.js';
import type { AuditInput } from '../../src/audit/audit.js';

const failOn = new Set<string>();

vi.mock('../../src/audit/audit.js', async (importOriginal) => {
  const real = await importOriginal<typeof AuditModule>();
  return {
    ...real,
    appendAudit: vi.fn(async (tx: Parameters<typeof real.appendAudit>[0], input: AuditInput) => {
      if (failOn.has(input.action)) throw new Error('simulated audit store failure');
      return real.appendAudit(tx, input);
    }),
  };
});

const { buildApp } = await import('../../src/app.js');
const { totpCodeAt } = await import('../../src/security/totp.js');

const PW = 'Synthetic-Pass-2026!';
const TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const appUrl = process.env['TEST_DATABASE_URL'];
const adminUrl = process.env['TEST_ADMIN_DATABASE_URL'];

let app: FastifyInstance;
let admin: pg.Client;
let csrf = '';

const H = (token?: string) => ({
  cookie: `fr_csrf=${csrf}`,
  'x-csrf-token': csrf,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

async function login(email: string, mfa: boolean): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: H(), payload: { email, password: PW } });
  expect(r.statusCode, r.body).toBe(200);
  const body = r.json() as { status: string; accessToken?: string; mfaToken?: string };
  if (!mfa) return body.accessToken ?? '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const v = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: H(),
      payload: { mfaToken: body.mfaToken, code: totpCodeAt(TOTP, Date.now()) },
    });
    if (v.statusCode === 200) return (v.json() as { accessToken: string }).accessToken;
    // The current step may already have been used by another login: wait for the next window.
    await new Promise((res) => setTimeout(res, 30_500 - (Date.now() % 30_000)));
  }
  throw new Error(`MFA login failed for ${email}`);
}

describe.skipIf(!appUrl || !adminUrl)('audit append failure is fail-closed (PostgreSQL)', () => {
  beforeAll(async () => {
    app = await buildApp({
      DATABASE_URL: appUrl ?? '',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      COOKIE_SECURE: 'false',
      RATE_LIMIT_AUTH_MAX: '1000',
    });
    await app.ready();
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    csrf = (r.json() as { csrfToken: string }).csrfToken;
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    await app?.close();
  });

  beforeEach(() => failOn.clear());

  it('approve: 500, and claim/packet status and approvals are unchanged', async () => {
    const manager = await login('manager@acme.test', false);
    const queue = (
      await app.inject({ method: 'GET', url: '/api/v1/approvals?status=PENDING_REVIEW&pageSize=100', headers: { authorization: `Bearer ${manager}` } })
    ).json() as { items: { id: string; packetRevision: number; pendingFindingsCount: number }[] };
    const target = queue.items.find((i) => i.pendingFindingsCount === 0);
    expect(target).toBeDefined();
    const id = target?.id ?? '';
    const before = await admin.query('SELECT (SELECT count(*)::int FROM approvals WHERE claim_id = $1) AS approvals, (SELECT status::text FROM claims WHERE id = $1) AS status, (SELECT count(*)::int FROM audit_events) AS events', [id]);

    failOn.add('approval.approved');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${id}/packet/approve`,
      headers: H(manager),
      payload: { packetRevision: target?.packetRevision, reason: 'Fail-closed audit test approval.' },
    });
    expect(r.statusCode).toBe(500);
    expect((r.json() as { error: { code: string } }).error.code).toBe('internal_error');

    const after = await admin.query(
      "SELECT (SELECT count(*)::int FROM approvals WHERE claim_id = $1) AS approvals, (SELECT status::text FROM claims WHERE id = $1) AS status, (SELECT count(*)::int FROM audit_events) AS events, (SELECT status::text FROM evidence_packets WHERE claim_id = $1 AND status <> 'SUPERSEDED') AS packet",
      [id],
    );
    expect(after.rows[0].approvals).toBe(before.rows[0].approvals);
    expect(after.rows[0].status).toBe('PENDING_REVIEW');
    expect(after.rows[0].packet).toBe('PENDING_REVIEW');
    expect(after.rows[0].events).toBe(before.rows[0].events);
  }, 120_000);

  it('invite (system transaction): 500, and no invite or mail is left behind', async () => {
    const owner = await login('owner@acme.test', true);
    const email = `failclosed-${Date.now()}@acme.test`;
    failOn.add('invite.created');
    const r = await app.inject({ method: 'POST', url: '/api/v1/users/invites', headers: H(owner), payload: { email, role: 'VIEWER' } });
    expect(r.statusCode).toBe(500);
    const left = await admin.query('SELECT (SELECT count(*)::int FROM invites WHERE email = $1) AS invites, (SELECT count(*)::int FROM mail_outbox WHERE to_email = $1) AS mails', [email]);
    expect(left.rows[0]).toEqual({ invites: 0, mails: 0 });
  }, 180_000);

  it('SUPER_ADMIN cross-tenant read: 500, no data returned, no audit row', async () => {
    const sup = await login('super@platform.test', true);
    const tenants = (await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: { authorization: `Bearer ${sup}` } })).json() as {
      items: { id: string; name: string }[];
    };
    const acme = tenants.items.find((t) => t.name.startsWith('Acme'));
    expect(acme).toBeDefined();
    const count = async () =>
      (await admin.query("SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'platform.cross_tenant_read'", [acme?.id])).rows[0].n as number;
    const before = await count();
    failOn.add('platform.cross_tenant_read');
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${acme?.id}/claims?reason=${encodeURIComponent('Fail-closed audit test ticket')}`,
      headers: { authorization: `Bearer ${sup}` },
    });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('CLM-');
    expect(await count()).toBe(before);

    failOn.clear();
    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${acme?.id}/claims?reason=${encodeURIComponent('Fail-closed audit test ticket')}`,
      headers: { authorization: `Bearer ${sup}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(await count()).toBe(before + 1);
  }, 180_000);
});
