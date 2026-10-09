/**
 * Layer 2 of tenant isolation: a fail-closed Prisma client extension.
 *
 * - Every operation runs inside an interactive transaction that first sets the transaction-local
 *   `app.tenant_id` (Layer 1: Postgres RLS keys on it).
 * - Only models in TENANT_MODELS are reachable (Tenant itself read-only, by its own id). Any other model,
 *   including models added later, throws TenantScopeError until it is classified here.
 * - `tenantId` is injected into every where clause and every create payload; a caller-supplied
 *   different tenantId throws.
 * - Raw SQL methods are not available on the tenant client.
 *
 * (Prisma removed `$use` middleware; the "Prisma middleware" in the brief is this client extension.)
 */
import { Prisma, type BaseClient } from './client.js';
import { TenantScopeError, assertUuid } from './errors.js';

/** Tenant-scoped models (all carry tenant_id + RLS). `Tenant` is handled separately (read-only). */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Membership',
  'Invite',
  'Claim',
  'EvidencePacket',
  'PacketSource',
  'PacketTimelineEvent',
  'PacketFinding',
  'Approval',
  // Step 3: imports and document -> claim links.
  'ImportBatch',
  'ImportDocument',
  'ExtractedField',
  'ImportReviewDecision',
  'ClaimDocument',
  // Step 4: tenant API keys.
  'ApiKey',
]);

const TENANT_READ_OPS: ReadonlySet<string> = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow']);

const WHERE_OPS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPS: ReadonlySet<string> = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_DATA_OPS: ReadonlySet<string> = new Set(['update', 'updateMany', 'updateManyAndReturn']);

type Args = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scopeWhere(where: unknown, tenantId: string): Record<string, unknown> {
  const w = isRecord(where) ? { ...where } : {};
  if ('tenantId' in w && w['tenantId'] !== tenantId) throw new TenantScopeError('where.tenantId differs from scope');
  w['tenantId'] = tenantId;
  return w;
}

function scopeCreateData(data: unknown, tenantId: string): Record<string, unknown> {
  if (!isRecord(data)) throw new TenantScopeError('create data must be an object');
  if ('tenant' in data) throw new TenantScopeError('relation-style tenant writes are not allowed');
  if ('tenantId' in data && data['tenantId'] !== tenantId) throw new TenantScopeError('data.tenantId differs from scope');
  return { ...data, tenantId };
}

function assertNoTenantChange(data: unknown, tenantId: string): void {
  if (!isRecord(data)) return;
  if ('tenant' in data) throw new TenantScopeError('relation-style tenant writes are not allowed');
  if ('tenantId' in data && data['tenantId'] !== tenantId) throw new TenantScopeError('tenantId cannot be changed');
}

/**
 * Pure function: returns the operation args with the tenant scope applied, or throws TenantScopeError.
 * Exported for unit tests.
 */
export function scopeArgs(model: string | undefined, operation: string, args: unknown, tenantId: string): Args {
  assertUuid(tenantId, 'tenantId');
  if (!model) throw new TenantScopeError('raw operations are not available on the tenant client');
  const a: Args = isRecord(args) ? { ...args } : {};

  if (model === 'Tenant') {
    if (!TENANT_READ_OPS.has(operation)) throw new TenantScopeError(`Tenant.${operation} is not allowed`);
    const where = isRecord(a['where']) ? a['where'] : {};
    if ('id' in where && where['id'] !== tenantId) {
      // Asking for another tenant: force an impossible match rather than leak.
      a['where'] = { ...where, AND: [{ id: tenantId }] };
    } else {
      a['where'] = { ...where, id: tenantId };
    }
    return a;
  }

  if (!TENANT_MODELS.has(model)) throw new TenantScopeError(`model ${model} is not tenant-scoped`);

  if (CREATE_OPS.has(operation)) {
    const data = a['data'];
    a['data'] = Array.isArray(data) ? data.map((d) => scopeCreateData(d, tenantId)) : scopeCreateData(data, tenantId);
    return a;
  }

  if (!WHERE_OPS.has(operation)) throw new TenantScopeError(`operation ${operation} is not allowed`);
  a['where'] = scopeWhere(a['where'], tenantId);
  if (UPDATE_DATA_OPS.has(operation)) assertNoTenantChange(a['data'], tenantId);
  if (operation === 'upsert') {
    a['create'] = scopeCreateData(a['create'], tenantId);
    assertNoTenantChange(a['update'], tenantId);
  }
  return a;
}

function tenantGuard(tenantId: string) {
  return Prisma.defineExtension({
    name: 'tenant-guard',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args, tenantId) as typeof args);
        },
      },
    },
  });
}

/** The tenant-scoped transaction client handed to handlers: tenant models only, no raw SQL. */
export type TenantTx = Pick<
  Prisma.TransactionClient,
  | 'tenant'
  | 'membership'
  | 'invite'
  | 'claim'
  | 'evidencePacket'
  | 'packetSource'
  | 'packetTimelineEvent'
  | 'packetFinding'
  | 'approval'
  | 'importBatch'
  | 'importDocument'
  | 'extractedField'
  | 'importReviewDecision'
  | 'claimDocument'
  | 'apiKey'
>;

const RAW = Symbol('fr.rawTx');
const BLOCKED = new Set([
  '$queryRaw',
  '$executeRaw',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
  '$queryRawTyped',
  '$transaction',
  '$extends',
  '$connect',
  '$disconnect',
  '$on',
  '$use',
]);

function blockRaw(tx: Prisma.TransactionClient): TenantTx {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === RAW) return target;
      if (typeof prop === 'string' && BLOCKED.has(prop)) {
        return () => {
          throw new TenantScopeError(`${prop} is not available on the tenant client`);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as unknown as TenantTx;
}

/**
 * Internal: unwrap the raw transaction client (same transaction, tenant setting applied). Only for the
 * audit module, which needs advisory locks and raw SQL inside the caller's transaction.
 */
export function unwrapRawTx(tx: TenantTx): Prisma.TransactionClient {
  const raw = (tx as unknown as Record<symbol, unknown>)[RAW];
  if (!raw) throw new TenantScopeError('not a tenant transaction');
  return raw as Prisma.TransactionClient;
}

/**
 * Row-lock a claim (SELECT ... FOR UPDATE) inside a tenant transaction so concurrent review transitions
 * serialize. RLS applies: another tenant's claim id yields false (treated as not found).
 */
export async function lockClaimForUpdate(tx: TenantTx, claimId: string): Promise<boolean> {
  assertUuid(claimId, 'claimId');
  const raw = unwrapRawTx(tx);
  const rows = await raw.$queryRaw<{ id: string }[]>`SELECT id FROM claims WHERE id = ${claimId}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export interface TxOptions {
  timeoutMs?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Run `fn` in ONE transaction with `app.tenant_id` applied (transaction-local) and the tenant guard on
 * every model operation. Business mutations and their audit event commit or roll back together.
 */
export async function withTenantTx<T>(
  base: BaseClient,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  assertUuid(tenantId, 'tenantId');
  const scoped = base.$extends(tenantGuard(tenantId));
  return scoped.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(blockRaw(tx as unknown as Prisma.TransactionClient));
    },
    {
      timeout: opts.timeoutMs ?? 10000,
      maxWait: 5000,
      ...(opts.isolationLevel ? { isolationLevel: opts.isolationLevel } : {}),
    },
  );
}

/** Per-request tenant database handle (request.ctx.db). */
export interface TenantDb {
  readonly tenantId: string;
  /** Run several operations atomically in one tenant transaction. */
  tx<T>(fn: (tx: TenantTx) => Promise<T>, opts?: TxOptions): Promise<T>;
}

export function tenantDb(base: BaseClient, tenantId: string): TenantDb {
  assertUuid(tenantId, 'tenantId');
  return Object.freeze({
    tenantId,
    tx: <T>(fn: (tx: TenantTx) => Promise<T>, opts?: TxOptions) => withTenantTx(base, tenantId, fn, opts),
  });
}
