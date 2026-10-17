import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  PERMISSION_MATRIX,
  ROLES,
  TENANT_ROLES,
  can,
  canAssignRole,
  canManageUserWithRole,
  roleRequiresMfa,
  type Permission,
  type Role,
} from './rbac.js';

// Expected matrix transcribed from the public contract (C2): permission -> roles granted.
const Y: Record<Permission, readonly Role[]> = {
  'claims:read': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'],
  'claims:assign': ['OWNER', 'ADMIN', 'MANAGER'],
  'packets:edit': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'],
  'packets:approve': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'],
  'demands:send': ['OWNER', 'ADMIN', 'MANAGER'],
  'users:read': ['OWNER', 'ADMIN'],
  'users:manage': ['OWNER', 'ADMIN'],
  'admins:manage': ['OWNER'],
  'audit:read': ['OWNER', 'ADMIN'],
  'settings:manage': ['OWNER', 'ADMIN'],
  'integrations:manage': ['OWNER', 'ADMIN'],
  'billing:manage': ['OWNER'],
  'tenant:delete': ['OWNER'],
  'import:run': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST'],
  // Step 3 (N2): VIEWER and platform roles get none of these.
  'import:review': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'],
  'export:claims': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST'],
  'export:packets': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'],
  'export:outcomes': ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'],
  'platform:health': ['PLATFORM_DEV', 'SUPER_ADMIN'],
  'platform:flags': ['PLATFORM_DEV'],
  'platform:logs': ['PLATFORM_DEV'],
  'platform:tenants:list': ['SUPER_ADMIN'],
  'platform:cross_tenant_read': ['SUPER_ADMIN'],
};

describe('permission matrix', () => {
  it('has 8 roles and matches the contract cell by cell', () => {
    expect(ROLES).toHaveLength(8);
    for (const p of PERMISSIONS) {
      for (const r of ROLES) {
        expect([r, p, can(r, p)]).toEqual([r, p, Y[p].includes(r)]);
      }
    }
  });

  it('grants no tenant-data permission to platform roles and no platform permission to tenant roles', () => {
    for (const r of TENANT_ROLES) {
      expect(PERMISSION_MATRIX[r].some((p) => p.startsWith('platform:'))).toBe(false);
    }
    for (const r of ['PLATFORM_DEV', 'SUPER_ADMIN'] as const) {
      expect(PERMISSION_MATRIX[r].every((p) => p.startsWith('platform:'))).toBe(true);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PERMISSION_MATRIX)).toBe(true);
    expect(Object.isFrozen(PERMISSION_MATRIX.VIEWER)).toBe(true);
  });

  it('requires MFA exactly for OWNER, ADMIN and platform roles', () => {
    expect(ROLES.filter(roleRequiresMfa)).toEqual(['OWNER', 'ADMIN', 'PLATFORM_DEV', 'SUPER_ADMIN']);
  });
});

describe('canAssignRole', () => {
  it('never allows OWNER as a target', () => {
    for (const r of ROLES) expect(canAssignRole(r, 'OWNER')).toBe(false);
  });
  it('lets OWNER assign ADMIN and below', () => {
    for (const t of ['ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as const) {
      expect(canAssignRole('OWNER', t)).toBe(true);
    }
  });
  it('lets ADMIN assign only below ADMIN', () => {
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'MANAGER')).toBe(true);
    expect(canAssignRole('ADMIN', 'VIEWER')).toBe(true);
  });
  it('denies roles without users:manage and platform roles', () => {
    for (const r of ['MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN'] as const) {
      expect(canAssignRole(r, 'VIEWER')).toBe(false);
    }
    expect(canAssignRole('OWNER', 'SUPER_ADMIN')).toBe(false);
  });
  it('requires admins:manage for ADMIN targets', () => {
    expect(canAssignRole('OWNER', 'ADMIN', ['users:manage'])).toBe(false);
  });
});

describe('canManageUserWithRole', () => {
  it('ADMIN cannot manage ADMIN or OWNER but can manage MANAGER', () => {
    expect(canManageUserWithRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageUserWithRole('ADMIN', 'OWNER')).toBe(false);
    expect(canManageUserWithRole('ADMIN', 'MANAGER')).toBe(true);
  });
  it('OWNER can manage OWNER, ADMIN and below', () => {
    expect(canManageUserWithRole('OWNER', 'OWNER')).toBe(true);
    expect(canManageUserWithRole('OWNER', 'ADMIN')).toBe(true);
    expect(canManageUserWithRole('OWNER', 'VIEWER')).toBe(true);
  });
  it('MANAGER and below cannot manage anyone', () => {
    expect(canManageUserWithRole('MANAGER', 'VIEWER')).toBe(false);
    expect(canManageUserWithRole('VIEWER', 'VIEWER')).toBe(false);
  });
});
