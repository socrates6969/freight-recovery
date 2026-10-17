/** Per-request security context (Layer 3 of tenant isolation). */
import type { Permission, Role } from '@fr/shared';

import type { TenantDb } from '../db/tenant.js';

export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'cookie-session' }
  | { kind: 'authenticated' }
  | { kind: 'permission'; permission: Permission };

export interface RequestCtx {
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
  role: Role;
  tenantId: string | null;
  tenantName: string | null;
  /** Refresh family (session) id of the access token. */
  sessionId: string;
  permissions: ReadonlySet<Permission>;
  /** Tenant-scoped database; null for platform users. */
  db: TenantDb | null;
  requestId: string;
  ip: string;
}

/** Route groups with their own rate-limit bucket (on top of the global one). */
export type RateGroup = 'auth' | 'forgot' | 'upload' | 'export';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestCtx | null;
    frRequestId: string;
  }
  interface FastifyContextConfig {
    access?: RouteAccess;
    rateGroup?: RateGroup;
  }
}
