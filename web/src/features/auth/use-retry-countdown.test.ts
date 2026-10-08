import { describe, expect, it } from 'vitest';

import { remainingSeconds } from './use-retry-countdown';

describe('remainingSeconds', () => {
  it('starts at the Retry-After value and counts down whole seconds', () => {
    const w = { seconds: 42, startedAt: 1_000_000 };
    expect(remainingSeconds(w, 1_000_000)).toBe(42);
    expect(remainingSeconds(w, 1_000_999)).toBe(42);
    expect(remainingSeconds(w, 1_001_000)).toBe(41);
    expect(remainingSeconds(w, 999_000)).toBe(42);
    expect(remainingSeconds(w, 1_100_000)).toBe(0);
    expect(remainingSeconds(null, 5)).toBe(0);
  });
});
