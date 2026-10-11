/**
 * Invoice editor state <-> `DdInvoiceBody` (REQ-20261011-ocean-dd, Part B). The form keeps strings; the body
 * is validated with the shared strict schema before preview or sending; validation messages name the fields.
 */
import { DdInvoiceBody, type DdInvoiceBodyDto } from '@fr/shared';

import { listOf } from './dd-common';

export interface PeriodForm {
  from: string;
  to: string;
  rate: string;
  amount: string;
}

export interface ContainerForm {
  containerNumber: string;
  sizeType: string;
  chargeType: 'DEMURRAGE' | 'DETENTION';
  freeDays: string;
  freeTimeStart: string;
  freeTimeEnd: string;
  availabilityDate: string;
  earliestReturnDate: string;
  clockStart: string;
  clockStop: string;
  cargoAvailableDate: string;
  refusedDates: string;
  periods: PeriodForm[];
}

export interface InvoiceForm {
  invoiceNumber: string;
  billingPartyName: string;
  billingPartyType: 'OCEAN_CARRIER' | 'MARINE_TERMINAL_OPERATOR' | 'NVOCC';
  billedPartyName: string;
  direction: 'IMPORT' | 'EXPORT';
  invoiceDate: string;
  dueDate: string;
  upstreamInvoiceDate: string;
  billOfLadingNumbers: string;
  portOfDischarge: string;
  liabilityBasis: string;
  totalDue: string;
  ruleReference: string;
  disputeContact: string;
  disputeDigitalMeans: string;
  disputeRequestDays: string;
  disputeResolutionDays: string;
  certifiesFmcRules: boolean;
  certifiesPerformance: boolean;
  tariffId: string;
  calendarId: string;
  containers: ContainerForm[];
}

export const EMPTY_PERIOD: PeriodForm = { from: '', to: '', rate: '', amount: '' };

export const EMPTY_CONTAINER: ContainerForm = {
  containerNumber: '',
  sizeType: '40DV',
  chargeType: 'DETENTION',
  freeDays: '',
  freeTimeStart: '',
  freeTimeEnd: '',
  availabilityDate: '',
  earliestReturnDate: '',
  clockStart: '',
  clockStop: '',
  cargoAvailableDate: '',
  refusedDates: '',
  periods: [{ ...EMPTY_PERIOD }],
};

export const EMPTY_INVOICE: InvoiceForm = {
  invoiceNumber: '',
  billingPartyName: '',
  billingPartyType: 'OCEAN_CARRIER',
  billedPartyName: '',
  direction: 'IMPORT',
  invoiceDate: '',
  dueDate: '',
  upstreamInvoiceDate: '',
  billOfLadingNumbers: '',
  portOfDischarge: '',
  liabilityBasis: '',
  totalDue: '',
  ruleReference: '',
  disputeContact: '',
  disputeDigitalMeans: '',
  disputeRequestDays: '',
  disputeResolutionDays: '',
  certifiesFmcRules: false,
  certifiesPerformance: false,
  tariffId: '',
  calendarId: '',
  containers: [{ ...EMPTY_CONTAINER, periods: [{ ...EMPTY_PERIOD }] }],
};

const s = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const n = (v: string): number | null => (v.trim() === '' ? null : /^[0-9]{1,3}$/u.test(v.trim()) ? Number(v.trim()) : Number.NaN);
const money = (v: string): string | null => {
  const t = v.trim().replace(/^\$/u, '').replaceAll(',', '');
  return t === '' ? null : t;
};
const periodEmpty = (p: PeriodForm): boolean => p.from.trim() === '' && p.to.trim() === '' && p.amount.trim() === '' && p.rate.trim() === '';

/** The raw body of a form (not yet validated). */
export function formToRaw(f: InvoiceForm): Record<string, unknown> {
  return {
    invoiceNumber: f.invoiceNumber,
    billingPartyName: f.billingPartyName,
    billingPartyType: f.billingPartyType,
    billedPartyName: f.billedPartyName,
    direction: f.direction,
    invoiceDate: s(f.invoiceDate),
    dueDate: s(f.dueDate),
    upstreamInvoiceDate: s(f.upstreamInvoiceDate),
    billOfLadingNumbers: listOf(f.billOfLadingNumbers),
    portOfDischarge: s(f.portOfDischarge),
    liabilityBasis: s(f.liabilityBasis),
    totalDue: money(f.totalDue),
    ruleReference: s(f.ruleReference),
    disputeContact: s(f.disputeContact),
    disputeDigitalMeans: s(f.disputeDigitalMeans),
    disputeRequestDays: n(f.disputeRequestDays),
    disputeResolutionDays: n(f.disputeResolutionDays),
    certifiesFmcRules: f.certifiesFmcRules,
    certifiesPerformance: f.certifiesPerformance,
    containers: f.containers.map((c) => ({
      containerNumber: s(c.containerNumber),
      sizeType: c.sizeType.trim().toUpperCase(),
      chargeType: c.chargeType,
      freeDays: n(c.freeDays),
      freeTimeStart: s(c.freeTimeStart),
      freeTimeEnd: s(c.freeTimeEnd),
      availabilityDate: s(c.availabilityDate),
      earliestReturnDate: s(c.earliestReturnDate),
      periods: c.periods.filter((p) => !periodEmpty(p)).map((p) => ({ from: p.from.trim(), to: p.to.trim(), rate: money(p.rate), amount: money(p.amount) ?? '' })),
      evidence: { clockStart: s(c.clockStart), clockStop: s(c.clockStop), cargoAvailableDate: s(c.cargoAvailableDate), emptyReturnRefusedDates: listOf(c.refusedDates) },
    })),
    tariffId: s(f.tariffId),
    calendarId: s(f.calendarId),
  };
}

/** Validated body, or the field paths that failed (`containers.0.periods.1.amount`, ...). */
export function formToBody(f: InvoiceForm): { ok: true; body: DdInvoiceBodyDto } | { ok: false; paths: string[] } {
  const r = DdInvoiceBody.safeParse(formToRaw(f));
  if (r.success) return { ok: true, body: r.data };
  const paths = [...new Set(r.error.issues.map((i) => (i.path.length === 0 ? 'invoice' : i.path.map(String).join('.'))))];
  return { ok: false, paths };
}

const t = (v: string | null): string => v ?? '';

/** Form state of a stored invoice. */
export function bodyToForm(b: DdInvoiceBodyDto): InvoiceForm {
  return {
    invoiceNumber: b.invoiceNumber,
    billingPartyName: b.billingPartyName,
    billingPartyType: b.billingPartyType,
    billedPartyName: b.billedPartyName,
    direction: b.direction,
    invoiceDate: t(b.invoiceDate),
    dueDate: t(b.dueDate),
    upstreamInvoiceDate: t(b.upstreamInvoiceDate),
    billOfLadingNumbers: b.billOfLadingNumbers.join('; '),
    portOfDischarge: t(b.portOfDischarge),
    liabilityBasis: t(b.liabilityBasis),
    totalDue: t(b.totalDue),
    ruleReference: t(b.ruleReference),
    disputeContact: t(b.disputeContact),
    disputeDigitalMeans: t(b.disputeDigitalMeans),
    disputeRequestDays: b.disputeRequestDays === null ? '' : String(b.disputeRequestDays),
    disputeResolutionDays: b.disputeResolutionDays === null ? '' : String(b.disputeResolutionDays),
    certifiesFmcRules: b.certifiesFmcRules,
    certifiesPerformance: b.certifiesPerformance,
    tariffId: t(b.tariffId),
    calendarId: t(b.calendarId),
    containers: b.containers.map((c) => ({
      containerNumber: t(c.containerNumber),
      sizeType: c.sizeType,
      chargeType: c.chargeType,
      freeDays: c.freeDays === null ? '' : String(c.freeDays),
      freeTimeStart: t(c.freeTimeStart),
      freeTimeEnd: t(c.freeTimeEnd),
      availabilityDate: t(c.availabilityDate),
      earliestReturnDate: t(c.earliestReturnDate),
      clockStart: t(c.evidence.clockStart),
      clockStop: t(c.evidence.clockStop),
      cargoAvailableDate: t(c.evidence.cargoAvailableDate),
      refusedDates: c.evidence.emptyReturnRefusedDates.join('\n'),
      periods: c.periods.length === 0 ? [{ ...EMPTY_PERIOD }] : c.periods.map((p) => ({ from: p.from, to: p.to, rate: t(p.rate), amount: p.amount })),
    })),
  };
}
