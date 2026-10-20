/**
 * REQ-20261020-claim-outcomes: recorded claim outcomes. Human-entered, append-only rows (a correction is a
 * new row; the newest row of a claim counts). Every function takes a tenant transaction: tenant scoping is
 * enforced by the client extension and Postgres RLS underneath, so another tenant's claim id is "not found"
 * exactly like an unknown id. The state rule (kind OUTCOME needs a SEND_READY claim; AUDITED_NO_FINDING any
 * analysed claim) is checked here under the claim row lock and again by the database trigger.
 */
import { OUTCOME_LIST_MAX, type ClaimOutcomeBodyInput, type ClaimOutcomeListDto, type ClaimOutcomeViewDto, type OutcomeKind } from '@fr/shared';

import { appendAudit } from '../audit/audit.js';
import { isUuid } from '../db/errors.js';
import { lockClaimForUpdate, type TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';

import type { Actor } from './service.js';

const INCLUDE = { recordedBy: { select: { id: true, name: true } } } as const;

interface OutcomeRow {
  id: string;
  claimId: string;
  kind: string;
  channel: string;
  carrierResponse: string;
  sentAt: Date | null;
  creditedCents: number | null;
  paidCents: number | null;
  closedAt: Date | null;
  note: string;
  version: number;
  recordedAt: Date;
  recordedBy: { id: string; name: string };
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toOutcomeView(o: OutcomeRow): ClaimOutcomeViewDto {
  return {
    id: o.id,
    claimId: o.claimId,
    kind: o.kind as ClaimOutcomeViewDto['kind'],
    channel: o.channel as ClaimOutcomeViewDto['channel'],
    carrierResponse: o.carrierResponse as ClaimOutcomeViewDto['carrierResponse'],
    sentAt: iso(o.sentAt),
    creditedCents: o.creditedCents,
    paidCents: o.paidCents,
    closedAt: iso(o.closedAt),
    note: o.note,
    version: o.version,
    recordedAt: o.recordedAt.toISOString(),
    recordedBy: { id: o.recordedBy.id, name: o.recordedBy.name },
  };
}

/** Pure state rule, mirrored by the `claim_outcomes_guard` trigger. */
export function outcomeAllowed(kind: OutcomeKind, claimStatus: string): boolean {
  return kind === 'OUTCOME' ? claimStatus === 'SEND_READY' : claimStatus !== 'AWAITING_ANALYSIS';
}

async function claimOf(tx: TenantTx, idParam: string): Promise<{ id: string; status: string; tenantId: string }> {
  if (!isUuid(idParam)) throw errors.notFound();
  const c = await tx.claim.findFirst({ where: { id: idParam }, select: { id: true, status: true, tenantId: true } });
  if (!c) throw errors.notFound();
  return c;
}

/** Newest first, at most OUTCOME_LIST_MAX rows. */
export async function listOutcomes(tx: TenantTx, claimIdParam: string): Promise<ClaimOutcomeListDto> {
  const claim = await claimOf(tx, claimIdParam);
  const rows = await tx.claimOutcome.findMany({
    where: { claimId: claim.id },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    take: OUTCOME_LIST_MAX,
    include: INCLUDE,
  });
  return { claimId: claim.id, items: rows.map(toOutcomeView) };
}

/** Insert one outcome row and its audit event in the caller's transaction. */
export async function recordOutcome(tx: TenantTx, claimIdParam: string, body: ClaimOutcomeBodyInput, actor: Actor): Promise<ClaimOutcomeViewDto> {
  const found = await claimOf(tx, claimIdParam);
  if (!(await lockClaimForUpdate(tx, found.id))) throw errors.notFound();
  // Re-read under the row lock: a concurrent transition may have changed the status.
  const claim = await claimOf(tx, found.id);
  if (!outcomeAllowed(body.kind, claim.status)) throw errors.invalidState();
  const fields =
    body.kind === 'OUTCOME'
      ? {
          channel: body.channel,
          carrierResponse: body.carrierResponse,
          sentAt: body.sentAt === null ? null : new Date(body.sentAt),
          creditedCents: body.creditedCents,
          paidCents: body.paidCents,
          closedAt: body.closedAt === null ? null : new Date(body.closedAt),
          note: body.note,
        }
      : {
          channel: 'OTHER',
          carrierResponse: 'NONE_YET',
          sentAt: null,
          creditedCents: null,
          paidCents: null,
          closedAt: body.closedAt === null ? null : new Date(body.closedAt),
          note: body.note,
        };
  const row = await tx.claimOutcome.create({
    data: { tenantId: claim.tenantId, claimId: claim.id, kind: body.kind, recordedById: actor.userId, ...fields },
    include: INCLUDE,
  });
  await appendAudit(tx, {
    tenantId: claim.tenantId,
    action: 'claim.outcome_recorded',
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claim.id,
    metadata: {
      claimId: claim.id,
      outcomeId: row.id,
      kind: row.kind,
      channel: row.channel,
      carrierResponse: row.carrierResponse,
      creditedCents: row.creditedCents,
      paidCents: row.paidCents,
      sentAt: iso(row.sentAt),
      closedAt: iso(row.closedAt),
    },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  return toOutcomeView(row);
}