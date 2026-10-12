/**
 * Strict parser of a FRED price CSV (Part C F9, spec A5). Works on the raw bytes: size cap, BOM and byte
 * set first, then ASCII decoding, anchored regexes (no backtracking risk), real calendar dates, the
 * series' frequency (weekly Mondays 7 days apart, or consecutive 1sts of the month) and exact decimal
 * bounds. Any violation throws `PriceCsvError { code, line }` (line 1-based, header = 1; null when the
 * error is not tied to one line).
 */
import { daysFromCivil } from '../analysis/local-datetime.js';
import { Dec, compare } from '../analysis/py-decimal.js';

import { PRICE_CSV_MAX_BYTES, PRICE_CSV_MAX_ROWS, PRICE_SERIES, isPriceSeriesKey, type PriceObservationData, type PriceSeriesKey } from './constants.js';
import { sha256Hex } from './sha256.js';

export const PRICE_CSV_ERROR_CODES = Object.freeze([
  'too_large',
  'bom',
  'not_ascii',
  'bad_header',
  'empty',
  'too_many_rows',
  'bad_row',
  'bad_date',
  'not_increasing',
  'not_monday',
  'not_first_of_month',
  'gap',
  'out_of_range',
] as const);
export type PriceCsvErrorCode = (typeof PRICE_CSV_ERROR_CODES)[number];

export class PriceCsvError extends Error {
  constructor(
    readonly code: PriceCsvErrorCode,
    readonly line: number | null,
  ) {
    super(line === null ? `price csv: ${code}` : `price csv: ${code} (line ${line})`);
    this.name = 'PriceCsvError';
  }
}

export interface ParsedPriceCsv {
  rows: PriceObservationData[];
  sha256: string;
  firstDate: string;
  lastDate: string;
}

const LF = 0x0a;
const CR = 0x0d;
const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;
const BOM = [0xef, 0xbb, 0xbf] as const;
const ROW = /^([0-9]{4})-([0-9]{2})-([0-9]{2}),([0-9]{1,4})(?:\.([0-9]{1,3}))?$/u;
const DAYS_PER_WEEK = 7;
/** 1970-01-01 was a Thursday (Monday-based index 3). */
const EPOCH_WEEKDAY = 3;
const MONTHS_PER_YEAR = 12;
const VALUE_DECIMALS = 3;
const DECODE_CHUNK = 8192;

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function decodeAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += DECODE_CHUNK) out += String.fromCharCode(...bytes.subarray(i, i + DECODE_CHUNK));
  return out;
}

/** F9 `parsePriceCsv(bytes, seriesKey)`. */
export function parsePriceCsv(bytes: Uint8Array, seriesKey: PriceSeriesKey): ParsedPriceCsv {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
  if (!isPriceSeriesKey(seriesKey)) throw new RangeError('unknown price series');
  const def = PRICE_SERIES[seriesKey];
  if (bytes.length > PRICE_CSV_MAX_BYTES) throw new PriceCsvError('too_large', null);
  if (bytes.length >= BOM.length && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2]) throw new PriceCsvError('bom', 1);
  let lineNo = 1;
  for (const b of bytes) {
    if (b === LF) lineNo += 1;
    else if (b !== CR && (b < PRINTABLE_MIN || b > PRINTABLE_MAX)) throw new PriceCsvError('not_ascii', lineNo);
  }
  const text = decodeAscii(bytes);

  const parts = text.split('\n');
  // A CR directly before an LF is dropped (every element except the last was followed by an LF).
  const lines = parts.map((l, i) => (i < parts.length - 1 && l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== `observation_date,${def.fredId}`) throw new PriceCsvError('bad_header', 1);
  const dataCount = lines.length - 1;
  if (dataCount < 1) throw new PriceCsvError('empty', null);
  if (dataCount > PRICE_CSV_MAX_ROWS) throw new PriceCsvError('too_many_rows', null);

  const min = Dec.parse(def.minValue);
  const max = Dec.parse(def.maxValue);
  const weekly = def.frequency === 'weekly';
  const rows: PriceObservationData[] = [];
  let prevDay: number | null = null;
  let prevMonth: number | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    const ln = i + 1;
    const m = ROW.exec(lines[i] ?? '');
    if (!m) throw new PriceCsvError('bad_row', ln);
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 1 || mo < 1 || mo > MONTHS_PER_YEAR || d < 1 || d > daysInMonth(y, mo)) throw new PriceCsvError('bad_date', ln);
    const day = daysFromCivil(y, mo, d);
    if (prevDay !== null && day <= prevDay) throw new PriceCsvError('not_increasing', ln);
    if (weekly) {
      if ((((day + EPOCH_WEEKDAY) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK !== 0) throw new PriceCsvError('not_monday', ln);
      if (prevDay !== null && day - prevDay !== DAYS_PER_WEEK) throw new PriceCsvError('gap', ln);
    } else {
      if (d !== 1) throw new PriceCsvError('not_first_of_month', ln);
      const monthIndex = y * MONTHS_PER_YEAR + (mo - 1);
      if (prevMonth !== null && monthIndex - prevMonth !== 1) throw new PriceCsvError('gap', ln);
      prevMonth = monthIndex;
    }
    prevDay = day;
    const valueText = `${BigInt(m[4] ?? '0').toString()}.${(m[5] ?? '').padEnd(VALUE_DECIMALS, '0')}`;
    const v = Dec.parse(valueText);
    if (compare(v, min) < 0 || compare(v, max) > 0) throw new PriceCsvError('out_of_range', ln);
    rows.push({ date: `${m[1] ?? ''}-${m[2] ?? ''}-${m[3] ?? ''}`, value: valueText });
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) throw new PriceCsvError('empty', null);
  return { rows, sha256: sha256Hex(bytes), firstDate: first.date, lastDate: last.date };
}
