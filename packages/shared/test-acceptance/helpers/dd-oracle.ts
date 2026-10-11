// REQ-20261011-ocean-dd: test-owned independent oracle of Part C C2, C3, C5, C6 and C7 (ocean demurrage and
// detention audit). Written from the Part C text only; it imports nothing from the product. Dates are handled as
// integer day numbers with a civil-from-days algorithm (no Date objects), money as integer cents.

// ---------------------------------------------------------------------------------------------------------------
// Types (contract shapes, C4/C5/C6)
// ---------------------------------------------------------------------------------------------------------------
export interface OPeriod { from: string; to: string; rate: string | null; amount: string }
export interface OEvidence { clockStart: string | null; clockStop: string | null; cargoAvailableDate: string | null; emptyReturnRefusedDates: string[] }
export interface OContainer {
  containerNumber: string | null; sizeType: string; chargeType: 'DEMURRAGE' | 'DETENTION'; freeDays: number | null;
  freeTimeStart: string | null; freeTimeEnd: string | null; availabilityDate: string | null; earliestReturnDate: string | null;
  periods: OPeriod[]; evidence: OEvidence;
}
export interface OInvoice {
  invoiceNumber: string; billingPartyName: string; billingPartyType: 'OCEAN_CARRIER' | 'MARINE_TERMINAL_OPERATOR' | 'NVOCC';
  billedPartyName: string; direction: 'IMPORT' | 'EXPORT'; invoiceDate: string | null; dueDate: string | null; upstreamInvoiceDate: string | null;
  billOfLadingNumbers: string[]; portOfDischarge: string | null; liabilityBasis: string | null; totalDue: string | null; ruleReference: string | null;
  disputeContact: string | null; disputeDigitalMeans: string | null; disputeRequestDays: number | null; disputeResolutionDays: number | null;
  certifiesFmcRules: boolean; certifiesPerformance: boolean; containers: OContainer[];
}
export interface OTier { days: number | null; rates: Record<string, string> }
export interface OTariff {
  name: string; carrier: string; chargeType: 'DEMURRAGE' | 'DETENTION'; direction: 'IMPORT' | 'EXPORT'; ruleReference: string | null;
  sourceUrl: string | null; sourceRetrievedOn: string | null; freeDays: number; freeDayBasis: 'calendar' | 'working'; startDayRule: 'included' | 'additional';
  chargeDayBasis: 'calendar' | 'working'; workingWeekdays: number[]; tiers: OTier[];
}
export interface OCalendar { name: string; closedDates: string[]; shutoutDates: string[] }
export interface OCharge { freeTimeEnd: string; chargeableDates: { date: string; tier: number; rateCents: number }[]; chargeableDays: number; amountCents: number; amount: string; steps: string[] }
export interface OCitation { source: 'invoice' | 'tariff' | 'calendar'; pointer: string; excerpt: string }
export interface OClause { source: 'tariff' | 'regulation'; key: string; label: string; excerpt: string }
export interface OFinding {
  ruleId: string; title: string; direction: 'overcharge'; amountCents: number; amount: string; explanation: string; calculation: string[];
  confidence: number; needsHumanReview: boolean; citations: OCitation[]; clause: OClause | null;
}
export interface OCheck { id: string; containerIndex: number | null; status: 'ok' | 'finding' | 'not_evaluated' | 'not_applicable'; reason: string | null }
export interface OSummary { index: number; label: string; chargeType: string; sizeType: string; chargedCents: number; expectedCents: number | null; freeTimeEnd: string | null; chargeableDays: number | null }
export interface OResult { rulesVersion: 'dd-rules-v1'; findings: OFinding[]; recoverableCents: number; pendingReviewCents: number; recoverable: string; pendingReview: string; checks: OCheck[]; containers: OSummary[] }

// ---------------------------------------------------------------------------------------------------------------
// C2 dates (civil-from-days / days-from-civil, Hinnant), range 2000-01-01 .. 2099-12-31
// ---------------------------------------------------------------------------------------------------------------
export function nn<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('oracle: unexpected empty value');
  return v;
}
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_DN = 10957; // 2000-01-01
const MAX_DN = 47481; // 2099-12-31
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function oDn(s: string): number {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
  if (!m) throw new RangeError(`bad date ${String(s)}`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > (mo === 2 && leap(y) ? 29 : nn(MDAYS[mo - 1]))) throw new RangeError(`bad date ${s}`);
  const n = daysFromCivil(y, mo, d);
  if (n < MIN_DN || n > MAX_DN) throw new RangeError(`date out of range ${s}`);
  return n;
}
export function oFromDn(n: number): string {
  if (!Number.isInteger(n) || n < MIN_DN || n > MAX_DN) throw new RangeError(`day number out of range ${n}`);
  const [y, m, d] = civilFromDays(n);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export const oWd = (s: string) => ((oDn(s) + 3) % 7 + 7) % 7 + 1;
export const oAdd = (s: string, n: number) => oFromDn(oDn(s) + n);
export const oBetween = (a: string, b: string) => oDn(b) - oDn(a);
/** Unchecked day-number -> date for intermediate values that may leave the range (never printed). */
const dateOf = (n: number) => { const [y, m, d] = civilFromDays(n); return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------------------------------------------
// Money and text helpers
// ---------------------------------------------------------------------------------------------------------------
export function oCents(m: string): number {
  const x = /^(\d+)(?:\.(\d{1,2}))?$/.exec(m);
  if (!x) throw new RangeError(`bad money ${m}`);
  return Number(x[1]) * 100 + Number((x[2] ?? '').padEnd(2, '0'));
}
export const oMoney = (c: number): string => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
const usd = (c: number) => `$${oMoney(c)}`;

const SPACES = new Set([9, 10, 11, 12, 13, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000].map((c) => String.fromCodePoint(c)));
const CTRL_RE = new RegExp('[' + String.fromCodePoint(0) + '-' + String.fromCodePoint(0x1f) + String.fromCodePoint(0x7f) + '-' + String.fromCodePoint(0x9f) + String.fromCodePoint(0x2028, 0x2029) + String.fromCodePoint(0x202a) + '-' + String.fromCodePoint(0x202e) + String.fromCodePoint(0x2066) + '-' + String.fromCodePoint(0x2069) + ']+', 'gu');
/** Step-5 `plain` restated: control/bidi runs -> one space, drop backticks and angle brackets, collapse spaces, strip, cut to limit code points (limit-3 + '...'). */
export function oPlain(text: unknown, limit = 200): string {
  let s = String(text).replace(CTRL_RE, ' ');
  s = s.replace(/[`<>]/gu, '').replace(/ {2,}/gu, ' ');
  const cps = [...s];
  let a = 0, b = cps.length;
  while (a < b && SPACES.has(nn(cps[a]))) a++;
  while (b > a && SPACES.has(nn(cps[b - 1]))) b--;
  const t = cps.slice(a, b);
  return t.length <= limit ? t.join('') : `${t.slice(0, limit - 3).join('')}...`;
}
/** Canonical JSON (keys sorted by UTF-16 order, no whitespace). */
export function oCanon(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => oCanon(x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${oCanon(o[k])}`).join(',')}}`;
}
const dateList = (ds: string[]) => (ds.length > 10 ? `${ds.slice(0, 10).join(', ')}, and ${ds.length - 10} more` : ds.join(', '));

// ---------------------------------------------------------------------------------------------------------------
// C2/C3 free time and tariff charge
// ---------------------------------------------------------------------------------------------------------------
const EMPTY_CAL: OCalendar = { name: '', closedDates: [], shutoutDates: [] };
function sets(cal: OCalendar | null) {
  const c = cal ?? EMPTY_CAL;
  return { CL: new Set(c.closedDates.map(oDn)), SH: new Set(c.shutoutDates.map(oDn)) };
}
function isFreeDay(n: number, t: OTariff, CL: Set<number>, SH: Set<number>): boolean {
  if (SH.has(n)) return false;
  if (t.freeDayBasis === 'calendar') return true;
  return t.workingWeekdays.includes(((n + 3) % 7 + 7) % 7 + 1) && !CL.has(n);
}
function isChargeDay(n: number, t: OTariff, CL: Set<number>, SH: Set<number>): boolean {
  if (SH.has(n)) return false;
  if (t.chargeDayBasis === 'calendar') return true;
  return t.workingWeekdays.includes(((n + 3) % 7 + 7) % 7 + 1) && !CL.has(n);
}
function freeEndDn(S: string, t: OTariff, cal: OCalendar | null): number {
  const s = oDn(S);
  const { CL, SH } = sets(cal);
  const N = t.freeDays;
  if (N === 0) return t.startDayRule === 'included' ? s - 1 : s;
  let n = t.startDayRule === 'included' ? s : s + 1;
  let k = 0;
  for (;; n++) {
    if (n - s > 3660 || n > MAX_DN) throw new RangeError('free time does not end within the limit');
    if (isFreeDay(n, t, CL, SH)) { k++; if (k === N) return n; }
  }
}
export function oFreeTimeEnd(S: string, t: OTariff, cal: OCalendar | null): string {
  return dateOf(freeEndDn(S, t, cal));
}
export function oTariffCharge(a: { start: string; stop: string; sizeType: string; tariff: OTariff; calendar: OCalendar | null }): OCharge {
  const { tariff: t } = a;
  const s = oDn(a.start), e = oDn(a.stop);
  if (s > e || e - s > 730) throw new RangeError('bad clock');
  if (!t.tiers.every((x) => Object.prototype.hasOwnProperty.call(x.rates, a.sizeType))) throw new RangeError('size not in tariff');
  const f = freeEndDn(a.start, t, a.calendar);
  const { CL, SH } = sets(a.calendar);
  const F = dateOf(f);
  const steps: string[] = [];
  steps.push(t.startDayRule === 'included'
    ? `Free time: ${t.freeDays} ${t.freeDayBasis} day(s) counted from ${a.start} (start day included), ending ${F}.`
    : `Free time: start day ${a.start} plus ${t.freeDays} ${t.freeDayBasis} day(s), ending ${F}.`);
  const lo = t.startDayRule === 'included' ? s : s + 1;
  const notFree = [...new Set([...CL, ...SH])].filter((n) => n >= lo && n <= f && !isFreeDay(n, t, CL, SH)).sort((x, y) => x - y).map(dateOf);
  if (notFree.length) steps.push(`Closed or shutout dates not counted as free time: ${dateList(notFree)}.`);
  if (e <= f) {
    steps.push(`Clock stopped ${a.stop}, within free time. No charge.`);
    return { freeTimeEnd: F, chargeableDates: [], chargeableDays: 0, amountCents: 0, amount: '0.00', steps };
  }
  const dates: { date: string; tier: number; rateCents: number }[] = [];
  const notCharged: string[] = [];
  const bounds: number[] = [];
  let acc = 0;
  for (const tier of t.tiers) { acc = tier.days === null ? Infinity : acc + tier.days; bounds.push(acc); }
  for (let n = f + 1; n <= e; n++) {
    if (isChargeDay(n, t, CL, SH)) {
      const k = dates.length + 1;
      const j = bounds.findIndex((b) => k <= b);
      dates.push({ date: dateOf(n), tier: j + 1, rateCents: oCents(nn(nn(t.tiers[j]).rates[a.sizeType])) });
    } else if (SH.has(n) || (t.chargeDayBasis === 'working' && CL.has(n))) notCharged.push(dateOf(n));
  }
  steps.push(`Chargeable ${t.chargeDayBasis} days from ${dateOf(f + 1)} to ${a.stop}: ${dates.length}.`);
  if (notCharged.length) steps.push(`Closed or shutout dates not charged: ${dateList(notCharged)}.`);
  for (let j = 1; j <= t.tiers.length; j++) {
    const ds = dates.filter((d) => d.tier === j);
    if (!ds.length) continue;
    const r = nn(ds[0]).rateCents;
    steps.push(`Tier ${j}: ${ds.length} day(s) x ${usd(r)} = ${usd(ds.length * r)}.`);
  }
  const T = dates.reduce((x, d) => x + d.rateCents, 0);
  steps.push(`Tariff charge = ${usd(T)}.`);
  return { freeTimeEnd: F, chargeableDates: dates, chargeableDays: dates.length, amountCents: T, amount: oMoney(T), steps };
}

// ---------------------------------------------------------------------------------------------------------------
// C10 regulation text (restated) and C5 audit
// ---------------------------------------------------------------------------------------------------------------
export const O_REGULATION: Record<string, string> = {
  '46 CFR 541.5': 'Failure to include any of the required minimum information in this part in a demurrage or detention invoice eliminates any obligation of the billed party to pay the applicable charge.',
  '46 CFR 541.6(a)': 'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to identify the container(s) to which the charges apply and at a minimum must include: (1) The Bill of Lading number(s); (2) The container number(s); (3) For imports, the port(s) of discharge; and (4) The basis for why the billed party is the proper party of interest and thus liable for the charge.',
  '46 CFR 541.6(b)': 'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to identify the relevant time for which the charges apply and the applicable due date for invoiced charges and at a minimum must include: (1) The invoice date; (2) The invoice due date; (3) The allowed free time in days; (4) The start date of free time; (5) The end date of free time; (6) For imports, the container availability date; (7) For exports, the earliest return date; and (8) The specific date(s) for which demurrage and/or detention were charged.',
  '46 CFR 541.6(c)': 'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to identify the amount due and readily ascertain how that amount was calculated and must include at a minimum: (1) The total amount due; (2) The applicable detention or demurrage rule (e.g., the tariff name and rule number, terminal schedule, applicable service contract number and section, or applicable negotiated arrangement) on which the daily rate is based; and (3) The specific rate or rates per the applicable tariff rule or service contract.',
  '46 CFR 541.6(d)': 'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to readily identify a contact to whom they may direct questions or concerns related to the invoice and understand the process to request fee mitigation, refund, or waiver, and at a minimum must include: (1) The email, telephone number, or other appropriate contact information for questions or request for fee mitigation, refund, or waiver; (2) Digital means, such as a URL address, QR code, or digital watermark, that directs the billed party to a publicly accessible website that provides a detailed description of information or documentation that the billed party must provide to successfully request fee mitigation, refund, or waiver; and (3) Defined timeframes that comply with the billing practices in this part, during which the billed party must request a fee mitigation, refund, or waiver and within which the billing party will resolve such requests.',
  '46 CFR 541.6(e)': "A demurrage or detention invoice must be accurate and contain statements from the billing party that: (1) The charges are consistent with any of the Federal Maritime Commission's rules related to demurrage and detention, including, but not limited to, this part and 46 CFR 545.5; and (2) The billing party's performance did not cause or contribute to the underlying invoiced charges.",
  '46 CFR 541.7(a)': 'A billing party must issue a demurrage or detention invoice within thirty (30) calendar days from the date on which the charge was last incurred. If the billing party does not issue a demurrage or detention invoice within thirty (30) calendar days from the date on which the charge was last incurred, then the billed party is not required to pay the charge.',
  '46 CFR 541.7(b)': 'If the billing party is a non-vessel-operating common carrier, then it must issue a demurrage or detention invoice within thirty (30) calendar days from the issuance date of the demurrage or detention invoice it received. If such a billing party does not issue a demurrage or detention invoice within thirty (30) calendar days from the issuance date of the demurrage or detention invoice it received, then the billed party is not required to pay the charge.',
  '46 CFR 541.8(a)': 'The billing party must allow the billed party at least thirty (30) calendar days from the invoice issuance date to request mitigation, refund, or waiver of fees from the billing party.',
  '46 CFR 541.8(b)': 'If a billing party receives a fee mitigation, refund, or waiver request from a billed party, the billing party must attempt to resolve the request within thirty (30) calendar days of receiving such a request or at a later date as agreed upon by both parties.',
  '46 CFR 545.5(c)(2)(i)': 'Cargo availability. The Commission may consider in the reasonableness analysis the extent to which demurrage practices and regulations relate demurrage or free time to cargo availability for retrieval.',
  '46 CFR 545.5(c)(2)(ii)': 'Empty container return. Absent extenuating circumstances, practices and regulations that provide for imposition of detention when it does not serve its incentivizing purposes, such as when empty containers cannot be returned, are likely to be found unreasonable.',
};
const regClause = (key: string): OClause => ({ source: 'regulation', key, label: key, excerpt: oPlain(O_REGULATION[key], 200) });

function pointerGet(obj: unknown, ptr: string): unknown {
  let cur: unknown = obj;
  for (const raw of ptr.split('/').slice(1)) {
    const k = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
function excerptOf(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number') s = String(v);
  else if (typeof v === 'boolean') s = v ? 'yes' : 'no';
  else if (v === null || v === undefined) s = '(missing)';
  else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) s = v.length ? v.join(', ') : '(none)';
  else s = oCanon(v);
  return oPlain(s, 200);
}

const TYPE = { DEMURRAGE: 'demurrage', DETENTION: 'detention' } as const;
export const oCtr = (c: OContainer, i: number) => (c.containerNumber === null ? `Container #${i + 1}` : `Container ${oPlain(c.containerNumber, 20)}`);

interface Per {
  C: number; last: string | null; lastP: number; S0: string | null; s0Ev: boolean; E0: string | null; e0Ev: boolean;
  reason: string | null; T: OCharge | null; TARIFF: number; RET: number; AV: number; R: number;
}

export function oAudit(input: { invoice: OInvoice; tariff: OTariff | null; calendar: OCalendar | null }): OResult {
  const { invoice: inv, tariff, calendar } = input;
  const data = { invoice: inv, tariff, calendar } as Record<string, unknown>;
  const findings: OFinding[] = [];
  const cite = (list: [OCitation['source'], string][]): OCitation[] => {
    const seen = new Set<string>();
    const out: OCitation[] = [];
    for (const [source, pointer] of list) {
      const k = `${source} ${pointer}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ source, pointer, excerpt: excerptOf(pointerGet(data[source], pointer)) });
    }
    return out;
  };
  const mk = (ruleId: string, title: string, amountCents: number, explanation: string, calculation: string[], confidence: number, review: boolean, citations: OCitation[], clause: OClause | null): OFinding =>
    ({ ruleId, title, direction: 'overcharge', amountCents, amount: oMoney(amountCents), explanation, calculation, confidence, needsHumanReview: review, citations, clause });

  // Per-container quantities
  const per: Per[] = inv.containers.map((c) => {
    let C = 0;
    for (const p of c.periods) {
      const st = oCents(p.amount);
      C += p.rate === null ? st : Math.min(st, (oBetween(p.from, p.to) + 1) * oCents(p.rate));
    }
    let last: string | null = null, lastP = -1;
    c.periods.forEach((p, k) => { if (last === null || oDn(p.to) > oDn(last)) { last = p.to; lastP = k; } });
    const S0 = c.evidence.clockStart ?? c.freeTimeStart;
    const E0 = c.evidence.clockStop ?? last;
    let reason: string | null = null;
    let T: OCharge | null = null;
    if (!tariff) reason = 'no_tariff';
    else if (tariff.chargeType !== c.chargeType || tariff.direction !== inv.direction) reason = 'tariff_mismatch';
    else if (!tariff.tiers.every((x) => Object.prototype.hasOwnProperty.call(x.rates, c.sizeType))) reason = 'size_not_in_tariff';
    else if (S0 === null || E0 === null) reason = 'no_dates';
    else if (oDn(S0) > oDn(E0) || oBetween(S0, E0) > 730) reason = 'invalid_dates';
    else {
      try { T = oTariffCharge({ start: S0, stop: E0, sizeType: c.sizeType, tariff, calendar }); } catch (e) { if (!(e instanceof RangeError)) throw e; reason = 'invalid_dates'; }
    }
    return { C, last, lastP, S0, s0Ev: c.evidence.clockStart !== null, E0, e0Ev: c.evidence.clockStop !== null, reason, T, TARIFF: 0, RET: 0, AV: 0, R: 0 };
  });

  // 1. TOTAL
  const sumStated = inv.containers.reduce((x, c) => x + c.periods.reduce((y, p) => y + oCents(p.amount), 0), 0);
  let totalFinding = false;
  if (inv.totalDue !== null) {
    const A = oCents(inv.totalDue) - sumStated;
    if (A > 0) {
      totalFinding = true;
      findings.push(mk('DD-TOTAL-MISMATCH', 'Invoice total exceeds the sum of its charges', A,
        `The invoice total due (${usd(oCents(inv.totalDue))}) is ${usd(A)} more than the sum of its charge lines (${usd(sumStated)}).`,
        [`Sum of charge lines = ${usd(sumStated)}.`, `Total due on the invoice = ${usd(oCents(inv.totalDue))}.`, `Difference = ${usd(A)}.`],
        0.9, false, cite([['invoice', '/totalDue']]), null));
    }
  }
  // 2. PERIOD
  let periodFindings = 0;
  inv.containers.forEach((c, i) => c.periods.forEach((p, k) => {
    if (p.rate === null) return;
    const days = oBetween(p.from, p.to) + 1;
    const rate = oCents(p.rate), st = oCents(p.amount), comp = days * rate;
    if (st <= comp) return;
    periodFindings++;
    const ctr = oCtr(c, i);
    findings.push(mk('DD-PERIOD-ARITH', 'Charge line does not match days x rate', st - comp,
      `${ctr}: the charge for ${p.from} to ${p.to} is ${usd(st)}, but ${days} day(s) x ${usd(rate)} = ${usd(comp)}.`,
      [`${ctr}, ${p.from} to ${p.to}: ${days} calendar day(s).`, `${days} x ${usd(rate)} = ${usd(comp)}.`, `Charged: ${usd(st)}. Difference = ${usd(st - comp)}.`],
      0.9, false, cite([['invoice', `/containers/${i}/periods/${k}/amount`], ['invoice', `/containers/${i}/periods/${k}/rate`]]), null));
  }));
  const s0Ptr = (i: number) => (nn(per[i]).s0Ev ? `/containers/${i}/evidence/clockStart` : `/containers/${i}/freeTimeStart`);
  // 3. TARIFF
  inv.containers.forEach((c, i) => {
    const q = nn(per[i]);
    if (!q.T || q.C <= q.T.amountCents) return;
    q.TARIFF = q.C - q.T.amountCents;
    const t = nn(tariff);
    const list: [OCitation['source'], string][] = c.periods.map((_, k) => ['invoice', `/containers/${i}/periods/${k}/amount`] as [OCitation['source'], string]);
    list.push(['invoice', s0Ptr(i)]);
    if (q.e0Ev) list.push(['invoice', `/containers/${i}/evidence/clockStop`]);
    list.push(['tariff', '/tiers']);
    if (calendar) list.push(['calendar', '/closedDates'], ['calendar', '/shutoutDates']);
    findings.push(mk('DD-TARIFF-OVERCHARGE', 'Charges exceed the attached tariff', q.TARIFF,
      `${oCtr(c, i)} (${c.sizeType}, ${TYPE[c.chargeType]}): the attached tariff '${oPlain(t.name, 120)}' gives ${usd(q.T.amountCents)} for ${q.T.chargeableDays} chargeable day(s), but the invoice charges ${usd(q.C)}.`,
      [`Clock start ${q.S0} (${q.s0Ev ? 'your evidence' : 'invoice free time start'}); clock stop ${q.E0} (${q.e0Ev ? 'your evidence' : 'last charged date on the invoice'}).`,
        ...q.T.steps, `Invoice charges for this container = ${usd(q.C)}.`, `Difference = ${usd(q.TARIFF)}.`],
      0.9, false, cite(list),
      { source: 'tariff', key: '/tiers', label: 'Attached tariff', excerpt: oPlain(`${t.name}; ${t.ruleReference ?? 'no rule reference'}`, 200) }));
  });
  // 4. RETURN
  const retState: ('na' | 'noev' | 'ok' | 'finding')[] = [];
  inv.containers.forEach((c, i) => {
    const q = nn(per[i]);
    if (c.chargeType !== 'DETENTION') { retState.push('na'); return; }
    if (!c.evidence.emptyReturnRefusedDates.length) { retState.push('noev'); return; }
    const refused = new Set(c.evidence.emptyReturnRefusedDates);
    const hits: { date: string; cents: number | null; src: string }[] = [];
    if (q.T) {
      for (const d of q.T.chargeableDates) if (refused.has(d.date)) hits.push({ date: d.date, cents: d.rateCents, src: `tariff tier ${d.tier}` });
    } else {
      const all: { n: number; cents: number | null }[] = [];
      for (const p of c.periods) for (let n = oDn(p.from); n <= oDn(p.to); n++) if (refused.has(dateOf(n))) all.push({ n, cents: p.rate === null ? null : oCents(p.rate) });
      all.sort((x, y) => x.n - y.n);
      for (const h of all) hits.push({ date: dateOf(h.n), cents: h.cents, src: 'invoice rate' });
    }
    if (!hits.length) { retState.push('ok'); return; }
    retState.push('finding');
    const V = hits.reduce((x, h) => x + (h.cents ?? 0), 0);
    const room = q.C - q.TARIFF;
    q.RET = Math.min(V, room);
    const calc = hits.map((h) => (h.cents === null ? `${h.date}: no rate stated on the invoice.` : `${h.date}: ${usd(h.cents)} (${h.src}).`));
    if (V > room) calc.push(`Limited to the remaining charge of ${usd(room)}.`);
    calc.push(`Total = ${usd(q.RET)}.`);
    findings.push(mk('DD-545-RETURN-REFUSED', 'Detention charged while empty return was refused (46 CFR 545.5)', q.RET,
      `${oCtr(c, i)}: ${hits.length} charged day(s) fall on dates when the empty container could not be returned (${hits.map((h) => h.date).join(', ')}). Under 46 CFR 545.5(c)(2)(ii), "Absent extenuating circumstances, practices and regulations that provide for imposition of detention when it does not serve its incentivizing purposes, such as when empty containers cannot be returned, are likely to be found unreasonable." - review.`,
      calc, 0.5, true, cite([['invoice', `/containers/${i}/evidence/emptyReturnRefusedDates`]]), regClause('46 CFR 545.5(c)(2)(ii)')));
  });
  // 5. AVAILABILITY
  const avState: { status: OCheck['status']; reason: string | null }[] = [];
  inv.containers.forEach((c, i) => {
    const q = nn(per[i]);
    if (!(inv.direction === 'IMPORT' && c.chargeType === 'DEMURRAGE')) { avState.push({ status: 'not_applicable', reason: 'not_import_demurrage' }); return; }
    const A = c.evidence.cargoAvailableDate;
    if (A === null) { avState.push({ status: 'not_evaluated', reason: 'no_evidence' }); return; }
    if (!q.T) { avState.push({ status: 'not_evaluated', reason: q.reason }); return; }
    if (oDn(A) <= oDn(nn(q.S0))) { avState.push({ status: 'ok', reason: null }); return; }
    const T2 = oDn(A) > oDn(nn(q.E0)) ? 0 : oTariffCharge({ start: A, stop: nn(q.E0), sizeType: c.sizeType, tariff: nn(tariff), calendar }).amountCents;
    const D = q.T.amountCents - T2;
    const room = q.C - q.TARIFF;
    const AV = Math.min(D, room);
    if (D <= 0 || AV <= 0) { avState.push({ status: 'ok', reason: null }); return; }
    q.AV = AV;
    avState.push({ status: 'finding', reason: null });
    const calc = [`Counted from ${q.S0}: ${usd(q.T.amountCents)}.`, `Counted from ${A}: ${usd(T2)}.`];
    if (D > room) calc.push(`Limited to the remaining charge of ${usd(room)}.`);
    calc.push(`Difference = ${usd(AV)}.`);
    findings.push(mk('DD-545-AVAILABILITY', 'Free time started before the cargo was available (46 CFR 545.5)', AV,
      `${oCtr(c, i)}: free time was counted from ${q.S0}, but the cargo was available on ${A}. Counting from ${A}, the attached tariff gives ${usd(T2)} instead of ${usd(q.T.amountCents)}. Whether demurrage relates free time to cargo availability is a factor under 46 CFR 545.5(c)(2)(i) - review.`,
      calc, 0.5, true, cite([['invoice', `/containers/${i}/evidence/cargoAvailableDate`], ['invoice', s0Ptr(i)]]), regClause('46 CFR 545.5(c)(2)(i)')));
  });
  // 6. remaining
  for (const q of per) q.R = q.C - q.TARIFF - q.RET - q.AV;

  // Part 541 applicability
  const applies = inv.invoiceDate === null || oDn(inv.invoiceDate) >= oDn('2024-05-28');
  const nvocc = inv.billingPartyType === 'NVOCC';
  let issuance: { status: OCheck['status']; reason: string | null };
  let content: { status: OCheck['status']; reason: string | null };
  // 7. LATE
  if (!applies) issuance = { status: 'not_applicable', reason: 'before_effective_date' };
  else if (inv.invoiceDate === null) issuance = { status: 'not_evaluated', reason: 'no_invoice_date' };
  else if (nvocc && inv.upstreamInvoiceDate === null) issuance = { status: 'not_evaluated', reason: 'no_upstream_invoice_date' };
  else if (!nvocc && !inv.containers.some((c) => c.periods.length)) issuance = { status: 'not_evaluated', reason: 'no_charge_dates' };
  else if (nvocc) {
    const g = oBetween(nn(inv.upstreamInvoiceDate), inv.invoiceDate);
    if (g > 30) {
      const sum = per.reduce((x, q) => x + q.R, 0);
      findings.push(mk('DD-541-7-LATE', 'Invoice issued more than 30 days late (46 CFR 541.7)', sum,
        `The invoice of this NVOCC is dated ${inv.invoiceDate}, ${g} calendar days after the invoice it received (${inv.upstreamInvoiceDate}). An invoice issued after 30 calendar days may not be payable under 46 CFR 541.7(b) - review.`,
        [`Upstream invoice ${inv.upstreamInvoiceDate}; this invoice ${inv.invoiceDate}: ${g} days (limit 30).`, ...inv.containers.map((c, i) => `${oCtr(c, i)}: remaining charge ${usd(nn(per[i]).R)}.`), `Total = ${usd(sum)}.`],
        0.7, true, cite([['invoice', '/invoiceDate'], ['invoice', '/upstreamInvoiceDate']]), regClause('46 CFR 541.7(b)')));
      for (const q of per) q.R = 0;
      issuance = { status: 'finding', reason: null };
    } else issuance = { status: 'ok', reason: null };
  } else {
    const late = inv.containers.map((c, i) => i).filter((i) => nn(per[i]).last !== null && oBetween(nn(nn(per[i]).last), nn(inv.invoiceDate)) > 30);
    if (late.length) {
      const sum = late.reduce((x, i) => x + nn(per[i]).R, 0);
      findings.push(mk('DD-541-7-LATE', 'Invoice issued more than 30 days late (46 CFR 541.7)', sum,
        `The invoice is dated ${inv.invoiceDate}. For ${late.length} container(s) it was issued more than 30 calendar days after the charge was last incurred. Such charges may not be payable under 46 CFR 541.7(a) - review.`,
        [...late.map((i) => `${oCtr(nn(inv.containers[i]), i)}: charge last incurred ${nn(per[i]).last}; invoice issued ${oBetween(nn(nn(per[i]).last), nn(inv.invoiceDate))} days later (limit 30); remaining charge ${usd(nn(per[i]).R)}.`), `Total = ${usd(sum)}.`],
        0.7, true, cite([['invoice', '/invoiceDate'], ...late.map((i) => ['invoice', `/containers/${i}/periods/${nn(per[i]).lastP}/to`] as [OCitation['source'], string])]), regClause('46 CFR 541.7(a)')));
      for (const i of late) nn(per[i]).R = 0;
      issuance = { status: 'finding', reason: null };
    } else issuance = { status: 'ok', reason: null };
  }
  // 8. CONTENT
  if (!applies) content = { status: 'not_applicable', reason: 'before_effective_date' };
  else {
    // E01-E20 are missing items; A01-A05 are inaccurate items (review fix F3)
    const issues: { cit: string; label: string; problem: string; ptr: string; inaccurate: boolean }[] = [];
    const add = (cit: string, label: string, problem: string, ptr: string, inaccurate = false) => issues.push({ cit, label, problem, ptr, inaccurate });
    const cs = inv.containers;
    const idx = (pred: (c: OContainer) => boolean) => cs.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0);
    const ctrs = (ix: number[]) => ix.map((i) => oCtr(nn(cs[i]), i)).join(', ');
    const sameT = (c: OContainer) => tariff !== null && tariff.chargeType === c.chargeType && tariff.direction === inv.direction;
    const L = {
      a1: 'Bill of lading number(s)', a2: 'Container number(s)', a3: 'Port(s) of discharge', a4: 'Basis for why the billed party is liable',
      b1: 'Invoice date', b2: 'Invoice due date', b3: 'Allowed free time in days', b4: 'Start date of free time', b5: 'End date of free time',
      b6: 'Container availability date', b7: 'Earliest return date', b8: 'Specific dates charged', c1: 'Total amount due', c2: 'Applicable tariff rule or contract',
      c3: 'Specific rate(s)', d1: 'Contact for questions and fee mitigation requests', d2: 'Digital link (URL or QR code) to the dispute process',
      d3: 'Dispute and resolution timeframes', e1: 'Certification that the charges comply with FMC rules', e2: "Certification that the billing party's performance did not cause the charges",
    };
    const P = '46 CFR 541.6';
    if (!inv.billOfLadingNumbers.length) add(`${P}(a)(1)`, L.a1, 'missing', '/billOfLadingNumbers');
    let ix = idx((c) => c.containerNumber === null);
    if (ix.length) add(`${P}(a)(2)`, L.a2, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/containerNumber`);
    if (inv.direction === 'IMPORT' && inv.portOfDischarge === null) add(`${P}(a)(3)`, L.a3, 'missing', '/portOfDischarge');
    if (inv.liabilityBasis === null) add(`${P}(a)(4)`, L.a4, 'missing', '/liabilityBasis');
    if (inv.invoiceDate === null) add(`${P}(b)(1)`, L.b1, 'missing', '/invoiceDate');
    if (inv.dueDate === null) add(`${P}(b)(2)`, L.b2, 'missing', '/dueDate');
    ix = idx((c) => c.freeDays === null);
    if (ix.length) add(`${P}(b)(3)`, L.b3, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/freeDays`);
    cs.forEach((c, i) => {
      if (c.freeDays !== null && sameT(c) && c.freeDays !== nn(tariff).freeDays) add(`${P}(b)(3)`, L.b3, `${oCtr(c, i)}: stated ${c.freeDays} days, the attached tariff allows ${nn(tariff).freeDays}`, `/containers/${i}/freeDays`, true);
    });
    ix = idx((c) => c.freeTimeStart === null);
    if (ix.length) add(`${P}(b)(4)`, L.b4, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/freeTimeStart`);
    ix = idx((c) => c.freeTimeEnd === null);
    if (ix.length) add(`${P}(b)(5)`, L.b5, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/freeTimeEnd`);
    cs.forEach((c, i) => {
      if (c.freeTimeEnd === null) return;
      const ks = c.periods.map((p, k) => (oDn(p.from) <= oDn(nn(c.freeTimeEnd)) ? k : -1)).filter((k) => k >= 0);
      if (!ks.length) return;
      const k = ks.reduce((a, b) => (oDn(nn(c.periods[b]).from) < oDn(nn(c.periods[a]).from) ? b : a));
      add(`${P}(b)(5)`, L.b5, `${oCtr(c, i)} is charged on ${nn(c.periods[k]).from}, on or before the stated free time end ${c.freeTimeEnd}`, `/containers/${i}/periods/${k}/from`, true);
    });
    cs.forEach((c, i) => {
      if (c.freeTimeStart === null || c.freeTimeEnd === null || !sameT(c)) return;
      let got: string;
      try { got = oFreeTimeEnd(c.freeTimeStart, nn(tariff), calendar); } catch (e) { if (e instanceof RangeError) return; throw e; }
      if (got !== c.freeTimeEnd) add(`${P}(b)(5)`, L.b5, `${oCtr(c, i)}: stated ${c.freeTimeEnd}, the attached tariff gives ${got}`, `/containers/${i}/freeTimeEnd`, true);
    });
    if (inv.direction === 'IMPORT') { ix = idx((c) => c.availabilityDate === null); if (ix.length) add(`${P}(b)(6)`, L.b6, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/availabilityDate`); }
    if (inv.direction === 'EXPORT') { ix = idx((c) => c.earliestReturnDate === null); if (ix.length) add(`${P}(b)(7)`, L.b7, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/earliestReturnDate`); }
    ix = idx((c) => c.periods.length === 0);
    if (ix.length) add(`${P}(b)(8)`, L.b8, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/periods`);
    if (inv.totalDue === null) add(`${P}(c)(1)`, L.c1, 'missing', '/totalDue');
    if (inv.ruleReference === null) add(`${P}(c)(2)`, L.c2, 'missing', '/ruleReference');
    ix = idx((c) => c.periods.some((p) => p.rate === null));
    if (ix.length) add(`${P}(c)(3)`, L.c3, `missing for ${ctrs(ix)}`, `/containers/${ix[0]}/periods/${nn(cs[nn(ix[0])]).periods.findIndex((p) => p.rate === null)}/rate`);
    if (inv.disputeContact === null) add(`${P}(d)(1)`, L.d1, 'missing', '/disputeContact');
    if (inv.disputeDigitalMeans === null) add(`${P}(d)(2)`, L.d2, 'missing', '/disputeDigitalMeans');
    const rq = inv.disputeRequestDays, rs = inv.disputeResolutionDays;
    if (rq === null && rs === null) add(`${P}(d)(3)`, L.d3, 'missing', '/disputeRequestDays');
    else if (rq === null) add(`${P}(d)(3)`, L.d3, 'request window missing', '/disputeRequestDays');
    else if (rs === null) add(`${P}(d)(3)`, L.d3, 'resolution time missing', '/disputeResolutionDays');
    if (rq !== null && rq < 30) add(`${P}(d)(3)`, L.d3, `request window of ${rq} days is shorter than the 30 calendar days required by 46 CFR 541.8(a)`, '/disputeRequestDays', true);
    if (rs !== null && rs > 30) add(`${P}(d)(3)`, L.d3, `resolution time of ${rs} days is longer than the 30 calendar days in 46 CFR 541.8(b)`, '/disputeResolutionDays', true);
    if (!inv.certifiesFmcRules) add(`${P}(e)(1)`, L.e1, 'not stated', '/certifiesFmcRules');
    if (!inv.certifiesPerformance) add(`${P}(e)(2)`, L.e2, 'not stated', '/certifiesPerformance');
    if (issues.length) {
      const labels = [...new Set(issues.map((x) => x.label))];
      const sum = per.reduce((x, q) => x + q.R, 0);
      const missing = issues.some((x) => !x.inaccurate);
      const firstCit = issues[0]?.cit ?? '';
      findings.push(mk('DD-541-6-CONTENT', missing ? 'Required invoice information missing or inaccurate (46 CFR 541.6)' : 'Required invoice information inaccurate (46 CFR 541.6)', sum,
        missing
          ? `The invoice lacks or misstates ${labels.length} item(s) that 46 CFR 541.6 requires: ${labels.join('; ')}. Under 46 CFR 541.5, failure to include required information eliminates the obligation to pay the charge - review whether this applies.`
          : `The invoice misstates ${labels.length} item(s) that 46 CFR 541.6 requires: ${labels.join('; ')}. 46 CFR 541.6 requires this information to be accurate - review whether to dispute the charge.`,
        [...issues.map((x) => `${x.cit} ${x.label}: ${x.problem}.`), `Remaining invoice charges = ${usd(sum)}.`],
        0.7, true, cite(issues.map((x) => ['invoice', x.ptr] as [OCitation['source'], string])), regClause(missing ? '46 CFR 541.5' : firstCit.startsWith('46 CFR 541.6(b)') ? '46 CFR 541.6(b)' : '46 CFR 541.6(d)')));
      content = { status: 'finding', reason: null };
    } else content = { status: 'ok', reason: null };
  }

  const checks: OCheck[] = [
    applies ? (inv.invoiceDate === null ? { id: 'part541', containerIndex: null, status: 'not_evaluated', reason: 'no_invoice_date' } : { id: 'part541', containerIndex: null, status: 'ok', reason: null })
      : { id: 'part541', containerIndex: null, status: 'not_applicable', reason: 'before_effective_date' },
    { id: 'content', containerIndex: null, ...content },
    { id: 'issuance', containerIndex: null, ...issuance },
    inv.totalDue === null ? { id: 'total', containerIndex: null, status: 'not_evaluated', reason: 'no_total' } : { id: 'total', containerIndex: null, status: totalFinding ? 'finding' : 'ok', reason: null },
    { id: 'line_arithmetic', containerIndex: null, status: periodFindings ? 'finding' : 'ok', reason: null },
  ];
  inv.containers.forEach((c, i) => {
    const q = nn(per[i]);
    checks.push(q.T ? { id: 'tariff', containerIndex: i, status: q.TARIFF > 0 ? 'finding' : 'ok', reason: null } : { id: 'tariff', containerIndex: i, status: 'not_evaluated', reason: q.reason });
    checks.push({ id: 'availability', containerIndex: i, ...nn(avState[i]) });
    const r = nn(retState[i]);
    checks.push(r === 'na' ? { id: 'return_refused', containerIndex: i, status: 'not_applicable', reason: 'not_detention' }
      : r === 'noev' ? { id: 'return_refused', containerIndex: i, status: 'not_evaluated', reason: 'no_evidence' }
        : { id: 'return_refused', containerIndex: i, status: r, reason: null });
  });
  const containers: OSummary[] = inv.containers.map((c, i) => ({
    index: i, label: oCtr(c, i), chargeType: c.chargeType, sizeType: c.sizeType, chargedCents: nn(per[i]).C,
    expectedCents: nn(per[i]).T ? nn(nn(per[i]).T).amountCents : null, freeTimeEnd: nn(per[i]).T ? nn(nn(per[i]).T).freeTimeEnd : null, chargeableDays: nn(per[i]).T ? nn(nn(per[i]).T).chargeableDays : null,
  }));
  const rec = findings.filter((f) => !f.needsHumanReview).reduce((x, f) => x + f.amountCents, 0);
  const pend = findings.filter((f) => f.needsHumanReview).reduce((x, f) => x + f.amountCents, 0);
  return { rulesVersion: 'dd-rules-v1', findings, recoverableCents: rec, pendingReviewCents: pend, recoverable: oMoney(rec), pendingReview: oMoney(pend), checks, containers };
}

// ---------------------------------------------------------------------------------------------------------------
// C7 letter
// ---------------------------------------------------------------------------------------------------------------
export function oLetter(inv: OInvoice, r: OResult, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new RangeError('bad today');
  const bls = inv.billOfLadingNumbers.length ? inv.billOfLadingNumbers.map((x) => oPlain(x, 40)).join(', ') : 'N/A';
  const L = [
    'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.', '', `Date: ${today}`, `To: ${oPlain(inv.billingPartyName)}`, `From: ${oPlain(inv.billedPartyName)}`,
    `Re: Invoice ${oPlain(inv.invoiceNumber)} / B/L ${bls} - request for fee mitigation, refund or waiver`, '',
    'We reviewed the above demurrage and detention invoice against 46 CFR Part 541, 46 CFR 545.5 and the applicable tariff, and ask you to review the following items:', '',
  ];
  if (!r.findings.length) {
    L.push('(No items found. Do not send.)', '', 'No amount is requested: there are no findings.');
  } else {
    r.findings.forEach((f, k) => { L.push(`${k + 1}. ${oPlain(f.title)}: $${f.amount}${f.needsHumanReview ? ' (needs review)' : ''}`, `   ${oPlain(f.explanation, 600)}`); });
    const deadline = inv.invoiceDate === null ? 'the invoice date is missing'
      : `based on the invoice date ${inv.invoiceDate}, request by ${oAdd(inv.invoiceDate, Math.max(30, inv.disputeRequestDays ?? 0))}`;
    L.push('', `Confirmed amount: $${r.recoverable}. Amount for review: $${r.pendingReview}.`,
      'We request a credit, refund or waiver of these amounts. Supporting calculations are attached in the evidence packet.',
      'Under 46 CFR 541.8(b) the billing party must attempt to resolve the request "within thirty (30) calendar days of receiving such a request or at a later date as agreed upon by both parties."',
      `(Reminder for sender: remove items that do not apply. 46 CFR 541.8(a) allows at least 30 calendar days from the invoice date to request mitigation, refund or waiver; ${deadline}. Check the dates before sending.)`);
  }
  L.push('', 'Sincerely,', '[Name / Title / Contact - to be completed by sender]');
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Seeded RNG (mulberry32)
// ---------------------------------------------------------------------------------------------------------------
export function oRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => nn(xs[Math.floor(next() * xs.length)]);
  return { next, int, pick, chance: (p: number) => next() < p };
}
