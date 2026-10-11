/**
 * Step 5 claim analysis (REQ-20261010-step5-analysis): AWAITING_ANALYSIS -> PENDING_REVIEW.
 *
 * route -> lock claim row -> re-check state -> loadAnalysisInput (linked ACCEPTED documents with field
 * provenance) -> [step 6, flag on: loadClassifier (tenant labels + seed)] -> [step 7, flag on: claim fuel
 * inputs + current fuel table + active diesel import] -> buildEvidenceFuel (rules engine, learned layer, fuel
 * check, draft letter; identical to step 6 without fuel inputs and to step 5 without a classifier) -> buildAnalysisPacket
 * (rows, citations, governing clauses, timeline, content hash) -> inserts -> claim update -> audit, all in
 * the caller's ONE tenant transaction. Findings are rule outputs on extracted fields; they are drafts that
 * need human review (the packet starts PENDING_REVIEW and the four-eyes rules apply unchanged).
 */
import { randomUUID } from 'node:crypto';

import {
  AnalysisInputError,
  CHARGE_CLASSIFIER_VERSION,
  DEFAULT_ANALYSIS_SETTINGS,
  LocalDateTime,
  PACKET_DISCLAIMER,
  RULES_VERSION,
  SEED_VERSION,
  plain,
  type AnalyzeResponseDto,
  type BulkAnalyzeResponseDto,
  type EvidenceDoc,
  type FindingTrace,
  type FuelCheckStatus,
  type ImportDocType,
} from '@fr/shared';
import type { ChargeClassifier } from '@fr/shared/charge-intel';
import { buildEvidenceFuel, type FuelCheckInput, type PriceSeriesData } from '@fr/shared/fuel';

import { appendAudit } from '../audit/audit.js';
import { isUuid } from '../db/errors.js';
import { lockClaimForUpdate, type TenantDb, type TenantTx } from '../db/tenant.js';
import { isAnalysisDbError } from '../http/db-guard.js';
import { HttpError, errors } from '../http/errors.js';
import { pointerToLocator, loadAnalysisInput, type AnalysisSource, type BundleProvenance, type FieldRef } from '../imports/bundle.js';
import { parseInvoiceDate } from '../imports/commit-service.js';
import { loadClassifier, type LoadedClassifier } from '../intelligence/charges.js';
import { loadFuelInput } from '../intelligence/fuel.js';

import { packetContentHash, type HashCitation, type HashPacket } from './content-hash.js';
import type { Actor } from './service.js';

/** Largest value of the int4 cents columns. */
export const INT4_MAX = 2_147_483_647;
/** Excerpt cap of citations and clauses (`plain(excerpt, 200)`). */
const EXCERPT_LIMIT = 200;
/** Cap of untrusted text in timeline labels. */
const LABEL_TEXT_LIMIT = 100;
/** Bulk scan cap (policy D9): at most min(4 * limit, SCAN_CAP) candidates. */
const SCAN_FACTOR = 4;
const SCAN_CAP = 100;

type Perspective = 'SHIPPER' | 'CARRIER';
type AnalysisInput = Awaited<ReturnType<typeof loadAnalysisInput>>;
type Slot = keyof BundleProvenance;

const EVIDENCE_DOC_TYPE: Readonly<Record<ImportDocType, EvidenceDoc['doc_type']>> = {
  INVOICE: 'invoice',
  RATE_CONFIRMATION: 'rate_confirmation',
  BILL_OF_LADING: 'bol',
  OTHER: 'unknown',
};

type TimelineKind = 'APPOINTMENT' | 'ARRIVAL' | 'DEPARTURE' | 'INVOICE';

export interface AnalysisSourceRow {
  id: string;
  ordinal: number;
  filename: string;
  docType: ImportDocType;
  sha256: string;
  sizeBytes: number;
}

export interface AnalysisTimelineRow {
  ordinal: number;
  occurredAt: Date;
  kind: TimelineKind;
  label: string;
  sourceId: string;
}

export interface AnalysisFindingRow {
  ordinal: number;
  ruleId: string;
  title: string;
  direction: 'OVERCHARGE' | 'UNDERBILLED';
  amountCents: number;
  explanation: string;
  calculation: string[];
  confidence: number;
  needsHumanReview: boolean;
  citations: HashCitation[];
  clauseSourceId: string | null;
  clauseLabel: string | null;
  clauseExcerpt: string | null;
  clauseLocator: string | null;
}

export interface AnalysisPacketBuild {
  packet: {
    id: string;
    revision: 1;
    status: 'PENDING_REVIEW';
    perspective: Perspective;
    loadNumber: string | null;
    generatedAt: Date;
    disclaimer: string;
    demandLetter: string;
    currency: 'USD';
    recoverableCents: number;
    pendingReviewCents: number;
    verifierStatus: 'NOT_RUN';
    contentHash: string;
    createdById: string;
  };
  sources: AnalysisSourceRow[];
  timeline: AnalysisTimelineRow[];
  findings: AnalysisFindingRow[];
  hashPacket: HashPacket;
  summary: {
    findingsCount: number;
    pendingFindingsCount: number;
    ignoredFindingsCount: number;
    recoverableCents: number;
    pendingReviewCents: number;
    /** Step 6: stored LRN findings and stored step-5 findings switched to review (C4.4). */
    learnedFindingsCount: number;
    reviewFlagsCount: number;
    /** Fix round 1 (S3): tenant label ids that were the nearest example of a learned effect (<= 50). */
    learnedLabelIds: string[];
    /** Step 7 (F10, F13): stored FSC findings (0 or 1), the fuel-check status and its provenance. */
    fuelFindingsCount: number;
    fuelCheckStatus: Exclude<FuelCheckStatus, 'off'>;
    fscTableId: string | null;
    fscTableVersion: number | null;
    priceImportId: string | null;
    priceDate: string | null;
  };
}

/**
 * Cents of an engine amount (`-?digits.dd`, Python `quantize(0.01)` output) that must be storable:
 * >= 0 and <= INT4_MAX (policy D6 / RD3), else AnalysisInputError.
 */
export function storableCents(amount: string): number {
  if (!/^-?[0-9]+\.[0-9]{2}$/u.test(amount)) throw new AnalysisInputError('amount is not a cents decimal');
  const cents = BigInt(amount.replace('.', ''));
  if (cents < 0n || cents > BigInt(INT4_MAX)) throw new AnalysisInputError('amount not storable');
  return Number(cents);
}

function locatorOf(displayName: string, ref: FieldRef | null): string {
  if (ref === null || ref.line === null) return `${displayName}:manual`;
  return pointerToLocator(displayName, { page: ref.page, line: ref.line });
}

const GOVERNING_CLAUSE: Readonly<Record<string, { key: string; label: string } | null>> = {
  'INV-DUPLICATE': null,
  'INV-TOTAL-MISMATCH': null,
  'INV-LINEHAUL-RATE': { key: 'rate_confirmation.linehaul_rate', label: 'Contracted linehaul rate' },
  'INV-FUEL-SURCHARGE': { key: 'rate_confirmation.fuel_surcharge', label: 'Contracted fuel surcharge' },
  'INV-ACCESSORIAL-UNAUTH': { key: 'rate_confirmation.authorized_accessorials', label: 'Authorized accessorials' },
  'DET-UNBILLED': { key: 'rate_confirmation.detention_free_hours', label: 'Detention free time' },
  'DET-UNDERBILLED': { key: 'rate_confirmation.detention_free_hours', label: 'Detention free time' },
  'DET-OVERBILLED': { key: 'rate_confirmation.detention_free_hours', label: 'Detention free time' },
  // Step 6 (REQ-20261011-charge-intelligence): learned review-only finding.
  'LRN-ACCESSORIAL-REVIEW': { key: 'rate_confirmation.authorized_accessorials', label: 'Authorized accessorials' },
  // Step 7 (REQ-20261011-fuel-outlook): the fuel table is tenant data, not a document clause.
  'FSC-INDEX-MISMATCH': null,
};

const TIMELINE_ORDER: readonly TimelineKind[] = ['APPOINTMENT', 'ARRIVAL', 'DEPARTURE', 'INVOICE'];

/**
 * Pure part of the analysis (spec A7.2): engine run, persistability check, packet/source/timeline/finding
 * rows with citations and governing clauses, and the content hash. Throws AnalysisInputError (or a
 * RangeError from shared helpers) when the input is refused or the result is not storable.
 */
export function buildAnalysisPacket(args: {
  input: AnalysisInput;
  claim: { perspective: Perspective };
  now: Date;
  actorId: string;
  /** Step 6: the tenant's charge classifier (flag on); null/absent = exact step-5 output. */
  classifier?: ChargeClassifier | null;
  /** Step 7: the claim's fuel inputs (flag on and inputs present); null/absent = exact step-6 output. */
  fuel?: FuelCheckInput | null;
}): AnalysisPacketBuild {
  const { input, claim, now, actorId } = args;
  const persp = claim.perspective === 'SHIPPER' ? 'shipper' : 'carrier';
  const docs: EvidenceDoc[] = input.sources.map((s) => ({ filename: s.displayName, doc_type: EVIDENCE_DOC_TYPE[s.docType], sha256: s.sha256 }));
  const fuelInput = args.fuel ?? null;
  const { evidence, traces, extraLines, learnedFindingsCount, reviewFlagsCount, labelIds, fuel, fuelFindingsCount } = buildEvidenceFuel(
    docs,
    input.bundle,
    persp,
    DEFAULT_ANALYSIS_SETTINGS,
    now,
    args.classifier ?? null,
    fuelInput,
  );
  const result = evidence.result;

  // Persistability (A8, RD3): own-perspective amounts and both totals must fit the int4 cents columns.
  const amounts = result.findings.map((f) => storableCents(f.amount));
  const recoverableCents = storableCents(result.recoverable_total);
  const pendingReviewCents = storableCents(result.pending_review_total);
  if (recoverableCents + pendingReviewCents > INT4_MAX) throw new AnalysisInputError('total not storable');

  const sources: AnalysisSourceRow[] = input.sources.map((s: AnalysisSource, i) => ({
    id: randomUUID(),
    ordinal: i + 1,
    filename: s.displayName,
    docType: s.docType,
    sha256: s.sha256,
    sizeBytes: s.sizeBytes,
  }));

  const sourceOf = (slot: Slot): AnalysisSourceRow | null => {
    const prov = input.provenance[slot];
    return prov ? (sources[prov.docIndex] ?? null) : null;
  };
  const cite = (src: AnalysisSourceRow, ref: FieldRef | null): HashCitation => ({
    sourceId: src.id,
    locator: locatorOf(src.filename, ref),
    excerpt: plain(ref?.excerpt ?? '', EXCERPT_LIMIT),
  });
  const fieldCitation = (slot: Slot, key: string): HashCitation | null => {
    const prov = input.provenance[slot];
    const src = sourceOf(slot);
    if (!prov || !src || !Object.hasOwn(prov.fields, key)) return null;
    return cite(src, prov.fields[key] ?? null);
  };
  const lineCitation = (index: number): HashCitation | null => {
    const prov = input.provenance.invoice;
    const src = sourceOf('invoice');
    const line = prov?.lines[index];
    if (!src || !line) return null;
    return cite(src, line.amount);
  };

  const citationsFor = (t: FindingTrace, extra: readonly number[] = []): HashCitation[] => {
    const list: (HashCitation | null)[] = t.lines.map(lineCitation);
    if (t.total) list.push(fieldCitation('invoice', 'invoice.total'));
    if (t.detention) {
      list.push(fieldCitation('bol', t.detention.clockStartedAtAppointment ? 'bol.appointment_time' : 'bol.arrival_time'));
      list.push(fieldCitation('bol', 'bol.departure_time'));
      list.push(fieldCitation('rate_confirmation', 'rate_confirmation.detention_rate_per_hour'));
      if (t.detention.capApplied) list.push(fieldCitation('rate_confirmation', 'rate_confirmation.detention_max_hours'));
    }
    // Step 6 (C4.6): a flagged DET finding also cites each detention look-alike line.
    list.push(...extra.map(lineCitation));
    const seen = new Set<string>();
    const out: HashCitation[] = [];
    for (const c of list) {
      if (c === null) continue;
      const k = `${c.sourceId}\u0000${c.locator}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  };

  const findings: AnalysisFindingRow[] = result.findings.map((f, i) => {
    const t = traces[i] ?? { lines: [], total: false, detention: null };
    const clauseDef = GOVERNING_CLAUSE[f.rule_id] ?? null;
    const clause = clauseDef ? fieldCitation('rate_confirmation', clauseDef.key) : null;
    return {
      ordinal: i + 1,
      ruleId: f.rule_id,
      title: f.title,
      direction: f.direction === 'overcharge' ? 'OVERCHARGE' : 'UNDERBILLED',
      amountCents: amounts[i] ?? 0,
      explanation: f.explanation,
      calculation: [...f.calculation],
      confidence: f.confidence,
      needsHumanReview: f.needs_human_review,
      citations: citationsFor(t, extraLines[i] ?? []),
      clauseSourceId: clause && clauseDef ? clause.sourceId : null,
      clauseLabel: clause && clauseDef ? clauseDef.label : null,
      clauseExcerpt: clause ? clause.excerpt : null,
      clauseLocator: clause ? clause.locator : null,
    };
  });

  // Timeline from the bundle's bill of lading and invoice (naive local times stored as UTC, policy D8).
  const events: Omit<AnalysisTimelineRow, 'ordinal'>[] = [];
  const bol = input.bundle.bol;
  const bolSource = sourceOf('bol');
  if (bol && bolSource) {
    const facility = bol.facility ? plain(bol.facility, LABEL_TEXT_LIMIT) : '';
    const add = (kind: TimelineKind, value: string | null, label: string) => {
      if (value !== null) events.push({ occurredAt: LocalDateTime.parse(value).toUtcDate(), kind, label, sourceId: bolSource.id });
    };
    add('APPOINTMENT', bol.appointment_time, 'Appointment time');
    add('ARRIVAL', bol.arrival_time, facility ? `Arrived at ${facility}` : 'Arrived');
    add('DEPARTURE', bol.departure_time, facility ? `Departed from ${facility}` : 'Departed');
  }
  const inv = input.bundle.invoice;
  const invSource = sourceOf('invoice');
  const invoiceDate = inv ? parseInvoiceDate(inv.invoice_date) : null;
  if (inv && invSource && invoiceDate) {
    const number = inv.invoice_number ? plain(inv.invoice_number, LABEL_TEXT_LIMIT) : '';
    events.push({ occurredAt: invoiceDate, kind: 'INVOICE', label: number ? `Invoice ${number} issued` : 'Invoice issued', sourceId: invSource.id });
  }
  const timeline: AnalysisTimelineRow[] = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.occurredAt.getTime() - b.e.occurredAt.getTime() || TIMELINE_ORDER.indexOf(a.e.kind) - TIMELINE_ORDER.indexOf(b.e.kind) || a.i - b.i)
    .map(({ e }, i) => ({ ...e, ordinal: i + 1 }));

  const hashPacket: HashPacket = {
    perspective: claim.perspective,
    loadNumber: evidence.load_number,
    currency: 'USD',
    recoverableCents,
    pendingReviewCents,
    demandLetter: evidence.demand_letter,
    sources: sources.map((s) => ({ ...s })),
    timeline: timeline.map((t) => ({ ordinal: t.ordinal, occurredAt: t.occurredAt, kind: t.kind, label: t.label, sourceId: t.sourceId })),
    findings: findings.map((f) => ({ ...f, citations: f.citations.map((c) => ({ ...c })) })),
  };
  const contentHash = packetContentHash(hashPacket);

  return {
    packet: {
      id: randomUUID(),
      revision: 1,
      status: 'PENDING_REVIEW',
      perspective: claim.perspective,
      loadNumber: evidence.load_number,
      generatedAt: now,
      disclaimer: PACKET_DISCLAIMER,
      demandLetter: evidence.demand_letter,
      currency: 'USD',
      recoverableCents,
      pendingReviewCents,
      verifierStatus: 'NOT_RUN',
      contentHash,
      createdById: actorId,
    },
    sources,
    timeline,
    findings,
    hashPacket,
    summary: {
      findingsCount: findings.length,
      pendingFindingsCount: findings.filter((f) => f.needsHumanReview).length,
      ignoredFindingsCount: result.ignored_findings.length,
      recoverableCents,
      pendingReviewCents,
      learnedFindingsCount,
      reviewFlagsCount,
      learnedLabelIds: labelIds,
      fuelFindingsCount,
      fuelCheckStatus: fuel.status,
      fscTableId: fuelInput === null ? null : fuelInput.table.id,
      fscTableVersion: fuelInput === null ? null : fuelInput.table.version,
      priceImportId: fuel.priceImport === null ? null : fuel.priceImport.id,
      priceDate: fuel.postedDate,
    },
  };
}

/** Step 7: the fuel-check flag and the active diesel import, read once per request before any transaction. */
export interface AnalysisFuelOptions {
  enabled: boolean;
  series: PriceSeriesData | null;
}

/**
 * Analyze one claim inside the caller's tenant transaction (spec A7.3). 404 for unknown/other-tenant/non-UUID
 * ids; 409 invalid_state unless the claim is AWAITING_ANALYSIS, has no packet and has >= 1 linked ACCEPTED
 * document (re-checked under the claim row lock); 422 analysis_input_invalid when the engine refuses the
 * input or the result is not storable (nothing written).
 */
export async function analyzeClaim(
  tx: TenantTx,
  claimId: string,
  actor: Actor,
  opts: {
    bulk: boolean;
    now?: Date;
    /** Step 6: charge-suggestions flag (read once per request). */
    learning?: boolean;
    /** Fix round 1 (S1): a classifier already built for this request (bulk); else loaded here. */
    preloaded?: LoadedClassifier;
    /** Step 7: fuel-check flag and the active diesel import (both read once per request, before the tx). */
    fuel?: AnalysisFuelOptions;
  },
): Promise<AnalyzeResponseDto> {
  if (!isUuid(claimId)) throw errors.notFound();
  if (!(await lockClaimForUpdate(tx, claimId))) throw errors.notFound();
  const claim = await tx.claim.findFirst({ where: { id: claimId }, select: { id: true, tenantId: true, status: true, perspective: true, claimNumber: true } });
  if (!claim) throw errors.notFound();
  if (claim.status !== 'AWAITING_ANALYSIS') throw errors.invalidState();
  if (await tx.evidencePacket.findFirst({ where: { claimId }, select: { id: true } })) throw errors.invalidState();
  const input = await loadAnalysisInput(tx, claimId);
  if (input.sources.length === 0) throw errors.invalidState();
  const learning = opts.learning === true;
  const { classifier, labelCount } = learning ? (opts.preloaded ?? (await loadClassifier(tx))) : { classifier: null, labelCount: 0 };
  const fuelOn = opts.fuel?.enabled === true;
  const fuel = fuelOn ? ((await loadFuelInput(tx, claimId, opts.fuel?.series ?? null))?.input ?? null) : null;

  let built: AnalysisPacketBuild;
  try {
    built = buildAnalysisPacket({ input, claim: { perspective: claim.perspective }, now: opts.now ?? new Date(), actorId: actor.userId, classifier, fuel });
  } catch (e) {
    if (e instanceof AnalysisInputError || e instanceof RangeError) throw errors.analysisInputInvalid();
    throw e;
  }

  const tenantId = claim.tenantId;
  const { packet, sources, timeline, findings, summary } = built;
  // F13/F14: with the flag off the fuel fields are 'off' / null / 0 (analysis is exactly step 6).
  const fuelCheckStatus: FuelCheckStatus = fuelOn ? summary.fuelCheckStatus : 'off';
  const fuelMeta = {
    fuelCheckStatus,
    fscTableId: fuelOn ? summary.fscTableId : null,
    fscTableVersion: fuelOn ? summary.fscTableVersion : null,
    priceImportId: fuelOn ? summary.priceImportId : null,
    priceDate: fuelOn ? summary.priceDate : null,
    fuelFindingsCount: fuelOn ? summary.fuelFindingsCount : 0,
  };
  await tx.evidencePacket.create({ data: { ...packet, tenantId, claimId } });
  if (sources.length > 0) await tx.packetSource.createMany({ data: sources.map((s) => ({ ...s, tenantId, packetId: packet.id })) });
  if (timeline.length > 0) await tx.packetTimelineEvent.createMany({ data: timeline.map((t) => ({ ...t, tenantId, packetId: packet.id })) });
  if (findings.length > 0) {
    await tx.packetFinding.createMany({ data: findings.map((f) => ({ ...f, citations: f.citations.map((c) => ({ ...c })), tenantId, packetId: packet.id })) });
  }
  const amountClaimedCents = summary.recoverableCents + summary.pendingReviewCents;
  await tx.claim.update({
    where: { id: claimId },
    data: {
      status: 'PENDING_REVIEW',
      recoverableCents: summary.recoverableCents,
      pendingReviewCents: summary.pendingReviewCents,
      amountClaimedCents,
      version: { increment: 1 },
    },
  });
  await appendAudit(tx, {
    tenantId,
    action: 'claim.analyzed',
    actorId: actor.userId,
    actorRole: actor.role,
    targetType: 'claim',
    targetId: claimId,
    metadata: {
      claimId,
      claimNumber: claim.claimNumber,
      packetId: packet.id,
      revision: 1,
      contentHash: packet.contentHash,
      perspective: claim.perspective,
      fromStatus: 'AWAITING_ANALYSIS',
      toStatus: 'PENDING_REVIEW',
      documentIds: input.sources.map((s) => s.documentId),
      findingsCount: summary.findingsCount,
      pendingFindingsCount: summary.pendingFindingsCount,
      ignoredFindingsCount: summary.ignoredFindingsCount,
      recoverableCents: summary.recoverableCents,
      pendingReviewCents: summary.pendingReviewCents,
      rulesVersion: RULES_VERSION,
      bulk: opts.bulk,
      classifierVersion: learning ? CHARGE_CLASSIFIER_VERSION : null,
      seedVersion: learning ? SEED_VERSION : null,
      tenantLabelCount: labelCount,
      learnedFindingsCount: summary.learnedFindingsCount,
      reviewFlagsCount: summary.reviewFlagsCount,
      learnedLabelIds: summary.learnedLabelIds,
      ...fuelMeta,
    },
    ip: actor.ip,
    requestId: actor.requestId,
  });
  return {
    claim: { id: claimId, status: 'PENDING_REVIEW', recoverableCents: summary.recoverableCents, pendingReviewCents: summary.pendingReviewCents, amountClaimedCents },
    packet: { id: packet.id, revision: 1, status: 'PENDING_REVIEW', contentHash: packet.contentHash },
    analysis: {
      rulesVersion: RULES_VERSION,
      findingsCount: summary.findingsCount,
      pendingFindingsCount: summary.pendingFindingsCount,
      ignoredFindingsCount: summary.ignoredFindingsCount,
      classifierVersion: learning ? CHARGE_CLASSIFIER_VERSION : null,
      learnedFindingsCount: summary.learnedFindingsCount,
      reviewFlagsCount: summary.reviewFlagsCount,
      fuelCheckStatus,
      fuelFindingsCount: fuelMeta.fuelFindingsCount,
    },
  };
}

/**
 * Bulk analyze (S1, policy D9): candidates fetched once (AWAITING_ANALYSIS with >= 1 linked ACCEPTED
 * document, oldest first, at most min(4 * limit, 100)); each analyzed in ITS OWN tenant transaction exactly
 * like the single route; 404/409 -> skipped, 422 -> failed, anything else propagates (500; analyses
 * already committed stay committed). One `claim.bulk_analyzed` summary event at the end.
 *
 * Budget (S5-1): `chargeExtra` is called before every candidate after the first (the request itself paid
 * for the first); when it returns false the per-user `analysis` budget is spent and processing stops
 * early (200 with the work done so far; the unprocessed claims stay AWAITING_ANALYSIS and count in
 * `remaining`).
 */
export async function analyzeAwaiting(
  db: TenantDb,
  actor: Actor,
  limit: number,
  chargeExtra: () => Promise<boolean> = async () => true,
  learning = false,
  fuel: AnalysisFuelOptions = { enabled: false, series: null },
): Promise<BulkAnalyzeResponseDto> {
  const take = Math.min(SCAN_FACTOR * limit, SCAN_CAP);
  const candidates = await db.tx((tx) =>
    tx.claim.findMany({
      where: { status: 'AWAITING_ANALYSIS', documents: { some: { document: { status: 'ACCEPTED' } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: { id: true, claimNumber: true },
    }),
  );
  // Fix round 1 (S1): the tenant's labels are read and the classifier is built ONCE per bulk request.
  const preloaded = learning && candidates.length > 0 ? await db.tx((tx) => loadClassifier(tx)) : undefined;
  const out: BulkAnalyzeResponseDto = { limit, examined: 0, analyzed: [], skipped: [], failed: [], remaining: 0 };
  for (const c of candidates) {
    if (out.analyzed.length >= limit) break;
    if (out.examined > 0 && !(await chargeExtra())) break;
    out.examined += 1;
    try {
      const r = await db.tx((tx) => analyzeClaim(tx, c.id, actor, { bulk: true, learning, fuel, ...(preloaded ? { preloaded } : {}) }));
      out.analyzed.push({
        claimId: c.id,
        claimNumber: c.claimNumber,
        packetId: r.packet.id,
        findingsCount: r.analysis.findingsCount,
        recoverableCents: r.claim.recoverableCents,
        pendingReviewCents: r.claim.pendingReviewCents,
      });
    } catch (e) {
      // A database guard refusal (P8) means the claim was no longer analyzable: skipped, never 500.
      if ((e instanceof HttpError && (e.statusCode === 404 || e.statusCode === 409)) || isAnalysisDbError(e)) {
        out.skipped.push({ claimId: c.id, claimNumber: c.claimNumber, code: 'invalid_state' });
      }
      else if (e instanceof HttpError && e.code === 'analysis_input_invalid') out.failed.push({ claimId: c.id, claimNumber: c.claimNumber, code: 'analysis_input_invalid' });
      else throw e;
    }
  }
  out.remaining = await db.tx(async (tx) => {
    const remaining = await tx.claim.count({ where: { status: 'AWAITING_ANALYSIS' } });
    await appendAudit(tx, {
      tenantId: db.tenantId,
      action: 'claim.bulk_analyzed',
      actorId: actor.userId,
      actorRole: actor.role,
      targetType: 'tenant',
      targetId: db.tenantId,
      metadata: { limit, examined: out.examined, analyzed: out.analyzed.length, skipped: out.skipped.length, failed: out.failed.length, remaining },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return remaining;
  });
  return out;
}
