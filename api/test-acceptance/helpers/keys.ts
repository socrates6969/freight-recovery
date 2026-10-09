/* eslint-disable */
// Step 4 API-key helpers (Q13): key creation, bearer-only requests (no cookies, no CSRF), HMAC oracle, cleanup.
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { Client, makeSession, rawLogin, type Res, type Session } from './client.js';
import { SECRETS } from './env.js';
import { freshCode } from './totp.js';
import { newUser, enrollMfa, type NewUser } from './users.js';

export const KEY_FORMAT = /^fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/;
export const PEPPER = SECRETS.API_KEY_PEPPER;
export const hmacHex = (secret43: string) => createHmac('sha256', PEPPER).update(secret43, 'utf8').digest('hex');
export const splitKey = (full: string) => ({ keyId: full.slice(8, 24), secret: full.slice(25) });
export const fakeKey = (hex = 'a1b2c3d4e5f60718') => `fr_live_${hex}_${'Z'.repeat(43)}`;
export const SCOPES = ['claims.read', 'exports.claims', 'imports.write'] as const;

export interface Made { secret: string; key: any; res: Res }
export async function mkKey(owner: Session, scopes: string[], over: Record<string, unknown> = {}): Promise<Made> {
  const res = await owner.post('/api-keys', { name: `acc key ${scopes.join('+')}`, scopes, expiresInDays: 30, ...over });
  expect(res.status, res.text).toBe(201);
  expect(res.body.secret).toMatch(KEY_FORMAT);
  return { secret: res.body.secret, key: res.body.key, res };
}

export interface KeyReqOpts { body?: unknown; raw?: Buffer | string; headers?: Record<string, string>; ip?: string; ct?: string }
/** Bearer-only request: no cookies, no CSRF header. */
export async function keyReq(app: FastifyInstance, secret: string | null, method: string, path: string, o: KeyReqOpts = {}): Promise<Res> {
  const url = path.startsWith('/api/') || path === '/healthz' ? path : `/api/v1${path}`;
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`;
  let payload: any;
  if (o.raw !== undefined) { payload = o.raw; headers['content-type'] ??= o.ct ?? 'application/octet-stream'; }
  else if (o.body !== undefined) { payload = JSON.stringify(o.body); headers['content-type'] ??= 'application/json'; }
  const t0 = Date.now();
  const r: any = await app.inject({ method: method as any, url, headers, payload, remoteAddress: o.ip ?? '10.50.0.1' });
  let body: any;
  try { body = r.body ? JSON.parse(r.body) : undefined; } catch { body = undefined; }
  const sc = r.headers['set-cookie'];
  return { status: r.statusCode, headers: r.headers, body, text: r.body, setCookies: Array.isArray(sc) ? sc : sc ? [sc] : [], ms: Date.now() - t0 };
}

/** Revoke every ACTIVE key of the owner's tenant (cleanup). */
export async function revokeActive(owner: Session, only?: (k: any) => boolean) {
  const l = await owner.get('/api-keys');
  if (l.status !== 200) return;
  for (const k of l.body.items as any[]) {
    if (k.status !== 'ACTIVE' || (only && !only(k))) continue;
    await owner.post(`/api-keys/${k.id}/revoke`, { reason: 'acceptance suite cleanup' });
  }
}

/** Login for roles that may require MFA enrollment (ADMIN). */
export async function loginFresh(app: FastifyInstance, u: NewUser): Promise<Session> {
  const c = new Client(app, '10.9.9.6');
  const l = await rawLogin(c, u.email, u.password);
  if (l.status === 200 && l.body.status === 'ok') return makeSession(c, u.email, l);
  expect(l.body.status, l.text).toBe('mfa_enrollment_required');
  return (await enrollMfa(app, u.email, u.password)).session;
}
export async function newSession(app: FastifyInstance, inviter: Session, role: string): Promise<{ s: Session; u: NewUser }> {
  const u = await newUser(app, inviter, role);
  return { s: await loginFresh(app, u), u };
}
export const sameHeaders = (a: Res, b: Res) => {
  const pick = (r: Res) => Object.fromEntries(Object.entries(r.headers).filter(([k]) => !['x-request-id', 'date'].includes(k.toLowerCase())).sort());
  return [pick(a), pick(b)] as const;
};
export { freshCode };