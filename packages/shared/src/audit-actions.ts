/** Audit action names (A10). Seeded history uses the same names (no seed.* actions). */
export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.lockout',
  'auth.logout',
  'auth.refresh_reuse_detected',
  'auth.password.reset_requested',
  'auth.password.reset_completed',
  'auth.password.changed',
  'auth.mfa.enrolled',
  'auth.mfa.failure',
  'auth.mfa.recovery_used',
  'invite.created',
  'invite.revoked',
  'invite.accepted',
  'user.role_changed',
  'user.disabled',
  'user.enabled',
  'user.mfa_reset',
  'claim.assigned',
  'packet.viewed',
  'packet.revision_created',
  'approval.approved',
  'approval.rejected',
  'approval.send_ready',
  'audit.verify',
  'platform.cross_tenant_read',
  'authz.denied',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const GENESIS_HASH = '0'.repeat(64);
