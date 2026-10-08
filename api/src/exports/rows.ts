/**
 * Export row sources (A10.2): the same `where` builders as the claims list (R26), keyset pagination in
 * batches of 500 with a stable (sortKey, id) cursor, each batch in its OWN short tenant transaction (no
 * transaction is held open while the client reads). Exports contain no user email, name or id.
 */
import type { ClaimSortField } from '@fr/shared';
import { CLAIM_STATUSES } from '@fr/shared';

import { buildClaimOrderBy, buildClaimWhere, type ClaimFilter, type ClaimSort } from '../claims/query.js';
import type { TenantDb } from '../db/tenant.js';
import { errors } from '../http/errors.js';

import { formatCents } from './neutralize.js';
import type { Cell, Column } from './writers.js';

export const BATCH_SIZE = 500;
const PACKET_CLAIM_BATCH = 100;

type Dir = 'asc' | 'desc';
type Where = Record<string, unknown>;

const NULLABLE_SORT: ReadonlySet<ClaimSortField> = new Set(['loadNumber']);
const ENUM_SORT: ReadonlySet<ClaimSortField> = new Set(['status']);

/**
 * Keyset condition "strictly after (value, id)" for an ORDER BY field dir, id dir. PostgreSQL places
 * NULLs last ascending and first descending; enums compare by declaration order (Prisma enum filters
 * have no gt/lt, so the later/earlier values are listed explicitly).
 */
export function keysetAfter(field: ClaimSortField, dir: Dir, value: unknown, id: string): Where {
  const nullable = NULLABLE_SORT.has(field);
  const idCmp = dir === 'asc' ? { gt: id } : { lt: id };
  if (value === null) {
    if (!nullable) throw new Error('null cursor on a non-null sort field');
    return dir === 'asc' ? { [field]: null, id: idCmp } : { OR: [{ [field]: null, id: idCmp }, { [field]: { not: null } }] };
  }
  let beyond: Where;
  if (ENUM_SORT.has(field)) {
    const order = CLAIM_STATUSES as readonly string[];
    const i = order.indexOf(String(value));
    beyond = { [field]: { in: dir === 'asc' ? order.slice(i + 1) : order.slice(0, i) } };
  } else {
    beyond = { [field]: dir === 'asc' ? { gt: value } : { lt: value } };
  }
  const or: Where[] = [beyond, { [field]: value, id: idCmp }];
  if (nullable && dir === 'asc') or.push({ [field]: null });
  return { OR: or };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const s = (v: string | null | undefined): Cell => ({ t: 's', v: v ?? null });
const money = (cents: number): Cell => ({ t: 'n', v: formatCents(cents), money: true });
const int = (n: number | null | undefined): Cell => ({ t: 'n', v: n === null || n === undefined ? null : String(n) });

// ---------------------------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------------------------

export const CLAIM_COLUMNS: Column[] = [
  { header: 'Claim Number', width: 16 },
  { header: 'Load Number', width: 16 },
  { header: 'Invoice Number', width: 16 },
  { header: 'Invoice Date', width: 24 },
  { header: 'Carrier', width: 24 },
  { header: 'Shipper', width: 24 },
  { header: 'Perspective', width: 12 },
  { header: 'Status', width: 18 },
  { header: 'Amount Claimed (USD)', width: 18 },
  { header: 'Recoverable (USD)', width: 18 },
  { header: 'Pending Review (USD)', width: 18 },
  { header: 'Currency', width: 9 },
  { header: 'Latest Packet Revision', width: 12 },
  { header: 'Packet Status', width: 16 },
  { header: 'Created At', width: 24 },
  { header: 'Updated At', width: 24 },
];

export interface ClaimExportQuery {
  filter: ClaimFilter;
  sort: ClaimSort;
}

export async function countClaims(db: TenantDb, q: ClaimExportQuery): Promise<number> {
  return db.tx((tx) => tx.claim.count({ where: buildClaimWhere(q.filter) }));
}

export async function* claimRows(db: TenantDb, q: ClaimExportQuery): AsyncGenerator<Cell[][]> {
  const base = buildClaimWhere(q.filter);
  let cursor: { value: unknown; id: string } | null = null;
  for (;;) {
    const after: { value: unknown; id: string } | null = cursor;
    const where: Where = after ? { AND: [base, keysetAfter(q.sort.field, q.sort.dir, after.value, after.id)] } : base;
    const rows = await db.tx((tx) =>
      tx.claim.findMany({
        where,
        orderBy: buildClaimOrderBy(q.sort),
        take: BATCH_SIZE,
        include: { packets: { where: { status: { not: 'SUPERSEDED' } }, select: { revision: true, status: true }, take: 1 } },
      }),
    );
    if (rows.length === 0) return;
    yield rows.map((c) => {
      const p = c.packets[0];
      return [
        s(c.claimNumber),
        s(c.loadNumber),
        s(c.invoiceNumber),
        s(iso(c.invoiceDate)),
        s(c.carrierName),
        s(c.shipperName),
        s(c.perspective),
        s(c.status),
        money(c.amountClaimedCents),
        money(c.recoverableCents),
        money(c.pendingReviewCents),
        s('USD'),
        int(p?.revision),
        s(p?.status ?? null),
        s(iso(c.createdAt)),
        s(iso(c.updatedAt)),
      ];
    });
    const last = rows[rows.length - 1];
    if (!last || rows.length < BATCH_SIZE) return;
    cursor = { value: (last as unknown as Record<string, unknown>)[q.sort.field] ?? null, id: last.id };
  }
}

// ---------------------------------------------------------------------------------------------
// Packets (one row per finding of the latest non-superseded packet; claim creation, finding ordinal)
// ---------------------------------------------------------------------------------------------

export const PACKET_COLUMNS: Column[] = [
  { header: 'Claim Number', width: 16 },
  { header: 'Load Number', width: 16 },
  { header: 'Packet Revision', width: 10 },
  { header: 'Packet Status', width: 16 },
  { header: 'Content Hash', width: 66 },
  { header: 'Verifier Status', width: 14 },
  { header: 'Rule ID', width: 16 },
  { header: 'Finding', width: 32 },
  { header: 'Direction', width: 14 },
  { header: 'Amount (USD)', width: 14 },
  { header: 'Confidence', width: 10 },
  { header: 'Needs Human Review', width: 10 },
  { header: 'Explanation', width: 60 },
  { header: 'Clause', width: 32 },
  { header: 'Citations', width: 48 },
];

export interface PacketExportQuery {
  claimId?: string | undefined;
  filter: ClaimFilter;
}

function packetClaimWhere(q: PacketExportQuery): Where {
  const live = { packets: { some: { status: { not: 'SUPERSEDED' } } } };
  return q.claimId ? { id: q.claimId, ...live } : { AND: [buildClaimWhere(q.filter), live] };
}

export async function countPacketRows(db: TenantDb, q: PacketExportQuery): Promise<number> {
  return db.tx(async (tx) => {
    if (q.claimId) {
      const claim = await tx.claim.findFirst({ where: { id: q.claimId }, select: { id: true } });
      if (!claim) throw errors.notFound();
    }
    return tx.packetFinding.count({ where: { packet: { status: { not: 'SUPERSEDED' }, claim: packetClaimWhere(q) } } });
  });
}

function citations(raw: unknown, sources: Map<string, string>): string {
  if (!Array.isArray(raw)) return '';
  return raw
    .flatMap((c) => {
      const r = c as Record<string, unknown> | null;
      if (!r || typeof r['sourceId'] !== 'string') return [];
      return [`${sources.get(r['sourceId']) ?? ''}:${String(r['locator'] ?? '')}`];
    })
    .join('; ');
}

export async function* packetRows(db: TenantDb, q: PacketExportQuery): AsyncGenerator<Cell[][]> {
  const base = packetClaimWhere(q);
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const after: { createdAt: Date; id: string } | null = cursor;
    const where: Where = after
      ? { AND: [base, { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }] }
      : base;
    const claims = await db.tx((tx) =>
      tx.claim.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: PACKET_CLAIM_BATCH,
        select: {
          id: true,
          createdAt: true,
          claimNumber: true,
          loadNumber: true,
          packets: {
            where: { status: { not: 'SUPERSEDED' } },
            take: 1,
            select: {
              revision: true,
              status: true,
              contentHash: true,
              verifierStatus: true,
              sources: { select: { id: true, filename: true } },
              findings: { orderBy: { ordinal: 'asc' } },
            },
          },
        },
      }),
    );
    if (claims.length === 0) return;
    const rows: Cell[][] = [];
    for (const c of claims) {
      const p = c.packets[0];
      if (!p) continue;
      const sources = new Map(p.sources.map((x) => [x.id, x.filename]));
      for (const f of p.findings) {
        rows.push([
          s(c.claimNumber),
          s(c.loadNumber),
          int(p.revision),
          s(p.status),
          s(p.contentHash),
          s(p.verifierStatus),
          s(f.ruleId),
          s(f.title),
          s(f.direction),
          money(f.amountCents),
          { t: 'n', v: f.confidence.toString() },
          s(f.needsHumanReview ? 'true' : 'false'),
          s(f.explanation),
          s(f.clauseLabel),
          s(citations(f.citations, sources)),
        ]);
      }
    }
    yield rows;
    const last = claims[claims.length - 1];
    if (!last || claims.length < PACKET_CLAIM_BATCH) return;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

// ---------------------------------------------------------------------------------------------
// Outcomes (one row per approval record, oldest first)
// ---------------------------------------------------------------------------------------------

export const OUTCOME_COLUMNS: Column[] = [
  { header: 'Claim Number', width: 16 },
  { header: 'Packet Revision', width: 10 },
  { header: 'Action', width: 12 },
  { header: 'From Status', width: 16 },
  { header: 'To Status', width: 16 },
  { header: 'Reason', width: 60 },
  { header: 'Actor Role', width: 12 },
  { header: 'Content Hash', width: 66 },
  { header: 'Decided At', width: 24 },
];

export interface OutcomeExportQuery {
  claimId?: string | undefined;
  actions?: readonly string[] | undefined;
  /** Inclusive ISO days (UTC). */
  from?: string | undefined;
  to?: string | undefined;
}

function outcomeWhere(q: OutcomeExportQuery): Where {
  const and: Where[] = [];
  if (q.claimId) and.push({ claimId: q.claimId });
  if (q.actions && q.actions.length > 0) and.push({ action: { in: [...q.actions] } });
  if (q.from) and.push({ createdAt: { gte: new Date(`${q.from}T00:00:00.000Z`) } });
  if (q.to) and.push({ createdAt: { lt: new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000) } });
  return and.length > 0 ? { AND: and } : {};
}

export async function countOutcomes(db: TenantDb, q: OutcomeExportQuery): Promise<number> {
  return db.tx(async (tx) => {
    if (q.claimId) {
      const claim = await tx.claim.findFirst({ where: { id: q.claimId }, select: { id: true } });
      if (!claim) throw errors.notFound();
    }
    return tx.approval.count({ where: outcomeWhere(q) });
  });
}

export async function* outcomeRows(db: TenantDb, q: OutcomeExportQuery): AsyncGenerator<Cell[][]> {
  const base = outcomeWhere(q);
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const after: { createdAt: Date; id: string } | null = cursor;
    const where: Where = after
      ? { AND: [base, { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }] }
      : base;
    const rows = await db.tx((tx) =>
      tx.approval.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        select: {
          id: true,
          createdAt: true,
          packetRevision: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          actorRole: true,
          contentHash: true,
          claim: { select: { claimNumber: true } },
        },
      }),
    );
    if (rows.length === 0) return;
    yield rows.map((a) => [
      s(a.claim.claimNumber),
      int(a.packetRevision),
      s(a.action),
      s(a.fromStatus),
      s(a.toStatus),
      s(a.reason),
      s(a.actorRole),
      s(a.contentHash),
      s(iso(a.createdAt)),
    ]);
    const last = rows[rows.length - 1];
    if (!last || rows.length < BATCH_SIZE) return;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}
