// REQ-20261011-fuel-outlook Tier L: T4 fuel check and evidence through `checkFuel` / `buildEvidenceFuel`
// (CI-F01..F12; Part C F5) and T17 step-5/6 parity guard (CI-L01, CI-L02). Fixed expectations from test-spec;
// CI-F12 compares with the test-owned exact oracle (helpers/fuel-oracle.ts) layered on the public step-6
// `buildEvidenceLearned` for the placement (F5.4) and the step-5 renderers for the letter and Markdown.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CITE_DIESEL, DIESEL, FROM_BASE, I1, IMPORT_ID, MPG, NOW, ROOT, ROWS_PCT, SHA_DIESEL, T1, TID, TODAY, URL_DIESEL, asOBundle, deepFreeze, fBundle,
  classifyOf, loadModules, makers, oracleDeps, type Bundle, type ChargeIntel, type Classifier, type Evidence, type FuelInput, type FuelMod, type FuelOut, type Mk, type Root,
} from './helpers/fuel-fixtures.js';
import { addDays, centsHalfEven, centsText, dec, oCheckFuel, oEvaluate, oPosting, qMul, type OTable } from './helpers/fuel-oracle.js';
import { at, oRng } from './helpers/outlook-oracle.js';
import type { TenantLabel } from './helpers/charge-oracle.js';

let R: Root;
let C: ChargeIntel;
let F: FuelMod;
let mk: Mk;
beforeAll(async () => {
  ({ R, C, F } = await loadModules());
  mk = makers(R);
});
type P = 'shipper' | 'carrier';
const ST = () => R.DEFAULT_ANALYSIS_SETTINGS;
const learned = (b: Bundle, p: P, cls: Classifier | null) => C.buildEvidenceLearned([], b, p, ST(), NOW, cls);
const fuelEv = (b: Bundle, p: P, cls: Classifier | null, input: FuelInput | null): FuelOut => F.buildEvidenceFuel([], b, p, ST(), NOW, cls, input);
const NO_CONFIRMED = '(No confirmed discrepancies.';
const OWN: Record<P, string> = { shipper: 'overcharge', carrier: 'underbilled' };
const L1 = 'Ship date 2026-10-07: the U.S. average diesel price posted 2026-10-05 applies 2026-10-07 to 2026-10-13 (Monday posting applies Wednesday to Tuesday).';
const L2 = `Price posted 2026-10-05: $6.199 per gallon (${CITE_DIESEL}; file sha256 aca8fefdbb54).`;
const PRICE_IMPORT = { id: IMPORT_ID, sha256: SHA_DIESEL, retrievedAt: '2026-10-11', sourceUrl: URL_DIESEL };

function expectRendered(ev: Evidence, b: Bundle) {
  const letter = R.buildDemandLetter(b, ev.result, TODAY, ST().disputeWindowDays);
  expect(ev.demand_letter).toBe(letter);
  expect(ev.markdown).toBe(R.renderPacketMarkdown(R.packetLoadNumber(b), ev.result.perspective, [], b, ev.result, letter));
}
const addCents = (a: string, b: string) => centsText(centsHalfEven(dec(a)) + centsHalfEven(dec(b)));

/** F5.4/F5.5 oracle: the fuel layer on top of buildEvidenceLearned, plus the checkFuel result. */
function expectMerged(b: Bundle, p: P, cls: Classifier | null, labels: readonly TenantLabel[] | null, input: FuelInput | null, tag = ''): FuelOut {
  const out = fuelEv(b, p, cls, input);
  const base = learned(b, p, cls);
  const o = oCheckFuel(asOBundle(b), input, oracleDeps(R, C, cls === null ? null : labels ?? []));
  expect(out.fuel, `${tag} fuel result`).toEqual(o.result);
  expect(F.checkFuel(b, input, classifyOf(cls)), `${tag} checkFuel`).toEqual(o.result);
  expect([out.learnedFindingsCount, out.reviewFlagsCount, out.labelIds], `${tag} learned counts`).toEqual([base.learnedFindingsCount, base.reviewFlagsCount, base.labelIds]);
  if (!o.finding) {
    expect(out.evidence, `${tag} parity-unchanged`).toEqual(base.evidence);
    expect(out.fuelFindingsCount, tag).toBe(0);
    return out;
  }
  const r = out.evidence.result;
  const br = base.evidence.result;
  const own = o.finding.direction === OWN[p];
  expect(r.findings, `${tag} own findings`).toEqual(own ? [...br.findings, o.finding] : br.findings);
  expect(r.ignored_findings, `${tag} ignored findings`).toEqual(own ? br.ignored_findings : [...br.ignored_findings, o.finding]);
  expect(r.recoverable_total, tag).toBe(br.recoverable_total);
  expect(r.pending_review_total, tag).toBe(own ? addCents(br.pending_review_total, o.finding.amount) : br.pending_review_total);
  for (const k of Object.keys(br)) if (!['findings', 'ignored_findings', 'pending_review_total'].includes(k)) expect(r[k], `${tag} result.${k}`).toEqual(br[k]);
  for (const k of Object.keys(base.evidence)) if (!['result', 'demand_letter', 'markdown'].includes(k)) expect(out.evidence[k], `${tag} evidence.${k}`).toEqual(base.evidence[k]);
  expect(out.evidence.demand_letter).not.toContain('Fuel surcharge differs');
  expectRendered(out.evidence, b);
  expect(out.fuelFindingsCount, tag).toBe(own ? 1 : 0);
  return out;
}

describe('T4 fixed bundles (F5)', () => {
  it('CI-F01 F1, I1, shipper, null classifier: one review finding with the exact texts', () => {
    const out = expectMerged(fBundle(mk), 'shipper', null, null, I1());
    const r = out.evidence.result;
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toEqual({
      rule_id: 'FSC-INDEX-MISMATCH', title: 'Fuel surcharge differs from the fuel table (review)', direction: 'overcharge', amount: '15.00', confidence: 0.7, needs_human_review: true,
      explanation: "Billed fuel surcharge $435.00 vs $420.00 from fuel table 'Std DOE table' for ship date 2026-10-07. Verify the table, the miles and the ship date before disputing.",
      calculation: [
        L1, L2,
        "Fuel table 'Std DOE table' v1: ceil(($6.199 - $1.20) / $0.06) = 84 step(s) x $0.01 per mile = $0.84 per mile.",
        'Expected: 500.0 miles x $0.84 per mile = $420.00.',
        "Billed fuel lines: 'Fuel surcharge' $435.00 = $435.00.",
        'Difference: $435.00 - $420.00 = $15.00.',
        'The billed amount equals the table result for the price posted 2026-09-28 ($6.382), 1 week(s) earlier than the applicable posting.',
      ],
    });
    expect([r.recoverable_total, r.pending_review_total]).toEqual(['0.00', '15.00']);
    expect(out.evidence.demand_letter).toContain(NO_CONFIRMED);
    expect(out.evidence.demand_letter).not.toContain('Fuel surcharge differs');
    expect(out.fuel).toMatchObject({
      checkVersion: 'fsc-v1', status: 'finding', priceSeries: 'diesel_us', postedDate: '2026-10-05', price: '6.199', effectiveFrom: '2026-10-07', effectiveTo: '2026-10-13',
      rate: '0.84', expected: '420.00', billed: '435.00', difference: '15.00', direction: 'overcharge',
      alternative: { postedDate: '2026-09-28', price: '6.382', weeks: 1, later: false }, priceImport: PRICE_IMPORT,
    });
    expect(out.fuel.calculation).toEqual(r.findings[0]?.calculation);
    expect(out.fuelFindingsCount).toBe(1);
  });
  it('CI-F02 F1, I1, carrier: own [], totals 0.00/0.00, the finding ends ignored_findings', () => {
    const out = expectMerged(fBundle(mk), 'carrier', null, null, I1());
    const r = out.evidence.result;
    expect([r.findings, r.recoverable_total, r.pending_review_total]).toEqual([[], '0.00', '0.00']);
    expect(r.ignored_findings.at(-1)?.rule_id).toBe('FSC-INDEX-MISMATCH');
    expect(r.ignored_findings.at(-1)?.amount).toBe('15.00');
    expect([out.fuel.status, out.fuelFindingsCount]).toEqual(['finding', 0]);
  });
  it('CI-F03 F2, I1, carrier: underbilled 20.00, negative difference text, no neighbouring posting', () => {
    const out = expectMerged(fBundle(mk, '400.00'), 'carrier', null, null, I1());
    const f = out.evidence.result.findings;
    expect(f).toHaveLength(1);
    expect([f[0]?.direction, f[0]?.amount]).toEqual(['underbilled', '20.00']);
    expect(f[0]?.calculation).toHaveLength(6);
    expect(f[0]?.calculation[5]).toBe('Difference: $400.00 - $420.00 = $-20.00.');
    expect([out.fuel.difference, out.fuel.alternative]).toEqual(['-20.00', null]);
    expect(out.evidence.result.pending_review_total).toBe('20.00');
  });
  it('CI-F04 F3 with TP (percent rows), shipper: 32.25 overcharge, 2 weeks earlier', () => {
    const out = expectMerged(fBundle(mk, '731.00'), 'shipper', null, null, I1({ table: ROWS_PCT(), miles: null }));
    const f = out.evidence.result.findings.at(-1);
    expect([f?.amount, f?.direction]).toEqual(['32.25', 'overcharge']);
    expect(f?.calculation.slice(2)).toEqual([
      "Fuel table 'Pct table' v1: row from $6.00 applies: 32.5%.",
      'Expected: 32.5% x linehaul $2150.00 (rate confirmation) = $698.75.',
      "Billed fuel lines: 'Fuel surcharge' $731.00 = $731.00.",
      'Difference: $731.00 - $698.75 = $32.25.',
      'The billed amount equals the table result for the price posted 2026-09-21 ($6.529), 2 week(s) earlier than the applicable posting.',
    ]);
  });
  it('CI-F05 F4 with TM (mpg, 3 decimals), 500.0 miles: within_tolerance, 6 calculation lines, evidence = buildEvidenceLearned', () => {
    for (const p of ['shipper', 'carrier'] as const) {
      const out = expectMerged(fBundle(mk, '412.50'), p, null, null, I1({ table: MPG('1.25', '6', 3) }));
      expect(out.fuel.status).toBe('within_tolerance');
      expect(out.fuel.calculation).toEqual([
        L1, L2,
        "Fuel table 'MPG table' v1: ($6.199 - $1.25) / 6 mpg = $0.825 per mile (rounded half up to 3 decimals).",
        'Expected: 500.0 miles x $0.825 per mile = $412.50.',
        "Billed fuel lines: 'Fuel surcharge' $412.50 = $412.50.",
        'Difference: $412.50 - $412.50 = $0.00.',
      ]);
      expect([out.fuel.direction, out.fuel.alternative, out.fuel.difference]).toEqual([null, null, '0.00']);
      expect(out.evidence).toEqual(learned(fBundle(mk, '412.50'), p, null).evidence);
    }
  });
  it('CI-F06 from_base table: 1 + floor(...) = 102 steps; 510.00 is within tolerance', () => {
    const out = expectMerged(fBundle(mk, '510.00'), 'shipper', null, null, I1({ table: FROM_BASE() }));
    expect(out.fuel.status).toBe('within_tolerance');
    expect(out.fuel.expected).toBe('510.00');
    expect(out.fuel.calculation[2]).toBe("Fuel table 'Bison-style' v1: 1 + floor(($6.199 - $1.12) / $0.05) = 102 step(s) x $0.01 per mile = $1.02 per mile.");
  });
  it('CI-F07 tolerance boundary: 420.01 within_tolerance; 420.02 finding 0.02', () => {
    expect(expectMerged(fBundle(mk, '420.01'), 'shipper', null, null, I1()).fuel.status).toBe('within_tolerance');
    const out = expectMerged(fBundle(mk, '420.02'), 'shipper', null, null, I1());
    expect(out.fuel.status).toBe('finding');
    expect(out.evidence.result.findings.at(-1)?.amount).toBe('0.02');
  });
});

describe('CI-F08 statuses (shipper; evidence deep-equals buildEvidenceLearned except the last case)', () => {
  const nul = { priceSeries: null, postedDate: null, price: null, effectiveFrom: null, effectiveTo: null, rate: null, expected: null, billed: null, difference: null, direction: null, alternative: null, calculation: [], priceImport: null };
  const cases: [string, () => Bundle, () => FuelInput | null, string][] = [
    ['input null', () => fBundle(mk), () => null, 'no_inputs'],
    ['T1 archived', () => fBundle(mk), () => I1({ table: T1({ archived: true }) }), 'table_archived'],
    ["rate confirmation fuel_surcharge '435.00'", () => fBundle(mk, '435.00', { fuel_surcharge: '435.00' }), () => I1(), 'contract_amount'],
    ['invoice without a fuel line', () => mk.bundle({ invoice: mk.inv([['Linehaul', '2150.00']]), rate_confirmation: mk.rc() }), () => I1(), 'no_fuel_line'],
    ['no invoice', () => mk.bundle({ rate_confirmation: mk.rc() }), () => I1(), 'no_fuel_line'],
    ['ship date 2026-10-14', () => fBundle(mk), () => I1({ shipDate: '2026-10-14' }), 'price_unavailable'],
    ['series null', () => fBundle(mk), () => I1({ series: null }), 'price_unavailable'],
  ];
  it.each(cases)('%s -> %s (all nullable fields null, calculation [])', (_l, b, input, status) => {
    const out = expectMerged(b(), 'shipper', null, null, input());
    expect(out.fuel).toEqual({ checkVersion: 'fsc-v1', status, ...nul });
    expect(out.evidence).toEqual(learned(b(), 'shipper', null).evidence);
  });
  it('miles null with T1 -> miles_missing (posting fields, rate 0.84, billed 435.00 set; expected null; calculation [])', () => {
    const out = expectMerged(fBundle(mk), 'shipper', null, null, I1({ miles: null }));
    expect(out.fuel).toEqual({
      checkVersion: 'fsc-v1', status: 'miles_missing', priceSeries: 'diesel_us', postedDate: '2026-10-05', price: '6.199', effectiveFrom: '2026-10-07', effectiveTo: '2026-10-13',
      rate: '0.84', expected: null, billed: '435.00', difference: null, direction: null, alternative: null, calculation: [], priceImport: PRICE_IMPORT,
    });
  });
  it('TP, no rate confirmation, invoice [Fuel surcharge 731.00] -> no_linehaul', () => {
    const b = mk.bundle({ invoice: mk.inv([['Fuel surcharge', '731.00']]) });
    const out = expectMerged(b, 'shipper', null, null, I1({ table: ROWS_PCT(), miles: null }));
    expect(out.fuel).toMatchObject({ status: 'no_linehaul', rate: '32.5', billed: '731.00', expected: null, difference: null, calculation: [] });
  });
  it('TP, no rate confirmation, invoice [Linehaul 2150.00, Fuel surcharge 731.00] -> finding, basis invoice linehaul lines', () => {
    const b = mk.bundle({ invoice: mk.inv([['Linehaul', '2150.00'], ['Fuel surcharge', '731.00']]) });
    const out = expectMerged(b, 'shipper', null, null, I1({ table: ROWS_PCT(), miles: null }));
    expect(out.fuel.status).toBe('finding');
    expect(out.fuel.calculation[3]).toBe('Expected: 32.5% x linehaul $2150.00 (invoice linehaul lines) = $698.75.');
  });
});

describe('CI-F09..F11 line handling, classifier, determinism', () => {
  it('CI-F09 a duplicated identical fuel line counts once; INV-DUPLICATE still present', () => {
    const b = mk.bundle({ invoice: mk.inv([['Linehaul', '2150.00'], ['Fuel surcharge', '435.00'], ['Fuel surcharge', '435.00']]), rate_confirmation: mk.rc() });
    const out = expectMerged(b, 'shipper', null, null, I1());
    expect(out.fuel.billed).toBe('435.00');
    const ids = out.evidence.result.findings.map((f) => f.rule_id);
    expect(ids).toContain('INV-DUPLICATE');
    expect(ids.filter((x) => x === 'FSC-INDEX-MISMATCH')).toHaveLength(1);
    expect(out.evidence.result.findings.at(-1)?.amount).toBe('15.00');
  });
  it('CI-F09 two different fuel lines are listed in line order', () => {
    const b = mk.bundle({ invoice: mk.inv([['Linehaul', '2150.00'], ['Fuel surcharge', '400.00'], ['Fuel adj', '35.00']]), rate_confirmation: mk.rc() });
    expect(R.classifyLine('Fuel adj')).toBe('fuel');
    const out = expectMerged(b, 'shipper', null, null, I1());
    expect(out.fuel.calculation[4]).toBe("Billed fuel lines: 'Fuel surcharge' $400.00, 'Fuel adj' $35.00 = $435.00.");
  });
  it('CI-F10 a classifier-suggested fuel line is added and marked; with a null classifier the check is within tolerance', () => {
    const labels: TenantLabel[] = [{ id: '0f5c0000-0000-4000-8000-0000000000aa', description: 'Energy adjustment', category: 'fuel' }];
    const cls = C.buildChargeClassifier(labels);
    const b = mk.bundle({ invoice: mk.inv([['Linehaul', '2150.00'], ['Fuel surcharge', '420.00'], ['Energy adjustment', '15.00']]), rate_confirmation: mk.rc() });
    const out = expectMerged(b, 'shipper', cls, labels, I1());
    expect(out.evidence.result.findings.at(-1)?.amount).toBe('15.00');
    expect(out.fuel.calculation[4]).toBe("Billed fuel lines: 'Fuel surcharge' $420.00, 'Energy adjustment' $15.00 (suggested fuel line) = $435.00.");
    expect(expectMerged(b, 'shipper', null, null, I1()).fuel.status).toBe('within_tolerance');
  });
  it('CI-F11 determinism and purity on deep-frozen inputs', () => {
    const mkAll = () => deepFreeze({ b: fBundle(mk), input: I1({ series: { ...DIESEL(), observations: DIESEL().observations.map((o) => ({ ...o })) } }) });
    const a = mkAll();
    const x = fuelEv(a.b, 'shipper', null, a.input);
    const y = fuelEv(a.b, 'shipper', null, a.input);
    expect(x).toEqual(y);
    expect(F.checkFuel(a.b, a.input, null)).toEqual(x.fuel);
    expect(a.b).toEqual(fBundle(mk));
    expect(a.input.table).toEqual(T1());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CI-F12 property (seed recorded)
// ---------------------------------------------------------------------------------------------------------------
const SEED_F12 = 7120261;
const LABEL_POOL: TenantLabel[] = [
  { id: '0f5c0000-0000-4000-8000-0000000000b1', description: 'Energy adjustment', category: 'fuel' },
  { id: '0f5c0000-0000-4000-8000-0000000000b2', description: 'Diesel adder', category: 'fuel' },
  { id: '0f5c0000-0000-4000-8000-0000000000b3', description: 'Pallet jack rental', category: 'accessorial' },
];
function genCase(rnd: () => number, i: number) {
  const pick = <T>(a: readonly T[]): T => at(a, Math.floor(rnd() * a.length));
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const unit = rnd() < 0.55 ? 'per_mile' : 'percent';
  const kr = rnd();
  const name = `Gen table ${i}`;
  const off = rnd() < 0.6 ? 2 : int(0, 6);
  const common = { id: TID(5000 + i), name, version: int(1, 4), priceSeries: 'diesel_us' as const, effectiveOffsetDays: off, archived: rnd() < 0.04 };
  let table: OTable & { id: string };
  if (kr < 0.45) table = { ...common, kind: 'step', unit, params: { basePrice: pick(['1.12', '1.20', '1.25', '2.00', '3.5']), stepSize: pick(['0.05', '0.06', '0.1', '0.025']), ratePerStep: unit === 'per_mile' ? pick(['0.01', '0.005', '0.02']) : pick(['0.5', '1', '0.25']), bracket: rnd() < 0.5 ? 'above_base' : 'from_base' } };
  else if (kr < 0.65) table = { ...common, kind: 'mpg', unit: 'per_mile', params: { basePrice: pick(['1.20', '1.25', '2.5']), mpg: pick(['5', '6', '6.5', '7.25']), decimals: pick([2, 3, 4] as const) } };
  else {
    const rows: { atLeast: string; rate: string }[] = [];
    let cur = int(900, 2500);
    for (let r = 0, n = int(1, 8); r < n; r++) { rows.push({ atLeast: `${Math.floor(cur / 1000)}.${String(cur % 1000).padStart(3, '0')}`, rate: unit === 'per_mile' ? pick(['0.30', '0.45', '0.6', '0.8125']) : pick(['20', '27.5', '32.125', '40']) }); cur += int(100, 900); }
    table = { ...common, kind: 'rows', unit, params: { rows } };
  }
  const shipDate = rnd() < 0.05 ? pick(['2026-10-14', '1994-03-22', '2027-01-01']) : addDays('1994-03-23', int(0, 11880));
  const miles = rnd() < 0.06 ? null : `${int(1, 3000)}.${int(0, 9)}`;
  const series = rnd() < 0.03 ? null : DIESEL();
  const rcKind = rnd();
  const lhLine = rnd() < 0.8;
  const linehaul = `${int(500, 5000)}.${String(int(0, 99)).padStart(2, '0')}`;
  // expected amount under the oracle (to place billed near / far / on a neighbouring week)
  const post = series ? oPosting(series.observations, shipDate, off) : null;
  const L = rcKind < 0.7 ? linehaul : lhLine ? linehaul : null;
  const expFor = (price: string): bigint | null => {
    const rate = dec(oEvaluate(table, price).rate);
    if (table.unit === 'per_mile') return miles === null ? null : centsHalfEven(qMul(dec(miles), rate));
    return L === null ? null : centsHalfEven(qMul(qMul(rate, dec(L)), { n: 1n, d: 100n }));
  };
  const e = post ? expFor(post.price) : null;
  const near = (c: bigint) => { const d = BigInt(pick([0, 0, 1, -1, 2, -2, 150, -150, 1234])); return c + d > 0n ? c + d : 1n; };
  let billedC: bigint;
  const neigh = post && series ? series.observations[post.index + pick([-1, -2, -3, 1])] : undefined;
  if (e !== null && neigh && rnd() < 0.3) billedC = expFor(neigh.value) ?? 1n;
  else if (e !== null) billedC = near(e);
  else billedC = BigInt(int(1, 200000));
  if (billedC <= 0n) billedC = 1n;
  const billed = centsText(billedC);
  const fuelDesc = pick(['Fuel surcharge', 'FSC fuel surcharge', 'Fuel', 'Fuel adj']);
  const lines: [string, string][] = [];
  if (lhLine) lines.push(['Linehaul', linehaul]);
  const split = rnd() < 0.2 && billedC > 100n;
  if (split) { lines.push([fuelDesc, centsText(billedC - 100n)]); lines.push([rnd() < 0.5 ? 'Energy adjustment' : 'Fuel adj', '1.00']); }
  else if (rnd() < 0.95) lines.push([fuelDesc, billed]);
  if (rnd() < 0.1 && lines.length) lines.push([...at(lines, lines.length - 1)] as [string, string]);
  if (rnd() < 0.2) lines.push([pick(['Detention', 'Lumper fee', 'Diesel adder', 'Pallet jack rental']), `${int(10, 300)}.00`]);
  const rc = rcKind < 0.7 ? { linehaul_rate: linehaul, fuel_surcharge: rnd() < 0.05 ? billed : null } : rcKind < 0.85 ? { linehaul_rate: null, fuel_surcharge: null } : null;
  const labels = rnd() < 0.4 ? LABEL_POOL.filter(() => rnd() < 0.6) : null;
  return { lines, rc, input: rnd() < 0.03 ? null : { shipDate, miles, table, series }, labels };
}
describe(`CI-F12 oracle agreement (seed ${SEED_F12}, 300 cases x 2 perspectives)`, () => {
  it('status, every FuelCheckResult field, the finding and its placement equal the oracle', () => {
    const rnd = oRng(SEED_F12);
    const statuses = new Map<string, number>();
    let alts = 0;
    for (let i = 0; i < 300; i++) {
      const c = genCase(rnd, i);
      const b = mk.bundle({ invoice: mk.inv(c.lines), rate_confirmation: c.rc === null ? null : mk.rc(c.rc) });
      const cls = c.labels === null ? null : C.buildChargeClassifier(c.labels);
      for (const p of ['shipper', 'carrier'] as const) {
        const out = expectMerged(b, p, cls, c.labels, c.input, `case ${i} ${p} ${JSON.stringify({ lines: c.lines, rc: c.rc, input: c.input && { ...c.input, series: c.input.series ? 'DIESEL' : null } })}`);
        if (p === 'shipper') { statuses.set(out.fuel.status, (statuses.get(out.fuel.status) ?? 0) + 1); if (out.fuel.alternative) alts++; }
      }
    }
    for (const s of ['no_inputs', 'table_archived', 'contract_amount', 'no_fuel_line', 'price_unavailable', 'miles_missing', 'no_linehaul', 'within_tolerance', 'finding']) expect(statuses.get(s) ?? 0, `corpus covers ${s}`).toBeGreaterThan(0);
    expect(statuses.get('finding') ?? 0).toBeGreaterThan(60);
    expect(alts, 'corpus cites neighbouring postings').toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T17 parity guard
// ---------------------------------------------------------------------------------------------------------------
describe('T17 step-5/6 parity guard', () => {
  it('CI-L01 input null: buildEvidenceFuel deep-equals buildEvidenceLearned (B1, B3 of step 6 and F1-F4; with/without classifier; both perspectives)', () => {
    const B1 = mk.bundle({
      invoice: mk.inv([['Linehaul', '1500.00'], ['Fuel surcharge', '300.00'], ['Sort and segregate', '85.00'], ['Lumper fee', '150.00'], ['Scale ticket', '12.00'], ['Appointment fee', '40.00']], '2087.00'),
      rate_confirmation: mk.rc({ linehaul_rate: '1500.00', fuel_surcharge: '300.00', authorized_accessorials: ['Appointment'] }),
    });
    const B3 = mk.bundle({
      invoice: mk.inv([['Linehaul', '1200.00'], ['Driver waiting time', '75.00']], null),
      rate_confirmation: mk.rc({ linehaul_rate: '1200.00', fuel_surcharge: null, detention_free_hours: '2', detention_rate_per_hour: '50.00', detention_max_hours: null, authorized_accessorials: [] }),
      bol: { ...(R.emptyBillOfLading as () => Record<string, unknown>)(), arrival_time: '2026-03-02T08:00:00', departure_time: '2026-03-02T12:30:00', appointment_time: null },
    });
    const all = [['B1', B1], ['B3', B3], ['F1', fBundle(mk)], ['F2', fBundle(mk, '400.00')], ['F3', fBundle(mk, '731.00')], ['F4', fBundle(mk, '412.50')]] as const;
    for (const [label, b] of all) for (const cls of [null, C.buildChargeClassifier([])]) for (const p of ['shipper', 'carrier'] as const) {
      const out = fuelEv(b, p, cls, null);
      const base = learned(b, p, cls);
      const tag = `${label} ${p} ${cls ? 'L0' : 'null'}`;
      expect(out.evidence, tag).toEqual(base.evidence);
      expect([out.learnedFindingsCount, out.reviewFlagsCount, out.labelIds], tag).toEqual([base.learnedFindingsCount, base.reviewFlagsCount, base.labelIds]);
      expect([out.fuel.status, out.fuelFindingsCount], tag).toEqual(['no_inputs', 0]);
    }
  });
  it('CI-L02 packages/shared/src/analysis and charge-intel: the frozen step-5/6 engine files are unchanged (pinned sha256, no git needed)', () => {
    // Review finding 8: the git-history version skipped silently on shallow CI clones. These are the sha256 values of
    // the LF-normalized content, identical at 5f7eb7e and at 1a95245 (and in the CRLF working tree after stripping
    // CR). Test files (*.test.ts) are not engine files. Any change, including an export-only edit to an index.ts,
    // fails here and needs a reviewed, additive pin update.
    const FROZEN: Record<string, string> = {
      'analysis/copy.ts': 'a79dd9a6acf544283f68f8aa85ea307e3f34d8be03934337cfba981a280954c4',
      'analysis/detention.ts': 'b71e4ff17bbed9c4350c5d963eb37869a3e944d83109bb1a943df1cc67464d62',
      'analysis/engine.ts': '859d4cb101510202cb66b276b482f796b603c5d2e30de169304ebd885d7e0919',
      'analysis/evidence.ts': 'af7454ed187515f760b742cf6140b1ef9bac6f2664a7ea91a67628576610c596',
      'analysis/index.ts': '9b9f5c29d683b2f861fe9c0c2b58e9dd6e9a900685d108afbab495c094e80386',
      'analysis/invoice-checks.ts': 'af7cfde8b39b5480cdecf4418b4bb8933918638f6e3eaa2cfd7bf0d9b1687d06',
      'analysis/letter.ts': 'd3e64c792fa455617325e642d23fbf08d569d01a9d363e493be00d86af2909f5',
      'analysis/local-datetime.ts': '373a43188ba4c994237911db60219cb2562e977f67361c21ef42f91bd76fbe33',
      'analysis/markdown.ts': '91513618b5740daab6df8ffcceb38cede7703fff30865dcd2e666aab804fb25e',
      'analysis/py-decimal.ts': '3427fa288bc81f1e967a0c03caec68f81da341583cb93f7ce48335bec62c153f',
      'analysis/py-text.ts': '64246b09e8a9b608d959e71528657e1b63673c1de8a2a748858d1e57b6955d37',
      'analysis/tariff-detention.ts': '1dd9e247e575238217ecf9d689ad854985616b16cddfe6f783dc8363a54c9772',
      'analysis/types.ts': 'b009eb1f482740fca0ae455d84dbdf85d698465136cd13d9d09d60f5b09174e6',
      // REQ-20261019-seed-v2 (additive pin update, reviewed): classifier, constants, copy, evaluate and index point the
      // default seed at tariff-seed-v2; seed-v2.ts and curve.ts (learning curve) are new; features, learned and seed-v1 unchanged.
      'charge-intel/classifier.ts': '78511ff6da77d6e14d58beea260c62ff6d1f1a115e81daa4af4f5cf97120db4f',
      'charge-intel/constants.ts': '82b34be267d9881c603ed0eafa3376a25de7643c6b954533f770d9185ecf7ccf',
      'charge-intel/copy.ts': '56ab8c4450e2137cd10e90ef7f8fdb9af08854488e798dbd068c927daa395b55',
      'charge-intel/curve.ts': '992a817d74d6ad3e50694ba9f5c2ebfd8e52eff97aaf380aed65c1430dc08de2',
      'charge-intel/evaluate.ts': 'e843f73bac276aafe0fcb44e5224efb5f76ad8df64e912c657b6366aec98f1bf',
      'charge-intel/features.ts': '504781cf3017f9c1126c54d83066811cb2ca647d9a9d03fef36f886b7c7f1ee9',
      'charge-intel/index.ts': '90493ffe2fadd704deecfda7768d884a35526766b17a95a21672584dc87ea4cf',
      'charge-intel/learned.ts': 'c532a60f9c59ccff25a7ea276ac00feb42c37172f2f75ccae25cd9e562821787',
      'charge-intel/seed-v1.ts': '7de8d2d109cbb875371060fdd79981d23096eb0db274e7ffaf25f06a08993bf3',
      'charge-intel/seed-v2.ts': '5a8ac080d89e0dda9696b97c47dccac5249e31aa0babf208cd8f74d522de55e1',
    };
    const SRC = resolve(ROOT, 'packages', 'shared', 'src');
    const present = ['analysis', 'charge-intel'].flatMap((d) => readdirSync(resolve(SRC, d)).filter((f) => !f.endsWith('.test.ts')).map((f) => `${d}/${f}`)).sort();
    expect(present, 'no engine file added or removed').toEqual(Object.keys(FROZEN).sort());
    for (const [f, h] of Object.entries(FROZEN)) {
      const lf = readFileSync(resolve(SRC, f), 'latin1').replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(Buffer.from(lf, 'latin1')).digest('hex'), f).toBe(h);
    }
  });
});
