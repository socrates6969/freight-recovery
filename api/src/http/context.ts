/** Per-request security context (Layer 3 of tenant isolation). */
import type { ApiKeyScope, Permission, Role } from '@fr/shared';

import type { TenantDb } from '../db/tenant.js';

export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'cookie-session' }
  | { kind: 'authenticated' }
  | {
      kind: 'permission';
      permission: Permission;
      /**
       * Step 4 (Q13): the ONLY routes that accept tenant API key authentication declare the scope a key
       * must carry. Routes without it reject key authentication with 403 (architecture-tested list).
       */
      apiKeyScope?: ApiKeyScope;
    };

/** Actor role on the request context: a tenant/platform role, or API_KEY for machine requests. */
export type CtxRole = Role | 'API_KEY';

export interface RequestCtx {
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
  role: CtxRole;
  tenantId: string | null;
  tenantName: string | null;
  /** Refresh family (session) id of the access token. */
  sessionId: string;
  permissions: ReadonlySet<Permission>;
  /** Tenant-scoped database; null for platform users. */
  db: TenantDb | null;
  requestId: string;
  ip: string;
  /** Set when the request authenticated with a tenant API key: the key's public 16-hex id. */
  viaApiKey?: string;
}

/** Route groups with their own rate-limit bucket (on top of the global one). */
export type RateGroup = 'auth' | 'forgot' | 'upload' | 'export' | 'platform' | 'intelligence';

/** Groups whose bucket is per authenticated user (second stage, after authentication). */
export type UserRateGroup = 'upload' | 'export' | 'platform' | 'intelligence';

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
