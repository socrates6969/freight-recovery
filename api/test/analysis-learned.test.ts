/**
 * Step 6 learned layer inside buildAnalysisPacket (REQ-20261011-charge-intelligence, C4): LRN finding text,
 * citations and clause; DET review flags with extra steps and citations; totals; and the null-classifier
 * identity with the step-5 output (findings, totals, letter, citations).
 */
import { type ImportDocType } from '@fr/shared';
import { buildChargeClassifier, type ChargeClassifier, type ChargeSuggestion } from '@fr/shared/charge-intel';
import { describe, expect, it } from 'vitest';

import { buildAnalysisPacket, type AnalysisPacketBuild } from '../src/claims/analysis.js';
import { assembleBundleWithProvenance, type BundleDocument, type BundleField } from '../src/imports/bundle.js';

type F = [key: string, value: string | null, line: number | null, group?: number | null];

function doc(displayName: string, docType: ImportDocType, fields: F[]): BundleDocument {
  return {
    displayName,
    docType,
    warnings: [],
    fields: fields.map(([key, v, line, group]): BundleField => ({ key, groupIndex: group ?? null, effectiveValue: v, ref: { page: null, line, excerpt: `${key}: ${v ?? ''}` } })),
  };
}

/** LD-5001 style documents; `charges` are [description, amount] (line = 7 + index). */
function docs(charges: [string, string][]): BundleDocument[] {
  return [
    doc('bol.txt', 'BILL_OF_LADING', [
      ['bol.load_number', 'LD-6001', 2],
      ['bol.appointment_time', '2025-03-03T08:00:00', 4],
      ['bol.arrival_time', '2025-03-03T07:45:00', 5],
      ['bol.departure_time', '2025-03-03T11:30:00', 6],
    ]),
    doc('invoice.txt', 'INVOICE', [
      ['invoice.invoice_number', 'INV-6001', 2],
      ['invoice.carrier', 'Acme Freight LLC', 3],
      ['invoice.shipper', 'Widget Co', 4],
      ['invoice.invoice_date', '2025-03-10', 6],
      ...charges.flatMap(([d, a], i): F[] => [
        ['invoice.charge.description', d, 7 + i, i],
        ['invoice.charge.amount', a, 7 + i, i],
      ]),
    ]),
    doc('rate_confirmation.txt', 'RATE_CONFIRMATION', [
      ['rate_confirmation.linehaul_rate', '1500.00', 4],
      ['rate_confirmation.fuel_surcharge', '168.00', 5],
      ['rate_confirmation.detention_free_hours', '2', 6],
      ['rate_confirmation.detention_rate_per_hour', '50.00', 7],
      ['rate_confirmation.authorized_accessorials', '["Detention"]', 9],
    ]),
  ];
}

function input(d: BundleDocument[]) {
  const { bundle, provenance } = assembleBundleWithProvenance(d);
  return {
    bundle,
    provenance,
    sources: d.map((x, i) => ({ documentId: `00000000-0000-4000-8000-00000000000${i}`, displayName: x.displayName, sha256: String(i).repeat(64), docType: x.docType, sizeBytes: 100 + i })),
  };
}

const NOW = new Date('2026-10-11T12:00:00.000Z');
const ACTOR = '11111111-1111-4111-8111-111111111111';

/** A stub classifier: fixed suggestions by description, abstain otherwise. */
function stub(map: Record<string, ChargeSuggestion>): ChargeClassifier {
  return { classify: (d) => map[d] ?? { category: null, similarity: 0, abstained: true, reason: 'no_match', nearest: null } };
}
const seedSuggestion = (category: 'accessorial' | 'detention', text: string, similarity: number): ChargeSuggestion => ({
  category,
  similarity,
  abstained: false,
  reason: null,
  nearest: { text, category, origin: 'seed', source: 'xpo_2025', sourceLabel: 'XPO Tariff CNWY 199-AJ.4 (2025)', labelId: null },
});

/** Packet parts that do not depend on random ids. */
function stable(b: AnalysisPacketBuild) {
  const srcIndex = new Map(b.sources.map((s, i) => [s.id, i]));
  const cit = (c: { sourceId: string; locator: string; excerpt: string }) => ({ ...c, sourceId: srcIndex.get(c.sourceId) });
  return {
    letter: b.packet.demandLetter,
    recoverableCents: b.packet.recoverableCents,
    pendingReviewCents: b.packet.pendingReviewCents,
    findings: b.findings.map((f) => ({ ...f, citations: f.citations.map(cit), clauseSourceId: f.clauseSourceId === null ? null : srcIndex.get(f.clauseSourceId) })),
    timeline: b.timeline.map((t) => ({ ...t, sourceId: srcIndex.get(t.sourceId) })),
  };
}

const CHARGES: [string, string][] = [
  ['Linehaul', '1500.00'],
  ['Fuel Surcharge', '168.00'],
  ['Pallet exchange', '75.00'],
  ['Waiting time', '40.00'],
];

describe('learned layer in buildAnalysisPacket', () => {
  it('null / absent classifier: identical to step 5; a classifier with no effect changes nothing either', () => {
    const inp = input(docs(CHARGES));
    const base = buildAnalysisPacket({ input: inp, claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    const off = buildAnalysisPacket({ input: inp, claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR, classifier: null });
    const none = buildAnalysisPacket({ input: inp, claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR, classifier: stub({}) });
    expect(stable(off)).toEqual(stable(base));
    expect(stable(none)).toEqual(stable(base));
    expect([base.summary.learnedFindingsCount, base.summary.reviewFlagsCount]).toEqual([0, 0]);
  });

  it('LRN-ACCESSORIAL-REVIEW: exact texts, line citation, clause, pending total, not in the letter', () => {
    const inp = input(docs(CHARGES));
    const base = buildAnalysisPacket({ input: inp, claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    const b = buildAnalysisPacket({
      input: inp,
      claim: { perspective: 'SHIPPER' },
      now: NOW,
      actorId: ACTOR,
      classifier: stub({ 'Pallet exchange': seedSuggestion('accessorial', 'PALLET EXCHANGE', 0.812) }),
    });
    const lrn = b.findings.at(-1);
    expect(lrn).toMatchObject({
      ruleId: 'LRN-ACCESSORIAL-REVIEW',
      title: 'Possible unauthorized accessorial (suggestion)',
      direction: 'OVERCHARGE',
      amountCents: 7500,
      confidence: 0.5,
      needsHumanReview: true,
      explanation:
        "'Pallet exchange' ($75.00) is not recognised by the fixed rules. Its nearest labelled example is 'PALLET EXCHANGE' (public tariff example, XPO Tariff CNWY 199-AJ.4 (2025)), labelled accessorial, and it is not listed as authorized on the rate confirmation. Suggestion only - verify before disputing.",
      calculation: [
        "Nearest labelled example: 'PALLET EXCHANGE' (public tariff example, XPO Tariff CNWY 199-AJ.4 (2025)) = accessorial, similarity 0.812.",
        'A suggestion needs similarity of at least 0.30.',
        "Authorized accessorials: ['Detention'].",
        "Charged: 'Pallet exchange' = $75.00.",
      ],
      clauseLabel: 'Authorized accessorials',
    });
    expect(lrn?.citations.map((c) => c.locator)).toEqual(['invoice.txt:L9']);
    expect(b.findings.slice(0, -1).map((f) => f.ruleId)).toEqual(base.findings.map((f) => f.ruleId));
    expect(b.packet.pendingReviewCents).toBe(base.packet.pendingReviewCents + 7500);
    expect(b.packet.recoverableCents).toBe(base.packet.recoverableCents);
    expect(b.packet.demandLetter).toBe(base.packet.demandLetter);
    expect(b.summary).toMatchObject({ learnedFindingsCount: 1, reviewFlagsCount: 0, findingsCount: base.summary.findingsCount + 1 });
    expect(b.packet.contentHash).not.toBe(base.packet.contentHash);
  });

  it('carrier perspective: LRN is other-direction (ignored, not stored)', () => {
    const inp = input(docs(CHARGES));
    const b = buildAnalysisPacket({
      input: inp,
      claim: { perspective: 'CARRIER' },
      now: NOW,
      actorId: ACTOR,
      classifier: stub({ 'Pallet exchange': seedSuggestion('accessorial', 'PALLET EXCHANGE', 0.812) }),
    });
    const base = buildAnalysisPacket({ input: inp, claim: { perspective: 'CARRIER' }, now: NOW, actorId: ACTOR });
    expect(b.findings.map((f) => f.ruleId)).not.toContain('LRN-ACCESSORIAL-REVIEW');
    expect(b.summary.ignoredFindingsCount).toBe(base.summary.ignoredFindingsCount + 1);
    expect(b.summary.learnedFindingsCount).toBe(0);
  });

  it('a line equal to the contracted linehaul or fuel amount, or an authorized one, is never an LRN finding', () => {
    const inp = input(docs([['Freight charges', '1500.00'], ['Fuel', '168.00'], ['Detention pay', '10.00'], ['Misc', '168.00']]));
    const s = seedSuggestion('accessorial', 'HEAVY LIFT CHARGES', 0.445);
    const b = buildAnalysisPacket({ input: inp, claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR, classifier: stub({ 'Freight charges': s, Misc: s }) });
    expect(b.summary.learnedFindingsCount).toBe(0);
  });

  it('detention look-alike: DET-UNBILLED switches to review with an extra step and the look-alike citation', () => {
    const inp = input(docs(CHARGES));
    const base = buildAnalysisPacket({ input: inp, claim: { perspective: 'CARRIER' }, now: NOW, actorId: ACTOR });
    const det = base.findings.find((f) => f.ruleId === 'DET-UNBILLED');
    expect(det?.needsHumanReview).toBe(false);
    const b = buildAnalysisPacket({
      input: inp,
      claim: { perspective: 'CARRIER' },
      now: NOW,
      actorId: ACTOR,
      classifier: stub({ 'Waiting time': seedSuggestion('detention', 'WAITING TIME', 0.5) }),
    });
    const flagged = b.findings.find((f) => f.ruleId === 'DET-UNBILLED');
    expect(flagged).toMatchObject({ title: det?.title, explanation: det?.explanation, amountCents: det?.amountCents, confidence: det?.confidence, needsHumanReview: true });
    expect(flagged?.calculation).toEqual([
      ...(det?.calculation ?? []),
      "Possible detention billed under another name: 'Waiting time' = $40.00 (nearest labelled example 'WAITING TIME', public tariff example, XPO Tariff CNWY 199-AJ.4 (2025), similarity 0.500). Confirm before claiming.",
    ]);
    expect(flagged?.citations.map((c) => c.locator)).toEqual([...(det?.citations.map((c) => c.locator) ?? []), 'invoice.txt:L10']);
    expect(b.packet.recoverableCents).toBe(base.packet.recoverableCents - (det?.amountCents ?? 0));
    expect(b.packet.pendingReviewCents).toBe(base.packet.pendingReviewCents + (det?.amountCents ?? 0));
    expect(b.summary).toMatchObject({ reviewFlagsCount: 1, learnedFindingsCount: 0 });
    expect(b.packet.demandLetter).not.toContain('Detention earned but not billed');
  });

  it('the real classifier leaves keyword-classified lines alone (parity-unchanged)', () => {
    const inp = input(docs([['Linehaul', '1500.00'], ['Fuel Surcharge', '168.00'], ['Lumper', '150.00'], ['Detention', '300.00']]));
    const base = buildAnalysisPacket({ input: inp, claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR });
    const b = buildAnalysisPacket({ input: inp, claim: { perspective: 'SHIPPER' }, now: NOW, actorId: ACTOR, classifier: buildChargeClassifier([]) });
    expect(stable(b)).toEqual(stable(base));
  });
});
