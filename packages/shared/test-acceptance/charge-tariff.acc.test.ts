/* eslint-disable */
// REQ-20261011-charge-intelligence Tier L, SHOULD-HAVE S2: T6 tariff detention (CI-T01..T16; Part C C12).
// Worked examples from the public tariffs (XPO CNWY 199-AJ.4 Item 211, States Logistics 2023, Estes Item 501 with an
// illustrative contract free time). Set ACC_SKIP_TARIFF=1 when the leader reports that S2 was cut (recorded note).
import { beforeAll, describe, expect, it } from 'vitest';
import { oRng, oTariff, type OTerms } from './helpers/charge-oracle.js';

export const SKIP_TARIFF = process.env.ACC_SKIP_TARIFF === '1';
let R: any;
beforeAll(async () => { R = await import('@fr/shared'); });

const D = '2026-01-05T';
const X: OTerms = { freeMinutes: 60, incrementMinutes: 15, rounding: 'up', ratePerIncrement: '72.25', minimumCharge: '95.50', maximumCharge: null };
const S: OTerms = { freeMinutes: 30, incrementMinutes: 15, rounding: 'down', ratePerIncrement: '26.25', minimumCharge: '105.00', maximumCharge: '630.00' };
const E: OTerms = { freeMinutes: 60, incrementMinutes: 15, rounding: 'down', ratePerIncrement: '40.00', minimumCharge: null, maximumCharge: null };
const TABLE: [string, OTerms, string, number, number, string, boolean, boolean][] = [
  ['CI-T01', X, '09:20:00', 2, 30, '144.50', false, false],
  ['CI-T02', X, '09:05:00', 1, 15, '95.50', true, false],
  ['CI-T03', X, '09:00:00', 0, 0, '0.00', false, false],
  ['CI-T04', { ...X, freeMinutes: 30 }, '11:47:30', 14, 210, '1011.50', false, false],
  ['CI-T05', S, '08:50:00', 1, 15, '105.00', true, false],
  ['CI-T06', S, '12:10:00', 14, 210, '367.50', false, false],
  ['CI-T07', { ...S, rounding: 'up' }, '12:10:00', 15, 225, '393.75', false, false],
  ['CI-T08', S, '16:00:00', 30, 450, '630.00', false, true],
  ['CI-T09', S, '08:40:00', 0, 0, '0.00', false, false],
  ['CI-T10', E, '10:10:00', 4, 60, '160.00', false, false],
  ['CI-T11', { ...E, rounding: 'up' }, '10:10:00', 5, 75, '200.00', false, false],
  ['CI-T12', S, '07:00:00', 0, 0, '0.00', false, false],
];
const run = (t: OTerms, dep: string, start = `${D}08:00:00`) => R.computeTariffDetention(start, `${D}${dep}`, t);

describe.skipIf(SKIP_TARIFF)('T6 computeTariffDetention (C12, S2)', () => {
  it('exported from the package root', () => { expect(typeof R.computeTariffDetention).toBe('function'); });
  for (const [id, t, dep, inc, mins, amount, minA, maxA] of TABLE) {
    it(`${id} ${dep}`, () => {
      const r = run(t, dep);
      expect(Object.keys(r).sort()).toEqual(['amount', 'billableMinutes', 'increments', 'maximumApplied', 'minimumApplied', 'steps']);
      expect([r.increments, r.billableMinutes, r.amount, r.minimumApplied, r.maximumApplied]).toEqual([inc, mins, amount, minA, maxA]);
      const { steps, ...rest } = r;
      expect(rest, 'independent oracle').toEqual(oTariff(`${D}08:00:00`, `${D}${dep}`, t));
    });
  }
  it('CI-T13 exact steps', () => {
    expect(run(X, '09:20:00').steps).toEqual(['Dwell 80.00 min from 2026-01-05 08:00 to 2026-01-05 09:20.', 'Less 60 min free time = 20.00 min over.', 'Rounded up to 15-minute increments: 2 x 15 min = 30 min.', '2 x $72.25 = $144.50.', 'Detention = $144.50.']);
    expect(run(X, '09:05:00').steps.slice(-3)).toEqual(['1 x $72.25 = $72.25.', 'Raised to the minimum charge of $95.50.', 'Detention = $95.50.']);
    expect(run(X, '09:00:00').steps).toEqual(['Dwell 60.00 min from 2026-01-05 08:00 to 2026-01-05 09:00.', 'Within 60 min free time. No detention owed.']);
    expect(run(S, '16:00:00').steps).toContain('Capped at the maximum charge of $630.00.');
    expect(run(S, '08:40:00').steps.slice(-2)).toEqual(['Rounded down to 15-minute increments: 0 x 15 min = 0 min.', 'No complete increment. No detention owed.']);
    expect(run({ ...X, freeMinutes: 30 }, '11:47:30').steps[0]).toBe('Dwell 227.50 min from 2026-01-05 08:00 to 2026-01-05 11:47.');
    expect(run(S, '07:00:00').steps[0]).toBe('Dwell -60.00 min from 2026-01-05 08:00 to 2026-01-05 07:00.');
  });
  it('a zero amount never applies the minimum', () => {
    for (const dep of ['08:10:00', '08:30:00', '08:44:59']) {
      const r = run(S, dep);
      expect([r.amount, r.minimumApplied], dep).toEqual(['0.00', false]);
    }
  });

  // CI-T14: >= 300 seeded cases (mulberry32 seed 14062026, recorded).
  it('CI-T14 equivalence with step-5 computeDetention (rounding down, no min/max)', () => {
    const rnd = oRng(14062026);
    const DIV = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];
    let n = 0;
    for (let i = 0; i < 320; i++) {
      const I = DIV[Math.floor(rnd() * DIV.length)]!;
      const F = 15 * Math.floor(rnd() * 13); // 0..180
      const rc = BigInt(Math.floor(rnd() * 20000)); // rate per increment in cents
      const rate = `${rc / 100n}.${String(rc % 100n).padStart(2, '0')}`;
      // r * 60 / I exactly: cents * 60 / I is an integer number of cents because I divides 60
      const perHour = (rc * 60n) / BigInt(I);
      const rph = `${perHour / 100n}.${String(perHour % 100n).padStart(2, '0')}`;
      const free = `${Math.floor(F / 60)}${F % 60 ? `.${String((F % 60) / 60).slice(2)}` : ''}`;
      const dwellSec = Math.floor(rnd() * 10 * 3600) - 1800;
      const dep = new Date(Date.UTC(2026, 0, 5, 8, 0, 0) + dwellSec * 1000).toISOString().slice(0, 19);
      const tr = R.computeTariffDetention(`${D}08:00:00`, dep, { freeMinutes: F, incrementMinutes: I, rounding: 'down', ratePerIncrement: rate, minimumCharge: null, maximumCharge: null });
      const cd = R.computeDetention({ ...R.emptyBillOfLading(), arrival_time: `${D}08:00:00`, departure_time: dep, appointment_time: null }, { ...R.emptyRateConfirmation(), detention_free_hours: free, detention_rate_per_hour: rph, detention_max_hours: null }, I);
      expect(tr.amount, `case ${i}: F=${F} free=${free} I=${I} r=${rate} rph=${rph} dep=${dep}`).toBe(cd.amount);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(300);
  });
  it('CI-T15 refusals throw AnalysisInputError', () => {
    const bad: [string, Partial<OTerms> | null, string?][] = [
      ['freeMinutes -1', { freeMinutes: -1 }], ['freeMinutes 1441', { freeMinutes: 1441 }], ['freeMinutes 1.5', { freeMinutes: 1.5 }],
      ['incrementMinutes 0', { incrementMinutes: 0 }], ['incrementMinutes 241', { incrementMinutes: 241 }],
      ['rounding nearest', { rounding: 'nearest' as any }],
      ['rate -1', { ratePerIncrement: '-1' }], ['rate 1e3', { ratePerIncrement: '1e3' }], ['rate 1.1234567', { ratePerIncrement: '1.1234567' }],
      ['min > max', { minimumCharge: '200', maximumCharge: '100' }],
      ['start 2026-02-30', null, '2026-02-30T08:00:00'],
    ];
    for (const [label, o, start] of bad) {
      let err: unknown = null;
      try { R.computeTariffDetention(start ?? `${D}08:00:00`, start ? '2026-03-01T12:00:00' : `${D}12:00:00`, { ...S, ...(o ?? {}) }); } catch (e) { err = e; }
      expect(err, `${label} throws`).toBeTruthy();
      expect(err instanceof R.AnalysisInputError, `${label}: ${String(err)}`).toBe(true);
    }
    // the boundaries themselves are accepted
    for (const o of [{ freeMinutes: 0 }, { freeMinutes: 1440 }, { incrementMinutes: 1 }, { incrementMinutes: 240 }, { ratePerIncrement: '1.123456' }, { minimumCharge: '100', maximumCharge: '100' }]) expect(() => R.computeTariffDetention(`${D}08:00:00`, `${D}12:00:00`, { ...S, ...o }), JSON.stringify(o)).not.toThrow();
  });
});

describe('CI-T16 step-5 computeDetention unchanged (spot-check against the step-5 oracle values)', () => {
  const rcx = (o: any) => ({ ...R.emptyRateConfirmation(), ...o });
  const rc50 = () => rcx({ detention_free_hours: '2', detention_rate_per_hour: '50', detention_max_hours: '8' });
  const rc25 = () => rcx({ detention_free_hours: '2.5', detention_rate_per_hour: '50', detention_max_hours: '8.0' });
  const bol = (a: string, d: string, appt: string | null = null) => ({ ...R.emptyBillOfLading(), arrival_time: a, departure_time: d, appointment_time: appt });
  it('five step-5 reference cases (AN-E01, E02, E04, E06, E09)', () => {
    const c1 = R.computeDetention(bol('2025-03-03T07:45:00', '2025-03-03T11:30:00', '2025-03-03T08:00:00'), rc50(), 15);
    expect([String(c1.billable_hours), c1.amount, c1.steps[0]]).toEqual(['1.5', '75.00', 'Arrived early; clock starts at appointment 2025-03-03 08:00.']);
    const c2 = R.computeDetention(bol('2025-03-04T09:00:00', '2025-03-04T14:20:00'), rc50(), 15);
    expect([String(c2.billable_hours), c2.amount]).toEqual(['3.25', '162.50']);
    const c3 = R.computeDetention(bol('2025-03-04T06:00:00', '2025-03-04T22:00:00'), rc50(), 15);
    expect([String(c3.billable_hours), c3.amount]).toEqual(['8', '400.00']);
    const c4 = R.computeDetention(bol('2025-03-03T07:45:00', '2025-03-03T11:30:00'), rc25(), 15);
    expect(c4.steps).toEqual(['Clock starts at arrival 2025-03-03 07:45.', 'Departure 2025-03-03 11:30; dwell = 225 min (3.75 h).', 'Less 2.5 h free time = 1.25 h over.', 'Rounded down to 15-minute increments = 75 min (1.25 h).', '1.25 h x $50/h = $62.50.']);
    const c5 = R.computeDetention(bol('2025-01-01T08:00:00', '2025-01-01T10:35:00'), rcx({ detention_free_hours: '2', detention_rate_per_hour: '33.333333' }), 7);
    expect([String(c5.billable_hours), c5.amount]).toEqual(['0.5833333333333333333333333333', '19.44']);
  });
});
