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
  // Step 3 (N10): import, review, commit and export.
  'import.batch_created',
  'import.document_received',
  'import.document_rejected',
  'import.document_parsed',
  'import.document_downloaded',
  'review.field_resolved',
  'review.field_added',
  'review.doctype_set',
  'review.document_accepted',
  'review.document_rejected',
  'import.committed',
  'claim.created_from_import',
  'claim.documents_linked',
  'export.started',
  'export.completed',
  'export.aborted',
  // Step 4 (Q10): platform dashboard reads, flag changes, recorded evaluation runs (platform chain);
  // intelligence reads and API key lifecycle (tenant chain).
  'platform.dashboard_viewed',
  'platform.logs_viewed',
  'platform.flag_changed',
  'eval.run_recorded',
  'intelligence.viewed',
  'apikey.created',
  'apikey.revoked',
  'apikey.use_denied',
  // Four-eyes (REQ-20261009-four-eyes): refused approve/reject/accept attempts.
  'authz.four_eyes_denied',
  // Step 5 (REQ-20261010-step5-analysis): claim analysis (single, and one summary per bulk request).
  'claim.analyzed',
  'claim.bulk_analyzed',
  // Step 6 (REQ-20261011-charge-intelligence): tenant charge-label changes.
  'charge_label.set',
  'charge_label.deleted',
  // Step 7 (REQ-20261011-fuel-outlook): fuel tables, claim fuel inputs (tenant chain) and price imports
  // (platform chain, actor null).
  'fsc_table.created',
  'fsc_table.updated',
  'fsc_table.archived',
  'claim.fuel_inputs_set',
  'claim.fuel_inputs_cleared',
  'price_data.imported',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const GENESIS_HASH = '0'.repeat(64);
