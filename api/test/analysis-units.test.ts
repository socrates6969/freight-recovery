import { AnalysisInputError, PACKET_DISCLAIMER, can, type ImportDocType } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import { toHttpError } from '../src/app.js';
import { sanitizeMetadata } from '../src/audit/chain.js';
import { INT4_MAX, buildAnalysisPacket, storableCents } from '../src/claims/analysis.js';
import { packetContentHash } from '../src/claims/content-hash.js';
import { isAnalysisDbError, isFourEyesDbError } from '../src/http/db-guard.js';
import { ERROR_MESSAGES, errors } from '../src/http/errors.js';
import { assembleBundle, assembleBundleWithProvenance, type BundleDocument, type BundleField } from '../src/imports/bundle.js';

type F = [key: string, value: string | null, line: number | null, excerpt?: string | null, group?: number | null, page?: number | null];

function doc(displayName: string, docType: ImportDocType, fields: F[]): BundleDocument {
  return {
    displayName,
    docType,
    warnings: [],
    fields: fields.map(([key, v, line, excerpt, group, page]): BundleField => ({
      key,
      groupIndex: group ?? null,
      effectiveValue: v,
      ref: { page: page ?? null, line, excerpt: excerpt === undefined ? `${key}: ${v ?? ''}` : excerpt },
    })),
  };
}

function ld5001Docs(opts: { noAuthorized?: boolean; lumperLine?: number | null; max?: string } = {}): BundleDocument[] {
  return [
    doc('bol.txt', 'BILL_OF_LADING', [
      ['bol.load_number', 'LD-5001', 2],
      ['bol.facility', 'Widget Co <DC 4>', 3],
      ['bol.appointment_time', '2025-03-03T08:00:00', 4, 'Appointment Time: 2025-03-03 08:00'],
      ['bol.arrival_time', '2025-03-03T07:45:00', 5],
      ['bol.departure_time', '2025-03-03T11:30:00', 6, 'Departure Time: 2025-03-03 11:30'],
    ]),
    doc('invoice.txt', 'INVOICE', [
      ['invoice.invoice_number', 'INV-1001', 2],
      ['invoice.carrier', 'Acme Freight LLC', 3],
      ['invoice.shipper', 'Widget Co', 4],
      ['invoice.load_number', 'LD-5001', 5],
      ['invoice.invoice_date', '2025-03-10', 6],
      ['invoice.charge.description', 'Linehaul', 7, 'Charge: Linehaul | 1500.00', 0],
      ['invoice.charge.amount', '1500.00', 7, 'Charge: Linehaul | 1500.00', 0],
      ['invoice.charge.description', 'Fuel Surcharge', 8, null, 1],
      ['invoice.charge.amount', '168.00', 8, null, 1],
      ['invoice.charge.description', 'Detention', 9, 'Charge: Detention | 300.00', 2],
      ['invoice.charge.amount', '300.00', 9, 'Charge: Detention | 300.00', 2],
      ['invoice.charge.description', 'Lumper', opts.lumperLine === undefined ? 10 : opts.lumperLine, 'Charge: Lumper | 150.00', 3],
      ['invoice.charge.amount', '150.00', opts.lumperLine === undefined ? 10 : opts.lumperLine, 'Charge: Lumper | 150.00', 3, 2],
      ['invoice.total', '2118.00', 11],
    ]),
    doc('rate_confirmation.txt', 'RATE_CONFIRMATION', [
      ['rate_confirmation.load_number', 'LD-5001', 2],
      ['rate_confirmation.linehaul_rate', '1400.00', 4, 'Linehaul Rate: 1400.00'],
      ['rate_confirmation.fuel_surcharge', '168.00', 5],
      ['rate_confirmation.detention_free_hours', '2', 6, 'Detention Free Hours: 2'],
      ['rate_confirmation.detention_rate_per_hour', '50.00', 7],
      ['rate_confirmation.detention_max_hours', opts.max ?? '8', 8],
      ...(opts.noAuthorized ? [] : ([['rate_confirmation.authorized_accessorials', '["Detention"]', 9, 'Authorized Accessorials: Detention']] as F[])),
    ]),
  ];
}

function input(docs: BundleDocument[]) {
  const { bundle, provenance } = assembleBundleWithProvenance(docs);
  return {
    bundle,
    provenance,
    sources: docs.map((d, i) => ({ documentId: `00000000-0000-4000-8000-00000000000${i}`, displayName: d.displayName, sha256: String(i).repeat(64), docType: d.docType, sizeBytes: 100 + i })),
  };
}

const NOW = new Date('2026-10-10T12:00:00.000Z');
const ACTOR = '11111111-1111-4111-8111-111111111111';

describe('bundle provenance', () => {
  it('assembleBundle is unchanged and provenance records the document and field refs that were taken', () => {
    const docs = ld5001Docs();
    const { bundle, provenance } = assembleBundleWithProvenance(docs);
    expect(assembleBundle(docs)).toEqual(bundle);
    expect(provenance.bol?.docIndex).toBe(0);
    expect(provenance.invoice?.docIndex).toBe(1);
    expect(provenance.invoice?.fields['invoice.total']).toEqual({ page: null, line: 11, excerpt: 'invoice.total: 2118.00' });
    expect(provenance.invoice?.lines).toHaveLength(4);
    expect(provenance.invoice?.lines[3]?.amount).toEqual({ page: 2, line: 10, excerpt: 'Charge: Lumper | 150.00' });
    expect(Object.hasOwn(provenance.rate_confirmation?.fields ?? {}, 'rate_confirmation.carrier')).toBe(false);
  });

  it('a duplicate slot keeps the first document and its provenance', () => {
    const docs = [...ld5001Docs(), doc('inv2.txt', 'INVOICE', [['invoice.total', '1', 1]])];
    const { bundle, provenance } = assembleBundleWithProvenance(docs);
    expect(bundle.warnings).toContain('inv2.txt: duplicate invoice; ignored');
    expect(provenance.invoice?.docIndex).toBe(1);
  });
});

describe('buildAnalysisPacket', () => {
  it('builds revision 1 rows: totals, findings in engine order, citations, clauses, timeline and hash', () => {
    const b = buildAnalysisPacket({ input: input(ld5001Docs()), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    expect(b.packet).toMatchObject({
      revision: 1,
      status: 'PENDING_REVIEW',
      perspective: 'SHIPPER',
      loadNumber: 'LD-5001',
      generatedAt: NOW,
      disclaimer: PACKET_DISCLAIMER,
      currency: 'USD',
      recoverableCents: 32500,
      pendingReviewCents: 15000,
      verifierStatus: 'NOT_RUN',
      createdById: ACTOR,
    });
    expect(b.packet.demandLetter).toContain('Date: 2026-10-10');
    expect(b.summary).toEqual({ findingsCount: 3, pendingFindingsCount: 1, ignoredFindingsCount: 0, recoverableCents: 32500, pendingReviewCents: 15000, learnedFindingsCount: 0, reviewFlagsCount: 0, learnedLabelIds: [],
      // Step 7: no fuel inputs -> no_inputs (the packet equals step 6).
      fuelFindingsCount: 0, fuelCheckStatus: 'no_inputs', fscTableId: null, fscTableVersion: null, paramsSha256: null, priceImportId: null, priceDate: null,
    });
    expect(b.sources.map((s) => [s.ordinal, s.filename, s.docType, s.sizeBytes])).toEqual([
      [1, 'bol.txt', 'BILL_OF_LADING', 100],
      [2, 'invoice.txt', 'INVOICE', 101],
      [3, 'rate_confirmation.txt', 'RATE_CONFIRMATION', 102],
    ]);
    const [bol, inv, rc] = b.sources.map((s) => s.id);
    expect(b.findings.map((f) => [f.ordinal, f.ruleId, f.direction, f.amountCents, f.confidence, f.needsHumanReview])).toEqual([
      [1, 'INV-LINEHAUL-RATE', 'OVERCHARGE', 10000, 0.95, false],
      [2, 'INV-ACCESSORIAL-UNAUTH', 'OVERCHARGE', 15000, 0.6, true],
      [3, 'DET-OVERBILLED', 'OVERCHARGE', 22500, 0.85, false],
    ]);
    expect(b.findings[0]?.citations).toEqual([{ sourceId: inv, locator: 'invoice.txt:L7', excerpt: 'Charge: Linehaul | 1500.00' }]);
    expect([b.findings[0]?.clauseSourceId, b.findings[0]?.clauseLabel, b.findings[0]?.clauseLocator, b.findings[0]?.clauseExcerpt]).toEqual([
      rc,
      'Contracted linehaul rate',
      'rate_confirmation.txt:L4',
      'Linehaul Rate: 1400.00',
    ]);
    // PDF-style pointer with a page.
    expect(b.findings[1]?.citations).toEqual([{ sourceId: inv, locator: 'invoice.txt:p2:L10', excerpt: 'Charge: Lumper | 150.00' }]);
    expect(b.findings[1]?.clauseLabel).toBe('Authorized accessorials');
    expect(b.findings[2]?.citations).toEqual([
      { sourceId: inv, locator: 'invoice.txt:L9', excerpt: 'Charge: Detention | 300.00' },
      { sourceId: bol, locator: 'bol.txt:L4', excerpt: 'Appointment Time: 2025-03-03 08:00' },
      { sourceId: bol, locator: 'bol.txt:L6', excerpt: 'Departure Time: 2025-03-03 11:30' },
      { sourceId: rc, locator: 'rate_confirmation.txt:L7', excerpt: 'rate_confirmation.detention_rate_per_hour: 50.00' },
    ]);
    expect([b.findings[2]?.clauseLabel, b.findings[2]?.clauseLocator]).toEqual(['Detention free time', 'rate_confirmation.txt:L6']);
    expect(b.timeline.map((t) => [t.ordinal, t.kind, t.label, t.occurredAt.toISOString(), t.sourceId])).toEqual([
      [1, 'ARRIVAL', 'Arrived at Widget Co DC 4', '2025-03-03T07:45:00.000Z', bol],
      [2, 'APPOINTMENT', 'Appointment time', '2025-03-03T08:00:00.000Z', bol],
      [3, 'DEPARTURE', 'Departed from Widget Co DC 4', '2025-03-03T11:30:00.000Z', bol],
      [4, 'INVOICE', 'Invoice INV-1001 issued', '2025-03-10T00:00:00.000Z', inv],
    ]);
    expect(b.packet.contentHash).toBe(packetContentHash(b.hashPacket));
    expect(b.packet.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('cites manual fields as :manual, drops an absent clause, cites the cap when it applied, dedupes citations', () => {
    const b = buildAnalysisPacket({ input: input(ld5001Docs({ noAuthorized: true, lumperLine: null, max: '0.5' })), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    const unauth = b.findings.find((f) => f.ruleId === 'INV-ACCESSORIAL-UNAUTH');
    expect(unauth?.citations.map((c) => c.locator)).toEqual(['invoice.txt:manual']);
    expect([unauth?.clauseSourceId, unauth?.clauseLabel, unauth?.clauseLocator, unauth?.clauseExcerpt]).toEqual([null, null, null, null]);
    const det = b.findings.find((f) => f.ruleId.startsWith('DET-'));
    expect(det?.citations.map((c) => c.locator)).toEqual(['invoice.txt:L9', 'bol.txt:L4', 'bol.txt:L6', 'rate_confirmation.txt:L7', 'rate_confirmation.txt:L8']);
  });

  it('cites the arrival when the clock starts at arrival; zero findings still yield a packet with zero totals', () => {
    const docs = ld5001Docs();
    const bolDoc = docs[0] as BundleDocument;
    docs[0] = { ...bolDoc, fields: bolDoc.fields.filter((f) => f.key !== 'bol.appointment_time') };
    const b = buildAnalysisPacket({ input: input(docs), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    expect(b.findings.find((f) => f.ruleId.startsWith('DET-'))?.citations.map((c) => c.locator)).toContain('bol.txt:L5');
    expect(b.timeline.map((t) => t.kind)).toEqual(['ARRIVAL', 'DEPARTURE', 'INVOICE']);

    const carrier = buildAnalysisPacket({ input: input(ld5001Docs()), claim: { perspective: 'CARRIER' }, now: NOW, actorId: ACTOR });
    expect(carrier.findings).toEqual([]);
    expect(carrier.summary).toEqual({ findingsCount: 0, pendingFindingsCount: 0, ignoredFindingsCount: 3, recoverableCents: 0, pendingReviewCents: 0, learnedFindingsCount: 0, reviewFlagsCount: 0, learnedLabelIds: [],
      // Step 7: no fuel inputs -> no_inputs (the packet equals step 6).
      fuelFindingsCount: 0, fuelCheckStatus: 'no_inputs', fscTableId: null, fscTableVersion: null, paramsSha256: null, priceImportId: null, priceDate: null,
    });
    expect(carrier.packet.demandLetter).toContain('No amount is requested');
  });

  it('refuses unstorable results (negative amounts, over int4) and malformed input with AnalysisInputError', () => {
    const neg = [
      doc('invoice.txt', 'INVOICE', [
        ['invoice.charge.description', 'Credit', 1, null, 0],
        ['invoice.charge.amount', '-5.00', 1, null, 0],
        ['invoice.charge.description', 'Credit', 2, null, 1],
        ['invoice.charge.amount', '-5.00', 2, null, 1],
      ]),
    ];
    expect(() => buildAnalysisPacket({ input: input(neg), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR })).toThrow(AnalysisInputError);
    const huge = [doc('invoice.txt', 'INVOICE', [['invoice.charge.description', 'Linehaul', 1, null, 0], ['invoice.charge.amount', '1', 1, null, 0], ['invoice.total', '30000000.00', 2]])];
    expect(() => buildAnalysisPacket({ input: input(huge), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR })).toThrow(AnalysisInputError);
    const bad = [doc('bol.txt', 'BILL_OF_LADING', [['bol.arrival_time', 'yesterday', 1]])];
    expect(() => buildAnalysisPacket({ input: input(bad), claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR })).toThrow(AnalysisInputError);
  });

  it('storableCents accepts 0..INT4_MAX cents only', () => {
    expect([storableCents('0.00'), storableCents('-0.00'), storableCents('21474836.47')]).toEqual([0, 0, INT4_MAX]);
    for (const v of ['-0.01', '21474836.48', '1.5', '1e3']) expect(() => storableCents(v)).toThrow(AnalysisInputError);
  });
});

describe('errors, DB-guard mapping, audit keys and RBAC (step 5)', () => {
  it('has the fixed 422 analysis_input_invalid error', () => {
    expect(ERROR_MESSAGES.analysis_input_invalid).toBe('The extracted values of this claim cannot be analysed automatically.');
    const e = errors.analysisInputInvalid();
    expect([e.statusCode, e.code, e.message]).toEqual([422, 'analysis_input_invalid', ERROR_MESSAGES.analysis_input_invalid]);
  });

  const prismaTriggerError = (code: string, message: string) =>
    Object.assign(new Error('Invalid prisma invocation'), {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { kind: 'postgres', originalCode: code, originalMessage: message } } },
    });

  it('maps exact analysis trigger raises to 409 invalid_state and never forwards the DB message', () => {
    for (const m of ['claim_transition_invalid', 'analysis_packet_invalid']) {
      expect(isAnalysisDbError(prismaTriggerError('P0001', m))).toBe(true);
      const mapped = toHttpError(prismaTriggerError('P0001', m));
      expect([mapped.statusCode, mapped.code, mapped.message]).toEqual([409, 'invalid_state', 'This action is not allowed in the current state.']);
      const pgErr = Object.assign(new Error(m), { code: 'P0001' });
      expect(toHttpError(new Error('wrapper', { cause: pgErr })).code).toBe('invalid_state');
      expect(isFourEyesDbError(pgErr)).toBe(false);
    }
  });

  it('does not match substrings, other SQLSTATEs or messages without a code', () => {
    for (const e of [
      prismaTriggerError('P0001', 'claim_transition_invalid: x'),
      prismaTriggerError('23514', 'analysis_packet_invalid'),
      Object.assign(new Error('x claim_transition_invalid'), { code: 'P0001' }),
      new Error('analysis_packet_invalid'),
      'claim_transition_invalid',
    ]) {
      expect(isAnalysisDbError(e)).toBe(false);
      expect(toHttpError(e).statusCode).toBe(500);
    }
  });

  it('allows exactly the step-5 metadata keys', () => {
    const meta = {
      findingsCount: 3,
      pendingFindingsCount: 1,
      ignoredFindingsCount: 0,
      recoverableCents: 1,
      pendingReviewCents: 2,
      rulesVersion: 'rules-v1',
      bulk: true,
      examined: 4,
      analyzed: 3,
      failed: 1,
      remaining: 0,
      carrierName: 'Acme',
      letter: 'text',
    };
    const out = sanitizeMetadata(meta);
    expect(Object.keys(out).sort()).toEqual(['analyzed', 'bulk', 'examined', 'failed', 'findingsCount', 'ignoredFindingsCount', 'pendingFindingsCount', 'pendingReviewCents', 'recoverableCents', 'remaining', 'rulesVersion']);
  });

  it('grants claims:analyze to OWNER, ADMIN, MANAGER, REVIEWER, ANALYST only', () => {
    const roles = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN'] as const;
    expect(roles.filter((r) => can(r, 'claims:analyze'))).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST']);
  });
});
