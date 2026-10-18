// REQ-20261011-fuel-outlook Tier L: T3 week rule and FSC table evaluation (CI-W01..W05; Part C F3, F4). Fixed
// expectations from test-spec; the properties compare the product with the test-owned exact oracle
// (helpers/fuel-oracle.ts, BigInt rationals). PRNG: mulberry32, seeds recorded below.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DIESEL, FROM_BASE, I1, MPG, NOW, ROWS_PCT, STEP_PCT, T1, TID, fBundle, loadModules, makers,
  type ChargeIntel, type FuelMod, type Mk, type Root,
} from './helpers/fuel-fixtures.js';
import { addDays, centsHalfEven, dayNum, oEvaluate, oPosting, q, ruleText, type OTable } from './helpers/fuel-oracle.js';
import { at, oRng } from './helpers/outlook-oracle.js';

let R: Root;
let C: ChargeIntel;
let F: FuelMod;
let mk: Mk;
beforeAll(async () => {
  ({ R, C, F } = await loadModules());
  mk = makers(R);
});
const SEED_W02 = 7020261;
const SEED_W04 = 7040261;

describe('T3 week rule (F3)', () => {
  const rows: [string, string | null, string, string, string][] = [
    ['2026-10-05', '2026-09-28', '6.382', '2026-09-30', '2026-10-06'],
    ['2026-10-06', '2026-09-28', '6.382', '2026-09-30', '2026-10-06'],
    ['2026-10-07', '2026-10-05', '6.199', '2026-10-07', '2026-10-13'],
    ['2026-10-13', '2026-10-05', '6.199', '2026-10-07', '2026-10-13'],
    ['2026-10-14', null, '', '', ''],
    ['1994-03-22', null, '', '', ''],
    ['1994-03-23', '1994-03-21', '1.106', '1994-03-23', '1994-03-29'],
  ];
  it.each(rows)('CI-W01 offset 2: ship date %s -> posted %s', (ship, posted, price, from, to) => {
    const p = F.applicablePosting(DIESEL().observations, ship, 2);
    if (posted === null) expect(p).toBeNull();
    else {
      expect(p).toMatchObject({ date: posted, value: price, effectiveFrom: from, effectiveTo: to });
      expect(DIESEL().observations[p?.index ?? -1]?.date).toBe(posted);
    }
  });
  it('CI-W01 offset 0: 2026-10-05 -> 2026-10-05 (6.199); 2026-10-12 -> null', () => {
    expect(F.applicablePosting(DIESEL().observations, '2026-10-05', 0)).toMatchObject({ date: '2026-10-05', value: '6.199', effectiveFrom: '2026-10-05', effectiveTo: '2026-10-11' });
    expect(F.applicablePosting(DIESEL().observations, '2026-10-12', 0)).toBeNull();
  });
  it.each([[2, 'Monday posting applies Wednesday to Tuesday'], [0, 'Monday posting applies Monday to Sunday'], [6, 'Monday posting applies Sunday to Saturday']] as const)(
    'CI-W01 rule text for offset %i (calculation line 1 of the fuel check)', (o, text) => {
      expect(ruleText(o)).toBe(text);
      const ship = addDays('2026-10-05', o);
      const r = F.buildEvidenceFuel([], fBundle(mk), 'shipper', R.DEFAULT_ANALYSIS_SETTINGS, NOW, null, I1({ shipDate: ship, table: T1({ effectiveOffsetDays: o }) })).fuel;
      expect(r.calculation[0]).toBe(`Ship date ${ship}: the U.S. average diesel price posted 2026-10-05 applies ${ship} to ${addDays(ship, 6)} (${text}).`);
    });
  it(`CI-W02 property: 500 seeded ship dates x offsets 0..6 equal the oracle (seed ${SEED_W02})`, () => {
    const rnd = oRng(SEED_W02);
    const obs = DIESEL().observations;
    const lo = dayNum('1994-01-01');
    const hi = dayNum('2026-12-31');
    let found = 0;
    for (let i = 0; i < 500; i++) {
      const d = addDays('1994-01-01', Math.floor(rnd() * (hi - lo + 1)));
      for (let o = 0; o <= 6; o++) {
        const exp = oPosting(obs, d, o);
        const got = F.applicablePosting(obs, d, o);
        if (exp === null) { expect(got, `${d} o=${o}`).toBeNull(); continue; }
        found++;
        expect(got, `${d} o=${o}`).toMatchObject({ index: exp.index, date: exp.postedDate, value: exp.price, effectiveFrom: exp.effectiveFrom, effectiveTo: exp.effectiveTo });
        expect(dayNum(exp.effectiveFrom) <= dayNum(d) && dayNum(d) <= dayNum(exp.effectiveTo)).toBe(true);
        expect(dayNum(exp.effectiveTo) - dayNum(exp.effectiveFrom)).toBe(6);
      }
    }
    expect(found).toBeGreaterThan(3000);
  }, 20_000);
});

describe('T3 table evaluation (F4)', () => {
  const t1 = T1();
  const fb = FROM_BASE();
  const table: [string, OTable, string, string, number | null][] = [
    ['T1', t1, '1.200', '0', 0], ['T1', t1, '1.201', '0.01', 1], ['T1', t1, '1.260', '0.01', 1], ['T1', t1, '1.261', '0.02', 2],
    ['T1', t1, '6.199', '0.84', 84], ['T1', t1, '6.382', '0.87', 87], ['T1', t1, '6.529', '0.89', 89], ['T1', t1, '6.285', '0.85', 85],
    ['from_base', fb, '1.119', '0', 0], ['from_base', fb, '1.120', '0.01', 1], ['from_base', fb, '1.169', '0.01', 1], ['from_base', fb, '1.170', '0.02', 2], ['from_base', fb, '6.199', '1.02', 102],
    ['mpg 1.25/6/2', MPG('1.25', '6', 2), '6.199', '0.82', null], ['mpg 1.25/6/3', MPG('1.25', '6', 3), '6.199', '0.825', null],
    ['mpg 1.25/6.5/3', MPG('1.25', '6.5', 3), '6.382', '0.790', null], ['mpg 1.20/6/2 half-up tie', MPG('1.20', '6', 2), '1.230', '0.01', null],
    ['mpg 1.25/6/2 at base', MPG('1.25', '6', 2), '1.250', '0', null],
    ['rows', ROWS_PCT(), '4.999', '0', null], ['rows', ROWS_PCT(), '6.199', '32.5', null], ['rows', ROWS_PCT(), '6.500', '34', null],
    ['step pct 1.20/0.05/0.5', STEP_PCT(), '6.199', '50.0', 100],
    ['T1 exactly 100 steps', t1, '7.200', '1.00', 100], ['T1 99 steps', t1, '7.140', '0.99', 99],
  ];
  it.each(table)('CI-W03 %s at %s -> rate %s', (_l, t, price, rate, steps) => {
    const got = F.evaluateFscTable(t, price);
    expect(got.rate).toBe(rate);
    if (steps !== null) expect(got.steps).toBe(steps);
    else expect(got.steps).toBeNull();
    expect(got).toEqual(oEvaluate(t, price));
  });
  it('CI-W03 result fields: row index for rows tables, reachesFirstStep false exactly below the first step/row', () => {
    expect(F.evaluateFscTable(ROWS_PCT(), '6.199')).toEqual({ rate: '32.5', steps: null, row: 1, reachesFirstStep: true });
    expect(F.evaluateFscTable(ROWS_PCT(), '4.999')).toEqual({ rate: '0', steps: null, row: null, reachesFirstStep: false });
    expect(F.evaluateFscTable(T1(), '1.200')).toEqual({ rate: '0', steps: 0, row: null, reachesFirstStep: false });
    expect(F.evaluateFscTable(MPG('1.25', '6', 2), '1.250')).toEqual({ rate: '0', steps: null, row: null, reachesFirstStep: false });
  });

  // -------------------------------------------------------------------------------------------------------------
  const genTable = (rnd: () => number, i: number): { t: OTable & { id: string }; boundary: string[] } => {
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const decTxt = (intMin: number, intMax: number, fracMax: number, minFrac = 0) => {
      const fd = int(minFrac, fracMax);
      const ip = String(int(intMin, intMax));
      return fd === 0 ? ip : `${ip}.${Array.from({ length: fd }, () => String(int(0, 9))).join('')}`;
    };
    const pos = (f: () => string) => { for (;;) { const s = f(); if (Number(s) > 0) return s; } };
    const unit = rnd() < 0.5 ? 'per_mile' : 'percent';
    const rate = () => pos(() => (unit === 'per_mile' ? decTxt(0, rnd() < 0.8 ? 0 : 9, 4) : (() => { for (;;) { const s = decTxt(0, 100, 3); if (Number(s) <= 100) return s; } })()));
    const kindR = rnd();
    const base = { id: TID(1000 + i), name: `Gen ${i}`, version: 1, priceSeries: 'diesel_us' as const, effectiveOffsetDays: int(0, 6), archived: false };
    const boundary: string[] = [];
    if (kindR < 0.4) {
      const B = pos(() => decTxt(0, 4, rnd() < 0.6 ? 3 : 4, 1));
      const S = pos(() => decTxt(0, 0, rnd() < 0.6 ? 3 : 4, 1));
      const k3 = (s: string) => /^\d+(\.\d{1,3})?$/.test(s);
      if (k3(B) && k3(S)) for (const k of [0, 1, 2, int(3, 80)]) {
        const v = q(BigInt(Math.round(Number(B) * 1000)) + BigInt(k) * BigInt(Math.round(Number(S) * 1000)), 1000n);
        boundary.push(`${v.n * (1000n / v.d) / 1000n}.${String(v.n * (1000n / v.d) % 1000n).padStart(3, '0')}`);
      }
      return { t: { ...base, kind: 'step', unit, params: { basePrice: B, stepSize: S, ratePerStep: rate(), bracket: rnd() < 0.5 ? 'above_base' : 'from_base' } }, boundary };
    }
    if (kindR < 0.65) {
      const B = pos(() => decTxt(0, 4, 4, 1));
      const M = (() => { for (;;) { const s = decTxt(1, 20, 2); if (Number(s) >= 1 && Number(s) <= 20) return s; } })();
      return { t: { ...base, kind: 'mpg', unit: 'per_mile', params: { basePrice: B, mpg: M, decimals: (2 + int(0, 2)) as 2 | 3 | 4 } }, boundary };
    }
    const n = rnd() < 0.15 ? 200 : int(1, 12);
    const rows: { atLeast: string; rate: string }[] = [];
    let cur = int(500, 1500); // thousandths
    for (let r = 0; r < n; r++) {
      const txt = `${Math.floor(cur / 1000)}.${String(cur % 1000).padStart(3, '0')}`;
      rows.push({ atLeast: rnd() < 0.2 ? `${txt}0` : txt, rate: rate() });
      if (rnd() < 0.3) boundary.push(txt);
      cur += int(1, n > 50 ? 40 : 600);
    }
    return { t: { ...base, kind: 'rows', unit, params: { rows } }, boundary };
  };
  it(`CI-W04 property: 2,000 seeded (table, price) pairs equal the oracle, incl. exact step boundaries and 200-row tables (seed ${SEED_W04})`, () => {
    const rnd = oRng(SEED_W04);
    let boundaries = 0;
    let big = 0;
    let reached = 0;
    for (let i = 0; i < 2000; i++) {
      const { t, boundary } = genTable(rnd, i);
      const useB = boundary.length > 0 && rnd() < 0.5;
      const price = useB ? at(boundary, Math.floor(rnd() * boundary.length)) : `${1 + Math.floor(rnd() * 10)}.${String(Math.floor(rnd() * 1000)).padStart(3, '0')}`;
      if (useB) boundaries++;
      if (t.kind === 'rows' && t.params.rows.length === 200) big++;
      const exp = oEvaluate(t, price);
      if (exp.reachesFirstStep) reached++;
      expect(F.evaluateFscTable(t, price), `${i} ${JSON.stringify(t)} @ ${price}`).toEqual(exp);
    }
    expect(boundaries).toBeGreaterThan(300);
    expect(big).toBeGreaterThan(20);
    expect(reached).toBeGreaterThan(600);
  });
  it('CI-W05 invalid params throw (per kind)', () => {
    const bad: [string, OTable][] = [
      ["stepSize '0'", T1({ params: { basePrice: '1.20', stepSize: '0', ratePerStep: '0.01', bracket: 'above_base' } } as Partial<OTable & { id: string }>)],
      ["basePrice '1.2345678'", T1({ params: { basePrice: '1.2345678', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' } } as Partial<OTable & { id: string }>)],
      ["mpg '0.5'", MPG('1.25', '0.5', 2)],
      ['decimals 5', MPG('1.25', '6', 5 as 2)],
      ['unsorted rows', ROWS_PCT({ params: { rows: [{ atLeast: '6.00', rate: '32.5' }, { atLeast: '5.00', rate: '30' }] } } as Partial<OTable & { id: string }>)],
      ['201 rows', ROWS_PCT({ params: { rows: Array.from({ length: 201 }, (_, i) => ({ atLeast: `${1 + Math.floor(i / 100)}.${String(i % 100).padStart(2, '0')}`, rate: '1' })) } } as Partial<OTable & { id: string }>)],
      ["percent rate '100.001'", ROWS_PCT({ params: { rows: [{ atLeast: '5.00', rate: '100.001' }] } } as Partial<OTable & { id: string }>)],
      ["per-mile rate '10'", T1({ params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '10', bracket: 'above_base' } } as Partial<OTable & { id: string }>)],
    ];
    for (const [label, t] of bad) expect(() => F.evaluateFscTable(t, '6.199'), label).toThrow();
    // the valid neighbours of the bad values evaluate
    expect(() => F.evaluateFscTable(MPG('1.25', '1', 4), '6.199')).not.toThrow();
    expect(() => F.evaluateFscTable(ROWS_PCT({ params: { rows: [{ atLeast: '5.00', rate: '100' }] } } as Partial<OTable & { id: string }>), '6.199')).not.toThrow();
    expect(() => F.evaluateFscTable(T1({ params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '9.9999', bracket: 'above_base' } } as Partial<OTable & { id: string }>), '6.199')).not.toThrow();
  });
});

describe('Oracle self-check against the owner evidence (fsc.py; informative, oracle only)', () => {
  it('wrong-week statistics 2021-2026 at 500 mi: previous week 35.35% / $6.86; highest of last 4 weeks 51.85% / $11.88', () => {
    const obs = DIESEL().observations;
    const t = T1();
    const cents = (p: string) => centsHalfEven(q(BigInt(Math.round(Number(oEvaluate(t, p).rate) * 100)) * 500n, 100n));
    const start = obs.findIndex((o) => o.date >= '2021-01-01');
    const idx = Array.from({ length: obs.length - start - 4 }, (_, k) => start + 4 + k);
    expect(idx).toHaveLength(297);
    const stat = (alt: (i: number) => string) => {
      const diffs = idx.map((i) => cents(alt(i)) - cents(at(obs, i).value));
      const over = diffs.filter((d) => d > 0n);
      return [(over.length / diffs.length).toFixed(4), (Number(over.reduce((a, b) => a + b, 0n)) / over.length / 100).toFixed(2)];
    };
    expect(stat((i) => at(obs, i - 1).value)).toEqual(['0.3535', '6.86']);
    expect(stat((i) => [0, 1, 2, 3].map((k) => at(obs, i - k).value).sort((a, b) => Number(b) - Number(a))[0] ?? '0')).toEqual(['0.5185', '11.88']);
    expect(C).toBeDefined();
  });
});
