import { describe, expect, it } from 'vitest';

import { AnalysisInputError, computeTariffDetention, type TariffDetentionTerms } from './index.js';

const XPO: TariffDetentionTerms = { freeMinutes: 60, incrementMinutes: 15, rounding: 'up', ratePerIncrement: '72.25', minimumCharge: '95.50', maximumCharge: null };
const STATES: TariffDetentionTerms = { freeMinutes: 30, incrementMinutes: 15, rounding: 'down', ratePerIncrement: '26.25', minimumCharge: '105.00', maximumCharge: '630.00' };
const d = (hm: string) => `2025-03-03T${hm}`;

describe('computeTariffDetention (C12)', () => {
  it('XPO Item 211: rounding up, minimum charge', () => {
    expect(computeTariffDetention(d('08:00:00'), d('09:20:00'), XPO)).toEqual({
      increments: 2,
      billableMinutes: 30,
      amount: '144.50',
      minimumApplied: false,
      maximumApplied: false,
      steps: [
        'Dwell 80.00 min from 2025-03-03 08:00 to 2025-03-03 09:20.',
        'Less 60 min free time = 20.00 min over.',
        'Rounded up to 15-minute increments: 2 x 15 min = 30 min.',
        '2 x $72.25 = $144.50.',
        'Detention = $144.50.',
      ],
    });
    const min = computeTariffDetention(d('08:00:00'), d('09:05:00'), XPO);
    expect([min.increments, min.amount, min.minimumApplied]).toEqual([1, '95.50', true]);
    expect(min.steps.slice(-2)).toEqual(['Raised to the minimum charge of $95.50.', 'Detention = $95.50.']);
    const zero = computeTariffDetention(d('08:00:00'), d('09:00:00'), XPO);
    expect(zero).toEqual({
      increments: 0,
      billableMinutes: 0,
      amount: '0.00',
      minimumApplied: false,
      maximumApplied: false,
      steps: ['Dwell 60.00 min from 2025-03-03 08:00 to 2025-03-03 09:00.', 'Within 60 min free time. No detention owed.'],
    });
    const f30 = computeTariffDetention(d('08:00:00'), d('11:47:30'), { ...XPO, freeMinutes: 30 });
    expect([f30.increments, f30.amount]).toEqual([14, '1011.50']);
    expect(f30.steps[1]).toBe('Less 30 min free time = 197.50 min over.');
  });

  it('States Logistics: rounding down, minimum and maximum', () => {
    expect(computeTariffDetention(d('08:00:00'), d('08:50:00'), STATES)).toMatchObject({ increments: 1, amount: '105.00', minimumApplied: true });
    expect(computeTariffDetention(d('08:00:00'), d('12:10:00'), STATES)).toMatchObject({ increments: 14, billableMinutes: 210, amount: '367.50', minimumApplied: false });
    expect(computeTariffDetention(d('08:00:00'), d('12:10:00'), { ...STATES, rounding: 'up' }).amount).toBe('393.75');
    const cap = computeTariffDetention(d('08:00:00'), d('16:00:00'), STATES);
    expect(cap).toMatchObject({ increments: 30, amount: '630.00', maximumApplied: true });
    expect(cap.steps.slice(-3)).toEqual(['30 x $26.25 = $787.50.', 'Capped at the maximum charge of $630.00.', 'Detention = $630.00.']);
  });

  it('no complete increment owes nothing and never applies the minimum', () => {
    const r = computeTariffDetention(d('08:00:00'), d('08:40:00'), STATES);
    expect(r).toMatchObject({ increments: 0, amount: '0.00', minimumApplied: false });
    expect(r.steps.slice(-2)).toEqual(['Rounded down to 15-minute increments: 0 x 15 min = 0 min.', 'No complete increment. No detention owed.']);
  });

  it('Estes illustration (contract free time 60): 70 min over -> 4 increments down', () => {
    const r = computeTariffDetention(d('08:00:00'), d('10:10:00'), { freeMinutes: 60, incrementMinutes: 15, rounding: 'down', ratePerIncrement: '40.00', minimumCharge: null, maximumCharge: null });
    expect([r.increments, r.amount]).toEqual([4, '160.00']);
  });

  it('refuses invalid input', () => {
    const bad: [string, string, Partial<TariffDetentionTerms>][] = [
      ['x', d('09:00:00'), {}],
      [d('08:00:00'), '2025-02-30T00:00:00', {}],
      [d('08:00:00'), d('09:00:00'), { freeMinutes: 1441 }],
      [d('08:00:00'), d('09:00:00'), { freeMinutes: 1.5 }],
      [d('08:00:00'), d('09:00:00'), { incrementMinutes: 0 }],
      [d('08:00:00'), d('09:00:00'), { incrementMinutes: 241 }],
      [d('08:00:00'), d('09:00:00'), { rounding: 'nearest' as 'up' }],
      [d('08:00:00'), d('09:00:00'), { ratePerIncrement: '-1' }],
      [d('08:00:00'), d('09:00:00'), { ratePerIncrement: '1.1234567' }],
      [d('08:00:00'), d('09:00:00'), { minimumCharge: '700.00' }],
    ];
    for (const [a, b, t] of bad) expect(() => computeTariffDetention(a, b, { ...STATES, ...t })).toThrow(AnalysisInputError);
  });
});
