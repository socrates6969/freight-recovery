import { describe, expect, it } from 'vitest';

import { emptyBillOfLading, emptyInvoice, emptyRateConfirmation, type ExtractedBundle } from '../extraction.js';

import {
  ANALYSIS_NOTE,
  ANALYSIS_TEXT,
  ANALYZE_AUTHOR_NOTE,
  AnalysisInputError,
  DEFAULT_ANALYSIS_SETTINGS,
  DRAFT_BANNER,
  PACKET_DISCLAIMER,
  RULES_VERSION,
  RULE_IDS,
  applyRules,
  applyRulesTraced,
  buildDemandLetter,
  buildEvidence,
  classifyLine,
  computeDetention,
} from './index.js';

// Expected texts are the Python reference output (freight_recovery.rules / .evidence, CPython 3.14,
// 2026-10-10) on the same inputs; the full byte-level comparison runs in api/test/parity/rules.parity.test.ts.

function ld5001(): ExtractedBundle {
  return {
    invoice: {
      ...emptyInvoice(),
      invoice_number: 'INV-1001',
      carrier: 'Acme Freight LLC',
      shipper: 'Widget Co',
      load_number: 'LD-5001',
      invoice_date: '2025-03-10',
      lines: [
        { description: 'Linehaul', amount: '1500.00' },
        { description: 'Fuel Surcharge', amount: '168.00' },
        { description: 'Detention', amount: '300.00' },
        { description: 'Lumper', amount: '150.00' },
      ],
      total: '2118.00',
    },
    rate_confirmation: {
      ...emptyRateConfirmation(),
      load_number: 'LD-5001',
      carrier: 'Acme Freight LLC',
      linehaul_rate: '1400.00',
      fuel_surcharge: '168.00',
      detention_free_hours: '2',
      detention_rate_per_hour: '50.00',
      detention_max_hours: '8',
      authorized_accessorials: ['Detention'],
    },
    bol: {
      ...emptyBillOfLading(),
      load_number: 'LD-5001',
      facility: 'Widget Co DC 4',
      appointment_time: '2025-03-03T08:00:00',
      arrival_time: '2025-03-03T07:45:00',
      departure_time: '2025-03-03T11:30:00',
    },
    warnings: [],
  };
}

const rcDet = (x: Partial<ReturnType<typeof emptyRateConfirmation>> = {}) => ({ ...emptyRateConfirmation(), detention_free_hours: '2', detention_rate_per_hour: '50', detention_max_hours: '8', ...x });
const bolAt = (arrival: string, departure: string, appointment: string | null = null) => ({ ...emptyBillOfLading(), arrival_time: arrival, departure_time: departure, appointment_time: appointment });

describe('constants and copy', () => {
  it('exposes the contract constants', () => {
    expect(DEFAULT_ANALYSIS_SETTINGS).toEqual({ detentionIncrementMinutes: 15, amountTolerance: '0.01', disputeWindowDays: 90 });
    expect(RULES_VERSION).toBe('rules-v1');
    expect(RULE_IDS).toEqual(['INV-DUPLICATE', 'INV-LINEHAUL-RATE', 'INV-FUEL-SURCHARGE', 'INV-ACCESSORIAL-UNAUTH', 'INV-TOTAL-MISMATCH', 'DET-UNBILLED', 'DET-UNDERBILLED', 'DET-OVERBILLED']);
    expect(DRAFT_BANNER).toBe('DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.');
    expect(PACKET_DISCLAIMER).toBe(
      'MVP / pre-product output. Extracted values and calculations are unverified against real customer data and must be reviewed by a person before any dispute is sent. This is not legal or financial advice.',
    );
  });

  it('has the fixed UI copy (no accuracy claims)', () => {
    expect(ANALYSIS_NOTE).toBe('Runs fixed rules on the accepted document fields. Findings are drafts for human review, not verified results.');
    expect(ANALYZE_AUTHOR_NOTE).toBe('You will be recorded as the author of revision 1, so another approver must approve it.');
    expect(ANALYSIS_TEXT.bulkSummary(2, 1, 0, 5)).toBe('Analyzed 2. Skipped 1. Could not analyze 0. 5 still awaiting analysis.');
    expect(ANALYSIS_TEXT.conflict).toBe('This claim is no longer awaiting analysis or has no accepted documents. Reload to continue.');
    const texts: unknown[] = [ANALYSIS_NOTE, ANALYZE_AUTHOR_NOTE, ...Object.values(ANALYSIS_TEXT)];
    for (const v of texts.filter((x): x is string => typeof x === 'string')) expect(v.toLowerCase()).not.toMatch(/accura|guarantee/u);
  });
});

describe('classifyLine', () => {
  it('matches the reference categories (first match wins)', () => {
    const cases: [string, string][] = [
      ['Linehaul incl fuel', 'linehaul'],
      ['Linehaul including fuel surcharge', 'linehaul'],
      ['Fuel Surcharge', 'fuel'],
      ['FSC', 'other'],
      ['Fuel FSC', 'fuel'],
      ['Linehaul', 'linehaul'],
      ['Line haul', 'linehaul'],
      ['Detention - fuel stop', 'detention'],
      ['Stop-off', 'accessorial'],
      ['TONU', 'accessorial'],
      ['Misc', 'other'],
      ['', 'other'],
    ];
    for (const [desc, want] of cases) expect(classifyLine(desc)).toBe(want);
  });
});

describe('computeDetention', () => {
  it('starts at the appointment for early arrivals', () => {
    expect(computeDetention(bolAt('2025-03-03T07:45:00', '2025-03-03T11:30:00', '2025-03-03T08:00:00'), rcDet({ detention_rate_per_hour: '50.00' }))).toEqual({
      billable_hours: '1.5',
      amount: '75.00',
      steps: [
        'Arrived early; clock starts at appointment 2025-03-03 08:00.',
        'Departure 2025-03-03 11:30; dwell = 210 min (3.50 h).',
        'Less 2 h free time = 1.50 h over.',
        'Rounded down to 15-minute increments = 90 min (1.50 h).',
        '1.50 h x $50.00/h = $75.00.',
      ],
    });
  });

  it('caps at the contract maximum', () => {
    expect(computeDetention(bolAt('2025-03-04T06:00:00', '2025-03-04T22:00:00'), rcDet())).toEqual({
      billable_hours: '8',
      amount: '400.00',
      steps: [
        'Clock starts at arrival 2025-03-04 06:00.',
        'Departure 2025-03-04 22:00; dwell = 960 min (16.00 h).',
        'Less 2 h free time = 14.00 h over.',
        'Rounded down to 15-minute increments = 840 min (14.00 h).',
        'Capped at contract max of 8 h.',
        '8.00 h x $50/h = $400.00.',
      ],
    });
  });

  it('keeps 28-digit inexact hours and odd increments exactly as Python prints them', () => {
    expect(computeDetention(bolAt('2025-03-04T09:00:30', '2025-03-04T14:07:00'), { ...emptyRateConfirmation(), detention_free_hours: '1.333333', detention_rate_per_hour: '62.50' }, 7)).toEqual({
      billable_hours: '3.733333333333333333333333333',
      amount: '233.33',
      steps: [
        'Clock starts at arrival 2025-03-04 09:00.',
        'Departure 2025-03-04 14:07; dwell = 306 min (5.11 h).',
        'Less 1.333333 h free time = 3.78 h over.',
        'Rounded down to 7-minute increments = 224 min (3.73 h).',
        '3.73 h x $62.50/h = $233.33.',
      ],
    });
  });

  it('owes nothing when departure precedes arrival (floor division of a negative dwell)', () => {
    expect(computeDetention(bolAt('2025-03-04T09:00:00', '2025-03-04T03:00:00'), { ...emptyRateConfirmation(), detention_free_hours: '2', detention_rate_per_hour: '60' })).toEqual({
      billable_hours: '0',
      amount: '0.00',
      steps: ['Clock starts at arrival 2025-03-04 09:00.', 'Departure 2025-03-04 03:00; dwell = -360 min (-6.00 h).', 'Less 2 h free time = 0.00 h over.', 'No detention owed.'],
    });
  });

  it('returns null without required inputs and refuses bad increments and malformed values', () => {
    expect(computeDetention(emptyBillOfLading(), rcDet())).toBeNull();
    expect(computeDetention(bolAt('2025-03-04T09:00:00', '2025-03-04T14:00:00'), emptyRateConfirmation())).toBeNull();
    expect(() => computeDetention(bolAt('2025-03-04T09:00:00', '2025-03-04T14:00:00'), rcDet(), 0)).toThrow(AnalysisInputError);
    expect(() => computeDetention(bolAt('2025-03-04 09:00', '2025-03-04T14:00:00'), rcDet())).toThrow(AnalysisInputError);
    expect(() => computeDetention(bolAt('2025-03-04T09:00:00', '2025-03-04T14:00:00'), rcDet({ detention_rate_per_hour: '1e3' }))).toThrow(AnalysisInputError);
  });
});

describe('applyRules', () => {
  it('reproduces the LD-5001 shipper result', () => {
    const r = applyRules(ld5001(), 'shipper');
    expect(r.findings.map((f) => [f.rule_id, f.amount, f.needs_human_review])).toEqual([
      ['INV-LINEHAUL-RATE', '100.00', false],
      ['INV-ACCESSORIAL-UNAUTH', '150.00', true],
      ['DET-OVERBILLED', '225.00', false],
    ]);
    expect(r.findings[1]?.calculation).toEqual(["Authorized accessorials: ['Detention'].", "Charged: 'Lumper' = $150.00."]);
    expect([r.recoverable_total, r.pending_review_total, r.ignored_findings.length]).toEqual(['325.00', '150.00', 0]);
  });

  it('moves other-direction findings to ignored_findings for the carrier', () => {
    const r = applyRules(ld5001(), 'carrier');
    expect(r.findings).toEqual([]);
    expect([r.recoverable_total, r.pending_review_total, r.ignored_findings.length]).toEqual(['0.00', '0.00', 3]);
  });

  it('dedupes before the rate check and keeps exact-sum totals', () => {
    const b: ExtractedBundle = {
      invoice: { ...emptyInvoice(), lines: [{ description: 'Linehaul', amount: '1000' }, { description: ' linehaul ', amount: '1000.00' }], total: '2100' },
      rate_confirmation: { ...emptyRateConfirmation(), linehaul_rate: '1000' },
      bol: null,
      warnings: [],
    };
    const { result, traces } = applyRulesTraced(b, 'shipper');
    expect(result.findings.map((f) => [f.rule_id, f.amount])).toEqual([
      ['INV-DUPLICATE', '1000.00'],
      ['INV-TOTAL-MISMATCH', '100.00'],
    ]);
    expect(result.findings[1]?.calculation).toEqual(['$2100 - $2000.00 = $100.00.']);
    expect(traces.map((t) => [t.lines, t.total])).toEqual([
      [[0, 1], false],
      [[], true],
    ]);
    expect([result.recoverable_total, result.pending_review_total]).toEqual(['100.00', '1000.00']);
  });

  it('records detention trace facts (clock start, cap) for citations', () => {
    const { traces } = applyRulesTraced(ld5001(), 'shipper');
    expect(traces[2]).toEqual({ lines: [2], total: false, detention: { clockStartedAtAppointment: true, capApplied: false } });
  });

  it('refuses malformed input before any rule runs', () => {
    const bad = ld5001();
    if (bad.bol) bad.bol.departure_time = 'tomorrow';
    expect(() => applyRules(bad, 'shipper')).toThrow(AnalysisInputError);
    const bad2 = ld5001();
    if (bad2.invoice) bad2.invoice.total = 'NaN';
    expect(() => applyRules(bad2, 'shipper')).toThrow(AnalysisInputError);
    expect(() => applyRules(ld5001(), 'SHIPPER' as 'shipper')).toThrow(AnalysisInputError);
    expect(() => applyRules(ld5001(), 'shipper', { ...DEFAULT_ANALYSIS_SETTINGS, detentionIncrementMinutes: 241 })).toThrow(AnalysisInputError);
    expect(() => applyRules(ld5001(), 'shipper', { ...DEFAULT_ANALYSIS_SETTINGS, disputeWindowDays: 0 })).toThrow(AnalysisInputError);
  });
});

describe('letter and evidence', () => {
  it('builds the LD-5001 draft letter with confirmed findings only', () => {
    const b = ld5001();
    const letter = buildDemandLetter(b, applyRules(b, 'shipper'), '2025-03-15');
    expect(letter.split('\n').slice(0, 13)).toEqual([
      DRAFT_BANNER,
      '',
      'Date: 2025-03-15',
      'To: Acme Freight LLC',
      'From: Widget Co',
      'Re: Load LD-5001 / Invoice INV-1001 - billing dispute',
      '',
      'Our audit of the above invoice against the signed rate confirmation and delivery records found the following billing discrepancies:',
      '',
      '1. Linehaul billed above rate confirmation: $100.00',
      '   Invoice linehaul $1500.00 vs agreed $1400.00.',
      '2. Detention billed above supported amount: $225.00',
      '   Invoice billed $300.00 detention; gate times and rate-con terms support only $75.00.',
    ]);
    expect(letter).toContain('We request a credit or refund of $325.00 against invoice INV-1001 (load LD-5001).');
    expect(letter).not.toContain('Lumper');
  });

  it('requests no amount when nothing is confirmed, and sanitizes untrusted names', () => {
    const b: ExtractedBundle = { invoice: { ...emptyInvoice(), carrier: '<b>Evil`</b>', lines: [{ description: 'Lumper', amount: '150' }] }, rate_confirmation: emptyRateConfirmation(), bol: null, warnings: [] };
    const letter = buildDemandLetter(b, applyRules(b, 'shipper'), '2025-03-15', 30);
    expect(letter).toContain('No amount is requested: there are no confirmed findings.');
    expect(letter).toContain('To: bEvil/b');
    expect(letter).toContain('assumed 30 days');
    expect(letter).not.toContain('$150');
  });

  it('builds evidence with the UTC letter date and the first non-empty load number', () => {
    const b = ld5001();
    if (b.invoice) b.invoice.load_number = '';
    const ev = buildEvidence([{ filename: 'invoice.txt', doc_type: 'invoice', sha256: 'a'.repeat(64) }], b, 'shipper', DEFAULT_ANALYSIS_SETTINGS, new Date('2025-03-15T23:30:00-05:00'));
    expect(ev.load_number).toBe('LD-5001');
    expect(ev.demand_letter).toContain('Date: 2025-03-16');
    expect(ev.generated_at).toBe('2025-03-16T04:30:00.000Z');
    expect(ev.markdown.split('\n')[0]).toBe('# Evidence Packet - Load LD-5001');
    expect(ev.markdown).toContain('- `invoice.txt` (invoice) sha256 `' + 'a'.repeat(64) + '`');
    expect(ev.markdown).toContain('Rule `INV-ACCESSORIAL-UNAUTH`, confidence 0.60.');
    expect(ev.disclaimer).toBe(PACKET_DISCLAIMER);
  });
});
