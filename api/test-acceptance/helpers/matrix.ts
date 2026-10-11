// Test-owned copy of the C2 permission matrix (the oracle). Compared against @fr/shared in T-RBAC-08.
// REQ-20261011-charge-intelligence C8: charge_labels:manage added for OWNER, ADMIN, MANAGER, REVIEWER (additive).
// REQ-20261011-ocean-dd C14 (additive): dd_invoices:manage for OWNER, ADMIN, MANAGER, REVIEWER, ANALYST; dd_tariffs:manage for OWNER, ADMIN, MANAGER, REVIEWER.
export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const EXPECTED: Record<Role, string[]> = {
  OWNER: ['claims:read', 'claims:analyze', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'admins:manage', 'audit:read', 'settings:manage', 'integrations:manage', 'billing:manage', 'tenant:delete', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes', 'apikeys:manage', 'charge_labels:manage', 'dd_invoices:manage', 'dd_tariffs:manage'],
  ADMIN: ['claims:read', 'claims:analyze', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'audit:read', 'settings:manage', 'integrations:manage', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes', 'apikeys:manage', 'charge_labels:manage', 'dd_invoices:manage', 'dd_tariffs:manage'],
  MANAGER: ['claims:read', 'claims:analyze', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes', 'charge_labels:manage', 'dd_invoices:manage', 'dd_tariffs:manage'],
  REVIEWER: ['claims:read', 'claims:analyze', 'packets:edit', 'packets:approve', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes', 'charge_labels:manage', 'dd_invoices:manage', 'dd_tariffs:manage'],
  ANALYST: ['claims:read', 'claims:analyze', 'import:run', 'export:claims', 'dd_invoices:manage'],
  VIEWER: ['claims:read'],
  PLATFORM_DEV: ['platform:health', 'platform:flags', 'platform:logs', 'platform:eval'],
  SUPER_ADMIN: ['platform:health', 'platform:tenants:list', 'platform:cross_tenant_read', 'platform:audit'],
};
export const ALL_PERMS = Array.from(new Set(Object.values(EXPECTED).flat())).sort();
export const RANK: Record<string, number> = { OWNER: 6, ADMIN: 5, MANAGER: 4, REVIEWER: 3, ANALYST: 2, VIEWER: 1 };
export const has = (r: Role, p: string) => EXPECTED[r].includes(p);