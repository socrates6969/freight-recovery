/**
 * Free time and tariff charge (C2, C3): integer day numbers, integer cents. Closed dates are not free time
 * under a working-day basis and are charged under calendar charging; shutout dates are never free time and
 * never charged (decision D5).
 */
import type { DdCalendarDataDto, DdTariffDataDto } from '../ocean-dd-dto.js';
import { ddMoneyCents } from '../ocean-dd-dto.js';

import { DD_FREE_TIME_SCAN_MAX_DAYS, DD_SPAN_MAX_DAYS } from './constants.js';
import { DD_DAY_MAX, ddDateFromDayNumber, ddDayNumber, weekdayOfDayNumber } from './dates.js';

/** A date list longer than this prints the first LIST_SHOWN dates and `, and {m} more`. */
const LIST_SHOWN = 10;

export interface DdChargeableDate {
  date: string;
  /** 1-based tier. */
  tier: number;
  rateCents: number;
}

export interface DdTariffCharge {
  freeTimeEnd: string;
  chargeableDates: DdChargeableDate[];
  chargeableDays: number;
  amountCents: number;
  amount: string;
  steps: string[];
}

export interface DdTariffChargeArgs {
  start: string;
  stop: string;
  sizeType: string;
  tariff: DdTariffDataDto;
  calendar: DdCalendarDataDto | null;
}

/** `d.dd` of non-negative integer cents. */
export function fmtCents(c: number): string {
  if (!Number.isSafeInteger(c) || c < 0) throw new RangeError('cents must be a non-negative safe integer');
  return `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** Dates joined by `, `; more than 10 -> the first 10 then `, and {m} more`. */
export function ddDateList(dates: readonly string[]): string {
  if (dates.length <= LIST_SHOWN) return dates.join(', ');
  return `${dates.slice(0, LIST_SHOWN).join(', ')}, and ${dates.length - LIST_SHOWN} more`;
}

interface DayCalendar {
  closed: ReadonlySet<number>;
  shutout: ReadonlySet<number>;
  /** Ascending day numbers of closed or shutout dates. */
  listed: readonly number[];
}

function dayCalendar(calendar: DdCalendarDataDto | null): DayCalendar {
  const closed = new Set((calendar?.closedDates ?? []).map(ddDayNumber));
  const shutout = new Set((calendar?.shutoutDates ?? []).map(ddDayNumber));
  const listed = [...new Set([...closed, ...shutout])].sort((a, b) => a - b);
  return { closed, shutout, listed };
}

type Basis = DdTariffDataDto['freeDayBasis'];

/** A free-time counting day (basis = freeDayBasis) or a chargeable day (basis = chargeDayBasis). */
function counts(n: number, basis: Basis, weekdays: ReadonlySet<number>, cal: DayCalendar): boolean {
  if (cal.shutout.has(n)) return false;
  if (basis === 'calendar') return true;
  return weekdays.has(weekdayOfDayNumber(n)) && !cal.closed.has(n);
}

function freeTimeEndDay(s: number, tariff: DdTariffDataDto, cal: DayCalendar): number {
  const n = tariff.freeDays;
  const included = tariff.startDayRule === 'included';
  if (n === 0) return included ? s - 1 : s;
  const weekdays = new Set(tariff.workingWeekdays);
  let count = 0;
  for (let d = included ? s : s + 1; ; d += 1) {
    if (d - s > DD_FREE_TIME_SCAN_MAX_DAYS || d > DD_DAY_MAX) throw new RangeError('free time does not end within the scan bound');
    if (counts(d, tariff.freeDayBasis, weekdays, cal) && ++count === n) return d;
  }
}

/** C3: the free-time end F for clock start S. RangeError for invalid dates or an unbounded free time. */
export function computeFreeTimeEnd(start: string, tariff: DdTariffDataDto, calendar: DdCalendarDataDto | null): string {
  return ddDateFromDayNumber(freeTimeEndDay(ddDayNumber(start), tariff, dayCalendar(calendar)));
}

/** C3: free time, chargeable dates, tier amounts and the explanation steps. */
export function computeTariffCharge(args: DdTariffChargeArgs): DdTariffCharge {
  const { start, stop, sizeType, tariff, calendar } = args;
  const s = ddDayNumber(start);
  const e = ddDayNumber(stop);
  if (s > e || e - s > DD_SPAN_MAX_DAYS) throw new RangeError('clock start must be on or before clock stop and at most 730 days before it');
  const rates = tariff.tiers.map((t) => {
    const r = t.rates[sizeType];
    if (r === undefined || !Object.hasOwn(t.rates, sizeType)) throw new RangeError('size type not in the tariff');
    return ddMoneyCents(r);
  });
  const cal = dayCalendar(calendar);
  const f = freeTimeEndDay(s, tariff, cal);
  const freeEnd = ddDateFromDayNumber(f);
  const weekdays = new Set(tariff.workingWeekdays);
  const steps: string[] = [];
  steps.push(
    tariff.startDayRule === 'included'
      ? `Free time: ${tariff.freeDays} ${tariff.freeDayBasis} day(s) counted from ${start} (start day included), ending ${freeEnd}.`
      : `Free time: start day ${start} plus ${tariff.freeDays} ${tariff.freeDayBasis} day(s), ending ${freeEnd}.`,
  );
  const freeFrom = tariff.startDayRule === 'included' ? s : s + 1;
  const notFree = cal.listed.filter((d) => d >= freeFrom && d <= f && !counts(d, tariff.freeDayBasis, weekdays, cal)).map(ddDateFromDayNumber);
  if (notFree.length > 0) steps.push(`Closed or shutout dates not counted as free time: ${ddDateList(notFree)}.`);
  if (e <= f) {
    steps.push(`Clock stopped ${stop}, within free time. No charge.`);
    return { freeTimeEnd: freeEnd, chargeableDates: [], chargeableDays: 0, amountCents: 0, amount: fmtCents(0), steps };
  }
  const dates: DdChargeableDate[] = [];
  const tierCounts = rates.map(() => 0);
  let tier = 0;
  let cumulative = tariff.tiers[0]?.days ?? null;
  for (let d = f + 1; d <= e; d += 1) {
    if (!counts(d, tariff.chargeDayBasis, weekdays, cal)) continue;
    const k = dates.length + 1;
    while (cumulative !== null && k > cumulative && tier < tariff.tiers.length - 1) {
      tier += 1;
      const days = tariff.tiers[tier]?.days ?? null;
      cumulative = days === null ? null : cumulative + days;
    }
    const rateCents = rates[tier] ?? 0;
    dates.push({ date: ddDateFromDayNumber(d), tier: tier + 1, rateCents });
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }
  steps.push(`Chargeable ${tariff.chargeDayBasis} days from ${ddDateFromDayNumber(f + 1)} to ${stop}: ${dates.length}.`);
  const notCharged = cal.listed
    .filter((d) => d > f && d <= e && !counts(d, tariff.chargeDayBasis, weekdays, cal) && (cal.shutout.has(d) || (tariff.chargeDayBasis === 'working' && cal.closed.has(d))))
    .map(ddDateFromDayNumber);
  if (notCharged.length > 0) steps.push(`Closed or shutout dates not charged: ${ddDateList(notCharged)}.`);
  let total = 0;
  tierCounts.forEach((k, j) => {
    if (k === 0) return;
    const rate = rates[j] ?? 0;
    total += k * rate;
    steps.push(`Tier ${j + 1}: ${k} day(s) x $${fmtCents(rate)} = $${fmtCents(k * rate)}.`);
  });
  steps.push(`Tariff charge = $${fmtCents(total)}.`);
  return { freeTimeEnd: freeEnd, chargeableDates: dates, chargeableDays: dates.length, amountCents: total, amount: fmtCents(total), steps };
}
