import { MeResponse } from '@fr/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSessionStore } from '../auth/session-store';

import { ApiClient, ApiError } from './client';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'v@acme.test', name: 'V', role: 'VIEWER', tenant: null, mfaEnabled: false };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('ApiClient', () => {
  it('sends Bearer + CSRF on unsafe methods, same-origin credentials, JSON body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url) === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      return new Response(null, { status: 204 });
    });
    const session = createSessionStore();
    session.getState().setSession('tok', user as never);
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, session, () => undefined);
    await api.post('/api/v1/auth/change-password', { a: 1 });
    const post = calls.find((c) => c.url === '/api/v1/auth/change-password');
    const headers = post?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tok');
    expect(headers['x-csrf-token']).toBe('n.sig');
    expect(headers['content-type']).toBe('application/json');
    expect(post?.init.credentials).toBe('same-origin');
    expect(post?.init.body).toBe('{"a":1}');
  });

  it('refreshes once (single flight) on concurrent 401s and retries', async () => {
    let refreshes = 0;
    let tokenValid = false;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      if (u === '/api/v1/auth/refresh') {
        refreshes += 1;
        tokenValid = true;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'new', tokenType: 'Bearer', expiresIn: 600, user });
      }
      const auth = (init?.headers as Record<string, string>)['authorization'];
      if (!tokenValid || auth !== 'Bearer new') return json(401, { error: { code: 'unauthenticated', message: 'x', requestId: 'r' } });
      return json(200, { user, permissions: ['claims:read'] });
    });
    const session = createSessionStore();
    session.getState().setSession('old', user as never);
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, session, () => undefined);
    const [a, b, c] = await Promise.all([api.get('/api/v1/me', MeResponse), api.get('/api/v1/me', MeResponse), api.get('/api/v1/me', MeResponse)]);
    expect(refreshes).toBe(1);
    expect([a.permissions, b.permissions, c.permissions]).toEqual([['claims:read'], ['claims:read'], ['claims:read']]);
    expect(session.getState().accessToken).toBe('new');
  });

  it('calls onAuthLost when refresh fails', async () => {
    const lost = vi.fn();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      return json(401, { error: { code: 'unauthenticated', message: 'Authentication required.', requestId: 'r' } });
    });
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, createSessionStore(), lost);
    await expect(api.get('/api/v1/me', MeResponse)).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('never returns unparsed data (schema mismatch is a generic error)', async () => {
    const fetchImpl = vi.fn(async () => json(200, { user: '<script>', permissions: 'x' }));
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, createSessionStore(), () => undefined);
    const err = await api.get('/api/v1/me', MeResponse).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('bad_response');
    expect((err as ApiError).message).not.toContain('<script>');
  });

  it('surfaces fixed server error messages and Retry-After', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      return json(429, { error: { code: 'account_locked', message: 'Too many failed attempts. Try again later.', requestId: 'r' } }, { 'retry-after': '30' });
    });
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, createSessionStore(), () => undefined);
    const err = (await api.post('/api/v1/auth/login', { email: 'a', password: 'b' }, undefined, false).catch((e: unknown) => e)) as ApiError;
    expect([err.status, err.code, err.retryAfterSeconds]).toEqual([429, 'account_locked', 30]);
  });

  it('refuses non-API or cross-origin paths', async () => {
    const api = new ApiClient(vi.fn() as unknown as typeof fetch, createSessionStore(), () => undefined);
    await expect(api.request('GET', 'https://evil.example/api')).rejects.toThrow();
  });
});
