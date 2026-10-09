/**
 * Machine authentication with tenant API keys (Q13, A12.4). Called by the security pipeline when the
 * bearer value starts with `fr_live_` (the JWT path is then never consulted). Order:
 *   per-IP failure gate (cheap refusal of floods) -> format -> lookup by keyId (system mode) -> constant-time
 *   HMAC compare (dummy digest for unknown ids) -> revoked / expired / tenant suspended / creator disabled
 *   (401) -> route accepts keys? (403 "route") -> key carries the route's scope? (403 "scope") -> creator's
 *   CURRENT role still holds the scope's permission? (401 "creator") -> per-key rate limit -> context.
 * The tenant comes ONLY from the key row. Revocation and expiry are read from the database on every
 * request (no cache). Every denial for a real keyId appends `apikey.use_denied` to that tenant's chain;
 * every 401 counts against the client address.
 */
import { SCOPE_PERMISSION, isApiKeyScope, permissionsFor, type ApiKeyScope, type Permission } from '@fr/shared';
import type { FastifyRequest } from 'fastify';

import { appendAudit } from '../audit/audit.js';
import { verifySecret, parseKey } from '../apikeys/key-material.js';
import type { BaseClient } from '../db/client.js';
import { withSystemTx } from '../db/system.js';
import { tenantDb } from '../db/tenant.js';
import type { RequestCtx, RouteAccess } from '../http/context.js';
import { errors } from '../http/errors.js';
import type { Limiter } from '../http/security.js';

import { AUTH_USER_SELECT, type AuthUser } from './session.js';

export type DenyReason = 'bad_secret' | 'revoked' | 'expired' | 'scope' | 'route' | 'creator' | 'tenant';

const LAST_USED_INTERVAL_MS = 60_000;
const MAX_BLOCKED_ENTRIES = 10_000;

declare module 'fastify' {
  interface FastifyRequest {
    /** Set during key authentication; the per-key limiter keys on it. */
    frApiKeyId?: string;
  }
}

export interface ApiKeyAuthDeps {
  base: BaseClient;
  pepper: string;
  rateLimitEnabled: boolean;
  /** Counts one FAILED key authentication per call (per client address). */
  failLimiter: Limiter | null;
  /** Counts one request per key (keyed by `req.frApiKeyId`). */
  keyLimiter: Limiter | null;
  now: () => Date;
}

/**
 * Failure gate: failures are counted by the shared limiter store; once it reports the address over its
 * budget the address is refused here BEFORE any verification work until the window resets.
 */
export class FailureGate {
  private readonly blockedUntil = new Map<string, number>();

  check(ip: string, nowMs: number): number | null {
    const until = this.blockedUntil.get(ip);
    if (until === undefined) return null;
    if (until <= nowMs) {
      this.blockedUntil.delete(ip);
      return null;
    }
    return Math.max(1, Math.ceil((until - nowMs) / 1000));
  }

  block(ip: string, untilMs: number): void {
    if (this.blockedUntil.size >= MAX_BLOCKED_ENTRIES) {
      const first = this.blockedUntil.keys().next();
      if (!first.done) this.blockedUntil.delete(first.value);
    }
    this.blockedUntil.set(ip, untilMs);
  }
}

type KeyRow = {
  id: string;
  tenantId: string;
  keyId: string;
  secretHash: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdBy: AuthUser;
};

export class ApiKeyAuthenticator {
  private readonly gate = new FailureGate();

  constructor(private readonly deps: ApiKeyAuthDeps) {}

  private async recordFailure(req: FastifyRequest): Promise<void> {
    if (!this.deps.rateLimitEnabled || !this.deps.failLimiter) return;
    const r = await this.deps.failLimiter(req);
    // RATE_LIMIT_API_KEY_FAIL_MAX failures are allowed per window; once this failure used up the budget
    // (remaining 0) the NEXT attempt from the address is already refused, before any verification work.
    if (!r.allowed || r.remaining === 0) this.gate.block(req.ip, this.deps.now().getTime() + r.retryAfterSeconds * 1000);
  }

  private async deny(req: FastifyRequest, row: KeyRow, reason: DenyReason, status: 401 | 403): Promise<never> {
    await withSystemTx(this.deps.base, (tx) =>
      appendAudit(tx, {
        tenantId: row.tenantId,
        action: 'apikey.use_denied',
        actorId: null,
        actorRole: null,
        targetType: 'api_key',
        targetId: row.id,
        metadata: { keyId: row.keyId, reason },
        ip: req.ip,
        requestId: req.frRequestId,
      }),
    );
    if (status === 401) {
      await this.recordFailure(req);
      throw errors.unauthenticated();
    }
    throw errors.forbidden();
  }

  async authenticate(req: FastifyRequest, presented: string, access: RouteAccess | undefined): Promise<RequestCtx> {
    const now = this.deps.now();
    if (this.deps.rateLimitEnabled) {
      const retry = this.gate.check(req.ip, now.getTime());
      if (retry !== null) throw errors.rateLimited(retry);
    }
    const parsed = parseKey(presented);
    if (!parsed) {
      verifySecret(this.deps.pepper, presented, null);
      await this.recordFailure(req);
      throw errors.unauthenticated();
    }
    const row = (await withSystemTx(this.deps.base, (tx) =>
      tx.apiKey.findUnique({
        where: { keyId: parsed.keyId },
        select: { id: true, tenantId: true, keyId: true, secretHash: true, scopes: true, expiresAt: true, revokedAt: true, createdBy: { select: AUTH_USER_SELECT } },
      }),
    )) as KeyRow | null;
    const secretOk = verifySecret(this.deps.pepper, parsed.secret, row?.secretHash ?? null);
    if (!row) {
      await this.recordFailure(req);
      throw errors.unauthenticated();
    }
    if (!secretOk) return this.deny(req, row, 'bad_secret', 401);
    if (row.revokedAt) return this.deny(req, row, 'revoked', 401);
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return this.deny(req, row, 'expired', 401);
    const creator = row.createdBy;
    const membership = creator.membership;
    if (membership && membership.tenantId === row.tenantId && membership.tenant.status !== 'ACTIVE') return this.deny(req, row, 'tenant', 401);
    if (creator.status !== 'ACTIVE' || creator.platformRole !== null || !membership || membership.tenantId !== row.tenantId) {
      return this.deny(req, row, 'creator', 401);
    }

    const scope: ApiKeyScope | undefined = access?.kind === 'permission' ? access.apiKeyScope : undefined;
    if (!scope) return this.deny(req, row, 'route', 403);
    if (!row.scopes.includes(scope)) return this.deny(req, row, 'scope', 403);
    const creatorPerms = new Set<Permission>(permissionsFor(membership.role));
    if (!creatorPerms.has(SCOPE_PERMISSION[scope])) return this.deny(req, row, 'creator', 401);

    req.frApiKeyId = row.keyId;
    if (this.deps.rateLimitEnabled && this.deps.keyLimiter) {
      const r = await this.deps.keyLimiter(req);
      if (!r.allowed) throw errors.rateLimited(r.retryAfterSeconds);
    }

    // Key permissions: its scopes' permissions that the creator still holds (never more than either).
    const permissions = new Set<Permission>();
    for (const s of row.scopes) {
      if (isApiKeyScope(s) && creatorPerms.has(SCOPE_PERMISSION[s])) permissions.add(SCOPE_PERMISSION[s]);
    }
    this.touch(row.keyId, now);
    return {
      user: { id: creator.id, email: creator.email, name: creator.name, mfaEnabled: Boolean(creator.mfaSecret?.verifiedAt) },
      role: 'API_KEY',
      tenantId: row.tenantId,
      tenantName: membership.tenant.name,
      sessionId: `apikey:${row.keyId}`,
      permissions,
      db: tenantDb(this.deps.base, row.tenantId),
      requestId: req.frRequestId,
      ip: req.ip,
      viaApiKey: row.keyId,
    };
  }

  /** Best effort, at most once per 60 s per key (minute precision); never fails the request. */
  private touch(keyId: string, now: Date): void {
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    void withSystemTx(this.deps.base, (tx) =>
      tx.apiKey.updateMany({
        where: { keyId, revokedAt: null, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_INTERVAL_MS) } }] },
        data: { lastUsedAt: minute },
      }),
    ).catch(() => undefined);
  }
}
