import { describe, expect, it } from 'vitest';

import { compareDecimal, fromMicros, isDecimalString, parseMoney, toMicros } from './decimal.js';

// Expected values computed with the Python reference (freight_recovery.extraction.stub.parse_money,
// str(result)), CPython 3.14, 2026-10-08. Includes the tests/test_regressions_ingest_api.py vectors.
const VECTORS: [string, string | null][] = [
  ['$1,234.50', '1234.50'],
  ['(300.00)', '-300.00'],
  ['300 USD', '300'],
  ['-300', '-300'],
  ['0', '0'],
  ['2', '2'],
  ['NaN', null],
  ['nan', null],
  ['Infinity', null],
  ['-Infinity', null],
  ['1e3', null],
  ['1E+999999999', null],
  ['1e-999999999', null],
  ['$1,000.5.0', null],
  ['12abc', null],
  ['', null],
  ['1'.repeat(40), null],
  ['1,2,3', '123'],
  ['(0.00)', '0.00'],
  ['(-5)', '5'],
  ['-0.00', '-0.00'],
  ['0012.50', '12.50'],
  ['USD300USD', '300'],
  ['usd', null],
  ['usdusd', null],
  [' \u{a0} $ 1,000 ', '1000'],
  ['($5)', '-5'],
  ['5 usd', '5'],
  ['USD 7.5', '7.5'],
  ['.5', null],
  ['5.', null],
  ['1234567890123456', null],
  ['123456789012345', '123456789012345'],
  ['1.1234567', null],
  ['1.123456', '1.123456'],
  ['+5', null],
  ['(5', null],
  ['5)', null],
  ['((5))', null],
  ['\u{663}', null],
  ['\u{a0}(12)\u{3000}', '-12'],
  ['$-5', '-5'],
  ['($-0)', '0'],
  ['\u{feff}5', null],
  ['5\u{200b}', null],
];

describe('parseMoney (Python parse_money parity)', () => {
  it.each(VECTORS)('%j -> %j', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it('D7: only ASCII letters match the USD affix (Python would fold U+017F LONG S)', () => {
    expect(parseMoney('5 u\u{17f}d')).toBeNull();
  });

  it('returns canonical DecimalStrings only', () => {
    for (const [input, out] of VECTORS) if (out !== null) expect([input, isDecimalString(out)]).toEqual([input, true]);
  });
});

describe('micros and comparison', () => {
  it('round-trips exactly without floating point', () => {
    expect(toMicros('1234.50')).toBe(1234500000n);
    expect(toMicros('-0.000001')).toBe(-1n);
    expect(fromMicros(1234500000n)).toBe('1234.5');
    expect(fromMicros(-1n)).toBe('-0.000001');
    expect(fromMicros(0n)).toBe('0');
    expect(fromMicros(toMicros('999999999999999.999999'))).toBe('999999999999999.999999');
  });

  it('refuses more than six fraction digits and malformed input', () => {
    expect(() => toMicros('1.1234567')).toThrow(RangeError);
    expect(() => toMicros('1e3')).toThrow(RangeError);
  });

  it('compares numerically across scales', () => {
    expect(compareDecimal('2', '2.000')).toBe(0);
    expect(compareDecimal('-1', '0')).toBe(-1);
    expect(compareDecimal('10.5', '9.99')).toBe(1);
    expect(compareDecimal('-0.00', '0')).toBe(0);
  });
});
