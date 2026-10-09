/**
 * Tenant API keys (Q13): scopes, key format and strict schemas for R80-R82. A key carries at most the
 * three least-privilege scopes below; each maps to exactly one tenant permission that is re-checked
 * against the key creator's CURRENT role on every use.
 */
import { z } from 'zod';

import { singleLine } from './dto.js';
import type { Permission } from './rbac.js';

export const API_KEY_SCOPES = ['claims.read', 'exports.claims', 'imports.write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const SCOPE_PERMISSION: Readonly<Record<ApiKeyScope, Permission>> = Object.freeze({
  'claims.read': 'claims:read',
  'exports.claims': 'export:claims',
  'imports.write': 'import:run',
});

/** `fr_live_<16 lowercase hex>_<43 base64url>` (total length 68). */
export const API_KEY_FORMAT_RE = /^fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/u;
export const API_KEY_PREFIX = 'fr_live_';
export const API_KEY_NAME_MAX = 80;
export const API_KEY_REASON_MIN = 10;
export const API_KEY_REASON_MAX = 500;
export const API_KEY_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];

export function isApiKeyScope(v: unknown): v is ApiKeyScope {
  return typeof v === 'string' && (API_KEY_SCOPES as readonly string[]).includes(v);
}

export const CreateApiKeyBody = z.strictObject({
  name: singleLine(1, API_KEY_NAME_MAX),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .max(API_KEY_SCOPES.length)
    .refine((s) => new Set(s).size === s.length, { message: 'duplicate scope' }),
  expiresInDays: z.int().min(1).max(365).nullable().optional(),
});
export type CreateApiKeyInput = z.output<typeof CreateApiKeyBody>;

export const RevokeApiKeyBody = z.strictObject({ reason: singleLine(API_KEY_REASON_MIN, API_KEY_REASON_MAX) });

const actorRef = z.strictObject({ id: z.string(), name: z.string() });

export const ApiKeyView = z.strictObject({
  id: z.string(),
  keyId: z.string().regex(/^fr_live_[0-9a-f]{16}$/u),
  name: z.string(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  createdBy: actorRef,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedBy: actorRef.nullable(),
  revokeReason: z.string().nullable(),
  status: z.enum(API_KEY_STATUSES),
});
export type ApiKeyViewDto = z.infer<typeof ApiKeyView>;

export const ApiKeyCreated = z.strictObject({ key: ApiKeyView, secret: z.string().regex(API_KEY_FORMAT_RE) });
export type ApiKeyCreatedDto = z.infer<typeof ApiKeyCreated>;
export const ApiKeyList = z.strictObject({ items: z.array(ApiKeyView) });
