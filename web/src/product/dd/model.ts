/**
 * Ocean D&D invoice audit (public app): form model, validation through the shared strict schema, and the
 * pure run function. The audit (`auditDdInvoice`), the tariff presets and the draft letter come from
 * `@fr/shared`; everything runs in the browser.
 */
import {
  DD_TARIFF_PRESETS,
  DdInvoiceData,
  auditDdInvoice,
  buildDdDisputeLetter,
  parseDdCsv,
  type DdAuditResultDto,
  type DdContainerDto,
  type DdCsvError,
  type DdInvoiceDataDto,
  type DdTariffPreset,
} from '@fr/shared';

export interface DdPeriodForm {
  from: string;
  to: string;
  rate: string;
  amount: string;
}

export interface DdContainerForm {
  containerNumber: string;
  sizeType: string;
  chargeType: 'DEMURRAGE' | 'DETENTION';
  freeDays: string;
  freeTimeStart: string;
  freeTimeEnd: string;
  availabilityDate: string;
  earliestReturnDate: string;
  periods: DdPeriodForm[];
  clockStart: string;
  clockStop: string;
  cargoAvailableDate: string;
  /** Comma, space or newline separated YYYY-MM-DD dates. */
  refusedDates: string;
}

export interface DdForm {
  invoiceNumber: string;
  billingPartyName: string;
  billingPartyType: 'OCEAN_CARRIER' | 'MARINE_TERMINAL_OPERATOR' | 'NVOCC';
  billedPartyName: string;
  direction: 'IMPORT' | 'EXPORT';
  invoiceDate: string;
  dueDate: string;
  upstreamInvoiceDate: string;
  /** Comma-separated bill of lading numbers. */
  blNumbers: string;
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
  containers: DdContainerForm[];
  /** A `DD_TARIFF_PRESETS` id, or '' for no tariff. */
  tariffPresetId: string;
}

export interface DdOutcome {
  invoice: DdInvoiceDataDto;
  tariff: DdTariffPreset | null;
  result: DdAuditResultDto;
  letter: string;
  generatedAt: string;
}

export const MAX_CONTAINERS = 10;
export const MAX_PERIODS = 10;

export function emptyPeriod(): DdPeriodForm {
  return { from: '', to: '', rate: '', amount: '' };
}

export function emptyContainer(): DdContainerForm {
  return {
    containerNumber: '',
    sizeType: '40DV',
    chargeType: 'DETENTION',
    freeDays: '',
    freeTimeStart: '',
    freeTimeEnd: '',
    availabilityDate: '',
    earliestReturnDate: '',
    periods: [emptyPeriod()],
    clockStart: '',
    clockStop: '',
    cargoAvailableDate: '',
    refusedDates: '',
  };
}

export function emptyDdForm(): DdForm {
  return {
    invoiceNumber: '',
    billingPartyName: '',
    billingPartyType: 'OCEAN_CARRIER',
    billedPartyName: '',
    direction: 'IMPORT',
    invoiceDate: '',
    dueDate: '',
    upstreamInvoiceDate: '',
    blNumbers: '',
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
    containers: [emptyContainer()],
    tariffPresetId: '',
  };
}

/** The synthetic invoice from the shared test suite, paired with the public Maersk 2026 preset. */
export function exampleDdForm(): DdForm {
  return {
    ...emptyDdForm(),
    invoiceNumber: 'SYN-DD-0001',
    billingPartyName: 'Synthetic Ocean Line',
    billedPartyName: 'Example Importer LLC',
    invoiceDate: '2026-03-25',
    dueDate: '2026-04-24',
    blNumbers: 'SYNBL0001',
    portOfDischarge: 'Port of Example',
    liabilityBasis: 'Consignee named on the bill of lading',
    totalDue: '4350.00',
    ruleReference: 'Synthetic tariff rule 1',
    disputeContact: 'disputes@example.test',
    disputeDigitalMeans: 'https://example.test/dd-disputes',
    disputeRequestDays: '30',
    disputeResolutionDays: '30',
    certifiesFmcRules: true,
    certifiesPerformance: true,
    containers: [
      {
        ...emptyContainer(),
        containerNumber: 'SYNU0000001',
        sizeType: '40DV',
        chargeType: 'DETENTION',
        freeDays: '4',
        freeTimeStart: '2026-03-02',
        freeTimeEnd: '2026-03-05',
        availabilityDate: '2026-03-01',
        periods: [{ from: '2026-03-06', to: '2026-03-20', rate: '290', amount: '4350' }],
      },
    ],
    tariffPresetId: 'maersk-us-import-detention-2026',
  };
}

const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const optInt = (v: string): number | null | string => {
  const t = v.trim();
  if (t === '') return null;
  return /^\d{1,3}$/u.test(t) ? Number(t) : t;
};
const list = (v: string): string[] =>
  v
    .split(/[\s,;]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** The raw object handed to the strict schema (unknown shape on purpose: the schema is the validator). */
export function rawDdInvoice(form: DdForm): unknown {
  return {
    invoiceNumber: form.invoiceNumber.trim(),
    billingPartyName: form.billingPartyName.trim(),
    billingPartyType: form.billingPartyType,
    billedPartyName: form.billedPartyName.trim(),
    direction: form.direction,
    invoiceDate: opt(form.invoiceDate),
    dueDate: opt(form.dueDate),
    upstreamInvoiceDate: opt(form.upstreamInvoiceDate),
    billOfLadingNumbers: list(form.blNumbers),
    portOfDischarge: opt(form.portOfDischarge),
    liabilityBasis: opt(form.liabilityBasis),
    totalDue: opt(form.totalDue),
    ruleReference: opt(form.ruleReference),
    disputeContact: opt(form.disputeContact),
    disputeDigitalMeans: opt(form.disputeDigitalMeans),
    disputeRequestDays: optInt(form.disputeRequestDays),
    disputeResolutionDays: optInt(form.disputeResolutionDays),
    certifiesFmcRules: form.certifiesFmcRules,
    certifiesPerformance: form.certifiesPerformance,
    containers: form.containers.map((c) => ({
      containerNumber: opt(c.containerNumber),
      sizeType: c.sizeType.trim().toUpperCase(),
      chargeType: c.chargeType,
      freeDays: optInt(c.freeDays),
      freeTimeStart: opt(c.freeTimeStart),
      freeTimeEnd: opt(c.freeTimeEnd),
      availabilityDate: opt(c.availabilityDate),
      earliestReturnDate: opt(c.earliestReturnDate),
      periods: c.periods
        .filter((p) => [p.from, p.to, p.rate, p.amount].some((v) => v.trim() !== ''))
        .map((p) => ({ from: p.from.trim(), to: p.to.trim(), rate: opt(p.rate), amount: p.amount.trim() })),
      evidence: {
        clockStart: opt(c.clockStart),
        clockStop: opt(c.clockStop),
        cargoAvailableDate: opt(c.cargoAvailableDate),
        emptyReturnRefusedDates: list(c.refusedDates),
      },
    })),
  };
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  invoiceNumber: 'Invoice number',
  billingPartyName: 'Billing party',
  billedPartyName: 'Billed party',
  invoiceDate: 'Invoice date',
  dueDate: 'Due date',
  upstreamInvoiceDate: 'Upstream invoice date',
  billOfLadingNumbers: 'Bill of lading numbers',
  portOfDischarge: 'Port of discharge',
  liabilityBasis: 'Liability basis',
  totalDue: 'Total due',
  ruleReference: 'Rule reference',
  disputeContact: 'Dispute contact',
  disputeDigitalMeans: 'Dispute web address',
  disputeRequestDays: 'Days to request mitigation',
  disputeResolutionDays: 'Days to resolve a request',
  containers: 'Container',
  containerNumber: 'container number',
  sizeType: 'size/type (e.g. 40DV)',
  freeDays: 'free days',
  freeTimeStart: 'free time start',
  freeTimeEnd: 'free time end',
  availabilityDate: 'availability date',
  earliestReturnDate: 'earliest return date',
  periods: 'charge period',
  from: 'from',
  to: 'to',
  rate: 'rate',
  amount: 'amount',
  evidence: 'evidence',
  clockStart: 'clock start',
  clockStop: 'clock stop',
  cargoAvailableDate: 'cargo available date',
  emptyReturnRefusedDates: 'refused return dates',
};

function describePath(path: readonly PropertyKey[]): string {
  const parts: string[] = [];
  path.forEach((p, i) => {
    if (typeof p === 'number') {
      const prev = parts.pop();
      parts.push(`${prev ?? 'item'} ${p + 1}`);
    } else if (typeof p === 'string') {
      parts.push(i === 0 ? (FIELD_LABELS[p] ?? p) : (FIELD_LABELS[p] ?? p));
    }
  });
  return parts.join(', ');
}

export interface DdValidation {
  invoice: DdInvoiceDataDto | null;
  errors: string[];
}

/** Validate the form with the shared strict schema; messages name the field in plain words. */
export function validateDdForm(form: DdForm): DdValidation {
  const parsed = DdInvoiceData.safeParse(rawDdInvoice(form));
  if (parsed.success) return { invoice: parsed.data, errors: [] };
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const issue of parsed.error.issues) {
    const where = describePath(issue.path);
    const text = `${where ? `${where}: ` : ''}${issue.message}`;
    if (!seen.has(text)) {
      seen.add(text);
      errors.push(text);
    }
  }
  return { invoice: null, errors: errors.slice(0, 20) };
}

export function presetById(id: string): DdTariffPreset | null {
  return DD_TARIFF_PRESETS.find((p) => p.id === id) ?? null;
}

export function runDdAudit(form: DdForm, now: Date): { outcome: DdOutcome | null; errors: string[] } {
  const v = validateDdForm(form);
  if (v.invoice === null) return { outcome: null, errors: v.errors };
  const tariff = presetById(form.tariffPresetId);
  const result = auditDdInvoice({ invoice: v.invoice, tariff: tariff?.data ?? null, calendar: null });
  const letter = buildDdDisputeLetter(v.invoice, result, now.toISOString().slice(0, 10));
  return { outcome: { invoice: v.invoice, tariff, result, letter, generatedAt: now.toISOString() }, errors: [] };
}

function containerForm(c: DdContainerDto): DdContainerForm {
  return {
    containerNumber: c.containerNumber ?? '',
    sizeType: c.sizeType,
    chargeType: c.chargeType,
    freeDays: c.freeDays === null ? '' : String(c.freeDays),
    freeTimeStart: c.freeTimeStart ?? '',
    freeTimeEnd: c.freeTimeEnd ?? '',
    availabilityDate: c.availabilityDate ?? '',
    earliestReturnDate: c.earliestReturnDate ?? '',
    periods: c.periods.length === 0 ? [emptyPeriod()] : c.periods.map((p) => ({ from: p.from, to: p.to, rate: p.rate ?? '', amount: p.amount })),
    clockStart: c.evidence.clockStart ?? '',
    clockStop: c.evidence.clockStop ?? '',
    cargoAvailableDate: c.evidence.cargoAvailableDate ?? '',
    refusedDates: c.evidence.emptyReturnRefusedDates.join(', '),
  };
}

/** A form pre-filled from a validated invoice (CSV import). */
export function formFromInvoice(inv: DdInvoiceDataDto, tariffPresetId = ''): DdForm {
  return {
    invoiceNumber: inv.invoiceNumber,
    billingPartyName: inv.billingPartyName,
    billingPartyType: inv.billingPartyType,
    billedPartyName: inv.billedPartyName,
    direction: inv.direction,
    invoiceDate: inv.invoiceDate ?? '',
    dueDate: inv.dueDate ?? '',
    upstreamInvoiceDate: inv.upstreamInvoiceDate ?? '',
    blNumbers: inv.billOfLadingNumbers.join(', '),
    portOfDischarge: inv.portOfDischarge ?? '',
    liabilityBasis: inv.liabilityBasis ?? '',
    totalDue: inv.totalDue ?? '',
    ruleReference: inv.ruleReference ?? '',
    disputeContact: inv.disputeContact ?? '',
    disputeDigitalMeans: inv.disputeDigitalMeans ?? '',
    disputeRequestDays: inv.disputeRequestDays === null ? '' : String(inv.disputeRequestDays),
    disputeResolutionDays: inv.disputeResolutionDays === null ? '' : String(inv.disputeResolutionDays),
    certifiesFmcRules: inv.certifiesFmcRules,
    certifiesPerformance: inv.certifiesPerformance,
    containers: inv.containers.slice(0, MAX_CONTAINERS).map(containerForm),
    tariffPresetId,
  };
}

export interface DdCsvImport {
  forms: DdForm[];
  errors: DdCsvError[];
}

/** Parse a D&D CSV (shared column set) into forms; errors keep the shared row/column/code shape. */
export function importDdCsv(text: string): DdCsvImport {
  const r = parseDdCsv(text);
  return { forms: r.invoices.map((inv) => formFromInvoice(inv)), errors: r.errors };
}