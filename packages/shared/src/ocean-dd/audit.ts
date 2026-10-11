/**
 * C5/C6: `auditDdInvoice` - the deterministic D&D invoice audit. Pure: no clock, network, files or env.
 *
 * Passes: (1) per-container charges C_i, last charged date and PERIOD findings; (2) tariff recomputation T_i
 * (RangeError -> not evaluable, `invalid_dates`); (3) RETURN (545.5(c)(2)(ii)); (4) AVAILABILITY
 * (545.5(c)(2)(i)); (5) remaining charge R_i; (6) LATE (541.7); (7) CONTENT (541.6 / 541.5); (8) checks and
 * container summaries. Amounts are carved from the remaining charge in the order TOTAL, PERIOD, TARIFF,
 * RETURN, AVAILABILITY, LATE, CONTENT (decision D6), so findings never double count. Every rule text lives
 * in `TEXT` below so wording cannot drift.
 */
import { canonicalJson } from '../canonical-json.js';
import type { DdAuditResultDto, DdCalendarDataDto, DdCheckDto, DdContainerDto, DdFindingDto, DdInvoiceDataDto, DdTariffDataDto } from '../ocean-dd-dto.js';
import { ddMoneyCents } from '../ocean-dd-dto.js';
import { plain } from '../text-sanitize.js';

import {
  DD_CONFIDENCE_541,
  DD_CONFIDENCE_545,
  DD_CONFIDENCE_ARITHMETIC,
  DD_ISSUE_DEADLINE_DAYS,
  DD_DISPUTE_MIN_DAYS,
  DD_PART541_EFFECTIVE,
  DD_RESOLUTION_MAX_DAYS,
  DD_RULES_VERSION,
  DD_SPAN_MAX_DAYS,
  type DdCheckId,
  type DdCheckStatus,
  type DdRuleId,
} from './constants.js';
import { ddDayNumber, ddDaysBetween } from './dates.js';
import { DD_REGULATION_TEXT, type DdRegulationKey } from './regulation.js';
import { computeFreeTimeEnd, computeTariffCharge, ddDateList, fmtCents, type DdTariffCharge } from './tariff.js';

/** Excerpt cap of citations and clauses. */
const EXCERPT_LIMIT = 200;
/** Cap of a container number in texts. */
const CONTAINER_LIMIT = 20;
/** Cap of a tariff name in texts. */
const TARIFF_NAME_LIMIT = 120;

export type DdCitationSource = 'invoice' | 'tariff' | 'calendar';
type DdFinding = DdFindingDto;
type DdCitation = DdFindingDto['citations'][number];
type DdClause = NonNullable<DdFindingDto['clause']>;
type DdCheck = DdCheckDto;
type DdAuditResult = DdAuditResultDto;

export interface DdAuditInput {
  invoice: DdInvoiceDataDto;
  tariff: DdTariffDataDto | null;
  calendar: DdCalendarDataDto | null;
}

const $ = (c: number): string => `$${fmtCents(c)}`;

/** `Container {number}` or `Container #{i+1}`. */
export function ddContainerLabel(c: Pick<DdContainerDto, 'containerNumber'>, i: number): string {
  return c.containerNumber === null ? `Container #${i + 1}` : `Container ${plain(c.containerNumber, CONTAINER_LIMIT)}`;
}

const typeWord = (t: DdContainerDto['chargeType']): string => (t === 'DEMURRAGE' ? 'demurrage' : 'detention');

/** Every rule's fixed texts (C5). */
const TEXT = {
  total: {
    title: 'Invoice total exceeds the sum of its charges',
    explanation: (total: number, a: number, sum: number) => `The invoice total due (${$(total)}) is ${$(a)} more than the sum of its charge lines (${$(sum)}).`,
    calculation: (total: number, a: number, sum: number) => [`Sum of charge lines = ${$(sum)}.`, `Total due on the invoice = ${$(total)}.`, `Difference = ${$(a)}.`],
  },
  period: {
    title: 'Charge line does not match days x rate',
    explanation: (ctr: string, from: string, to: string, stated: number, days: number, rate: number, computed: number) =>
      `${ctr}: the charge for ${from} to ${to} is ${$(stated)}, but ${days} day(s) x ${$(rate)} = ${$(computed)}.`,
    calculation: (ctr: string, from: string, to: string, stated: number, days: number, rate: number, computed: number) => [
      `${ctr}, ${from} to ${to}: ${days} calendar day(s).`,
      `${days} x ${$(rate)} = ${$(computed)}.`,
      `Charged: ${$(stated)}. Difference = ${$(stated - computed)}.`,
    ],
  },
  tariff: {
    title: 'Charges exceed the attached tariff',
    explanation: (ctr: string, size: string, type: string, name: string, t: number, n: number, c: number) =>
      `${ctr} (${size}, ${type}): the attached tariff '${name}' gives ${$(t)} for ${n} chargeable day(s), but the invoice charges ${$(c)}.`,
    clock: (s0: string, startFromEvidence: boolean, e0: string, stopFromEvidence: boolean) =>
      `Clock start ${s0} (${startFromEvidence ? 'your evidence' : 'invoice free time start'}); clock stop ${e0} (${stopFromEvidence ? 'your evidence' : 'last charged date on the invoice'}).`,
    charged: (c: number) => `Invoice charges for this container = ${$(c)}.`,
    difference: (d: number) => `Difference = ${$(d)}.`,
  },
  ret: {
    title: 'Detention charged while empty return was refused (46 CFR 545.5)',
    explanation: (ctr: string, k: number, list: string) =>
      `${ctr}: ${k} charged day(s) fall on dates when the empty container could not be returned (${list}). Under 46 CFR 545.5(c)(2)(ii), "Absent extenuating circumstances, practices and regulations that provide for imposition of detention when it does not serve its incentivizing purposes, such as when empty containers cannot be returned, are likely to be found unreasonable." - review.`,
    rated: (date: string, rate: number, source: string) => `${date}: ${$(rate)} (${source}).`,
    unrated: (date: string) => `${date}: no rate stated on the invoice.`,
    total: (v: number) => `Total = ${$(v)}.`,
  },
  availability: {
    title: 'Free time started before the cargo was available (46 CFR 545.5)',
    explanation: (ctr: string, s0: string, a: string, tPrime: number, t: number) =>
      `${ctr}: free time was counted from ${s0}, but the cargo was available on ${a}. Counting from ${a}, the attached tariff gives ${$(tPrime)} instead of ${$(t)}. Whether demurrage relates free time to cargo availability is a factor under 46 CFR 545.5(c)(2)(i) - review.`,
    countedFrom: (d: string, v: number) => `Counted from ${d}: ${$(v)}.`,
    difference: (v: number) => `Difference = ${$(v)}.`,
  },
  limited: (v: number) => `Limited to the remaining charge of ${$(v)}.`,
  late: {
    title: 'Invoice issued more than 30 days late (46 CFR 541.7)',
    explanationA: (invoiceDate: string, m: number) =>
      `The invoice is dated ${invoiceDate}. For ${m} container(s) it was issued more than 30 calendar days after the charge was last incurred. Such charges may not be payable under 46 CFR 541.7(a) - review.`,
    lineA: (ctr: string, last: string, g: number, r: number) => `${ctr}: charge last incurred ${last}; invoice issued ${g} days later (limit 30); remaining charge ${$(r)}.`,
    explanationB: (invoiceDate: string, g: number, upstream: string) =>
      `The invoice of this NVOCC is dated ${invoiceDate}, ${g} calendar days after the invoice it received (${upstream}). An invoice issued after 30 calendar days may not be payable under 46 CFR 541.7(b) - review.`,
    headB: (upstream: string, invoiceDate: string, g: number) => `Upstream invoice ${upstream}; this invoice ${invoiceDate}: ${g} days (limit 30).`,
    lineB: (ctr: string, r: number) => `${ctr}: remaining charge ${$(r)}.`,
    total: (v: number) => `Total = ${$(v)}.`,
  },
  content: {
    title: 'Required invoice information missing or inaccurate (46 CFR 541.6)',
    explanation: (m: number, labels: string) =>
      `The invoice lacks or misstates ${m} item(s) that 46 CFR 541.6 requires: ${labels}. Under 46 CFR 541.5, failure to include required information eliminates the obligation to pay the charge - review whether this applies.`,
    /** Only inaccurate items (A01-A05; review fix F3). */
    inaccurateTitle: 'Required invoice information inaccurate (46 CFR 541.6)',
    inaccurateExplanation: (m: number, labels: string) =>
      `The invoice misstates ${m} item(s) that 46 CFR 541.6 requires: ${labels}. 46 CFR 541.6 requires this information to be accurate - review whether to dispute the charge.`,
    line: (citation: string, label: string, problem: string) => `${citation} ${label}: ${problem}.`,
    remaining: (v: number) => `Remaining invoice charges = ${$(v)}.`,
  },
} as const;

/** C5 content elements: citation and label per id. */
const ELEMENTS = {
  E01: ['46 CFR 541.6(a)(1)', 'Bill of lading number(s)'],
  E02: ['46 CFR 541.6(a)(2)', 'Container number(s)'],
  E03: ['46 CFR 541.6(a)(3)', 'Port(s) of discharge'],
  E04: ['46 CFR 541.6(a)(4)', 'Basis for why the billed party is liable'],
  E05: ['46 CFR 541.6(b)(1)', 'Invoice date'],
  E06: ['46 CFR 541.6(b)(2)', 'Invoice due date'],
  E07: ['46 CFR 541.6(b)(3)', 'Allowed free time in days'],
  A03: ['46 CFR 541.6(b)(3)', 'Allowed free time in days'],
  E08: ['46 CFR 541.6(b)(4)', 'Start date of free time'],
  E09: ['46 CFR 541.6(b)(5)', 'End date of free time'],
  A01: ['46 CFR 541.6(b)(5)', 'End date of free time'],
  A02: ['46 CFR 541.6(b)(5)', 'End date of free time'],
  E10: ['46 CFR 541.6(b)(6)', 'Container availability date'],
  E11: ['46 CFR 541.6(b)(7)', 'Earliest return date'],
  E12: ['46 CFR 541.6(b)(8)', 'Specific dates charged'],
  E13: ['46 CFR 541.6(c)(1)', 'Total amount due'],
  E14: ['46 CFR 541.6(c)(2)', 'Applicable tariff rule or contract'],
  E15: ['46 CFR 541.6(c)(3)', 'Specific rate(s)'],
  E16: ['46 CFR 541.6(d)(1)', 'Contact for questions and fee mitigation requests'],
  E17: ['46 CFR 541.6(d)(2)', 'Digital link (URL or QR code) to the dispute process'],
  E18: ['46 CFR 541.6(d)(3)', 'Dispute and resolution timeframes'],
  A04: ['46 CFR 541.6(d)(3)', 'Dispute and resolution timeframes'],
  A05: ['46 CFR 541.6(d)(3)', 'Dispute and resolution timeframes'],
  E19: ['46 CFR 541.6(e)(1)', 'Certification that the charges comply with FMC rules'],
  E20: ['46 CFR 541.6(e)(2)', "Certification that the billing party's performance did not cause the charges"],
} as const satisfies Record<string, readonly [string, string]>;
type ElementId = keyof typeof ELEMENTS;

interface Issue {
  id: ElementId;
  problem: string;
  pointer: string;
}

// ---------------------------------------------------------------------------------------------
// Citations: RFC 6901 pointers into the C4 data objects and the excerpt rule (C5.11)
// ---------------------------------------------------------------------------------------------

function unescapeToken(t: string): string {
  return t.replace(/~1/gu, '/').replace(/~0/gu, '~');
}

/** Value at an RFC 6901 pointer (own properties only), or undefined. */
export function resolveDdPointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  if (!pointer.startsWith('/')) return undefined;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const token = unescapeToken(raw);
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(token)) return undefined;
      cur = cur[Number(token)];
    } else if (typeof cur === 'object' && cur !== null && Object.hasOwn(cur, token)) {
      cur = (cur as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** C5.11 excerpt text of a value. */
export function ddExcerpt(value: unknown): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number') text = String(value);
  else if (typeof value === 'boolean') text = value ? 'yes' : 'no';
  else if (value === null || value === undefined) text = '(missing)';
  else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) text = value.length === 0 ? '(none)' : value.join(', ');
  else text = canonicalJson(value);
  return plain(text, EXCERPT_LIMIT);
}

class Citer {
  private readonly out: DdCitation[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly docs: Readonly<Record<DdCitationSource, unknown>>) {}

  add(source: DdCitationSource, pointer: string): this {
    const key = `${source}\u0000${pointer}`;
    if (this.seen.has(key)) return this;
    this.seen.add(key);
    this.out.push({ source, pointer, excerpt: ddExcerpt(resolveDdPointer(this.docs[source], pointer)) });
    return this;
  }

  list(): DdCitation[] {
    return this.out;
  }
}

const regulationClause = (key: DdRegulationKey): DdClause => ({ source: 'regulation', key, label: key, excerpt: plain(DD_REGULATION_TEXT[key], EXCERPT_LIMIT) });

// ---------------------------------------------------------------------------------------------
// Per-container state
// ---------------------------------------------------------------------------------------------

type TariffReason = 'no_tariff' | 'tariff_mismatch' | 'size_not_in_tariff' | 'no_dates' | 'invalid_dates';

interface PeriodCalc {
  days: number;
  stated: number;
  rate: number | null;
  computed: number | null;
}

interface ContainerCalc {
  index: number;
  label: string;
  periods: PeriodCalc[];
  charged: number;
  /** Latest `to` and the index of its period (null without periods). */
  last: string | null;
  lastPeriod: number | null;
  s0: string | null;
  startFromEvidence: boolean;
  e0: string | null;
  stopFromEvidence: boolean;
  charge: DdTariffCharge | null;
  reason: TariffReason | null;
  tariffCut: number;
  retCut: number;
  avCut: number;
  remaining: number;
}

function tariffMatches(tariff: DdTariffDataDto | null, invoice: DdInvoiceDataDto, c: DdContainerDto): tariff is DdTariffDataDto {
  return tariff !== null && tariff.chargeType === c.chargeType && tariff.direction === invoice.direction;
}

function containerCalc(invoice: DdInvoiceDataDto, tariff: DdTariffDataDto | null, calendar: DdCalendarDataDto | null, c: DdContainerDto, i: number): ContainerCalc {
  const periods = c.periods.map((p): PeriodCalc => {
    const days = ddDaysBetween(p.from, p.to) + 1;
    const rate = p.rate === null ? null : ddMoneyCents(p.rate);
    return { days, stated: ddMoneyCents(p.amount), rate, computed: rate === null ? null : days * rate };
  });
  const charged = periods.reduce((sum, p) => sum + (p.computed === null ? p.stated : Math.min(p.stated, p.computed)), 0);
  let last: string | null = null;
  let lastPeriod: number | null = null;
  c.periods.forEach((p, k) => {
    if (last === null || p.to > last) {
      last = p.to;
      lastPeriod = k;
    }
  });
  const s0 = c.evidence.clockStart ?? c.freeTimeStart;
  const e0 = c.evidence.clockStop ?? last;
  const calc: ContainerCalc = {
    index: i,
    label: ddContainerLabel(c, i),
    periods,
    charged,
    last,
    lastPeriod,
    s0,
    startFromEvidence: c.evidence.clockStart !== null,
    e0,
    stopFromEvidence: c.evidence.clockStop !== null,
    charge: null,
    reason: null,
    tariffCut: 0,
    retCut: 0,
    avCut: 0,
    remaining: 0,
  };
  if (tariff === null) calc.reason = 'no_tariff';
  else if (!tariffMatches(tariff, invoice, c)) calc.reason = 'tariff_mismatch';
  else if (!tariff.tiers.every((t) => Object.hasOwn(t.rates, c.sizeType))) calc.reason = 'size_not_in_tariff';
  else if (s0 === null || e0 === null) calc.reason = 'no_dates';
  else if (s0 > e0 || ddDaysBetween(s0, e0) > DD_SPAN_MAX_DAYS) calc.reason = 'invalid_dates';
  else {
    try {
      calc.charge = computeTariffCharge({ start: s0, stop: e0, sizeType: c.sizeType, tariff, calendar });
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      calc.reason = 'invalid_dates';
    }
  }
  return calc;
}

function finding(
  ruleId: DdRuleId,
  title: string,
  amountCents: number,
  explanation: string,
  calculation: string[],
  review: boolean,
  confidence: number,
  citations: DdCitation[],
  clause: DdClause | null,
): DdFinding {
  return { ruleId, title, direction: 'overcharge', amountCents, amount: fmtCents(amountCents), explanation, calculation, confidence, needsHumanReview: review, citations, clause };
}

/** C5/C6: audit one D&D invoice against Part 541, 545.5 and the attached tariff and calendar. */
export function auditDdInvoice(input: DdAuditInput): DdAuditResult {
  const { invoice, tariff, calendar } = input;
  const docs = { invoice, tariff, calendar } as const;
  const cite = (): Citer => new Citer(docs);
  const containers = invoice.containers;
  const calcs = containers.map((c, i) => containerCalc(invoice, tariff, calendar, c, i));

  const totals: DdFinding[] = [];
  const periodsF: DdFinding[] = [];
  const tariffF: DdFinding[] = [];
  const returnF: DdFinding[] = [];
  const availF: DdFinding[] = [];
  const lateF: DdFinding[] = [];
  const contentF: DdFinding[] = [];
  const checks: DdCheck[] = [];
  const check = (id: DdCheckId, containerIndex: number | null, status: DdCheckStatus, reason: string | null = null): void => {
    checks.push({ id, containerIndex, status, reason });
  };

  // 1. TOTAL
  const statedSum = calcs.reduce((s, c) => s + c.periods.reduce((t, p) => t + p.stated, 0), 0);
  const totalDue = invoice.totalDue === null ? null : ddMoneyCents(invoice.totalDue);
  if (totalDue !== null && totalDue - statedSum > 0) {
    const a = totalDue - statedSum;
    totals.push(
      finding('DD-TOTAL-MISMATCH', TEXT.total.title, a, TEXT.total.explanation(totalDue, a, statedSum), TEXT.total.calculation(totalDue, a, statedSum), false, DD_CONFIDENCE_ARITHMETIC, cite().add('invoice', '/totalDue').list(), null),
    );
  }

  // 2. PERIOD
  calcs.forEach((c, i) => {
    const ctr = containers[i];
    if (!ctr) return;
    c.periods.forEach((p, k) => {
      const src = ctr.periods[k];
      if (!src || p.rate === null || p.computed === null || p.stated <= p.computed) return;
      const base = `/containers/${i}/periods/${k}`;
      periodsF.push(
        finding(
          'DD-PERIOD-ARITH',
          TEXT.period.title,
          p.stated - p.computed,
          TEXT.period.explanation(c.label, src.from, src.to, p.stated, p.days, p.rate, p.computed),
          TEXT.period.calculation(c.label, src.from, src.to, p.stated, p.days, p.rate, p.computed),
          false,
          DD_CONFIDENCE_ARITHMETIC,
          cite().add('invoice', `${base}/amount`).add('invoice', `${base}/rate`).list(),
          null,
        ),
      );
    });
  });

  const startPointer = (c: ContainerCalc): string => (c.startFromEvidence ? `/containers/${c.index}/evidence/clockStart` : `/containers/${c.index}/freeTimeStart`);

  // 3. TARIFF
  for (const c of calcs) {
    const ctr = containers[c.index];
    if (!ctr || c.charge === null || tariff === null || c.s0 === null || c.e0 === null) continue;
    if (c.charged <= c.charge.amountCents) continue;
    c.tariffCut = c.charged - c.charge.amountCents;
    const citer = cite();
    ctr.periods.forEach((_p, k) => citer.add('invoice', `/containers/${c.index}/periods/${k}/amount`));
    citer.add('invoice', startPointer(c));
    if (c.stopFromEvidence) citer.add('invoice', `/containers/${c.index}/evidence/clockStop`);
    citer.add('tariff', '/tiers');
    if (calendar !== null) citer.add('calendar', '/closedDates').add('calendar', '/shutoutDates');
    tariffF.push(
      finding(
        'DD-TARIFF-OVERCHARGE',
        TEXT.tariff.title,
        c.tariffCut,
        TEXT.tariff.explanation(c.label, ctr.sizeType, typeWord(ctr.chargeType), plain(tariff.name, TARIFF_NAME_LIMIT), c.charge.amountCents, c.charge.chargeableDays, c.charged),
        [TEXT.tariff.clock(c.s0, c.startFromEvidence, c.e0, c.stopFromEvidence), ...c.charge.steps, TEXT.tariff.charged(c.charged), TEXT.tariff.difference(c.tariffCut)],
        false,
        DD_CONFIDENCE_ARITHMETIC,
        citer.list(),
        { source: 'tariff', key: '/tiers', label: 'Attached tariff', excerpt: plain(`${tariff.name}; ${tariff.ruleReference ?? 'no rule reference'}`, EXCERPT_LIMIT) },
      ),
    );
  }

  // 4. RETURN (detention while the empty return was refused)
  const returnStatus = new Map<number, DdCheckStatus>();
  for (const c of calcs) {
    const ctr = containers[c.index];
    if (!ctr || ctr.chargeType !== 'DETENTION' || ctr.evidence.emptyReturnRefusedDates.length === 0) continue;
    const refused = ctr.evidence.emptyReturnRefusedDates;
    const lines: string[] = [];
    const dates: string[] = [];
    let value = 0;
    if (c.charge !== null) {
      const byDate = new Map(c.charge.chargeableDates.map((d) => [d.date, d]));
      for (const date of refused) {
        const hit = byDate.get(date);
        if (!hit) continue;
        dates.push(date);
        value += hit.rateCents;
        lines.push(TEXT.ret.rated(date, hit.rateCents, `tariff tier ${hit.tier}`));
      }
    } else {
      for (const date of refused) {
        const n = ddDayNumber(date);
        const k = ctr.periods.findIndex((p) => ddDayNumber(p.from) <= n && n <= ddDayNumber(p.to));
        if (k < 0) continue;
        const rate = c.periods[k]?.rate ?? null;
        dates.push(date);
        if (rate === null) lines.push(TEXT.ret.unrated(date));
        else {
          value += rate;
          lines.push(TEXT.ret.rated(date, rate, 'invoice rate'));
        }
      }
    }
    if (dates.length === 0) {
      returnStatus.set(c.index, 'ok');
      continue;
    }
    returnStatus.set(c.index, 'finding');
    const room = c.charged - c.tariffCut;
    c.retCut = Math.min(value, room);
    if (value > room) lines.push(TEXT.limited(room));
    lines.push(TEXT.ret.total(c.retCut));
    returnF.push(
      finding(
        'DD-545-RETURN-REFUSED',
        TEXT.ret.title,
        c.retCut,
        TEXT.ret.explanation(c.label, dates.length, ddDateList(dates)),
        lines,
        true,
        DD_CONFIDENCE_545,
        cite().add('invoice', `/containers/${c.index}/evidence/emptyReturnRefusedDates`).list(),
        regulationClause('46 CFR 545.5(c)(2)(ii)'),
      ),
    );
  }

  // 5. AVAILABILITY (demurrage free time before cargo availability)
  const availReason = new Map<number, { status: DdCheckStatus; reason: string | null }>();
  for (const c of calcs) {
    const ctr = containers[c.index];
    if (!ctr) continue;
    if (!(ctr.chargeType === 'DEMURRAGE' && invoice.direction === 'IMPORT')) {
      availReason.set(c.index, { status: 'not_applicable', reason: 'not_import_demurrage' });
      continue;
    }
    const a = ctr.evidence.cargoAvailableDate;
    if (a === null) {
      availReason.set(c.index, { status: 'not_evaluated', reason: 'no_evidence' });
      continue;
    }
    if (c.charge === null || tariff === null || c.s0 === null || c.e0 === null) {
      availReason.set(c.index, { status: 'not_evaluated', reason: c.reason });
      continue;
    }
    if (a <= c.s0) {
      availReason.set(c.index, { status: 'ok', reason: null });
      continue;
    }
    let tPrime = 0;
    if (a <= c.e0) {
      try {
        tPrime = computeTariffCharge({ start: a, stop: c.e0, sizeType: ctr.sizeType, tariff, calendar }).amountCents;
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        availReason.set(c.index, { status: 'not_evaluated', reason: 'invalid_dates' });
        continue;
      }
    }
    const t = c.charge.amountCents;
    const d = t - tPrime;
    const room = c.charged - c.tariffCut;
    const av = d > 0 ? Math.min(d, room) : 0;
    if (av <= 0) {
      availReason.set(c.index, { status: 'ok', reason: null });
      continue;
    }
    c.avCut = av;
    availReason.set(c.index, { status: 'finding', reason: null });
    const lines = [TEXT.availability.countedFrom(c.s0, t), TEXT.availability.countedFrom(a, tPrime)];
    if (d > room) lines.push(TEXT.limited(room));
    lines.push(TEXT.availability.difference(av));
    availF.push(
      finding(
        'DD-545-AVAILABILITY',
        TEXT.availability.title,
        av,
        TEXT.availability.explanation(c.label, c.s0, a, tPrime, t),
        lines,
        true,
        DD_CONFIDENCE_545,
        cite().add('invoice', `/containers/${c.index}/evidence/cargoAvailableDate`).add('invoice', startPointer(c)).list(),
        regulationClause('46 CFR 545.5(c)(2)(i)'),
      ),
    );
  }

  // 6. Remaining charge
  for (const c of calcs) c.remaining = c.charged - c.tariffCut - c.retCut - c.avCut;

  // 9. Part 541 applicability
  const part541 = invoice.invoiceDate === null || invoice.invoiceDate >= DD_PART541_EFFECTIVE;
  const nvocc = invoice.billingPartyType === 'NVOCC';
  const anyPeriods = calcs.some((c) => c.last !== null);

  // 7. LATE
  let issuance: { status: DdCheckStatus; reason: string | null };
  if (!part541) issuance = { status: 'not_applicable', reason: 'before_effective_date' };
  else if (invoice.invoiceDate === null) issuance = { status: 'not_evaluated', reason: 'no_invoice_date' };
  else if (nvocc) {
    const upstream = invoice.upstreamInvoiceDate;
    if (upstream === null) issuance = { status: 'not_evaluated', reason: 'no_upstream_invoice_date' };
    else {
      const g = ddDaysBetween(upstream, invoice.invoiceDate);
      if (g > DD_ISSUE_DEADLINE_DAYS) {
        issuance = { status: 'finding', reason: null };
        const lines = [TEXT.late.headB(upstream, invoice.invoiceDate, g)];
        let sum = 0;
        for (const c of calcs) {
          lines.push(TEXT.late.lineB(c.label, c.remaining));
          sum += c.remaining;
          c.remaining = 0;
        }
        lines.push(TEXT.late.total(sum));
        lateF.push(
          finding('DD-541-7-LATE', TEXT.late.title, sum, TEXT.late.explanationB(invoice.invoiceDate, g, upstream), lines, true, DD_CONFIDENCE_541, cite().add('invoice', '/invoiceDate').add('invoice', '/upstreamInvoiceDate').list(), regulationClause('46 CFR 541.7(b)')),
        );
      } else issuance = { status: 'ok', reason: null };
    }
  } else if (!anyPeriods) issuance = { status: 'not_evaluated', reason: 'no_charge_dates' };
  else {
    const invoiceDate = invoice.invoiceDate;
    const late = calcs.filter((c) => c.last !== null && ddDaysBetween(c.last, invoiceDate) > DD_ISSUE_DEADLINE_DAYS);
    if (late.length > 0) {
      issuance = { status: 'finding', reason: null };
      const citer = cite().add('invoice', '/invoiceDate');
      const lines: string[] = [];
      let sum = 0;
      for (const c of late) {
        const last = c.last ?? invoiceDate;
        lines.push(TEXT.late.lineA(c.label, last, ddDaysBetween(last, invoiceDate), c.remaining));
        citer.add('invoice', `/containers/${c.index}/periods/${c.lastPeriod ?? 0}/to`);
        sum += c.remaining;
        c.remaining = 0;
      }
      lines.push(TEXT.late.total(sum));
      lateF.push(finding('DD-541-7-LATE', TEXT.late.title, sum, TEXT.late.explanationA(invoiceDate, late.length), lines, true, DD_CONFIDENCE_541, citer.list(), regulationClause('46 CFR 541.7(a)')));
    } else issuance = { status: 'ok', reason: null };
  }

  // 8. CONTENT
  let contentStatus: DdCheckStatus = 'not_applicable';
  if (part541) {
    const issues = contentIssues(invoice, tariff, calendar);
    contentStatus = issues.length > 0 ? 'finding' : 'ok';
    if (issues.length > 0) {
      const labels: string[] = [];
      for (const is of issues) {
        const label = ELEMENTS[is.id][1];
        if (!labels.includes(label)) labels.push(label);
      }
      const remaining = calcs.reduce((s, c) => s + c.remaining, 0);
      const citer = cite();
      for (const is of issues) citer.add('invoice', is.pointer);
      // Missing items (E..) keep the 541.5 texts and clause; only inaccurate items (A..) cite 541.6(b) or (d).
      const anyMissing = issues.some((is) => is.id.startsWith('E'));
      const firstCitation = issues[0] === undefined ? '' : ELEMENTS[issues[0].id][0];
      const clauseKey: DdRegulationKey = anyMissing ? '46 CFR 541.5' : firstCitation.startsWith('46 CFR 541.6(b)') ? '46 CFR 541.6(b)' : '46 CFR 541.6(d)';
      contentF.push(
        finding(
          'DD-541-6-CONTENT',
          anyMissing ? TEXT.content.title : TEXT.content.inaccurateTitle,
          remaining,
          anyMissing ? TEXT.content.explanation(labels.length, labels.join('; ')) : TEXT.content.inaccurateExplanation(labels.length, labels.join('; ')),
          [...issues.map((is) => TEXT.content.line(ELEMENTS[is.id][0], ELEMENTS[is.id][1], is.problem)), TEXT.content.remaining(remaining)],
          true,
          DD_CONFIDENCE_541,
          citer.list(),
          regulationClause(clauseKey),
        ),
      );
    }
  }

  // Checks (C6): invoice-level checks first, then per container in container order, each container's checks
  // grouped together (tariff, availability, return_refused).
  if (!part541) check('part541', null, 'not_applicable', 'before_effective_date');
  else if (invoice.invoiceDate === null) check('part541', null, 'not_evaluated', 'no_invoice_date');
  else check('part541', null, 'ok');
  if (part541) check('content', null, contentStatus);
  else check('content', null, 'not_applicable', 'before_effective_date');
  check('issuance', null, issuance.status, issuance.reason);
  if (totalDue === null) check('total', null, 'not_evaluated', 'no_total');
  else check('total', null, totals.length > 0 ? 'finding' : 'ok');
  check('line_arithmetic', null, periodsF.length > 0 ? 'finding' : 'ok');
  for (const c of calcs) {
    if (c.charge === null) check('tariff', c.index, 'not_evaluated', c.reason);
    else check('tariff', c.index, c.tariffCut > 0 ? 'finding' : 'ok');
    const a = availReason.get(c.index) ?? { status: 'not_applicable' as const, reason: 'not_import_demurrage' };
    check('availability', c.index, a.status, a.reason);
    const ctr = containers[c.index];
    if (!ctr || ctr.chargeType !== 'DETENTION') check('return_refused', c.index, 'not_applicable', 'not_detention');
    else if (ctr.evidence.emptyReturnRefusedDates.length === 0) check('return_refused', c.index, 'not_evaluated', 'no_evidence');
    else check('return_refused', c.index, returnStatus.get(c.index) ?? 'ok');
  }

  const findings = [...totals, ...periodsF, ...tariffF, ...returnF, ...availF, ...lateF, ...contentF];
  const recoverableCents = findings.filter((f) => !f.needsHumanReview).reduce((s, f) => s + f.amountCents, 0);
  const pendingReviewCents = findings.filter((f) => f.needsHumanReview).reduce((s, f) => s + f.amountCents, 0);
  return {
    rulesVersion: DD_RULES_VERSION,
    findings,
    recoverableCents,
    pendingReviewCents,
    recoverable: fmtCents(recoverableCents),
    pendingReview: fmtCents(pendingReviewCents),
    checks,
    containers: calcs.map((c) => {
      const ctr = containers[c.index];
      return {
        index: c.index,
        label: c.label,
        chargeType: ctr?.chargeType ?? 'DEMURRAGE',
        sizeType: ctr?.sizeType ?? '',
        chargedCents: c.charged,
        expectedCents: c.charge === null ? null : c.charge.amountCents,
        freeTimeEnd: c.charge === null ? null : c.charge.freeTimeEnd,
        chargeableDays: c.charge === null ? null : c.charge.chargeableDays,
      };
    }),
  };
}

/** C5 rule 8: the content issues in table order. */
function contentIssues(invoice: DdInvoiceDataDto, tariff: DdTariffDataDto | null, calendar: DdCalendarDataDto | null): Issue[] {
  const cs = invoice.containers;
  const issues: Issue[] = [];
  const ctrs = (idx: number[]): string => idx.map((i) => ddContainerLabel(cs[i] ?? { containerNumber: null }, i)).join(', ');
  const missing = (id: ElementId, absent: boolean, pointer: string): void => {
    if (absent) issues.push({ id, problem: 'missing', pointer });
  };
  /** One issue `missing for {ctrs}` over the containers matching `pred`; pointer of the first one. */
  const missingFor = (id: ElementId, pred: (c: DdContainerDto) => boolean, field: string): void => {
    const idx = cs.flatMap((c, i) => (pred(c) ? [i] : []));
    const first = idx[0];
    if (first !== undefined) issues.push({ id, problem: `missing for ${ctrs(idx)}`, pointer: `/containers/${first}/${field}` });
  };
  const imp = invoice.direction === 'IMPORT';

  missing('E01', invoice.billOfLadingNumbers.length === 0, '/billOfLadingNumbers');
  missingFor('E02', (c) => c.containerNumber === null, 'containerNumber');
  missing('E03', imp && invoice.portOfDischarge === null, '/portOfDischarge');
  missing('E04', invoice.liabilityBasis === null, '/liabilityBasis');
  missing('E05', invoice.invoiceDate === null, '/invoiceDate');
  missing('E06', invoice.dueDate === null, '/dueDate');
  missingFor('E07', (c) => c.freeDays === null, 'freeDays');
  cs.forEach((c, i) => {
    if (c.freeDays !== null && tariffMatches(tariff, invoice, c) && c.freeDays !== tariff.freeDays) {
      issues.push({ id: 'A03', problem: `${ddContainerLabel(c, i)}: stated ${c.freeDays} days, the attached tariff allows ${tariff.freeDays}`, pointer: `/containers/${i}/freeDays` });
    }
  });
  missingFor('E08', (c) => c.freeTimeStart === null, 'freeTimeStart');
  missingFor('E09', (c) => c.freeTimeEnd === null, 'freeTimeEnd');
  cs.forEach((c, i) => {
    const end = c.freeTimeEnd;
    if (end === null) return;
    let k = -1;
    c.periods.forEach((p, j) => {
      const best = c.periods[k];
      if (p.from <= end && (best === undefined || p.from < best.from)) k = j;
    });
    const p = c.periods[k];
    if (p) issues.push({ id: 'A01', problem: `${ddContainerLabel(c, i)} is charged on ${p.from}, on or before the stated free time end ${end}`, pointer: `/containers/${i}/periods/${k}/from` });
  });
  cs.forEach((c, i) => {
    if (c.freeTimeStart === null || c.freeTimeEnd === null || !tariffMatches(tariff, invoice, c)) return;
    let computed: string;
    try {
      computed = computeFreeTimeEnd(c.freeTimeStart, tariff, calendar);
    } catch (e) {
      if (e instanceof RangeError) return;
      throw e;
    }
    if (computed !== c.freeTimeEnd) issues.push({ id: 'A02', problem: `${ddContainerLabel(c, i)}: stated ${c.freeTimeEnd}, the attached tariff gives ${computed}`, pointer: `/containers/${i}/freeTimeEnd` });
  });
  if (imp) missingFor('E10', (c) => c.availabilityDate === null, 'availabilityDate');
  else missingFor('E11', (c) => c.earliestReturnDate === null, 'earliestReturnDate');
  missingFor('E12', (c) => c.periods.length === 0, 'periods');
  missing('E13', invoice.totalDue === null, '/totalDue');
  missing('E14', invoice.ruleReference === null, '/ruleReference');
  {
    const idx = cs.flatMap((c, i) => (c.periods.some((p) => p.rate === null) ? [i] : []));
    const first = idx[0];
    if (first !== undefined) {
      const p = cs[first]?.periods.findIndex((q) => q.rate === null) ?? 0;
      issues.push({ id: 'E15', problem: `missing for ${ctrs(idx)}`, pointer: `/containers/${first}/periods/${p}/rate` });
    }
  }
  missing('E16', invoice.disputeContact === null, '/disputeContact');
  missing('E17', invoice.disputeDigitalMeans === null, '/disputeDigitalMeans');
  const req = invoice.disputeRequestDays;
  const res = invoice.disputeResolutionDays;
  if (req === null && res === null) issues.push({ id: 'E18', problem: 'missing', pointer: '/disputeRequestDays' });
  else if (req === null) issues.push({ id: 'E18', problem: 'request window missing', pointer: '/disputeRequestDays' });
  else if (res === null) issues.push({ id: 'E18', problem: 'resolution time missing', pointer: '/disputeResolutionDays' });
  if (req !== null && req < DD_DISPUTE_MIN_DAYS) {
    issues.push({ id: 'A04', problem: `request window of ${req} days is shorter than the 30 calendar days required by 46 CFR 541.8(a)`, pointer: '/disputeRequestDays' });
  }
  if (res !== null && res > DD_RESOLUTION_MAX_DAYS) {
    issues.push({ id: 'A05', problem: `resolution time of ${res} days is longer than the 30 calendar days in 46 CFR 541.8(b)`, pointer: '/disputeResolutionDays' });
  }
  if (!invoice.certifiesFmcRules) issues.push({ id: 'E19', problem: 'not stated', pointer: '/certifiesFmcRules' });
  if (!invoice.certifiesPerformance) issues.push({ id: 'E20', problem: 'not stated', pointer: '/certifiesPerformance' });
  return issues;
}
