/**
 * Role-based access control: the single source of truth for roles and the permission matrix.
 * The API enforces it server-side; the web imports the same data only to hide controls (UX).
 */

export const TENANT_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as const;
export const PLATFORM_ROLES = ['PLATFORM_DEV', 'SUPER_ADMIN'] as const;
export const ROLES = [...TENANT_ROLES, ...PLATFORM_ROLES] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type Role = (typeof ROLES)[number];

/** Rank of tenant roles (higher = more privileged). Platform roles have no tenant rank. */
export const ROLE_RANK: Readonly<Record<TenantRole, number>> = Object.freeze({
  OWNER: 6,
  ADMIN: 5,
  MANAGER: 4,
  REVIEWER: 3,
  ANALYST: 2,
  VIEWER: 1,
});

export const PERMISSIONS = [
  'claims:read',
  'claims:assign',
  'packets:edit',
  'packets:approve',
  'demands:send',
  'users:read',
  'users:manage',
  'admins:manage',
  'audit:read',
  'settings:manage',
  'integrations:manage',
  'billing:manage',
  'tenant:delete',
  'import:run',
  'platform:health',
  'platform:flags',
  'platform:logs',
  'platform:tenants:list',
  'platform:cross_tenant_read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The permission matrix (C2). Plain data; frozen so it cannot be mutated at runtime. */
export const PERMISSION_MATRIX: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  OWNER: Object.freeze([
    'claims:read',
    'claims:assign',
    'packets:edit',
    'packets:approve',
    'demands:send',
    'users:read',
    'users:manage',
    'admins:manage',
    'audit:read',
    'settings:manage',
    'integrations:manage',
    'billing:manage',
    'tenant:delete',
    'import:run',
  ] as const),
  ADMIN: Object.freeze([
    'claims:read',
    'claims:assign',
    'packets:edit',
    'packets:approve',
    'demands:send',
    'users:read',
    'users:manage',
    'audit:read',
    'settings:manage',
    'integrations:manage',
    'import:run',
  ] as const),
  MANAGER: Object.freeze([
    'claims:read',
    'claims:assign',
    'packets:edit',
    'packets:approve',
    'demands:send',
    'import:run',
  ] as const),
  REVIEWER: Object.freeze(['claims:read', 'packets:edit', 'packets:approve', 'import:run'] as const),
  ANALYST: Object.freeze(['claims:read', 'import:run'] as const),
  VIEWER: Object.freeze(['claims:read'] as const),
  PLATFORM_DEV: Object.freeze(['platform:health', 'platform:flags', 'platform:logs'] as const),
  SUPER_ADMIN: Object.freeze([
    'platform:health',
    'platform:tenants:list',
    'platform:cross_tenant_read',
  ] as const),
});

/** Roles whose accounts must have TOTP MFA enrolled before a session is issued. */
export const MFA_REQUIRED_ROLES: readonly Role[] = Object.freeze(['OWNER', 'ADMIN', 'PLATFORM_DEV', 'SUPER_ADMIN'] as const);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && (TENANT_ROLES as readonly string[]).includes(value);
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return PERMISSION_MATRIX[role];
}

export function can(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[role].includes(permission);
}

export function roleRequiresMfa(role: Role): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/**
 * Role-management rule (C2): an actor may assign/invite only tenant roles strictly below its own rank,
 * never OWNER, and ADMIN only when it holds `admins:manage`. Platform actors cannot assign tenant roles.
 */
export function canAssignRole(
  actorRole: Role,
  targetRole: Role,
  actorPermissions: ReadonlySet<Permission> | readonly Permission[] = PERMISSION_MATRIX[actorRole],
): boolean {
  if (!isTenantRole(actorRole) || !isTenantRole(targetRole)) return false;
  if (targetRole === 'OWNER') return false;
  const perms = actorPermissions instanceof Set ? actorPermissions : new Set(actorPermissions);
  if (!perms.has('users:manage')) return false;
  if (ROLE_RANK[targetRole] >= ROLE_RANK[actorRole]) return false;
  if (targetRole === 'ADMIN' && !perms.has('admins:manage')) return false;
  return true;
}

/**
 * Whether an actor may manage (change role / disable / enable / reset MFA of) a user currently holding
 * `subjectRole`. The subject must rank strictly below the actor; an ADMIN subject also needs `admins:manage`.
 */
export function canManageUserWithRole(
  actorRole: Role,
  subjectRole: Role,
  actorPermissions: ReadonlySet<Permission> | readonly Permission[] = PERMISSION_MATRIX[actorRole],
): boolean {
  if (!isTenantRole(actorRole) || !isTenantRole(subjectRole)) return false;
  const perms = actorPermissions instanceof Set ? actorPermissions : new Set(actorPermissions);
  if (!perms.has('users:manage')) return false;
  if (subjectRole === 'OWNER') return actorRole === 'OWNER';
  if (subjectRole === 'ADMIN' && !perms.has('admins:manage')) return false;
  return ROLE_RANK[subjectRole] < ROLE_RANK[actorRole];
}
