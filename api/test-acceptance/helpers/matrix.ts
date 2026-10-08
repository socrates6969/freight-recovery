// Test-owned copy of the C2 permission matrix (the oracle). Compared against @fr/shared in T-RBAC-08.
export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const EXPECTED: Record<Role, string[]> = {
  OWNER: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'admins:manage', 'audit:read', 'settings:manage', 'integrations:manage', 'billing:manage', 'tenant:delete', 'import:run'],
  ADMIN: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'audit:read', 'settings:manage', 'integrations:manage', 'import:run'],
  MANAGER: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'import:run'],
  REVIEWER: ['claims:read', 'packets:edit', 'packets:approve', 'import:run'],
  ANALYST: ['claims:read', 'import:run'],
  VIEWER: ['claims:read'],
  PLATFORM_DEV: ['platform:health', 'platform:flags', 'platform:logs'],
  SUPER_ADMIN: ['platform:health', 'platform:tenants:list', 'platform:cross_tenant_read'],
};
export const ALL_PERMS = Array.from(new Set(Object.values(EXPECTED).flat())).sort();
export const RANK: Record<string, number> = { OWNER: 6, ADMIN: 5, MANAGER: 4, REVIEWER: 3, ANALYST: 2, VIEWER: 1 };
export const has = (r: Role, p: string) => EXPECTED[r].includes(p);