/**
 * System-mode database access: the ONLY way to read global tables (users, refresh tokens, MFA, lockouts,
 * resets, mail outbox) and the bootstrap tenant tables (memberships, invites) before a tenant is known.
 * Sets the transaction-local `app.system = 'on'` (RLS policies of memberships/invites and the platform
 * audit chain honor it). Importable only from api/src/{auth,platform,audit,db}/** and api/scripts/**
 * (enforced by ESLint no-restricted-imports and api/test/architecture.test.ts).
 */
import type { BaseClient, Prisma } from './client.js';
import { assertUuid } from './errors.js';

export type SystemTx = Prisma.TransactionClient;

export interface SystemTxOptions {
  timeoutMs?: number;
}

export async function withSystemTx<T>(base: BaseClient, fn: (tx: SystemTx) => Promise<T>, opts: SystemTxOptions = {}): Promise<T> {
  return base.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.system', 'on', true)`;
      return fn(tx);
    },
    { timeout: opts.timeoutMs ?? 10000, maxWait: 5000 },
  );
}

/**
 * Within a system transaction, also scope the transaction to one tenant (e.g. to write that tenant's
 * audit chain or read its memberships during login). Transaction-local.
 */
export async function scopeSystemTxToTenant(tx: SystemTx, tenantId: string): Promise<void> {
  assertUuid(tenantId, 'tenantId');
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

/** Per-tenant counts for SUPER_ADMIN (no tenant content). Must run inside a system transaction. */
export async function platformTenantStats(tx: SystemTx): Promise<Map<string, { userCount: number; claimCount: number }>> {
  const rows = await tx.$queryRaw<{ tenant_id: string; user_count: bigint; claim_count: bigint }[]>`
    SELECT tenant_id, user_count, claim_count FROM fr_platform_tenant_stats()`;
  return new Map(rows.map((r) => [r.tenant_id, { userCount: Number(r.user_count), claimCount: Number(r.claim_count) }]));
}

/** Simple liveness probe for /readyz and /platform/health (no tenant data). */
export async function pingDb(base: BaseClient): Promise<boolean> {
  try {
    await base.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** One aggregate row of fr_platform_pipeline_stats (no tenant, user or file identifiers exist in it). */
export interface PipelineStatRow {
  metric: string;
  label: string;
  n: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

/** Step 4 R60: cross-tenant pipeline aggregates. Must run inside a system transaction. */
export async function platformPipelineStats(tx: SystemTx, windowSeconds: number, staleSeconds: number): Promise<PipelineStatRow[]> {
  const rows = await tx.$queryRaw<{ metric: string; label: string; n: bigint; p50_ms: number | null; p95_ms: number | null }[]>`
    SELECT metric, label, n, p50_ms, p95_ms FROM fr_platform_pipeline_stats(${windowSeconds}::int, ${staleSeconds}::int)`;
  return rows.map((r) => ({ metric: r.metric, label: r.label, n: Number(r.n), p50Ms: r.p50_ms, p95Ms: r.p95_ms }));
}

/** Step 4 R64: row-lock one feature flag inside a system transaction (null when the row is missing). */
export async function lockFeatureFlag(tx: SystemTx, key: string): Promise<{ key: string; enabled: boolean; version: number } | null> {
  const rows = await tx.$queryRaw<{ key: string; enabled: boolean; version: number }[]>`
    SELECT key, enabled, version FROM feature_flags WHERE key = ${key} FOR UPDATE`;
  return rows[0] ?? null;
}
