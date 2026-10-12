/* eslint-disable */
// REQ-20261012-hardening Tier H, fix round 1: T10 HP-C01..HP-C04 and HP-C06 client address behind CloudFront (Part C
// C11). Own process: needs CLIENT_IP_HEADER / ORIGIN_VERIFY_SECRET env. Every request comes from one socket address
// unless stated (TRUST_PROXY unset). Recorded addresses are read over SQL by time window. The origin-verify value
// below is a public test-only value (synthetic; production refuses ci-only-* values).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, Client, type Res, buildTestApp, closeApps, expectError, sessionFor } from './helpers/client.js';
import { withAdmin } from './helpers/db.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';

const SECRET = 'ci-only-origin-verify-test-value-0123456789abcdefABCDEF';
const ENV = { CLIENT_IP_HEADER: 'cloudfront-viewer-address', ORIGIN_VERIFY_SECRET: SECRET, TRUST_PROXY: '', RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_AUTH_MAX: '2', RATE_LIMIT_GLOBAL_MAX: '100000', LOCKOUT_THRESHOLD: '50' };
let app: FastifyInstance;
let lines: string[] = [];
let n = 0;
const nobody = () => `nobody-${Date.now()}-${++n}@example.test`;
const dbNow = () => withAdmin(async (c) => (await c.query('select now() t')).rows[0].t as Date);
const attemptIps = (t: Date) => withAdmin(async (c) => (await c.query('select ip from login_attempts where created_at >= $1 order by created_at', [t])).rows.map((r: any) => r.ip as string));
const failureAuditIps = (t: Date) => withAdmin(async (c) => (await c.query(`select ip from audit_events where action = 'auth.login.failure' and created_at >= $1 order by seq`, [t])).rows.map((r: any) => r.ip as string));
/** Failed login (unknown synthetic email) from `socket` with the given proxy headers. */
async function fail(socket: string, headers: Record<string, string>): Promise<Res> {
  const c = new Client(app, socket);
  await c.ensureCsrf();
  return c.post('/auth/login', { email: nobody(), password: 'Wrong-Password-1234!' }, { headers });
}

beforeAll(async () => {
  const b = await I.buildLogged({ ...ENV });
  app = b.app;
  lines = b.lines;
}, 120000);
afterAll(closeApps);

describe('HP-C01 trusted viewer address', () => {
  it('correct x-origin-verify: buckets and records use the viewer address', async () => {
    const t = await dbNow();
    const h = (v: string) => ({ 'x-origin-verify': SECRET, 'cloudfront-viewer-address': v });
    const rs = [await fail('10.70.0.1', h('203.0.113.7:51000')), await fail('10.70.0.1', h('203.0.113.7:51000')), await fail('10.70.0.1', h('203.0.113.7:51000')), await fail('10.70.0.1', h('198.51.100.9:443'))];
    expectError(rs[0]!, 401, 'invalid_credentials');
    expectError(rs[1]!, 401, 'invalid_credentials');
    expectError(rs[2]!, 429, 'rate_limited');
    expectError(rs[3]!, 401, 'invalid_credentials');
    const ips = await attemptIps(t);
    expect(new Set(ips)).toEqual(new Set(['203.0.113.7', '198.51.100.9']));
    const aud = await failureAuditIps(t);
    expect(aud.length).toBeGreaterThanOrEqual(3);
    expect(new Set(aud)).toEqual(new Set(['203.0.113.7', '198.51.100.9']));
  }, 60000);
});

describe('HP-C02 untrusted header ignored', () => {
  for (const [label, verify, socket] of [['no x-origin-verify', null, '10.70.1.1'], ['wrong x-origin-verify', 'wrong-value', '10.70.1.2']] as const) {
    it(`${label}: shared socket bucket (third 429); recorded ip is the socket address, never the spoofed ones`, async () => {
      const t = await dbNow();
      const spoof = ['192.0.2.10:1000', '192.0.2.11:1000', '192.0.2.12:1000'];
      const rs: Res[] = [];
      for (const v of spoof) rs.push(await fail(socket, { 'cloudfront-viewer-address': v, ...(verify ? { 'x-origin-verify': verify } : {}) }));
      expect(rs.map((r) => r.status)).toEqual([401, 401, 429]);
      const ips = [...(await attemptIps(t)), ...(await failureAuditIps(t))];
      expect(ips.length).toBeGreaterThan(0);
      for (const ip of ips) expect(ip, 'socket-derived address').toBe(socket);
    }, 60000);
  }
});

describe('HP-C03 malformed viewer header values fall back; IPv6 parsed', () => {
  it('malformed -> socket address (request not failed); both IPv6 forms -> 2001:db8::1', async () => {
    let k = 0;
    for (const v of ['abc', '203.0.113.7', '203.0.113.7:0', '203.0.113.7:70000', '999.1.1.1:443']) {
      const socket = `10.70.2.${++k}`;
      const t = await dbNow();
      expectError(await fail(socket, { 'x-origin-verify': SECRET, 'cloudfront-viewer-address': v }), 401, 'invalid_credentials');
      expect(await attemptIps(t), v).toEqual([socket]);
    }
    for (const v of ['2001:db8::1:443', '[2001:db8::1]:443']) {
      const t = await dbNow();
      expectError(await fail('10.70.3.1', { 'x-origin-verify': SECRET, 'cloudfront-viewer-address': v }), 401, 'invalid_credentials');
      expect(await attemptIps(t), v).toEqual(['2001:db8::1']);
    }
  }, 60000);
});

describe('HP-C04 API-key failure gate per viewer address', () => {
  it('RATE_LIMIT_API_KEY_FAIL_MAX=2: address A refused after its budget; address B still 401', async () => {
    const lim = await buildTestApp({ ...ENV, RATE_LIMIT_AUTH_MAX: '100000', RATE_LIMIT_API_KEY_FAIL_MAX: '2' });
    const h = (v: string) => ({ 'x-origin-verify': SECRET, 'cloudfront-viewer-address': v });
    const st: number[] = [];
    for (let i = 0; i < 3; i++) st.push((await K.keyReq(lim, K.fakeKey('5555666677778888'), 'GET', '/claims', { ip: '10.70.4.1', headers: h('203.0.113.50:1234') })).status);
    expect(st).toEqual([401, 401, 429]);
    const b = await K.keyReq(lim, K.fakeKey('5555666677778888'), 'GET', '/claims', { ip: '10.70.4.1', headers: h('203.0.113.51:1234') });
    expect(b.status, b.text).toBe(401);
  }, 60000);
});

describe('HP-C06 the secret never reaches the logs', () => {
  it('no log line contains the ORIGIN_VERIFY_SECRET value; x-origin-verify is redacted', async () => {
    const s = await sessionFor(app, ACCOUNTS.VIEWER);
    await s.get('/me', { headers: { 'x-origin-verify': SECRET, 'cloudfront-viewer-address': '203.0.113.9:1' } });
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.includes(SECRET), 'secret in a log line').toBe(false);
    const withHeader = lines.filter((l) => /x-origin-verify/i.test(l));
    for (const l of withHeader) expect(l, 'header redacted').toMatch(/x-origin-verify"?\s*:\s*"?\[?(Redacted|REDACTED|\*+)/i);
  }, 60000);
});
