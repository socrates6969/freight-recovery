/**
 * HTTP pipeline unit tests that never reach the database (the DB URL points at a closed port):
 * security headers on 200/401/404/500, error body shape, evaluation order (rate limit -> Origin ->
 * CSRF -> authN -> validation), body limit, route-access enforcement, dev outbox absence.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { defineRoute } from '../src/http/route.js';

const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none',
  JWT_SECRET: 'unit-jwt-secret-0123456789abcdef0123456789abcdef',
  CSRF_SECRET: 'unit-csrf-secret-0123456789abcdef0123456789abcdef',
  REFRESH_PEPPER: 'unit-pepper-0123456789abcdef0123456789abcdef0123',
  MFA_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
  APP_ORIGIN: 'http://127.0.0.1:8080',
  COOKIE_SECURE: 'false',
  LOG_LEVEL: 'silent',
  ARGON2_MEMORY_KIB: '8',
  ARGON2_TIME_COST: '1',
};

const CLAIM = '11111111-1111-4111-8111-111111111111';
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function make(extra: Record<string, string> = {}, setup?: (a: FastifyInstance) => void): Promise<FastifyInstance> {
  app = await buildApp({ ...ENV, ...extra });
  setup?.(app);
  await app.ready();
  return app;
}

async function csrf(a: FastifyInstance): Promise<{ token: string; cookie: string }> {
  const r = await a.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
  const token = (r.json() as { csrfToken: string }).csrfToken;
  return { token, cookie: `fr_csrf=${token}` };
}

function expectSecurityHeaders(h: Record<string, unknown>): void {
  expect(h['cache-control']).toBe('no-store');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['cross-origin-resource-policy']).toBe('same-origin');
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  expect(String(h['permissions-policy'])).toContain('camera=()');
  expect(h['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  expect(typeof h['x-request-id']).toBe('string');
  expect(h['x-powered-by']).toBeUndefined();
  expect(h['server']).toBeUndefined();
  expect(h['access-control-allow-origin']).toBeUndefined();
  expect(h['strict-transport-security']).toBeUndefined();
}

describe('API HTTP pipeline (no database)', () => {
  it('emits the security header set on 200, 401, 404 and 500 with a fixed error body', async () => {
    const a = await make({}, (x) =>
      defineRoute(x, {
        method: 'GET',
        url: '/api/v1/__boom',
        access: { kind: 'public' },
        handler: async () => {
          throw new Error('SELECT * FROM secret_table /home/app/src/x.ts');
        },
      }),
    );
    const ok = await a.inject({ method: 'GET', url: '/healthz' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok' });
    expectSecurityHeaders(ok.headers);

    const unauth = await a.inject({ method: 'GET', url: '/api/v1/me' });
    expect(unauth.statusCode).toBe(401);
    expectSecurityHeaders(unauth.headers);
    expect(unauth.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Authentication required.', requestId: unauth.headers['x-request-id'] },
    });

    const nf = await a.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(nf.statusCode).toBe(404);
    expectSecurityHeaders(nf.headers);
    expect((nf.json() as { error: { code: string } }).error.code).toBe('not_found');

    const boom = await a.inject({ method: 'GET', url: '/api/v1/__boom' });
    expect(boom.statusCode).toBe(500);
    expectSecurityHeaders(boom.headers);
    expect(boom.body).not.toContain('secret_table');
    expect(boom.body).not.toContain('/home/app');
    expect((boom.json() as { error: { code: string; message: string } }).error).toMatchObject({
      code: 'internal_error',
      message: 'Internal server error.',
    });
  });

  it('emits HSTS only when configured', async () => {
    const a = await make({ HSTS_MAX_AGE_SECONDS: '600' });
    const r = await a.inject({ method: 'GET', url: '/healthz' });
    expect(r.headers['strict-transport-security']).toBe('max-age=600; includeSubDomains');
  });

  it('never honors a client-supplied request id', async () => {
    const a = await make();
    const r = await a.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'attacker-chosen' } });
    expect(r.headers['x-request-id']).not.toBe('attacker-chosen');
  });

  it('rejects invalid bearer tokens with 401 without touching the database', async () => {
    const a = await make();
    for (const authorization of ['Bearer garbage.token.here', 'Basic abc', 'Bearer ']) {
      const r = await a.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization } });
      expect(r.statusCode).toBe(401);
    }
  });

  it('issues a CSRF cookie with the contract attributes', async () => {
    const a = await make({ COOKIE_SECURE: 'true' });
    const r = await a.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const setCookie = String(r.headers['set-cookie']);
    expect(setCookie).toMatch(/^fr_csrf=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/u);
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toContain('HttpOnly');
  });

  it('enforces Origin, then CSRF, then authentication, then validation', async () => {
    const a = await make();
    const { token, cookie } = await csrf(a);
    const url = `/api/v1/claims/${CLAIM}/assign`;
    const badBody = { nonsense: true };

    const noCsrf = await a.inject({ method: 'POST', url, payload: badBody });
    expect(noCsrf.statusCode).toBe(403);
    expect((noCsrf.json() as { error: { code: string } }).error.code).toBe('csrf_failed');

    const mismatch = await a.inject({ method: 'POST', url, payload: badBody, headers: { cookie, 'x-csrf-token': `${token}x` } });
    expect((mismatch.json() as { error: { code: string } }).error.code).toBe('csrf_failed');

    const badOrigin = await a.inject({
      method: 'POST',
      url,
      payload: badBody,
      headers: { cookie, 'x-csrf-token': token, origin: 'https://evil.example' },
    });
    expect(badOrigin.statusCode).toBe(403);
    expect((badOrigin.json() as { error: { code: string } }).error.code).toBe('origin_not_allowed');

    const crossSite = await a.inject({
      method: 'POST',
      url,
      payload: badBody,
      headers: { cookie, 'x-csrf-token': token, 'sec-fetch-site': 'cross-site' },
    });
    expect((crossSite.json() as { error: { code: string } }).error.code).toBe('origin_not_allowed');

    const unauth = await a.inject({
      method: 'POST',
      url,
      payload: badBody,
      headers: { cookie, 'x-csrf-token': token, origin: 'http://127.0.0.1:8080' },
    });
    expect(unauth.statusCode).toBe(401);

    const invalid = await a.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@b.test' }, headers: { cookie, 'x-csrf-token': token } });
    expect(invalid.statusCode).toBe(400);
    const body = invalid.json() as { error: { code: string; details: { path: string; code: string }[] } };
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details).toEqual([{ path: 'password', code: 'invalid_type' }]);

    const unknownKey = await a.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.test', password: 'x', admin: true },
      headers: { cookie, 'x-csrf-token': token },
    });
    expect(unknownKey.statusCode).toBe(400);
    expect(unknownKey.body).not.toContain('true');
  });

  it('applies the body limit (413) and rejects non-JSON bodies', async () => {
    const a = await make({ BODY_LIMIT_BYTES: '2048' });
    const { token, cookie } = await csrf(a);
    const big = await a.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.test', password: 'x'.repeat(5000) },
      headers: { cookie, 'x-csrf-token': token },
    });
    expect(big.statusCode).toBe(413);
    expect((big.json() as { error: { code: string } }).error.code).toBe('payload_too_large');
    const text = await a.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: 'email=a',
      headers: { cookie, 'x-csrf-token': token, 'content-type': 'text/plain' },
    });
    expect(text.statusCode).toBe(415);
  });

  it('rate limits globally and per auth group with Retry-After (before CSRF)', async () => {
    const a = await make({ RATE_LIMIT_GLOBAL_MAX: '3' });
    for (let i = 0; i < 3; i += 1) expect((await a.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const limited = await a.inject({ method: 'GET', url: '/healthz' });
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: { code: string } }).error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    await a.close();
    app = null;

    const b = await make({ RATE_LIMIT_AUTH_MAX: '1' });
    const first = await b.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
    expect(first.statusCode).toBe(403);
    const second = await b.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
    expect(second.statusCode).toBe(429);
  });

  it('does not register the dev outbox unless enabled outside production', async () => {
    const a = await make();
    expect((await a.inject({ method: 'GET', url: '/api/v1/dev/outbox' })).statusCode).toBe(404);
  });

  it('refuses to boot with a route that lacks an access declaration', async () => {
    app = await buildApp(ENV);
    const a = app;
    expect(() => a.route({ method: 'GET', url: '/naked', handler: async () => 'x' })).toThrow(/no access declaration/u);
  });

  it('does not answer OPTIONS preflights permissively', async () => {
    const a = await make();
    const r = await a.inject({
      method: 'OPTIONS',
      url: '/api/v1/claims',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(r.statusCode).toBe(404);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});
