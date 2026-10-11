import { describe, expect, it } from 'vitest';

import { DEFAULT_ANALYSIS_SETTINGS, applyRulesTraced, buildEvidence, buildEvidenceTraced } from '../analysis/index.js';
import type { ExtractedBundle } from '../extraction.js';

import { applyLearning, buildChargeClassifier, buildEvidenceLearned } from './index.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');

function bundle(lines: [string, string][], rc = true): ExtractedBundle {
  return {
    invoice: { invoice_number: 'INV-1', carrier: 'Acme', shipper: 'Widget', load_number: 'LD-1', invoice_date: '2025-03-10', lines: lines.map(([description, amount]) => ({ description, amount })), total: null, extraction_warnings: [] },
    rate_confirmation: rc
      ? {
          load_number: 'LD-1',
          carrier: 'Acme',
          linehaul_rate: '1500.00',
          fuel_surcharge: '168.00',
          detention_free_hours: '2',
          detention_rate_per_hour: '50.00',
          detention_max_hours: null,
          authorized_accessorials: ['Detention'],
          extraction_warnings: [],
        }
      : null,
    bol: { load_number: 'LD-1', facility: null, appointment_time: '2025-03-03T08:00:00', arrival_time: '2025-03-03T07:45:00', departure_time: '2025-03-03T11:30:00', extraction_warnings: [] },
    warnings: [],
  };
}

describe('buildEvidenceLearned', () => {
  it('with a null classifier equals buildEvidenceTraced / buildEvidence exactly', () => {
    for (const b of [bundle([['Linehaul', '1500.00'], ['Liftgate', '75.00'], ['Pallet exchange', '20.00']]), bundle([['Waiting time', '40.00']], false)]) {
      for (const persp of ['shipper', 'carrier'] as const) {
        const l = buildEvidenceLearned([], b, persp, DEFAULT_ANALYSIS_SETTINGS, NOW, null);
        const t = buildEvidenceTraced([], b, persp, DEFAULT_ANALYSIS_SETTINGS, NOW);
        expect(l.evidence).toEqual(t.evidence);
        expect(l.evidence).toEqual(buildEvidence([], b, persp, DEFAULT_ANALYSIS_SETTINGS, NOW));
        expect(l.traces).toEqual(t.traces);
        expect([l.learnedFindingsCount, l.reviewFlagsCount]).toEqual([0, 0]);
      }
    }
  });

  it('adds review-only LRN findings for unrecognised accessorial-like lines (shipper); letter unchanged', () => {
    const b = bundle([['Linehaul', '1500.00'], ['Pallet exchange', '20.00'], ['Pallet exchange', '20.00']]);
    const c = buildChargeClassifier([{ id: 'l1', description: 'Pallet exchange', category: 'accessorial' }]);
    const l = buildEvidenceLearned([], b, 'shipper', DEFAULT_ANALYSIS_SETTINGS, NOW, c);
    const t = buildEvidenceTraced([], b, 'shipper', DEFAULT_ANALYSIS_SETTINGS, NOW);
    const lrn = l.evidence.result.findings.filter((f) => f.rule_id === 'LRN-ACCESSORIAL-REVIEW');
    // Unique lines only: the repeat is INV-DUPLICATE's business.
    expect(lrn).toHaveLength(1);
    expect(lrn[0]).toMatchObject({ amount: '20.00', confidence: 0.5, needs_human_review: true, direction: 'overcharge' });
    expect(lrn[0]?.explanation).toContain("(your team's label)");
    expect(l.evidence.demand_letter).toBe(t.evidence.demand_letter);
    expect(l.evidence.result.recoverable_total).toBe(t.evidence.result.recoverable_total);
    expect(l.learnedFindingsCount).toBe(1);
    // Fix round 1 (S3): the tenant label that drove the finding is reported once.
    expect(l.labelIds).toEqual(['l1']);
    expect(l.traces.at(-1)).toEqual({ lines: [1], total: false, detention: null });
    expect(l.evidence.markdown).toContain('LRN-ACCESSORIAL-REVIEW');
  });

  it('applyLearning: null classify or no invoice -> unchanged; zero-amount lines are skipped', () => {
    const b = bundle([['Pallet exchange', '0.00']]);
    const traced = applyRulesTraced(b, 'shipper');
    expect(applyLearning(b, traced, 'shipper', null).result).toBe(traced.result);
    const c = buildChargeClassifier([{ id: 'l1', description: 'Pallet exchange', category: 'accessorial' }]);
    expect(applyLearning(b, traced, 'shipper', (d) => c.classify(d)).learnedFindingsCount).toBe(0);
    const noInv = { ...b, invoice: null };
    const t2 = applyRulesTraced(noInv, 'shipper');
    expect(applyLearning(noInv, t2, 'shipper', (d) => c.classify(d)).result).toBe(t2.result);
  });
});
