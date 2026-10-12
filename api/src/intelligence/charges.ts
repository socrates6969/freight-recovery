/**
 * Step 6 charge intelligence service (REQ-20261011-charge-intelligence, spec A6.1, Part C C5/C6/C9).
 *
 * - `loadClassifier`: the tenant's labels (RLS + tenant guard) -> `buildChargeClassifier` (seed + labels).
 * - `chargeLines`: the invoice lines of a claim's ACCEPTED documents (same bundle as analysis), each with
 *   its keyword class, the classifier suggestion and the tenant label of its normalized text.
 * - `setLabel` / `deleteLabel` / `listLabels`: the label memory (one label per normalized text and tenant;
 *   at most CHARGE_LABELS_MAX per tenant). Changes append `charge_label.set` / `charge_label.deleted` to the
 *   tenant chain in the same transaction; metadata never carries the description or normalized text.
 * Every read and write runs in ONE tenant transaction (`set_config('app.tenant_id')` + tenant guard).
 */
import {
  CHARGE_CLASSIFIER_VERSION,
  CHARGE_LABELS_MAX,
  SEED_VERSION,
  SUGGESTION_THRESHOLD,
  classifyLine,
  isChargeCategory,
  type ChargeCategory,
  type ChargeLabelDto,
  type ChargeLabelsListDto,
  type ChargeLabelsQueryInput,
  type ChargeLinesResponseDto,
  type SetChargeLabelInput,
  type SetChargeLabelResponseDto,
} from '@fr/shared';
import { buildChargeClassifier, normText, type ChargeClassifier } from '@fr/shared/charge-intel';

import { createHash } from 'node:crypto';

import { appendAudit } from '../audit/audit.js';
import { learnedLabelIdsOfClaim } from '../audit/label-influence.js';
import type { Actor } from '../claims/service.js';
import { lockChargeLabels } from '../db/charge-label-locks.js';
import { isUuid } from '../db/errors.js';
import type { TenantDb, TenantTx } from '../db/tenant.js';
import { errors } from '../http/errors.js';
import { loadAnalysisInput } from '../imports/bundle.js';

const LABEL_SELECT = { id: true, description: true, normalizedText: true, category: true, version: true, createdAt: true, updatedAt: true } as const;

interface LabelRow {
  id: string;
  description: string;
  normalizedText: string;
  category: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A category read from the database; anything else is refused (the CHECK makes it unreachable). */
function dbCategory(value: string): ChargeCategory {
  if (!isChargeCategory(value)) throw new Error('charge_labels.category outside the registry');
  return value;
}

function toDto(r: LabelRow): ChargeLabelDto {
  return {
    id: r.id,
    description: r.description,
    normalizedText: r.normalizedText,
    category: dbCategory(r.category),
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface LoadedClassifier {
  classifier: ChargeClassifier;
  labelCount: number;
}

/** sha256 (hex) of a normalized text: lets the audit chain identify a label key without storing it (S4). */
export function normalizedTextSha256(normalizedText: string): string {
  return createHash('sha256').update(normalizedText, 'utf8').digest('hex');
}

/** Label columns the classifier and the charge-lines view need, in classifier order. */
const CLASSIFIER_LABEL_SELECT = { id: true, description: true, category: true, normalizedText: true } as const;
const CLASSIFIER_LABEL_ORDER = [{ normalizedText: 'asc' as const }, { id: 'asc' as const }];

interface ClassifierLabelRow {
  id: string;
  description: string;
  category: string;
  normalizedText: string;
}

/** The tenant's label rows in classifier order (normalized text, then id). */
async function readClassifierLabels(tx: TenantTx): Promise<ClassifierLabelRow[]> {
  return tx.chargeLabel.findMany({ select: CLASSIFIER_LABEL_SELECT, orderBy: CLASSIFIER_LABEL_ORDER });
}

/**
 * Hardening (REQ-20261012-hardening, SC-2): build the classifier from label rows already read (rows in
 * classifier order). Pure CPU work, so a caller can run it after its transaction has committed.
 */
export function classifierFromRows(rows: readonly { id: string; description: string; category: string }[]): LoadedClassifier {
  const labels = rows.map((r) => ({ id: r.id, description: r.description, category: dbCategory(r.category) }));
  return { classifier: buildChargeClassifier(labels), labelCount: labels.length };
}

/**
 * The tenant's labels and the classifier built from them (inside the caller's tenant transaction). Build
 * it once per request and reuse it for every line / claim of that request (fix round 1, S1).
 */
export async function loadClassifier(tx: TenantTx): Promise<LoadedClassifier> {
  return classifierFromRows(await readClassifierLabels(tx));
}

/** Hardening (C3): the influence view from the recorded label ids and the label rows read in the same transaction. */
export function influenceView(
  influenceIds: readonly string[] | null,
  labels: readonly { id: string; description: string; category: string }[],
): ChargeLinesResponseDto['influence'] {
  if (influenceIds === null) return null;
  const byId = new Map(labels.map((l) => [l.id, l]));
  return {
    labels: influenceIds.map((labelId) => {
      const row = byId.get(labelId);
      return row ? { labelId, description: row.description, category: dbCategory(row.category) } : { labelId, description: null, category: null };
    }),
  };
}

/**
 * C5: charge lines of a claim (any status). 404 for unknown, non-UUID or other-tenant ids. Hardening: the
 * claim, its documents, the tenant's labels (read ONCE, used for both the suggestion and the label chip, F11)
 * and the analysis influence are read in one tenant transaction; the classifier is built and the lines are
 * classified after that transaction has committed (SC-2: no CPU work while the connection is held).
 */
export async function chargeLines(db: TenantDb, claimId: string): Promise<ChargeLinesResponseDto> {
  if (!isUuid(claimId)) throw errors.notFound();
  const read = await db.tx(async (tx) => {
    const claim = await tx.claim.findFirst({ where: { id: claimId }, select: { id: true } });
    if (!claim) throw errors.notFound();
    const input = await loadAnalysisInput(tx, claimId);
    const labels = await readClassifierLabels(tx);
    const influenceIds = await learnedLabelIdsOfClaim(tx, claim.id);
    return { invoiceLines: input.bundle.invoice?.lines ?? [], labels, influenceIds };
  });
  const { classifier } = classifierFromRows(read.labels);
  const byText = new Map(read.labels.map((l) => [l.normalizedText, { id: l.id, category: dbCategory(l.category) }]));
  const lines = read.invoiceLines.map((ln, index) => ({
    index,
    description: ln.description,
    amount: ln.amount,
    ruleCategory: classifyLine(ln.description),
    suggestion: classifier.classify(ln.description),
    label: byText.get(normText(ln.description)) ?? null,
  }));
  return {
    claimId,
    classifierVersion: CHARGE_CLASSIFIER_VERSION,
    seedVersion: SEED_VERSION,
    threshold: SUGGESTION_THRESHOLD,
    lines,
    influence: influenceView(read.influenceIds, read.labels),
  };
}

const isUniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

async function setLabelOnce(db: TenantDb, actor: Actor, body: SetChargeLabelInput): Promise<SetChargeLabelResponseDto> {
  const nt = normText(body.description);
  const ntHash = normalizedTextSha256(nt);
  return db.tx(async (tx) => {
    // Fix round 1 (S2): serialize label writers of this tenant so count + insert cannot overshoot the cap.
    await lockChargeLabels(tx, db.tenantId);
    const existing = await tx.chargeLabel.findFirst({ where: { normalizedText: nt }, select: LABEL_SELECT });
    const audit = (labelId: string, metadata: Record<string, unknown>) =>
      appendAudit(tx, {
        tenantId: db.tenantId,
        action: 'charge_label.set',
        actorId: actor.userId,
        actorRole: actor.role,
        targetType: 'charge_label',
        targetId: labelId,
        metadata,
        ip: actor.ip,
        requestId: actor.requestId,
      });
    if (!existing) {
      if ((await tx.chargeLabel.count()) >= CHARGE_LABELS_MAX) throw errors.labelLimitReached();
      const created = await tx.chargeLabel.create({
        data: { tenantId: db.tenantId, normalizedText: nt, description: body.description, category: body.category, createdById: actor.userId, updatedById: actor.userId, version: 1 },
        select: LABEL_SELECT,
      });
      await audit(created.id, { labelId: created.id, category: body.category, outcome: 'created', normalizedTextSha256: ntHash });
      return { label: toDto(created), outcome: 'created' };
    }
    if (existing.category === body.category) return { label: toDto(existing), outcome: 'unchanged' };
    const previousCategory = dbCategory(existing.category);
    const updated = await tx.chargeLabel.update({
      where: { id: existing.id },
      data: { description: body.description, category: body.category, updatedById: actor.userId, version: { increment: 1 } },
      select: LABEL_SELECT,
    });
    await audit(updated.id, { labelId: updated.id, category: body.category, previousCategory, outcome: 'changed', normalizedTextSha256: ntHash });
    return { label: toDto(updated), outcome: 'changed' };
  });
}

/**
 * PUT /charge-labels: create, change or keep the label of `normText(description)`. A concurrent create of
 * the same normalized text (unique violation) retries the whole transaction once; a second unique violation
 * is 409 conflict (hardening, SC-8; nothing was written by the failed attempt).
 */
export async function setLabel(db: TenantDb, actor: Actor, body: SetChargeLabelInput): Promise<SetChargeLabelResponseDto> {
  try {
    return await setLabelOnce(db, actor, body);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  try {
    return await setLabelOnce(db, actor, body);
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict();
    throw e;
  }
}

/** DELETE /charge-labels/:id. 404 for unknown, non-UUID or other-tenant ids. */
export async function deleteLabel(db: TenantDb, actor: Actor, id: string): Promise<void> {
  if (!isUuid(id)) throw errors.notFound();
  await db.tx(async (tx) => {
    await lockChargeLabels(tx, db.tenantId);
    const row = await tx.chargeLabel.findFirst({ where: { id }, select: { id: true, category: true, normalizedText: true } });
    if (!row) throw errors.notFound();
    await tx.chargeLabel.delete({ where: { id: row.id } });
    await appendAudit(tx, {
      tenantId: db.tenantId,
      action: 'charge_label.deleted',
      actorId: actor.userId,
      actorRole: actor.role,
      targetType: 'charge_label',
      targetId: row.id,
      metadata: { labelId: row.id, category: dbCategory(row.category), normalizedTextSha256: normalizedTextSha256(row.normalizedText) },
      ip: actor.ip,
      requestId: actor.requestId,
    });
  });
}

/** GET /charge-labels: one page ordered by normalized text, then id. */
export async function listLabels(db: TenantDb, q: ChargeLabelsQueryInput): Promise<ChargeLabelsListDto> {
  return db.tx(async (tx) => {
    const total = await tx.chargeLabel.count();
    const rows = await tx.chargeLabel.findMany({
      select: LABEL_SELECT,
      orderBy: [{ normalizedText: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { items: rows.map(toDto), page: q.page, pageSize: q.pageSize, total };
  });
}
