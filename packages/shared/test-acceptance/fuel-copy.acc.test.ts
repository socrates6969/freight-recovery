// REQ-20261011-fuel-outlook Tier L: T8 constants, module surface, copy and honesty (CI-K01..K04; Part C F1, F13,
// F14 flags, F15). Every expected string is restated from Part C.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadModules, readData, type FuelMod, type OutlookMod, type Root } from './helpers/fuel-fixtures.js';

let R: Root;
let F: FuelMod;
let O: OutlookMod;
beforeAll(async () => {
  ({ R, F, O } = await loadModules());
});
const fn = <T>(m: Record<string, unknown>, k: string) => m[k] as T;

const STATUSES = ['off', 'no_inputs', 'table_archived', 'contract_amount', 'no_fuel_line', 'price_unavailable', 'miles_missing', 'no_linehaul', 'within_tolerance', 'finding'];
const FUEL_NOTE = 'The fuel check recomputes the surcharge from your fuel table and the public weekly U.S. diesel price for the ship date. A difference is a finding for review, not a confirmed amount.';
const FUEL_STATUS_TEXT = {
  no_inputs: 'No fuel inputs yet.',
  table_archived: 'The selected fuel table is archived.',
  contract_amount: 'The rate confirmation states a fixed fuel surcharge; that amount is checked instead.',
  no_fuel_line: 'No fuel surcharge line on the invoice.',
  price_unavailable: 'No public diesel price is available for this ship date.',
  miles_missing: 'Miles are required for a per-mile fuel table.',
  no_linehaul: 'No linehaul amount to apply a percent table to.',
  within_tolerance: 'The billed fuel surcharge matches the fuel table.',
  finding: 'The billed fuel surcharge differs from the fuel table. Review the finding.',
};
const FUEL_TEXT = {
  tab: 'Fuel', heading: 'Fuel surcharge check', shipDate: 'Ship date', miles: 'Miles', table: 'Fuel table',
  save: 'Save fuel inputs', saved: 'Fuel inputs saved. They apply when the claim is analysed.', clear: 'Clear fuel inputs',
  locked: 'Fuel inputs can only change before the claim is analysed.',
  noTables: 'No fuel tables yet. An owner or admin can add one under Fuel tables.',
  forbidden: 'You do not have permission to change fuel inputs.', rateLimited: 'Too many requests. Try again later.', failed: 'Could not save the fuel inputs. Try again.',
};
const FUEL_TABLES_TEXT = {
  nav: 'Fuel tables', heading: 'Fuel tables',
  note: "Fuel tables are your carriers' surcharge schedules. The fuel check applies them to the public weekly U.S. diesel price.",
  add: 'Add fuel table', save: 'Save fuel table', archive: 'Archive', saved: 'Fuel table saved.', archived: 'Fuel table archived.',
  limit: 'This organization has reached the maximum number of fuel tables.', stale: 'This item changed. Reload to continue.', nameTaken: 'A fuel table with this name already exists.',
  forbidden: 'You do not have permission to change fuel tables.', failed: 'Could not save the fuel table. Try again.',
};
const OUTLOOK_NOTE = 'Forecasts are shown only at horizons where a model beat "no change" in a walk-forward backtest on public data; other horizons show "no change" with a range. Not a guarantee.';
const METHOD_LABELS = { ar2: 'Trend model', combo: 'Average of trend model and no change', naive: 'No change' };
const REASON_LABELS = { model_beats_naive: 'Beat "no change" in the backtest', fallback_gate: 'The model no longer beats "no change"; showing "no change"', naive_by_design: 'No model beat "no change" at this horizon' };
const OUTLOOK_TEXT = { nav: 'Outlook', heading: 'Cost outlook', noData: 'No public price data has been imported yet.', insufficient: 'Not enough price history for an outlook.', fscTable: 'Fuel table' };
const OUTLOOK_EVAL_NOTE = 'Walk-forward backtest on bundled public price history (U.S. EIA and BLS data via FRED). It is a regression check of the forecast and range rules, not a guarantee about future prices.';
const NEW_AUDIT = ['fsc_table.created', 'fsc_table.updated', 'fsc_table.archived', 'claim.fuel_inputs_set', 'claim.fuel_inputs_cleared', 'price_data.imported'];

describe('T8 constants and module surface (F1)', () => {
  it('CI-K01 constants', () => {
    for (const m of [R as Record<string, unknown>, F, O]) {
      expect(m.FUEL_CHECK_VERSION).toBe('fsc-v1');
      expect(m.FUEL_RULE_IDS).toEqual(['FSC-INDEX-MISMATCH']);
      expect(m.FSC_CONFIDENCE).toBe(0.7);
      expect(m.FSC_TABLES_MAX).toBe(50);
      expect(m.FSC_ROWS_MAX).toBe(200);
      expect(m.FUEL_CHECK_STATUSES).toEqual(STATUSES);
      expect(m.PRICE_SERIES_KEYS).toEqual(['diesel_us', 'ppi_tl']);
      expect(m.OUTLOOK_VERSION).toBe('outlook-v1');
      expect([m.GATE_MIN_ORIGINS, m.GATE_MIN_DM]).toEqual([100, 1.96]);
      expect(m.RANGE_QUANTILES).toEqual([0.1, 0.9]);
    }
    const S = R.OUTLOOK_SERIES as Record<string, { m: number; evalYears: number | null; warm: number; horizons: { h: number; candidate: string }[] }>;
    expect(Object.keys(S).sort()).toEqual(['diesel_us', 'ppi_tl']);
    expect(S.diesel_us).toMatchObject({ m: 52, evalYears: 15, warm: 104 });
    expect(S.diesel_us?.horizons.map((h) => ({ ...h }))).toEqual([{ h: 1, candidate: 'ar2' }, { h: 4, candidate: 'combo' }, { h: 8, candidate: 'naive' }, { h: 13, candidate: 'naive' }]);
    expect(S.ppi_tl).toMatchObject({ m: 12, evalYears: null, warm: 36 });
    expect(S.ppi_tl?.horizons.map((h) => ({ ...h }))).toEqual([{ h: 1, candidate: 'ar2' }]);
    expect(Object.isFrozen(S)).toBe(true);
    expect(R.RULES_VERSION).toBe('rules-v1');
    expect(R.RULE_IDS as string[]).not.toContain('FSC-INDEX-MISMATCH');
  });
  it('CI-K01 the root does not export the engines; the subpaths do', () => {
    for (const k of ['evaluateFscTable', 'checkFuel', 'buildEvidenceFuel', 'parsePriceCsv', 'backtestSeries', 'computeOutlook', 'applicablePosting', 'ar2Forecast']) expect(k in R, `root exports ${k}`).toBe(false);
    for (const k of ['applicablePosting', 'evaluateFscTable', 'checkFuel', 'buildEvidenceFuel']) expect(typeof F[k], `@fr/shared/fuel ${k}`).toBe('function');
    for (const k of ['parsePriceCsv', 'ar2Forecast', 'backtestSeries', 'computeOutlook']) expect(typeof O[k], `@fr/shared/outlook ${k}`).toBe('function');
    for (const k of ['PRICE_SERIES', 'OUTLOOK_SERIES', 'FUEL_NOTE', 'OUTLOOK_NOTE']) {
      expect(k in R, `root ${k}`).toBe(true);
      expect(k in F && k in O, `subpaths ${k}`).toBe(true);
    }
  });
});

describe('T8 copy (F15)', () => {
  it('CI-K02 every F15 string equals the contract', () => {
    expect(R.FUEL_NOTE).toBe(FUEL_NOTE);
    expect({ ...(R.FUEL_STATUS_TEXT as object) }).toEqual(FUEL_STATUS_TEXT);
    expect({ ...(R.FUEL_TEXT as object) }).toEqual(FUEL_TEXT);
    expect({ ...(R.FUEL_TABLES_TEXT as object) }).toEqual(FUEL_TABLES_TEXT);
    expect(R.OUTLOOK_NOTE).toBe(OUTLOOK_NOTE);
    expect({ ...(R.METHOD_LABELS as object) }).toEqual(METHOD_LABELS);
    expect({ ...(R.REASON_LABELS as object) }).toEqual(REASON_LABELS);
    expect({ ...(R.OUTLOOK_TEXT as object) }).toEqual(OUTLOOK_TEXT);
    expect(R.OUTLOOK_EVAL_NOTE).toBe(OUTLOOK_EVAL_NOTE);
    const bt = fn<(a: number, b: number) => string>(R, 'outlookBacktestText');
    const rt = fn<(c: number) => string>(R, 'rangeText');
    expect(bt(2011, 2026)).toBe('Backtested on public data 2011-2026; not a guarantee.');
    expect(bt(2009, 2026)).toBe('Backtested on public data 2009-2026; not a guarantee.');
    expect(rt(0.779259)).toBe('80% range. In the backtest, 78% of outcomes fell inside ranges built this way.');
    for (const [c, pct] of [[0.78869, 79], [0.778443, 78], [0.769231, 77], [0.739645, 74], [1, 100]] as const) expect(rt(c)).toBe(`80% range. In the backtest, ${pct}% of outcomes fell inside ranges built this way.`);
  });
  it('CI-K03 honesty: no accuracy/guarantee/prediction/AI claims beyond the mandated "not a guarantee"', () => {
    const bt = fn<(a: number, b: number) => string>(R, 'outlookBacktestText');
    const rt = fn<(c: number) => string>(R, 'rangeText');
    const strings = [
      R.FUEL_NOTE, ...Object.values(R.FUEL_STATUS_TEXT as object), ...Object.values(R.FUEL_TEXT as object), ...Object.values(R.FUEL_TABLES_TEXT as object),
      R.OUTLOOK_NOTE, bt(2011, 2026), rt(0.779259), ...Object.values(R.METHOD_LABELS as object), ...Object.values(R.REASON_LABELS as object),
      ...Object.values(R.OUTLOOK_TEXT as object), R.OUTLOOK_EVAL_NOTE, readData('README.md').toString('utf8'),
    ] as string[];
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings) {
      expect(typeof s).toBe('string');
      const rest = s.replace(/not a guarantee/i, '');
      expect(rest, s).not.toMatch(/accura|guarantee|predict|AI\b|machine learning|verified|saves|recovery rate|% recovered/i);
    }
  });
  it('CI-K04 the six new audit actions follow charge_label.deleted in F13 order; six flags ordered by key', () => {
    const a = [...R.AUDIT_ACTIONS];
    const i = a.indexOf('charge_label.deleted');
    expect(i).toBeGreaterThan(0);
    // REQ-20261011-ocean-dd C15 (additive): the step-8 actions are appended after the step-7 ones.
    expect(a.slice(i + 1)).toEqual([...NEW_AUDIT, 'dd_tariff.created', 'dd_tariff.updated', 'dd_calendar.created', 'dd_calendar.updated', 'dd_invoice.created', 'dd_invoice.updated', 'dd_invoice.deleted', 'dd_invoice.audited', 'claim.analysis_failed', 'auth.password.change_failed', 'invite.existing_account', 'claim.outcome_recorded']); // hardening C9/C15 (additive); claim outcomes (additive): claim.outcome_recorded last
    expect(new Set(a).size).toBe(a.length);
    // REQ-20261011-ocean-dd C16 (additive): intelligence.ocean_dd, registry ordered by key.
    expect(R.FEATURE_FLAGS.map((f) => f.key)).toEqual(['intelligence.charge_suggestions', 'intelligence.cost_outlook', 'intelligence.fuel_check', 'intelligence.ocean_dd', 'intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist']);
    expect({ ...R.FEATURE_FLAGS.find((f) => f.key === 'intelligence.cost_outlook') }).toEqual({ key: 'intelligence.cost_outlook', description: 'Cost outlook from public price data', defaultEnabled: true, tenantVisible: true });
    expect({ ...R.FEATURE_FLAGS.find((f) => f.key === 'intelligence.fuel_check') }).toEqual({ key: 'intelligence.fuel_check', description: 'Fuel tables and fuel-surcharge check', defaultEnabled: true, tenantVisible: true });
  });
});
