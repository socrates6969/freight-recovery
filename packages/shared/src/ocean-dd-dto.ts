/**
 * Step 8 ocean D&D contract (REQ-20261011-ocean-dd, Part C C4, C5, C6, C12): strict Zod schemas for D&D
 * invoices, tariffs and calendars, the audit result and the API DTOs. Every object is strict (unknown keys
 * are refused). Normalization (two-decimal money, ascending date lists, periods by `from`, ascending
 * weekdays) happens in `.transform`, so `parse(parse(x))` equals `parse(x)`.
 */
import { z } from 'zod';

import { singleLine } from './dto.js';
import {
  DD_BILLING_PARTY_TYPES,
  DD_BL_MAX,
  DD_CALENDAR_DATES_MAX,
  DD_CHARGE_TYPES,
  DD_CHECK_IDS,
  DD_CHECK_STATUSES,
  DD_CONTAINERS_MAX,
  DD_DAY_BASES,
  DD_DIRECTIONS,
  DD_INVOICE_STATUSES,
  DD_PERIOD_SPAN_MAX_DAYS,
  DD_PERIODS_MAX,
  DD_REFUSED_DATES_MAX,
  DD_RULE_IDS,
  DD_RULES_VERSION,
  DD_SIZES_MAX,
  DD_SPAN_MAX_DAYS,
  DD_START_DAY_RULES,
  DD_TIERS_MAX,
} from './ocean-dd/constants.js';
import { ddDayNumber, isDdDate } from './ocean-dd/dates.js';

const uuid = z.uuid();
const intFromQuery = z.coerce.number().int();
const isoDateTime = z.iso.datetime();

/** Largest free days of a tariff or container. */
const FREE_DAYS_MAX = 60;
/** Largest dispute window / resolution time on an invoice (days). */
const DISPUTE_DAYS_MAX = 365;
/** Largest `days` of a tariff tier. */
const TIER_DAYS_MAX = 365;
const PAGE_SIZE_MAX = 100;
const PAGE_SIZE_DEFAULT = 25;

const MONEY_RE = /^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$/u;
export const DD_SIZE_TYPE_RE = /^[0-9]{2}[A-Z]{2}$/u;

/** `210` -> `210.00`, `7.5` -> `7.50` (input already matches MONEY_RE). */
export function normalizeDdMoney(v: string): string {
  const [int = '0', frac = ''] = v.split('.');
  return `${int}.${frac.padEnd(2, '0')}`;
}

/** Integer cents of a money text matching MONEY_RE (normalized or not). */
export function ddMoneyCents(v: string): number {
  const [int = '0', frac = ''] = v.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0'));
}

export const DdDate = z.string().refine(isDdDate, { message: 'not a date 2000-01-01..2099-12-31' });
export const DdMoney = z.string().regex(MONEY_RE).transform(normalizeDdMoney);
export const DdText = (n: number) => singleLine(1, n);
export const DdSizeType = z.string().regex(DD_SIZE_TYPE_RE);

const span = (a: string, b: string): number => ddDayNumber(b) - ddDayNumber(a);
const bothDates = (a: unknown, b: unknown): boolean => isDdDate(a) && isDdDate(b);

/** A list of distinct dates, normalized ascending. */
const dateSet = (max: number) =>
  z
    .array(DdDate)
    .max(max)
    .refine((xs) => new Set(xs).size === xs.length, { message: 'dates must be distinct' })
    .transform((xs) => [...xs].sort());

export const DdPeriod = z
  .strictObject({ from: DdDate, to: DdDate, rate: DdMoney.nullable(), amount: DdMoney })
  .refine((p) => !bothDates(p.from, p.to) || (p.from <= p.to && span(p.from, p.to) <= DD_PERIOD_SPAN_MAX_DAYS), {
    message: `from <= to and at most ${DD_PERIOD_SPAN_MAX_DAYS} days apart`,
  });

export const DdEvidence = z
  .strictObject({
    clockStart: DdDate.nullable(),
    clockStop: DdDate.nullable(),
    cargoAvailableDate: DdDate.nullable(),
    emptyReturnRefusedDates: dateSet(DD_REFUSED_DATES_MAX),
  })
  .refine(
    (e) => e.clockStart === null || e.clockStop === null || !bothDates(e.clockStart, e.clockStop) || (e.clockStart <= e.clockStop && span(e.clockStart, e.clockStop) <= DD_SPAN_MAX_DAYS),
    { message: `clockStart <= clockStop and at most ${DD_SPAN_MAX_DAYS} days apart` },
  );

export const DdContainer = z.strictObject({
  containerNumber: DdText(20).nullable(),
  sizeType: DdSizeType,
  chargeType: z.enum(DD_CHARGE_TYPES),
  freeDays: z.int().min(0).max(FREE_DAYS_MAX).nullable(),
  freeTimeStart: DdDate.nullable(),
  freeTimeEnd: DdDate.nullable(),
  availabilityDate: DdDate.nullable(),
  earliestReturnDate: DdDate.nullable(),
  periods: z
    .array(DdPeriod)
    .max(DD_PERIODS_MAX)
    .transform((ps) => [...ps].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)))
    .refine(
      (ps) => {
        for (let k = 1; k < ps.length; k += 1) {
          const prev = ps[k - 1];
          const cur = ps[k];
          if (prev === undefined || cur === undefined || cur.from <= prev.to) return false;
        }
        return true;
      },
      { message: 'periods must not share a date' },
    ),
  evidence: DdEvidence,
});

const invoiceShape = {
  invoiceNumber: DdText(60),
  billingPartyName: DdText(120),
  billingPartyType: z.enum(DD_BILLING_PARTY_TYPES),
  billedPartyName: DdText(120),
  direction: z.enum(DD_DIRECTIONS),
  invoiceDate: DdDate.nullable(),
  dueDate: DdDate.nullable(),
  upstreamInvoiceDate: DdDate.nullable(),
  billOfLadingNumbers: z
    .array(DdText(40))
    .max(DD_BL_MAX)
    .refine((xs) => new Set(xs).size === xs.length, { message: 'bill of lading numbers must be distinct' }),
  portOfDischarge: DdText(120).nullable(),
  liabilityBasis: DdText(300).nullable(),
  totalDue: DdMoney.nullable(),
  ruleReference: DdText(200).nullable(),
  disputeContact: DdText(200).nullable(),
  disputeDigitalMeans: DdText(500).nullable(),
  disputeRequestDays: z.int().min(0).max(DISPUTE_DAYS_MAX).nullable(),
  disputeResolutionDays: z.int().min(0).max(DISPUTE_DAYS_MAX).nullable(),
  certifiesFmcRules: z.boolean(),
  certifiesPerformance: z.boolean(),
  containers: z.array(DdContainer).min(1).max(DD_CONTAINERS_MAX),
};

export const DdInvoiceData = z.strictObject(invoiceShape);
export type DdInvoiceDataDto = z.output<typeof DdInvoiceData>;
export type DdContainerDto = z.output<typeof DdContainer>;
export type DdPeriodDto = z.output<typeof DdPeriod>;

export const DdInvoiceBody = z.strictObject({ ...invoiceShape, tariffId: uuid.nullable(), calendarId: uuid.nullable() });
export type DdInvoiceBodyDto = z.output<typeof DdInvoiceBody>;

/** `https://` URL without credentials or whitespace that `new URL` accepts. */
function isHttpsUrl(v: string): boolean {
  if (!v.startsWith('https://') || /\s/u.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.username === '' && u.password === '' && u.hostname !== '';
  } catch {
    return false;
  }
}

const tierSchema = z.strictObject({
  days: z.int().min(1).max(TIER_DAYS_MAX).nullable(),
  rates: z
    .record(DdSizeType, DdMoney)
    .refine((r) => {
      const n = Object.keys(r).length;
      return n >= 1 && n <= DD_SIZES_MAX;
    }, { message: `1..${DD_SIZES_MAX} sizes` }),
});

export const DdTariffData = z
  .strictObject({
    name: DdText(120),
    carrier: DdText(120),
    chargeType: z.enum(DD_CHARGE_TYPES),
    direction: z.enum(DD_DIRECTIONS),
    ruleReference: DdText(200).nullable(),
    sourceUrl: DdText(500).refine(isHttpsUrl, { message: 'must be an https URL' }).nullable(),
    sourceRetrievedOn: DdDate.nullable(),
    freeDays: z.int().min(0).max(FREE_DAYS_MAX),
    freeDayBasis: z.enum(DD_DAY_BASES),
    startDayRule: z.enum(DD_START_DAY_RULES),
    chargeDayBasis: z.enum(DD_DAY_BASES),
    workingWeekdays: z
      .array(z.int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((xs) => new Set(xs).size === xs.length, { message: 'weekdays must be distinct' })
      .transform((xs) => [...xs].sort((a, b) => a - b)),
    tiers: z.array(tierSchema).min(1).max(DD_TIERS_MAX),
  })
  .superRefine((t, ctx) => {
    const last = t.tiers.length - 1;
    t.tiers.forEach((tier, j) => {
      if ((j === last) !== (tier.days === null)) {
        ctx.addIssue({ code: 'custom', message: 'only the last tier has days null', path: ['tiers', j, 'days'] });
      }
    });
    const first = t.tiers[0];
    const keys = first ? Object.keys(first.rates).sort().join(',') : '';
    t.tiers.forEach((tier, j) => {
      if (Object.keys(tier.rates).sort().join(',') !== keys) {
        ctx.addIssue({ code: 'custom', message: 'every tier must have the same sizes', path: ['tiers', j, 'rates'] });
      }
      for (const [k, v] of Object.entries(tier.rates)) {
        if (ddMoneyCents(v) <= 0) ctx.addIssue({ code: 'custom', message: 'rates must be greater than 0', path: ['tiers', j, 'rates', k] });
      }
    });
  });
export type DdTariffDataDto = z.output<typeof DdTariffData>;

export const DdCalendarData = z
  .strictObject({
    name: DdText(120),
    closedDates: dateSet(DD_CALENDAR_DATES_MAX),
    shutoutDates: dateSet(DD_CALENDAR_DATES_MAX),
  })
  .refine((c) => {
    const closed = new Set(c.closedDates);
    return c.shutoutDates.every((d) => !closed.has(d));
  }, { message: 'a date cannot be both closed and shutout', path: ['shutoutDates'] });
export type DdCalendarDataDto = z.output<typeof DdCalendarData>;

// ---------------------------------------------------------------------------------------------
// Audit result (C5, C6)
// ---------------------------------------------------------------------------------------------

const centsText = z.string().regex(/^[0-9]+\.[0-9]{2}$/u);

export const DdCitation = z.strictObject({ source: z.enum(['invoice', 'tariff', 'calendar']), pointer: z.string(), excerpt: z.string() });
export const DdClause = z.strictObject({ source: z.enum(['tariff', 'regulation']), key: z.string(), label: z.string(), excerpt: z.string() });
export const DdFinding = z.strictObject({
  ruleId: z.enum(DD_RULE_IDS),
  title: z.string(),
  direction: z.literal('overcharge'),
  amountCents: z.int().min(0),
  amount: centsText,
  explanation: z.string(),
  calculation: z.array(z.string()),
  confidence: z.number(),
  needsHumanReview: z.boolean(),
  citations: z.array(DdCitation),
  clause: DdClause.nullable(),
});
export type DdFindingDto = z.output<typeof DdFinding>;
export const DdCheck = z.strictObject({
  id: z.enum(DD_CHECK_IDS),
  containerIndex: z.int().min(0).nullable(),
  status: z.enum(DD_CHECK_STATUSES),
  reason: z.string().nullable(),
});
export type DdCheckDto = z.output<typeof DdCheck>;
export const DdContainerSummary = z.strictObject({
  index: z.int().min(0),
  label: z.string(),
  chargeType: z.enum(DD_CHARGE_TYPES),
  sizeType: z.string(),
  chargedCents: z.int().min(0),
  expectedCents: z.int().min(0).nullable(),
  freeTimeEnd: z.string().nullable(),
  chargeableDays: z.int().min(0).nullable(),
});
export type DdContainerSummaryDto = z.output<typeof DdContainerSummary>;
export const DdAuditResult = z.strictObject({
  rulesVersion: z.literal(DD_RULES_VERSION),
  findings: z.array(DdFinding),
  recoverableCents: z.int().min(0),
  pendingReviewCents: z.int().min(0),
  recoverable: centsText,
  pendingReview: centsText,
  checks: z.array(DdCheck),
  containers: z.array(DdContainerSummary),
});
export type DdAuditResultDto = z.output<typeof DdAuditResult>;

// ---------------------------------------------------------------------------------------------
// API (C12)
// ---------------------------------------------------------------------------------------------

export const DdListQuery = z.strictObject({
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type DdListQueryInput = z.output<typeof DdListQuery>;
export const DdInvoiceListQuery = z.strictObject({
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  status: z.enum(DD_INVOICE_STATUSES).optional(),
});
export type DdInvoiceListQueryInput = z.output<typeof DdInvoiceListQuery>;

export const DdTariffView = z.strictObject({ id: uuid, version: z.int().min(1), data: DdTariffData, createdAt: isoDateTime, updatedAt: isoDateTime });
export type DdTariffViewDto = z.output<typeof DdTariffView>;
export const DdCalendarView = z.strictObject({ id: uuid, version: z.int().min(1), data: DdCalendarData, createdAt: isoDateTime, updatedAt: isoDateTime });
export type DdCalendarViewDto = z.output<typeof DdCalendarView>;
export const DdTariffList = z.strictObject({ items: z.array(DdTariffView), page: z.int(), pageSize: z.int(), total: z.int() });
export type DdTariffListDto = z.output<typeof DdTariffList>;
export const DdCalendarList = z.strictObject({ items: z.array(DdCalendarView), page: z.int(), pageSize: z.int(), total: z.int() });
export type DdCalendarListDto = z.output<typeof DdCalendarList>;

export const DdInvoiceListItem = z.strictObject({
  id: uuid,
  status: z.enum(DD_INVOICE_STATUSES),
  version: z.int().min(1),
  invoiceNumber: z.string(),
  billingPartyName: z.string(),
  direction: z.enum(DD_DIRECTIONS),
  invoiceDate: DdDate.nullable(),
  totalDueCents: z.int().nullable(),
  containerCount: z.int(),
  claimId: uuid.nullable(),
  auditedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
});
export type DdInvoiceListItemDto = z.output<typeof DdInvoiceListItem>;
export const DdInvoiceList = z.strictObject({ items: z.array(DdInvoiceListItem), page: z.int(), pageSize: z.int(), total: z.int() });
export type DdInvoiceListDto = z.output<typeof DdInvoiceList>;

export const DdInvoiceDetail = z.strictObject({
  id: uuid,
  status: z.enum(DD_INVOICE_STATUSES),
  version: z.int().min(1),
  invoice: DdInvoiceBody,
  claimId: uuid.nullable(),
  claimNumber: z.string().nullable(),
  auditedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  preview: DdAuditResult,
});
export type DdInvoiceDetailDto = z.output<typeof DdInvoiceDetail>;

export const DdAuditResponse = z.strictObject({
  invoiceId: uuid,
  claim: z.strictObject({
    id: uuid,
    claimNumber: z.string(),
    status: z.literal('PENDING_REVIEW'),
    recoverableCents: z.int(),
    pendingReviewCents: z.int(),
    amountClaimedCents: z.int(),
  }),
  packet: z.strictObject({ id: uuid, revision: z.literal(1), status: z.literal('PENDING_REVIEW'), contentHash: z.string() }),
  audit: z.strictObject({ rulesVersion: z.literal(DD_RULES_VERSION), findingsCount: z.int(), pendingFindingsCount: z.int() }),
});
export type DdAuditResponseDto = z.output<typeof DdAuditResponse>;

export const DdTariffPutBody = z.strictObject({ version: z.int().min(1), data: DdTariffData });
export type DdTariffPutBodyInput = z.output<typeof DdTariffPutBody>;
export const DdCalendarPutBody = z.strictObject({ version: z.int().min(1), data: DdCalendarData });
export type DdCalendarPutBodyInput = z.output<typeof DdCalendarPutBody>;
export const DdInvoicePutBody = z.strictObject({ version: z.int().min(1), invoice: DdInvoiceBody });
export type DdInvoicePutBodyInput = z.output<typeof DdInvoicePutBody>;
