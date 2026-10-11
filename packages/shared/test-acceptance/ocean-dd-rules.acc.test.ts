// REQ-20261011-ocean-dd Tier L: T3 audit rules on the synthetic invoices SI-1..SI-12 (exact texts) and DD-R01..R06,
// T4 checks and container summaries (DD-C01..C06). Part C C5/C6. Each case is checked three ways: the fixed table
// values of test-spec, the exact texts of test-spec, and deep equality with the test-owned oracle.
import { beforeAll, describe, expect, it } from 'vitest';
import { CASES, EXPECT, HAPAG_CAL, MAERSK, MSC, MSC_CAL, W1_STEP_LIST, W3_STEP_LIST, clone, deepFreeze, loadDd, si1, type Case, type DdMod } from './helpers/dd-fixtures.js';
import { O_REGULATION, oAudit, oCanon, oPlain, type OFinding, type OInvoice, type OResult } from './helpers/dd-oracle.js';

let M: DdMod;
beforeAll(async () => { M = await loadDd(); });

const byRule = (r: OResult, id: string): OFinding => {
  const f = r.findings.find((x) => x.ruleId === id);
  if (!f) throw new Error(`no ${id} finding`);
  return f;
};
const C541_5 = { source: 'regulation', key: '46 CFR 541.5', label: '46 CFR 541.5', excerpt: O_REGULATION['46 CFR 541.5'] };

/** test-spec T3 exact texts (applied to the oracle in the self-check and to the product). */
function exactTexts(id: string, r: OResult): void {
  switch (id) {
    case 'SI-2': {
      const f = byRule(r, 'DD-541-6-CONTENT');
      expect(f.title).toBe('Required invoice information missing or inaccurate (46 CFR 541.6)');
      expect(f.explanation).toBe('The invoice lacks or misstates 2 item(s) that 46 CFR 541.6 requires: Digital link (URL or QR code) to the dispute process; Dispute and resolution timeframes. Under 46 CFR 541.5, failure to include required information eliminates the obligation to pay the charge - review whether this applies.');
      expect(f.calculation).toEqual(['46 CFR 541.6(d)(2) Digital link (URL or QR code) to the dispute process: missing.', '46 CFR 541.6(d)(3) Dispute and resolution timeframes: request window of 14 days is shorter than the 30 calendar days required by 46 CFR 541.8(a).', 'Remaining invoice charges = $3910.00.']);
      expect(f.confidence).toBe(0.7);
      expect(f.clause).toEqual(C541_5);
      expect(f.clause?.excerpt).toHaveLength(183);
      expect(f.title, 'a missing item keeps the 541.5 texts').toBe('Required invoice information missing or inaccurate (46 CFR 541.6)');
      expect(f.citations).toEqual([{ source: 'invoice', pointer: '/disputeDigitalMeans', excerpt: '(missing)' }, { source: 'invoice', pointer: '/disputeRequestDays', excerpt: '14' }]);
      break;
    }
    case 'SI-3': {
      const f = byRule(r, 'DD-541-7-LATE');
      expect(f.explanation).toBe('The invoice is dated 2026-04-20. For 1 container(s) it was issued more than 30 calendar days after the charge was last incurred. Such charges may not be payable under 46 CFR 541.7(a) - review.');
      expect(f.calculation).toEqual(['Container SYNU0000001: charge last incurred 2026-03-20; invoice issued 31 days later (limit 30); remaining charge $3910.00.', 'Total = $3910.00.']);
      expect(f.title).toBe('Invoice issued more than 30 days late (46 CFR 541.7)');
      expect(f.clause?.key).toBe('46 CFR 541.7(a)');
      expect(f.clause).toEqual({ source: 'regulation', key: '46 CFR 541.7(a)', label: '46 CFR 541.7(a)', excerpt: oPlain(O_REGULATION['46 CFR 541.7(a)'], 200) });
      expect(f.citations).toEqual([{ source: 'invoice', pointer: '/invoiceDate', excerpt: '2026-04-20' }, { source: 'invoice', pointer: '/containers/0/periods/2/to', excerpt: '2026-03-20' }]);
      break;
    }
    case 'SI-4': {
      const t = byRule(r, 'DD-TARIFF-OVERCHARGE');
      expect(t.title).toBe('Charges exceed the attached tariff');
      expect(t.explanation).toBe("Container SYNU0000001 (40DV, detention): the attached tariff 'Maersk US import detention (2026)' gives $3910.00 for 15 chargeable day(s), but the invoice charges $4200.00.");
      expect(t.calculation).toEqual(['Clock start 2026-03-02 (your evidence); clock stop 2026-03-20 (your evidence).', ...W1_STEP_LIST, 'Invoice charges for this container = $4200.00.', 'Difference = $290.00.']);
      expect(t.confidence).toBe(0.9);
      expect(t.needsHumanReview).toBe(false);
      expect(t.clause).toEqual({ source: 'tariff', key: '/tiers', label: 'Attached tariff', excerpt: 'Maersk US import detention (2026); Maersk US import detention tariff effective 01 Jan 2026' });
      expect(t.citations).toEqual([
        { source: 'invoice', pointer: '/containers/0/periods/0/amount', excerpt: '840.00' }, { source: 'invoice', pointer: '/containers/0/periods/1/amount', excerpt: '1040.00' },
        { source: 'invoice', pointer: '/containers/0/periods/2/amount', excerpt: '2320.00' }, { source: 'invoice', pointer: '/containers/0/evidence/clockStart', excerpt: '2026-03-02' },
        { source: 'invoice', pointer: '/containers/0/evidence/clockStop', excerpt: '2026-03-20' }, { source: 'tariff', pointer: '/tiers', excerpt: oPlain(oCanon(MAERSK.tiers), 200) }]);
      const c = byRule(r, 'DD-541-6-CONTENT');
      expect(c.calculation).toEqual(['46 CFR 541.6(b)(5) End date of free time: Container SYNU0000001 is charged on 2026-03-05, on or before the stated free time end 2026-03-05.', 'Remaining invoice charges = $3910.00.']);
      // review F3: inaccurate items only -> accuracy title/explanation, clause 46 CFR 541.6(b) cut to 197 + '...'
      expect(c.title).toBe('Required invoice information inaccurate (46 CFR 541.6)');
      expect(c.explanation).toBe('The invoice misstates 1 item(s) that 46 CFR 541.6 requires: End date of free time. 46 CFR 541.6 requires this information to be accurate - review whether to dispute the charge.');
      expect(c.clause).toEqual({ source: 'regulation', key: '46 CFR 541.6(b)', label: '46 CFR 541.6(b)', excerpt: oPlain(O_REGULATION['46 CFR 541.6(b)'], 200) });
      expect(c.clause?.excerpt).toHaveLength(200);
      expect(c.clause?.excerpt.endsWith('...')).toBe(true);
      break;
    }
    case 'SI-5': {
      const f = byRule(r, 'DD-PERIOD-ARITH');
      expect(f.title).toBe('Charge line does not match days x rate');
      expect(f.explanation).toBe('Container SYNU0000001: the charge for 2026-03-14 to 2026-03-20 is $2130.00, but 7 day(s) x $290.00 = $2030.00.');
      expect(f.calculation).toEqual(['Container SYNU0000001, 2026-03-14 to 2026-03-20: 7 calendar day(s).', '7 x $290.00 = $2030.00.', 'Charged: $2130.00. Difference = $100.00.']);
      expect(f.clause).toBeNull();
      expect(f.citations).toEqual([{ source: 'invoice', pointer: '/containers/0/periods/2/amount', excerpt: '2130.00' }, { source: 'invoice', pointer: '/containers/0/periods/2/rate', excerpt: '290.00' }]);
      break;
    }
    case 'SI-5b': {
      const f = byRule(r, 'DD-TOTAL-MISMATCH');
      expect(f.title).toBe('Invoice total exceeds the sum of its charges');
      expect(f.explanation).toBe('The invoice total due ($4110.00) is $100.00 more than the sum of its charge lines ($4010.00).');
      expect(f.calculation).toEqual(['Sum of charge lines = $4010.00.', 'Total due on the invoice = $4110.00.', 'Difference = $100.00.']);
      expect(r.findings.map((x) => x.ruleId)).toEqual(['DD-TOTAL-MISMATCH', 'DD-PERIOD-ARITH']);
      expect(f.citations).toEqual([{ source: 'invoice', pointer: '/totalDue', excerpt: '4110.00' }]);
      break;
    }
    case 'SI-6': {
      const t = byRule(r, 'DD-TARIFF-OVERCHARGE');
      expect(t.calculation).toEqual(['Clock start 2026-07-02 (your evidence); clock stop 2026-07-20 (your evidence).', ...W3_STEP_LIST, 'Invoice charges for this container = $2850.00.', 'Difference = $300.00.']);
      expect(t.citations).toContainEqual({ source: 'calendar', pointer: '/closedDates', excerpt: '2026-07-03' });
      expect(t.citations).toContainEqual({ source: 'calendar', pointer: '/shutoutDates', excerpt: '2026-07-14' });
      const f = byRule(r, 'DD-545-RETURN-REFUSED');
      expect(f.title).toBe('Detention charged while empty return was refused (46 CFR 545.5)');
      expect(f.explanation).toBe('Container SYNU0000006: 2 charged day(s) fall on dates when the empty container could not be returned (2026-07-16, 2026-07-17). Under 46 CFR 545.5(c)(2)(ii), "Absent extenuating circumstances, practices and regulations that provide for imposition of detention when it does not serve its incentivizing purposes, such as when empty containers cannot be returned, are likely to be found unreasonable." - review.');
      expect(f.calculation).toEqual(['2026-07-16: $250.00 (tariff tier 2).', '2026-07-17: $300.00 (tariff tier 3).', 'Total = $550.00.']);
      expect(f.confidence).toBe(0.5);
      expect(f.clause?.key).toBe('46 CFR 545.5(c)(2)(ii)');
      expect(f.citations).toEqual([{ source: 'invoice', pointer: '/containers/0/evidence/emptyReturnRefusedDates', excerpt: '2026-07-16, 2026-07-17' }]);
      break;
    }
    case 'SI-6b':
      expect(byRule(r, 'DD-545-RETURN-REFUSED').calculation).toEqual(['2026-07-16: $300.00 (invoice rate).', '2026-07-17: $300.00 (invoice rate).', 'Total = $600.00.']);
      break;
    case 'SI-7': {
      const f = byRule(r, 'DD-545-AVAILABILITY');
      expect(f.title).toBe('Free time started before the cargo was available (46 CFR 545.5)');
      expect(f.explanation).toBe('Container SYNU0000007: free time was counted from 2026-09-04, but the cargo was available on 2026-09-08. Counting from 2026-09-08, the attached tariff gives $1300.00 instead of $1450.00. Whether demurrage relates free time to cargo availability is a factor under 46 CFR 545.5(c)(2)(i) - review.');
      expect(f.calculation).toEqual(['Counted from 2026-09-04: $1450.00.', 'Counted from 2026-09-08: $1300.00.', 'Difference = $150.00.']);
      expect(f.citations).toEqual([{ source: 'invoice', pointer: '/containers/0/evidence/cargoAvailableDate', excerpt: '2026-09-08' }, { source: 'invoice', pointer: '/containers/0/freeTimeStart', excerpt: '2026-09-04' }]);
      expect(f.clause?.key).toBe('46 CFR 545.5(c)(2)(i)');
      break;
    }
    case 'SI-8': {
      const f = byRule(r, 'DD-541-7-LATE');
      expect(f.explanation).toBe('The invoice of this NVOCC is dated 2026-04-27, 33 calendar days after the invoice it received (2026-03-25). An invoice issued after 30 calendar days may not be payable under 46 CFR 541.7(b) - review.');
      expect(f.calculation).toEqual(['Upstream invoice 2026-03-25; this invoice 2026-04-27: 33 days (limit 30).', 'Container SYNU0000001: remaining charge $3910.00.', 'Total = $3910.00.']);
      expect(f.clause?.key).toBe('46 CFR 541.7(b)');
      expect(f.citations).toEqual([{ source: 'invoice', pointer: '/invoiceDate', excerpt: '2026-04-27' }, { source: 'invoice', pointer: '/upstreamInvoiceDate', excerpt: '2026-03-25' }]);
      break;
    }
    case 'SI-8c':
      expect(r.checks.find((c) => c.id === 'issuance')).toEqual({ id: 'issuance', containerIndex: null, status: 'not_evaluated', reason: 'no_upstream_invoice_date' });
      break;
    case 'SI-9b':
      expect(byRule(r, 'DD-541-6-CONTENT').explanation).toContain("requires: Digital link (URL or QR code) to the dispute process; Certification that the billing party's performance did not cause the charges. Under");
      expect(byRule(r, 'DD-541-6-CONTENT').explanation).toContain('lacks or misstates 2 item(s)');
      break;
    case 'SI-10': {
      const f = byRule(r, 'DD-541-6-CONTENT');
      expect(f.explanation).toContain('lacks or misstates 19 item(s)');
      expect(f.calculation).toEqual([
        '46 CFR 541.6(a)(1) Bill of lading number(s): missing.', '46 CFR 541.6(a)(2) Container number(s): missing for Container #2.',
        '46 CFR 541.6(a)(3) Port(s) of discharge: missing.', '46 CFR 541.6(a)(4) Basis for why the billed party is liable: missing.',
        '46 CFR 541.6(b)(1) Invoice date: missing.', '46 CFR 541.6(b)(2) Invoice due date: missing.',
        '46 CFR 541.6(b)(3) Allowed free time in days: missing for Container SYNU0000001, Container #2.',
        '46 CFR 541.6(b)(4) Start date of free time: missing for Container SYNU0000001, Container #2.',
        '46 CFR 541.6(b)(5) End date of free time: missing for Container SYNU0000001, Container #2.',
        '46 CFR 541.6(b)(6) Container availability date: missing for Container SYNU0000001, Container #2.',
        '46 CFR 541.6(b)(8) Specific dates charged: missing for Container #2.', '46 CFR 541.6(c)(1) Total amount due: missing.',
        '46 CFR 541.6(c)(2) Applicable tariff rule or contract: missing.', '46 CFR 541.6(c)(3) Specific rate(s): missing for Container SYNU0000001.',
        '46 CFR 541.6(d)(1) Contact for questions and fee mitigation requests: missing.',
        '46 CFR 541.6(d)(2) Digital link (URL or QR code) to the dispute process: missing.',
        '46 CFR 541.6(d)(3) Dispute and resolution timeframes: request window missing.',
        '46 CFR 541.6(d)(3) Dispute and resolution timeframes: resolution time of 45 days is longer than the 30 calendar days in 46 CFR 541.8(b).',
        '46 CFR 541.6(e)(1) Certification that the charges comply with FMC rules: not stated.',
        "46 CFR 541.6(e)(2) Certification that the billing party's performance did not cause the charges: not stated.",
        'Remaining invoice charges = $3910.00.']);
      break;
    }
    case 'SI-11':
      expect(byRule(r, 'DD-541-6-CONTENT').title).toBe('Required invoice information inaccurate (46 CFR 541.6)');
      expect(byRule(r, 'DD-541-6-CONTENT').explanation).toBe('The invoice misstates 2 item(s) that 46 CFR 541.6 requires: Allowed free time in days; End date of free time. 46 CFR 541.6 requires this information to be accurate - review whether to dispute the charge.');
      expect(byRule(r, 'DD-541-6-CONTENT').clause?.key).toBe('46 CFR 541.6(b)');
      expect(byRule(r, 'DD-541-6-CONTENT').calculation).toEqual(['46 CFR 541.6(b)(3) Allowed free time in days: Container SYNU0000001: stated 5 days, the attached tariff allows 4.', '46 CFR 541.6(b)(5) End date of free time: Container SYNU0000001: stated 2026-03-06, the attached tariff gives 2026-03-05.', 'Remaining invoice charges = $3700.00.']);
      break;
    case 'SI-13': {
      const f = byRule(r, 'DD-541-6-CONTENT');
      expect(f.title).toBe('Required invoice information inaccurate (46 CFR 541.6)');
      expect(f.explanation).toBe('The invoice misstates 1 item(s) that 46 CFR 541.6 requires: Dispute and resolution timeframes. 46 CFR 541.6 requires this information to be accurate - review whether to dispute the charge.');
      expect(f.calculation).toEqual(['46 CFR 541.6(d)(3) Dispute and resolution timeframes: request window of 14 days is shorter than the 30 calendar days required by 46 CFR 541.8(a).', 'Remaining invoice charges = $3910.00.']);
      expect(f.clause).toEqual({ source: 'regulation', key: '46 CFR 541.6(d)', label: '46 CFR 541.6(d)', excerpt: oPlain(O_REGULATION['46 CFR 541.6(d)'], 200) });
      break;
    }
    case 'SI-12':
      expect(byRule(r, 'DD-541-6-CONTENT').calculation).toEqual(['46 CFR 541.6(b)(7) Earliest return date: missing for Container SYNU0000001.', 'Remaining invoice charges = $3910.00.']);
      expect(r.checks.find((c) => c.id === 'tariff')).toEqual({ id: 'tariff', containerIndex: 0, status: 'not_evaluated', reason: 'tariff_mismatch' });
      break;
    default:
      break;
  }
}
function tableValues(id: string, r: OResult): void {
  const e = EXPECT[id];
  if (!e) throw new Error(id);
  expect(r.findings.map((f) => [f.ruleId, f.amount, f.needsHumanReview]), `${id} findings`).toEqual(e.f);
  expect([r.recoverable, r.pendingReview], `${id} totals`).toEqual([e.rec, e.pend]);
  expect(r.recoverableCents + r.pendingReviewCents).toBe(r.findings.reduce((x, f) => x + f.amountCents, 0));
  for (const f of r.findings) {
    expect(f.direction).toBe('overcharge');
    expect(f.amount).toBe(`${Math.floor(f.amountCents / 100)}.${String(f.amountCents % 100).padStart(2, '0')}`);
  }
}
const run = (c: Case) => M.auditDdInvoice(deepFreeze({ invoice: clone(c.invoice), tariff: c.tariff ? clone(c.tariff) : null, calendar: c.calendar ? clone(c.calendar) : null }));

describe('oracle self-check: T3 table and texts (no product code)', () => {
  for (const [id, mk] of Object.entries(CASES)) it(id, () => { const r = oAudit(mk()); tableValues(id, r); exactTexts(id, r); expect(r.rulesVersion).toBe('dd-rules-v1'); });
});

describe('T3 synthetic invoices SI-1..SI-12 (C5)', () => {
  for (const [id, mk] of Object.entries(CASES)) {
    const c = mk();
    it(`${id} (${c.tariff ? c.tariff.name : 'no tariff'}): table values, exact texts, equals the oracle`, () => {
      const r = run(c);
      expect(r.rulesVersion).toBe('dd-rules-v1');
      tableValues(id, r);
      exactTexts(id, r);
      expect(r).toEqual(oAudit(c));
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// DD-R01..R06
// ---------------------------------------------------------------------------------------------------------------
const get = (id: string): Case => {
  const f = CASES[id];
  if (!f) throw new Error(id);
  return f();
};
const ctr0 = (i: OInvoice) => {
  const c = i.containers[0];
  if (!c) throw new Error('no container');
  return c;
};
function rCase(id: string): Case {
  switch (id) {
    case 'R01': {
      const c = get('SI-6');
      Object.assign(ctr0(c.invoice), { periods: [{ from: '2026-07-10', to: '2026-07-12', rate: '200.00', amount: '600.00' }] });
      ctr0(c.invoice).evidence.emptyReturnRefusedDates = ['2026-07-11'];
      c.invoice.totalDue = '600.00';
      return c;
    }
    case 'R02': {
      const c = get('SI-6b');
      Object.assign(ctr0(c.invoice), { periods: [{ from: '2026-07-16', to: '2026-07-17', rate: '300.00', amount: '300.00' }] });
      c.invoice.totalDue = '300.00';
      return c;
    }
    case 'R03': {
      const c = get('SI-6b');
      const p = ctr0(c.invoice).periods[2];
      if (p) p.rate = null;
      return c;
    }
    case 'R04': {
      const c = get('SI-3');
      c.tariff = null;
      const b = clone(ctr0(c.invoice));
      Object.assign(b, {
        containerNumber: 'SYNU0000002', freeTimeStart: '2026-03-07', freeTimeEnd: '2026-03-10',
        periods: [{ from: '2026-03-11', to: '2026-03-14', rate: '210.00', amount: '840.00' }, { from: '2026-03-15', to: '2026-03-18', rate: '260.00', amount: '1040.00' }, { from: '2026-03-19', to: '2026-03-25', rate: '290.00', amount: '2030.00' }],
        evidence: { clockStart: '2026-03-07', clockStop: '2026-03-25', cargoAvailableDate: null, emptyReturnRefusedDates: [] },
      });
      c.invoice.containers.push(b);
      c.invoice.totalDue = '7820.00';
      c.invoice.dueDate = null;
      return c;
    }
    case 'R05': {
      const c = get('SI-4');
      ctr0(c.invoice).evidence.clockStop = '2026-03-05';
      c.invoice.dueDate = null;
      return c;
    }
    case 'R06': {
      const inv = si1();
      inv.invoiceNumber = 'SYN-DD-0066';
      inv.invoiceDate = '2026-09-30';
      inv.dueDate = '2026-10-30';
      const det = ctr0(inv);
      Object.assign(det, { containerNumber: 'SYNU0000101', periods: [{ from: '2026-03-06', to: '2026-03-09', rate: '210.00', amount: '940.00' }] });
      det.evidence = { clockStart: '2026-03-02', clockStop: '2026-03-09', cargoAvailableDate: null, emptyReturnRefusedDates: ['2026-03-07'] };
      const dem = clone(ctr0(get('SI-7').invoice));
      Object.assign(dem, { containerNumber: 'SYNU0000102', periods: [{ from: '2026-09-09', to: '2026-09-15', rate: '80.00', amount: '560.00' }, { from: '2026-09-16', to: '2026-09-22', rate: '150.00', amount: '1050.00' }] });
      inv.containers.push(dem);
      inv.totalDue = '2600.00';
      return { id: 'R06', invoice: inv, tariff: MSC, calendar: MSC_CAL };
    }
    default:
      throw new Error(id);
  }
}

describe('oracle self-check: DD-R01..R06 expectations (no product code)', () => {
  it('R01..R06', () => {
    expect(oAudit(rCase('R01')).findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-545-RETURN-REFUSED', '200.00']]);
    const r2 = byRule(oAudit(rCase('R02')), 'DD-545-RETURN-REFUSED');
    expect([r2.amount, r2.calculation]).toEqual(['300.00', ['2026-07-16: $300.00 (invoice rate).', '2026-07-17: $300.00 (invoice rate).', 'Limited to the remaining charge of $300.00.', 'Total = $300.00.']]);
    expect(byRule(oAudit(rCase('R03')), 'DD-545-RETURN-REFUSED').calculation).toEqual(['2026-07-16: no rate stated on the invoice.', '2026-07-17: no rate stated on the invoice.', 'Total = $0.00.']);
    const r4 = oAudit(rCase('R04'));
    expect(r4.findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-541-7-LATE', '3910.00'], ['DD-541-6-CONTENT', '3910.00']]);
    const r5 = oAudit(rCase('R05'));
    expect(r5.findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-TARIFF-OVERCHARGE', '4200.00'], ['DD-541-6-CONTENT', '0.00']]);
    expect(oAudit(rCase('R06')).findings.map((f) => f.ruleId)).toEqual(['DD-TOTAL-MISMATCH', 'DD-PERIOD-ARITH', 'DD-TARIFF-OVERCHARGE', 'DD-545-RETURN-REFUSED', 'DD-545-AVAILABILITY', 'DD-541-7-LATE', 'DD-541-6-CONTENT']);
  });
});

describe('T3 further rule scenarios DD-R01..R06 (C5)', () => {
  it('DD-R01 RETURN capped by the tariff value; no tariff finding below the tariff', () => {
    const c = rCase('R01');
    const r = run(c);
    expect(r.findings.some((f) => f.ruleId === 'DD-TARIFF-OVERCHARGE')).toBe(false);
    expect(byRule(r, 'DD-545-RETURN-REFUSED').amount).toBe('200.00');
    expect(r).toEqual(oAudit(c));
  });
  it('DD-R02 cap line when V exceeds the remaining charge', () => {
    const c = rCase('R02');
    const f = byRule(run(c), 'DD-545-RETURN-REFUSED');
    expect(f.amount).toBe('300.00');
    expect(f.calculation).toContain('Limited to the remaining charge of $300.00.');
    expect(run(c)).toEqual(oAudit(c));
  });
  it('DD-R03 rate-less period: "no rate stated on the invoice", value 0', () => {
    const c = rCase('R03');
    const f = byRule(run(c), 'DD-545-RETURN-REFUSED');
    expect(f.calculation).toContain('2026-07-16: no rate stated on the invoice.');
    expect(f.amountCents).toBe(0);
    expect(run(c)).toEqual(oAudit(c));
  });
  it('DD-R04 two containers, one late: LATE takes only that container; the other goes to CONTENT', () => {
    const c = rCase('R04');
    const r = run(c);
    expect(r.findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-541-7-LATE', '3910.00'], ['DD-541-6-CONTENT', '3910.00']]);
    expect(byRule(r, 'DD-541-7-LATE').explanation).toContain('For 1 container(s)');
    expect(r).toEqual(oAudit(c));
  });
  it('DD-R05 zero-amount CONTENT is still produced', () => {
    const c = rCase('R05');
    const r = run(c);
    expect(r.findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-TARIFF-OVERCHARGE', '4200.00'], ['DD-541-6-CONTENT', '0.00']]);
    expect(r).toEqual(oAudit(c));
  });
  it('DD-R06 all seven rules in DD_RULE_IDS order', () => {
    const c = rCase('R06');
    const r = run(c);
    expect(r.findings.map((f) => f.ruleId)).toEqual([...M.DD_RULE_IDS]);
    expect(r).toEqual(oAudit(c));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T4 checks
// ---------------------------------------------------------------------------------------------------------------
const chk = (r: OResult, id: string, i: number | null = null) => {
  const c = r.checks.find((x) => x.id === id && x.containerIndex === i);
  if (!c) throw new Error(`no check ${id} ${String(i)}`);
  return [c.status, c.reason];
};
describe('T4 checks and container summaries (C6)', () => {
  it('DD-C01 SI-1', () => {
    const r = run(get('SI-1'));
    for (const id of ['part541', 'content', 'issuance', 'total', 'line_arithmetic']) expect(chk(r, id), id).toEqual(['ok', null]);
    expect(chk(r, 'tariff', 0)).toEqual(['ok', null]);
    expect(chk(r, 'availability', 0)).toEqual(['not_applicable', 'not_import_demurrage']);
    expect(chk(r, 'return_refused', 0)).toEqual(['not_evaluated', 'no_evidence']);
    expect(r.containers).toEqual([{ index: 0, label: 'Container SYNU0000001', chargeType: 'DETENTION', sizeType: '40DV', chargedCents: 391000, expectedCents: 391000, freeTimeEnd: '2026-03-05', chargeableDays: 15 }]);
  });
  it('DD-C02 SI-9 (before 2024-05-28, no tariff)', () => {
    const r = run(get('SI-9'));
    for (const id of ['part541', 'content', 'issuance']) expect(chk(r, id), id).toEqual(['not_applicable', 'before_effective_date']);
    expect(chk(r, 'tariff', 0)).toEqual(['not_evaluated', 'no_tariff']);
    expect(r.containers[0]).toMatchObject({ expectedCents: null, freeTimeEnd: null, chargeableDays: null });
  });
  it('DD-C03 SI-10', () => {
    const r = run(get('SI-10'));
    expect(chk(r, 'part541')).toEqual(['not_evaluated', 'no_invoice_date']);
    expect(chk(r, 'issuance')).toEqual(['not_evaluated', 'no_invoice_date']);
    expect(chk(r, 'total')).toEqual(['not_evaluated', 'no_total']);
    expect(chk(r, 'tariff', 1)).toEqual(['not_evaluated', 'no_tariff']);
    expect(r.containers.map((c) => c.label)).toEqual(['Container SYNU0000001', 'Container #2']);
  });
  it('DD-C03b (review F7) an NVOCC invoice without any periods is evaluated under 541.7(b), never no_charge_dates', () => {
    const c = get('SI-8');
    ctr0(c.invoice).periods = [];
    const r = run(c);
    expect(chk(r, 'issuance')).toEqual(['finding', null]);
    expect(r).toEqual(oAudit(c));
    const ok = get('SI-8b');
    ctr0(ok.invoice).periods = [];
    expect(chk(run(ok), 'issuance')).toEqual(['ok', null]);
    const nonNvocc = get('SI-1');
    ctr0(nonNvocc.invoice).periods = [];
    expect(chk(run(nonNvocc), 'issuance')).toEqual(['not_evaluated', 'no_charge_dates']);
  });
  it('DD-C04 tariff reasons', () => {
    const variants: [string, (c: Case) => void, string][] = [
      ['size 20RE', (c) => { ctr0(c.invoice).sizeType = '20RE'; }, 'size_not_in_tariff'],
      ['no clock start and no freeTimeStart', (c) => { ctr0(c.invoice).evidence.clockStart = null; ctr0(c.invoice).freeTimeStart = null; }, 'no_dates'],
      ['E0 (last charged date) before freeTimeStart', (c) => { Object.assign(ctr0(c.invoice), { freeTimeStart: '2026-03-25' }); ctr0(c.invoice).evidence = { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: [] }; }, 'invalid_dates'],
      ['MSC on a DETENTION container', (c) => { c.tariff = MSC; }, 'tariff_mismatch'],
    ];
    for (const [label, f, reason] of variants) {
      const c = get('SI-1');
      f(c);
      const r = run(c);
      expect(chk(r, 'tariff', 0), label).toEqual(['not_evaluated', reason]);
      expect(r, label).toEqual(oAudit(c));
    }
  });
  it('DD-C05 availability and return_refused statuses', () => {
    expect(chk(run(get('SI-7')), 'availability', 0)).toEqual(['finding', null]);
    const same = get('SI-7');
    ctr0(same.invoice).evidence.cargoAvailableDate = '2026-09-04';
    expect(chk(run(same), 'availability', 0)).toEqual(['ok', null]);
    const none = get('SI-7');
    ctr0(none.invoice).evidence.cargoAvailableDate = null;
    expect(chk(run(none), 'availability', 0)).toEqual(['not_evaluated', 'no_evidence']);
    expect(chk(run(get('SI-7')), 'return_refused', 0)).toEqual(['not_applicable', 'not_detention']);
    expect(chk(run(get('SI-6')), 'return_refused', 0)).toEqual(['finding', null]);
  });
  it('DD-C06 order and length: 5 invoice-level checks then 3 per container', () => {
    for (const id of ['SI-1', 'SI-10']) {
      const c = get(id);
      const r = run(c);
      const n = c.invoice.containers.length;
      expect(r.checks.map((x) => [x.id, x.containerIndex])).toEqual([
        ['part541', null], ['content', null], ['issuance', null], ['total', null], ['line_arithmetic', null],
        ...Array.from({ length: n }, (_, i) => [['tariff', i], ['availability', i], ['return_refused', i]]).flat()]);
    }
    const r6 = run(rCase('R06'));
    expect(r6.checks).toHaveLength(5 + 3 * 2);
    expect(r6.containers.map((c) => c.index)).toEqual([0, 1]);
  });
  it('HAPAG calendar fixture sanity (closed 07-03, shutout 07-14)', () => {
    expect(HAPAG_CAL).toEqual({ name: 'Synthetic terminal A 2026', closedDates: ['2026-07-03'], shutoutDates: ['2026-07-14'] });
  });
});
