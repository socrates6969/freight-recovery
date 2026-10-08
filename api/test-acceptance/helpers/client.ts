/* eslint-disable */
// Black-box HTTP client over app.inject with a cookie jar, CSRF handling and MFA-aware login.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { APP_ORIGIN, SEED_PASSWORD, SEED_TOTP_SECRET, baseEnv } from './env.js';
import { freshCode } from './totp.js';

const apps: FastifyInstance[] = [];

export async function buildTestApp(
  overrides: Record<string, string> = {},
  opts: { logStream?: NodeJS.WritableStream } = {},
): Promise<FastifyInstance> {
  // Only `buildApp` may be imported from application source (C6).
  const mod: any = await import('../../src/app.js');
  const app: FastifyInstance = await mod.buildApp(baseEnv(overrides), opts);
  apps.push(app);
  return app;
}
export async function closeApps(): Promise<void> {
  while (apps.length) {
    try {
      await apps.pop()!.close();
    } catch {
      /* ignore */
    }
  }
}

export interface Res {
  status: number;
  headers: Record<string, any>;
  body: any;
  text: string;
  setCookies: string[];
  ms: number;
}

export interface SendOpts {
  body?: unknown;
  raw?: string;
  token?: string;
  /** 'auto' (default for unsafe): header = jar cookie. false: no header. 'header-only': header, no cookie.
   *  'mismatch': header differs from cookie. 'tamper': both flipped last char. string: custom header. */
  csrf?: 'auto' | false | 'header-only' | 'mismatch' | 'tamper' | string;
  headers?: Record<string, string>;
  ip?: string;
  noCookies?: boolean;
  cookies?: Record<string, string>;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function parseSetCookie(sc: string) {
  const parts = sc.split(';').map((s) => s.trim());
  const [nv, ...attrs] = parts;
  const eq = nv!.indexOf('=');
  const name = nv!.slice(0, eq);
  const value = nv!.slice(eq + 1);
  const a: Record<string, string | true> = {};
  for (const x of attrs) {
    const i = x.indexOf('=');
    if (i < 0) a[x.toLowerCase()] = true;
    else a[x.slice(0, i).toLowerCase()] = x.slice(i + 1);
  }
  return { name, value, attrs: a };
}

export function apiPath(p: string): string {
  if (p.startsWith('/api/') || p === '/healthz' || p === '/readyz') return p;
  return '/api/v1' + (p.startsWith('/') ? p : '/' + p);
}

export class Client {
  jar = new Map<string, { value: string; path: string }>();
  constructor(
    public app: FastifyInstance,
    public ip = '10.0.0.1',
  ) {}

  cookieFor(path: string): string {
    const out: string[] = [];
    for (const [n, c] of this.jar) if (path.startsWith(c.path)) out.push(`${n}=${c.value}`);
    return out.join('; ');
  }
  cookie(name: string): string | undefined {
    return this.jar.get(name)?.value;
  }
  private absorb(setCookies: string[]) {
    for (const sc of setCookies) {
      const { name, value, attrs } = parseSetCookie(sc);
      const maxAge = attrs['max-age'];
      if (value === '' || maxAge === '0') this.jar.delete(name);
      else this.jar.set(name, { value, path: typeof attrs['path'] === 'string' ? attrs['path'] : '/' });
    }
  }
  async ensureCsrf(): Promise<string> {
    let c = this.cookie('fr_csrf');
    if (!c) {
      const r = await this.send('GET', '/auth/csrf');
      c = r.body?.csrfToken ?? this.cookie('fr_csrf');
    }
    return c!;
  }

  async send(method: string, path: string, o: SendOpts = {}): Promise<Res> {
    const url = apiPath(path);
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers['authorization'] = `Bearer ${o.token}`;
    let payload: string | undefined;
    if (o.raw !== undefined) payload = o.raw;
    else if (o.body !== undefined) {
      payload = JSON.stringify(o.body);
      headers['content-type'] ??= 'application/json';
    }
    const jarBefore = new Map(this.jar);
    let extraCookies: Record<string, string> = {};
    if (!SAFE.has(method) && url.startsWith('/api/v1')) {
      const mode = o.csrf === undefined ? 'auto' : o.csrf;
      if (mode !== false) {
        const jarTok = await this.ensureCsrf();
        let hdr = jarTok;
        const flipped = jarTok.slice(0, -1) + (jarTok.endsWith('A') ? 'B' : 'A');
        if (mode === 'header-only') {
          this.jar.delete('fr_csrf');
        } else if (mode === 'mismatch') {
          hdr = flipped;
        } else if (mode === 'tamper') {
          hdr = flipped;
          extraCookies = { fr_csrf: flipped };
        } else if (mode !== 'auto') {
          hdr = mode;
        }
        headers['x-csrf-token'] = hdr;
      }
    }
    const cookieMap = new Map<string, string>();
    if (!o.noCookies) {
      for (const kv of this.cookieFor(url).split('; ').filter(Boolean)) {
        const i = kv.indexOf('=');
        cookieMap.set(kv.slice(0, i), kv.slice(i + 1));
      }
    }
    for (const [k, v] of Object.entries({ ...extraCookies, ...(o.cookies ?? {}) })) cookieMap.set(k, v);
    const cookie = [...cookieMap].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers['cookie'] = cookie;
    const t0 = Date.now();
    const injectOpts: any = { method, url, headers, remoteAddress: o.ip ?? this.ip };
    if (payload !== undefined) injectOpts.payload = payload;
    const res: any = await this.app.inject(injectOpts);
    const ms = Date.now() - t0;
    const sc = res.headers['set-cookie'];
    const setCookies = Array.isArray(sc) ? sc : sc ? [sc as string] : [];
    if (o.csrf === 'header-only') for (const [k, v] of jarBefore) if (!this.jar.has(k)) this.jar.set(k, v);
    this.absorb(setCookies);
    let body: any = undefined;
    try {
      body = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.statusCode, headers: res.headers as any, body, text: res.body, setCookies, ms };
  }
  get = (p: string, o?: SendOpts) => this.send('GET', p, o);
  post = (p: string, body?: unknown, o: SendOpts = {}) => this.send('POST', p, { body: body ?? {}, ...o });
  patch = (p: string, body?: unknown, o: SendOpts = {}) => this.send('PATCH', p, { body, ...o });
  destroy = (p: string, o?: SendOpts) => this.send('DELETE', p, o);
}

export interface Session {
  client: Client;
  token: string;
  user: any;
  email: string;
  loginRes: Res;
  as: (m: string, p: string, o?: SendOpts) => Promise<Res>;
  get: (p: string, o?: SendOpts) => Promise<Res>;
  post: (p: string, b?: unknown, o?: SendOpts) => Promise<Res>;
  patch: (p: string, b?: unknown, o?: SendOpts) => Promise<Res>;
  destroy: (p: string, o?: SendOpts) => Promise<Res>;
}

export function makeSession(client: Client, email: string, res: Res): Session {
  const s: Session = {
    client,
    email,
    loginRes: res,
    token: res.body.accessToken,
    user: res.body.user,
    as: (m, p, o = {}) => client.send(m, p, { token: s.token, ...o }),
    get: (p, o) => s.as('GET', p, o),
    post: (p, b, o) => s.as('POST', p, { body: b ?? {}, ...o }),
    patch: (p, b, o) => s.as('PATCH', p, { body: b, ...o }),
    destroy: (p, o) => s.as('DELETE', p, o),
  };
  return s;
}

export async function rawLogin(client: Client, email: string, password = SEED_PASSWORD): Promise<Res> {
  await client.ensureCsrf();
  return client.post('/auth/login', { email, password });
}

export async function loginRes(
  app: FastifyInstance,
  email: string,
  password = SEED_PASSWORD,
  mfaSecret = SEED_TOTP_SECRET,
  ip?: string,
): Promise<{ client: Client; res: Res }> {
  const client = new Client(app, ip);
  let res = await rawLogin(client, email, password);
  // Another suite (e.g. `npm run test:integration` run just before in CI) may already have consumed the
  // current TOTP step server-side; on invalid_code re-login and move on to the next unused step.
  for (let attempt = 0; attempt < 3 && res.status === 200 && res.body?.status === 'mfa_required'; attempt++) {
    const code = await freshCode(mfaSecret, email);
    res = await client.post('/auth/mfa/verify', { mfaToken: res.body.mfaToken, code });
    if (res.status === 401 && res.body?.error?.code === 'invalid_code' && attempt < 2) res = await rawLogin(client, email, password);
  }  return { client, res };
}

/** Full login (with MFA when required, using the fixed seed secret). Throws when no session results. */
export async function login(
  app: FastifyInstance,
  email: string,
  password = SEED_PASSWORD,
  mfaSecret = SEED_TOTP_SECRET,
  ip?: string,
): Promise<Session> {
  const { client, res } = await loginRes(app, email, password, mfaSecret, ip);
  if (res.status !== 200 || res.body?.status !== 'ok')
    throw new Error(`login(${email}) failed: ${res.status} ${res.text}`);
  return makeSession(client, email, res);
}

const cache = new Map<string, Promise<Session>>();
let appSeq = 0;
const appIds = new WeakMap<object, number>();
/** Per-test-file cached session. */
export function sessionFor(app: FastifyInstance, email: string): Promise<Session> {
  if (!appIds.has(app)) appIds.set(app, ++appSeq);
  const k = `${appIds.get(app)}:${email}`;
  if (!cache.has(k)) cache.set(k, sharedSession(app, email));
  return cache.get(k)!;
}

// Cross-file cache of seeded-account access tokens: TOTP replay protection permits only ~1 MFA login
// per account per 30 s, so seeded MFA accounts are logged in once and the token is reused while valid.
// (Tests that need a private session for a seeded account call login() directly.)
const SESS_FILE = join(tmpdir(), 'fr-acc-sessions.json');
function readSess(): Record<string, { token: string; user: any; ts: number }> {
  try {
    return existsSync(SESS_FILE) ? JSON.parse(readFileSync(SESS_FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}
async function sharedSession(app: FastifyInstance, email: string): Promise<Session> {
  const hit = readSess()[email];
  if (hit && Date.now() - hit.ts < 5 * 60_000) {
    const client = new Client(app);
    const probe = await client.get('/me', { token: hit.token });
    if (probe.status === 200)
      return makeSession(client, email, {
        status: 200, headers: {}, text: '', setCookies: [], ms: 0,
        body: { status: 'ok', accessToken: hit.token, user: probe.body.user },
      });
  }
  const s = await login(app, email);
  const all = readSess();
  all[email] = { token: s.token, user: s.user, ts: Date.now() };
  try {
    writeFileSync(SESS_FILE, JSON.stringify(all));
  } catch {
    /* cache is best-effort */
  }
  return s;
}
export function resetSessionCache() {
  cache.clear();
}

export const ACCOUNTS = {
  OWNER: 'owner@acme.test',
  ADMIN: 'admin@acme.test',
  MANAGER: 'manager@acme.test',
  REVIEWER: 'reviewer@acme.test',
  ANALYST: 'analyst@acme.test',
  VIEWER: 'viewer@acme.test',
  PLATFORM_DEV: 'dev@platform.test',
  SUPER_ADMIN: 'super@platform.test',
} as const;
export type RoleName = keyof typeof ACCOUNTS;
export const ALL_ROLES = Object.keys(ACCOUNTS) as RoleName[];
export const TENANT_ROLES: RoleName[] = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'];

export async function claimIndex(s: Session): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  for (let page = 1; page < 10; page++) {
    const r = await s.get(`/claims?pageSize=100&page=${page}`);
    expect(r.status).toBe(200);
    for (const it of r.body.items) m.set(it.claimNumber, it);
    if (r.body.items.length < 100) break;
  }
  return m;
}
export async function claimId(s: Session, num: string): Promise<string> {
  const r = await s.get(`/claims?q=${encodeURIComponent(num)}&pageSize=100`);
  const hit = r.body?.items?.find((i: any) => i.claimNumber === num);
  if (!hit) throw new Error(`claim ${num} not found (${r.status}) ${r.text.slice(0, 200)}`);
  return hit.id;
}

export async function outboxToken(c: Client, to: string, kind?: string): Promise<string | undefined> {
  const r = await c.get(`/dev/outbox?to=${encodeURIComponent(to)}`);
  expect(r.status).toBe(200);
  return r.body.items.find((i: any) => !kind || i.kind === kind)?.token;
}

export async function allAudit(s: Session, qs = ''): Promise<any[]> {
  const out: any[] = [];
  let before: number | null = null;
  for (let i = 0; i < 200; i++) {
    const q = `limit=100${qs ? '&' + qs : ''}${before ? `&before=${before}` : ''}`;
    const r = await s.get(`/audit/events?${q}`);
    expect(r.status).toBe(200);
    out.push(...r.body.items);
    if (r.body.nextBefore == null) break;
    before = r.body.nextBefore;
  }
  return out;
}

export function expectError(res: Res, status: number, code?: string) {
  expect(res.status, res.text).toBe(status);
  expect(res.body?.error, res.text).toBeTruthy();
  if (code) expect(res.body.error.code).toBe(code);
  expect(typeof res.body.error.message).toBe('string');
  expect(typeof res.body.error.requestId).toBe('string');
}

export const strip = (b: any) => JSON.parse(JSON.stringify(b, (k, v) => (k === 'requestId' ? undefined : v)));

export const CSP_API = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
export function expectSecurityHeaders(res: Res, opts: { hsts?: boolean | null } = {}) {
  const h = res.headers;
  expect(h['cache-control']).toBe('no-store');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['cross-origin-resource-policy']).toBe('same-origin');
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  const pp = String(h['permissions-policy'] ?? '');
  for (const f of ['camera', 'microphone', 'geolocation', 'payment']) expect(pp).toMatch(new RegExp(`${f}=\\(\\)`));
  expect(h['content-security-policy']).toBe(CSP_API);
  expect(h['x-request-id']).toBeTruthy();
  expect(h['x-powered-by']).toBeUndefined();
  expect(String(h['server'] ?? '')).not.toMatch(/fastify|node|express|\d+\.\d+/i);
  for (const k of Object.keys(h)) expect(k.toLowerCase().startsWith('access-control-')).toBe(false);
  if (opts.hsts === true) expect(h['strict-transport-security']).toMatch(/^max-age=\d+; includeSubDomains$/);
  if (opts.hsts === false) expect(h['strict-transport-security']).toBeUndefined();
}

export { APP_ORIGIN, SEED_PASSWORD, SEED_TOTP_SECRET };