/**
 * Hardening (REQ-20261012-hardening, C6): exact transparency copy, honesty scan, unchanged earlier constants,
 * and the additive DTO fields of this run.
 */
import { describe, expect, it } from 'vitest';

import { ANALYSIS_FAILURE_REASONS, BULK_STOP_REASONS, BulkAnalyzeResponse } from './analysis-dto.js';
import { ChargeLinesResponse } from './charge-intel-dto.js';
import { ApprovalItem, ClaimDetail } from './dto.js';
import { FOUR_EYES_CLAIM_BASES, FOUR_EYES_CLAIM_TEXT } from './four-eyes.js';
import { OutlookSeries, PRICE_SOURCE_KINDS } from './outlook-dto.js';
import {
  ANALYSIS_FAILURE_TEXT,
  BULK_ANALYZE_INTRO,
  BULK_STOPPED_TEXT,
  CHARGE_LABEL_CONFLICT_TEXT,
  DD_PRESET_VERIFICATION_TEXT,
  FOUR_EYES_CLAIM_BASIS_TEXT,
  FUEL_TABLE_LIMIT_TEXT,
  LEARNED_INFLUENCE_TEXT,
  PRICE_SOURCE_KIND_TEXT,
  analysisFailureNote,
  findingConfidenceText,
} from './transparency-copy.js';

describe('transparency copy (C6)', () => {
  it('has the exact strings', () => {
    expect(ANALYSIS_FAILURE_TEXT).toEqual({
      input_values:
        'The extracted values of this claim cannot be analysed automatically. Accepted documents cannot be changed, so the claim stays awaiting analysis.',
      amount_out_of_range: 'The computed amounts are negative or larger than the product can store, so nothing was saved.',
      fuel_check: 'The fuel check produced amounts that cannot be stored. Clear the fuel inputs or choose another fuel table, then analyze again.',
    });
    expect(BULK_ANALYZE_INTRO).toBe('Analyzes up to 10 claims awaiting analysis, oldest first. Claims whose analysis failed before are tried after the others.');
    expect(BULK_STOPPED_TEXT).toEqual({
      limit: 'Stopped after the batch limit.',
      budget: 'Stopped early: your analysis budget is used up for now. Try again later.',
      candidates: 'All candidate claims in this run were tried.',
    });
    expect(FOUR_EYES_CLAIM_BASIS_TEXT).toEqual({
      revision_author: 'You created a revision of this claim (by editing, analyzing or running the D&D audit). Another approver must approve it.',
      dd_invoice_editor: 'You entered or edited the D&D invoice of this claim. Another approver must approve it.',
      label_author: 'You set a team charge label that influenced this analysis. Another approver must approve it.',
    });
    expect(LEARNED_INFLUENCE_TEXT).toEqual({
      heading: 'Team labels that influenced this analysis',
      none: 'No team label influenced this analysis.',
      deleted: 'Deleted label',
      note: 'A team label can only move findings to human review or add review items. It never adds confirmed money.',
    });
    expect(CHARGE_LABEL_CONFLICT_TEXT).toBe('This label was changed at the same time by someone else. Reload and try again.');
    expect(FUEL_TABLE_LIMIT_TEXT).toBe('This organization has reached the maximum of 50 fuel tables. Archived tables count toward this limit.');
    expect(DD_PRESET_VERIFICATION_TEXT).toEqual({
      primary: "Checked against the carrier's published tariff document.",
      primary_search_extract:
        "Read from the carrier's published tariff through a search-engine extract; the document itself was not downloaded. Verify before use.",
      secondary: "Reported by a trade publication, not the carrier's own tariff. Verify against the carrier's tariff before use.",
    });
    expect(PRICE_SOURCE_KIND_TEXT).toEqual({
      fetch: 'Downloaded from FRED by the import command.',
      bundled: 'From the files bundled with the product, checked against their pinned sha256.',
      file: 'Imported from a file supplied by the operator; the product did not download it.',
    });
  });

  it('formats the failure note and the confidence text', () => {
    expect(analysisFailureNote('Oct 12, 2026, 10:00', 1, 'R.')).toBe('Last analysis attempt failed on Oct 12, 2026, 10:00 (1 failed attempt so far). R.');
    expect(analysisFailureNote('D', 3, 'R.')).toBe('Last analysis attempt failed on D (3 failed attempts so far). R.');
    expect(findingConfidenceText(0.9)).toBe('rule setting 0.90 (fixed per rule; not a measured probability)');
    expect(findingConfidenceText(0.6)).toBe('rule setting 0.60 (fixed per rule; not a measured probability)');
  });

  it('covers every reason, basis, stop reason and source kind; objects are frozen', () => {
    expect(Object.keys(ANALYSIS_FAILURE_TEXT).sort()).toEqual([...ANALYSIS_FAILURE_REASONS].sort());
    expect(Object.keys(FOUR_EYES_CLAIM_BASIS_TEXT).sort()).toEqual([...FOUR_EYES_CLAIM_BASES].sort());
    expect(Object.keys(BULK_STOPPED_TEXT).sort()).toEqual([...BULK_STOP_REASONS].sort());
    expect(Object.keys(PRICE_SOURCE_KIND_TEXT).sort()).toEqual([...PRICE_SOURCE_KINDS].sort());
    for (const o of [ANALYSIS_FAILURE_TEXT, BULK_STOPPED_TEXT, FOUR_EYES_CLAIM_BASIS_TEXT, LEARNED_INFLUENCE_TEXT, DD_PRESET_VERIFICATION_TEXT, PRICE_SOURCE_KIND_TEXT]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
  });

  it('makes no unmeasured claim (honesty scan) and keeps the earlier four-eyes text', () => {
    const all = [
      ...Object.values(ANALYSIS_FAILURE_TEXT),
      BULK_ANALYZE_INTRO,
      ...Object.values(BULK_STOPPED_TEXT),
      ...Object.values(FOUR_EYES_CLAIM_BASIS_TEXT),
      ...Object.values(LEARNED_INFLUENCE_TEXT),
      CHARGE_LABEL_CONFLICT_TEXT,
      FUEL_TABLE_LIMIT_TEXT,
      ...Object.values(DD_PRESET_VERIFICATION_TEXT),
      ...Object.values(PRICE_SOURCE_KIND_TEXT),
      findingConfidenceText(0.9),
    ].join('\n');
    for (const bad of [/accura/iu, /guarantee/iu, /AI-powered/iu, /verified result/iu, /recovery rate/iu, /[0-9]+ ?%/u]) expect([String(bad), bad.test(all)]).toEqual([String(bad), false]);
    expect(FOUR_EYES_CLAIM_TEXT).toBe('You edited this revision. Another approver must approve it.');
  });
});

describe('additive DTO fields (C1, C3, C4, C5, C8)', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const summary = {
    id: uuid,
    claimNumber: 'CLM-1',
    kind: 'FREIGHT',
    loadNumber: null,
    invoiceNumber: null,
    carrierName: 'Synthetic Carrier',
    shipperName: 'Synthetic Shipper',
    perspective: 'SHIPPER',
    status: 'AWAITING_ANALYSIS',
    amountClaimedCents: 0,
    recoverableCents: 0,
    pendingReviewCents: 0,
    currency: 'USD',
    assignee: null,
    latestPacket: null,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  };

  it('ClaimDetail requires analysisFailure (null or a valid object)', () => {
    expect(ClaimDetail.safeParse({ ...summary, invoiceDate: null }).success).toBe(false);
    expect(ClaimDetail.safeParse({ ...summary, invoiceDate: null, analysisFailure: null }).success).toBe(true);
    const f = { lastFailedAt: '2026-10-12T00:00:00.000Z', reasonCode: 'fuel_check', failedAttempts: 2 };
    expect(ClaimDetail.safeParse({ ...summary, invoiceDate: null, analysisFailure: f }).success).toBe(true);
    expect(ClaimDetail.safeParse({ ...summary, invoiceDate: null, analysisFailure: { ...f, failedAttempts: 0 } }).success).toBe(false);
    expect(ClaimDetail.safeParse({ ...summary, invoiceDate: null, analysisFailure: { ...f, reasonCode: 'other' } }).success).toBe(false);
  });

  it('ApprovalItem requires selfAuthoredBasis', () => {
    const item = { ...summary, status: 'PENDING_REVIEW', packetRevision: 1, pendingFindingsCount: 0, waitingSince: summary.createdAt, selfAuthored: true };
    expect(ApprovalItem.safeParse(item).success).toBe(false);
    for (const b of [...FOUR_EYES_CLAIM_BASES, null]) expect(ApprovalItem.safeParse({ ...item, selfAuthoredBasis: b }).success).toBe(true);
    expect(ApprovalItem.safeParse({ ...item, selfAuthoredBasis: 'uploader' }).success).toBe(false);
  });

  it('BulkAnalyzeResponse requires stoppedBy and a reasonCode per failed item', () => {
    const r = { limit: 10, examined: 1, analyzed: [], skipped: [], failed: [{ claimId: uuid, claimNumber: 'CLM-1', code: 'analysis_input_invalid', reasonCode: 'input_values' }], remaining: 0 };
    expect(BulkAnalyzeResponse.safeParse(r).success).toBe(false);
    expect(BulkAnalyzeResponse.safeParse({ ...r, stoppedBy: 'budget' }).success).toBe(true);
    expect(BulkAnalyzeResponse.safeParse({ ...r, stoppedBy: 'error' }).success).toBe(false);
    expect(BulkAnalyzeResponse.safeParse({ ...r, stoppedBy: 'limit', failed: [{ claimId: uuid, claimNumber: 'CLM-1', code: 'analysis_input_invalid' }] }).success).toBe(false);
  });

  it('ChargeLinesResponse requires influence (strict)', () => {
    const r = { claimId: uuid, classifierVersion: 'charge-knn-v1', seedVersion: 'tariff-seed-v1', threshold: 0.3, lines: [] };
    expect(ChargeLinesResponse.safeParse(r).success).toBe(false);
    expect(ChargeLinesResponse.safeParse({ ...r, influence: null }).success).toBe(true);
    expect(ChargeLinesResponse.safeParse({ ...r, influence: { labels: [{ labelId: uuid, description: null, category: null }] } }).success).toBe(true);
    expect(ChargeLinesResponse.safeParse({ ...r, influence: { labels: [{ labelId: uuid, description: 'x', category: 'fuel', extra: 1 }] } }).success).toBe(false);
  });

  it('OutlookSeries provenance requires sourceKind', () => {
    const shape = OutlookSeries.shape.provenance.unwrap();
    const p = { importId: uuid, sourceUrl: 'https://example.org/x', retrievedAt: '2026-10-01', sha256: 'a'.repeat(64), rowCount: 1, firstDate: '2026-01-01', lastDate: '2026-10-01' };
    expect(shape.safeParse(p).success).toBe(false);
    for (const k of PRICE_SOURCE_KINDS) expect(shape.safeParse({ ...p, sourceKind: k }).success).toBe(true);
    expect(shape.safeParse({ ...p, sourceKind: 'other' }).success).toBe(false);
  });
});
