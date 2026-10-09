/**
 * Pure hash-chain logic (A10), shared by append and verify and unit-tested with fixed vectors:
 *   hash_n = sha256_hex(prevHash + "\n" + canonicalJson(event_n)),  genesis prevHash = 64 zeros.
 */
import { createHash } from 'node:crypto';

import { GENESIS_HASH, canonicalJson } from '@fr/shared';

export interface ChainEvent {
  chainKey: string;
  seq: number;
  id: string;
  tenantId: string | null;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  /** ISO-8601 with milliseconds, UTC. */
  createdAt: string;
}

export function chainKeyFor(tenantId: string | null): string {
  return tenantId ? `t:${tenantId}` : 'platform';
}

export function computeEventHash(prevHash: string, e: ChainEvent): string {
  const body = canonicalJson({
    chainKey: e.chainKey,
    seq: e.seq,
    id: e.id,
    tenantId: e.tenantId,
    actorId: e.actorId,
    actorRole: e.actorRole,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    metadata: e.metadata,
    ip: e.ip,
    requestId: e.requestId,
    createdAt: e.createdAt,
  });
  return createHash('sha256').update(`${prevHash}\n${body}`, 'utf8').digest('hex');
}

export interface StoredChainRow extends ChainEvent {
  prevHash: string;
  hash: string;
}

export interface VerifyResult {
  valid: boolean;
  eventsChecked: number;
  brokenAtSeq: number | null;
}

/**
 * Incremental verifier: feed rows in ascending seq order. Detects edited rows (hash mismatch), deleted or
 * reordered rows (seq gap / prevHash mismatch) and a modified last row.
 */
export class ChainVerifier {
  private expectedSeq = 1;
  private prevHash = GENESIS_HASH;
  private checked = 0;
  private broken: number | null = null;

  push(row: StoredChainRow): boolean {
    if (this.broken !== null) return false;
    this.checked += 1;
    if (row.seq !== this.expectedSeq || row.prevHash !== this.prevHash || computeEventHash(row.prevHash, row) !== row.hash) {
      this.broken = row.seq;
      return false;
    }
    this.prevHash = row.hash;
    this.expectedSeq += 1;
    return true;
  }

  result(): VerifyResult {
    return { valid: this.broken === null, eventsChecked: this.checked, brokenAtSeq: this.broken };
  }
}

/** Metadata keys allowed in audit events (whitelist; values are sanitized below). */
const METADATA_KEYS = new Set([
  'reason',
  'fromRole',
  'toRole',
  'role',
  'fromStatus',
  'toStatus',
  'status',
  'emailHash',
  'claimId',
  'claimNumber',
  'packetId',
  'revision',
  'packetRevision',
  'baseRevision',
  'contentHash',
  'route',
  'method',
  'permission',
  'targetTenantId',
  'eventsChecked',
  'valid',
  'brokenAtSeq',
  'assigneeId',
  'previousAssigneeId',
  'inviteId',
  'userId',
  'familyId',
  'method2fa',
  'lockedForSeconds',
  'failures',
  'acknowledgedPendingFindings',
  'sessionsRevoked',
  'filters',
  // Step 3 (N10): ids, sizes, hash prefixes and fixed codes only - never file names, extracted
  // values or document text.
  'batchId',
  'documentId',
  'fieldId',
  'fieldKey',
  'groupIndex',
  'reasonCode',
  'sizeBytes',
  'sha256Prefix',
  'detectedType',
  'docType',
  'docTypeBasis',
  'fieldCount',
  'flaggedCount',
  'reviewReasons',
  'action',
  'confirmedCount',
  'perspective',
  'created',
  'updated',
  'skipped',
  'documentIds',
  'hasPacket',
  'entity',
  'format',
  'rowCount',
  'rowsWritten',
  'plannedRowCount',
  'byteLength',
  'sha256',
  'durationMs',
  // Step 4 (Q3, Q7, Q13): dashboard sections/filters, flag changes, eval runs, intelligence reads and
  // API key lifecycle. Never names, document strings or key material (keyId is the public identifier).
  'section',
  'window',
  'level',
  'limit',
  'returned',
  'key',
  'from',
  'to',
  'version',
  'kind',
  'runId',
  'evalSetId',
  'k',
  'cases',
  'passHatKCount',
  'keyId',
  'scopes',
  'expiresAt',
  'viaApiKey',
]);
const MAX_STRING = 2000;

function sanitizeValue(v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v;
  if (Array.isArray(v) && depth < 2) return v.slice(0, 50).map((x) => sanitizeValue(x, depth + 1));
  if (typeof v === 'object' && depth < 2) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,40}$/u.test(k)) out[k] = sanitizeValue(x, depth + 1);
    }
    return out;
  }
  return null;
}

/** Keep only whitelisted keys; email hashes are truncated to a 12-char prefix. */
export function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (!METADATA_KEYS.has(k) || v === undefined) continue;
    out[k] = k === 'emailHash' && typeof v === 'string' ? v.slice(0, 12) : sanitizeValue(v, 0);
  }
  return out;
}

/** Application clock truncated to milliseconds (what is stored and hashed). */
export function auditTimestamp(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime()));
}
