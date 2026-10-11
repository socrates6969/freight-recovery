import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_ANALYSIS_SETTINGS } from '../analysis/index.js';
import { buildChargeClassifier, buildEvidenceLearned } from '../charge-intel/index.js';
import type { ExtractedBundle } from '../extraction.js';

import {
  FSC_CONFIDENCE,
  FUEL_CHECK_STATUSES,
  FscTableBody,
  SetFuelInputsBody,
  UpdateFscTableBody,
  addDays,
  applicablePosting,
  buildEvidenceFuel,
  checkFuel,
  computeFuelCheck,
  evaluateFscTable,
  weekRuleText,
  weekdayIndex,
  type FscTableSpec,
  type FuelCheckInput,
  type PriceSeriesData,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');
const NOW = new Date('2026-10-11T12:00:00.000Z');
const SHA = 'aca8fefdbb54bdf16a2ab2c225d8b1f59c033e04d6fb96d8c232c3cc45417bdf';
const IMPORT_ID = '0b9d7a2e-3c1f-4d5e-8f6a-1b2c3d4e5f60';

function table(over: Partial<FscTableSpec> = {}): FscTableSpec {
  return {
    id: '1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e',
    name: 'Acme FSC',
    version: 1,
    kind: 'step',
    unit: 'per_mile',
    priceSeries: 'diesel_us',
    effectiveOffsetDays: 2,
    params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' },
    archived: false,
    ...over,
  };
}

const SERIES: PriceSeriesData = {
  key: 'diesel_us',
  importId: IMPORT_ID,
  sha256: SHA,
  sourceUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW',
  retrievedAt: '2026-10-11',
  observations: [
    { date: '2026-09-07', value: '5.900' },
    { date: '2026-09-14', value: '6.000' },
    { date: '2026-09-21', value: '6.100' },
    { date: '2026-09-28', value: '6.382' },
    { date: '2026-10-05', value: '6.199' },
  ],
};

function bundle(lines: [string, string][], rc: { linehaul_rate?: string | null; fuel_surcharge?: string | null } | null = {}): ExtractedBundle {
  return {
    invoice: { invoice_number: 'INV-7', carrier: 'Acme', shipper: 'Widget', load_number: 'LD-7', invoice_date: '2026-10-09', lines: lines.map(([description, amount]) => ({ description, amount })), total: null, extraction_warnings: [] },
    rate_confirmation:
      rc === null
        ? null
        : {
            load_number: 'LD-7',
            carrier: 'Acme',
            linehaul_rate: rc.linehaul_rate === undefined ? '1500.00' : rc.linehaul_rate,
            fuel_surcharge: rc.fuel_surcharge === undefined ? null : rc.fuel_surcharge,
            detention_free_hours: null,
            detention_rate_per_hour: null,
            detention_max_hours: null,
            authorized_accessorials: [],
            extraction_warnings: [],
          },
    bol: null,
    warnings: [],
  };
}

const input = (over: Partial<FuelCheckInput> = {}): FuelCheckInput => ({ shipDate: '2026-10-07', miles: '500.0', table: table(), series: SERIES, ...over });

describe('week rule (F3)', () => {
  it('weekdayIndex, addDays and the rule text', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0);
    expect(weekdayIndex('2026-10-11')).toBe(6);
    expect(weekdayIndex('1970-01-01')).toBe(3);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(weekRuleText(2)).toBe('Monday posting applies Wednesday to Tuesday');
    expect(weekRuleText(0)).toBe('Monday posting applies Monday to Sunday');
    expect(weekRuleText(6)).toBe('Monday posting applies Sunday to Saturday');
    expect(() => weekRuleText(7)).toThrow(RangeError);
  });

  it('applies the Monday posting from Monday+offset for seven days, for every offset and weekday', () => {
    const obs = SERIES.observations;
    for (let o = 0; o <= 6; o += 1) {
      for (let k = 0; k < 7 * 6; k += 1) {
        const ship = addDays('2026-09-07', k);
        const got = applicablePosting(obs, ship, o);
        // Oracle: count days since the first Monday, shift by the offset.
        const rel = k - o;
        const week = Math.floor(rel / 7);
        if (rel < 0 || week >= obs.length) {
          expect([o, ship, got]).toEqual([o, ship, null]);
        } else {
          expect([o, ship, got?.index, got?.effectiveFrom, got?.effectiveTo]).toEqual([o, ship, week, addDays(obs[week]?.date ?? '', o), addDays(obs[week]?.date ?? '', o + 6)]);
        }
      }
    }
  });

  it('matches the GSA Wednesday-Tuesday examples at the series edge', () => {
    expect(applicablePosting(SERIES.observations, '2026-10-07', 2)?.date).toBe('2026-10-05');
    expect(applicablePosting(SERIES.observations, '2026-10-05', 2)?.date).toBe('2026-09-28');
    expect(applicablePosting(SERIES.observations, '2026-10-06', 2)?.date).toBe('2026-09-28');
    expect(applicablePosting(SERIES.observations, '2026-10-13', 2)?.date).toBe('2026-10-05');
    expect(applicablePosting(SERIES.observations, '2026-10-14', 2)).toBeNull();
    expect(applicablePosting([], '2026-10-14', 2)).toBeNull();
    expect(() => applicablePosting(SERIES.observations, '2026-02-30', 2)).toThrow(RangeError);
  });
});

describe('evaluateFscTable (F4)', () => {
  it('step above_base: ceil of the steps, part step = full step, exact boundaries', () => {
    expect(evaluateFscTable(table(), '6.199')).toEqual({ rate: '0.84', steps: 84, row: null, reachesFirstStep: true });
    expect(evaluateFscTable(table(), '1.200')).toEqual({ rate: '0', steps: 0, row: null, reachesFirstStep: false });
    expect(evaluateFscTable(table(), '1.201')).toEqual({ rate: '0.01', steps: 1, row: null, reachesFirstStep: true });
    expect(evaluateFscTable(table(), '1.260')).toEqual({ rate: '0.01', steps: 1, row: null, reachesFirstStep: true });
    expect(evaluateFscTable(table(), '1.261')).toEqual({ rate: '0.02', steps: 2, row: null, reachesFirstStep: true });
  });

  it('step from_base (Bison style): floor + 1 from the base, exact boundaries', () => {
    const t = table({ params: { basePrice: '1.12', stepSize: '0.05', ratePerStep: '0.01', bracket: 'from_base' } });
    expect(evaluateFscTable(t, '1.119')).toMatchObject({ rate: '0', steps: 0, reachesFirstStep: false });
    expect(evaluateFscTable(t, '1.120')).toMatchObject({ rate: '0.01', steps: 1 });
    expect(evaluateFscTable(t, '1.169')).toMatchObject({ rate: '0.01', steps: 1 });
    expect(evaluateFscTable(t, '1.170')).toMatchObject({ rate: '0.02', steps: 2 });
    // Percent rate: str(R * k) keeps the Decimal exponent.
    const p = table({ unit: 'percent', params: { basePrice: '1.12', stepSize: '0.05', ratePerStep: '0.5', bracket: 'from_base' } });
    expect(evaluateFscTable(p, '1.170').rate).toBe('1.0');
  });

  it('mpg: half-up to the given decimals, written with exactly that many places', () => {
    const t = (d: 2 | 3 | 4, mpg = '6') => table({ kind: 'mpg', params: { basePrice: '1.20', mpg, decimals: d } });
    // (6.199 - 1.20) / 6 = 0.83316...
    expect(evaluateFscTable(t(2), '6.199')).toEqual({ rate: '0.83', steps: null, row: null, reachesFirstStep: true });
    expect(evaluateFscTable(t(4), '6.199').rate).toBe('0.8332');
    // Tie: (1.230 - 1.200) / 6 = 0.005 -> half up to 0.01 at 2 decimals.
    expect(evaluateFscTable(t(2), '1.230').rate).toBe('0.01');
    // (1.215 - 1.20) / 6 = 0.0025 -> 0.003 at 3 decimals (tie up).
    expect(evaluateFscTable(t(3), '1.215').rate).toBe('0.003');
    expect(evaluateFscTable(t(2), '1.200')).toEqual({ rate: '0', steps: null, row: null, reachesFirstStep: false });
    expect(evaluateFscTable(t(2, '6.5'), '7.700').rate).toBe('1.00');
  });

  it('rows: the last row with atLeast <= price', () => {
    const t = table({ kind: 'rows', params: { rows: [{ atLeast: '1.20', rate: '0.01' }, { atLeast: '1.26', rate: '0.02' }, { atLeast: '1.32', rate: '0.030' }] } });
    expect(evaluateFscTable(t, '1.199')).toEqual({ rate: '0', steps: null, row: null, reachesFirstStep: false });
    expect(evaluateFscTable(t, '1.200')).toEqual({ rate: '0.01', steps: null, row: 0, reachesFirstStep: true });
    expect(evaluateFscTable(t, '1.319')).toMatchObject({ rate: '0.02', row: 1 });
    expect(evaluateFscTable(t, '9.000')).toMatchObject({ rate: '0.030', row: 2 });
  });

  it('refuses invalid prices and params', () => {
    expect(() => evaluateFscTable(table(), '6.19')).toThrow();
    expect(() => evaluateFscTable(table({ params: { basePrice: '0', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' } }), '6.199')).toThrow();
    expect(() => evaluateFscTable(table({ kind: 'mpg', unit: 'percent', params: { basePrice: '1.20', mpg: '6', decimals: 2 } }), '6.199')).toThrow();
  });
});

describe('fuel DTOs (F10)', () => {
  const body = { name: 'Acme FSC', kind: 'step', unit: 'per_mile', priceSeries: 'diesel_us', params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' } };
  it('accepts a valid table and defaults the offset to 2', () => {
    expect(FscTableBody.parse(body).effectiveOffsetDays).toBe(2);
    expect(UpdateFscTableBody.safeParse({ ...body, expectedVersion: 1 }).success).toBe(true);
  });
  it('rejects mismatched params, unit formats, non-increasing rows and extra keys', () => {
    for (const bad of [
      { ...body, kind: 'mpg' },
      { ...body, params: { ...body.params, ratePerStep: '12.5' } },
      { ...body, unit: 'percent', params: { ...body.params, ratePerStep: '100.5' } },
      { ...body, kind: 'rows', params: { rows: [{ atLeast: '1.30', rate: '0.01' }, { atLeast: '1.30', rate: '0.02' }] } },
      { ...body, params: { ...body.params, basePrice: '0.0' } },
      { ...body, params: { ...body.params, basePrice: 'x' } },
      { ...body, name: 'a‮b' },
      { ...body, extra: 1 },
      { ...body, effectiveOffsetDays: 7 },
    ]) {
      expect(FscTableBody.safeParse(bad).success).toBe(false);
    }
    expect(FscTableBody.safeParse({ ...body, unit: 'percent', params: { ...body.params, ratePerStep: '100' } }).success).toBe(true);
  });
  it('validates fuel inputs', () => {
    const ok = { shipDate: '2026-10-07', miles: '500', fscTableId: IMPORT_ID };
    expect(SetFuelInputsBody.safeParse(ok).success).toBe(true);
    expect(SetFuelInputsBody.safeParse({ ...ok, miles: null }).success).toBe(true);
    for (const bad of [{ ...ok, miles: '0.0' }, { ...ok, miles: '10000.1' }, { ...ok, miles: '1.25' }, { ...ok, shipDate: '2026-02-29' }, { ...ok, shipDate: '1993-12-31' }, { ...ok, fscTableId: 'x' }]) {
      expect(SetFuelInputsBody.safeParse(bad).success).toBe(false);
    }
  });
});

describe('checkFuel (F5)', () => {
  const wrongWeek = bundle([
    ['Linehaul', '1500.00'],
    ['Fuel surcharge', '435.00'],
  ]);

  it('produces the exact F5 finding with the wrong-week diagnosis', () => {
    const c = computeFuelCheck(wrongWeek, input(), null);
    expect(c.result.status).toBe('finding');
    expect(c.traceLines).toEqual([1]);
    expect(c.finding).toEqual({
      rule_id: 'FSC-INDEX-MISMATCH',
      title: 'Fuel surcharge differs from the fuel table (review)',
      direction: 'overcharge',
      amount: '15.00',
      explanation: "Billed fuel surcharge $435.00 vs $420.00 from fuel table 'Acme FSC' for ship date 2026-10-07. Verify the table, the miles and the ship date before disputing.",
      calculation: [
        'Ship date 2026-10-07: the U.S. average diesel price posted 2026-10-05 applies 2026-10-07 to 2026-10-13 (Monday posting applies Wednesday to Tuesday).',
        'Price posted 2026-10-05: $6.199 per gallon (U.S. Energy Information Administration, US Diesel Sales Price [GASDESW], retrieved from FRED, Federal Reserve Bank of St. Louis; file sha256 aca8fefdbb54).',
        "Fuel table 'Acme FSC' v1: ceil(($6.199 - $1.20) / $0.06) = 84 step(s) x $0.01 per mile = $0.84 per mile.",
        'Expected: 500.0 miles x $0.84 per mile = $420.00.',
        "Billed fuel lines: 'Fuel surcharge' $435.00 = $435.00.",
        'Difference: $435.00 - $420.00 = $15.00.',
        'The billed amount equals the table result for the price posted 2026-09-28 ($6.382), 1 week(s) earlier than the applicable posting.',
      ],
      confidence: FSC_CONFIDENCE,
      needs_human_review: true,
    });
    expect(c.result).toEqual({
      checkVersion: 'fsc-v1',
      status: 'finding',
      priceSeries: 'diesel_us',
      postedDate: '2026-10-05',
      price: '6.199',
      effectiveFrom: '2026-10-07',
      effectiveTo: '2026-10-13',
      rate: '0.84',
      expected: '420.00',
      billed: '435.00',
      difference: '15.00',
      direction: 'overcharge',
      alternative: { postedDate: '2026-09-28', price: '6.382', weeks: 1, later: false },
      calculation: c.finding?.calculation,
      priceImport: { id: IMPORT_ID, sha256: SHA, retrievedAt: '2026-10-11', sourceUrl: SERIES.sourceUrl },
    });
  });

  it('the public checkFuel returns the FuelCheckResult itself', () => {
    expect(checkFuel(wrongWeek, input(), null)).toEqual(computeFuelCheck(wrongWeek, input(), null).result);
    expect(checkFuel(wrongWeek, null, null).status).toBe('no_inputs');
  });

  it('walks every status in the F5 order', () => {
    const st = (b: ExtractedBundle, i: FuelCheckInput | null) => computeFuelCheck(b, i, null).result.status;
    expect(st(wrongWeek, null)).toBe('no_inputs');
    expect(st(wrongWeek, input({ table: table({ archived: true }) }))).toBe('table_archived');
    expect(st(bundle([['Fuel surcharge', '435.00']], { fuel_surcharge: '420.00' }), input())).toBe('contract_amount');
    expect(st(bundle([['Linehaul', '1500.00']]), input())).toBe('no_fuel_line');
    expect(st(wrongWeek, input({ series: null }))).toBe('price_unavailable');
    expect(st(wrongWeek, input({ shipDate: '2026-10-20' }))).toBe('price_unavailable');
    expect(st(wrongWeek, input({ miles: null }))).toBe('miles_missing');
    const pct = table({ unit: 'percent', params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.5', bracket: 'above_base' } });
    expect(st(bundle([['Fuel surcharge', '630.00']], { linehaul_rate: null }), input({ table: pct }))).toBe('no_linehaul');
    expect(st(bundle([['Fuel surcharge', '630.00']], null), input({ table: pct }))).toBe('no_linehaul');
    expect(st(bundle([['Fuel surcharge', '420.01']]), input())).toBe('within_tolerance');
    expect(st(bundle([['Fuel surcharge', '420.02']]), input())).toBe('finding');
    expect(FUEL_CHECK_STATUSES[0]).toBe('off');
  });

  it('fills the F5.6 fields per status', () => {
    const none = computeFuelCheck(wrongWeek, input({ series: null }), null).result;
    expect([none.postedDate, none.billed, none.rate, none.priceImport, none.calculation]).toEqual([null, null, null, null, []]);
    const mm = computeFuelCheck(wrongWeek, input({ miles: null }), null).result;
    expect([mm.postedDate, mm.price, mm.rate, mm.billed, mm.expected, mm.difference, mm.direction, mm.calculation]).toEqual(['2026-10-05', '6.199', '0.84', '435.00', null, null, null, []]);
    const ok = computeFuelCheck(bundle([['Fuel surcharge', '420.00']]), input(), null).result;
    expect([ok.expected, ok.difference, ok.direction, ok.alternative, ok.calculation.length]).toEqual(['420.00', '0.00', null, null, 6]);
  });

  it('percent tables use the contract linehaul, else the unique invoice linehaul lines', () => {
    const pct = table({ unit: 'percent', params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.5', bracket: 'above_base' } });
    // 84 steps x 0.5% = 42.0% of 1500.00 = 630.00
    const rc = computeFuelCheck(bundle([['Fuel surcharge', '640.00']]), input({ table: pct }), null);
    expect(rc.finding?.calculation[3]).toBe('Expected: 42.0% x linehaul $1500.00 (rate confirmation) = $630.00.');
    const inv = computeFuelCheck(bundle([['Linehaul', '1000.00'], ['Linehaul', '1000.00'], ['Fuel surcharge', '400.00']], null), input({ table: pct }), null);
    expect(inv.finding?.calculation[3]).toBe('Expected: 42.0% x linehaul $1000.00 (invoice linehaul lines) = $420.00.');
    expect(inv.finding?.direction).toBe('underbilled');
  });

  it('adds classifier-suggested fuel lines and marks them', () => {
    const c = buildChargeClassifier([{ id: 'l1', description: 'Diesel adjustment', category: 'fuel' }]);
    const b = bundle([['Fuel surcharge', '400.00'], ['Diesel adjustment', '35.00']]);
    const r = computeFuelCheck(b, input(), (d) => c.classify(d));
    expect(r.traceLines).toEqual([0, 1]);
    expect(r.result.calculation[4]).toBe("Billed fuel lines: 'Fuel surcharge' $400.00, 'Diesel adjustment' $35.00 (suggested fuel line) = $435.00.");
    expect(computeFuelCheck(b, input(), null).result.billed).toBe('400.00');
  });

  it('cites the rows, mpg and not-reached table lines', () => {
    const rows = table({ kind: 'rows', params: { rows: [{ atLeast: '6.10', rate: '0.80' }, { atLeast: '6.30', rate: '0.90' }] } });
    expect(computeFuelCheck(wrongWeek, input({ table: rows }), null).result.calculation[2]).toBe("Fuel table 'Acme FSC' v1: row from $6.10 applies: $0.80 per mile.");
    const rowsHigh = table({ kind: 'rows', params: { rows: [{ atLeast: '7.00', rate: '0.80' }] } });
    expect(computeFuelCheck(wrongWeek, input({ table: rowsHigh }), null).result.calculation[2]).toBe("Fuel table 'Acme FSC' v1: $6.199 is below the first row ($7.00); rate $0 per mile.");
    const mpg = table({ kind: 'mpg', version: 3, params: { basePrice: '1.20', mpg: '6', decimals: 2 } });
    expect(computeFuelCheck(wrongWeek, input({ table: mpg }), null).result.calculation[2]).toBe("Fuel table 'Acme FSC' v3: ($6.199 - $1.20) / 6 mpg = $0.83 per mile (rounded half up to 2 decimals).");
    const high = table({ params: { basePrice: '9.00', stepSize: '0.05', ratePerStep: '0.01', bracket: 'from_base' } });
    expect(computeFuelCheck(wrongWeek, input({ table: high }), null).result.calculation[2]).toBe("Fuel table 'Acme FSC' v1: $6.199 does not reach the first step (base $9.00); rate $0 per mile.");
    const from = table({ params: { basePrice: '1.12', stepSize: '0.05', ratePerStep: '0.01', bracket: 'from_base' } });
    expect(computeFuelCheck(wrongWeek, input({ table: from }), null).result.calculation[2]).toBe("Fuel table 'Acme FSC' v1: 1 + floor(($6.199 - $1.12) / $0.05) = 102 step(s) x $0.01 per mile = $1.02 per mile.");
  });

  it('probes earlier weeks before the later week and reports later postings', () => {
    // Billed equals the 2026-09-21 price (2 weeks earlier): 6.100 -> 82 steps -> 410.00
    expect(computeFuelCheck(bundle([['Fuel surcharge', '410.00']]), input(), null).result.alternative).toEqual({ postedDate: '2026-09-21', price: '6.100', weeks: 2, later: false });
    // 3 weeks earlier: 2026-09-14 (6.000 -> 80 steps -> 400.00)
    expect(computeFuelCheck(bundle([['Fuel surcharge', '400.00']]), input(), null).result.alternative).toEqual({ postedDate: '2026-09-14', price: '6.000', weeks: 3, later: false });
    // Ship 2026-09-30 applies 09-28; billed equals the later 10-05 posting (420.00).
    expect(computeFuelCheck(bundle([['Fuel surcharge', '420.00']]), input({ shipDate: '2026-09-30' }), null).result.alternative).toEqual({ postedDate: '2026-10-05', price: '6.199', weeks: 1, later: true });
    expect(computeFuelCheck(bundle([['Fuel surcharge', '1.00']]), input(), null).result.alternative).toBeNull();
  });
});

describe('buildEvidenceFuel (F5.4-F5.5)', () => {
  const bundles = [bundle([['Linehaul', '1500.00'], ['Fuel surcharge', '435.00'], ['Liftgate', '75.00'], ['Pallet exchange', '20.00']]), bundle([['Waiting time', '40.00']], null)];
  const classifier = buildChargeClassifier([{ id: 'l1', description: 'Pallet exchange', category: 'accessorial' }]);

  it('with input null equals buildEvidenceLearned exactly (both perspectives, with and without a classifier)', () => {
    for (const b of bundles) {
      for (const persp of ['shipper', 'carrier'] as const) {
        for (const c of [null, classifier]) {
          const f = buildEvidenceFuel([], b, persp, DEFAULT_ANALYSIS_SETTINGS, NOW, c, null);
          const l = buildEvidenceLearned([], b, persp, DEFAULT_ANALYSIS_SETTINGS, NOW, c);
          expect(f.evidence).toEqual(l.evidence);
          expect([f.traces, f.extraLines, f.learnedFindingsCount, f.reviewFlagsCount, f.labelIds]).toEqual([l.traces, l.extraLines, l.learnedFindingsCount, l.reviewFlagsCount, l.labelIds]);
          expect([f.fuel.status, f.fuelFindingsCount]).toEqual(['no_inputs', 0]);
        }
      }
    }
  });

  it('within tolerance equals buildEvidenceLearned exactly', () => {
    const b = bundle([['Fuel surcharge', '420.00']]);
    const f = buildEvidenceFuel([], b, 'shipper', DEFAULT_ANALYSIS_SETTINGS, NOW, null, input());
    expect(f.evidence).toEqual(buildEvidenceLearned([], b, 'shipper', DEFAULT_ANALYSIS_SETTINGS, NOW, null).evidence);
    expect(f.fuel.status).toBe('within_tolerance');
  });

  it('places an own finding after the learned findings: pending total, not the letter', () => {
    const b = bundles[0] as ExtractedBundle;
    const f = buildEvidenceFuel([], b, 'shipper', DEFAULT_ANALYSIS_SETTINGS, NOW, classifier, input());
    const l = buildEvidenceLearned([], b, 'shipper', DEFAULT_ANALYSIS_SETTINGS, NOW, classifier);
    expect(f.evidence.result.findings.slice(0, -1)).toEqual(l.evidence.result.findings);
    expect(f.evidence.result.findings.at(-1)?.rule_id).toBe('FSC-INDEX-MISMATCH');
    expect(f.evidence.result.recoverable_total).toBe(l.evidence.result.recoverable_total);
    // pending = learned pending (Liftgate 75.00 + Pallet exchange 20.00) + 15.00
    expect([l.evidence.result.pending_review_total, f.evidence.result.pending_review_total]).toEqual(['95.00', '110.00']);
    expect(f.evidence.demand_letter).toBe(l.evidence.demand_letter);
    expect(f.evidence.markdown).toContain('FSC-INDEX-MISMATCH');
    expect(f.traces.at(-1)).toEqual({ lines: [1], total: false, detention: null });
    expect(f.extraLines.at(-1)).toEqual([]);
    expect(f.fuelFindingsCount).toBe(1);
  });

  it('puts an other-perspective finding in ignored_findings (not stored, totals unchanged)', () => {
    const b = bundles[0] as ExtractedBundle;
    const f = buildEvidenceFuel([], b, 'carrier', DEFAULT_ANALYSIS_SETTINGS, NOW, null, input());
    const l = buildEvidenceLearned([], b, 'carrier', DEFAULT_ANALYSIS_SETTINGS, NOW, null);
    expect(f.evidence.result.findings).toEqual(l.evidence.result.findings);
    expect(f.evidence.result.ignored_findings.at(-1)?.rule_id).toBe('FSC-INDEX-MISMATCH');
    expect([f.evidence.result.recoverable_total, f.evidence.result.pending_review_total]).toEqual([l.evidence.result.recoverable_total, l.evidence.result.pending_review_total]);
    expect(f.fuelFindingsCount).toBe(0);
  });
});

describe('package root isolation (step 7)', () => {
  const importsOf = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/^(?:import|export)[^;]*?from\s+'([^']+)'/gmu)].map((m) => m[1] ?? '');

  it('the root never reaches the fuel or outlook engines (transitively)', () => {
    const forbidden = [
      ['fuel', 'table.ts'],
      ['fuel', 'check.ts'],
      ['fuel', 'evidence.ts'],
      ['fuel', 'week.ts'],
      ['fuel', 'index.ts'],
      ['outlook', 'csv.ts'],
      ['outlook', 'ar.ts'],
      ['outlook', 'backtest.ts'],
      ['outlook', 'outlook.ts'],
      ['outlook', 'sha256.ts'],
      ['outlook', 'index.ts'],
    ].map((p) => path.join(srcRoot, ...p));
    const seen = new Set<string>();
    const queue = [path.join(srcRoot, 'index.ts')];
    while (queue.length > 0) {
      const f = queue.pop() ?? '';
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of importsOf(f)) {
        if (!spec.startsWith('.')) continue;
        queue.push(path.resolve(path.dirname(f), spec.replace(/\.js$/u, '.ts')));
      }
    }
    for (const f of ['fuel/constants.ts', 'fuel/copy.ts', 'fuel-dto.ts', 'outlook/constants.ts', 'outlook/copy.ts', 'outlook-dto.ts']) expect(seen.has(path.join(srcRoot, f))).toBe(true);
    for (const f of forbidden) expect([f, seen.has(f)]).toEqual([f, false]);
  });

  it('constants import nothing at runtime; copy imports only types', () => {
    expect(importsOf(path.join(srcRoot, 'fuel', 'constants.ts'))).toEqual([]);
    expect(importsOf(path.join(srcRoot, 'outlook', 'constants.ts'))).toEqual([]);
    expect(importsOf(path.join(srcRoot, 'fuel', 'copy.ts'))).toEqual(['./constants.js']);
    expect(importsOf(path.join(srcRoot, 'outlook', 'copy.ts'))).toEqual(['./constants.js']);
  });

  it('the root exports the step-7 constants and DTOs but no engine', async () => {
    const root = await import('../index.js');
    expect([root.FUEL_CHECK_VERSION, root.FSC_CONFIDENCE, root.FSC_TABLES_MAX, root.FSC_ROWS_MAX, root.OUTLOOK_VERSION, root.GATE_MIN_ORIGINS, root.GATE_MIN_DM]).toEqual(['fsc-v1', 0.7, 50, 200, 'outlook-v1', 100, 1.96]);
    expect(root.PRICE_SERIES_KEYS).toEqual(['diesel_us', 'ppi_tl']);
    expect(root.RANGE_QUANTILES).toEqual([0.1, 0.9]);
    for (const k of ['evaluateFscTable', 'checkFuel', 'buildEvidenceFuel', 'applicablePosting', 'parsePriceCsv', 'ar2Forecast', 'backtestSeries', 'computeOutlook']) expect([k, k in root]).toEqual([k, false]);
  });
});
