/* eslint-disable */
// T-RBAC-08 and T-SH-04: the shared permission matrix is the single source of truth
import { describe, expect, it } from 'vitest';
import { ALL_PERMS, EXPECTED, RANK, ROLES } from './helpers/oracle.js';

const load = async () => (await import('@fr/shared')) as any;

describe('T-RBAC-08 PERMISSION_MATRIX / ROLES / can equal the C2 table', () => {
  it('ROLES is exactly the 8 contract roles', async () => {
    const m = await load();
    expect([...m.ROLES].sort()).toEqual([...ROLES].sort());
  });
  it('can(role, permission) equals every cell of the table (8 roles x all permissions)', async () => {
    const m = await load();
    for (const role of ROLES) for (const p of ALL_PERMS) expect(m.can(role, p), `${role} ${p}`).toBe(EXPECTED[role].includes(p));
  });
  it('PERMISSION_MATRIX data agrees with the table (whatever shape it uses)', async () => {
    const m = await load();
    const M = m.PERMISSION_MATRIX;
    expect(M, 'PERMISSION_MATRIX exported').toBeTruthy();
    let shapes = 0;
    for (const role of ROLES) {
      const v = M[role];
      if (Array.isArray(v) || v instanceof Set) { shapes++; expect([...v].sort(), role).toEqual([...EXPECTED[role]].sort()); }
      else if (v && typeof v === 'object') { shapes++; expect(Object.keys(v).filter((k) => v[k]).sort(), role).toEqual([...EXPECTED[role]].sort()); }
    }
    if (shapes === 0) {
      for (const p of ALL_PERMS) {
        const rolesFor = M[p];
        expect(rolesFor, `permission-keyed matrix entry for ${p}`).toBeTruthy();
        shapes++;
        expect([...rolesFor].sort(), p).toEqual(ROLES.filter((r) => EXPECTED[r].includes(p)).sort());
      }
    }
    expect(shapes, 'unrecognised PERMISSION_MATRIX shape').toBeGreaterThan(0);
  });
  it('unknown permission strings are never granted', async () => {
    const m = await load();
    for (const role of ROLES) for (const bogus of ['', 'nope', 'claims:*', '*', 'claims:read ', 'CLAIMS:READ', '__proto__', 'constructor', 'toString', 'claims:readx', 'platform:*']) expect(m.can(role, bogus), `${role} ${JSON.stringify(bogus)}`).toBe(false);
  });
  it('structural guarantees', async () => {
    const m = await load();
    for (const p of ALL_PERMS.filter((x) => x.startsWith('claims:'))) expect(m.can('PLATFORM_DEV', p)).toBe(false);
    for (const p of ALL_PERMS.filter((x) => !x.startsWith('platform:'))) for (const r of ['PLATFORM_DEV', 'SUPER_ADMIN']) expect(m.can(r, p), `${r} ${p}`).toBe(false);
    for (const p of ['billing:manage', 'tenant:delete']) for (const r of ROLES) expect(m.can(r, p), `${r} ${p}`).toBe(r === 'OWNER');
    expect(m.can('SUPER_ADMIN', 'platform:cross_tenant_read')).toBe(true);
    expect(m.can('PLATFORM_DEV', 'platform:cross_tenant_read')).toBe(false);
  });
});

describe('T-SH-04 role-assignment rules (property loop, 500 seeded cases)', () => {
  it('canAssignRole is false when target rank >= actor rank; ADMIN needs admins:manage', async (ctx) => {
    const m = await load();
    if (typeof m.canAssignRole !== 'function') return ctx.skip('canAssignRole is not exported by @fr/shared');
    const rank = typeof m.rank === 'function' ? (r: string) => m.rank(r) : (r: string) => RANK[r] ?? 0;
    let s = 987654321;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const tenant = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'];
    const call = (a: string, t: string, perms: string[]) => { try { return m.canAssignRole(a, t, perms); } catch { return m.canAssignRole(a, t, new Set(perms)); } };
    let trues = 0;
    for (let i = 0; i < 500; i++) {
      const a = tenant[Math.floor(rnd() * 6)]!;
      const t = tenant[Math.floor(rnd() * 6)]!;
      const perms = ALL_PERMS.filter(() => rnd() < 0.6);
      const got = call(a, t, perms);
      if (RANK[t]! >= RANK[a]!) expect(got, `seed-case ${i}: ${a}->${t} must be false`).toBe(false);
      if (t === 'ADMIN' && !perms.includes('admins:manage')) expect(got, `seed-case ${i}: ADMIN needs admins:manage`).toBe(false);
      if (!perms.includes('users:manage')) expect(got, `seed-case ${i}: needs users:manage`).toBe(false);
      if (got) trues++;
      void rank;
    }
    expect(trues, 'property loop must exercise the permissive branch too').toBeGreaterThan(0);
    expect(call('OWNER', 'ADMIN', EXPECTED.OWNER)).toBe(true); // positive controls
    expect(call('ADMIN', 'MANAGER', EXPECTED.ADMIN)).toBe(true);
    expect(call('ADMIN', 'ADMIN', EXPECTED.ADMIN)).toBe(false);
    expect(call('ADMIN', 'OWNER', EXPECTED.ADMIN)).toBe(false);
  });
});