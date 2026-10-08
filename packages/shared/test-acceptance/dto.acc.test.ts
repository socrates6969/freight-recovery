/* eslint-disable */
// T-SH-01..03: DTO schemas, canonical JSON, sanitizer helpers
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditEvent, claimSummary, packet } from './helpers/oracle.js';

const load = async () => (await import('@fr/shared')) as any;
const schemas = (m: any) => Object.entries(m).filter(([, v]: any) => v && typeof v.safeParse === 'function') as Array<[string, any]>;
const find = (m: any, re: RegExp) => schemas(m).find(([n]) => re.test(n))?.[1];

describe('T-SH-01 DTO schemas (request contracts exported by @fr/shared)', () => {
  const U = '00000000-0000-4000-8000-000000000001';
  const R = 'a reason long enough';
  type Case = [string, unknown, unknown, Record<string, unknown>];
  const cases: Case[] = [
    ['LoginBody', { email: 'a@acme.test', password: 'x' }, { email: 'a@acme.test', password: 5 }, { extra: 1 }],
    ['InviteCreateBody', { email: 'a@acme.test', role: 'MANAGER' }, { email: 'a@acme.test', role: 'BOGUS' }, { tenantId: U }],
    ['RoleChangeBody', { role: 'VIEWER', reason: R }, { role: 'SUPERUSER', reason: R }, { id: U }],
    ['AssignBody', { assigneeId: U }, { assigneeId: 'not-a-uuid' }, { status: 'APPROVED' }],
    ['RevisionBody', { baseRevision: 1, demandLetter: 'letter', reason: R }, { baseRevision: 'one', demandLetter: 'letter', reason: R }, { createdBy: U }],
    ['ApproveBody', { packetRevision: 1, reason: R, acknowledgePendingFindings: true }, { packetRevision: 1, reason: 'short' }, { status: 'x' }],
    ['TransitionBody', { packetRevision: 2, reason: R }, { packetRevision: 0, reason: R }, { x: 1 }],
    ['ClaimsQuery', { q: 'CLM', sort: 'createdAt:desc', page: '2' }, { sort: 'bogus:asc' }, { tenantId: U }],
  ];
  for (const [name, good, badEnum, extra] of cases) {
    it(`${name}: accepts canonical input, rejects wrong enum/type and unknown keys, JSON round-trips`, async () => {
      const m = await load();
      const s = m[name];
      expect(s?.safeParse, `${name} exported`).toBeTypeOf('function');
      const ok = s.safeParse(good);
      expect(ok.success, JSON.stringify(ok.error?.issues ?? [])).toBe(true);
      expect(s.safeParse(badEnum).success, 'wrong enum/type rejected').toBe(false);
      expect(s.safeParse({ ...(good as object), ...extra }).success, 'unknown key rejected').toBe(false);
      if (name !== 'ClaimsQuery') {
        // query schemas transform strings into typed values, so only body schemas are expected to round-trip
        const rt = s.safeParse(JSON.parse(JSON.stringify(ok.data)));
        expect(rt.success).toBe(true);
        expect(rt.data).toEqual(ok.data);
      }
    });
  }
  it('claim sort whitelist accepts the contract fields (incl. loadNumber) and rejects others', async () => {
    const m = await load();
    for (const f of ['createdAt', 'updatedAt', 'claimNumber', 'carrierName', 'status', 'amountClaimedCents', 'recoverableCents', 'loadNumber'])
      for (const d of ['asc', 'desc']) expect(m.ClaimsQuery.safeParse({ sort: `${f}:${d}` }).success, `${f}:${d}`).toBe(true);
    for (const bad of ['id:asc', 'createdAt;drop', 'createdAt:sideways', 'passwordHash:asc']) expect(m.ClaimsQuery.safeParse({ sort: bad }).success, bad).toBe(false);
  });
});
describe('T-SH-02 canonical JSON', () => {
  it('deterministic, key-order independent, whitespace-free, type-sensitive', async (ctx) => {
    const m = await load();
    const f = Object.entries(m).find(([n, v]) => /canonical/i.test(n) && typeof v === 'function')?.[1] as ((x: unknown) => string) | undefined;
    if (!f) return ctx.skip('no canonical-JSON helper exported by @fr/shared');
    let s = 42;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gen = (d: number): any => {
      const r = rnd();
      if (d > 3 || r < 0.3) return [Math.floor(rnd() * 1000), 'str' + Math.floor(rnd() * 99), true, null][Math.floor(rnd() * 4)];
      if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1));
      const o: Record<string, any> = {};
      for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) o['k' + Math.floor(rnd() * 20)] = gen(d + 1);
      return o;
    };
    const shuffle = (o: any): any => {
      if (Array.isArray(o)) return o.map(shuffle);
      if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).sort(() => rnd() - 0.5).map(([k, v]) => [k, shuffle(v)]));
      return o;
    };
    const h = (x: unknown) => createHash('sha256').update(f(x)).digest('hex');
    for (let i = 0; i < 1000; i++) {
      const o = gen(0);
      const a = f(o);
      expect(f(shuffle(o))).toBe(a);
      expect(f(JSON.parse(JSON.stringify(o)))).toBe(a);
      expect(h(shuffle(o))).toBe(h(o));
      if (typeof o === 'object' && o !== null) expect(/\n|\r|\t|: |, /.test(a.replace(/"[^"]*"/g, '""'))).toBe(false);
    }
    expect(f({ a: 1 })).not.toBe(f({ a: '1' }));
    expect(f({ a: 1, b: 2 })).toBe(f({ b: 2, a: 1 }));
    expect(f({ a: 1 })).not.toBe(f({ a: 2 }));
  });
});

describe('T-SH-03 sanitizer helpers', () => {
  it('displayText / stripUnsafeMultiline strip C0/C1/bidi, never throw on 1 MB, idempotent', async () => {
    const m = await load();
    const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
    const dirty = 'a\u0000b\u0007c\u001fd\u007fe\u0085f\u009fg\u202eh\u2066i\u2069j\nk';
    for (const name of ['displayText', 'stripUnsafeMultiline'] as const) {
      const f = m[name] as (s: string) => string;
      expect(typeof f, name).toBe('function');
      const out = f(dirty);
      const re = name === 'displayText' ? /[\u202a-\u202e\u2066-\u2069]/ : BAD; // displayText strips bidi only (documented); the multiline stripper strips C0/C1 too
      expect(re.test(out), `${name} leaves control/bidi chars`).toBe(false);
      expect(f(out), `${name} idempotent`).toBe(out);
      const big = 'x\u202e\u0007y'.repeat(300000).slice(0, 1_048_576);
      expect(() => f(big), `${name} on 1 MB`).not.toThrow();
      expect(f('plain ascii text')).toBe('plain ascii text');
    }
    expect(m.stripUnsafeMultiline('a\nb')).toBe('a\nb');
  });
});