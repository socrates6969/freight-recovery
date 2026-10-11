import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GATE_MIN_DM,
  GATE_MIN_ORIGINS,
  METHOD_LABELS,
  OUTLOOK_SERIES,
  OutlookEvalReport,
  PriceCsvError,
  ar2Coefficients,
  ar2Forecast,
  backtestSeries,
  computeOutlook,
  dieboldMariano,
  logDiffs,
  parsePriceCsv,
  quantile7,
  rangeText,
  sha256Hex,
  targetDate,
  type PriceSeriesKey,
} from './index.js';
import { addDays as addDaysForTest } from '../fuel/week.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../../../api/data/public-prices');
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Weekly CSV text from a start Monday and values. */
function weeklyCsv(values: string[], start = '2020-01-06', header = 'observation_date,GASDESW'): string {
  return [header, ...values.map((v, i) => `${addDaysForTest(start, 7 * i)},${v}`)].join('\n') + '\n';
}

/** Deterministic pseudo-random numbers in [0, 1) (LCG; seed fixed). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/** Weekly dates from a Monday. */
const weeklyDates = (n: number): string[] => Array.from({ length: n }, (_, i) => addDaysForTest('1990-01-01', 7 * i));

/** Levels from log-diffs. */
function levels(z: number[], y0 = 2): number[] {
  const y = [y0];
  for (let i = 1; i < z.length; i += 1) y.push((y[i - 1] ?? 0) * Math.exp(z[i] ?? 0));
  return y;
}

describe('sha256Hex', () => {
  it('matches the FIPS vectors and node:crypto', () => {
    expect(sha256Hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    const big = new Uint8Array(100_003).map((_, i) => (i * 31) & 0xff);
    for (const len of [55, 56, 63, 64, 65, 100_003]) expect(sha256Hex(big.subarray(0, len))).toBe(createHash('sha256').update(big.subarray(0, len)).digest('hex'));
  });
});

describe('parsePriceCsv (F9)', () => {
  const ok = weeklyCsv(['1.106', '1.107', '1.1']);
  const code = (bytes: Uint8Array, key: PriceSeriesKey = 'diesel_us'): [string, number | null] => {
    try {
      parsePriceCsv(bytes, key);
      return ['ok', null];
    } catch (e) {
      if (e instanceof PriceCsvError) return [e.code, e.line];
      throw e;
    }
  };

  it('parses a valid file, pads values to 3 decimals and hashes the bytes', () => {
    const p = parsePriceCsv(enc(ok), 'diesel_us');
    expect(p.rows).toEqual([
      { date: '2020-01-06', value: '1.106' },
      { date: '2020-01-13', value: '1.107' },
      { date: '2020-01-20', value: '1.100' },
    ]);
    expect([p.firstDate, p.lastDate, p.sha256]).toEqual(['2020-01-06', '2020-01-20', sha256Hex(enc(ok))]);
    expect(parsePriceCsv(enc(ok.replaceAll('\n', '\r\n')), 'diesel_us').rows).toHaveLength(3);
    expect(parsePriceCsv(enc(ok.slice(0, -1)), 'diesel_us').rows).toHaveLength(3);
  });

  it('refuses every malformed input with its code and line', () => {
    expect(code(new Uint8Array(1_048_577).fill(0x41))).toEqual(['too_large', null]);
    expect(code(enc('﻿' + ok))).toEqual(['bom', 1]);
    expect(code(enc(ok.replace('1.107', '1.1é7')))).toEqual(['not_ascii', 3]);
    expect(code(enc(ok.replace('1.107', '1.1\t07')))).toEqual(['not_ascii', 3]);
    expect(code(enc(''))).toEqual(['bad_header', 1]);
    expect(code(enc(ok.replace('GASDESW', 'gasdesw')))).toEqual(['bad_header', 1]);
    expect(code(enc('observation_date,GASDESW\n'))).toEqual(['empty', null]);
    expect(code(enc(weeklyCsv(Array.from({ length: 5001 }, () => '1.000'))))).toEqual(['too_many_rows', null]);
    expect(code(enc(ok + '\n'))).toEqual(['bad_row', 5]);
    expect(code(enc(ok.replace('1.107', '.')))).toEqual(['bad_row', 3]);
    expect(code(enc(ok.replace('1.107', '1.1070')))).toEqual(['bad_row', 3]);
    expect(code(enc(ok.slice(0, -1) + '\r'))).toEqual(['bad_row', 4]);
    expect(code(enc(ok.replace('2020-01-13', '2020-02-30')))).toEqual(['bad_date', 3]);
    expect(code(enc(ok.replace('2020-01-13', '2020-01-14')))).toEqual(['not_monday', 3]);
    expect(code(enc(ok.replace('2020-01-13', '2019-12-30')))).toEqual(['not_increasing', 3]);
    expect(code(enc(ok.replace('2020-01-20', '2020-01-27')))).toEqual(['gap', 4]);
    expect(code(enc(ok.replace('1.107', '0.499')))).toEqual(['out_of_range', 3]);
    expect(code(enc(ok.replace('1.107', '20.001')))).toEqual(['out_of_range', 3]);
    expect(code(enc(ok.replace('1.107', '20')))).toEqual(['ok', null]);
  });

  it('checks the monthly frequency', () => {
    const m = 'observation_date,PCU4841214841212\n2025-11-01,100.000\n2025-12-01,101\n2026-01-01,102.5\n';
    expect(parsePriceCsv(enc(m), 'ppi_tl').rows.map((r) => r.value)).toEqual(['100.000', '101.000', '102.500']);
    expect(code(enc(m.replace('2025-12-01', '2025-12-02')), 'ppi_tl')).toEqual(['not_first_of_month', 3]);
    expect(code(enc(m.replace('2026-01-01', '2026-02-01')), 'ppi_tl')).toEqual(['gap', 4]);
    expect(code(enc(m.replace('100.000', '9.999')), 'ppi_tl')).toEqual(['out_of_range', 2]);
    expect(code(enc(m), 'diesel_us')).toEqual(['bad_header', 1]);
  });
});

describe('AR(2), DM, quantiles (F7)', () => {
  it('recovers the coefficients of an exact AR(2) log-diff process', () => {
    // z_i = c + A sin(theta i) satisfies z_i = c(2 - 2cos theta) + 2cos(theta) z_{i-1} - z_{i-2} exactly.
    const theta = 0.7;
    const c = 0.001;
    const z = Array.from({ length: 80 }, (_, i) => (i === 0 ? 0 : c + 0.02 * Math.sin(theta * i)));
    const y = levels(z);
    const coef = ar2Coefficients(logDiffs(y), 70, 40);
    expect(coef).not.toBeNull();
    const [b0, b1, b2] = coef ?? [0, 0, 0];
    expect(Math.abs(b0 - c * (2 - 2 * Math.cos(theta)))).toBeLessThan(1e-9);
    expect(Math.abs(b1 - 2 * Math.cos(theta))).toBeLessThan(1e-9);
    expect(Math.abs(b2 + 1)).toBeLessThan(1e-9);
    // The h-step forecast follows the recursion: y_{t+h} for an exact process.
    for (const h of [1, 4]) expect(Math.abs(ar2Forecast(y, 70, h, 40) / (y[70 + h] ?? 1) - 1)).toBeLessThan(1e-9);
  });

  it('falls back to y_t on a singular system (constant series)', () => {
    const y = Array.from({ length: 50 }, () => 3.5);
    expect(ar2Coefficients(logDiffs(y), 49, 40)).toBeNull();
    expect(ar2Forecast(y, 49, 4, 40)).toBe(3.5);
    expect(() => ar2Forecast(y, 10, 1, 40)).toThrow(RangeError);
  });

  it('DM statistic against hand values', () => {
    expect(dieboldMariano([1, 2, 3, 4], 1)).toBeCloseTo(2.5 / Math.sqrt(1.25 / 4), 12);
    expect(dieboldMariano([1, 2, 3, 4], 2)).toBeCloseTo(2.5 / Math.sqrt((1.25 + 1.25 / 3) / 4), 12);
    expect(dieboldMariano([2, 2, 2], 1)).toBe(0);
  });

  it('type-7 quantiles and target dates', () => {
    expect(quantile7([1, 2, 3, 4], 0.1)).toBeCloseTo(1.3, 12);
    expect(quantile7([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 12);
    expect(quantile7([5], 0.9)).toBe(5);
    expect(targetDate('2026-10-05', 13, 'weekly')).toBe('2027-01-04');
    expect(targetDate('2026-08-01', 1, 'monthly')).toBe('2026-09-01');
    expect(targetDate('2026-12-01', 1, 'monthly')).toBe('2027-01-01');
  });
});

describe('backtestSeries / computeOutlook (F7 gate and range)', () => {
  it('uses the model where it beats no change, keeps naive by design at 8 and 13 weeks', () => {
    const n = 900;
    const rnd = lcg(7);
    const z = Array.from({ length: n }, (_, i) => (i === 0 ? 0 : 0.0005 + 0.03 * Math.sin(0.4 * i) + 0.001 * (rnd() - 0.5)));
    const res = backtestSeries(weeklyDates(n), levels(z), 'diesel_us');
    expect(res.map((r) => [r.h, r.method, r.reason])).toEqual([
      [1, 'ar2', 'model_beats_naive'],
      [4, 'combo', 'model_beats_naive'],
      [8, 'naive', 'naive_by_design'],
      [13, 'naive', 'naive_by_design'],
    ]);
    expect(res[0]?.origins).toBe(n - 1 - Math.max(n / 2, n - 15 * 52));
  });

  it('falls back to no change on a constant series (MAE ratio undefined) and on a random walk', () => {
    const n = 900;
    const flat = backtestSeries(weeklyDates(n), Array.from({ length: n }, () => 4), 'diesel_us');
    expect(flat.map((r) => [r.method, r.reason, r.maeRatio, r.dm])).toEqual([
      ['naive', 'fallback_gate', null, 0],
      ['naive', 'fallback_gate', null, 0],
      ['naive', 'naive_by_design', 1, 0],
      ['naive', 'naive_by_design', 1, 0],
    ]);
    const rnd = lcg(42);
    const walk = backtestSeries(weeklyDates(n), levels(Array.from({ length: n }, () => 0.02 * (rnd() - 0.5))), 'diesel_us');
    for (const r of walk) {
      const gate = r.candidate !== 'naive' && r.origins >= GATE_MIN_ORIGINS && r.maeRatio !== null && r.maeRatio < 1 && r.dm >= GATE_MIN_DM;
      expect([r.h, r.method !== 'naive']).toEqual([r.h, gate]);
    }
  });

  it('reports statuses and validates its input', () => {
    expect(computeOutlook([], [], 'diesel_us')).toEqual({ status: 'no_data', horizons: [], backtestYears: null });
    expect(computeOutlook(weeklyDates(831), Array.from({ length: 831 }, () => 3), 'diesel_us').status).toBe('insufficient_history');
    expect(backtestSeries(weeklyDates(10), Array.from({ length: 10 }, () => 3), 'diesel_us')).toEqual([]);
    expect(() => computeOutlook(['2026-01-05'], [0], 'diesel_us')).toThrow(RangeError);
    expect(() => computeOutlook(['2026-01-05', '2026-01-05'], [1, 2], 'diesel_us')).toThrow(RangeError);
    expect(() => computeOutlook(['2026-01-05'], [1, 2], 'diesel_us')).toThrow(RangeError);
    expect(() => computeOutlook(['2026-01-05'], [Number.NaN], 'diesel_us')).toThrow(RangeError);
  });

  it('on the bundled history: deterministic, gate-consistent, coverage in [0, 1], fast', () => {
    const t0 = performance.now();
    const runs = (['diesel_us', 'ppi_tl'] as const).map((key) => {
      const file = key === 'diesel_us' ? 'GASDESW.csv' : 'PCU4841214841212.csv';
      const p = parsePriceCsv(new Uint8Array(readFileSync(path.join(dataDir, file))), key);
      const dates = p.rows.map((r) => r.date);
      const values = p.rows.map((r) => r.value);
      return { key, first: computeOutlook(dates, values, key), second: computeOutlook(dates, values, key) };
    });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    for (const { key, first, second } of runs) {
      expect(second).toEqual(first);
      expect(first.status).toBe('ok');
      expect(first.horizons.map((h) => h.h)).toEqual(OUTLOOK_SERIES[key].horizons.map((h) => h.h));
      for (const r of first.horizons) {
        expect(r.coverage).toBeGreaterThanOrEqual(0);
        expect(r.coverage).toBeLessThanOrEqual(1);
        expect(r.coverage).toBe(r.coverageHits / r.coverageCases);
        const gate = r.candidate !== 'naive' && r.origins >= GATE_MIN_ORIGINS && r.maeRatio !== null && r.maeRatio < 1 && r.dm >= GATE_MIN_DM;
        expect(r.method !== 'naive').toBe(gate);
        expect(r.low).toBeLessThanOrEqual(r.point);
        expect(r.high).toBeGreaterThanOrEqual(r.point);
      }
    }
    expect(runs[0]?.first.backtestYears).toEqual({ from: 2011, to: 2026 });
    expect(runs[1]?.first.backtestYears).toEqual({ from: 2009, to: 2026 });
  });
});

describe('outlook copy and report DTO (F10, F15)', () => {
  it('copy texts', () => {
    expect(rangeText(0.779)).toBe('80% range. In the backtest, 78% of outcomes fell inside ranges built this way.');
    expect(METHOD_LABELS.naive).toBe('No change');
  });
  it('the eval report is strict', () => {
    expect(OutlookEvalReport.safeParse({ evaluation: 'walk-forward' }).success).toBe(false);
  });
});
