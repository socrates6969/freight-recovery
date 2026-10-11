// REQ-20261011-ocean-dd Tier L: T6 CSV import (DD-CSV01..CSV07; Part C C8). The planner's sample is restated byte for
// byte; every other file is built from it. Expected invoices are the T3 fixtures (synthetic).
import { beforeAll, describe, expect, it } from 'vitest';
import { clone, loadDd, si1, type DdMod } from './helpers/dd-fixtures.js';
import type { OInvoice } from './helpers/dd-oracle.js';

let M: DdMod;
beforeAll(async () => { M = await loadDd(); });

const COLS = ['invoice_number', 'billing_party', 'billing_party_type', 'billed_party', 'direction', 'invoice_date', 'due_date', 'upstream_invoice_date', 'bl_numbers', 'port_of_discharge', 'liability_basis', 'total_due', 'rule_reference', 'dispute_contact', 'dispute_digital_means', 'dispute_request_days', 'dispute_resolution_days', 'certifies_fmc_rules', 'certifies_performance', 'container_number', 'size_type', 'charge_type', 'free_days', 'free_time_start', 'free_time_end', 'availability_date', 'earliest_return_date', 'period_from', 'period_to', 'rate', 'amount', 'clock_start', 'clock_stop', 'cargo_available_date', 'return_refused_dates'] as const;
type Col = (typeof COLS)[number];
const HEADER = COLS.join(',');
const SAMPLE_ROWS = [
  'SYN-DD-0001,Synthetic Ocean Line A,ocean_carrier,Synthetic Importer Inc,import,2026-03-27,2026-04-26,,SYNBL0001,Synthetic Port 1,Consignee named on the bill of lading,"$3,910.00",Synthetic tariff rule DET-1,disputes@example.com,https://example.com/dd-disputes,30,30,yes,yes,SYNU0000001,40dv,detention,4,2026-03-02,2026-03-05,2026-02-27,,2026-03-06,2026-03-09,210,840.00,2026-03-02,2026-03-20,,',
  'SYN-DD-0001,Synthetic Ocean Line A,ocean_carrier,Synthetic Importer Inc,import,2026-03-27,2026-04-26,,SYNBL0001,Synthetic Port 1,Consignee named on the bill of lading,"$3,910.00",Synthetic tariff rule DET-1,disputes@example.com,https://example.com/dd-disputes,30,30,yes,yes,SYNU0000001,40dv,detention,4,2026-03-02,2026-03-05,2026-02-27,,2026-03-10,2026-03-13,260.00,1040,2026-03-02,2026-03-20,,',
  'SYN-DD-0001,Synthetic Ocean Line A,ocean_carrier,Synthetic Importer Inc,import,2026-03-27,2026-04-26,,SYNBL0001,Synthetic Port 1,Consignee named on the bill of lading,"$3,910.00",Synthetic tariff rule DET-1,disputes@example.com,https://example.com/dd-disputes,30,30,yes,yes,SYNU0000001,40dv,detention,4,2026-03-02,2026-03-05,2026-02-27,,2026-03-14,2026-03-20,$290.00,"2,030.00",2026-03-02,2026-03-20,,',
];
const SAMPLE = [HEADER, ...SAMPLE_ROWS].join('\n');

/** Split a CSV line written by these tests (quoted fields contain no line breaks). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (q) {
      if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
const quote = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function edit(line: string, changes: Partial<Record<Col, string>>): string {
  const c = cells(line);
  for (const [k, v] of Object.entries(changes)) c[COLS.indexOf(k as Col)] = v ?? '';
  return c.map(quote).join(',');
}
const ROW1 = SAMPLE_ROWS[0] ?? '';
/** A valid single-row invoice (SI-1 with one period 03-06..03-09 and total 840.00). */
const single = (num: string, extra: Partial<Record<Col, string>> = {}) => edit(ROW1, { invoice_number: num, total_due: '840.00', ...extra });
function singleInvoice(num: string): OInvoice {
  const i = si1();
  i.invoiceNumber = num;
  i.totalDue = '840.00';
  const c = i.containers[0];
  if (c) c.periods = c.periods.slice(0, 1);
  return i;
}
const file = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('T6 CSV import (C8)', () => {
  it('DD-CSV01 the planner sample parses to exactly SI-1', () => {
    const r = M.parseDdCsv(SAMPLE);
    expect(r.errors).toEqual([]);
    expect(r.invoices).toEqual([si1()]);
  });
  it('DD-CSV02 CRLF, BOM, trailing empty lines and an upper-case header give the identical result', () => {
    const variant = `${String.fromCharCode(0xfeff)}${[HEADER.toUpperCase(), ...SAMPLE_ROWS].join('\r\n')}\r\n\r\n\r\n`;
    expect(M.parseDdCsv(variant)).toEqual(M.parseDdCsv(SAMPLE));
    expect(M.parseDdCsv(`${SAMPLE}\n\n`)).toEqual({ invoices: [si1()], errors: [] });
  });
  it('DD-CSV03 file errors return no invoices and only that error', () => {
    const tooLarge = SAMPLE + ' '.repeat(1_000_001 - SAMPLE.length);
    expect(tooLarge.length).toBe(1_000_001);
    expect(M.parseDdCsv(tooLarge)).toEqual({ invoices: [], errors: [{ row: 0, column: null, code: 'too_large' }] });
    const many = file(...Array.from({ length: 2001 }, () => single('SYN-DD-0100')));
    expect(many.length).toBeLessThanOrEqual(1_000_000);
    expect(M.parseDdCsv(many)).toEqual({ invoices: [], errors: [{ row: 0, column: null, code: 'too_many_rows' }] });
    // columns 30 and 31 (1-based: rate, amount) swapped
    const swapped: string[] = [...COLS.slice(0, 29), ...COLS.slice(29, 31).reverse(), ...COLS.slice(31)];
    expect(swapped.slice(29, 31)).toEqual(['amount', 'rate']);
    expect(M.parseDdCsv([swapped.join(','), ...SAMPLE_ROWS].join('\n'))).toEqual({ invoices: [], errors: [{ row: 1, column: null, code: 'header_mismatch' }] });
    // The line has no other quote character, so it unambiguously ends inside the quoted field.
    const openLine = single('SYN-DD-0110').replace('Synthetic Port 1', '"Synthetic Port 1');
    expect(openLine.split('"')).toHaveLength(2);
    const unterminated = M.parseDdCsv(file(openLine));
    expect(unterminated.invoices).toEqual([]);
    expect(unterminated.errors.map((e) => e.code)).toEqual(['unterminated_quote']);
    const fiftyOne = file(...Array.from({ length: 51 }, (_, k) => single(`SYN-DD-${String(1000 + k)}`)));
    expect(M.parseDdCsv(fiftyOne)).toEqual({ invoices: [], errors: [{ row: 0, column: null, code: 'too_many_invoices' }] });
    const fifty = M.parseDdCsv(file(...Array.from({ length: 50 }, (_, k) => single(`SYN-DD-${String(1000 + k)}`))));
    expect([fifty.invoices.length, fifty.errors]).toEqual([50, []]);
  });
  it('DD-CSV04 row errors', () => {
    const cnt = cells(single('SYN-DD-0201')).slice(0, 34).map(quote).join(',');
    expect(M.parseDdCsv(file(cnt))).toEqual({ invoices: [], errors: [{ row: 2, column: null, code: 'column_count' }] });
    expect(M.parseDdCsv(file(single('SYN-DD-0202', { invoice_date: '03/27/2026' })))).toEqual({ invoices: [], errors: [{ row: 2, column: 'invoice_date', code: 'invalid_value' }] });
    expect(M.parseDdCsv(file(single('SYN-DD-0203', { size_type: '' })))).toEqual({ invoices: [], errors: [{ row: 2, column: 'size_type', code: 'required' }] });
    const inc = M.parseDdCsv(file(SAMPLE_ROWS[0] ?? '', edit(SAMPLE_ROWS[1] ?? '', { due_date: '2026-04-27' }), SAMPLE_ROWS[2] ?? '', single('SYN-DD-0204')));
    expect(inc.errors).toEqual([{ row: 3, column: 'due_date', code: 'inconsistent_invoice' }]);
    expect(inc.invoices).toEqual([singleInvoice('SYN-DD-0204')]);
    const incC = M.parseDdCsv(file(SAMPLE_ROWS[0] ?? '', edit(SAMPLE_ROWS[1] ?? '', { free_days: '5' }), SAMPLE_ROWS[2] ?? ''));
    expect(incC).toEqual({ invoices: [], errors: [{ row: 3, column: 'free_days', code: 'inconsistent_container' }] });
    const overlap = M.parseDdCsv(file(SAMPLE_ROWS[0] ?? '', edit(SAMPLE_ROWS[1] ?? '', { period_from: '2026-03-09' }), SAMPLE_ROWS[2] ?? ''));
    expect(overlap).toEqual({ invoices: [], errors: [{ row: 2, column: null, code: 'invalid_invoice' }] });
  });
  it('DD-CSV05 empty container numbers, rows without periods, incomplete period', () => {
    const two = M.parseDdCsv(file(single('SYN-DD-0301', { container_number: '' }), edit(single('SYN-DD-0301', { container_number: '' }), { period_from: '2026-03-10', period_to: '2026-03-13', rate: '260.00', amount: '1040.00', total_due: '840.00' })));
    expect(two.errors).toEqual([]);
    expect(two.invoices).toHaveLength(1);
    expect(two.invoices[0]?.containers.map((c) => [c.containerNumber, c.periods.length])).toEqual([[null, 1], [null, 1]]);
    const noPeriod = M.parseDdCsv(file(single('SYN-DD-0302'), single('SYN-DD-0302', { container_number: 'SYNU0000302', period_from: '', period_to: '', rate: '', amount: '' })));
    expect(noPeriod.errors).toEqual([]);
    expect(noPeriod.invoices[0]?.containers.map((c) => [c.containerNumber, c.periods.length])).toEqual([['SYNU0000001', 1], ['SYNU0000302', 0]]);
    expect(M.parseDdCsv(file(single('SYN-DD-0303', { amount: '' })))).toEqual({ invoices: [], errors: [{ row: 2, column: 'amount', code: 'required' }] });
  });
  it('DD-CSV06 errors sorted by row then column position (null last); invoices in first-appearance order', () => {
    const r = M.parseDdCsv(file(single('SYN-DD-0402'), single('SYN-DD-0401', { size_type: '', invoice_date: 'x' }), single('SYN-DD-0400'), cells(single('SYN-DD-0403')).slice(0, 30).map(quote).join(',')));
    expect(r.errors).toEqual([{ row: 3, column: 'invoice_date', code: 'invalid_value' }, { row: 3, column: 'size_type', code: 'required' }, { row: 5, column: null, code: 'column_count' }]);
    expect(r.invoices.map((i) => i.invoiceNumber)).toEqual(['SYN-DD-0402', 'SYN-DD-0400']);
  });
  it('DD-CSV07 a ~1,000,000-character valid file (2,000 rows) parses in under 2 s, deterministically', () => {
    const rows: string[] = [];
    for (let inv = 0; inv < 50; inv++) {
      for (let k = 0; k < 40; k++) {
        rows.push(edit(ROW1, {
          invoice_number: `SYN-DD-${String(5000 + inv)}`, liability_basis: `Synthetic liability basis ${'x'.repeat(115)}`, total_due: '33600.00',
          container_number: `SYNU${String(inv * 100 + k).padStart(7, '0')}`,
        }));
      }
    }
    const text = file(...rows);
    expect(rows).toHaveLength(2000);
    expect(text.length).toBeLessThanOrEqual(1_000_000);
    expect(text.length).toBeGreaterThan(800_000);
    const t0 = performance.now();
    const a = M.parseDdCsv(text);
    const ms = performance.now() - t0;
    expect(a.errors).toEqual([]);
    expect(a.invoices).toHaveLength(50);
    expect(a.invoices[0]?.containers).toHaveLength(40);
    expect(ms, `parse took ${ms.toFixed(0)} ms`).toBeLessThan(2000);
    expect(M.parseDdCsv(clone(text))).toEqual(a);
  });
});
