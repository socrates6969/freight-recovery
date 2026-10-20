/* eslint-disable */
// REQ-20261012-hardening Tier L: T1 HD-S05..HD-S08 and T10 HP-A01 (static part). Part C C1, C3, C4, C5, C6, C8.2, C9,
// C15. Exact strings are restated from Part C C6; nothing is derived from the implementation.
import { describe, expect, it } from 'vitest';

const load = async () => (await import('@fr/shared')) as any;

const C6 = {
  ANALYSIS_FAILURE_TEXT: {
    input_values: 'The extracted values of this claim cannot be analysed automatically. Accepted documents cannot be changed, so the claim stays awaiting analysis.',
    amount_out_of_range: 'The computed amounts are negative or larger than the product can store, so nothing was saved.',
    fuel_check: 'The fuel check produced amounts that cannot be stored. Clear the fuel inputs or choose another fuel table, then analyze again.',
  },
  BULK_ANALYZE_INTRO: 'Analyzes up to 10 claims awaiting analysis, oldest first. Claims whose analysis failed before are tried after the others.',
  BULK_STOPPED_TEXT: {
    limit: 'Stopped after the batch limit.',
    budget: 'Stopped early: your analysis budget is used up for now. Try again later.',
    candidates: 'All candidate claims in this run were tried.',
  },
  FOUR_EYES_CLAIM_BASIS_TEXT: {
    revision_author: 'You created a revision of this claim (by editing, analyzing or running the D&D audit). Another approver must approve it.',
    dd_invoice_editor: 'You entered or edited the D&D invoice of this claim. Another approver must approve it.',
    label_author: 'You set a team charge label that influenced this analysis. Another approver must approve it.',
  },
  LEARNED_INFLUENCE_TEXT: {
    heading: 'Team labels that influenced this analysis',
    none: 'No team label influenced this analysis.',
    deleted: 'Deleted label',
    note: 'A team label can only move findings to human review or add review items. It never adds confirmed money.',
  },
  CHARGE_LABEL_CONFLICT_TEXT: 'This label was changed at the same time by someone else. Reload and try again.',
  FUEL_TABLE_LIMIT_TEXT: 'This organization has reached the maximum of 50 fuel tables. Archived tables count toward this limit.',
  DD_PRESET_VERIFICATION_TEXT: {
    primary: "Checked against the carrier's published tariff document.",
    primary_search_extract: "Read from the carrier's published tariff through a search-engine extract; the document itself was not downloaded. Verify before use.",
    secondary: "Reported by a trade publication, not the carrier's own tariff. Verify against the carrier's tariff before use.",
  },
  PRICE_SOURCE_KIND_TEXT: {
    fetch: 'Downloaded from FRED by the import command.',
    bundled: 'From the files bundled with the product, checked against their pinned sha256.',
    file: 'Imported from a file supplied by the operator; the product did not download it.',
  },
} as const;
const HONEST = /accura|guarantee|AI-powered|verified result|\d+\s?%/i;
const U = '00000000-0000-4000-8000-000000000001';
const ISO = '2026-10-12T10:00:00.000Z';

describe('HD-S05 transparency copy (C6)', () => {
  it('every C6 constant exists with exactly the C6 value; objects are frozen', async () => {
    const m = await load();
    for (const [k, v] of Object.entries(C6)) {
      expect(m[k], k).toEqual(v);
      if (typeof v === 'object') {
        expect(Object.isFrozen(m[k]), `${k} frozen`).toBe(true);
        expect(Object.keys(m[k]), `${k} keys`).toEqual(Object.keys(v));
      }
    }
  });
  it('the module transparency-copy is re-exported from the package root (the root exports reach every C6 name)', async () => {
    const m = await load();
    for (const k of [...Object.keys(C6), 'analysisFailureNote', 'findingConfidenceText']) expect(k in m, k).toBe(true);
  });
  it('analysisFailureNote: singular/plural, verbatim concatenation', async () => {
    const m = await load();
    expect(m.analysisFailureNote('2026-10-12 10:00', 1, 'x')).toBe('Last analysis attempt failed on 2026-10-12 10:00 (1 failed attempt so far). x');
    expect(m.analysisFailureNote('2026-10-12 10:00', 3, 'x')).toBe('Last analysis attempt failed on 2026-10-12 10:00 (3 failed attempts so far). x');
    expect(m.analysisFailureNote('d', 2, C6.ANALYSIS_FAILURE_TEXT.fuel_check)).toBe(`Last analysis attempt failed on d (2 failed attempts so far). ${C6.ANALYSIS_FAILURE_TEXT.fuel_check}`);
  });
  it('findingConfidenceText: two decimals, fixed wording', async () => {
    const m = await load();
    expect(m.findingConfidenceText(0.9)).toBe('rule setting 0.90 (fixed per rule; not a measured probability)');
    expect(m.findingConfidenceText(0.5)).toBe('rule setting 0.50 (fixed per rule; not a measured probability)');
    expect(m.findingConfidenceText(1)).toBe('rule setting 1.00 (fixed per rule; not a measured probability)');
    expect(m.findingConfidenceText(0.85)).toBe('rule setting 0.85 (fixed per rule; not a measured probability)');
  });
  it('existing constants keep their values (FOUR_EYES_CLAIM_TEXT, ANALYSIS_TEXT.invalid)', async () => {
    const m = await load();
    expect(m.FOUR_EYES_CLAIM_TEXT).toBe('You edited this revision. Another approver must approve it.');
    expect(m.ANALYSIS_TEXT.invalid).toBe('The extracted values of this claim cannot be analysed automatically.');
    expect(m.ANALYSIS_TEXT.bulkIntro, 'existing bulk intro constant unchanged').toBe('Analyzes up to 10 claims awaiting analysis, oldest first.');
  });
});

describe('HD-S06 honesty scan of every C6 string', () => {
  it('no accuracy, guarantee, AI-powered, verified-result or percentage wording', async () => {
    const m = await load();
    const strings: string[] = [];
    const collect = (v: unknown) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
    for (const k of Object.keys(C6)) collect(m[k]);
    strings.push(m.analysisFailureNote('2026-10-12 10:00', 2, 'r'), m.findingConfidenceText(0.9));
    expect(strings.length).toBeGreaterThanOrEqual(22);
    for (const s of strings) expect(s, s).not.toMatch(HONEST);
  });
});

describe('HD-S07 DTO schemas (C1, C3, C4, C5, C8.2)', () => {
  const claim = () => ({ id: U, claimNumber: 'CLM-0001', kind: 'FREIGHT', loadNumber: 'LD-1', invoiceNumber: null, carrierName: 'Synthetic Carrier', shipperName: 'Synthetic Shipper', perspective: 'SHIPPER', status: 'PENDING_REVIEW', amountClaimedCents: 0, recoverableCents: 0, pendingReviewCents: 0, currency: 'USD', assignee: null, latestPacket: null, createdAt: ISO, updatedAt: ISO });
  it('ApprovalItem requires selfAuthoredBasis (three bases or null); rejects undefined and uploader', async () => {
    const m = await load();
    const base = { ...claim(), packetRevision: 1, pendingFindingsCount: 0, waitingSince: ISO };
    for (const b of ['revision_author', 'dd_invoice_editor', 'label_author']) expect(m.ApprovalItem.safeParse({ ...base, selfAuthored: true, selfAuthoredBasis: b }).success, b).toBe(true);
    expect(m.ApprovalItem.safeParse({ ...base, selfAuthored: false, selfAuthoredBasis: null }).success).toBe(true);
    expect(m.ApprovalItem.safeParse({ ...base, selfAuthored: false }).success, 'missing basis').toBe(false);
    expect(m.ApprovalItem.safeParse({ ...base, selfAuthored: true, selfAuthoredBasis: 'uploader' }).success).toBe(false);
  });
  it('BulkAnalyzeResponse requires stoppedBy in {limit,budget,candidates} and failed[].reasonCode in the three reasons', async () => {
    const m = await load();
    const ok = { limit: 1, examined: 1, analyzed: [], skipped: [], failed: [{ claimId: U, claimNumber: 'CLM-1', code: 'analysis_input_invalid', reasonCode: 'input_values' }], remaining: 0, stoppedBy: 'candidates' };
    expect(m.BulkAnalyzeResponse.safeParse(ok).success).toBe(true);
    for (const s of ['limit', 'budget', 'candidates']) expect(m.BulkAnalyzeResponse.safeParse({ ...ok, stoppedBy: s }).success, s).toBe(true);
    for (const r of ['input_values', 'amount_out_of_range', 'fuel_check']) expect(m.BulkAnalyzeResponse.safeParse({ ...ok, failed: [{ ...ok.failed[0], reasonCode: r }] }).success, r).toBe(true);
    expect(m.BulkAnalyzeResponse.safeParse({ ...ok, stoppedBy: 'error' }).success, 'error is never a 200 value').toBe(false);
    const { stoppedBy: _s, ...noStop } = ok;
    expect(m.BulkAnalyzeResponse.safeParse(noStop).success, 'stoppedBy required').toBe(false);
    expect(m.BulkAnalyzeResponse.safeParse({ ...ok, failed: [{ claimId: U, claimNumber: 'CLM-1', code: 'analysis_input_invalid' }] }).success, 'reasonCode required').toBe(false);
    expect(m.BulkAnalyzeResponse.safeParse({ ...ok, failed: [{ ...ok.failed[0], reasonCode: 'other' }] }).success).toBe(false);
  });
  it('ClaimDetail requires analysisFailure (null or {lastFailedAt, reasonCode, failedAttempts >= 1})', async () => {
    const m = await load();
    const d = { ...claim(), status: 'AWAITING_ANALYSIS', invoiceDate: null };
    expect(m.ClaimDetail.safeParse({ ...d, analysisFailure: null }).success).toBe(true);
    expect(m.ClaimDetail.safeParse({ ...d, analysisFailure: { lastFailedAt: ISO, reasonCode: 'fuel_check', failedAttempts: 1 } }).success).toBe(true);
    expect(m.ClaimDetail.safeParse(d).success, 'required').toBe(false);
    expect(m.ClaimDetail.safeParse({ ...d, analysisFailure: { lastFailedAt: ISO, reasonCode: 'fuel_check', failedAttempts: 0 } }).success, 'failedAttempts >= 1').toBe(false);
    expect(m.ClaimDetail.safeParse({ ...d, analysisFailure: { lastFailedAt: ISO, reasonCode: 'nope', failedAttempts: 1 } }).success).toBe(false);
    expect(m.ClaimDetail.safeParse({ ...d, analysisFailure: { lastFailedAt: ISO, reasonCode: 'input_values', failedAttempts: 1.5 } }).success, 'integer').toBe(false);
    // C4.3: ClaimSummary (list items) is unchanged: the field is not required there
    expect(m.ClaimSummary.safeParse(claim()).success).toBe(true);
  });
  it('ChargeLinesResponse requires influence and stays strict', async () => {
    const m = await load();
    const base = { claimId: U, classifierVersion: 'charge-knn-v1', seedVersion: 'tariff-seed-v1', threshold: 0.3, lines: [] };
    expect(m.ChargeLinesResponse.safeParse({ ...base, influence: null }).success).toBe(true);
    expect(m.ChargeLinesResponse.safeParse({ ...base, influence: { labels: [] } }).success).toBe(true);
    expect(m.ChargeLinesResponse.safeParse({ ...base, influence: { labels: [{ labelId: U, description: 'Pallet jack rental', category: 'accessorial' }, { labelId: U, description: null, category: null }] } }).success).toBe(true);
    expect(m.ChargeLinesResponse.safeParse(base).success, 'influence required').toBe(false);
    expect(m.ChargeLinesResponse.safeParse({ ...base, influence: null, extra: 1 }).success, 'strict').toBe(false);
    expect(m.ChargeLinesResponse.safeParse({ ...base, influence: { labels: [{ labelId: 'x', description: null, category: null }] } }).success, 'labelId uuid').toBe(false);
  });
  it('OutlookSeries.provenance requires sourceKind in {fetch,bundled,file} and stays strict', async () => {
    const m = await load();
    const prov = { importId: U, sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW', retrievedAt: '2026-10-11', sha256: 'a'.repeat(64), rowCount: 1, firstDate: '2026-01-01', lastDate: '2026-01-02' };
    const shape = m.OutlookSeries.shape.provenance;
    for (const k of ['fetch', 'bundled', 'file']) expect(shape.safeParse({ ...prov, sourceKind: k }).success, k).toBe(true);
    expect(shape.safeParse(null).success).toBe(true);
    expect(shape.safeParse(prov).success, 'required').toBe(false);
    expect(shape.safeParse({ ...prov, sourceKind: 'web' }).success).toBe(false);
    expect(shape.safeParse({ ...prov, sourceKind: 'file', extra: 1 }).success, 'strict').toBe(false);
  });
});

describe('HD-S08 / HP-A01 shared audit-action list (C9, C15)', () => {
  it('ends with claim.analysis_failed, auth.password.change_failed, invite.existing_account and (REQ-20261020-claim-outcomes, amended) claim.outcome_recorded after the BASE list (unchanged, same order)', async () => {
    const m = await load();
    const a = [...m.AUDIT_ACTIONS] as string[];
    // the full BASE list (`git show bcc23bb:packages/shared/src/audit-actions.ts`), in order
    const BASE = ['auth.login.success', 'auth.login.failure', 'auth.lockout', 'auth.logout', 'auth.refresh_reuse_detected', 'auth.password.reset_requested', 'auth.password.reset_completed', 'auth.password.changed', 'auth.mfa.enrolled', 'auth.mfa.failure', 'auth.mfa.recovery_used', 'invite.created', 'invite.revoked', 'invite.accepted', 'user.role_changed', 'user.disabled', 'user.enabled', 'user.mfa_reset', 'claim.assigned', 'packet.viewed', 'packet.revision_created', 'approval.approved', 'approval.rejected', 'approval.send_ready', 'audit.verify', 'platform.cross_tenant_read', 'authz.denied', 'import.batch_created', 'import.document_received', 'import.document_rejected', 'import.document_parsed', 'import.document_downloaded', 'review.field_resolved', 'review.field_added', 'review.doctype_set', 'review.document_accepted', 'review.document_rejected', 'import.committed', 'claim.created_from_import', 'claim.documents_linked', 'export.started', 'export.completed', 'export.aborted', 'platform.dashboard_viewed', 'platform.logs_viewed', 'platform.flag_changed', 'eval.run_recorded', 'intelligence.viewed', 'apikey.created', 'apikey.revoked', 'apikey.use_denied', 'authz.four_eyes_denied', 'claim.analyzed', 'claim.bulk_analyzed', 'charge_label.set', 'charge_label.deleted', 'fsc_table.created', 'fsc_table.updated', 'fsc_table.archived', 'claim.fuel_inputs_set', 'claim.fuel_inputs_cleared', 'price_data.imported', 'dd_tariff.created', 'dd_tariff.updated', 'dd_calendar.created', 'dd_calendar.updated', 'dd_invoice.created', 'dd_invoice.updated', 'dd_invoice.deleted', 'dd_invoice.audited'];
    expect(a).toEqual([...BASE, 'claim.analysis_failed', 'auth.password.change_failed', 'invite.existing_account', 'claim.outcome_recorded']);
  });
});
