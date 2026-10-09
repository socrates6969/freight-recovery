/**
 * Helpers for the step 4 integration tests (real PostgreSQL, migrated + seeded). Logs in seed users
 * (MFA users via the seed TOTP secret, waiting for the next 30 s window when a code was already used).
 */
import type { FastifyInstance } from 'fastify';

export const PW = 'Synthetic-Pass-2026!';
export const SEED_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const appUrl = process.env['TEST_DATABASE_URL'];
export const adminUrl = process.env['TEST_ADMIN_DATABASE_URL'];
export const canRunDb = Boolean(appUrl && adminUrl);

/**
 * Explicit API key pepper for the integration apps. buildApp merges process.env underneath the passed
 * env, and CI exports its own job-level API_KEY_PEPPER, so tests that compute key hashes must pin the
 * pepper here instead of assuming the dev default.
 */
export const STEP4_TEST_API_KEY_PEPPER = 'integration-test-api-key-pepper-not-for-production-0123456789';

export function step4Env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: appUrl ?? '',
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    COOKIE_SECURE: 'false',
    RATE_LIMIT_AUTH_MAX: '1000',
    RATE_LIMIT_PLATFORM_MAX: '1000',
    RATE_LIMIT_INTELLIGENCE_MAX: '1000',
    FLAGS_CACHE_TTL_MS: '0',
    API_KEY_PEPPER: STEP4_TEST_API_KEY_PEPPER,
    ...extra,
  };
}

export class Client {
  csrf = '';

  constructor(readonly app: FastifyInstance) {}

  async init(): Promise<this> {
    const r = await this.app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    this.csrf = (r.json() as { csrfToken: string }).csrfToken;
    return this;
  }

  headers(token?: string): Record<string, string> {
    return { cookie: `fr_csrf=${this.csrf}`, 'x-csrf-token': this.csrf, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }

  async login(email: string): Promise<string> {
    const { totpCodeAt } = await import('../../src/security/totp.js');
    const r = await this.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: this.headers(), payload: { email, password: PW } });
    if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.statusCode}`);
    const body = r.json() as { status: string; accessToken?: string; mfaToken?: string };
    if (body.accessToken) return body.accessToken;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const v = await this.app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/verify',
        headers: this.headers(),
        payload: { mfaToken: body.mfaToken, code: totpCodeAt(SEED_TOTP, Date.now()) },
      });
      if (v.statusCode === 200) return (v.json() as { accessToken: string }).accessToken;
      await new Promise((res) => setTimeout(res, 30_500 - (Date.now() % 30_000)));
    }
    throw new Error(`MFA login failed for ${email}`);
  }

  get(url: string, token?: string) {
    return this.app.inject({ method: 'GET', url, headers: this.headers(token) });
  }

  send(method: 'POST' | 'PUT', url: string, token: string | undefined, payload: unknown) {
    return this.app.inject({ method, url, headers: this.headers(token), payload: payload as Record<string, unknown> });
  }
}
