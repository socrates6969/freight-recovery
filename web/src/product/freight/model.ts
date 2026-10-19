/**
 * Freight invoice check (public app): form model, parsing and the pure run function. Everything is computed
 * in the browser with the shared rules engine (`@fr/shared/analysis`, the TypeScript port of the reference
 * engine). No field here is sent anywhere.
 */
import {
  AnalysisInputError,
  DEFAULT_ANALYSIS_SETTINGS,
  applyRules,
  buildDemandLetter,
  type AnalysisPerspective,
  type AnalysisSettings,
  type RecoveryResult,
} from '@fr/shared/analysis';
import { isDecimalString } from '@fr/shared/decimal';
import { emptyBillOfLading, emptyInvoice, emptyRateConfirmation, type ChargeLine, type ExtractedBundle } from '@fr/shared/extraction';

export interface FreightForm {
  perspective: AnalysisPerspective;
  invoiceNumber: string;
  loadNumber: string;
  carrier: string;
  shipper: string;
  invoiceDate: string;
  /** One charge per line: `description, amount` (also tab, `|` or `;` separated). */
  linesText: string;
  total: string;
  rcLinehaul: string;
  rcFuel: string;
  rcFreeHours: string;
  rcRatePerHour: string;
  rcMaxHours: string;
  /** Comma-separated authorized accessorial names. */
  rcAuthorized: string;
  facility: string;
  appointment: string;
  arrival: string;
  departure: string;
  incrementMinutes: string;
  tolerance: string;
  windowDays: string;
}

export interface FreightOutcome {
  bundle: ExtractedBundle;
  settings: AnalysisSettings;
  result: RecoveryResult;
  letter: string;
  /** ISO instant of the run (browser clock). */
  generatedAt: string;
}

export const EMPTY_FREIGHT_FORM: Readonly<FreightForm> = Object.freeze({
  perspective: 'shipper',
  invoiceNumber: '',
  loadNumber: '',
  carrier: '',
  shipper: '',
  invoiceDate: '',
  linesText: '',
  total: '',
  rcLinehaul: '',
  rcFuel: '',
  rcFreeHours: '',
  rcRatePerHour: '',
  rcMaxHours: '',
  rcAuthorized: '',
  facility: '',
  appointment: '',
  arrival: '',
  departure: '',
  incrementMinutes: String(DEFAULT_ANALYSIS_SETTINGS.detentionIncrementMinutes),
  tolerance: DEFAULT_ANALYSIS_SETTINGS.amountTolerance,
  windowDays: String(DEFAULT_ANALYSIS_SETTINGS.disputeWindowDays),
});

/** The synthetic load LD-5001 from the repository fixtures (no real carrier, shipper or shipment). */
export const EXAMPLE_FREIGHT_FORM: Readonly<FreightForm> = Object.freeze({
  ...EMPTY_FREIGHT_FORM,
  invoiceNumber: 'INV-1001',
  loadNumber: 'LD-5001',
  carrier: 'Acme Freight LLC',
  shipper: 'Widget Co',
  invoiceDate: '2025-03-10',
  linesText: 'Linehaul, 1500.00\nFuel Surcharge, 168.00\nDetention, 300.00\nLumper, 150.00',
  total: '2118.00',
  rcLinehaul: '1400.00',
  rcFuel: '168.00',
  rcFreeHours: '2',
  rcRatePerHour: '50.00',
  rcMaxHours: '8',
  rcAuthorized: 'Detention',
  facility: 'Widget Co DC 4',
  appointment: '2025-03-03T08:00',
  arrival: '2025-03-03T07:45',
  departure: '2025-03-03T11:30',
});

const MAX_LINES = 500;
const MAX_DESCRIPTION = 200;
const HEADER_RE = /^(description|charge|item)\s*[,;|\t]\s*(amount|total|usd)$/iu;
const LOCAL_DT_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/u;

/** `$1,234.50` -> `1234.50`; returns null unless the result is a decimal string. */
export function normalizeMoney(raw: string): string | null {
  const t = raw.trim().replace(/^\$/u, '').replace(/,/gu, '').replace(/^\((.*)\)$/u, '-$1').replace(/\s+/gu, '');
  return isDecimalString(t) ? t : null;
}

/** `2025-03-03T08:00` or `2025-03-03 08:00[:00]` -> `2025-03-03T08:00:00`; null for anything else. */
export function normalizeLocalDateTime(raw: string): string | null {
  const m = LOCAL_DT_RE.exec(raw.trim());
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3] ?? ':00'}`;
}

function commaBeforeAmount(row: string): number {
  for (let p = row.indexOf(','); p >= 0; p = row.indexOf(',', p + 1)) {
    if (normalizeMoney(row.slice(p + 1)) !== null) return p;
  }
  return -1;
}

export interface ParsedLines {
  lines: ChargeLine[];
  errors: string[];
}

/** Parse the charge-lines text area. The amount is the last field; the description is everything before it. */
export function parseChargeLines(text: string): ParsedLines {
  const lines: ChargeLine[] = [];
  const errors: string[] = [];
  const rows = text.split(/\r?\n/u).map((r) => r.trim()).filter((r) => r.length > 0);
  if (rows.length > MAX_LINES) {
    errors.push(`At most ${MAX_LINES} charge lines can be checked at once.`);
    return { lines, errors };
  }
  rows.forEach((row, i) => {
    if (i === 0 && HEADER_RE.test(row)) return;
    const sep = /[\t|;]/u.test(row) ? /[\t|;]/u : null;
    let description: string;
    let amountText: string;
    if (sep) {
      const parts = row.split(sep).map((p) => p.trim());
      amountText = parts.pop() ?? '';
      description = parts.join(' ').trim();
    } else {
      // The amount is the text after the leftmost comma that parses as money, so "Linehaul, $1,500.00"
      // keeps its thousands separator and "Stop, off, 25" keeps its description.
      const comma = commaBeforeAmount(row);
      if (comma < 0) {
        errors.push(`Line ${i + 1}: expected "description, amount".`);
        return;
      }
      description = row.slice(0, comma).trim();
      amountText = row.slice(comma + 1).trim();
    }
    const amount = normalizeMoney(amountText);
    if (!description) errors.push(`Line ${i + 1}: the description is empty.`);
    else if (description.length > MAX_DESCRIPTION) errors.push(`Line ${i + 1}: the description is longer than ${MAX_DESCRIPTION} characters.`);
    if (amount === null) errors.push(`Line ${i + 1}: "${amountText}" is not an amount.`);
    if (description && description.length <= MAX_DESCRIPTION && amount !== null) lines.push({ description, amount });
  });
  return { lines, errors };
}

const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim());

function money(label: string, v: string, errors: string[]): string | null {
  if (v.trim() === '') return null;
  const n = normalizeMoney(v);
  if (n === null) errors.push(`${label}: "${v}" is not an amount.`);
  return n;
}

function dateTime(label: string, v: string, errors: string[]): string | null {
  if (v.trim() === '') return null;
  const n = normalizeLocalDateTime(v);
  if (n === null) errors.push(`${label}: enter a date and time (YYYY-MM-DD HH:MM).`);
  return n;
}

function integer(label: string, v: string, min: number, max: number, errors: string[]): number {
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n < min || n > max) errors.push(`${label}: enter a whole number between ${min} and ${max}.`);
  return n;
}

export interface FreightInput {
  bundle: ExtractedBundle;
  settings: AnalysisSettings;
  errors: string[];
}

/** Validate the form and assemble the engine input. `errors` is non-empty when the input cannot be run. */
export function buildFreightInput(form: FreightForm): FreightInput {
  const errors: string[] = [];
  const parsed = parseChargeLines(form.linesText);
  errors.push(...parsed.errors);

  const invoice = {
    ...emptyInvoice(),
    invoice_number: opt(form.invoiceNumber),
    load_number: opt(form.loadNumber),
    carrier: opt(form.carrier),
    shipper: opt(form.shipper),
    invoice_date: opt(form.invoiceDate),
    lines: parsed.lines,
    total: money('Invoice total', form.total, errors),
  };
  const hasRateCon = [form.rcLinehaul, form.rcFuel, form.rcFreeHours, form.rcRatePerHour, form.rcMaxHours, form.rcAuthorized].some((v) => v.trim() !== '');
  const rateCon = hasRateCon
    ? {
        ...emptyRateConfirmation(),
        load_number: opt(form.loadNumber),
        carrier: opt(form.carrier),
        linehaul_rate: money('Linehaul rate', form.rcLinehaul, errors),
        fuel_surcharge: money('Fuel surcharge', form.rcFuel, errors),
        detention_free_hours: money('Detention free hours', form.rcFreeHours, errors),
        detention_rate_per_hour: money('Detention rate per hour', form.rcRatePerHour, errors),
        detention_max_hours: money('Detention maximum hours', form.rcMaxHours, errors),
        authorized_accessorials: form.rcAuthorized
          .split(/[,\n;]/u)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= MAX_DESCRIPTION),
      }
    : null;
  const hasBol = [form.appointment, form.arrival, form.departure].some((v) => v.trim() !== '');
  const bol = hasBol
    ? {
        ...emptyBillOfLading(),
        load_number: opt(form.loadNumber),
        facility: opt(form.facility),
        appointment_time: dateTime('Appointment time', form.appointment, errors),
        arrival_time: dateTime('Arrival time', form.arrival, errors),
        departure_time: dateTime('Departure time', form.departure, errors),
      }
    : null;

  if (parsed.lines.length === 0 && parsed.errors.length === 0) errors.push('Enter at least one invoice charge line.');
  if (rateCon === null) errors.push('Enter the rate confirmation terms (at least one of linehaul, fuel surcharge, detention terms or authorized accessorials).');

  const settings: AnalysisSettings = {
    detentionIncrementMinutes: integer('Detention increment (minutes)', form.incrementMinutes, 1, 240, errors),
    amountTolerance: money('Amount tolerance', form.tolerance, errors) ?? DEFAULT_ANALYSIS_SETTINGS.amountTolerance,
    disputeWindowDays: integer('Dispute window (days)', form.windowDays, 1, 3650, errors),
  };
  return { bundle: { invoice: parsed.lines.length > 0 ? invoice : null, rate_confirmation: rateCon, bol, warnings: [] }, settings, errors };
}

/** Run the rules engine on a validated input. Throws AnalysisInputError only for inputs the engine refuses. */
export function runFreightCheck(form: FreightForm, now: Date): { outcome: FreightOutcome | null; errors: string[] } {
  const input = buildFreightInput(form);
  if (input.errors.length > 0) return { outcome: null, errors: input.errors };
  try {
    const result = applyRules(input.bundle, form.perspective, input.settings);
    const letter = buildDemandLetter(input.bundle, result, now.toISOString().slice(0, 10), input.settings.disputeWindowDays);
    return { outcome: { bundle: input.bundle, settings: input.settings, result, letter, generatedAt: now.toISOString() }, errors: [] };
  } catch (error) {
    if (error instanceof AnalysisInputError || error instanceof RangeError) {
      return { outcome: null, errors: ['The engine could not read these values. Check amounts, hours and times, then try again.'] };
    }
    throw error;
  }
}