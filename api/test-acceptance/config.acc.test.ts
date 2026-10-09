/* eslint-disable */
// T-CFG-01..04: startup guards and configuration
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client, buildTestApp, closeApps, expectError } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import { TEST_DATABASE_URL, baseEnv, childEnv } from './helpers/env.js';

afterAll(closeApps);
const REPO = resolve(__dirname, '..', '..');
// base64 (the documented `openssl rand -base64 48` format); random hex secrets are rejected ~20% of the time by the variety guard (defect D6)
const b64 = () => randomBytes(48).toString('base64');

const prod = () => ({
  NODE_ENV: 'production',
  DATABASE_URL: `${TEST_DATABASE_URL}?sslmode=require`,
  APP_ORIGIN: 'https://app.example.test',
  JWT_SECRET: b64(),
  CSRF_SECRET: b64(),
  REFRESH_PEPPER: b64(),
  MFA_ENC_KEY: randomBytes(32).toString('base64'),
  API_KEY_PEPPER: b64(), // step 4 (Q13): required at every startup
  COOKIE_SECURE: 'true',
  MAIL_TRANSPORT: 'ses',
  REDIS_URL: 'redis://127.0.0.1:6399/0',
  ENABLE_DEV_OUTBOX: 'false',
  RATE_LIMIT_ENABLED: 'true',
  ARGON2_MEMORY_KIB: '19456',
  LOCKOUT_THRESHOLD: '5',
  TRUST_PROXY: '',
  LOG_LEVEL: 'silent',
});
async function build(env: Record<string, string>) {
  const mod: any = await import('../src/app.js');
  return mod.buildApp(env);
}
async function rejects(env: Record<string, string>) {
  try {
    const app = await Promise.race([build(env), new Promise((_, rej) => setTimeout(() => rej(new Error('__TIMEOUT__')), 15000))]);
    await (app as any).close?.();
    return null;
  } catch (e) {
    return e as Error;
  }
}
const VARS = ['COOKIE_SECURE', 'APP_ORIGIN', 'ENABLE_DEV_OUTBOX', 'MAIL_TRANSPORT', 'REDIS_URL', 'DATABASE_URL', 'JWT_SECRET', 'CSRF_SECRET', 'REFRESH_PEPPER', 'MFA_ENC_KEY', 'API_KEY_PEPPER', 'RATE_LIMIT_ENABLED', 'ARGON2_MEMORY_KIB', 'LOCKOUT_THRESHOLD', 'TRUST_PROXY'];

/** Documented public dev/CI defaults for a secret: compose.web.yml (${X:-default}), web-ci.yml (X: value), .env.example (non-placeholder only). */
function devDefaults(name: string): string[] {
  const out: string[] = [];
  const read = (p: string) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8') : '');
  const compose = new RegExp(`${name}:\\s*\\$\\{${name}:-([^}]+)\\}`).exec(read('compose.web.yml'));
  if (compose) out.push(compose[1]!.trim());
  const ci = new RegExp(`^\\s*${name}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm').exec(read('.github/workflows/web-ci.yml'));
  if (ci) out.push(ci[1]!.trim());
  for (const p of ['.env.example', 'api/.env.example']) {
    const m = new RegExp(`^${name}=(.+)$`, 'm').exec(read(p));
    if (m && !m[1]!.trim().startsWith('<')) out.push(m[1]!.trim().replace(/^["']|["']$/g, ''));
  }
  return out.filter((v) => v.length >= 10);
}
describe('T-CFG-01 production guards', () => {
  const secretsIn = (env: Record<string, string>) => [env.JWT_SECRET, env.CSRF_SECRET, env.REFRESH_PEPPER, env.MFA_ENC_KEY].filter((s) => s && s.length >= 8) as string[];
  const cases: Array<[string, Record<string, string>]> = [
    ['COOKIE_SECURE=false', { COOKIE_SECURE: 'false' }],
    ['APP_ORIGIN http', { APP_ORIGIN: 'http://x.example' }],
    ['ENABLE_DEV_OUTBOX=true', { ENABLE_DEV_OUTBOX: 'true' }],
    ['MAIL_TRANSPORT=outbox', { MAIL_TRANSPORT: 'outbox' }],
    ['REDIS_URL missing', { REDIS_URL: '' }],
    ['DATABASE_URL without sslmode', { DATABASE_URL: TEST_DATABASE_URL }],
    ['JWT_SECRET 10 chars', { JWT_SECRET: 'abcdefghij' }],
    ['CSRF_SECRET short', { CSRF_SECRET: 'tooshort' }],
    ['REFRESH_PEPPER short', { REFRESH_PEPPER: 'tooshort' }],
    ['MFA_ENC_KEY wrong length', { MFA_ENC_KEY: Buffer.from('short').toString('base64') }],
    ['RATE_LIMIT_ENABLED=false', { RATE_LIMIT_ENABLED: 'false' }],
    ['ARGON2_MEMORY_KIB=8', { ARGON2_MEMORY_KIB: '8' }],
    ['LOCKOUT_THRESHOLD=1', { LOCKOUT_THRESHOLD: '1' }],
    ['TRUST_PROXY=*', { TRUST_PROXY: '*' }],
    ['ACCESS_TOKEN_TTL_SECONDS below floor', { ACCESS_TOKEN_TTL_SECONDS: '1' }],
    ['LOCKOUT_BASE_SECONDS below floor', { LOCKOUT_BASE_SECONDS: '0' }],
  ];
  for (const [label, patch] of cases) {
    it(`rejects: ${label}`, async () => {
      const env = { ...prod(), ...patch };
      const err = await rejects(env);
      expect(err, `${label} must be refused at start-up`).toBeTruthy();
      expect(err!.message).not.toBe('__TIMEOUT__');
      // production now refuses every (unimplemented) MAIL_TRANSPORT, so each case is only meaningful if the error names its own variable
      const own = Object.keys(patch)[0]!;
      expect(err!.message, `error must name ${own}`).toContain(own);
      for (const s of secretsIn(env)) expect(err!.message.includes(s), 'error message leaks a secret').toBe(false);
    }, 30000);
  }
  for (const n of ['JWT_SECRET', 'CSRF_SECRET', 'REFRESH_PEPPER', 'MFA_ENC_KEY']) {
    it(`rejects ${n} equal to a documented dev/CI default`, async (ctx) => {
      const ds = devDefaults(n);
      if (!ds.length) return ctx.skip(`no documented dev default for ${n}`);
      for (const d of ds) {
        const err = await rejects({ ...prod(), [n]: d });
        expect(err, `${n}=<documented default> must be refused in production`).toBeTruthy();
        expect(err!.message.includes(d)).toBe(false);
      }
    }, 60000);
  }  it('rejects the .env.example placeholder secrets in production and in test', async (ctx) => {
    const ex = resolve(REPO, '.env.example');
    if (!existsSync(ex)) return ctx.skip('no .env.example');
    const txt = readFileSync(ex, 'utf8');
    let n = 0;
    for (const name of ['JWT_SECRET', 'CSRF_SECRET', 'REFRESH_PEPPER', 'MFA_ENC_KEY']) {
      const m = new RegExp(`^${name}=(<.+>)\\s*$`, 'm').exec(txt);
      if (!m) continue;
      n++;
      for (const base of [prod(), { ...baseEnv(), NODE_ENV: 'test' }]) {
        const err = await rejects({ ...base, [name]: m[1]! });
        expect(err, `${name} placeholder must be refused (NODE_ENV=${base.NODE_ENV})`).toBeTruthy();
        expect(err!.message).not.toBe('__TIMEOUT__');
      }
    }
    expect(n).toBeGreaterThan(0);
  }, 60000);  it('an otherwise valid production config is refused ONLY because no mail transport is implemented (MAIL_TRANSPORT=ses)', async () => {
    const err = await rejects(prod());
    expect(err, 'production must refuse until a real mail transport exists').toBeTruthy();
    expect(err!.message).not.toBe('__TIMEOUT__');
    expect(err!.message).toContain('MAIL_TRANSPORT');
    for (const v of VARS.filter((x) => x !== 'MAIL_TRANSPORT')) expect(err!.message.includes(v), `unexpected complaint about ${v}: ${err!.message.slice(0, 300)}`).toBe(false);
  }, 40000);
});
describe('T-CFG-02 required variables', () => {
  for (const v of ['JWT_SECRET', 'CSRF_SECRET', 'REFRESH_PEPPER', 'MFA_ENC_KEY', 'APP_ORIGIN', 'DATABASE_URL']) {
    it(`missing ${v} -> rejection naming the variable, not a value`, async () => {
      const err = await rejects(baseEnv({ [v]: '' }));
      expect(err, `${v} missing must be refused`).toBeTruthy();
      expect(err!.message).toContain(v);
      const val = baseEnv()[v]!;
      if (val.length >= 16) expect(err!.message.includes(val)).toBe(false);
    }, 30000);
  }
});

describe('T-CFG-03 dev outbox switch', () => {
  it('404 when unset/false even in test; reachable when true', async () => {
    for (const v of ['false', '']) {
      const a = await buildTestApp({ ENABLE_DEV_OUTBOX: v });
      expectError(await new Client(a).get('/dev/outbox?to=a%40b.test'), 404, 'not_found');
    }
    const on = await buildTestApp({ ENABLE_DEV_OUTBOX: 'true' });
    expect((await new Client(on).get('/dev/outbox?to=a%40b.test')).status).toBe(200);
  });
});

describe('T-CFG-04 db:seed refuses in production', () => {
  it('non-zero exit and no data change', async () => {
    const counts = () => withAdmin(async (c) => (await c.query(`select (select count(*) from users)::int u, (select count(*) from claims)::int c, (select count(*) from tenants)::int t, (select coalesce(max(seq),0) from audit_events)::bigint a`)).rows[0]);
    const before = await counts();
    const r = spawnSync('npm', ['run', 'db:seed', '--', '--reset'], { cwd: REPO, env: childEnv({ NODE_ENV: 'production' }), shell: true, encoding: 'utf8', timeout: 120000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
    expect(await counts()).toEqual(before);
    expect(before.c).toBeGreaterThan(0); // control: data existed to be protected
  }, 130000);
});