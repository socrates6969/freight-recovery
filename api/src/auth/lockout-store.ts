/**
 * Lockout state per normalized-email hash (C5). Unknown and known emails are handled identically.
 */
import { appendAudit } from '../audit/audit.js';
import type { SystemTx } from '../db/system.js';
import { lockDurationSeconds, isLocked, retryAfterSeconds } from '../security/lockout.js';

import type { AuthDeps, RequestMeta } from './deps.js';
import { tenantIdOf, type AuthUser } from './session.js';

/** Seconds remaining if the email hash is locked right now, else null. */
export async function lockedForSeconds(tx: SystemTx, emailHashHex: string, now: Date): Promise<number | null> {
  const row = await tx.loginLockout.findUnique({ where: { emailHash: emailHashHex } });
  if (row && isLocked(row.lockedUntil, now)) return retryAfterSeconds(row.lockedUntil, now);
  return null;
}

/**
 * Record one failed credential check: increment atomically and start a lock when the threshold is
 * reached. Audits `auth.lockout` when a lock begins (tenant chain if the user is known, else platform).
 */
export async function recordFailure(
  deps: AuthDeps,
  tx: SystemTx,
  emailHashHex: string,
  user: AuthUser | null,
  meta: RequestMeta,
): Promise<{ failures: number; lockSeconds: number }> {
  const now = new Date();
  const row = await tx.loginLockout.upsert({
    where: { emailHash: emailHashHex },
    create: { emailHash: emailHashHex, failures: 1, lastFailureAt: now },
    update: { failures: { increment: 1 }, lastFailureAt: now },
  });
  const policy = {
    threshold: deps.cfg.lockoutThreshold,
    baseSeconds: deps.cfg.lockoutBaseSeconds,
    maxSeconds: deps.cfg.lockoutMaxSeconds,
  };
  const lockSeconds = lockDurationSeconds(row.failures, policy);
  if (lockSeconds > 0) {
    await tx.loginLockout.update({
      where: { emailHash: emailHashHex },
      data: { lockedUntil: new Date(now.getTime() + lockSeconds * 1000) },
    });
    await appendAudit(tx, {
      tenantId: user ? tenantIdOf(user) : null,
      action: 'auth.lockout',
      // Lockouts are triggered by unauthenticated attempts: no actor; the account is the target.
      actorId: null,
      actorRole: null,
      targetType: user ? 'user' : null,
      targetId: user?.id ?? null,
      metadata: { emailHash: emailHashHex, failures: row.failures, lockedForSeconds: lockSeconds },
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }
  return { failures: row.failures, lockSeconds };
}
