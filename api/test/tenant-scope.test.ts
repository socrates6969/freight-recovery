import { describe, expect, it } from 'vitest';

import { TenantScopeError } from '../src/db/errors.js';
import { TENANT_MODELS, scopeArgs } from '../src/db/tenant.js';

const T = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('tenant scope (fail-closed Prisma extension logic)', () => {
  it('injects tenantId into reads, counts and mutations', () => {
    expect(scopeArgs('Claim', 'findMany', { where: { status: 'APPROVED' } }, T)).toEqual({ where: { status: 'APPROVED', tenantId: T } });
    expect(scopeArgs('Claim', 'findMany', undefined, T)).toEqual({ where: { tenantId: T } });
    expect(scopeArgs('Claim', 'count', {}, T)).toEqual({ where: { tenantId: T } });
    expect(scopeArgs('Claim', 'findUnique', { where: { id: 'x' } }, T)).toEqual({ where: { id: 'x', tenantId: T } });
    expect(scopeArgs('Claim', 'update', { where: { id: 'x' }, data: { status: 'APPROVED' } }, T)).toEqual({
      where: { id: 'x', tenantId: T },
      data: { status: 'APPROVED' },
    });
    expect(scopeArgs('Approval', 'deleteMany', { where: {} }, T)).toEqual({ where: { tenantId: T } });
    expect(scopeArgs('Claim', 'groupBy', { by: ['status'] }, T)).toEqual({ by: ['status'], where: { tenantId: T } });
  });

  it('sets tenantId on creates and rejects a different one', () => {
    expect(scopeArgs('Claim', 'create', { data: { claimNumber: 'C' } }, T)).toEqual({ data: { claimNumber: 'C', tenantId: T } });
    expect(scopeArgs('PacketSource', 'createMany', { data: [{ a: 1 }, { a: 2 }] }, T)).toEqual({
      data: [
        { a: 1, tenantId: T },
        { a: 2, tenantId: T },
      ],
    });
    expect(() => scopeArgs('Claim', 'create', { data: { tenantId: OTHER } }, T)).toThrow(TenantScopeError);
    expect(() => scopeArgs('Claim', 'create', { data: { tenant: { connect: { id: OTHER } } } }, T)).toThrow(TenantScopeError);
    expect(() => scopeArgs('Claim', 'findMany', { where: { tenantId: OTHER } }, T)).toThrow(TenantScopeError);
    expect(() => scopeArgs('Claim', 'update', { where: { id: 'x' }, data: { tenantId: OTHER } }, T)).toThrow(TenantScopeError);
  });

  it('scopes upserts on both branches', () => {
    expect(scopeArgs('Claim', 'upsert', { where: { id: 'x' }, create: { a: 1 }, update: { b: 2 } }, T)).toEqual({
      where: { id: 'x', tenantId: T },
      create: { a: 1, tenantId: T },
      update: { b: 2 },
    });
  });

  it('denies unclassified models, raw operations and global tables', () => {
    for (const m of ['User', 'RefreshToken', 'MfaSecret', 'AuditEvent', 'LoginLockout', 'MailOutbox', 'BrandNewModel']) {
      expect(() => scopeArgs(m, 'findMany', {}, T)).toThrow(TenantScopeError);
    }
    expect(() => scopeArgs(undefined, '$queryRaw', {}, T)).toThrow(TenantScopeError);
    expect(TENANT_MODELS.has('AuditEvent')).toBe(false);
  });

  it('classifies every step-3 import model as tenant-scoped', () => {
    for (const m of ['ImportBatch', 'ImportDocument', 'ExtractedField', 'ImportReviewDecision', 'ClaimDocument']) {
      expect([m, TENANT_MODELS.has(m)]).toEqual([m, true]);
      expect(scopeArgs(m, 'findMany', { where: { id: 'x' } }, T)).toEqual({ where: { id: 'x', tenantId: T } });
      expect(() => scopeArgs(m, 'create', { data: { tenantId: OTHER } }, T)).toThrow(TenantScopeError);
    }
  });

  it('allows Tenant only as a read of the own tenant', () => {
    expect(scopeArgs('Tenant', 'findUnique', { where: { id: T } }, T)).toEqual({ where: { id: T } });
    expect(scopeArgs('Tenant', 'findFirst', {}, T)).toEqual({ where: { id: T } });
    expect(scopeArgs('Tenant', 'findUnique', { where: { id: OTHER } }, T)).toEqual({ where: { id: OTHER, AND: [{ id: T }] } });
    expect(() => scopeArgs('Tenant', 'findMany', {}, T)).toThrow(TenantScopeError);
    expect(() => scopeArgs('Tenant', 'update', { where: { id: T }, data: {} }, T)).toThrow(TenantScopeError);
  });

  it('rejects a non-UUID tenant id', () => {
    expect(() => scopeArgs('Claim', 'findMany', {}, "x' OR 1=1 --")).toThrow(TenantScopeError);
  });
});
