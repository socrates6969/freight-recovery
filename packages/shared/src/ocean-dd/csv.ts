/**
 * C8: D&D invoice CSV import, parsed in the browser (decision D9; the API accepts only validated JSON).
 * A hand-written single-pass tokenizer: linear time, no regex over the whole input, the 1,000,000-character
 * cap checked before any work and the row cap while reading. Rows are grouped into invoices and containers,
 * then every assembled invoice is validated with the `DdInvoiceData` schema.
 */
import { DdInvoiceData, DdSizeType, type DdInvoiceDataDto } from '../ocean-dd-dto.js';
import { canonicalJson } from '../canonical-json.js';
import { hasUnsafeChars } from '../text.js';

import { DD_CSV_MAX_CHARS, DD_CSV_MAX_INVOICES, DD_CSV_MAX_ROWS } from './constants.js';
import { isDdDate } from './dates.js';

export const DD_CSV_COLUMNS = Object.freeze([
  'invoice_number',
  'billing_party',
  'billing_party_type',
  'billed_party',
  'direction',
  'invoice_date',
  'due_date',
  'upstream_invoice_date',
  'bl_numbers',
  'port_of_discharge',
  'liability_basis',
  'total_due',
  'rule_reference',
  'dispute_contact',
  'dispute_digital_means',
  'dispute_request_days',
  'dispute_resolution_days',
  'certifies_fmc_rules',
  'certifies_performance',
  'container_number',
  'size_type',
  'charge_type',
  'free_days',
  'free_time_start',
  'free_time_end',
  'availability_date',
  'earliest_return_date',
  'period_from',
  'period_to',
  'rate',
  'amount',
  'clock_start',
  'clock_stop',
  'cargo_available_date',
  'return_refused_dates',
] as const);
export type DdCsvColumn = (typeof DD_CSV_COLUMNS)[number];

export interface DdCsvError {
  row: number;
  /** A `DD_CSV_COLUMNS` name, or null for file and invoice errors. */
  column: string | null;
  code: string;
}

export interface DdCsvResult {
  invoices: DdInvoiceDataDto[];
  errors: DdCsvError[];
}

const COLUMN_COUNT = DD_CSV_COLUMNS.length;
/** 0-based column ranges compared within a group (C8: invoice columns 1-19, container 20-27 and 32-35). */
const INVOICE_COLUMNS = range(0, 18);
const CONTAINER_COLUMNS = [...range(19, 26), ...range(31, 34)];
const COL = Object.fromEntries(DD_CSV_COLUMNS.map((c, i) => [c, i])) as Record<DdCsvColumn, number>;

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i += 1) out.push(i);
  return out;
}

const INT_RE = /^[0-9]{1,3}$/u;
const MONEY_RE = /^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$/u;
const BOOLS: Readonly<Record<string, boolean>> = { yes: true, no: false, true: true, false: false, y: true, n: false, '1': true, '0': false };

type Kind =
  | { t: 'text'; max: number; required?: boolean }
  | { t: 'enum'; values: readonly string[]; required: boolean }
  | { t: 'date' }
  | { t: 'bool' }
  | { t: 'int' }
  | { t: 'money' }
  | { t: 'textList'; max: number }
  | { t: 'dateList' }
  | { t: 'size' };

const KINDS: Readonly<Record<DdCsvColumn, Kind>> = {
  invoice_number: { t: 'text', max: 60, required: true },
  billing_party: { t: 'text', max: 120, required: true },
  billing_party_type: { t: 'enum', values: ['OCEAN_CARRIER', 'MARINE_TERMINAL_OPERATOR', 'NVOCC'], required: true },
  billed_party: { t: 'text', max: 120, required: true },
  direction: { t: 'enum', values: ['IMPORT', 'EXPORT'], required: true },
  invoice_date: { t: 'date' },
  due_date: { t: 'date' },
  upstream_invoice_date: { t: 'date' },
  bl_numbers: { t: 'textList', max: 40 },
  port_of_discharge: { t: 'text', max: 120 },
  liability_basis: { t: 'text', max: 300 },
  total_due: { t: 'money' },
  rule_reference: { t: 'text', max: 200 },
  dispute_contact: { t: 'text', max: 200 },
  dispute_digital_means: { t: 'text', max: 500 },
  dispute_request_days: { t: 'int' },
  dispute_resolution_days: { t: 'int' },
  certifies_fmc_rules: { t: 'bool' },
  certifies_performance: { t: 'bool' },
  container_number: { t: 'text', max: 20 },
  size_type: { t: 'size' },
  charge_type: { t: 'enum', values: ['DEMURRAGE', 'DETENTION'], required: true },
  free_days: { t: 'int' },
  free_time_start: { t: 'date' },
  free_time_end: { t: 'date' },
  availability_date: { t: 'date' },
  earliest_return_date: { t: 'date' },
  period_from: { t: 'date' },
  period_to: { t: 'date' },
  rate: { t: 'money' },
  amount: { t: 'money' },
  clock_start: { t: 'date' },
  clock_stop: { t: 'date' },
  cargo_available_date: { t: 'date' },
  return_refused_dates: { t: 'dateList' },
};

type Cell = { ok: true; value: unknown } | { ok: false; code: 'required' | 'invalid_value' };

const okText = (v: string, max: number): boolean => v.length >= 1 && v.length <= max && !hasUnsafeChars(v);

function listItems(raw: string): string[] {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseCell(kind: Kind, raw: string): Cell {
  const empty = raw.length === 0;
  switch (kind.t) {
    case 'text':
      if (empty) return kind.required === true ? { ok: false, code: 'required' } : { ok: true, value: null };
      return okText(raw, kind.max) ? { ok: true, value: raw } : { ok: false, code: 'invalid_value' };
    case 'enum': {
      if (empty) return kind.required ? { ok: false, code: 'required' } : { ok: true, value: null };
      const up = raw.toUpperCase();
      return kind.values.includes(up) ? { ok: true, value: up } : { ok: false, code: 'invalid_value' };
    }
    case 'size': {
      if (empty) return { ok: false, code: 'required' };
      const up = raw.toUpperCase();
      return DdSizeType.safeParse(up).success ? { ok: true, value: up } : { ok: false, code: 'invalid_value' };
    }
    case 'date':
      if (empty) return { ok: true, value: null };
      return isDdDate(raw) ? { ok: true, value: raw } : { ok: false, code: 'invalid_value' };
    case 'bool': {
      if (empty) return { ok: true, value: false };
      const b = BOOLS[raw.toLowerCase()];
      return b === undefined ? { ok: false, code: 'invalid_value' } : { ok: true, value: b };
    }
    case 'int':
      if (empty) return { ok: true, value: null };
      return INT_RE.test(raw) ? { ok: true, value: Number(raw) } : { ok: false, code: 'invalid_value' };
    case 'money': {
      if (empty) return { ok: true, value: null };
      const v = (raw.startsWith('$') ? raw.slice(1) : raw).replaceAll(',', '');
      return MONEY_RE.test(v) ? { ok: true, value: v } : { ok: false, code: 'invalid_value' };
    }
    case 'textList': {
      const items = listItems(raw);
      return items.every((s) => okText(s, kind.max)) ? { ok: true, value: items } : { ok: false, code: 'invalid_value' };
    }
    case 'dateList': {
      const items = listItems(raw);
      return items.every((s) => isDdDate(s)) ? { ok: true, value: items } : { ok: false, code: 'invalid_value' };
    }
  }
}

interface RawRecord {
  row: number;
  cells: string[];
}

type FileError = 'too_many_rows' | 'unterminated_quote' | 'header_mismatch';

const fileError = (code: string, row: number): DdCsvResult => ({ invoices: [], errors: [{ row, column: null, code }] });

/**
 * Single-pass tokenizer. Records end at `\r\n` or `\n`; quoted fields cannot span lines; cells are trimmed.
 * Trailing empty lines are dropped; the header (record 1) is checked as soon as it is read.
 */
function tokenize(text: string): { records: RawRecord[] } | { error: FileError; row: number } {
  const records: RawRecord[] = [];
  let pendingEmpty: RawRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let row = 1;
  let dataRows = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;

  const endRecord = (): FileError | null => {
    cells.push(field.trim());
    const rec = { row, cells };
    cells = [];
    field = '';
    row += 1;
    if (rec.row === 1) {
      if (!headerOk(rec.cells)) return 'header_mismatch';
      records.push(rec);
      return null;
    }
    if (rec.cells.length === 1 && rec.cells[0] === '') {
      pendingEmpty.push(rec);
      return null;
    }
    for (const r of [...pendingEmpty, rec]) {
      dataRows += 1;
      if (dataRows > DD_CSV_MAX_ROWS) return 'too_many_rows';
      records.push(r);
    }
    pendingEmpty = [];
    return null;
  };

  while (i < n) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
        continue;
      }
      if (ch === '\n' || (ch === '\r' && text.charAt(i + 1) === '\n')) return { error: 'unterminated_quote', row };
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
      i += 1;
    } else if (ch === ',') {
      cells.push(field.trim());
      field = '';
      i += 1;
    } else if (ch === '\n' || (ch === '\r' && text.charAt(i + 1) === '\n')) {
      const err = endRecord();
      if (err !== null) return { error: err, row: err === 'header_mismatch' ? 1 : 0 };
      i += ch === '\r' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) return { error: 'unterminated_quote', row };
  if (field.length > 0 || cells.length > 0) {
    const err = endRecord();
    if (err !== null) return { error: err, row: err === 'header_mismatch' ? 1 : 0 };
  }
  if (records.length === 0) return { error: 'header_mismatch', row: 1 };
  return { records };
}

function headerOk(cells: readonly string[]): boolean {
  return cells.length === COLUMN_COUNT && cells.every((c, i) => c.toLowerCase() === DD_CSV_COLUMNS[i]);
}

interface ParsedRow {
  row: number;
  values: unknown[];
  /** Columns whose cell failed to parse. */
  bad: Set<number>;
}

interface ContainerAcc {
  ref: ParsedRow;
  periods: { from: unknown; to: unknown; rate: unknown; amount: unknown }[];
}

interface Group {
  firstRow: number;
  ref: ParsedRow | null;
  hasError: boolean;
  containers: ContainerAcc[];
  byKey: Map<string, ContainerAcc>;
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** C8: parse a D&D invoice CSV. Pure; never throws for any string input. */
export function parseDdCsv(text: string): DdCsvResult {
  if (text.length > DD_CSV_MAX_CHARS) return fileError('too_large', 0);
  const tok = tokenize(text);
  if ('error' in tok) return fileError(tok.error, tok.row);

  const errors: DdCsvError[] = [];
  const groups = new Map<string, Group>();
  const order: Group[] = [];
  const err = (row: number, col: number | null, code: string): void => {
    errors.push({ row, column: col === null ? null : (DD_CSV_COLUMNS[col] ?? null), code });
  };
  const groupOf = (key: string, row: number): Group => {
    let g = groups.get(key);
    if (!g) {
      g = { firstRow: row, ref: null, hasError: false, containers: [], byKey: new Map() };
      groups.set(key, g);
      order.push(g);
    }
    return g;
  };

  for (const rec of tok.records.slice(1)) {
    const key = `${rec.cells[COL.billing_party] ?? ''}\u0000${rec.cells[COL.invoice_number] ?? ''}`;
    const g = groupOf(key, rec.row);
    if (rec.cells.length !== COLUMN_COUNT) {
      err(rec.row, null, 'column_count');
      g.hasError = true;
      continue;
    }
    const parsed: ParsedRow = { row: rec.row, values: [], bad: new Set() };
    DD_CSV_COLUMNS.forEach((name, c) => {
      const cell = parseCell(KINDS[name], rec.cells[c] ?? '');
      if (cell.ok) parsed.values.push(cell.value);
      else {
        parsed.values.push(null);
        parsed.bad.add(c);
        err(rec.row, c, cell.code);
      }
    });
    const v = parsed.values;
    const periodCols = [COL.period_from, COL.period_to, COL.amount];
    const hasPeriod = periodCols.some((c) => v[c] !== null || parsed.bad.has(c));
    if (hasPeriod) {
      for (const c of periodCols) {
        if (v[c] === null && !parsed.bad.has(c)) {
          parsed.bad.add(c);
          err(rec.row, c, 'required');
        }
      }
    }
    if (parsed.bad.size > 0) g.hasError = true;
    if (g.ref === null) g.ref = parsed;
    else {
      for (const c of INVOICE_COLUMNS) {
        if (!parsed.bad.has(c) && !g.ref.bad.has(c) && !same(v[c], g.ref.values[c])) {
          err(rec.row, c, 'inconsistent_invoice');
          g.hasError = true;
        }
      }
    }
    const number = v[COL.container_number];
    let acc: ContainerAcc | undefined;
    if (typeof number === 'string') {
      const ckey = `${number}\u0000${String(v[COL.charge_type] ?? rec.cells[COL.charge_type] ?? '')}`;
      acc = g.byKey.get(ckey);
      if (acc) {
        for (const c of CONTAINER_COLUMNS) {
          if (!parsed.bad.has(c) && !acc.ref.bad.has(c) && !same(v[c], acc.ref.values[c])) {
            err(rec.row, c, 'inconsistent_container');
            g.hasError = true;
          }
        }
      } else {
        acc = { ref: parsed, periods: [] };
        g.byKey.set(ckey, acc);
        g.containers.push(acc);
      }
    } else {
      acc = { ref: parsed, periods: [] };
      g.containers.push(acc);
    }
    if (hasPeriod) acc.periods.push({ from: v[COL.period_from], to: v[COL.period_to], rate: v[COL.rate], amount: v[COL.amount] });
  }

  if (order.length > DD_CSV_MAX_INVOICES) return fileError('too_many_invoices', 0);

  const invoices: DdInvoiceDataDto[] = [];
  for (const g of order) {
    if (g.hasError || g.ref === null) continue;
    const r = g.ref.values;
    const candidate = {
      invoiceNumber: r[COL.invoice_number],
      billingPartyName: r[COL.billing_party],
      billingPartyType: r[COL.billing_party_type],
      billedPartyName: r[COL.billed_party],
      direction: r[COL.direction],
      invoiceDate: r[COL.invoice_date],
      dueDate: r[COL.due_date],
      upstreamInvoiceDate: r[COL.upstream_invoice_date],
      billOfLadingNumbers: r[COL.bl_numbers],
      portOfDischarge: r[COL.port_of_discharge],
      liabilityBasis: r[COL.liability_basis],
      totalDue: r[COL.total_due],
      ruleReference: r[COL.rule_reference],
      disputeContact: r[COL.dispute_contact],
      disputeDigitalMeans: r[COL.dispute_digital_means],
      disputeRequestDays: r[COL.dispute_request_days],
      disputeResolutionDays: r[COL.dispute_resolution_days],
      certifiesFmcRules: r[COL.certifies_fmc_rules],
      certifiesPerformance: r[COL.certifies_performance],
      containers: g.containers.map((acc) => {
        const c = acc.ref.values;
        return {
          containerNumber: c[COL.container_number],
          sizeType: c[COL.size_type],
          chargeType: c[COL.charge_type],
          freeDays: c[COL.free_days],
          freeTimeStart: c[COL.free_time_start],
          freeTimeEnd: c[COL.free_time_end],
          availabilityDate: c[COL.availability_date],
          earliestReturnDate: c[COL.earliest_return_date],
          periods: acc.periods,
          evidence: {
            clockStart: c[COL.clock_start],
            clockStop: c[COL.clock_stop],
            cargoAvailableDate: c[COL.cargo_available_date],
            emptyReturnRefusedDates: c[COL.return_refused_dates],
          },
        };
      }),
    };
    const parsed = DdInvoiceData.safeParse(candidate);
    if (parsed.success) invoices.push(parsed.data);
    else err(g.firstRow, null, 'invalid_invoice');
  }

  const position = (e: DdCsvError): number => (e.column === null ? COLUMN_COUNT : DD_CSV_COLUMNS.indexOf(e.column as DdCsvColumn));
  const sorted = errors.map((e, k) => ({ e, k })).sort((a, b) => a.e.row - b.e.row || position(a.e) - position(b.e) || a.k - b.k);
  return { invoices, errors: sorted.map((x) => x.e) };
}
