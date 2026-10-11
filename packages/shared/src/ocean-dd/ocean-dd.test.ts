import { describe, expect, it } from 'vitest';

import * as root from '../index.js';
import { DdCalendarData, DdInvoiceBody, DdInvoiceData, DdTariffData, type DdCalendarDataDto, type DdInvoiceDataDto, type DdTariffDataDto } from '../ocean-dd-dto.js';

import {
  DD_CHECK_LABELS,
  DD_CSV_COLUMNS,
  DD_REGULATION_TEXT,
  DD_RULE_IDS,
  DD_SOURCE_FILES,
  DD_TARIFF_PRESETS,
  auditDdInvoice,
  buildDdDisputeLetter,
  computeFreeTimeEnd,
  computeTariffCharge,
  ddAddDays,
  ddDateFromDayNumber,
  ddDayNumber,
  ddDaysBetween,
  ddIsoWeekday,
  isDdDate,
  parseDdCsv,
} from './index.js';

const preset = (id: string): DdTariffDataDto => {
  const p = DD_TARIFF_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return DdTariffData.parse(p.data);
};
const MAERSK = preset('maersk-us-import-detention-2026');
const MSC = preset('msc-us-import-demurrage');
const HAPAG = preset('hapag-lloyd-us-import-detention-mh-2025');
const CMA = preset('cma-cgm-us-import-demurrage-standard');
const cal = (closedDates: string[], shutoutDates: string[] = []): DdCalendarDataDto => DdCalendarData.parse({ name: 'Terminal', closedDates, shutoutDates });

const charge = (start: string, stop: string, sizeType: string, tariff: DdTariffDataDto, calendar: DdCalendarDataDto | null = null) =>
  computeTariffCharge({ start, stop, sizeType, tariff, calendar });

type ContainerIn = Record<string, unknown>;

/** A complete, Part-541-clean invoice (synthetic); overrides on the invoice and its first container. */
function invoice(over: Record<string, unknown> = {}, container: ContainerIn = {}, extra: ContainerIn[] = []): DdInvoiceDataDto {
  const base = {
    invoiceNumber: 'SYN-DD-0001',
    billingPartyName: 'Synthetic Ocean Line',
    billingPartyType: 'OCEAN_CARRIER',
    billedPartyName: 'Example Importer LLC',
    direction: 'IMPORT',
    invoiceDate: '2026-03-25',
    dueDate: '2026-04-24',
    upstreamInvoiceDate: null,
    billOfLadingNumbers: ['SYNBL0001'],
    portOfDischarge: 'Port of Example',
    liabilityBasis: 'Consignee named on the bill of lading',
    totalDue: '4350.00',
    ruleReference: 'Synthetic tariff rule 1',
    disputeContact: 'disputes@example.test',
    disputeDigitalMeans: 'https://example.test/dd-disputes',
    disputeRequestDays: 30,
    disputeResolutionDays: 30,
    certifiesFmcRules: true,
    certifiesPerformance: true,
    containers: [
      {
        containerNumber: 'SYNU0000001',
        sizeType: '40DV',
        chargeType: 'DETENTION',
        freeDays: 4,
        freeTimeStart: '2026-03-02',
        freeTimeEnd: '2026-03-05',
        availabilityDate: '2026-03-01',
        earliestReturnDate: null,
        periods: [{ from: '2026-03-06', to: '2026-03-20', rate: '290', amount: '4350' }],
        evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: [] },
        ...container,
      },
      ...extra,
    ],
    ...over,
  };
  return DdInvoiceData.parse(base);
}

describe('dates (C2)', () => {
  it('day numbers, inverse, weekday and range', () => {
    expect(ddDayNumber('2000-01-01')).toBe(10957);
    expect(ddDayNumber('2026-03-02')).toBe(20514);
    for (const d of ['2000-01-01', '2000-02-29', '2024-02-29', '2026-12-31', '2099-12-31']) expect(ddDateFromDayNumber(ddDayNumber(d))).toBe(d);
    expect(ddIsoWeekday('2026-03-02')).toBe(1);
    expect(ddIsoWeekday('2026-03-08')).toBe(7);
    expect(ddIsoWeekday('2026-05-25')).toBe(1);
    expect(ddIsoWeekday('2026-07-02')).toBe(4);
    expect(ddAddDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(ddAddDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(ddDaysBetween('2026-03-02', '2026-03-20')).toBe(18);
  });

  it('refuses invalid dates with RangeError', () => {
    for (const bad of ['2026-02-29', '2100-02-29', '1900-02-29', '2026-13-01', '2026-2-01', '1999-12-31', '2100-01-01', ' 2026-01-01', '2026-01-01T00:00']) {
      expect(isDdDate(bad)).toBe(false);
      expect(() => ddDayNumber(bad)).toThrow(RangeError);
    }
    expect(isDdDate('2000-02-29')).toBe(true);
    expect(() => ddAddDays('2099-12-31', 1)).toThrow(RangeError);
    expect(() => ddAddDays('2000-01-01', -1)).toThrow(RangeError);
    expect(() => ddDateFromDayNumber(10956)).toThrow(RangeError);
    expect(() => ddAddDays('2026-01-01', 0.5)).toThrow(RangeError);
  });
});

describe('free time and tariff charge (C3) - worked examples from public tariffs', () => {
  it('Maersk 40DV gate-out 2026-03-02, return 2026-03-20 = $3910.00', () => {
    const r = charge('2026-03-02', '2026-03-20', '40DV', MAERSK);
    expect(r.freeTimeEnd).toBe('2026-03-05');
    expect(r.chargeableDays).toBe(15);
    expect(r.amountCents).toBe(391000);
    expect(r.amount).toBe('3910.00');
    expect(r.steps).toEqual([
      'Free time: 4 working day(s) counted from 2026-03-02 (start day included), ending 2026-03-05.',
      'Chargeable calendar days from 2026-03-06 to 2026-03-20: 15.',
      'Tier 1: 4 day(s) x $210.00 = $840.00.',
      'Tier 2: 4 day(s) x $260.00 = $1040.00.',
      'Tier 3: 7 day(s) x $290.00 = $2030.00.',
      'Tariff charge = $3910.00.',
    ]);
    expect(r.chargeableDates[0]).toEqual({ date: '2026-03-06', tier: 1, rateCents: 21000 });
    expect(r.chargeableDates[14]).toEqual({ date: '2026-03-20', tier: 3, rateCents: 29000 });
  });

  it('Maersk with Memorial Day closed = $1360.00', () => {
    const r = charge('2026-05-22', '2026-06-02', '40DV', MAERSK, cal(['2026-05-25']));
    expect(r.freeTimeEnd).toBe('2026-05-27');
    expect(r.amount).toBe('1360.00');
    expect(r.steps[1]).toBe('Closed or shutout dates not counted as free time: 2026-05-25.');
  });

  it('Hapag-Lloyd 40HC DOI 2026-07-02, closed 07-03, shutout 07-14 = $2550.00 ($2850.00 without the shutout)', () => {
    const r = charge('2026-07-02', '2026-07-20', '40HC', HAPAG, cal(['2026-07-03'], ['2026-07-14']));
    expect(r.freeTimeEnd).toBe('2026-07-09');
    expect(r.chargeableDays).toBe(10);
    expect(r.amount).toBe('2550.00');
    expect(r.steps).toEqual([
      'Free time: start day 2026-07-02 plus 4 working day(s), ending 2026-07-09.',
      'Closed or shutout dates not counted as free time: 2026-07-03.',
      'Chargeable calendar days from 2026-07-10 to 2026-07-20: 10.',
      'Closed or shutout dates not charged: 2026-07-14.',
      'Tier 1: 3 day(s) x $200.00 = $600.00.',
      'Tier 2: 3 day(s) x $250.00 = $750.00.',
      'Tier 3: 4 day(s) x $300.00 = $1200.00.',
      'Tariff charge = $2550.00.',
    ]);
    expect(charge('2026-07-02', '2026-07-20', '40HC', HAPAG, cal(['2026-07-03'])).amount).toBe('2850.00');
  });

  it('MSC Labor Day start: 40DV $1300.00, 20DV $1045.00, from 2026-09-04 $1450.00', () => {
    const c = cal(['2026-09-07']);
    const r = charge('2026-09-07', '2026-09-22', '40DV', MSC, c);
    expect(r.freeTimeEnd).toBe('2026-09-11');
    expect(r.chargeableDays).toBe(11);
    expect(r.amount).toBe('1300.00');
    expect(charge('2026-09-07', '2026-09-22', '20DV', MSC, c).amount).toBe('1045.00');
    expect(charge('2026-09-04', '2026-09-22', '40DV', MSC, c).amount).toBe('1450.00');
  });

  it('CMA CGM 40DV 2026-02-02..2026-02-20 = $5225.00 (secondary-source rates)', () => {
    const r = charge('2026-02-02', '2026-02-20', '40DV', CMA);
    expect(r.freeTimeEnd).toBe('2026-02-05');
    expect(r.amount).toBe('5225.00');
    expect(DD_TARIFF_PRESETS.find((p) => p.id === 'cma-cgm-us-import-demurrage-standard')?.provenance.verification).toBe('secondary');
  });

  it('within free time, N = 0, start-day rules and bases', () => {
    const within = charge('2026-03-02', '2026-03-05', '40DV', MAERSK);
    expect(within.amountCents).toBe(0);
    expect(within.steps).toEqual(['Free time: 4 working day(s) counted from 2026-03-02 (start day included), ending 2026-03-05.', 'Clock stopped 2026-03-05, within free time. No charge.']);
    expect(charge('2026-03-02', '2026-03-06', '40DV', MAERSK).amount).toBe('210.00');
    // Sunday start under Mon-Sat working days: Sunday does not count.
    expect(computeFreeTimeEnd('2026-03-01', MAERSK, null)).toBe('2026-03-05');
    // Hapag-Lloyd Saturday interchange: +4 working days Mon-Thu.
    expect(computeFreeTimeEnd('2026-07-04', HAPAG, null)).toBe('2026-07-09');
    const n0i = { ...MAERSK, freeDays: 0 };
    const n0a = { ...HAPAG, freeDays: 0 };
    expect(computeFreeTimeEnd('2026-03-02', n0i, null)).toBe('2026-03-01');
    expect(computeFreeTimeEnd('2026-03-02', n0a, null)).toBe('2026-03-02');
    expect(charge('2026-03-02', '2026-03-04', '40DV', n0i).chargeableDays).toBe(3);
    expect(charge('2026-03-02', '2026-03-04', '40DV', n0a).chargeableDays).toBe(2);
    // Working charge basis: closed working day not charged and listed.
    const wk = { ...MAERSK, chargeDayBasis: 'working' as const, workingWeekdays: [1, 2, 3, 4, 5] };
    const w = charge('2026-03-02', '2026-03-16', '40DV', wk, cal(['2026-03-09']));
    expect(w.freeTimeEnd).toBe('2026-03-05');
    expect(w.chargeableDays).toBe(6);
    expect(w.steps).toContain('Closed or shutout dates not charged: 2026-03-09.');
    // Calendar free-time basis: only shutouts are skipped.
    const cf = { ...MAERSK, freeDayBasis: 'calendar' as const };
    expect(computeFreeTimeEnd('2026-03-02', cf, cal([], ['2026-03-03']))).toBe('2026-03-06');
  });

  it('throws RangeError for bad spans, missing sizes and an unbounded free time', () => {
    expect(() => charge('2026-03-20', '2026-03-02', '40DV', MAERSK)).toThrow(RangeError);
    expect(() => charge('2026-01-01', '2028-01-02', '40DV', MAERSK)).toThrow(RangeError);
    expect(() => charge('2026-02-02', '2026-02-20', '20DV', CMA)).toThrow(RangeError);
    expect(() => computeFreeTimeEnd('2099-12-20', { ...MAERSK, freeDays: 60 }, null)).toThrow(RangeError);
  });

  it('long date lists print the first 10 and "and m more"', () => {
    const closed = Array.from({ length: 12 }, (_, k) => ddAddDays('2026-03-03', k));
    const wk = { ...MAERSK, chargeDayBasis: 'working' as const, freeDays: 1 };
    const r = charge('2026-03-02', '2026-03-20', '40DV', wk, cal(closed));
    expect(r.steps.some((s) => s.startsWith('Closed or shutout dates not charged: 2026-03-03, ') && s.endsWith(', and 2 more.'))).toBe(true);
  });
});

describe('auditDdInvoice (C5, C6) - synthetic invoices', () => {
  it('clean invoice with an overcharge against the Maersk tariff: TARIFF $440.00 confirmed', () => {
    const r = auditDdInvoice({ invoice: invoice(), tariff: MAERSK, calendar: null });
    expect(r.findings.map((f) => f.ruleId)).toEqual(['DD-TARIFF-OVERCHARGE']);
    const f = r.findings[0];
    expect(f?.amount).toBe('440.00');
    expect(f?.needsHumanReview).toBe(false);
    expect(f?.confidence).toBe(0.9);
    expect(f?.explanation).toBe("Container SYNU0000001 (40DV, detention): the attached tariff 'Maersk US import detention (2026)' gives $3910.00 for 15 chargeable day(s), but the invoice charges $4350.00.");
    expect(f?.calculation[0]).toBe('Clock start 2026-03-02 (invoice free time start); clock stop 2026-03-20 (last charged date on the invoice).');
    expect(f?.calculation.slice(-2)).toEqual(['Invoice charges for this container = $4350.00.', 'Difference = $440.00.']);
    expect(f?.citations.map((c) => `${c.source}${c.pointer}`)).toEqual(['invoice/containers/0/periods/0/amount', 'invoice/containers/0/freeTimeStart', 'tariff/tiers']);
    expect(f?.citations[0]?.excerpt).toBe('4350.00');
    expect(f?.clause).toEqual({ source: 'tariff', key: '/tiers', label: 'Attached tariff', excerpt: 'Maersk US import detention (2026); Maersk US import detention tariff effective 01 Jan 2026' });
    expect(r.recoverable).toBe('440.00');
    expect(r.pendingReview).toBe('0.00');
    expect(r.checks.map((c) => `${c.id}:${c.containerIndex ?? '-'}:${c.status}:${c.reason ?? ''}`)).toEqual([
      'part541:-:ok:',
      'content:-:ok:',
      'issuance:-:ok:',
      'total:-:ok:',
      'line_arithmetic:-:ok:',
      'tariff:0:finding:',
      'availability:0:not_applicable:not_import_demurrage',
      'return_refused:0:not_evaluated:no_evidence',
    ]);
    expect(r.containers).toEqual([{ index: 0, label: 'Container SYNU0000001', chargeType: 'DETENTION', sizeType: '40DV', chargedCents: 435000, expectedCents: 391000, freeTimeEnd: '2026-03-05', chargeableDays: 15 }]);
  });

  it('TOTAL and PERIOD arithmetic', () => {
    const inv = invoice({ totalDue: '4500.00' }, { periods: [{ from: '2026-03-06', to: '2026-03-20', rate: '250', amount: '4350' }] });
    const r = auditDdInvoice({ invoice: inv, tariff: null, calendar: null });
    expect(r.findings.map((f) => [f.ruleId, f.amount])).toEqual([
      ['DD-TOTAL-MISMATCH', '150.00'],
      ['DD-PERIOD-ARITH', '600.00'],
    ]);
    expect(r.findings[0]?.explanation).toBe('The invoice total due ($4500.00) is $150.00 more than the sum of its charge lines ($4350.00).');
    expect(r.findings[1]?.calculation).toEqual(['Container SYNU0000001, 2026-03-06 to 2026-03-20: 15 calendar day(s).', '15 x $250.00 = $3750.00.', 'Charged: $4350.00. Difference = $600.00.']);
    expect(r.findings[1]?.citations.map((c) => c.pointer)).toEqual(['/containers/0/periods/0/amount', '/containers/0/periods/0/rate']);
    expect(r.checks.find((c) => c.id === 'tariff')).toEqual({ id: 'tariff', containerIndex: 0, status: 'not_evaluated', reason: 'no_tariff' });
    expect(r.recoverableCents).toBe(75000);
  });

  it('RETURN refused (Hapag-Lloyd): tariff-tier values, capped at the remaining charge', () => {
    const inv = invoice(
      { totalDue: '3300.00', invoiceDate: '2026-07-25', dueDate: '2026-08-24' },
      {
        sizeType: '40HC',
        freeTimeStart: '2026-07-02',
        freeTimeEnd: '2026-07-09',
        availabilityDate: '2026-07-01',
        periods: [{ from: '2026-07-10', to: '2026-07-20', rate: '300', amount: '3300' }],
        evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: ['2026-07-16', '2026-07-15', '2026-07-30'] },
      },
    );
    const r = auditDdInvoice({ invoice: inv, tariff: HAPAG, calendar: cal(['2026-07-03'], ['2026-07-14']) });
    expect(r.findings.map((f) => [f.ruleId, f.amount, f.needsHumanReview])).toEqual([
      ['DD-TARIFF-OVERCHARGE', '750.00', false],
      ['DD-545-RETURN-REFUSED', '500.00', true],
    ]);
    const ret = r.findings[1];
    expect(ret?.calculation).toEqual(['2026-07-15: $250.00 (tariff tier 2).', '2026-07-16: $250.00 (tariff tier 2).', 'Total = $500.00.']);
    expect(ret?.explanation.startsWith('Container SYNU0000001: 2 charged day(s) fall on dates when the empty container could not be returned (2026-07-15, 2026-07-16).')).toBe(true);
    expect(ret?.clause?.key).toBe('46 CFR 545.5(c)(2)(ii)');
    expect(ret?.citations).toEqual([{ source: 'invoice', pointer: '/containers/0/evidence/emptyReturnRefusedDates', excerpt: '2026-07-15, 2026-07-16, 2026-07-30' }]);
    expect(r.findings[0]?.citations.map((c) => `${c.source}${c.pointer}`)).toContain('calendar/shutoutDates');
  });

  it('RETURN without a tariff uses invoice rates and the cap', () => {
    const inv = invoice({}, { periods: [{ from: '2026-03-06', to: '2026-03-20', rate: null, amount: '100' }], evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: ['2026-03-07'] } });
    const r = auditDdInvoice({ invoice: inv, tariff: null, calendar: null });
    const ret = r.findings.find((f) => f.ruleId === 'DD-545-RETURN-REFUSED');
    expect(ret?.amount).toBe('0.00');
    expect(ret?.calculation).toEqual(['2026-03-07: no rate stated on the invoice.', 'Total = $0.00.']);
  });

  it('AVAILABILITY (MSC demurrage from 2026-09-04, cargo available 2026-09-07): $150.00 for review', () => {
    const inv = invoice(
      { totalDue: '1450.00', invoiceDate: '2026-09-30', dueDate: '2026-10-30' },
      {
        chargeType: 'DEMURRAGE',
        freeTimeStart: '2026-09-04',
        freeTimeEnd: '2026-09-10',
        availabilityDate: '2026-09-04',
        periods: [
          { from: '2026-09-16', to: '2026-09-22', rate: '150', amount: '1050' },
          { from: '2026-09-11', to: '2026-09-15', rate: '80', amount: '400' },
        ],
        evidence: { clockStart: null, clockStop: null, cargoAvailableDate: '2026-09-07', emptyReturnRefusedDates: [] },
      },
    );
    expect(inv.containers[0]?.periods[0]?.from).toBe('2026-09-11');
    const r = auditDdInvoice({ invoice: inv, tariff: MSC, calendar: cal(['2026-09-07']) });
    expect(r.findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-545-AVAILABILITY', '150.00']]);
    expect(r.findings[0]?.calculation).toEqual(['Counted from 2026-09-04: $1450.00.', 'Counted from 2026-09-07: $1300.00.', 'Difference = $150.00.']);
    expect(r.findings[0]?.citations.map((c) => c.pointer)).toEqual(['/containers/0/evidence/cargoAvailableDate', '/containers/0/freeTimeStart']);
    expect(r.checks.find((c) => c.id === 'availability')?.status).toBe('finding');
    expect(r.checks.find((c) => c.id === 'return_refused')?.reason).toBe('not_detention');
  });

  it('LATE 541.7(a): 36 days after the last charged date; remaining charge after TARIFF', () => {
    const r = auditDdInvoice({ invoice: invoice({ invoiceDate: '2026-04-25', dueDate: '2026-05-25' }), tariff: MAERSK, calendar: null });
    expect(r.findings.map((f) => [f.ruleId, f.amount])).toEqual([
      ['DD-TARIFF-OVERCHARGE', '440.00'],
      ['DD-541-7-LATE', '3910.00'],
    ]);
    const late = r.findings[1];
    expect(late?.explanation).toBe('The invoice is dated 2026-04-25. For 1 container(s) it was issued more than 30 calendar days after the charge was last incurred. Such charges may not be payable under 46 CFR 541.7(a) - review.');
    expect(late?.calculation).toEqual(['Container SYNU0000001: charge last incurred 2026-03-20; invoice issued 36 days later (limit 30); remaining charge $3910.00.', 'Total = $3910.00.']);
    expect(late?.citations.map((c) => c.pointer)).toEqual(['/invoiceDate', '/containers/0/periods/0/to']);
    expect(late?.clause?.key).toBe('46 CFR 541.7(a)');
    // exactly 30 days is on time
    const onTime = auditDdInvoice({ invoice: invoice({ invoiceDate: '2026-04-19' }), tariff: null, calendar: null });
    expect(onTime.findings).toEqual([]);
  });

  it('LATE 541.7(b) for an NVOCC', () => {
    const r = auditDdInvoice({ invoice: invoice({ billingPartyType: 'NVOCC', upstreamInvoiceDate: '2026-03-01', invoiceDate: '2026-04-15' }), tariff: null, calendar: null });
    expect(r.findings.map((f) => [f.ruleId, f.amount])).toEqual([['DD-541-7-LATE', '4350.00']]);
    expect(r.findings[0]?.calculation).toEqual(['Upstream invoice 2026-03-01; this invoice 2026-04-15: 45 days (limit 30).', 'Container SYNU0000001: remaining charge $4350.00.', 'Total = $4350.00.']);
    expect(r.findings[0]?.clause?.key).toBe('46 CFR 541.7(b)');
    const noUp = auditDdInvoice({ invoice: invoice({ billingPartyType: 'NVOCC' }), tariff: null, calendar: null });
    expect(noUp.checks.find((c) => c.id === 'issuance')).toMatchObject({ status: 'not_evaluated', reason: 'no_upstream_invoice_date' });
  });

  it('CONTENT 541.6: issues in table order, distinct labels, remaining charge', () => {
    const inv = invoice(
      {
        billOfLadingNumbers: [],
        portOfDischarge: null,
        liabilityBasis: null,
        invoiceDate: null,
        dueDate: null,
        totalDue: null,
        ruleReference: null,
        disputeContact: null,
        disputeDigitalMeans: null,
        disputeRequestDays: 10,
        disputeResolutionDays: null,
        certifiesFmcRules: false,
        certifiesPerformance: false,
      },
      { containerNumber: null, freeDays: 5, freeTimeEnd: '2026-03-06', availabilityDate: null, periods: [{ from: '2026-03-06', to: '2026-03-20', rate: null, amount: '4350' }] },
      [{ containerNumber: 'SYNU0000002', sizeType: '20DV', chargeType: 'DETENTION', freeDays: null, freeTimeStart: null, freeTimeEnd: null, availabilityDate: '2026-03-01', earliestReturnDate: null, periods: [], evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: [] } }],
    );
    const r = auditDdInvoice({ invoice: inv, tariff: MAERSK, calendar: null });
    expect(r.findings.map((f) => f.ruleId)).toEqual(['DD-TARIFF-OVERCHARGE', 'DD-541-6-CONTENT']);
    const c = r.findings[1];
    expect(c?.calculation).toEqual([
      '46 CFR 541.6(a)(1) Bill of lading number(s): missing.',
      '46 CFR 541.6(a)(2) Container number(s): missing for Container #1.',
      '46 CFR 541.6(a)(3) Port(s) of discharge: missing.',
      '46 CFR 541.6(a)(4) Basis for why the billed party is liable: missing.',
      '46 CFR 541.6(b)(1) Invoice date: missing.',
      '46 CFR 541.6(b)(2) Invoice due date: missing.',
      '46 CFR 541.6(b)(3) Allowed free time in days: missing for Container SYNU0000002.',
      '46 CFR 541.6(b)(3) Allowed free time in days: Container #1: stated 5 days, the attached tariff allows 4.',
      '46 CFR 541.6(b)(4) Start date of free time: missing for Container SYNU0000002.',
      '46 CFR 541.6(b)(5) End date of free time: missing for Container SYNU0000002.',
      '46 CFR 541.6(b)(5) End date of free time: Container #1 is charged on 2026-03-06, on or before the stated free time end 2026-03-06.',
      '46 CFR 541.6(b)(5) End date of free time: Container #1: stated 2026-03-06, the attached tariff gives 2026-03-05.',
      '46 CFR 541.6(b)(6) Container availability date: missing for Container #1.',
      '46 CFR 541.6(b)(8) Specific dates charged: missing for Container SYNU0000002.',
      '46 CFR 541.6(c)(1) Total amount due: missing.',
      '46 CFR 541.6(c)(2) Applicable tariff rule or contract: missing.',
      '46 CFR 541.6(c)(3) Specific rate(s): missing for Container #1.',
      '46 CFR 541.6(d)(1) Contact for questions and fee mitigation requests: missing.',
      '46 CFR 541.6(d)(2) Digital link (URL or QR code) to the dispute process: missing.',
      '46 CFR 541.6(d)(3) Dispute and resolution timeframes: resolution time missing.',
      '46 CFR 541.6(d)(3) Dispute and resolution timeframes: request window of 10 days is shorter than the 30 calendar days required by 46 CFR 541.8(a).',
      '46 CFR 541.6(e)(1) Certification that the charges comply with FMC rules: not stated.',
      "46 CFR 541.6(e)(2) Certification that the billing party's performance did not cause the charges: not stated.",
      'Remaining invoice charges = $3910.00.',
    ]);
    expect(c?.explanation.startsWith('The invoice lacks or misstates 19 item(s) that 46 CFR 541.6 requires: Bill of lading number(s); Container number(s);')).toBe(true);
    expect(c?.amount).toBe('3910.00');
    expect(c?.clause).toEqual({ source: 'regulation', key: '46 CFR 541.5', label: '46 CFR 541.5', excerpt: DD_REGULATION_TEXT['46 CFR 541.5'] });
    const pointers = c?.citations.map((x) => x.pointer) ?? [];
    expect(pointers.slice(0, 3)).toEqual(['/billOfLadingNumbers', '/containers/0/containerNumber', '/portOfDischarge']);
    expect(new Set(pointers).size).toBe(pointers.length);
    expect(c?.citations[0]?.excerpt).toBe('(none)');
    expect(c?.citations.find((x) => x.pointer === '/certifiesFmcRules')?.excerpt).toBe('no');
    expect(c?.citations.find((x) => x.pointer === '/containers/1/periods')?.excerpt).toBe('(none)');
    expect(r.checks.find((x) => x.id === 'part541')).toMatchObject({ status: 'not_evaluated', reason: 'no_invoice_date' });
    expect(r.checks.find((x) => x.id === 'total')).toMatchObject({ status: 'not_evaluated', reason: 'no_total' });
    expect(r.checks.filter((x) => x.id === 'tariff').map((x) => x.reason)).toEqual([null, 'no_dates']);
    // C6 order: invoice-level checks, then each container's checks grouped, in container order.
    expect(r.checks.map((x) => `${x.id}:${x.containerIndex ?? '-'}`)).toEqual([
      'part541:-',
      'content:-',
      'issuance:-',
      'total:-',
      'line_arithmetic:-',
      'tariff:0',
      'availability:0',
      'return_refused:0',
      'tariff:1',
      'availability:1',
      'return_refused:1',
    ]);
  });

  it('Part 541 does not apply before 2024-05-28', () => {
    const r = auditDdInvoice({ invoice: invoice({ invoiceDate: '2024-05-27', ruleReference: null }, { periods: [{ from: '2024-03-06', to: '2024-03-20', rate: '290', amount: '4350' }], freeTimeStart: '2024-03-01', freeTimeEnd: '2024-03-05' }), tariff: null, calendar: null });
    expect(r.findings).toEqual([]);
    expect(r.checks.slice(0, 3)).toEqual([
      { id: 'part541', containerIndex: null, status: 'not_applicable', reason: 'before_effective_date' },
      { id: 'content', containerIndex: null, status: 'not_applicable', reason: 'before_effective_date' },
      { id: 'issuance', containerIndex: null, status: 'not_applicable', reason: 'before_effective_date' },
    ]);
  });

  it('allocation invariant: the sum of findings never exceeds stated charges plus the total mismatch', () => {
    const variants = [
      invoice({ totalDue: '9999.00', invoiceDate: '2026-06-30', certifiesFmcRules: false }, { periods: [{ from: '2026-03-06', to: '2026-03-20', rate: '250', amount: '4350' }], evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: ['2026-03-10', '2026-03-11'] } }),
      invoice({ invoiceDate: '2026-06-30', billingPartyType: 'NVOCC', upstreamInvoiceDate: '2026-04-01' }),
      invoice({ certifiesPerformance: false }),
    ];
    for (const inv of variants) {
      const r = auditDdInvoice({ invoice: inv, tariff: MAERSK, calendar: null });
      const stated = inv.containers.flatMap((c) => c.periods).reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
      const totalMismatch = r.findings.find((f) => f.ruleId === 'DD-TOTAL-MISMATCH')?.amountCents ?? 0;
      const sum = r.findings.reduce((s, f) => s + f.amountCents, 0);
      expect(sum).toBeLessThanOrEqual(stated + totalMismatch);
      expect(r.recoverableCents + r.pendingReviewCents).toBe(sum);
      expect(r.findings.every((f) => f.amountCents >= 0)).toBe(true);
    }
  });

  it('untrusted strings pass through plain', () => {
    const inv = invoice({}, { containerNumber: 'ABC<script>`x`' });
    const r = auditDdInvoice({ invoice: inv, tariff: MAERSK, calendar: null });
    expect(r.containers[0]?.label).toBe('Container ABCscriptx');
  });
});

describe('dispute letter (C7)', () => {
  it('lists findings, amounts and the request deadline', () => {
    const inv = invoice({ invoiceDate: '2026-04-25', disputeRequestDays: 45 });
    const r = auditDdInvoice({ invoice: inv, tariff: MAERSK, calendar: null });
    const letter = buildDdDisputeLetter(inv, r, '2026-10-11');
    const lines = letter.split('\n');
    expect(lines.slice(0, 9)).toEqual([
      'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.',
      '',
      'Date: 2026-10-11',
      'To: Synthetic Ocean Line',
      'From: Example Importer LLC',
      'Re: Invoice SYN-DD-0001 / B/L SYNBL0001 - request for fee mitigation, refund or waiver',
      '',
      'We reviewed the above demurrage and detention invoice against 46 CFR Part 541, 46 CFR 545.5 and the applicable tariff, and ask you to review the following items:',
      '',
    ]);
    expect(lines[9]).toBe('1. Charges exceed the attached tariff: $440.00');
    expect(lines[10]?.startsWith('   Container SYNU0000001 (40DV, detention)')).toBe(true);
    expect(lines[11]).toBe('2. Invoice issued more than 30 days late (46 CFR 541.7): $3910.00 (needs review)');
    expect(lines[14]).toBe('Confirmed amount: $440.00. Amount for review: $3910.00.');
    expect(letter).toContain('based on the invoice date 2026-04-25, request by 2026-06-09. Check the dates before sending.)');
    expect(lines.slice(-2)).toEqual(['Sincerely,', '[Name / Title / Contact - to be completed by sender]']);
  });

  it('no findings: do-not-send text and no amounts; invalid today throws', () => {
    const inv = invoice({ invoiceDate: '2026-04-19' });
    const r = auditDdInvoice({ invoice: inv, tariff: null, calendar: null });
    const letter = buildDdDisputeLetter(inv, r, '2026-10-11');
    expect(letter).toContain('\n\n(No items found. Do not send.)\n\nNo amount is requested: there are no findings.\n\nSincerely,');
    expect(letter).not.toContain('Confirmed amount');
    expect(() => buildDdDisputeLetter(inv, r, '11.10.2026')).toThrow(RangeError);
    const noBl = invoice({ billOfLadingNumbers: [] });
    expect(buildDdDisputeLetter(noBl, r, '2026-10-11')).toContain('/ B/L N/A - request');
  });
});

describe('schemas (C4)', () => {
  it('normalize money, dates, periods and weekdays idempotently', () => {
    const inv = invoice({ totalDue: '7.5' }, { periods: [{ from: '2026-03-10', to: '2026-03-12', rate: '1', amount: '3' }, { from: '2026-03-06', to: '2026-03-08', rate: null, amount: '0' }], evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: ['2026-03-09', '2026-03-07'] } });
    expect(inv.totalDue).toBe('7.50');
    expect(inv.containers[0]?.periods.map((p) => p.from)).toEqual(['2026-03-06', '2026-03-10']);
    expect(inv.containers[0]?.evidence.emptyReturnRefusedDates).toEqual(['2026-03-07', '2026-03-09']);
    expect(DdInvoiceData.parse(inv)).toEqual(inv);
    const t = DdTariffData.parse({ ...MAERSK, workingWeekdays: [6, 1, 2, 3, 4, 5] });
    expect(t.workingWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(DdTariffData.parse(t)).toEqual(t);
  });

  it('refuses invalid shapes', () => {
    const good = invoice();
    const c0 = good.containers[0];
    expect(DdInvoiceData.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, totalDue: '1.234' }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, totalDue: '01.00' }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, invoiceNumber: 'A‮B' }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, billOfLadingNumbers: ['A', 'A'] }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, containers: [] }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, containers: [{ ...c0, sizeType: '40dv' }] }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, containers: [{ ...c0, periods: [{ from: '2026-03-06', to: '2026-03-08', rate: null, amount: '1' }, { from: '2026-03-08', to: '2026-03-09', rate: null, amount: '1' }] }] }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, containers: [{ ...c0, periods: [{ from: '2026-03-08', to: '2026-03-06', rate: null, amount: '1' }] }] }).success).toBe(false);
    expect(DdInvoiceData.safeParse({ ...good, containers: [{ ...c0, evidence: { ...c0?.evidence, clockStart: '2026-03-10', clockStop: '2026-03-09' } }] }).success).toBe(false);
    expect(DdInvoiceBody.safeParse({ ...good, tariffId: 'not-a-uuid', calendarId: null }).success).toBe(false);
    expect(DdTariffData.safeParse({ ...MAERSK, sourceUrl: 'http://example.test' }).success).toBe(false);
    expect(DdTariffData.safeParse({ ...MAERSK, sourceUrl: 'https://user:pw@example.test/x' }).success).toBe(false);
    expect(DdTariffData.safeParse({ ...MAERSK, tiers: [{ days: 4, rates: { '40DV': '1.00' } }] }).success).toBe(false);
    expect(DdTariffData.safeParse({ ...MAERSK, tiers: [{ days: null, rates: { '40DV': '0.00' } }] }).success).toBe(false);
    expect(DdTariffData.safeParse({ ...MAERSK, tiers: [{ days: 2, rates: { '40DV': '1.00' } }, { days: null, rates: { '20DV': '1.00' } }] }).success).toBe(false);
    expect(DdCalendarData.safeParse({ name: 'x', closedDates: ['2026-01-01'], shutoutDates: ['2026-01-01'] }).success).toBe(false);
    expect(DdCalendarData.safeParse({ name: 'x', closedDates: ['2026-01-01', '2026-01-01'], shutoutDates: [] }).success).toBe(false);
  });

  it('every preset passes DdTariffData unchanged and is frozen', () => {
    expect(DD_TARIFF_PRESETS.map((p) => p.id)).toEqual(['maersk-us-import-detention-2026', 'msc-us-import-demurrage', 'hapag-lloyd-us-import-detention-mh-2025', 'cma-cgm-us-import-demurrage-standard']);
    for (const p of DD_TARIFF_PRESETS) {
      expect(DdTariffData.parse(p.data)).toEqual(p.data);
      expect(Object.isFrozen(p.data.tiers[0]?.rates)).toBe(true);
      expect(p.provenance.retrieved).toBe('2026-10-11');
    }
  });
});

describe('CSV import (C8)', () => {
  const BOM = String.fromCharCode(0xfeff);
  const header = DD_CSV_COLUMNS.join(',');
  const row = (o: Partial<Record<(typeof DD_CSV_COLUMNS)[number], string>>): string => {
    const base: Partial<Record<(typeof DD_CSV_COLUMNS)[number], string>> = {
      invoice_number: 'SYN-1',
      billing_party: 'Synthetic Ocean Line',
      billing_party_type: 'ocean_carrier',
      billed_party: 'Example Importer LLC',
      direction: 'import',
      invoice_date: '2026-03-25',
      due_date: '2026-04-24',
      bl_numbers: 'SYNBL1; SYNBL2',
      port_of_discharge: 'Port of Example',
      liability_basis: 'Consignee',
      total_due: '"$4,350.00"',
      rule_reference: 'Rule 1',
      dispute_contact: 'disputes@example.test',
      dispute_digital_means: 'https://example.test/d',
      dispute_request_days: '30',
      dispute_resolution_days: '30',
      certifies_fmc_rules: 'yes',
      certifies_performance: 'Y',
      container_number: 'SYNU0000001',
      size_type: '40dv',
      charge_type: 'detention',
      free_days: '4',
      free_time_start: '2026-03-02',
      free_time_end: '2026-03-05',
      availability_date: '2026-03-01',
      period_from: '2026-03-06',
      period_to: '2026-03-10',
      rate: '290',
      amount: '1450',
    };
    const m = { ...base, ...o };
    return DD_CSV_COLUMNS.map((c) => m[c] ?? '').join(',');
  };

  it('parses, groups rows into invoices/containers/periods and validates', () => {
    const csv = `${BOM}${header}\r\n${row({})}\r\n${row({ period_from: '2026-03-11', period_to: '2026-03-20', amount: '2900', rate: '290' })}\n${row({ invoice_number: 'SYN-2', container_number: '', period_from: '', period_to: '', amount: '', rate: '' })}\n\n\n`;
    const r = parseDdCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.invoices).toHaveLength(2);
    const a = r.invoices[0];
    expect(a?.billOfLadingNumbers).toEqual(['SYNBL1', 'SYNBL2']);
    expect(a?.totalDue).toBe('4350.00');
    expect(a?.billingPartyType).toBe('OCEAN_CARRIER');
    expect(a?.certifiesPerformance).toBe(true);
    expect(a?.containers).toHaveLength(1);
    expect(a?.containers[0]?.sizeType).toBe('40DV');
    expect(a?.containers[0]?.periods.map((p) => [p.from, p.to, p.amount])).toEqual([
      ['2026-03-06', '2026-03-10', '1450.00'],
      ['2026-03-11', '2026-03-20', '2900.00'],
    ]);
    expect(r.invoices[1]?.containers[0]?.periods).toEqual([]);
  });

  it('quoted fields with commas and doubled quotes', () => {
    const r = parseDdCsv(`${header}\n${row({ liability_basis: '"Consignee, per B/L ""SYNBL1"""' })}`);
    expect(r.errors).toEqual([]);
    expect(r.invoices[0]?.liabilityBasis).toBe('Consignee, per B/L "SYNBL1"');
  });

  it('file errors', () => {
    expect(parseDdCsv('x'.repeat(1_000_001))).toEqual({ invoices: [], errors: [{ row: 0, column: null, code: 'too_large' }] });
    expect(parseDdCsv('a,b\n1,2')).toEqual({ invoices: [], errors: [{ row: 1, column: null, code: 'header_mismatch' }] });
    expect(parseDdCsv('')).toEqual({ invoices: [], errors: [{ row: 1, column: null, code: 'header_mismatch' }] });
    expect(parseDdCsv(`${header}\n${row({ return_refused_dates: '"open' })}\n`)).toEqual({ invoices: [], errors: [{ row: 2, column: null, code: 'unterminated_quote' }] });
    const many = [header, ...Array.from({ length: 2001 }, (_, k) => row({ invoice_number: `SYN-${k % 3}` }))].join('\n');
    expect(parseDdCsv(many).errors).toEqual([{ row: 0, column: null, code: 'too_many_rows' }]);
    const groups = [header, ...Array.from({ length: 51 }, (_, k) => row({ invoice_number: `SYN-${k}` }))].join('\n');
    expect(parseDdCsv(groups).errors).toEqual([{ row: 0, column: null, code: 'too_many_invoices' }]);
    expect(parseDdCsv(header.toUpperCase().replaceAll(',', ' , ')).errors).toEqual([]);
  });

  it('row errors leave the invoice out and are sorted by row then column', () => {
    const csv = [
      header,
      row({}),
      row({ due_date: '2026-04-25', amount: '', rate: 'abc' }),
      row({ invoice_number: 'SYN-2', size_type: '' }),
      row({ invoice_number: 'SYN-3', free_days: '61' }),
      row({ invoice_number: 'SYN-4' }),
      'only,three,cells',
      row({ invoice_number: 'SYN-4', free_days: '5', period_from: '2026-03-11', period_to: '2026-03-12', amount: '1' }),
    ].join('\n');
    const r = parseDdCsv(csv);
    expect(r.errors).toEqual([
      { row: 3, column: 'due_date', code: 'inconsistent_invoice' },
      { row: 3, column: 'rate', code: 'invalid_value' },
      { row: 3, column: 'amount', code: 'required' },
      { row: 4, column: 'size_type', code: 'required' },
      { row: 5, column: null, code: 'invalid_invoice' },
      { row: 7, column: null, code: 'column_count' },
      { row: 8, column: 'free_days', code: 'inconsistent_container' },
    ]);
    expect(r.invoices).toEqual([]);
  });
});

describe('fix round 1 contract changes', () => {
  it('invoice list pageSize is capped at 50; invoice cap and body limit constants', async () => {
    const { DdInvoiceListQuery, DdListQuery } = await import('../ocean-dd-dto.js');
    const { DD_INVOICES_MAX, DD_INVOICE_BODY_LIMIT, DD_INVOICE_PAGE_SIZE_MAX } = await import('./constants.js');
    expect([DD_INVOICES_MAX, DD_INVOICE_BODY_LIMIT, DD_INVOICE_PAGE_SIZE_MAX]).toEqual([2000, 262144, 50]);
    expect(DdInvoiceListQuery.safeParse({ pageSize: '50' }).success).toBe(true);
    expect(DdInvoiceListQuery.safeParse({ pageSize: '51' }).success).toBe(false);
    expect(DdListQuery.safeParse({ pageSize: '100' }).success).toBe(true);
  });
});

describe('module surface (C1, C10)', () => {
  it('root exports the public names', () => {
    const names = [
      'DD_RULES_VERSION',
      'DD_RULE_IDS',
      'DD_PART541_EFFECTIVE',
      'DD_ISSUE_DEADLINE_DAYS',
      'DD_DISPUTE_MIN_DAYS',
      'DD_RESOLUTION_MAX_DAYS',
      'DD_REGULATION_VERSION',
      'DD_CONTAINERS_MAX',
      'DD_CSV_MAX_CHARS',
      'DD_TARIFFS_MAX',
      'DD_CALENDARS_MAX',
      'DD_SOURCE_FILES',
      'DD_REGULATION_TEXT',
      'DD_TARIFF_PRESETS',
      'DD_NOTE',
      'DD_PACKET_DISCLAIMER',
      'DD_PRESET_NOTE',
      'DD_TEXT',
      'DD_CHECK_LABELS',
      'DD_CHECK_STATUS_LABELS',
      'DdInvoiceData',
      'DdInvoiceBody',
      'DdTariffData',
      'DdCalendarData',
      'DdTariffView',
      'DdCalendarView',
      'DdTariffList',
      'DdCalendarList',
      'DdListQuery',
      'DdInvoiceListQuery',
      'DdInvoiceListItem',
      'DdInvoiceList',
      'DdInvoiceDetail',
      'DdAuditResult',
      'DdAuditResponse',
      'DdTariffPutBody',
      'DdCalendarPutBody',
      'DdInvoicePutBody',
      'ddDayNumber',
      'ddDateFromDayNumber',
      'ddIsoWeekday',
      'ddAddDays',
      'ddDaysBetween',
      'computeFreeTimeEnd',
      'computeTariffCharge',
      'auditDdInvoice',
      'buildDdDisputeLetter',
      'parseDdCsv',
      'CLAIM_KINDS',
    ];
    const exported = root as Record<string, unknown>;
    for (const n of names) expect(exported[n], n).toBeDefined();
    expect(DD_RULE_IDS).toHaveLength(7);
    expect(DD_SOURCE_FILES.regulation).toBe('ecfr-46-cfr-541-545.5.json');
    expect(Object.keys(DD_REGULATION_TEXT)).toEqual([
      '46 CFR 541.5',
      '46 CFR 541.6(a)',
      '46 CFR 541.6(b)',
      '46 CFR 541.6(c)',
      '46 CFR 541.6(d)',
      '46 CFR 541.6(e)',
      '46 CFR 541.7(a)',
      '46 CFR 541.7(b)',
      '46 CFR 541.8(a)',
      '46 CFR 541.8(b)',
      '46 CFR 545.5(c)(2)(i)',
      '46 CFR 545.5(c)(2)(ii)',
    ]);
    expect(Object.isFrozen(DD_REGULATION_TEXT)).toBe(true);
    expect(Object.keys(DD_CHECK_LABELS)).toHaveLength(8);
  });
});
