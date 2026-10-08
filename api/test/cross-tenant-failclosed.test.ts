/**
 * crossTenantRead is fail-closed (no database): the audit append into the TARGET tenant chain happens
 * first inside the same transaction, and if it throws the read never runs and the error propagates
 * (so the transaction rolls back and the request fails).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let auditFails = false;

vi.mock('../src/audit/audit.js', () => ({
  appendAudit: vi.fn(async () => {
    calls.push('audit');
    if (auditFails) throw new Error('audit store unavailable');
    return { id: 'a', seq: 1, hash: 'h' };
  }),
}));
vi.mock('../src/db/system.js', () => ({
  withSystemTx: vi.fn(async (_base: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ tenant: { findUnique: async () => ({ id: TARGET }) } }),
  ),
}));
vi.mock('../src/db/tenant.js', () => ({
  withTenantTx: vi.fn(async (_base: unknown, tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    calls.push(`tx:${tenantId}`);
    try {
      const r = await fn({});
      calls.push('commit');
      return r;
    } catch (e) {
      calls.push('rollback');
      throw e;
    }
  }),
}));

const TARGET = '22222222-2222-4222-8222-222222222222';
const actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'SUPER_ADMIN' as const, ip: '127.0.0.1', requestId: 'r' };

describe('crossTenantRead fail-closed', () => {
  beforeEach(() => {
    calls.length = 0;
    auditFails = false;
  });

  it('audits in the target tenant transaction before reading, then commits', async () => {
    const { crossTenantRead } = await import('../src/platform/cross-tenant.js');
    const read = vi.fn(async () => {
      calls.push('read');
      return 'rows';
    });
    await expect(crossTenantRead({} as never, actor, TARGET, 'Support ticket 42 check', {}, read)).resolves.toBe('rows');
    expect(calls).toEqual([`tx:${TARGET}`, 'audit', 'read', 'commit']);
  });

  it('never reads and rolls back when the audit append fails', async () => {
    auditFails = true;
    const { crossTenantRead } = await import('../src/platform/cross-tenant.js');
    const read = vi.fn(async () => 'rows');
    await expect(crossTenantRead({} as never, actor, TARGET, 'Support ticket 42 check', {}, read)).rejects.toThrow('audit store unavailable');
    expect(read).not.toHaveBeenCalled();
    expect(calls).toEqual([`tx:${TARGET}`, 'audit', 'rollback']);
  });

  it('refuses non-SUPER_ADMIN actors and unknown tenant ids before any audit', async () => {
    const { crossTenantRead } = await import('../src/platform/cross-tenant.js');
    await expect(crossTenantRead({} as never, { ...actor, role: 'OWNER' }, TARGET, 'reason long enough', {}, async () => 1)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(crossTenantRead({} as never, actor, 'not-a-uuid', 'reason long enough', {}, async () => 1)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(calls).toEqual([]);
  });
});
