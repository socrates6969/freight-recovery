/**
 * Authentication flows (A7): login with lockout, TOTP MFA verify + enrollment, password reset, change
 * password, invite inspect/accept. Every state change and its audit event commit in one transaction.
 * Slow argon2 work happens outside database transactions.
 */
import { roleRequiresMfa, type SessionUserDto, type TenantRole } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { withSystemTx } from '../db/system.js';
import { errors } from '../http/errors.js';
import { emailHash, hmacSha256Hex, normalizeEmail, openAesGcm, randomOpaqueToken, sealAesGcm } from '../security/crypto.js';
import { checkPasswordPolicy } from '../security/password-policy.js';
import {
  generateRecoveryCodes,
  generateTotpSecretBase32,
  isRecoveryCodeShape,
  matchTotpStep,
  normalizeRecoveryCode,
  totpUri,
} from '../security/totp.js';

import type { AuthDeps, RequestMeta } from './deps.js';
import { MailDeliveryError, deliverMail } from './mailer.js';
import { lockedForSeconds, recordFailure } from './lockout-store.js';
import {
  AUTH_USER_SELECT,
  createSessionTx,
  isUsable,
  mintAccessToken,
  revokeUserSessionsTx,
  roleOf,
  tenantIdOf,
  toSessionUser,
  type AuthUser,
} from './session.js';

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUserDto;
}

export type LoginResult =
  | ({ status: 'ok' } & SessionResult)
  | { status: 'mfa_required'; mfaToken: string; expiresIn: number }
  | { status: 'mfa_enrollment_required'; enrollToken: string; expiresIn: number };

const FORGOT_MIN_DURATION_MS = 150;

function opaqueHash(deps: AuthDeps, token: string): string {
  return hmacSha256Hex(deps.cfg.refreshPepper, token);
}

async function finishSession(deps: AuthDeps, user: AuthUser, refreshToken: string, familyId: string): Promise<SessionResult> {
  return {
    accessToken: await mintAccessToken(deps, user.id, familyId),
    refreshToken,
    expiresIn: deps.cfg.accessTokenTtlSeconds,
    user: toSessionUser(user),
  };
}

// ---------------------------------------------------------------------------------------------
// Login (R4)
// ---------------------------------------------------------------------------------------------

export async function login(deps: AuthDeps, emailInput: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const email = normalizeEmail(emailInput);
  const eh = emailHash(deps.cfg.refreshPepper, email);
  const now = new Date();

  const pre = await withSystemTx(deps.base, async (tx) => {
    const locked = await lockedForSeconds(tx, eh, now);
    if (locked !== null) {
      await tx.loginAttempt.create({ data: { emailHash: eh, ip: meta.ip, outcome: 'LOCKED' } });
      return { locked };
    }
    const user = (await tx.user.findUnique({ where: { email }, select: AUTH_USER_SELECT })) as AuthUser | null;
    return { locked: null, user };
  });
  if (pre.locked !== null) throw errors.accountLocked(pre.locked);

  const user = pre.user ?? null;
  const usable = user !== null && isUsable(user);
  const passwordOk = usable ? await deps.hasher.verify(user.passwordHash, password) : await deps.hasher.verifyDummy(password);

  if (!passwordOk || !user || !usable) {
    const outcome = !user ? 'UNKNOWN_USER' : !usable ? 'DISABLED' : 'BAD_PASSWORD';
    await withSystemTx(deps.base, async (tx) => {
      await tx.loginAttempt.create({ data: { emailHash: eh, ip: meta.ip, outcome } });
      await appendAudit(tx, {
        tenantId: user ? tenantIdOf(user) : null,
        action: 'auth.login.failure',
        // The caller is unauthenticated: no actor. The known account is the target (its tenant chain).
        actorId: null,
        actorRole: null,
        targetType: user ? 'user' : null,
        targetId: user?.id ?? null,
        metadata: { emailHash: eh },
        ip: meta.ip,
        requestId: meta.requestId,
      });
      await recordFailure(deps, tx, eh, user, meta);
    });
    deps.log.info({ emailHash: eh.slice(0, 12), outcome }, 'login failed');
    throw errors.invalidCredentials();
  }

  // Opportunistic rehash when argon2 parameters changed.
  if (deps.hasher.needsRehash(user.passwordHash)) {
    const newHash = await deps.hasher.hash(password);
    await withSystemTx(deps.base, (tx) => tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }));
  }

  const role = roleOf(user);
  if (!role) throw errors.invalidCredentials();
  if (user.mfaSecret?.verifiedAt) {
    return {
      status: 'mfa_required',
      mfaToken: await deps.jwt.sign('mfa', user.id, deps.cfg.mfaTokenTtlSeconds),
      expiresIn: deps.cfg.mfaTokenTtlSeconds,
    };
  }
  if (roleRequiresMfa(role)) {
    return {
      status: 'mfa_enrollment_required',
      enrollToken: await deps.jwt.sign('mfa_enroll', user.id, deps.cfg.mfaTokenTtlSeconds),
      expiresIn: deps.cfg.mfaTokenTtlSeconds,
    };
  }
  const session = await withSystemTx(deps.base, (tx) => createSessionTx(deps, tx, user, meta, { method2fa: 'none' }));
  return { status: 'ok', ...(await finishSession(deps, user, session.refreshToken, session.familyId)) };
}

// ---------------------------------------------------------------------------------------------
// MFA verify (R5)
// ---------------------------------------------------------------------------------------------

async function loadTokenUser(deps: AuthDeps, purpose: 'mfa' | 'mfa_enroll', token: string): Promise<AuthUser> {
  const v = await deps.jwt.verify(purpose, token);
  if (!v) throw errors.invalidToken401();
  const user = (await withSystemTx(deps.base, (tx) =>
    tx.user.findUnique({ where: { id: v.sub }, select: AUTH_USER_SELECT }),
  )) as AuthUser | null;
  if (!user || !isUsable(user)) throw errors.invalidToken401();
  return user;
}

function decryptSecret(deps: AuthDeps, userId: string, s: { ciphertext: Uint8Array; nonce: Uint8Array }): string {
  return openAesGcm(deps.cfg.mfaEncKey, { ciphertext: Buffer.from(s.ciphertext), nonce: Buffer.from(s.nonce) }, userId).toString('utf8');
}

async function failMfa(deps: AuthDeps, user: AuthUser, eh: string, meta: RequestMeta): Promise<never> {
  await withSystemTx(deps.base, async (tx) => {
    await tx.loginAttempt.create({ data: { emailHash: eh, ip: meta.ip, outcome: 'BAD_MFA' } });
    await appendAudit(tx, {
      tenantId: tenantIdOf(user),
      action: 'auth.mfa.failure',
      actorId: user.id,
      actorRole: roleOf(user),
      targetType: 'user',
      targetId: user.id,
      metadata: { emailHash: eh },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    await recordFailure(deps, tx, eh, user, meta);
  });
  throw errors.invalidCode();
}

export async function mfaVerify(
  deps: AuthDeps,
  input: { mfaToken: string; code?: string | undefined; recoveryCode?: string | undefined },
  meta: RequestMeta,
): Promise<SessionResult> {
  const user = await loadTokenUser(deps, 'mfa', input.mfaToken);
  const eh = emailHash(deps.cfg.refreshPepper, user.email);
  const now = new Date();
  const locked = await withSystemTx(deps.base, (tx) => lockedForSeconds(tx, eh, now));
  if (locked !== null) throw errors.accountLocked(locked);

  const secret = await withSystemTx(deps.base, (tx) => tx.mfaSecret.findUnique({ where: { userId: user.id } }));
  if (!secret?.verifiedAt) throw errors.invalidToken401();

  if (input.code !== undefined) {
    const step = matchTotpStep(decryptSecret(deps, user.id, secret), input.code, now.getTime());
    if (step === null) return failMfa(deps, user, eh, meta);
    const session = await withSystemTx(deps.base, async (tx) => {
      const consumed = await tx.mfaSecret.updateMany({
        where: { userId: user.id, verifiedAt: { not: null }, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] },
        data: { lastUsedStep: BigInt(step) },
      });
      if (consumed.count !== 1) return null; // replayed or older step
      return createSessionTx(deps, tx, user, meta, { method2fa: 'totp' });
    });
    if (!session) return failMfa(deps, user, eh, meta);
    return finishSession(deps, user, session.refreshToken, session.familyId);
  }

  const recovery = input.recoveryCode ?? '';
  if (!isRecoveryCodeShape(recovery)) return failMfa(deps, user, eh, meta);
  const normalized = normalizeRecoveryCode(recovery);
  const codes = await withSystemTx(deps.base, (tx) =>
    tx.mfaRecoveryCode.findMany({ where: { userId: user.id, usedAt: null }, select: { id: true, codeHash: true } }),
  );
  let matchedId: string | null = null;
  for (const c of codes) {
    if (await deps.hasher.verify(c.codeHash, normalized)) {
      matchedId = c.id;
      break;
    }
  }
  if (!matchedId) return failMfa(deps, user, eh, meta);
  const id = matchedId;
  const session = await withSystemTx(deps.base, async (tx) => {
    const used = await tx.mfaRecoveryCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return null;
    await appendAudit(tx, {
      tenantId: tenantIdOf(user),
      action: 'auth.mfa.recovery_used',
      actorId: user.id,
      actorRole: roleOf(user),
      targetType: 'user',
      targetId: user.id,
      metadata: {},
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return createSessionTx(deps, tx, user, meta, { method2fa: 'recovery_code' });
  });
  if (!session) return failMfa(deps, user, eh, meta);
  return finishSession(deps, user, session.refreshToken, session.familyId);
}

// ---------------------------------------------------------------------------------------------
// MFA enrollment (R6, R7)
// ---------------------------------------------------------------------------------------------

export async function enrollStart(deps: AuthDeps, enrollToken: string): Promise<{ secret: string; otpauthUri: string }> {
  const user = await loadTokenUser(deps, 'mfa_enroll', enrollToken);
  const secret = generateTotpSecretBase32();
  const box = sealAesGcm(deps.cfg.mfaEncKey, Buffer.from(secret, 'utf8'), user.id);
  const ok = await withSystemTx(deps.base, async (tx) => {
    const existing = await tx.mfaSecret.findUnique({ where: { userId: user.id } });
    if (existing?.verifiedAt) return false;
    await tx.mfaSecret.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ciphertext: new Uint8Array(box.ciphertext), nonce: new Uint8Array(box.nonce), keyId: deps.cfg.mfaKeyId },
      update: { ciphertext: new Uint8Array(box.ciphertext), nonce: new Uint8Array(box.nonce), keyId: deps.cfg.mfaKeyId, lastUsedStep: null, createdAt: new Date() },
    });
    return true;
  });
  if (!ok) throw errors.invalidToken401();
  return { secret, otpauthUri: totpUri(secret, deps.cfg.totpIssuer, user.email) };
}

export async function enrollVerify(
  deps: AuthDeps,
  input: { enrollToken: string; code: string },
  meta: RequestMeta,
): Promise<SessionResult & { recoveryCodes: string[] }> {
  const user = await loadTokenUser(deps, 'mfa_enroll', input.enrollToken);
  const eh = emailHash(deps.cfg.refreshPepper, user.email);
  const now = new Date();
  const locked = await withSystemTx(deps.base, (tx) => lockedForSeconds(tx, eh, now));
  if (locked !== null) throw errors.accountLocked(locked);
  const secret = await withSystemTx(deps.base, (tx) => tx.mfaSecret.findUnique({ where: { userId: user.id } }));
  if (!secret || secret.verifiedAt) throw errors.invalidToken401();
  const step = matchTotpStep(decryptSecret(deps, user.id, secret), input.code, now.getTime());
  if (step === null) return failMfa(deps, user, eh, meta);

  const recoveryCodes = generateRecoveryCodes();
  const hashes = await Promise.all(recoveryCodes.map((c) => deps.hasher.hash(c)));
  const session = await withSystemTx(deps.base, async (tx) => {
    const verified = await tx.mfaSecret.updateMany({
      where: { userId: user.id, verifiedAt: null },
      data: { verifiedAt: now, lastUsedStep: BigInt(step) },
    });
    if (verified.count !== 1) return null;
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) });
    await appendAudit(tx, {
      tenantId: tenantIdOf(user),
      action: 'auth.mfa.enrolled',
      actorId: user.id,
      actorRole: roleOf(user),
      targetType: 'user',
      targetId: user.id,
      metadata: {},
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return createSessionTx(deps, tx, user, meta, { method2fa: 'totp_enrollment' });
  });
  if (!session) throw errors.invalidToken401();
  const enrolledUser: AuthUser = { ...user, mfaSecret: { verifiedAt: now } };
  return { ...(await finishSession(deps, enrolledUser, session.refreshToken, session.familyId)), recoveryCodes };
}

// ---------------------------------------------------------------------------------------------
// Password reset (R10, R11) and change (R14)
// ---------------------------------------------------------------------------------------------

export async function forgotPassword(deps: AuthDeps, emailInput: string, meta: RequestMeta): Promise<void> {
  const started = Date.now();
  const email = normalizeEmail(emailInput);
  const eh = emailHash(deps.cfg.refreshPepper, email);
  let target: AuthUser | null = null;
  try {
    await withSystemTx(deps.base, async (tx) => {
      const user = (await tx.user.findUnique({ where: { email }, select: AUTH_USER_SELECT })) as AuthUser | null;
      target = user;
      if (!user || !isUsable(user)) {
        await appendAudit(tx, {
          tenantId: user ? tenantIdOf(user) : null,
          action: 'auth.password.reset_requested',
          actorId: null,
          actorRole: null,
          metadata: { emailHash: eh, status: 'ignored' },
          ip: meta.ip,
          requestId: meta.requestId,
        });
        return;
      }
      const now = new Date();
      await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
      const token = randomOpaqueToken();
      await tx.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: opaqueHash(deps, token),
          expiresAt: new Date(now.getTime() + deps.cfg.resetTokenTtlSeconds * 1000),
        },
      });
      // A delivery failure throws MailDeliveryError here, rolling back the reset token.
      await deliverMail(deps.mailer, tx, { kind: 'PASSWORD_RESET', to: user.email, token, tenantId: tenantIdOf(user) });
      await appendAudit(tx, {
        tenantId: tenantIdOf(user),
        action: 'auth.password.reset_requested',
        actorId: user.id,
        actorRole: roleOf(user),
        targetType: 'user',
        targetId: user.id,
        metadata: { emailHash: eh },
        ip: meta.ip,
        requestId: meta.requestId,
      });
    });
  } catch (e) {
    if (!(e instanceof MailDeliveryError)) throw e;
    // Never surface delivery failures to the caller (the response must not reveal that the account
    // exists): log server-side, audit in the account's tenant chain, answer like every other case.
    const user = target as AuthUser | null;
    deps.log.error({ emailHash: eh.slice(0, 12), event: 'mail_delivery_failed', kind: 'password_reset' }, 'reset email could not be delivered');
    await withSystemTx(deps.base, (tx) =>
      appendAudit(tx, {
        tenantId: user ? tenantIdOf(user) : null,
        action: 'auth.password.reset_requested',
        actorId: null,
        actorRole: null,
        targetType: user ? 'user' : null,
        targetId: user?.id ?? null,
        metadata: { emailHash: eh, status: 'delivery_failed' },
        ip: meta.ip,
        requestId: meta.requestId,
      }),
    );
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed < FORGOT_MIN_DURATION_MS) await new Promise((r) => setTimeout(r, FORGOT_MIN_DURATION_MS - elapsed));
  }
}

export async function resetPassword(deps: AuthDeps, token: string, password: string, meta: RequestMeta): Promise<void> {
  const hash = opaqueHash(deps, token);
  const now = new Date();
  const found = await withSystemTx(deps.base, (tx) =>
    tx.passwordReset.findUnique({ where: { tokenHash: hash }, include: { user: { select: AUTH_USER_SELECT } } }),
  );
  if (!found || found.usedAt !== null || found.expiresAt <= now || !isUsable(found.user as AuthUser)) {
    throw errors.invalidToken400();
  }
  const user = found.user as AuthUser;
  if (!checkPasswordPolicy(password, user.email).ok) throw errors.weakPassword();
  const newHash = await deps.hasher.hash(password);
  const ok = await withSystemTx(deps.base, async (tx) => {
    const used = await tx.passwordReset.updateMany({
      where: { id: found.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) return false;
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash, passwordChangedAt: new Date() } });
    const revoked = await revokeUserSessionsTx(tx, user.id, 'password_reset');
    await tx.loginLockout.deleteMany({ where: { emailHash: emailHash(deps.cfg.refreshPepper, user.email) } });
    await appendAudit(tx, {
      tenantId: tenantIdOf(user),
      action: 'auth.password.reset_completed',
      actorId: user.id,
      actorRole: roleOf(user),
      targetType: 'user',
      targetId: user.id,
      metadata: { sessionsRevoked: revoked },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return true;
  });
  if (!ok) throw errors.invalidToken400();
}

export async function changePassword(
  deps: AuthDeps,
  actor: { userId: string; sessionId: string },
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const user = (await withSystemTx(deps.base, (tx) =>
    tx.user.findUnique({ where: { id: actor.userId }, select: AUTH_USER_SELECT }),
  )) as AuthUser | null;
  if (!user || !isUsable(user)) throw errors.unauthenticated();
  if (!(await deps.hasher.verify(user.passwordHash, currentPassword))) throw errors.invalidCredentials();
  if (!checkPasswordPolicy(newPassword, user.email).ok) throw errors.weakPassword();
  const newHash = await deps.hasher.hash(newPassword);
  await withSystemTx(deps.base, async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash, passwordChangedAt: new Date() } });
    const revoked = await revokeUserSessionsTx(tx, user.id, 'password_changed', actor.sessionId);
    await appendAudit(tx, {
      tenantId: tenantIdOf(user),
      action: 'auth.password.changed',
      actorId: user.id,
      actorRole: roleOf(user),
      targetType: 'user',
      targetId: user.id,
      metadata: { sessionsRevoked: revoked },
      ip: meta.ip,
      requestId: meta.requestId,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Invites: inspect (R12) and accept (R13)
// ---------------------------------------------------------------------------------------------

export async function inspectInvite(deps: AuthDeps, token: string): Promise<{ email: string; tenantName: string; role: TenantRole }> {
  const hash = opaqueHash(deps, token);
  const invite = await withSystemTx(deps.base, (tx) =>
    tx.invite.findUnique({ where: { tokenHash: hash }, include: { tenant: { select: { name: true, status: true } } } }),
  );
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date() || invite.tenant.status !== 'ACTIVE') {
    throw errors.invalidToken400();
  }
  return { email: invite.email, tenantName: invite.tenant.name, role: invite.role };
}

export async function acceptInvite(
  deps: AuthDeps,
  input: { token: string; name: string; password: string },
  meta: RequestMeta,
): Promise<void> {
  const hash = opaqueHash(deps, input.token);
  const invite = await withSystemTx(deps.base, (tx) =>
    tx.invite.findUnique({ where: { tokenHash: hash }, include: { tenant: { select: { status: true } } } }),
  );
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date() || invite.tenant.status !== 'ACTIVE') {
    throw errors.invalidToken400();
  }
  if (!checkPasswordPolicy(input.password, invite.email).ok) throw errors.weakPassword();
  const passwordHash = await deps.hasher.hash(input.password);
  const outcome = await withSystemTx(deps.base, async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    if (existing) return 'conflict' as const;
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) return 'invalid' as const;
    const user = await tx.user.create({ data: { email: invite.email, name: input.name, passwordHash } });
    await tx.membership.create({ data: { tenantId: invite.tenantId, userId: user.id, role: invite.role } });
    await appendAudit(tx, {
      tenantId: invite.tenantId,
      action: 'invite.accepted',
      actorId: user.id,
      actorRole: invite.role,
      targetType: 'invite',
      targetId: invite.id,
      metadata: { inviteId: invite.id, userId: user.id, role: invite.role },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return 'ok' as const;
  });
  if (outcome === 'conflict') throw errors.conflict();
  if (outcome === 'invalid') throw errors.invalidToken400();
}
