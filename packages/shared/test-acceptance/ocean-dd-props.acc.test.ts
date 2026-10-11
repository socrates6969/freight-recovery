// REQ-20261011-ocean-dd Tier L: T9 properties (DD-P01..P04) over 3,000 seeded random cases (seed recorded below).
// Random tariffs (rules, bases, weekdays, 1-4 tiers, rates 0.01..999.99), calendars (0-20 dates near S), clocks (span
// 0..120 days) and invoices (1-3 containers, 0-4 periods, random omissions) within C4. Every generated object is
// first checked to be valid and already normalized under the product's own schemas.
// C6 as amended (review F7): an NVOCC invoice never reports `no_charge_dates`, so NVOCC invoices without periods are generated too.
import { beforeAll, describe, expect, it } from 'vitest';
import { clone, deepFreeze, loadDd, type DdMod } from './helpers/dd-fixtures.js';
import { oAudit, oCents, oDn, oFreeTimeEnd, oFromDn, oMoney, oRng, oTariffCharge, type OCalendar, type OContainer, type OInvoice, type OPeriod, type OTariff } from './helpers/dd-oracle.js';

export const PROP_SEED = 20261008;
const N = 3000;
let M: DdMod;
beforeAll(async () => { M = await loadDd(); });

type R = ReturnType<typeof oRng>;
const SIZES = ['20DV', '40DV', '40HC', '45HC'];
const money = (c: number) => oMoney(c);
function genTariff(r: R): OTariff {
  const sizes = SIZES.filter(() => r.chance(0.6));
  if (!sizes.length) sizes.push(r.pick(SIZES));
  const nt = r.int(1, 4);
  const tiers = Array.from({ length: nt }, (_, k) => ({ days: k === nt - 1 ? null : r.int(1, 8), rates: Object.fromEntries(sizes.map((s) => [s, money(r.int(1, 99999))])) }));
  const wd = [1, 2, 3, 4, 5, 6, 7].filter(() => r.chance(0.7));
  if (!wd.length) wd.push(r.int(1, 7));
  return {
    name: `Synthetic tariff ${r.int(1, 999)}`, carrier: 'Synthetic carrier', chargeType: r.chance(0.5) ? 'DETENTION' : 'DEMURRAGE', direction: r.chance(0.9) ? 'IMPORT' : 'EXPORT',
    ruleReference: r.chance(0.8) ? 'Synthetic rule 1' : null, sourceUrl: null, sourceRetrievedOn: null, freeDays: r.chance(0.1) ? 0 : r.int(1, 10),
    freeDayBasis: r.chance(0.7) ? 'working' : 'calendar', startDayRule: r.chance(0.6) ? 'included' : 'additional', chargeDayBasis: r.chance(0.75) ? 'calendar' : 'working',
    workingWeekdays: wd, tiers,
  };
}
function genCalendar(r: R, s: number): OCalendar | null {
  if (r.chance(0.2)) return null;
  const set = new Set<number>();
  const n = r.int(0, 20);
  for (let k = 0; k < n; k++) set.add(s + r.int(-5, 60));
  const closed: string[] = [], shut: string[] = [];
  for (const d of [...set].sort((a, b) => a - b)) (r.chance(0.6) ? closed : shut).push(oFromDn(d));
  return { name: 'Synthetic calendar', closedDates: closed, shutoutDates: shut };
}
function genContainer(r: R, t: OTariff, cal: OCalendar | null, s: number, k: number): OContainer {
  const sizeType = r.chance(0.9) ? r.pick(Object.keys(t.tiers[0]?.rates ?? { '40DV': '' })) : '20RE';
  const periods: OPeriod[] = [];
  let p = s + r.int(-2, 10);
  const np = r.int(0, 4);
  for (let j = 0; j < np; j++) {
    const len = r.int(1, 10);
    const rate = r.chance(0.1) ? null : r.int(1, 50000);
    const days = len;
    let amt = rate === null ? r.int(0, 400000) : days * rate;
    if (rate !== null && r.chance(0.25)) amt += r.int(1, 20000);
    else if (rate !== null && r.chance(0.15)) amt = Math.max(0, amt - r.int(1, 20000));
    periods.push({ from: oFromDn(p), to: oFromDn(p + len - 1), rate: rate === null ? null : money(rate), amount: money(amt) });
    p += len + r.int(0, 2);
  }
  const lastTo = periods.length ? oDn(periods[periods.length - 1]?.to ?? '2026-01-01') : s + r.int(0, 20);
  let clockStart: number | null = r.chance(0.75) ? s : null;
  let clockStop: number | null = r.chance(0.7) ? lastTo + r.int(-3, 3) : null;
  if (clockStart !== null && clockStop !== null && clockStop < clockStart) clockStop = clockStart + r.int(0, 3);
  if (clockStart !== null && clockStop !== null && clockStop - clockStart > 120) clockStart = clockStop - 120;
  const refused = new Set<number>();
  if (r.chance(0.4)) for (let j = r.int(1, 5); j > 0; j--) refused.add((clockStart ?? s) + r.int(0, Math.max(1, lastTo - s + 2)));
  let fts: string | null = r.chance(0.85) ? oFromDn(s + (r.chance(0.8) ? 0 : r.int(-2, 2))) : null;
  let fte: string | null = null;
  if (fts !== null && r.chance(0.85)) {
    try { fte = r.chance(0.7) ? oFreeTimeEnd(fts, t, cal) : oFromDn(oDn(fts) + r.int(0, 10)); } catch { fte = null; }
  } else if (r.chance(0.3)) fte = oFromDn(s + r.int(0, 8));
  if (r.chance(0.05)) { fts = null; }
  return {
    containerNumber: r.chance(0.92) ? `SYNU${String(k).padStart(7, '0')}` : null, sizeType, chargeType: r.chance(0.85) ? t.chargeType : (t.chargeType === 'DETENTION' ? 'DEMURRAGE' : 'DETENTION'),
    freeDays: r.chance(0.85) ? (r.chance(0.8) ? t.freeDays : r.int(0, 12)) : null, freeTimeStart: fts, freeTimeEnd: fte,
    availabilityDate: r.chance(0.85) ? oFromDn(s - r.int(0, 3)) : null, earliestReturnDate: r.chance(0.5) ? oFromDn(s + r.int(0, 5)) : null, periods,
    evidence: {
      clockStart: clockStart === null ? null : oFromDn(clockStart), clockStop: clockStop === null ? null : oFromDn(clockStop),
      cargoAvailableDate: r.chance(0.4) ? oFromDn(s + r.int(-2, 8)) : null, emptyReturnRefusedDates: [...refused].sort((a, b) => a - b).map(oFromDn),
    },
  };
}
interface Gen { invoice: OInvoice; tariff: OTariff | null; calendar: OCalendar | null }
function genCase(r: R, k: number): Gen {
  const t = genTariff(r);
  const s = oDn('2025-01-01') + r.int(0, 1000);
  const cal = genCalendar(r, s);
  const containers = Array.from({ length: r.int(1, 3) }, (_, j) => genContainer(r, t, cal, s + r.int(0, 3), k * 10 + j));
  const bpt = r.pick(['OCEAN_CARRIER', 'MARINE_TERMINAL_OPERATOR', 'NVOCC'] as const);
  const lasts = containers.flatMap((c) => c.periods.map((p) => oDn(p.to)));
  const last = lasts.length ? Math.max(...lasts) : s + 10;
  const sum = containers.reduce((x, c) => x + c.periods.reduce((y, p) => y + oCents(p.amount), 0), 0);
  const invoiceDate = r.chance(0.08) ? null : r.chance(0.04) ? '2024-05-27' : oFromDn(last + r.int(0, 45));
  const upstream = bpt === 'NVOCC' && r.chance(0.8) && invoiceDate !== null ? oFromDn(oDn(invoiceDate) - r.int(0, 45)) : null;
  const total = r.chance(0.1) ? null : money(Math.max(0, sum + (r.chance(0.3) ? r.int(-5000, 10000) : 0)));
  const invoice: OInvoice = {
    invoiceNumber: `SYN-DD-P${k}`, billingPartyName: 'Synthetic Ocean Line P', billingPartyType: bpt, billedPartyName: 'Synthetic Importer P',
    direction: r.chance(0.9) ? t.direction : (t.direction === 'IMPORT' ? 'EXPORT' : 'IMPORT'), invoiceDate, dueDate: r.chance(0.9) && invoiceDate ? oFromDn(oDn(invoiceDate) + 30) : null,
    upstreamInvoiceDate: upstream, billOfLadingNumbers: r.chance(0.9) ? ['SYNBLP1'] : [], portOfDischarge: r.chance(0.9) ? 'Synthetic Port P' : null,
    liabilityBasis: r.chance(0.9) ? 'Synthetic basis' : null, totalDue: total, ruleReference: r.chance(0.9) ? 'Synthetic rule P' : null,
    disputeContact: r.chance(0.9) ? 'disputes@example.com' : null, disputeDigitalMeans: r.chance(0.85) ? 'https://example.com/d' : null,
    disputeRequestDays: r.chance(0.85) ? r.pick([30, 30, 45, 14, 0, 60]) : null, disputeResolutionDays: r.chance(0.85) ? r.pick([30, 30, 20, 45]) : null,
    certifiesFmcRules: r.chance(0.9), certifiesPerformance: r.chance(0.9), containers,
  };
  return { invoice, tariff: r.chance(0.85) ? t : null, calendar: cal };
}
const CASES: Gen[] = [];
function cases(): Gen[] {
  if (!CASES.length) { const r = oRng(PROP_SEED); for (let k = 0; k < N; k++) CASES.push(genCase(r, k)); }
  return CASES;
}
const tryCharge = (f: () => unknown) => { try { return { ok: true as const, v: f() }; } catch (e) { return { ok: false as const, range: e instanceof RangeError }; } };

describe(`T9 properties (seed ${PROP_SEED}, ${N} cases)`, () => {
  it('generator sanity: every case is valid and already normalized under the product schemas; the cases exercise every rule', () => {
    const seen = new Set<string>();
    for (const [k, c] of cases().entries()) {
      const p = M.DdInvoiceData.safeParse(clone(c.invoice));
      expect(p.success, `case ${k} invoice valid`).toBe(true);
      expect(p.data, `case ${k} invoice normalized`).toEqual(c.invoice);
      if (c.tariff) expect(M.DdTariffData.safeParse(clone(c.tariff)).data, `case ${k} tariff`).toEqual(c.tariff);
      if (c.calendar) expect(M.DdCalendarData.safeParse(clone(c.calendar)).data, `case ${k} calendar`).toEqual(c.calendar);
      for (const f of oAudit(c).findings) seen.add(f.ruleId);
    }
    expect([...seen].sort()).toEqual([...M.DD_RULE_IDS].sort());
  });
  it('DD-P01 computeTariffCharge and auditDdInvoice deep-equal the oracle', () => {
    for (const [k, c] of cases().entries()) {
      expect(M.auditDdInvoice(c), `case ${k} (seed ${PROP_SEED})`).toEqual(oAudit(c));
      if (!c.tariff) continue;
      const ct = c.invoice.containers[0];
      if (!ct?.evidence.clockStart) continue;
      const span = k % 121;
      const args = { start: ct.evidence.clockStart, stop: oFromDn(oDn(ct.evidence.clockStart) + span), sizeType: ct.sizeType, tariff: c.tariff, calendar: c.calendar };
      const a = tryCharge(() => M.computeTariffCharge(args));
      const b = tryCharge(() => oTariffCharge(args));
      expect(a.ok, `case ${k} charge throws alike`).toBe(b.ok);
      if (a.ok && b.ok) expect(a.v, `case ${k} charge`).toEqual(b.v);
      else if (!a.ok) expect(a.range, `case ${k} RangeError`).toBe(true);
    }
  });
  it('DD-P02 amounts bounded by the invoice; all >= 0; recoverable + pending = sum of findings', () => {
    for (const [k, c] of cases().entries()) {
      const r = M.auditDdInvoice(c);
      const stated = c.invoice.containers.reduce((x, ct) => x + ct.periods.reduce((y, p) => y + oCents(p.amount), 0), 0);
      const extra = c.invoice.totalDue === null ? 0 : Math.max(0, oCents(c.invoice.totalDue) - stated);
      const sum = r.findings.reduce((x, f) => x + f.amountCents, 0);
      for (const f of r.findings) expect(f.amountCents, `case ${k} ${f.ruleId}`).toBeGreaterThanOrEqual(0);
      expect(sum, `case ${k}`).toBeLessThanOrEqual(stated + extra);
      expect(r.recoverableCents + r.pendingReviewCents, `case ${k}`).toBe(sum);
      expect([r.recoverable, r.pendingReview]).toEqual([oMoney(r.recoverableCents), oMoney(r.pendingReviewCents)]);
    }
  });
  it('DD-P03 monotonicity: later start never increases T; later stop never decreases T; an added shutout date never increases T', () => {
    let compared = 0;
    for (const [k, c] of cases().entries()) {
      if (!c.tariff) continue;
      const ct = c.invoice.containers.find((x) => Object.prototype.hasOwnProperty.call(c.tariff?.tiers[0]?.rates ?? {}, x.sizeType));
      if (!ct) continue;
      const tariff = c.tariff;
      const S = ct.evidence.clockStart ?? ct.freeTimeStart;
      if (!S) continue;
      const E = oFromDn(oDn(S) + (k % 90));
      const T = (s: string, e: string, cal: OCalendar | null) => {
        const x = tryCharge(() => M.computeTariffCharge({ start: s, stop: e, sizeType: ct.sizeType, tariff, calendar: cal }));
        return x.ok ? (x.v as { amountCents: number }).amountCents : null;
      };
      const base = T(S, E, c.calendar);
      if (base === null) continue;
      const later = T(oFromDn(oDn(S) + 1 + (k % 3)), E, c.calendar);
      if (later !== null) expect(later, `case ${k} later start`).toBeLessThanOrEqual(base);
      const longer = T(S, oFromDn(oDn(E) + 1 + (k % 5)), c.calendar);
      if (longer !== null) expect(longer, `case ${k} later stop`).toBeGreaterThanOrEqual(base);
      const cal = c.calendar ?? { name: 'Synthetic', closedDates: [], shutoutDates: [] };
      const extra = oFromDn(oDn(S) + (k % 40));
      if (!cal.closedDates.includes(extra) && !cal.shutoutDates.includes(extra)) {
        const withShut = T(S, E, { ...cal, shutoutDates: [...cal.shutoutDates, extra].sort() });
        if (withShut !== null) expect(withShut, `case ${k} added shutout ${extra}`).toBeLessThanOrEqual(base);
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(1000);
  });
  it('DD-P04 determinism and no mutation (deep-frozen inputs)', () => {
    for (const [k, c] of cases().slice(0, 600).entries()) {
      const frozen = deepFreeze(clone(c));
      const a = M.auditDdInvoice(frozen);
      const b = M.auditDdInvoice(frozen);
      expect(a, `case ${k}`).toEqual(b);
      expect(frozen, `case ${k} input unchanged`).toEqual(c);
      const letter = M.buildDdDisputeLetter(frozen.invoice, a, '2026-10-11');
      expect(M.buildDdDisputeLetter(frozen.invoice, a, '2026-10-11')).toBe(letter);
    }
  });
});
