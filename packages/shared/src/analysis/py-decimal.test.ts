import { describe, expect, it } from 'vitest';

import { LocalDateTime, daysFromCivil } from './local-datetime.js';
import { Dec, add, compare, copyNegate, div, divInt, floorDivInt, format2f, mul, pyMax, q2, quantize, sub, sumDec } from './py-decimal.js';
import { normText, pyReprList, pyReprStr } from './py-text.js';
import { AnalysisInputError } from './types.js';

// Expected values computed with CPython's decimal module (default context: prec 28, ROUND_HALF_EVEN),
// CPython 3.14, 2026-10-10 (str(result) / format(result, '.2f')).
const E = (sign: 0 | 1, coef: bigint, exp: number) => Dec.of(sign, coef, exp);
const d = (s: string) => Dec.parse(s);

describe('Dec (CPython decimal semantics)', () => {
  it('parses plain decimal strings keeping the exponent and sign of zero', () => {
    expect([d('100.00'), d('-0.00'), d('0'), d('007')].map(String)).toEqual(['100.00', '-0.00', '0', '7']);
    expect(d('-0.00').sign).toBe(1);
    for (const bad of ['', '1e3', 'NaN', '1.', '.5', '+1', ' 1', '1,0', '--1']) expect(() => d(bad)).toThrow(AnalysisInputError);
  });

  it('prints like str(Decimal)', () => {
    expect(String(d('0.0000001'))).toBe('1E-7');
    expect(String(E(0, 1n, 2))).toBe('1E+2');
    expect(String(E(0, 0n, 2))).toBe('0E+2');
    expect(['-0.00', '100.000', '0.000001', '123.4500'].map((s) => String(d(s)))).toEqual(['-0.00', '100.000', '0.000001', '123.4500']);
  });

  it('adds like __add__ (zero signs, exponents, rounding to 28 digits)', () => {
    expect(String(add(d('0'), d('-0.00')))).toBe('0.00');
    expect(String(add(d('-0'), d('-0.00')))).toBe('-0.00');
    expect(String(add(d('0'), d('-5')))).toBe('-5');
    expect(String(add(d('1.10'), d('-1.1')))).toBe('0.00');
    expect(String(add(d('0.000001'), d('999999999999999.999999')))).toBe('1000000000000000.000000');
    expect(String(add(d('0'), d('1234567890123456789012345678901')))).toBe('1.234567890123456789012345679E+30');
    expect(String(add(d('-0.00'), d('0.00')))).toBe('0.00');
    expect(String(add(E(0, 1n, 3), d('0')))).toBe('1000');
    expect(String(sub(d('1500.00'), d('1400')))).toBe('100.00');
  });

  it('multiplies like __mul__', () => {
    expect(String(mul(d('2.5'), d('60')))).toBe('150.0');
    expect(String(mul(d('-0'), d('5')))).toBe('-0');
    expect(String(mul(d('1.333333'), d('3600')))).toBe('4799.998800');
    expect(String(mul(d('999999999999999.999999'), d('999999999999999.999999')))).toBe('9.999999999999999999980000000E+29');
    expect(String(mul(d('0.00'), d('-3')))).toBe('-0.00');
  });

  it('divides like __truediv__ (ideal exponent when exact, 28 digits when inexact)', () => {
    const cases: [string, string, string][] = [
      ['7', '60', '0.1166666666666666666666666667'],
      ['90', '60', '1.5'],
      ['210', '60', '3.5'],
      ['-1', '3', '-0.3333333333333333333333333333'],
      ['0', '3600', '0'],
      ['100', '4', '25'],
      ['1', '8', '0.125'],
      ['12600', '3600', '3.5'],
      ['2', '3', '0.6666666666666666666666666667'],
      ['120', '60', '2'],
    ];
    for (const [a, b, want] of cases) expect(String(div(d(a), d(b)))).toBe(want);
    expect(() => div(d('1'), d('0.00'))).toThrow(AnalysisInputError);
  });

  it('divides integrally like __floordiv__ (truncation toward zero, exponent 0)', () => {
    const cases: [string, string, string][] = [
      ['5400', '900', '6'],
      ['-5400', '900', '-6'],
      ['1', '900', '0'],
      ['899', '900', '0'],
      ['5399.5', '900', '5'],
      ['0.5', '60', '0'],
      ['-0.5', '60', '-0'],
    ];
    for (const [a, b, want] of cases) expect(String(divInt(d(a), d(b)))).toBe(want);
    expect(() => divInt(d('1'), d('0'))).toThrow(AnalysisInputError);
    expect(() => divInt(d('1' + '0'.repeat(40)), d('1'))).toThrow(AnalysisInputError);
  });

  it('quantizes to cents half-even keeping the sign', () => {
    const cases: [Dec, string][] = [
      [d('0.005'), '0.00'],
      [d('0.015'), '0.02'],
      [d('0.025'), '0.02'],
      [d('2.675'), '2.68'],
      [d('-0.005'), '-0.00'],
      [d('-0.001'), '-0.00'],
      [d('1.005'), '1.00'],
      [d('100'), '100.00'],
      [E(0, 1n, 2), '100.00'],
      [d('0.0050'), '0.00'],
      [d('999.995'), '1000.00'],
    ];
    for (const [x, want] of cases) expect(String(q2(x))).toBe(want);
    expect(() => quantize(d('1'.repeat(27)), -2)).toThrow(AnalysisInputError);
  });

  it("formats like format(x, '.2f')", () => {
    const cases: [string, string][] = [
      ['0', '0.00'],
      ['3.5', '3.50'],
      ['-0.001', '-0.00'],
      ['0.125', '0.12'],
      ['0.135', '0.14'],
      ['1.1666666666666666666666666667', '1.17'],
      ['-0', '-0.00'],
    ];
    for (const [x, want] of cases) expect(format2f(d(x))).toBe(want);
  });

  it('compares numerically and implements max/sum/negate/floor division like Python', () => {
    expect(compare(d('-0'), d('0.00'))).toBe(0);
    expect(compare(d('100'), d('100.00'))).toBe(0);
    expect(compare(d('-1'), d('0'))).toBe(-1);
    expect(String(pyMax(d('-0.00'), d('0')))).toBe('-0.00');
    expect(String(pyMax(d('-1'), d('0')))).toBe('0');
    expect(String(sumDec([]))).toBe('0');
    expect(String(sumDec([d('1.50'), d('2')]))).toBe('3.50');
    expect(String(copyNegate(d('0.00')))).toBe('-0.00');
    expect([floorDivInt(-360 * 60, 60), floorDivInt(-1, 60), floorDivInt(119, 60)]).toEqual([-360, -1, 1]);
  });
});

describe('Python text primitives', () => {
  it('repr(str) matches CPython (quote choice, escapes, non-printables)', () => {
    const cases: [string, string][] = [
      ["it's", `"it's"`],
      ['a"b', `'a"b'`],
      [`both'"`, `'both\\'"'`],
      ['nb sp', "'nb\\xa0sp'"],
      ['ideo　x', "'ideo\\u3000x'"],
      ['soft­h', "'soft\\xadh'"],
      ['\u{1f600}', "'\u{1f600}'"],
      ['back\\slash', "'back\\\\slash'"],
      ['tab\t', "'tab\\t'"],
      ['​', "'\\u200b'"],
      ['\u{e0001}', "'\\U000e0001'"],
    ];
    for (const [s, want] of cases) expect(pyReprStr(s)).toBe(want);
    expect(pyReprList(['Detention', "it's", ''])).toBe(`['Detention', "it's", '']`);
  });

  it('normalizes text like _norm_text', () => {
    expect(normText('  Stop-Off!! ')).toBe('stop off');
    expect(normText('Linehaul (incl. FSC)')).toBe('linehaul incl fsc');
    expect(normText('---')).toBe('');
  });
});

describe('LocalDateTime', () => {
  it('parses naive ISO datetimes and refuses everything else', () => {
    const t = LocalDateTime.parse('2024-02-29T23:59:59');
    expect(t.fmtYmdHm()).toBe('2024-02-29 23:59');
    expect(t.toUtcDate().toISOString()).toBe('2024-02-29T23:59:59.000Z');
    for (const bad of ['2023-02-29T00:00:00', '2025-13-01T00:00:00', '2025-01-01T24:00:00', '2025-01-01T00:60:00', '2025-01-01T00:00:60', '2025-01-01 00:00:00', '2025-01-01T00:00:00Z', '0000-01-01T00:00:00']) {
      expect(() => LocalDateTime.parse(bad)).toThrow(AnalysisInputError);
    }
  });

  it('counts days with an integer proleptic-Gregorian algorithm (no Date remapping of years 0-99)', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2000, 3, 1)).toBe(11017);
    const early = LocalDateTime.parse('0050-06-01T00:00:00');
    expect(early.fmtYmdHm()).toBe('0050-06-01 00:00');
    expect(early.toUtcDate().getUTCFullYear()).toBe(50);
    expect(LocalDateTime.parse('2025-03-04T09:00:30').epochSeconds() - LocalDateTime.parse('2025-03-04T09:00:00').epochSeconds()).toBe(30);
    expect(LocalDateTime.parse('9999-12-31T23:59:59').epochSeconds()).toBe(Date.UTC(9999, 11, 31, 23, 59, 59) / 1000);
  });
});
