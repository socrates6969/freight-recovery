/**
 * Zod schemas for the public contract (C3/C4): strict request bodies/queries and response DTOs.
 * Every object schema is strict: unknown keys are rejected.
 */
import { z } from 'zod';

import { PLATFORM_ROLES, ROLES, TENANT_ROLES } from './rbac.js';
import { hasUnsafeChars, stripUnsafeMultiline } from './text.js';

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

/** AWAITING_ANALYSIS (step 3): claim created from imported documents; no packet and zero amounts yet. */
export const CLAIM_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY', 'AWAITING_ANALYSIS'] as const;
export const PACKET_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY', 'SUPERSEDED'] as const;
export const PERSPECTIVES = ['SHIPPER', 'CARRIER'] as const;
export const APPROVAL_ACTIONS = ['EDIT', 'APPROVE', 'REJECT', 'SEND_READY'] as const;
export const DOC_TYPES = ['INVOICE', 'RATE_CONFIRMATION', 'BILL_OF_LADING', 'OTHER'] as const;
export const TIMELINE_KINDS = ['APPOINTMENT', 'ARRIVAL', 'DEPARTURE', 'INVOICE', 'RATE_CONFIRMATION', 'NOTE'] as const;
export const DIRECTIONS = ['OVERCHARGE', 'UNDERBILLED'] as const;
export const VERIFIER_STATUSES = ['NOT_RUN', 'PASSED', 'FAILED', 'NEEDS_REVIEW'] as const;
export const CLAIM_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'claimNumber',
  // loadNumber: added so the C8 'Load' sortable column header is server-sortable (contract gap, reported).
  'loadNumber',
  'carrierName',
  'status',
  'amountClaimedCents',
  'recoverableCents',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type PacketStatus = (typeof PACKET_STATUSES)[number];
export type Perspective = (typeof PERSPECTIVES)[number];
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export type ClaimSortField = (typeof CLAIM_SORT_FIELDS)[number];

export const REASON_MIN = 10;
export const REASON_MAX = 2000;
export const DEMAND_LETTER_MAX = 20000;
export const PAGE_SIZE_MAX = 100;
export const PAGE_SIZE_DEFAULT = 25;
export const SEARCH_MAX = 100;

const uuid = z.uuid();
const isoDate = z.string();

/** Single-line user text: trimmed, length-bounded, control and bidi characters rejected. */
export function singleLine(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !hasUnsafeChars(v), { message: 'unsafe characters' });
}

/** Required reason for audited actions: trimmed, 10..2000 chars, control/bidi rejected. */
export const reasonSchema = singleLine(REASON_MIN, REASON_MAX);

/** Multi-line user text: control chars (except \n) and bidi controls stripped; then length-checked. */
export function multiLine(min: number, max: number) {
  return z
    .string()
    .max(max)
    .transform((v) => stripUnsafeMultiline(v))
    .pipe(z.string().min(min).max(max));
}

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+$/u, { message: 'invalid email' })
  .refine((v) => !hasUnsafeChars(v), { message: 'unsafe characters' });

/** Passwords are length-capped here only to bound hashing work; the policy check yields weak_password. */
export const passwordInput = z.string().min(1).max(1024);
const tokenInput = z.string().min(1).max(512);
const codeInput = z.string().trim().min(1).max(32);

const intFromQuery = z.coerce.number().int();

// ---------------------------------------------------------------------------------------------
// Auth requests
// ---------------------------------------------------------------------------------------------

export const LoginBody = z.strictObject({ email: emailSchema, password: passwordInput });
export const MfaVerifyBody = z.union([
  z.strictObject({ mfaToken: tokenInput, code: codeInput }),
  z.strictObject({ mfaToken: tokenInput, recoveryCode: codeInput }),
]);
export const EnrollStartBody = z.strictObject({ enrollToken: tokenInput });
export const EnrollVerifyBody = z.strictObject({ enrollToken: tokenInput, code: codeInput });
export const EmptyBody = z.strictObject({});
export const ForgotBody = z.strictObject({ email: emailSchema });
export const ResetBody = z.strictObject({ token: tokenInput, password: passwordInput });
export const InviteInspectBody = z.strictObject({ token: tokenInput });
export const InviteAcceptBody = z.strictObject({
  token: tokenInput,
  name: singleLine(1, 100),
  password: passwordInput,
});
export const ChangePasswordBody = z.strictObject({ currentPassword: passwordInput, newPassword: passwordInput });

// ---------------------------------------------------------------------------------------------
// User management requests
// ---------------------------------------------------------------------------------------------

export const tenantRoleSchema = z.enum(TENANT_ROLES);
export const roleSchema = z.enum(ROLES);
export const platformRoleSchema = z.enum(PLATFORM_ROLES);

export const PageQuery = z.strictObject({
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export const InviteCreateBody = z.strictObject({ email: emailSchema, role: tenantRoleSchema });
export const RoleChangeBody = z.strictObject({ role: tenantRoleSchema, reason: reasonSchema });
export const ReasonBody = z.strictObject({ reason: reasonSchema });
/** Path ids are length-bounded strings; non-UUID values are answered as 404 by the handlers (same as unknown ids). */
export const IdParams = z.strictObject({ id: z.string().min(1).max(64) });
export const TenantIdParams = z.strictObject({ tenantId: z.string().min(1).max(64) });

// ---------------------------------------------------------------------------------------------
// Audit requests
// ---------------------------------------------------------------------------------------------

export const AuditEventsQuery = z.strictObject({
  before: intFromQuery.min(1).optional(),
  limit: intFromQuery.min(1).max(100).default(50),
  action: z.string().trim().min(1).max(100).regex(/^[a-z0-9_.]+$/u).optional(),
});

// ---------------------------------------------------------------------------------------------
// Claims / packets / approvals requests
// ---------------------------------------------------------------------------------------------

const commaList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(200)
    .transform((v, ctx) => {
      const parts = v.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
      const out: T[number][] = [];
      for (const p of parts) {
        if (!(values as readonly string[]).includes(p)) {
          ctx.addIssue({ code: 'custom', message: 'invalid value' });
          return z.NEVER;
        }
        if (!out.includes(p)) out.push(p);
      }
      if (out.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'empty list' });
        return z.NEVER;
      }
      return out;
    });

export const claimSortSchema = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const m = /^([A-Za-z]+):(asc|desc)$/u.exec(v);
    const field = m?.[1];
    const dir = m?.[2];
    if (!field || !dir || !(CLAIM_SORT_FIELDS as readonly string[]).includes(field)) {
      ctx.addIssue({ code: 'custom', message: 'invalid sort' });
      return z.NEVER;
    }
    return { field: field as ClaimSortField, dir: dir as 'asc' | 'desc' };
  });

export const claimFilterShape = {
  q: z
    .string()
    .trim()
    .max(SEARCH_MAX)
    .refine((v) => !hasUnsafeChars(v), { message: 'unsafe characters' })
    .optional(),
  status: commaList(CLAIM_STATUSES).optional(),
  perspective: z.enum(PERSPECTIVES).optional(),
  assigneeId: z.union([z.literal('none'), uuid]).optional(),
  sort: claimSortSchema.default({ field: 'createdAt', dir: 'desc' }),
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
};
export const ClaimsQuery = z.strictObject(claimFilterShape);
export type ClaimsQueryInput = z.output<typeof ClaimsQuery>;

export const PlatformClaimsQuery = z.strictObject({
  ...claimFilterShape,
  reason: singleLine(REASON_MIN, 500),
});

export const PacketQuery = z.strictObject({ revision: intFromQuery.min(1).optional() });
export const AssignBody = z.strictObject({ assigneeId: uuid.nullable() });
export const RevisionBody = z.strictObject({
  baseRevision: z.int().min(1),
  demandLetter: multiLine(1, DEMAND_LETTER_MAX),
  reason: reasonSchema,
});
export const ApproveBody = z.strictObject({
  packetRevision: z.int().min(1),
  reason: reasonSchema,
  acknowledgePendingFindings: z.boolean().optional(),
});
export const TransitionBody = z.strictObject({ packetRevision: z.int().min(1), reason: reasonSchema });

export const ApprovalsQuery = z.strictObject({
  status: commaList(['PENDING_REVIEW', 'APPROVED'] as const).default(['PENDING_REVIEW', 'APPROVED']),
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  sort: claimSortSchema.default({ field: 'updatedAt', dir: 'asc' }),
});

export const DevOutboxQuery = z.strictObject({ to: emailSchema.optional() });

// ---------------------------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------------------------

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
  }),
});

export const SessionUser = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  tenant: z.object({ id: uuid, name: z.string() }).nullable(),
  mfaEnabled: z.boolean(),
});
export type SessionUserDto = z.infer<typeof SessionUser>;

export const SessionOk = z.object({
  status: z.literal('ok'),
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
  user: SessionUser,
});
export const LoginResponse = z.discriminatedUnion('status', [
  SessionOk,
  z.object({ status: z.literal('mfa_required'), mfaToken: z.string(), expiresIn: z.number() }),
  z.object({ status: z.literal('mfa_enrollment_required'), enrollToken: z.string(), expiresIn: z.number() }),
]);
export type LoginResponseDto = z.infer<typeof LoginResponse>;
export const EnrollStartResponse = z.object({ secret: z.string(), otpauthUri: z.string() });
export const EnrollVerifyResponse = SessionOk.extend({ recoveryCodes: z.array(z.string()) });
export const RefreshResponse = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
  user: SessionUser,
});
export const CsrfResponse = z.object({ csrfToken: z.string() });
export const MeResponse = z.object({ user: SessionUser, permissions: z.array(z.string()) });
export type MeResponseDto = z.infer<typeof MeResponse>;
export const InviteInspectResponse = z.object({ email: z.string(), tenantName: z.string(), role: tenantRoleSchema });

export const ClaimSummary = z.object({
  id: uuid,
  claimNumber: z.string(),
  loadNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  carrierName: z.string(),
  shipperName: z.string(),
  perspective: z.enum(PERSPECTIVES),
  status: z.enum(CLAIM_STATUSES),
  amountClaimedCents: z.int(),
  recoverableCents: z.int(),
  pendingReviewCents: z.int(),
  currency: z.literal('USD'),
  assignee: z.object({ id: uuid, name: z.string() }).nullable(),
  latestPacket: z.object({ revision: z.int(), status: z.enum(PACKET_STATUSES) }).nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ClaimSummaryDto = z.infer<typeof ClaimSummary>;
export const ClaimDetail = ClaimSummary.extend({ invoiceDate: isoDate.nullable() });
export type ClaimDetailDto = z.infer<typeof ClaimDetail>;

export function paged<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), page: z.int(), pageSize: z.int(), total: z.int() });
}
export const ClaimsPage = paged(ClaimSummary);
export const ApprovalItem = ClaimSummary.extend({
  packetRevision: z.int(),
  pendingFindingsCount: z.int(),
  waitingSince: isoDate,
});
export type ApprovalItemDto = z.infer<typeof ApprovalItem>;
export const ApprovalsPage = paged(ApprovalItem);

const sourceRef = z.object({ sourceId: uuid, locator: z.string(), excerpt: z.string() });
export const Packet = z.object({
  id: uuid,
  claimId: uuid,
  revision: z.int(),
  status: z.enum(PACKET_STATUSES),
  perspective: z.enum(PERSPECTIVES),
  loadNumber: z.string().nullable(),
  generatedAt: isoDate,
  disclaimer: z.string(),
  demandLetter: z.string(),
  currency: z.literal('USD'),
  recoverableCents: z.int(),
  pendingReviewCents: z.int(),
  timeline: z.array(
    z.object({
      id: uuid,
      occurredAt: isoDate,
      kind: z.enum(TIMELINE_KINDS),
      label: z.string(),
      sourceId: uuid.nullable(),
    }),
  ),
  sources: z.array(
    z.object({ id: uuid, filename: z.string(), docType: z.enum(DOC_TYPES), sha256: z.string(), sizeBytes: z.int() }),
  ),
  findings: z.array(
    z.object({
      id: uuid,
      ruleId: z.string(),
      title: z.string(),
      direction: z.enum(DIRECTIONS),
      amountCents: z.int(),
      explanation: z.string(),
      calculation: z.array(z.string()),
      confidence: z.number(),
      needsHumanReview: z.boolean(),
      citations: z.array(sourceRef),
      governingClause: z
        .object({ sourceId: uuid, label: z.string(), excerpt: z.string(), locator: z.string() })
        .nullable(),
    }),
  ),
  verifier: z.object({
    status: z.enum(VERIFIER_STATUSES),
    checkedAt: isoDate.nullable(),
    note: z.string().nullable(),
  }),
  integrity: z.object({ contentHash: z.string(), recomputedHash: z.string(), valid: z.boolean() }),
  approvals: z.array(
    z.object({
      id: uuid,
      action: z.enum(APPROVAL_ACTIONS),
      reason: z.string(),
      packetRevision: z.int(),
      fromStatus: z.string(),
      toStatus: z.string(),
      actor: z.object({ id: uuid, name: z.string(), role: z.string() }),
      createdAt: isoDate,
    }),
  ),
  createdAt: isoDate,
  createdBy: z.object({ id: uuid, name: z.string() }).nullable(),
});
export type PacketDto = z.infer<typeof Packet>;

export const TransitionResponse = z.object({
  claim: z.object({ id: uuid, status: z.enum(CLAIM_STATUSES) }),
  packet: z.object({ id: uuid, revision: z.int(), status: z.enum(PACKET_STATUSES), contentHash: z.string().optional() }),
  delivery: z.object({ sent: z.literal(false), mode: z.literal('send_ready_only') }).optional(),
});

export const UserListItem = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  role: tenantRoleSchema,
  status: z.enum(['ACTIVE', 'DISABLED']),
  mfaEnabled: z.boolean(),
  lastLoginAt: isoDate.nullable(),
  createdAt: isoDate,
});
export const UsersPage = paged(UserListItem);

export const AuditEventDto = z.object({
  seq: z.number(),
  id: uuid,
  actor: z.object({ id: uuid, role: z.string() }).nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDate,
  prevHash: z.string(),
  hash: z.string(),
});
export const AuditEventsPage = z.object({ items: z.array(AuditEventDto), nextBefore: z.number().nullable() });
export const AuditVerifyResponse = z.object({
  valid: z.boolean(),
  eventsChecked: z.number(),
  brokenAtSeq: z.number().nullable(),
});
