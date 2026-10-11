// REQ-20261011-ocean-dd Tier L: T5 draft dispute letter (DD-L01..L05; Part C C7). Fixed texts from test-spec plus the
// test-owned oracle letter (helpers/dd-oracle.ts oLetter) over the product's own audit result.
import { beforeAll, describe, expect, it } from 'vitest';
import { CASES, clone, deepFreeze, loadDd, type Case, type DdMod } from './helpers/dd-fixtures.js';
import { oAudit, oLetter } from './helpers/dd-oracle.js';

let M: DdMod;
beforeAll(async () => { M = await loadDd(); });
const get = (id: string): Case => {
  const f = CASES[id];
  if (!f) throw new Error(id);
  return f();
};
const audit = (c: Case) => M.auditDdInvoice(deepFreeze({ invoice: clone(c.invoice), tariff: c.tariff, calendar: c.calendar }));
const HEAD = [
  'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.', '', 'Date: 2026-10-11', 'To: Synthetic Ocean Line A', 'From: Synthetic Importer Inc',
  'Re: Invoice SYN-DD-0001 / B/L SYNBL0001 - request for fee mitigation, refund or waiver', '',
  'We reviewed the above demurrage and detention invoice against 46 CFR Part 541, 46 CFR 545.5 and the applicable tariff, and ask you to review the following items:', '',
];
const L01 = [...HEAD, '(No items found. Do not send.)', '', 'No amount is requested: there are no findings.', '', 'Sincerely,', '[Name / Title / Contact - to be completed by sender]'].join('\n');
const L02 = [...HEAD,
  '1. Charges exceed the attached tariff: $290.00',
  "   Container SYNU0000001 (40DV, detention): the attached tariff 'Maersk US import detention (2026)' gives $3910.00 for 15 chargeable day(s), but the invoice charges $4200.00.",
  '2. Required invoice information inaccurate (46 CFR 541.6): $3910.00 (needs review)',
  '   The invoice misstates 1 item(s) that 46 CFR 541.6 requires: End date of free time. 46 CFR 541.6 requires this information to be accurate - review whether to dispute the charge.',
  '',
  'Confirmed amount: $290.00. Amount for review: $3910.00.',
  'We request a credit, refund or waiver of these amounts. Supporting calculations are attached in the evidence packet.',
  'Under 46 CFR 541.8(b) the billing party must attempt to resolve the request "within thirty (30) calendar days of receiving such a request or at a later date as agreed upon by both parties."',
  '(Reminder for sender: remove items that do not apply. 46 CFR 541.8(a) allows at least 30 calendar days from the invoice date to request mitigation, refund or waiver; based on the invoice date 2026-03-27, request by 2026-04-26. Check the dates before sending.)',
  '', 'Sincerely,', '[Name / Title / Contact - to be completed by sender]'].join('\n');

describe('oracle self-check (no product code)', () => {
  it('L01 and L02 texts', () => {
    const c1 = get('SI-1');
    expect(oLetter(c1.invoice, oAudit(c1), '2026-10-11')).toBe(L01);
    const c4 = get('SI-4');
    expect(oLetter(c4.invoice, oAudit(c4), '2026-10-11')).toBe(L02);
  });
});

describe('T5 letter (C7)', () => {
  it('DD-L01 SI-1: no findings', () => {
    const c = get('SI-1');
    expect(M.buildDdDisputeLetter(c.invoice, audit(c), '2026-10-11')).toBe(L01);
  });
  it('DD-L02 SI-4: two items, confirmed and review amounts, deadline', () => {
    const c = get('SI-4');
    expect(M.buildDdDisputeLetter(c.invoice, audit(c), '2026-10-11')).toBe(L02);
  });
  it('DD-L03 SI-10: B/L N/A, item explanation cut to 600, missing invoice date', () => {
    const c = get('SI-10');
    const r = audit(c);
    const letter = M.buildDdDisputeLetter(c.invoice, r, '2026-10-11');
    const lines = letter.split('\n');
    expect(lines[5]).toBe('Re: Invoice SYN-DD-0010 / B/L N/A - request for fee mitigation, refund or waiver');
    const item = lines[10] ?? '';
    expect(item.startsWith('   ')).toBe(true);
    const text = item.slice(3);
    expect([...text]).toHaveLength(600);
    expect(text.endsWith('...')).toBe(true);
    expect(text.slice(0, 597)).toBe((r.findings[0]?.explanation ?? '').slice(0, 597));
    expect(letter).toContain('; the invoice date is missing. Check the dates before sending.)');
    expect(letter).toBe(oLetter(c.invoice, r, '2026-10-11'));
  });
  it('DD-L04 disputeRequestDays 45 -> request by invoice date + 45', () => {
    const c = get('SI-2');
    c.invoice.disputeRequestDays = 45;
    const r = audit(c);
    expect(r.findings.length).toBeGreaterThan(0);
    const letter = M.buildDdDisputeLetter(c.invoice, r, '2026-10-11');
    expect(letter).toContain('based on the invoice date 2026-03-27, request by 2026-05-11.');
    expect(letter).toBe(oLetter(c.invoice, r, '2026-10-11'));
  });
  it('DD-L05 hostile strings pass through plain; invalid today -> RangeError', () => {
    const c = get('SI-2');
    c.invoice.billingPartyName = 'Synthetic <script> Line';
    c.invoice.billedPartyName = 'Synthetic `Importer` Inc';
    const r = audit(c);
    const letter = M.buildDdDisputeLetter(c.invoice, r, '2026-10-11');
    expect(letter).toContain('\nTo: Synthetic script Line\n');
    expect(letter).toContain('\nFrom: Synthetic Importer Inc\n');
    expect(letter).not.toMatch(/[<>`]/);
    expect(letter).toBe(oLetter(c.invoice, r, '2026-10-11'));
    for (const bad of ['2026-10-1', '11.10.2026', '', '2026-10-11T00:00:00Z']) expect(() => M.buildDdDisputeLetter(c.invoice, r, bad), bad).toThrow(RangeError);
  });
  it('every SI case: the letter equals the oracle letter for the product result', () => {
    for (const id of Object.keys(CASES)) {
      const c = get(id);
      const r = audit(c);
      expect(M.buildDdDisputeLetter(c.invoice, r, '2026-10-11'), id).toBe(oLetter(c.invoice, r, '2026-10-11'));
    }
  });
});
