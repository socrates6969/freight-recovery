/**
 * C18: user-facing copy of the ocean D&D audit. Honest wording: drafts for human review, not legal advice;
 * no accuracy or recovery claims.
 */
import type { DdCheckId, DdCheckStatus } from './constants.js';

export const DD_NOTE =
  'Checks ocean demurrage and detention invoices against the content and timing rules of 46 CFR Part 541 (in force since 28 May 2024), the incentive principle of 46 CFR 545.5 and the tariff you attach. Not legal advice. Findings are drafts for human review.';

export const DD_PACKET_DISCLAIMER =
  'Automated checks of the invoice data entered, compared with 46 CFR Part 541, 46 CFR 545.5 and the attached tariff. Not legal advice. Findings are drafts for human review; have counsel review them before relying on them.';

export const DD_PRESET_NOTE =
  'Public tariff figures as published on the retrieval date. Your service contract or a newer tariff may differ; check before use.';

export const DD_TEXT = Object.freeze({
  nav: 'Ocean D&D',
  invoices: 'Invoices',
  tariffs: 'Tariffs',
  calendars: 'Calendars',
  importCsv: 'Import CSV',
  newInvoice: 'New invoice',
  newTariff: 'New tariff',
  newCalendar: 'New calendar',
  fromPreset: 'Start from a public tariff',
  save: 'Save',
  delete: 'Delete draft',
  runAudit: 'Run audit',
  auditNote: 'Creates a claim with revision 1 for review. You will be recorded as its author, so another approver must approve it.',
  audited: 'Audit complete. The claim is ready for review.',
  checks: 'Checks',
  findings: 'Findings',
  noFindings: 'No findings.',
  kindBadge: 'D&D',
  forbidden: 'You do not have permission to do this.',
  conflict: 'This item already exists or changed. Reload to continue.',
  limit: 'This organization has reached the maximum number of D&D tariffs, calendars or invoices.',
  invalid: 'The invoice values cannot be audited automatically.',
  rateLimited: 'Too many requests. Try again later.',
  failed: 'Something went wrong. Try again.',
  csvErrors: 'Rows with errors were not imported.',
  csvTooLarge: 'The file is too large to import.',
} as const);

export const DD_CHECK_LABELS: Readonly<Record<DdCheckId, string>> = Object.freeze({
  part541: 'Part 541 applies',
  content: 'Required invoice content (541.6)',
  issuance: '30-day issuance (541.7)',
  total: 'Invoice total',
  line_arithmetic: 'Line arithmetic',
  tariff: 'Tariff recomputation',
  availability: 'Cargo availability (545.5)',
  return_refused: 'Refused empty return (545.5)',
});

export const DD_CHECK_STATUS_LABELS: Readonly<Record<DdCheckStatus, string>> = Object.freeze({
  ok: 'OK',
  finding: 'Finding',
  not_evaluated: 'Not checked',
  not_applicable: 'Not applicable',
});
