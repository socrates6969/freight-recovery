/* eslint-disable */
// REQ-20261010-step5-analysis shared engine: AN-E01..AN-E46, AN-R06 and the shared contract pieces of P2/P4/P7/P10
// (test-spec T3, T7; Part C P2, P4, P6, P7, P10). Black-box over the public exports of @fr/shared.
// Expected strings come from running the Python reference (freight_recovery.rules / evidence).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXPECTED, ROLES } from './helpers/oracle.js';

let S: any;
beforeAll(async () => { S = await import('@fr/shared'); });

const SEED = resolve(__dirname, '..', '..', '..', 'api', 'prisma', 'seed-data');
const seedLetter = (f: string): string => JSON.parse(readFileSync(resolve(SEED, f), 'utf8')).demandLetter;

const rc = (o: any = {}) => ({ ...S.emptyRateConfirmation(), ...o });
const bol = (o: any = {}) => ({ ...S.emptyBillOfLading(), ...o });
const inv = (lines: [string, string][] = [], o: any = {}) => ({ ...S.emptyInvoice(), lines: lines.map(([description, amount]) => ({ description, amount })), ...o });
const bundle = (o: any = {}) => ({ invoice: o.invoice ?? null, rate_confirmation: o.rate_confirmation ?? null, bol: o.bol ?? null, warnings: [] });
const settings = (inc = 15) => ({ detentionIncrementMinutes: inc, amountTolerance: '0.01', disputeWindowDays: 90 });
const T0 = Date.UTC(2025, 0, 1, 8, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const onSite = (min: number, appt: string | null = null) => bol({ arrival_time: iso(T0), departure_time: iso(T0 + min * 60000), appointment_time: appt });
const rc60 = (o: any = {}) => rc({ detention_free_hours: '2', detention_rate_per_hour: '60', ...o });
const rc50 = (o: any = {}) => rc({ detention_free_hours: '2', detention_rate_per_hour: '50', detention_max_hours: '8', ...o });
const allFindings: any[] = [];
const run = (b: any, p: 'shipper' | 'carrier' = 'shipper', st = settings()) => {
  const r = S.applyRules(b, p, st);
  allFindings.push(...r.findings, ...r.ignored_findings);
  return r;
};
const ids = (r: any) => r.findings.map((f: any) => f.rule_id);
const cents = (d: string) => { const m = /^(-?)(\d+)\.(\d{2})$/.exec(String(d)); if (!m) throw new Error(`not 2-place: ${d}`); const v = Number(m[2]) * 100 + Number(m[3]); return m[1] ? -v : v; };

export const LD5001 = () => bundle({
  invoice: inv([['Linehaul', '1500.00'], ['Fuel Surcharge', '168.00'], ['Detention', '300.00'], ['Lumper', '150.00']], { invoice_number: 'INV-1001', load_number: 'LD-5001', carrier: 'Acme Freight LLC', shipper: 'Widget Co', invoice_date: '2025-03-10', total: '2118.00' }),
  rate_confirmation: rc({ load_number: 'LD-5001', carrier: 'Acme Freight LLC', linehaul_rate: '1400.00', fuel_surcharge: '168.00', detention_free_hours: '2', detention_rate_per_hour: '50.00', detention_max_hours: '8', authorized_accessorials: ['Detention'] }),
  bol: bol({ load_number: 'LD-5001', facility: 'Widget Co DC 4', appointment_time: '2025-03-03T08:00:00', arrival_time: '2025-03-03T07:45:00', departure_time: '2025-03-03T11:30:00' }),
});
const LD5002 = () => bundle({
  invoice: inv([['Linehaul', '1400.00'], ['Fuel Surcharge', '168.00']], { invoice_number: 'INV-2002', load_number: 'LD-5002', carrier: 'Acme Freight LLC', shipper: 'Widget Co', invoice_date: '2025-03-12', total: '1568.00' }),
  rate_confirmation: rc({ load_number: 'LD-5002', carrier: 'Acme Freight LLC', linehaul_rate: '1400.00', fuel_surcharge: '168.00', detention_free_hours: '2', detention_rate_per_hour: '50.00', detention_max_hours: '8', authorized_accessorials: ['Detention'] }),
  bol: bol({ load_number: 'LD-5002', facility: 'Widget Co DC 4', appointment_time: '2025-03-04T09:00:00', arrival_time: '2025-03-04T09:00:00', departure_time: '2025-03-04T14:20:00' }),
});

describe('AN-E01..E16 computeDetention', () => {
  it('AN-E01 early arrival starts at the appointment', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-03-03T07:45:00', departure_time: '2025-03-03T11:30:00', appointment_time: '2025-03-03T08:00:00' }), rc50(), 15);
    expect(String(c.billable_hours)).toBe('1.5');
    expect(c.amount).toBe('75.00');
    expect(c.steps[0]).toBe('Arrived early; clock starts at appointment 2025-03-03 08:00.');
  });
  it('AN-E02 rounds down to 15 minutes', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-03-04T09:00:00', departure_time: '2025-03-04T14:20:00' }), rc50(), 15);
    expect([String(c.billable_hours), c.amount]).toEqual(['3.25', '162.50']);
  });
  it('AN-E03 within free time', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-03-04T09:00:00', departure_time: '2025-03-04T10:30:00' }), rc50(), 15);
    expect([String(c.billable_hours), c.amount, c.steps.at(-1)]).toEqual(['0', '0.00', 'No detention owed.']);
  });
  it('AN-E04 capped at contract max', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-03-04T06:00:00', departure_time: '2025-03-04T22:00:00' }), rc50(), 15);
    expect([String(c.billable_hours), c.amount]).toEqual(['8', '400.00']);
  });
  it('AN-E05 missing inputs -> null', () => {
    expect(S.computeDetention(bol(), rc50(), 15)).toBeNull();
    expect(S.computeDetention(bol({ arrival_time: '2025-03-04T09:00:00', departure_time: '2025-03-04T14:00:00' }), rc(), 15)).toBeNull();
    expect(S.computeDetention(bol({ arrival_time: '2025-03-04T09:00:00', departure_time: '2025-03-04T14:00:00' }), rc({ detention_free_hours: '2' }), 15)).toBeNull();
    expect(S.computeDetention(bol({ arrival_time: '2025-03-04T09:00:00' }), rc50(), 15)).toBeNull();
  });
  const rc25 = () => rc({ detention_free_hours: '2.5', detention_rate_per_hour: '50', detention_max_hours: '8.0' });
  it('AN-E06 exact steps, exponent kept', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-03-03T07:45:00', departure_time: '2025-03-03T11:30:00' }), rc25(), 15);
    expect(c.steps).toEqual(['Clock starts at arrival 2025-03-03 07:45.', 'Departure 2025-03-03 11:30; dwell = 225 min (3.75 h).', 'Less 2.5 h free time = 1.25 h over.', 'Rounded down to 15-minute increments = 75 min (1.25 h).', '1.25 h x $50/h = $62.50.']);
    expect([String(c.billable_hours), c.amount]).toEqual(['1.25', '62.50']);
  });
  it('AN-E07 seconds, cap and "8.0"', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-03-03T06:00:00', departure_time: '2025-03-03T22:00:30' }), rc25(), 15);
    expect(c.steps).toEqual(['Clock starts at arrival 2025-03-03 06:00.', 'Departure 2025-03-03 22:00; dwell = 960 min (16.01 h).', 'Less 2.5 h free time = 13.51 h over.', 'Rounded down to 15-minute increments = 810 min (13.50 h).', 'Capped at contract max of 8.0 h.', '8.00 h x $50/h = $400.00.']);
    expect([String(c.billable_hours), c.amount]).toEqual(['8.0', '400.00']);
  });
  it('AN-E08 negative dwell', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-03-03T08:00:00', departure_time: '2025-03-03T07:58:30' }), rc25(), 15);
    expect(c.steps).toEqual(['Clock starts at arrival 2025-03-03 08:00.', 'Departure 2025-03-03 07:58; dwell = -2 min (-0.02 h).', 'Less 2.5 h free time = 0.00 h over.', 'No detention owed.']);
    expect([String(c.billable_hours), c.amount]).toEqual(['0', '0.00']);
  });
  it('AN-E09 inexact quotient to 28 significant digits; increment 7', () => {
    const c = S.computeDetention(bol({ arrival_time: '2025-01-01T08:00:00', departure_time: '2025-01-01T10:35:00' }), rc({ detention_free_hours: '2', detention_rate_per_hour: '33.333333' }), 7);
    expect(String(c.billable_hours)).toBe('0.5833333333333333333333333333');
    expect(c.amount).toBe('19.44');
    expect(c.steps).toEqual(['Clock starts at arrival 2025-01-01 08:00.', 'Departure 2025-01-01 10:35; dwell = 155 min (2.58 h).', 'Less 2 h free time = 0.58 h over.', 'Rounded down to 7-minute increments = 35 min (0.58 h).', '0.58 h x $33.333333/h = $19.44.']);
  });
  it('AN-E10 exactly one increment over free time is billed', () => {
    for (const inc of [1, 5, 6, 7, 10, 12, 15, 20, 30, 45, 60]) expect(S.computeDetention(onSite(120 + inc), rc60(), inc).amount, `inc ${inc}`).toBe(`${inc}.00`);
  });
  it('AN-E11 just under one increment', () => {
    expect(S.computeDetention(onSite(139), rc60(), 20).amount).toBe('0.00');
  });
  it('AN-E12 invariant grid', () => {
    let n = 0;
    for (const inc of [6, 7, 10, 15, 20, 25, 30]) for (let on = 100; on < 400; on += 7) {
      const m = Number(S.computeDetention(onSite(on), rc60(), inc).amount);
      const over = Math.max(on - 120, 0);
      expect(m <= over && m % inc === 0 && over - m < inc, `inc ${inc} on ${on}: ${m}`).toBe(true);
      n++;
    }
    expect(n).toBe(7 * 43);
  });
  it('AN-E13 increment 0 -> AnalysisInputError', () => {
    expect(() => S.computeDetention(onSite(200), rc60(), 0)).toThrow(S.AnalysisInputError);
    expect(() => S.applyRules(bundle({ rate_confirmation: rc60(), bol: onSite(200) }), 'shipper', settings(0))).toThrow(S.AnalysisInputError);
  });
  it('AN-E14 max 0 caps to zero', () => {
    expect(S.computeDetention(onSite(400), rc60({ detention_max_hours: '0' }), 15).amount).toBe('0.00');
  });
  it('AN-E15 departure before arrival', () => {
    expect(S.computeDetention(bol({ arrival_time: iso(T0), departure_time: iso(T0 - 6 * 3600000) }), rc60(), 15).amount).toBe('0.00');
  });
  it('AN-E16 malformed inputs -> AnalysisInputError only', () => {
    const only = (fn: () => unknown, label: string) => {
      let err: unknown = null;
      try { fn(); } catch (e) { err = e; }
      expect(err, `${label} throws`).toBeTruthy();
      expect(err instanceof S.AnalysisInputError, `${label}: ${String(err)}`).toBe(true);
    };
    for (const a of ['1e3', 'NaN', '1,000']) {
      only(() => S.computeDetention(onSite(300), rc60({ detention_rate_per_hour: a }), 15), `rate ${a}`);
      only(() => S.applyRules(bundle({ invoice: inv([['Linehaul', a]]) }), 'shipper', settings()), `line ${a}`);
      only(() => S.applyRules(bundle({ invoice: inv([['Linehaul', '1']], { total: a }) }), 'shipper', settings()), `total ${a}`);
    }
    for (const t of ['2025-03-03 08:00', '2025-02-30T08:00:00', '2025-03-03T08:00:00Z']) {
      only(() => S.computeDetention(bol({ arrival_time: t, departure_time: '2025-03-03T12:00:00' }), rc60(), 15), `time ${t}`);
      only(() => S.applyRules(bundle({ rate_confirmation: rc60(), bol: bol({ arrival_time: '2025-03-03T07:00:00', departure_time: t }) }), 'carrier', settings()), `rules time ${t}`);
    }
  });
});

describe('AN-E20..E36 applyRules', () => {
  it('AN-E20 ld5001 shipper', () => {
    const r = run(LD5001(), 'shipper');
    expect(r.findings.map((f: any) => [f.rule_id, f.amount, f.calculation, f.confidence, f.needs_human_review])).toEqual([
      ['INV-LINEHAUL-RATE', '100.00', ['$1500.00 - $1400.00 = $100.00.'], 0.95, false],
      ['INV-ACCESSORIAL-UNAUTH', '150.00', ["Authorized accessorials: ['Detention'].", "Charged: 'Lumper' = $150.00."], 0.6, true],
      ['DET-OVERBILLED', '225.00', ['Arrived early; clock starts at appointment 2025-03-03 08:00.', 'Departure 2025-03-03 11:30; dwell = 210 min (3.50 h).', 'Less 2 h free time = 1.50 h over.', 'Rounded down to 15-minute increments = 90 min (1.50 h).', '1.50 h x $50.00/h = $75.00.', 'Invoiced detention = $300.00; earned = $75.00.'], 0.85, false],
    ]);
    expect(r.findings[2].explanation).toBe('Invoice billed $300.00 detention; gate times and rate-con terms support only $75.00.');
    expect(r.findings.every((f: any) => f.direction === 'overcharge')).toBe(true);
    expect([r.perspective, r.recoverable_total, r.pending_review_total, r.ignored_findings]).toEqual(['shipper', '325.00', '150.00', []]);
  });
  it('AN-E21 ld5001 carrier', () => {
    const r = run(LD5001(), 'carrier');
    expect([r.findings, r.recoverable_total, r.pending_review_total, r.ignored_findings.length]).toEqual([[], '0.00', '0.00', 3]);
  });
  it('AN-E22 ld5002 carrier', () => {
    const r = run(LD5002(), 'carrier');
    expect(r.findings).toEqual([{
      rule_id: 'DET-UNBILLED', title: 'Detention earned but not billed', direction: 'underbilled', amount: '162.50',
      explanation: 'Gate times and rate-con terms support $162.50 of detention; $0 was billed.',
      calculation: ['Clock starts at arrival 2025-03-04 09:00.', 'Departure 2025-03-04 14:20; dwell = 320 min (5.33 h).', 'Less 2 h free time = 3.33 h over.', 'Rounded down to 15-minute increments = 195 min (3.25 h).', '3.25 h x $50.00/h = $162.50.', 'Invoiced detention = $0; earned = $162.50.'],
      confidence: 0.85, needs_human_review: false,
    }]);
    expect(r.recoverable_total).toBe('162.50');
  });
  it('AN-E23 duplicate + total mismatch', () => {
    const r = run(bundle({ invoice: inv([['Linehaul', '1000'], ['Linehaul', '1000']], { total: '2100' }), rate_confirmation: rc({ linehaul_rate: '1000' }) }));
    expect([...ids(r)].sort()).toEqual(['INV-DUPLICATE', 'INV-TOTAL-MISMATCH']);
    expect([r.recoverable_total, r.pending_review_total]).toEqual(['100.00', '1000.00']);
  });
  it('AN-E24 clean invoice', () => {
    const r = run(bundle({ invoice: inv([['Linehaul', '1400']], { total: '1400' }), rate_confirmation: rc({ linehaul_rate: '1400' }) }));
    expect([r.findings, r.recoverable_total]).toEqual([[], '0.00']);
  });
  it('AN-E25 empty bundle', () => {
    const r = run(bundle());
    expect([r.findings, r.recoverable_total, r.pending_review_total]).toEqual([[], '0.00', '0.00']);
  });
  it('AN-E26 duplicate detention lines not double counted', () => {
    const r = run(bundle({ invoice: inv([['Detention', '60'], ['Detention', '60']], { total: '120' }), rate_confirmation: rc60(), bol: onSite(180) }));
    expect(r.findings.map((f: any) => [f.rule_id, f.amount])).toEqual([['INV-DUPLICATE', '60.00']]);
    expect(cents(r.recoverable_total) + cents(r.pending_review_total)).toBeLessThanOrEqual(6000);
  });
  it('AN-E27 identical legitimate lines need review', () => {
    const r = run(bundle({ invoice: inv([['Lumper', '100'], ['Lumper', '100']]), rate_confirmation: rc({ authorized_accessorials: ['lumper'] }) }));
    const dup = r.findings.filter((f: any) => f.rule_id === 'INV-DUPLICATE');
    expect(dup).toHaveLength(1);
    expect([dup[0].needs_human_review, dup[0].confidence]).toEqual([true, 0.6]);
    expect(r.recoverable_total).toBe('0.00');
  });
  it('AN-E28 linehaul incl fuel is not fuel', () => {
    expect(run(bundle({ invoice: inv([['Linehaul incl fuel', '1000'], ['Fuel Surcharge', '100']]), rate_confirmation: rc({ linehaul_rate: '1000', fuel_surcharge: '100' }) })).findings).toEqual([]);
  });
  it('AN-E29 classifyLine', () => {
    const exp: [string, string][] = [['Linehaul incl fuel', 'linehaul'], ['Linehaul including fuel surcharge', 'linehaul'], ['Fuel Surcharge', 'fuel'], ['FSC', 'other'], ['Linehaul', 'linehaul'], ['Detention - fuel stop', 'detention'], ['Stop-off', 'accessorial'], ['Misc', 'other']];
    for (const [d, c] of exp) expect(S.classifyLine(d), d).toBe(c);
  });
  it('AN-E30 hyphen vs space authorisation', () => {
    expect(run(bundle({ invoice: inv([['Stop-off', '75']]), rate_confirmation: rc({ authorized_accessorials: ['stop off'] }) })).findings).toEqual([]);
  });
  it('AN-E31 blank authorised entry authorises nothing', () => {
    expect(ids(run(bundle({ invoice: inv([['Lumper fee', '100']]), rate_confirmation: rc({ authorized_accessorials: [''] }) })))).toEqual(['INV-ACCESSORIAL-UNAUTH']);
  });
  it('AN-E32 repr, exponents and half-even in findings', () => {
    const r = run(bundle({ invoice: inv([['Lumper', '100'], [' lumper ', '100.00'], ['Misc', '1.005'], ['Misc', '1.005']], { total: '300' }), rate_confirmation: rc({ authorized_accessorials: ["Driver's assist", 'a b', ''] }) }));
    expect(r.findings.map((f: any) => [f.rule_id, f.amount, f.calculation])).toEqual([
      ['INV-DUPLICATE', '100.00', ["Repeat of identical line ' lumper ' = $100.00."]],
      ['INV-DUPLICATE', '1.00', ["Repeat of identical line 'Misc' = $1.005."]],
      ['INV-ACCESSORIAL-UNAUTH', '100.00', ['Authorized accessorials: ["Driver\'s assist", \'a\\xa0b\', \'\'].', "Charged: 'Lumper' = $100."]],
      ['INV-TOTAL-MISMATCH', '97.99', ['$300 - $202.010 = $97.990.']],
    ]);
    expect(r.findings[2].explanation.startsWith("'Lumper' ($100) is not listed")).toBe(true);
    expect(r.findings[3].explanation).toBe('Stated total $300 vs line items $202.010.');
    expect([r.recoverable_total, r.pending_review_total]).toEqual(['97.99', '201.00']);
  });
  it('AN-E33 half-even quantize', () => {
    const r = run(bundle({ invoice: inv([['X', '1.015'], ['X', '1.015'], ['X', '1.025'], ['X', '1.025']]) }));
    expect(r.findings.filter((f: any) => f.rule_id === 'INV-DUPLICATE').map((f: any) => f.amount)).toEqual(['1.02', '1.02']);
  });
  it('AN-E34 invariant grid (6 x 6 x 4)', () => {
    const LINES: [string, string][][] = [[], [['Linehaul', '1000']], [['Linehaul', '1500'], ['Fuel Surcharge', '300']], [['Detention', '60'], ['Detention', '60']], [['Detention', '300'], ['Lumper', '150'], ['Lumper', '150']], [['Linehaul incl fuel', '1000'], ['Fuel Surcharge', '100'], ['Stop-off', '75']]];
    let n = 0;
    for (const lines of LINES) for (const total of [null, '0', '500', '1000', '2500', '99999']) for (const b of [null, 100, 180, 900]) {
      const r = run(bundle({ invoice: inv(lines, { total }), rate_confirmation: rc60({ linehaul_rate: '1000', fuel_surcharge: '100', authorized_accessorials: ['detention'] }), bol: b === null ? null : onSite(b) }));
      const lineSum = lines.reduce((s, [, a]) => s + Number(a) * 100, 0);
      const ceiling = Math.max(lineSum, total === null ? 0 : Number(total) * 100);
      const rec = cents(r.recoverable_total), pend = cents(r.pending_review_total);
      const label = `${JSON.stringify(lines)} ${total} ${b}`;
      expect(rec + pend, label).toBeLessThanOrEqual(ceiling);
      expect(rec, label).toBe(r.findings.filter((f: any) => !f.needs_human_review).reduce((s: number, f: any) => s + cents(f.amount), 0));
      expect(pend, label).toBe(r.findings.filter((f: any) => f.needs_human_review).reduce((s: number, f: any) => s + cents(f.amount), 0));
      expect(r.findings.every((f: any) => f.direction === 'overcharge'), label).toBe(true);
      expect(rec).toBeGreaterThanOrEqual(0);
      n++;
    }
    expect(n).toBe(144);
  });
  it('AN-E35 carrier total never counts review items', () => {
    const r = run(bundle({ invoice: inv([['Detention', '50']]), rate_confirmation: rc60(), bol: onSite(260) }), 'carrier');
    expect(cents(r.recoverable_total)).toBe(r.findings.filter((f: any) => !f.needs_human_review).reduce((s: number, f: any) => s + cents(f.amount), 0));
    expect(ids(r)).toEqual(['DET-UNDERBILLED']);
  });
  it('AN-E36 every rule_id is non-empty and in RULE_IDS', () => {
    expect(allFindings.length).toBeGreaterThan(10);
    for (const f of allFindings) { expect(f.rule_id.length).toBeGreaterThan(0); expect(S.RULE_IDS).toContain(f.rule_id); }
  });
});

describe('AN-E40..E46 letter and evidence', () => {
  it('AN-E40 ld5001 letter equals the seed letter', () => {
    const b = LD5001();
    expect(S.buildDemandLetter(b, S.applyRules(b, 'shipper', settings()), '2026-10-08')).toBe(seedLetter('ld5001.json'));
  });
  it('AN-E41 ld5002 shipper letter equals the seed letter', () => {
    const b = LD5002();
    expect(S.buildDemandLetter(b, S.applyRules(b, 'shipper', settings()), '2026-10-08')).toBe(seedLetter('ld5002.json'));
  });
  it('AN-E42 ld5002 carrier letter', () => {
    const b = LD5002();
    expect(S.buildDemandLetter(b, S.applyRules(b, 'carrier', settings()), '2026-10-10')).toBe(
      'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.\n\nDate: 2026-10-10\nTo: Widget Co\nFrom: Acme Freight LLC\nRe: Load LD-5002 / Invoice INV-2002 - billing dispute\n\nDelivery records and the signed rate confirmation support the following charges that were not billed or were under-billed:\n\n1. Detention earned but not billed: $162.50\n   Gate times and rate-con terms support $162.50 of detention; $0 was billed.\n\nWe request payment of $162.50 in accessorial/detention charges for load LD-5002 (reference invoice INV-2002).\nSupporting documents and calculations are attached in the evidence packet.\nPlease respond within 30 days. (Reminder for sender: confirm the contractual dispute window - assumed 90 days from invoice date; verify before sending.)\n\nSincerely,\n[Name / Title / Contact - to be completed by sender]',
    );
  });
  it('AN-E43 only review items -> no amount requested', () => {
    const b = bundle({ invoice: inv([['Lumper', '150']]), rate_confirmation: rc({ authorized_accessorials: [] }) });
    const r = S.applyRules(b, 'shipper', settings());
    expect([r.recoverable_total, r.pending_review_total]).toEqual(['0.00', '150.00']);
    const l = S.buildDemandLetter(b, r, '2025-03-15');
    expect(l).toContain('No amount is requested: there are no confirmed findings.');
    expect(l.includes('$150')).toBe(false);
    expect(l.includes('$0.00')).toBe(false);
  });
  it('AN-E44 hostile strings never reach the letter as markup', () => {
    const h = 'Evil `x` <script>alert(1)</script> [x](y) | # Co';
    const b = bundle({ invoice: inv([[h, '10.00'], [h, '10.00']], { carrier: h, shipper: h, invoice_number: h, load_number: h, total: '25.00' }), rate_confirmation: rc({ authorized_accessorials: [] }) });
    for (const p of ['shipper', 'carrier'] as const) {
      const l = S.buildDemandLetter(b, S.applyRules(b, p, settings()), '2026-10-10');
      for (const line of l.split('\n')) expect(/[`<>]/.test(line), line).toBe(false);
    }
  });
  it('AN-E45 buildEvidence uses the UTC date of `now`', () => {
    const docs = [{ filename: 'invoice.txt', doc_type: 'invoice', sha256: 'a'.repeat(64) }];
    const ev = S.buildEvidence(docs, LD5001(), 'shipper', S.DEFAULT_ANALYSIS_SETTINGS, new Date('2026-10-10T23:30:00Z'));
    expect(ev.load_number ?? ev.loadNumber).toBe('LD-5001');
    expect(ev.disclaimer).toBe(S.PACKET_DISCLAIMER);
    const letter = ev.demand_letter ?? ev.demandLetter ?? ev.letter;
    expect(letter).toMatch(/^Date: 2026-10-10$/m);
    expect(String(ev.markdown).startsWith('# Evidence Packet - Load LD-5001')).toBe(true);
  });
  it('AN-E46 constants and the @fr/shared/analysis subpath', async () => {
    expect(S.RULES_VERSION).toBe('rules-v1');
    expect(S.DEFAULT_ANALYSIS_SETTINGS).toEqual({ detentionIncrementMinutes: 15, amountTolerance: '0.01', disputeWindowDays: 90 });
    expect([...S.RULE_IDS]).toEqual(['INV-DUPLICATE', 'INV-LINEHAUL-RATE', 'INV-FUEL-SURCHARGE', 'INV-ACCESSORIAL-UNAUTH', 'INV-TOTAL-MISMATCH', 'DET-UNBILLED', 'DET-UNDERBILLED', 'DET-OVERBILLED']);
    expect(S.DRAFT_BANNER).toBe('DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.');
    expect(S.PACKET_DISCLAIMER).toBe('MVP / pre-product output. Extracted values and calculations are unverified against real customer data and must be reviewed by a person before any dispute is sent. This is not legal or financial advice.');
    const sub: any = await import('@fr/shared/analysis');
    for (const n of ['applyRules', 'computeDetention', 'classifyLine', 'buildDemandLetter', 'renderPacketMarkdown', 'buildEvidence', 'AnalysisInputError', 'DEFAULT_ANALYSIS_SETTINGS', 'RULES_VERSION', 'RULE_IDS', 'DRAFT_BANNER', 'PACKET_DISCLAIMER'])
    {
      expect(sub[n], `@fr/shared/analysis exports ${n}`).toBeDefined();
      expect(typeof sub[n], n).toBe(typeof S[n]);
      if (typeof S[n] !== 'function') expect(sub[n], n).toEqual(S[n]);
    }
  });
});

describe('AN-R06 / P2 / P7 / P10 shared contract', () => {
  const ANALYZE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST'];
  it('AN-R06: can(role, "claims:analyze") exactly for the P4 roles; the oracle matrix agrees (other rows pinned by rbac.acc)', () => {
    for (const r of ROLES) {
      expect(S.can(r, 'claims:analyze'), r).toBe(ANALYZE_ROLES.includes(r));
      expect(EXPECTED[r].includes('claims:analyze'), `oracle ${r}`).toBe(ANALYZE_ROLES.includes(r));
    }
  });
  it('P2: body schemas and batch constants', () => {
    expect(S.ANALYZE_BATCH_MAX).toBe(25);
    expect(S.ANALYZE_BATCH_DEFAULT).toBe(10);
    const ab = S.AnalyzeBody;
    expect(ab?.safeParse, 'AnalyzeBody is a schema').toBeTypeOf('function');
    expect(ab.safeParse({}).success).toBe(true);
    for (const bad of [{ x: 1 }, { limit: 1 }, [], 'x']) expect(ab.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const bb = S.BulkAnalyzeBody;
    expect(bb?.safeParse, 'BulkAnalyzeBody is a schema').toBeTypeOf('function');
    for (const ok of [{}, { limit: 1 }, { limit: 25 }, { limit: 10 }]) expect(bb.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    for (const bad of [{ limit: 0 }, { limit: 26 }, { limit: '5' }, { limit: 1.5 }, { limit: 1, x: 1 }, { limit: null }]) expect(bb.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const parsed = bb.safeParse({});
    if (parsed.success && 'limit' in parsed.data) expect(parsed.data.limit).toBe(10);
  });
  it('P7: audit actions claim.analyzed and claim.bulk_analyzed are registered', () => {
    expect(S.AUDIT_ACTIONS).toContain('claim.analyzed');
    expect(S.AUDIT_ACTIONS).toContain('claim.bulk_analyzed');
  });
  it('P10: exact UI copy', () => {
    expect(S.ANALYSIS_NOTE).toBe('Runs fixed rules on the accepted document fields. Findings are drafts for human review, not verified results.');
    expect(S.ANALYZE_AUTHOR_NOTE).toBe('You will be recorded as the author of revision 1, so another approver must approve it.');
    const T = S.ANALYSIS_TEXT;
    expect({ ...T, bulkSummary: undefined }).toEqual({
      button: 'Analyze claim', busy: 'Analyzing...', success: 'Analysis complete. Revision 1 is ready for review.',
      conflict: 'This claim is no longer awaiting analysis or has no accepted documents. Reload to continue.',
      invalid: 'The extracted values of this claim cannot be analysed automatically.',
      forbidden: 'You do not have permission to analyze claims.', rateLimited: 'Too many requests. Try again later.',
      failed: 'Analysis failed. Try again.', bulkButton: 'Analyze awaiting claims', bulkTitle: 'Analyze awaiting claims',
      bulkIntro: 'Analyzes up to 10 claims awaiting analysis, oldest first.', bulkConfirm: 'Analyze', bulkCancel: 'Cancel', bulkClose: 'Close',
      bulkSummary: undefined, bulkFailedPrefix: 'Could not analyze: ',
    });
    expect(T.bulkSummary(2, 1, 1, 3)).toBe('Analyzed 2. Skipped 1. Could not analyze 1. 3 still awaiting analysis.');
    expect(T.bulkSummary(0, 0, 0, 0)).toBe('Analyzed 0. Skipped 0. Could not analyze 0. 0 still awaiting analysis.');
  });
  it('T14 honesty: no new copy claims accuracy, guarantees or a recovery rate', () => {
    const strings = [S.ANALYSIS_NOTE, S.ANALYZE_AUTHOR_NOTE, ...Object.values(S.ANALYSIS_TEXT).filter((v) => typeof v === 'string'), S.ANALYSIS_TEXT.bulkSummary(1, 1, 1, 1), S.PACKET_DISCLAIMER, S.DRAFT_BANNER];
    for (const s of strings) expect(s as string, s as string).not.toMatch(/accura|guarantee|recovery rate|\d+\s*%/i);
  });
});
