/**
 * Claims list query building (R26/R34/R37). Prisma query objects only: no SQL strings.
 * Prisma 7 does NOT escape LIKE wildcards inside `contains` (verified against PostgreSQL 16: `50%`
 * matched LD-5001), so `\`, `%` and `_` are escaped here to make `q` a literal substring search.
 */

/** Escape LIKE metacharacters (PostgreSQL default escape character is backslash). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (c) => `\\${c}`);
}
import type { ClaimSortField, ClaimStatus, Perspective } from '@fr/shared';

export interface ClaimFilter {
  q?: string | undefined;
  status?: readonly ClaimStatus[] | undefined;
  perspective?: Perspective | undefined;
  assigneeId?: string | undefined;
}

export interface ClaimSort {
  field: ClaimSortField;
  dir: 'asc' | 'desc';
}

const SEARCH_FIELDS = ['claimNumber', 'loadNumber', 'invoiceNumber', 'carrierName', 'shipperName'] as const;

export function buildClaimWhere(f: ClaimFilter): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  const q = f.q?.trim();
  if (q) {
    const literal = escapeLike(q);
    and.push({ OR: SEARCH_FIELDS.map((field) => ({ [field]: { contains: literal, mode: 'insensitive' } })) });
  }
  if (f.status && f.status.length > 0) and.push({ status: { in: [...f.status] } });
  if (f.perspective) and.push({ perspective: f.perspective });
  if (f.assigneeId === 'none') and.push({ assigneeId: null });
  else if (f.assigneeId) and.push({ assigneeId: f.assigneeId });
  return and.length > 0 ? { AND: and } : {};
}

/** Whitelisted sort field + stable tiebreak on id. */
export function buildClaimOrderBy(s: ClaimSort): Record<string, 'asc' | 'desc'>[] {
  return [{ [s.field]: s.dir }, { id: s.dir }];
}

export function pageArgs(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
