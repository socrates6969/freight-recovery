/**
 * Append-only, hash-chained audit trail (A10). `appendAudit` runs inside the CALLER's transaction so the
 * business change and its audit row commit (or roll back) together; an audit failure fails the request.
 */
import { randomUUID } from 'node:crypto';

import { GENESIS_HASH, type AuditAction } from '@fr/shared';

import type { Prisma } from '../db/client.js';
import { TenantScopeError, assertUuid } from '../db/errors.js';
import { unwrapRawTx, type TenantTx } from '../db/tenant.js';

import {
  ChainVerifier,
  auditTimestamp,
  chainKeyFor,
  computeEventHash,
  sanitizeMetadata,
  type StoredChainRow,
  type VerifyResult,
} from './chain.js';

export interface AuditInput {
  tenantId: string | null;
  action: AuditAction;
  actorId?: string | null;
  actorRole?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
  now?: Date;
}

export interface AppendedEvent {
  id: string;
  seq: number;
  hash: string;
}

type RawTx = Prisma.TransactionClient;
type AnyTx = RawTx | TenantTx;

function toRaw(tx: AnyTx): RawTx {
  // A TenantTx (proxy) exposes the raw client only to this module; a system tx is already raw.
  try {
    return unwrapRawTx(tx as TenantTx);
  } catch {
    return tx as RawTx;
  }
}

async function currentContext(tx: RawTx): Promise<{ tenant: string; system: boolean }> {
  const rows = await tx.$queryRaw<{ tenant: string | null; system: string | null }[]>`
    SELECT current_setting('app.tenant_id', true) AS tenant, current_setting('app.system', true) AS system`;
  const r = rows[0];
  return { tenant: r?.tenant ?? '', system: (r?.system ?? '') === 'on' };
}

/** Append one event to its chain. Throws (and so aborts the caller's transaction) on any failure. */
export async function appendAudit(txIn: AnyTx, input: AuditInput): Promise<AppendedEvent> {
  const tx = toRaw(txIn);
  const tenantId = input.tenantId;
  if (tenantId !== null) assertUuid(tenantId, 'audit tenantId');
  const ctx = await currentContext(tx);
  if (tenantId === null) {
    if (!ctx.system) throw new TenantScopeError('platform audit chain requires system mode');
  } else if (ctx.tenant !== tenantId) {
    // Only system-mode transactions (auth/platform) may target a tenant chain other than the current one.
    if (ctx.tenant !== '' && !ctx.system) throw new TenantScopeError('audit tenant differs from transaction tenant');
    if (!ctx.system) throw new TenantScopeError('no tenant context for audit append');
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  }

  const chainKey = chainKeyFor(tenantId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chainKey}, 0))`;
  const last = await tx.$queryRaw<{ seq: bigint; hash: string }[]>`
    SELECT seq, hash FROM audit_events WHERE chain_key = ${chainKey} ORDER BY seq DESC LIMIT 1`;
  const prev = last[0];
  const seq = prev ? Number(prev.seq) + 1 : 1;
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const createdAt = auditTimestamp(input.now);
  const event = {
    chainKey,
    seq,
    id: randomUUID(),
    tenantId,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: sanitizeMetadata(input.metadata),
    ip: input.ip ?? null,
    requestId: input.requestId ?? null,
    createdAt: createdAt.toISOString(),
  };
  const hash = computeEventHash(prevHash, event);
  await tx.$executeRaw`
    INSERT INTO audit_events
      (id, chain_key, tenant_id, seq, actor_id, actor_role, action, target_type, target_id, metadata, ip, request_id, created_at, prev_hash, hash)
    VALUES
      (${event.id}::uuid, ${chainKey}, ${tenantId}::uuid, ${BigInt(seq)}, ${event.actorId}::uuid, ${event.actorRole},
       ${event.action}, ${event.targetType}, ${event.targetId}, ${JSON.stringify(event.metadata)}::jsonb, ${event.ip},
       ${event.requestId}, ${createdAt}, ${prevHash}, ${hash})`;
  return { id: event.id, seq, hash };
}

interface DbRow {
  id: string;
  chain_key: string;
  tenant_id: string | null;
  seq: bigint;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  ip: string | null;
  request_id: string | null;
  created_at: Date;
  prev_hash: string;
  hash: string;
}

function toStored(r: DbRow): StoredChainRow {
  return {
    chainKey: r.chain_key,
    seq: Number(r.seq),
    id: r.id,
    tenantId: r.tenant_id,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: (typeof r.metadata === 'object' && r.metadata !== null ? r.metadata : {}) as Record<string, unknown>,
    ip: r.ip,
    requestId: r.request_id,
    createdAt: new Date(r.created_at).toISOString(),
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

const VERIFY_BATCH = 1000;

/** Recompute a chain in seq order. Runs in the caller's (tenant or system) transaction. */
export async function verifyChain(txIn: AnyTx, tenantId: string | null): Promise<VerifyResult> {
  const tx = toRaw(txIn);
  const chainKey = chainKeyFor(tenantId);
  const verifier = new ChainVerifier();
  let after = 0n;
  for (;;) {
    const rows = await tx.$queryRaw<DbRow[]>`
      SELECT id, chain_key, tenant_id, seq, actor_id, actor_role, action, target_type, target_id, metadata, ip,
             request_id, created_at, prev_hash, hash
      FROM audit_events WHERE chain_key = ${chainKey} AND seq > ${after} ORDER BY seq ASC LIMIT ${VERIFY_BATCH}`;
    for (const r of rows) {
      if (!verifier.push(toStored(r))) return verifier.result();
    }
    if (rows.length < VERIFY_BATCH) break;
    const lastRow = rows[rows.length - 1];
    if (!lastRow) break;
    after = lastRow.seq;
  }
  return verifier.result();
}

export interface AuditEventView {
  seq: number;
  id: string;
  actor: { id: string; role: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  prevHash: string;
  hash: string;
}

/** Newest-first page of a tenant's events (R24). */
export async function listAuditEvents(
  txIn: AnyTx,
  tenantId: string,
  q: { before?: number | undefined; limit: number; action?: string | undefined },
): Promise<{ items: AuditEventView[]; nextBefore: number | null }> {
  const tx = toRaw(txIn);
  const chainKey = chainKeyFor(tenantId);
  const before = q.before !== undefined ? BigInt(q.before) : 9223372036854775807n;
  const prefix = q.action ? `${q.action.replace(/[\\%_]/gu, (c) => `\\${c}`)}%` : '%';
  const rows = await tx.$queryRaw<DbRow[]>`
    SELECT id, chain_key, tenant_id, seq, actor_id, actor_role, action, target_type, target_id, metadata, ip,
           request_id, created_at, prev_hash, hash
    FROM audit_events
    WHERE chain_key = ${chainKey} AND seq < ${before} AND action LIKE ${prefix}
    ORDER BY seq DESC LIMIT ${q.limit + 1}`;
  const page = rows.slice(0, q.limit).map(toStored);
  const items = page.map((r) => ({
    seq: r.seq,
    id: r.id,
    actor: r.actorId ? { id: r.actorId, role: r.actorRole ?? '' } : null,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    metadata: r.metadata,
    ip: r.ip,
    requestId: r.requestId,
    createdAt: r.createdAt,
    prevHash: r.prevHash,
    hash: r.hash,
  }));
  const lastItem = page[page.length - 1];
  return { items, nextBefore: rows.length > q.limit && lastItem ? lastItem.seq : null };
}
