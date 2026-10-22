/**
 * Intake agent: turns a carrier invoice into a `NormalizedInvoice`.
 *
 * Deterministic parsers cover an X12 EDI 210 subset (B3, N9, G62, N1/N4, LX/L5/L0/L1/L7, L3) and a flat
 * CSV (one row per charge line). Pre-extracted fields (e.g. from the PDF extraction pipeline) are
 * validated against the schema. Only free text that matches neither format goes to the optional LLM, and
 * its answer is validated and marked for human confirmation.
 */
import { Dec, eq, q2, sumDec } from '../analysis/py-decimal.js';

import { askJson, fence, type LlmClient } from './llm.js';
import { NormalizedInvoice, type NormalizedLine } from './types.js';

export type IntakeInput =
  | { kind: 'edi210'; text: string }
  | { kind: 'csv'; text: string }
  | { kind: 'fields'; fields: unknown }
  | { kind: 'text'; text: string };

export interface IntakeResult {
  invoice: NormalizedInvoice | null;
  warnings: string[];
}

const MAX_INPUT = 200_000;

/** `N2` implied-decimal integer (cents) to a DecimalString. */
function cents(v: string | undefined): string | null {
  if (v === undefined || !/^-?[0-9]{1,13}$/u.test(v)) return null;
  const neg = v.startsWith('-');
  const digits = (neg ? v.slice(1) : v).padStart(3, '0');
  return Dec.parse(`${neg ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`).toString();
}

function decimal(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim().replace(/^\$/u, '').replaceAll(',', '');
  return /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(t) ? t : null;
}

function ccyymmdd(v: string | undefined): string | null {
  return v !== undefined && /^[0-9]{8}$/u.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
}

const str = (v: string | undefined): string | null => (v === undefined || v.trim() === '' ? null : v.trim().slice(0, 200));

/** Parse the EDI 210 subset. Segment terminator `~`, element separator `*`. */
export function parseEdi210(text: string): IntakeResult {
  const warnings: string[] = [];
  const segs = text
    .slice(0, MAX_INPUT)
    .split('~')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => s.split('*'));
  let invoiceNumber: string | null = null;
  let proNumber: string | null = null;
  let scac: string | null = null;
  let invoiceDate: string | null = null;
  let total: string | null = null;
  let loadNumber: string | null = null;
  let bolNumber: string | null = null;
  let shipDate: string | null = null;
  let carrier: string | null = null;
  let origin: string | null = null;
  let destination: string | null = null;
  let party: string | null = null;
  let weight: string | null = null;
  let freightClass: string | null = null;
  let miles: string | null = null;
  const lines: NormalizedLine[] = [];
  let cur: { description: string; quantity: string | null; weight: string | null } | null = null;

  for (const e of segs) {
    switch (e[0]) {
      case 'B3':
        invoiceNumber = str(e[2]);
        proNumber = str(e[3]);
        invoiceDate = ccyymmdd(e[6]);
        total = cents(e[7]);
        scac = str(e[11]);
        break;
      case 'N9':
        if (e[1] === 'BM') bolNumber = str(e[2]);
        if (e[1] === 'LO') loadNumber = str(e[2]);
        if (e[1] === 'MI') miles = decimal(e[2]);
        break;
      case 'G62':
        if (e[1] === '86') shipDate = ccyymmdd(e[2]);
        break;
      case 'N1':
        party = e[1] ?? null;
        if (party === 'CA') carrier = str(e[2]);
        break;
      case 'N4': {
        const place = [str(e[1]), str(e[2])].filter((x) => x !== null).join(' ');
        if (party === 'SH') origin = place || null;
        if (party === 'CN') destination = place || null;
        break;
      }
      case 'LX':
        cur = { description: '', quantity: null, weight: null };
        break;
      case 'L5':
        if (cur !== null) cur.description = (e[2] ?? '').slice(0, 200);
        break;
      case 'L0':
        if (cur !== null) {
          cur.quantity = decimal(e[2]);
          cur.weight = decimal(e[4]);
          if (cur.weight !== null) weight = cur.weight;
        }
        break;
      case 'L7':
        if (str(e[7]) !== null) freightClass = str(e[7]);
        break;
      case 'L1': {
        const amount = cents(e[4]);
        if (amount === null) {
          warnings.push(`L1 segment without a charge amount: ${e.join('*').slice(0, 80)}`);
          break;
        }
        const rate = decimal(e[2]);
        const perCwt = e[3] === 'PH';
        const quantity = perCwt && cur !== null && cur.weight !== null ? divCwt(cur.weight) : (cur?.quantity ?? null);
        lines.push({ description: cur?.description || (e[8] ?? 'Charge'), amount, code: str(e[8]), quantity: rate === null ? null : quantity, rate });
        break;
      }
      case 'L3':
        if (weight === null) weight = decimal(e[1]);
        if (total === null) total = cents(e[5]);
        break;
      default:
        break;
    }
  }
  if (invoiceNumber === null || invoiceDate === null) return { invoice: null, warnings: [...warnings, 'EDI 210 without B3 invoice number or date'] };
  const parsed = NormalizedInvoice.safeParse({
    invoiceNumber,
    carrier: carrier ?? scac ?? 'unknown',
    scac,
    proNumber,
    loadNumber,
    bolNumber,
    invoiceDate,
    shipDate,
    origin,
    destination,
    // A freight class (L7) marks a class-rated LTL shipment.
    mode: freightClass === null ? 'TL' : 'LTL',
    miles,
    billedWeightLbs: weight,
    billedClass: freightClass,
    lines,
    total,
    source: 'edi210',
    warnings,
  });
  return parsed.success ? { invoice: parsed.data, warnings } : { invoice: null, warnings: [...warnings, 'EDI 210 did not validate'] };
}

/** Hundredweight of a weight in pounds (`lbs / 100`, exact). */
function divCwt(lbs: string): string {
  const d = Dec.parse(lbs);
  return Dec.of(d.sign, d.coef, d.exp - 2).toString();
}

/** Minimal RFC 4180 reader (quoted fields, doubled quotes). */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const t = text.slice(0, MAX_INPUT);
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** CSV: header + one row per charge line; invoice-level columns repeat on every row. */
export function parseInvoiceCsv(text: string): IntakeResult {
  const rows = readCsv(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (row: string[], name: string): string | undefined => {
    const i = header.indexOf(name);
    return i < 0 ? undefined : row[i];
  };
  const body = rows.slice(1);
  const first = body[0];
  if (first === undefined) return { invoice: null, warnings: ['CSV has no data rows'] };
  const warnings: string[] = [];
  const lines: NormalizedLine[] = [];
  for (const r of body) {
    const amount = decimal(col(r, 'line_amount'));
    if (amount === null) {
      warnings.push(`row without a valid line_amount: ${r.join(',').slice(0, 80)}`);
      continue;
    }
    lines.push({
      description: (col(r, 'line_description') ?? 'Charge').trim().slice(0, 200),
      amount,
      code: str(col(r, 'line_code')),
      quantity: decimal(col(r, 'line_quantity')),
      rate: decimal(col(r, 'line_rate')),
    });
  }
  const mode = (col(first, 'mode') ?? 'TL').trim().toUpperCase();
  const parsed = NormalizedInvoice.safeParse({
    invoiceNumber: str(col(first, 'invoice_number')),
    carrier: str(col(first, 'carrier')),
    scac: str(col(first, 'scac')),
    proNumber: str(col(first, 'pro')),
    loadNumber: str(col(first, 'load')),
    bolNumber: str(col(first, 'bol')),
    invoiceDate: str(col(first, 'invoice_date')),
    shipDate: str(col(first, 'ship_date')),
    origin: str(col(first, 'origin')),
    destination: str(col(first, 'destination')),
    mode: mode === 'LTL' ? 'LTL' : 'TL',
    miles: decimal(col(first, 'miles')),
    billedWeightLbs: decimal(col(first, 'weight')),
    billedClass: str(col(first, 'class')),
    lines,
    total: decimal(col(first, 'total')),
    source: 'csv',
    warnings,
  });
  return parsed.success ? { invoice: parsed.data, warnings } : { invoice: null, warnings: [...warnings, 'CSV invoice did not validate'] };
}

const INTAKE_SYSTEM = [
  'You are the intake agent of a freight-invoice audit team.',
  'Extract the carrier invoice in the user message into ONE JSON object matching the NormalizedInvoice schema.',
  'Copy amounts exactly as printed (decimal strings, no currency symbols). Use null for anything not printed.',
  'Do not compute, correct or infer amounts. Set "source" to "llm". Answer with JSON only.',
].join(' ');

/** Run the intake agent. `llm` is used only for free text that no deterministic parser accepts. */
export async function runIntakeAgent(input: IntakeInput, llm: LlmClient | null = null): Promise<IntakeResult> {
  let result: IntakeResult;
  if (input.kind === 'edi210') result = parseEdi210(input.text);
  else if (input.kind === 'csv') result = parseInvoiceCsv(input.text);
  else if (input.kind === 'fields') {
    const parsed = NormalizedInvoice.safeParse(input.fields);
    result = parsed.success ? { invoice: { ...parsed.data, source: 'fields' }, warnings: [] } : { invoice: null, warnings: ['fields did not validate'] };
  } else {
    const t = input.text.trimStart();
    if (t.startsWith('ISA*') || t.startsWith('ST*210') || t.includes('~B3*')) result = parseEdi210(t);
    else {
      const answer = await askJson(llm, { agent: 'intake', system: INTAKE_SYSTEM, user: fence('INVOICE', input.text.slice(0, MAX_INPUT)) }, NormalizedInvoice);
      result =
        answer === null
          ? { invoice: null, warnings: ['free-text invoice: no deterministic parser matched and no valid LLM answer'] }
          : { invoice: { ...answer, source: 'llm', warnings: [...answer.warnings, 'extracted by a language model: confirm the fields'] }, warnings: [] };
    }
  }
  if (result.invoice !== null) result.invoice.warnings.push(...mathWarnings(result.invoice));
  return result;
}

/** Intake-time consistency notes (the audit checks decide; these only inform the reviewer). */
function mathWarnings(inv: NormalizedInvoice): string[] {
  if (inv.total === null || inv.lines.length === 0) return [];
  const sum = sumDec(inv.lines.map((l) => Dec.parse(l.amount)));
  return eq(q2(sum), q2(Dec.parse(inv.total))) ? [] : [`stated total ${inv.total} differs from the line sum ${q2(sum).toString()}`];
}