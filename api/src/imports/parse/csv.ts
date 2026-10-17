/**
 * CSV (A5.3): a port of CPython's `csv.reader` state machine (excel dialect: delimiter `,`, quotechar
 * `"`, doublequote, no escapechar, skipinitialspace off, strict=False) fed line by line exactly like
 * iterating `io.StringIO(raw)` (lines split at `\n` only, each keeping its `\n`), followed by a port of
 * `freight_recovery.ingest.loader._csv_to_text` with its three layouts.
 *
 * Errors (all reject the document as `malformed_csv`): a character after `\r`/`\n` in an unquoted
 * record ("new-line character seen in unquoted field"), a field longer than 131072 code points (the
 * CPython field limit), and the TS-only caps of 10,000 columns per record and 200,000 records.
 */
import type { WarningCode } from '@fr/shared/import-fields';

import { normKey, pyStrip } from './text.js';

export const CSV_FIELD_LIMIT = 131072;
export const CSV_MAX_COLUMNS = 10_000;
export const CSV_MAX_RECORDS = 200_000;

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
  }
}

const St = {
  START_RECORD: 0,
  START_FIELD: 1,
  IN_FIELD: 2,
  IN_QUOTED_FIELD: 3,
  QUOTE_IN_QUOTED_FIELD: 4,
  EAT_CRNL: 5,
} as const;
type St = (typeof St)[keyof typeof St];

/** End-of-line sentinel (CPython feeds EOL after every line). */
const EOL = '';

function* stringIoLines(raw: string): Generator<string> {
  let i = 0;
  while (i < raw.length) {
    const j = raw.indexOf('\n', i);
    if (j === -1) {
      yield raw.slice(i);
      return;
    }
    yield raw.slice(i, j + 1);
    i = j + 1;
  }
}

/** `list(csv.reader(io.StringIO(raw)))` with CPython semantics (strict=False). */
export function readCsv(raw: string): string[][] {
  const records: string[][] = [];
  const lines = stringIoLines(raw);
  let state: St = St.START_RECORD;
  let fields: string[] = [];
  let field = '';
  let fieldLen = 0;

  const save = () => {
    fields.push(field);
    field = '';
    fieldLen = 0;
    if (fields.length > CSV_MAX_COLUMNS) throw new CsvError('too many columns');
  };
  const add = (c: string) => {
    if (fieldLen >= CSV_FIELD_LIMIT) throw new CsvError('field larger than field limit');
    field += c;
    fieldLen += 1;
  };
  const isNl = (c: string) => c === '\n' || c === '\r';

  const process = (c: string): void => {
    switch (state) {
      case St.START_RECORD:
        if (c === EOL) return; // empty line: record []
        if (isNl(c)) {
          state = St.EAT_CRNL;
          return;
        }
        state = St.START_FIELD;
        process(c);
        return;
      case St.START_FIELD:
        if (isNl(c) || c === EOL) {
          save();
          state = c === EOL ? St.START_RECORD : St.EAT_CRNL;
        } else if (c === '"') state = St.IN_QUOTED_FIELD;
        else if (c === ',') save();
        else {
          add(c);
          state = St.IN_FIELD;
        }
        return;
      case St.IN_FIELD:
        if (isNl(c) || c === EOL) {
          save();
          state = c === EOL ? St.START_RECORD : St.EAT_CRNL;
        } else if (c === ',') {
          save();
          state = St.START_FIELD;
        } else add(c);
        return;
      case St.IN_QUOTED_FIELD:
        if (c === EOL) return;
        if (c === '"') state = St.QUOTE_IN_QUOTED_FIELD;
        else add(c);
        return;
      case St.QUOTE_IN_QUOTED_FIELD:
        if (c === '"') {
          add(c);
          state = St.IN_QUOTED_FIELD;
        } else if (c === ',') {
          save();
          state = St.START_FIELD;
        } else if (isNl(c) || c === EOL) {
          save();
          state = c === EOL ? St.START_RECORD : St.EAT_CRNL;
        } else {
          // strict=False: keep the character and continue as an unquoted field.
          add(c);
          state = St.IN_FIELD;
        }
        return;
      case St.EAT_CRNL:
        if (isNl(c)) return;
        if (c === EOL) {
          state = St.START_RECORD;
          return;
        }
        throw new CsvError('new-line character seen in unquoted field');
    }
  };

  for (;;) {
    // parse_reset
    fields = [];
    field = '';
    fieldLen = 0;
    state = St.START_RECORD;
    let endOfInput = false;
    do {
      const next = lines.next();
      if (next.done) {
        if (fieldLen !== 0 || (state as St) === St.IN_QUOTED_FIELD) {
          save();
          endOfInput = true;
          break;
        }
        return records;
      }
      for (const c of next.value) process(c);
      process(EOL);
    } while ((state as St) !== St.START_RECORD);
    records.push(fields);
    if (records.length > CSV_MAX_RECORDS) throw new CsvError('too many records');
    if (endOfInput) return records;
  }
}

const DESC_HEADERS: ReadonlySet<string> = new Set(['description', 'desc', 'charge', 'charge_description', 'item', 'line', 'line_item', 'accessorial', 'charge_type']);
const AMOUNT_HEADERS: ReadonlySet<string> = new Set(['amount', 'charge_amount', 'cost', 'price', 'total', 'line_total']);

export interface CsvText {
  /** Flattened `Key: Value` text (Python `_csv_to_text`). */
  text: string;
  warnings: WarningCode[];
  /** Output entries (before joining with `\n`) and their 1-based source record numbers. */
  entries: { text: string; row: number }[];
}

/** Port of `_csv_to_text` with per-entry source records (header = record 1). */
export function csvToText(raw: string): CsvText {
  const warnings: WarningCode[] = [];
  const rows = readCsv(raw).filter((r) => r.some((c) => pyStrip(c) !== ''));
  const finish = (entries: { text: string; row: number }[]): CsvText => ({ text: entries.map((e) => e.text).join('\n'), warnings, entries });
  const first = rows[0];
  if (!first) return finish([]);

  const header = first.map((h) => normKey(h));
  const descIdx = header.findIndex((h) => DESC_HEADERS.has(h));
  const amtIdx = header.findIndex((h, i) => AMOUNT_HEADERS.has(h) && i !== (descIdx === -1 ? null : descIdx));
  if (descIdx !== -1 && amtIdx !== -1) {
    const entries: { text: string; row: number }[] = [];
    rows.slice(1).forEach((row, i) => {
      if (Math.max(descIdx, amtIdx) >= row.length) {
        warnings.push('CSV_ROW_TOO_SHORT');
        return;
      }
      entries.push({ text: `Charge: ${pyStrip(row[descIdx] ?? '')} | ${pyStrip(row[amtIdx] ?? '')}`, row: i + 2 });
    });
    return finish(entries);
  }

  if (rows.every((r) => r.length === 2)) {
    return finish(rows.map((r, i) => ({ text: `${pyStrip(r[0] ?? '')}: ${pyStrip(r[1] ?? '')}`, row: i + 1 })));
  }

  const entries: { text: string; row: number }[] = [];
  rows.slice(1).forEach((row, i) => {
    if (i === 0) {
      if (row.length !== first.length) warnings.push('CSV_ROW_LENGTH_MISMATCH');
      const n = Math.min(first.length, row.length);
      for (let k = 0; k < n; k += 1) entries.push({ text: `${pyStrip(first[k] ?? '')}: ${pyStrip(row[k] ?? '')}`, row: 2 });
    } else {
      entries.push({ text: `Charge: ${row.map((c) => pyStrip(c)).join(' | ')}`, row: i + 2 });
    }
  });
  return finish(entries);
}
