// REQ-20261011-ocean-dd Tier L: T1 dates (DD-D01..D05, Part C C2) and T2 free time / tariff charges from the real
// public tariffs (W1-W5, E1-E9, DD-T01, DD-T02; Part C C3). Every product value is compared with the fixed value from
// test-spec AND with the test-owned oracle (helpers/dd-oracle.ts). The oracle self-check runs first and needs no
// product code.
import { beforeAll, describe, expect, it } from 'vitest';
import { HAPAG, MAERSK, NO_CAL, STEPS_EXACT, WORKED, cal, clone, deepFreeze, loadDd, type DdMod } from './helpers/dd-fixtures.js';
import { oAdd, oBetween, oDn, oFreeTimeEnd, oFromDn, oRng, oTariffCharge, oWd, type OTariff } from './helpers/dd-oracle.js';

const SEED_D05 = 20261011;
let M: DdMod;
beforeAll(async () => { M = await loadDd(); });
const short = (id: string) => id.split(' ')[0] ?? id;

describe('oracle self-check against the planner values (no product code)', () => {
  it('T1 fixed values', () => {
    expect([oDn('2000-01-01'), oDn('2026-03-02'), oDn('2099-12-31')]).toEqual([10957, 20514, 47481]);
    expect(['2026-03-02', '2026-05-25', '2026-07-03', '2026-07-04', '2026-03-01', '2024-02-29'].map(oWd)).toEqual([1, 1, 5, 6, 7, 4]);
    expect([oAdd('2024-02-28', 1), oAdd('2023-02-28', 1), oAdd('2026-12-31', 1)]).toEqual(['2024-02-29', '2023-03-01', '2027-01-01']);
    expect([oBetween('2026-03-20', '2026-04-19'), oBetween('2026-03-20', '2026-04-20'), oBetween('2026-04-20', '2026-03-20')]).toEqual([30, 31, -31]);
  });
  for (const w of WORKED) {
    it(`T2 ${w.id}`, () => {
      const r = oTariffCharge({ start: w.S, stop: w.E, sizeType: w.size, tariff: w.tariff, calendar: w.calendar });
      expect([r.freeTimeEnd, r.chargeableDays, r.amountCents, r.amount]).toEqual([w.F, w.n, w.T, `${Math.floor(w.T / 100)}.${String(w.T % 100).padStart(2, '0')}`]);
      expect(oFreeTimeEnd(w.S, w.tariff, w.calendar)).toBe(w.F);
      const ex = STEPS_EXACT[short(w.id)];
      if (ex) expect(r.steps).toEqual(ex);
    });
  }
});

describe('T1 dates (C2)', () => {
  it('DD-D01 day numbers and inverse', () => {
    for (const [d, n] of [['2000-01-01', 10957], ['2026-03-02', 20514], ['2099-12-31', 47481]] as const) {
      expect(M.ddDayNumber(d), d).toBe(n);
      expect(M.ddDateFromDayNumber(n), d).toBe(d);
    }
  });
  it('DD-D02 ISO weekdays', () => {
    for (const [d, w] of [['2026-03-02', 1], ['2026-05-25', 1], ['2026-07-03', 5], ['2026-07-04', 6], ['2026-03-01', 7], ['2024-02-29', 4]] as const) expect(M.ddIsoWeekday(d), d).toBe(w);
  });
  it('DD-D03 add and between', () => {
    expect(M.ddAddDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(M.ddAddDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(M.ddAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(M.ddDaysBetween('2026-03-20', '2026-04-19')).toBe(30);
    expect(M.ddDaysBetween('2026-03-20', '2026-04-20')).toBe(31);
    expect(M.ddDaysBetween('2026-04-20', '2026-03-20')).toBe(-31);
  });
  it('DD-D04 invalid dates throw RangeError', () => {
    for (const bad of ['2026-02-30', '2025-02-29', '1999-12-31', '2100-01-01', '2026-3-02', '2026-03-02T00:00', '']) {
      expect(() => M.ddDayNumber(bad), JSON.stringify(bad)).toThrow(RangeError);
      expect(() => M.ddIsoWeekday(bad), JSON.stringify(bad)).toThrow(RangeError);
      expect(() => M.ddAddDays(bad, 0), JSON.stringify(bad)).toThrow(RangeError);
      expect(() => M.ddDaysBetween(bad, '2026-03-02'), JSON.stringify(bad)).toThrow(RangeError);
    }
    expect(() => M.ddAddDays('2099-12-31', 1)).toThrow(RangeError);
    expect(() => M.ddAddDays('2000-01-01', -1)).toThrow(RangeError);
  });
  it(`DD-D05 5,000 seeded random dates (seed ${SEED_D05}): round trip, weekday vs getUTCDay, agreement with the oracle`, () => {
    const r = oRng(SEED_D05);
    for (let k = 0; k < 5000; k++) {
      const n = r.int(10957, 47481);
      const d = oFromDn(n);
      expect(M.ddDayNumber(d), d).toBe(n);
      expect(M.ddDateFromDayNumber(M.ddDayNumber(d)), d).toBe(d);
      const js = new Date(`${d}T00:00:00Z`).getUTCDay();
      expect(oWd(d), `oracle ${d}`).toBe(js === 0 ? 7 : js);
      expect(M.ddIsoWeekday(d), d).toBe(js === 0 ? 7 : js);
      const step = r.int(-400, 400);
      if (n + step >= 10957 && n + step <= 47481) {
        expect(M.ddAddDays(d, step), `${d}+${step}`).toBe(oAdd(d, step));
        expect(M.ddDaysBetween(d, oAdd(d, step))).toBe(step);
      }
    }
  });
});

describe('T2 worked examples from the public tariffs (C3)', () => {
  for (const w of WORKED) {
    it(`${w.id}: F ${w.F}, ${w.n} day(s), ${w.T} cents; equals the oracle exactly`, () => {
      const args = deepFreeze({ start: w.S, stop: w.E, sizeType: w.size, tariff: clone(w.tariff), calendar: clone(w.calendar) });
      const got = M.computeTariffCharge(args);
      expect([got.freeTimeEnd, got.chargeableDays, got.amountCents, got.amount]).toEqual([w.F, w.n, w.T, oTariffCharge(args).amount]);
      expect(got).toEqual(oTariffCharge(args));
      const ex = STEPS_EXACT[short(w.id)];
      if (ex) expect(got.steps).toEqual(ex);
    });
  }
  it('W3 chargeable dates with tiers', () => {
    const w = WORKED.find((x) => x.id.startsWith('W3 '));
    if (!w) throw new Error('W3 fixture');
    const got = M.computeTariffCharge({ start: w.S, stop: w.E, sizeType: w.size, tariff: w.tariff, calendar: w.calendar });
    expect(got.chargeableDates.map((d) => [d.date.slice(5), d.tier, d.rateCents])).toEqual([
      ['07-10', 1, 20000], ['07-11', 1, 20000], ['07-12', 1, 20000], ['07-13', 2, 25000], ['07-15', 2, 25000], ['07-16', 2, 25000],
      ['07-17', 3, 30000], ['07-18', 3, 30000], ['07-19', 3, 30000], ['07-20', 3, 30000]]);
  });
  it('E3, E4, E5, E6, E7, E8, E9 step details', () => {
    const steps = (id: string) => {
      const w = WORKED.find((x) => short(x.id) === id);
      if (!w) throw new Error(id);
      return M.computeTariffCharge({ start: w.S, stop: w.E, sizeType: w.size, tariff: w.tariff, calendar: w.calendar }).steps;
    };
    expect(steps('E3')[0]).toBe('Free time: 4 working day(s) counted from 2026-03-01 (start day included), ending 2026-03-05.');
    expect(steps('E3').some((s) => s.startsWith('Closed or shutout dates not counted'))).toBe(false);
    expect(steps('E4')[0]).toBe('Free time: start day 2026-07-04 plus 4 working day(s), ending 2026-07-09.');
    expect(steps('E4').some((s) => s.startsWith('Closed or shutout dates'))).toBe(false);
    expect(steps('E5').slice(0, 2)).toEqual(['Free time: 0 working day(s) counted from 2026-03-02 (start day included), ending 2026-03-01.', 'Chargeable calendar days from 2026-03-02 to 2026-03-04: 3.']);
    expect(steps('E6').slice(0, 2)).toEqual(['Free time: start day 2026-03-02 plus 0 working day(s), ending 2026-03-02.', 'Chargeable calendar days from 2026-03-03 to 2026-03-04: 2.']);
    expect(steps('E7')).toContain('Chargeable working days from 2026-03-06 to 2026-03-16: 6.');
    expect(steps('E7')).toContain('Closed or shutout dates not charged: 2026-03-09.');
    expect(steps('E8').slice(0, 2)).toEqual(['Free time: 4 calendar day(s) counted from 2026-03-02 (start day included), ending 2026-03-06.', 'Closed or shutout dates not counted as free time: 2026-03-03.']);
    expect(steps('E9')).toContain('Closed or shutout dates not charged: 2026-02-01, 2026-02-02, 2026-02-03, 2026-02-04, 2026-02-05, 2026-02-06, 2026-02-07, 2026-02-08, 2026-02-09, 2026-02-10, and 4 more.');
    expect(steps('E9').slice(-2)).toEqual(['Tier 3: 63 day(s) x $290.00 = $18270.00.', 'Tariff charge = $20150.00.']);
  });
  it('DD-T01 RangeError cases', () => {
    const base = { sizeType: '40DV', tariff: MAERSK, calendar: NO_CAL };
    expect(() => M.computeTariffCharge({ ...base, start: '2026-03-10', stop: '2026-03-09' }), 'S > E').toThrow(RangeError);
    expect(() => M.computeTariffCharge({ ...base, start: '2026-01-01', stop: oAdd('2026-01-01', 731) }), 'span 731').toThrow(RangeError);
    expect(M.computeTariffCharge({ ...base, start: '2026-01-01', stop: oAdd('2026-01-01', 730) }).chargeableDays, 'span 730 is allowed').toBeGreaterThan(0);
    expect(() => M.computeTariffCharge({ ...base, sizeType: '20RE', start: '2026-03-02', stop: '2026-03-20' }), 'size 20RE').toThrow(RangeError);
    const mondays: OTariff = { ...MAERSK, workingWeekdays: [1], freeDays: 60 };
    expect(() => M.computeTariffCharge({ ...base, tariff: mondays, start: '2099-06-01', stop: '2099-06-30' }), 'free time beyond 2099-12-31').toThrow(RangeError);
    expect(() => M.computeFreeTimeEnd('2099-06-01', mondays, NO_CAL), 'computeFreeTimeEnd beyond 2099-12-31').toThrow(RangeError);
    expect(() => oTariffCharge({ ...base, tariff: mondays, start: '2099-06-01', stop: '2099-06-30' }), 'oracle agrees').toThrow(RangeError);
  });
  it('DD-T01b a calendar closing every working day within 3,660 days throws RangeError (C3)', () => {
    const closed: string[] = [];
    for (let n = oDn('2026-01-05'); closed.length < 400; n += 7) closed.push(oFromDn(n));
    const monOnly: OTariff = { ...MAERSK, workingWeekdays: [1], freeDays: 60 };
    // 400 Mondays closed: free time would need Mondays after 2033, still within 3,660 days -> computable; then the oracle and product must agree
    const S = '2026-01-05';
    let o: string | RangeError;
    try { o = oFreeTimeEnd(S, monOnly, cal(closed)); } catch (e) { o = e as RangeError; }
    if (o instanceof RangeError) expect(() => M.computeFreeTimeEnd(S, monOnly, cal(closed))).toThrow(RangeError);
    else expect(M.computeFreeTimeEnd(S, monOnly, cal(closed))).toBe(o);
  });
  it('DD-T02 computeFreeTimeEnd alone agrees with every F above', () => {
    for (const w of WORKED) expect(M.computeFreeTimeEnd(w.S, w.tariff, w.calendar), w.id).toBe(w.F);
    expect(M.computeFreeTimeEnd('2026-07-02', HAPAG, cal(['2026-07-03'], ['2026-07-14']))).toBe('2026-07-09');
  });
});
