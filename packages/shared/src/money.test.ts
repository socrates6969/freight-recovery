import { describe, expect, it } from 'vitest';

import { formatUsdCents } from './money.js';

describe('formatUsdCents', () => {
  it('formats zero, small, negative and large values without floating point', () => {
    expect(formatUsdCents(0)).toBe('$0.00');
    expect(formatUsdCents(5)).toBe('$0.05');
    expect(formatUsdCents(32500)).toBe('$325.00');
    expect(formatUsdCents(123456)).toBe('$1,234.56');
    expect(formatUsdCents(-15000)).toBe('-$150.00');
    expect(formatUsdCents(-1)).toBe('-$0.01');
    expect(formatUsdCents(100000000000)).toBe('$1,000,000,000.00');
    expect(formatUsdCents(Number.MAX_SAFE_INTEGER)).toBe('$90,071,992,547,409.91');
  });
  it('rejects non-integers', () => {
    expect(() => formatUsdCents(1.5)).toThrow();
    expect(() => formatUsdCents(Number.NaN)).toThrow();
  });
});
