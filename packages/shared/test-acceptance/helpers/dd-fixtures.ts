// REQ-20261011-ocean-dd: test-owned fixtures for the step-8 Tier L suites. The four C9 public tariff presets are
// restated from Part C (real published figures, cited by preset id); every invoice is synthetic (`Synthetic ...`,
// `SYN...`, example.com). The product module is loaded dynamically from the package root and typed through these
// contract interfaces only.
import type { OCalendar, OCharge, OContainer, OInvoice, OPeriod, OResult, OTariff } from './dd-oracle.js';

// ---------------------------------------------------------------------------------------------------------------
// Product surface (C1), typed from the contract
// ---------------------------------------------------------------------------------------------------------------
export interface ZodLike { safeParse(x: unknown): { success: boolean; data?: unknown; error?: unknown }; parse(x: unknown): unknown }
export interface DdMod {
  DD_RULES_VERSION: string; DD_RULE_IDS: readonly string[]; DD_PART541_EFFECTIVE: string; DD_ISSUE_DEADLINE_DAYS: number; DD_DISPUTE_MIN_DAYS: number;
  DD_RESOLUTION_MAX_DAYS: number; DD_REGULATION_VERSION: string; DD_CONTAINERS_MAX: number; DD_PERIODS_MAX: number; DD_TIERS_MAX: number; DD_SIZES_MAX: number;
  DD_CALENDAR_DATES_MAX: number; DD_REFUSED_DATES_MAX: number; DD_BL_MAX: number; DD_SPAN_MAX_DAYS: number; DD_PERIOD_SPAN_MAX_DAYS: number;
  DD_CSV_MAX_CHARS: number; DD_CSV_MAX_ROWS: number; DD_CSV_MAX_INVOICES: number; DD_TARIFFS_MAX: number; DD_CALENDARS_MAX: number;
  DD_SOURCE_FILES: Record<string, string>; DD_REGULATION_TEXT: Record<string, string>; DD_TARIFF_PRESETS: readonly Preset[];
  DD_NOTE: string; DD_PACKET_DISCLAIMER: string; DD_PRESET_NOTE: string; DD_TEXT: Record<string, string>; DD_CHECK_LABELS: Record<string, string>; DD_CHECK_STATUS_LABELS: Record<string, string>;
  DdInvoiceData: ZodLike; DdInvoiceBody: ZodLike; DdTariffData: ZodLike; DdCalendarData: ZodLike;
  ddDayNumber(d: string): number; ddDateFromDayNumber(n: number): string; ddIsoWeekday(d: string): number; ddAddDays(d: string, n: number): string; ddDaysBetween(a: string, b: string): number;
  computeFreeTimeEnd(start: string, tariff: OTariff, calendar: OCalendar | null): string;
  computeTariffCharge(a: { start: string; stop: string; sizeType: string; tariff: OTariff; calendar: OCalendar | null }): OCharge;
  auditDdInvoice(a: { invoice: OInvoice; tariff: OTariff | null; calendar: OCalendar | null }): OResult;
  buildDdDisputeLetter(invoice: OInvoice, result: OResult, today: string): string;
  parseDdCsv(text: string): { invoices: OInvoice[]; errors: { row: number; column: string | null; code: string }[] };
  canonicalJson(v: unknown): string;
  [k: string]: unknown;
}
export interface Preset {
  id: string; data: OTariff;
  provenance: { carrier: string; document: string; url: string; retrieved: string; effective: string | null; sha256: string | null; verification: string; assumptions: string[] };
}
export async function loadDd(): Promise<DdMod> {
  return (await import('@fr/shared')) as unknown as DdMod;
}

// ---------------------------------------------------------------------------------------------------------------
// C9 presets (restated)
// ---------------------------------------------------------------------------------------------------------------
const four = (r: string) => ({ '20DV': r, '40DV': r, '40HC': r, '45HC': r });
export const MAERSK: OTariff = {
  name: 'Maersk US import detention (2026)', carrier: 'Maersk', chargeType: 'DETENTION', direction: 'IMPORT',
  ruleReference: 'Maersk US import detention tariff effective 01 Jan 2026',
  sourceUrl: 'https://www.maersk.com/~/media_sc9/maersk/local-information/files/north-america/united-states-of-america/import/us-import-detention-tariff-effective-01-jan-2026.pdf',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'included', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5, 6],
  tiers: [{ days: 4, rates: four('210.00') }, { days: 4, rates: four('260.00') }, { days: null, rates: four('290.00') }],
};
export const MSC: OTariff = {
  name: 'MSC US import demurrage (all ports except Baltimore)', carrier: 'MSC', chargeType: 'DEMURRAGE', direction: 'IMPORT',
  ruleReference: 'MSC detention, demurrage and per diem charges, A.1 import containers',
  sourceUrl: 'https://www.msc.com/-/media/files/msc-cargo/local-information/america/united-states/detention-demurrage-and-per-diem-charges.pdf',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'included', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5],
  tiers: [{ days: 5, rates: { '20DV': '65.00', '40DV': '80.00', '40HC': '80.00', '45HC': '80.00' } }, { days: null, rates: { '20DV': '120.00', '40DV': '150.00', '40HC': '150.00', '45HC': '150.00' } }],
};
export const HAPAG: OTariff = {
  name: 'Hapag-Lloyd US import detention, merchant haulage (excl. California)', carrier: 'Hapag-Lloyd', chargeType: 'DETENTION', direction: 'IMPORT',
  ruleReference: 'Hapag-Lloyd USA Detention effective October 1, 2025, Import Merchant Haulage, Regular',
  sourceUrl: 'https://www.hapag-lloyd.com/content/dam/website/downloads/detention_demurrage/USA_Detention_Effective_October_01_2025.pdf',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'additional', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5],
  tiers: [{ days: 3, rates: four('200.00') }, { days: 3, rates: four('250.00') }, { days: null, rates: four('300.00') }],
};
export const CMA: OTariff = {
  name: 'CMA CGM US import demurrage, standard US ports (40 ft dry)', carrier: 'CMA CGM', chargeType: 'DEMURRAGE', direction: 'IMPORT',
  ruleReference: 'CMA CGM US import demurrage, standard US ports (as reported)',
  sourceUrl: 'https://blogs.tradlinx.com/same-box-same-delay-80-vs-360-a-day-how-us-demurrage-tiers-vary-by-carrier/',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'included', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5],
  tiers: [{ days: 5, rates: { '40DV': '295.00', '40HC': '295.00' } }, { days: 5, rates: { '40DV': '355.00', '40HC': '355.00' } }, { days: null, rates: { '40DV': '395.00', '40HC': '395.00' } }],
};
export const PRESETS_EXPECTED: Preset[] = [
  { id: 'maersk-us-import-detention-2026', data: MAERSK, provenance: { carrier: 'Maersk', document: '', url: MAERSK.sourceUrl ?? '', retrieved: '2026-10-11', effective: '2026-01-01', sha256: null, verification: 'primary_search_extract', assumptions: ['The day of gate-out counts as free day 1 when it is a working day.', 'Tariff days 5-8, 9-12 and 13+ are the 1st-4th, 5th-8th and 9th+ chargeable days.'] } },
  { id: 'msc-us-import-demurrage', data: MSC, provenance: { carrier: 'MSC', document: '', url: MSC.sourceUrl ?? '', retrieved: '2026-10-11', effective: null, sha256: '7ee60b305cb409687e18a465327416b7796437a031ff1e22fc1ad2c6909bb4e3', verification: 'primary', assumptions: ['The tariff does not say whether chargeable days are calendar days; calendar days assumed.', 'Working days assumed Monday to Friday.', 'The first day of free time is assumed to count.'] } },
  { id: 'hapag-lloyd-us-import-detention-mh-2025', data: HAPAG, provenance: { carrier: 'Hapag-Lloyd', document: '', url: HAPAG.sourceUrl ?? '', retrieved: '2026-10-11', effective: '2025-10-01', sha256: '5aea8cf368504f3e62446bbc2616931ef22c62e03e72f21448dce83ce662bfdd', verification: 'primary', assumptions: ['Free time is the day of interchange plus 4 working days (DOI+4WD).', 'Working days depend on the terminal; Monday to Friday assumed.', 'Per the May 2026 guide, bank holidays and shutout days do not count as free time and shutout days are not charged.'] } },
  { id: 'cma-cgm-us-import-demurrage-standard', data: CMA, provenance: { carrier: 'CMA CGM', document: '', url: CMA.sourceUrl ?? '', retrieved: '2026-10-11', effective: '2026-02-22', sha256: null, verification: 'secondary', assumptions: ['Rates from a trade publication, not from the CMA CGM tariff itself; verify before use.', 'Tariff days 5-9, 10-14 and 15+ are the 1st-5th, 6th-10th and 11th+ chargeable days.', 'Working days assumed Monday to Friday.'] } },
];

export const cal = (closed: string[] = [], shutout: string[] = [], name = 'Synthetic terminal calendar'): OCalendar => ({ name, closedDates: closed, shutoutDates: shutout });
export const NO_CAL = cal([], [], 'No closures');
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}

// ---------------------------------------------------------------------------------------------------------------
// T3 synthetic invoices (SI-1 .. SI-12)
// ---------------------------------------------------------------------------------------------------------------
const per = (from: string, to: string, rate: string | null, amount: string): OPeriod => ({ from, to, rate, amount });
export function si1(): OInvoice {
  return {
    invoiceNumber: 'SYN-DD-0001', billingPartyName: 'Synthetic Ocean Line A', billingPartyType: 'OCEAN_CARRIER', billedPartyName: 'Synthetic Importer Inc',
    direction: 'IMPORT', invoiceDate: '2026-03-27', dueDate: '2026-04-26', upstreamInvoiceDate: null, billOfLadingNumbers: ['SYNBL0001'],
    portOfDischarge: 'Synthetic Port 1', liabilityBasis: 'Consignee named on the bill of lading', totalDue: '3910.00', ruleReference: 'Synthetic tariff rule DET-1',
    disputeContact: 'disputes@example.com', disputeDigitalMeans: 'https://example.com/dd-disputes', disputeRequestDays: 30, disputeResolutionDays: 30,
    certifiesFmcRules: true, certifiesPerformance: true,
    containers: [{
      containerNumber: 'SYNU0000001', sizeType: '40DV', chargeType: 'DETENTION', freeDays: 4, freeTimeStart: '2026-03-02', freeTimeEnd: '2026-03-05',
      availabilityDate: '2026-02-27', earliestReturnDate: null,
      periods: [per('2026-03-06', '2026-03-09', '210.00', '840.00'), per('2026-03-10', '2026-03-13', '260.00', '1040.00'), per('2026-03-14', '2026-03-20', '290.00', '2030.00')],
      evidence: { clockStart: '2026-03-02', clockStop: '2026-03-20', cargoAvailableDate: null, emptyReturnRefusedDates: [] },
    }],
  };
}
const c0 = (i: OInvoice): OContainer => {
  const c = i.containers[0];
  if (!c) throw new Error('fixture has no container');
  return c;
};
export interface Case { id: string; invoice: OInvoice; tariff: OTariff | null; calendar: OCalendar | null }
const mod = (f: (i: OInvoice) => void): OInvoice => { const i = si1(); f(i); return i; };
function si6(): OInvoice {
  return mod((i) => {
    Object.assign(i, { invoiceNumber: 'SYN-DD-0006', invoiceDate: '2026-07-31', dueDate: '2026-08-30', totalDue: '2850.00' });
    Object.assign(c0(i), {
      containerNumber: 'SYNU0000006', sizeType: '40HC', freeTimeStart: '2026-07-02', freeTimeEnd: '2026-07-09', availabilityDate: '2026-07-01',
      periods: [per('2026-07-10', '2026-07-12', '200.00', '600.00'), per('2026-07-13', '2026-07-15', '250.00', '750.00'), per('2026-07-16', '2026-07-20', '300.00', '1500.00')],
      evidence: { clockStart: '2026-07-02', clockStop: '2026-07-20', cargoAvailableDate: null, emptyReturnRefusedDates: ['2026-07-16', '2026-07-17'] },
    });
  });
}
export const HAPAG_CAL = cal(['2026-07-03'], ['2026-07-14'], 'Synthetic terminal A 2026');
export const MSC_CAL = cal(['2026-09-07'], [], 'Synthetic terminal B 2026');
function si7(): OInvoice {
  return mod((i) => {
    Object.assign(i, { invoiceNumber: 'SYN-DD-0007', invoiceDate: '2026-09-30', dueDate: '2026-10-30', totalDue: '1450.00' });
    Object.assign(c0(i), {
      containerNumber: 'SYNU0000007', sizeType: '40DV', chargeType: 'DEMURRAGE', freeTimeStart: '2026-09-04', freeTimeEnd: '2026-09-10', availabilityDate: '2026-09-04',
      periods: [per('2026-09-11', '2026-09-15', '80.00', '400.00'), per('2026-09-16', '2026-09-22', '150.00', '1050.00')],
      evidence: { clockStart: null, clockStop: '2026-09-22', cargoAvailableDate: '2026-09-08', emptyReturnRefusedDates: [] },
    });
  });
}
function si9(date: string): OInvoice {
  return mod((i) => { Object.assign(i, { invoiceDate: date, disputeDigitalMeans: null, certifiesPerformance: false }); });
}
export function si10(): OInvoice {
  return mod((i) => {
    Object.assign(i, {
      invoiceNumber: 'SYN-DD-0010', invoiceDate: null, dueDate: null, billOfLadingNumbers: [], portOfDischarge: null, liabilityBasis: null, totalDue: null, ruleReference: null,
      disputeContact: null, disputeDigitalMeans: null, disputeRequestDays: null, disputeResolutionDays: 45, certifiesFmcRules: false, certifiesPerformance: false,
    });
    const c = c0(i);
    Object.assign(c, { freeDays: null, freeTimeStart: null, freeTimeEnd: null, availabilityDate: null });
    const p1 = c.periods[1];
    if (p1) p1.rate = null;
    const c2: OContainer = { ...clone(c), containerNumber: null, periods: [], evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: [] } };
    i.containers.push(c2);
  });
}
export const CASES: Record<string, () => Case> = {
  'SI-1': () => ({ id: 'SI-1', invoice: si1(), tariff: MAERSK, calendar: null }),
  'SI-2': () => ({ id: 'SI-2', invoice: mod((i) => { i.disputeDigitalMeans = null; i.disputeRequestDays = 14; }), tariff: MAERSK, calendar: null }),
  'SI-3': () => ({ id: 'SI-3', invoice: mod((i) => { i.invoiceDate = '2026-04-20'; }), tariff: MAERSK, calendar: null }),
  'SI-3b': () => ({ id: 'SI-3b', invoice: mod((i) => { i.invoiceDate = '2026-04-19'; }), tariff: MAERSK, calendar: null }),
  'SI-4': () => ({ id: 'SI-4', invoice: mod((i) => { c0(i).periods = [per('2026-03-05', '2026-03-08', '210.00', '840.00'), per('2026-03-09', '2026-03-12', '260.00', '1040.00'), per('2026-03-13', '2026-03-20', '290.00', '2320.00')]; i.totalDue = '4200.00'; }), tariff: MAERSK, calendar: null }),
  'SI-5': () => ({ id: 'SI-5', invoice: mod((i) => { const p = c0(i).periods[2]; if (p) p.amount = '2130.00'; i.totalDue = '4010.00'; }), tariff: MAERSK, calendar: null }),
  'SI-5b': () => ({ id: 'SI-5b', invoice: mod((i) => { const p = c0(i).periods[2]; if (p) p.amount = '2130.00'; i.totalDue = '4110.00'; }), tariff: MAERSK, calendar: null }),
  'SI-6': () => ({ id: 'SI-6', invoice: si6(), tariff: HAPAG, calendar: HAPAG_CAL }),
  'SI-6b': () => ({ id: 'SI-6b', invoice: si6(), tariff: null, calendar: HAPAG_CAL }),
  'SI-7': () => ({ id: 'SI-7', invoice: si7(), tariff: MSC, calendar: MSC_CAL }),
  'SI-8': () => ({ id: 'SI-8', invoice: mod((i) => { Object.assign(i, { billingPartyType: 'NVOCC', upstreamInvoiceDate: '2026-03-25', invoiceDate: '2026-04-27', dueDate: '2026-05-27' }); }), tariff: MAERSK, calendar: null }),
  'SI-8b': () => ({ id: 'SI-8b', invoice: mod((i) => { Object.assign(i, { billingPartyType: 'NVOCC', upstreamInvoiceDate: '2026-03-30', invoiceDate: '2026-04-27', dueDate: '2026-05-27' }); }), tariff: MAERSK, calendar: null }),
  'SI-8c': () => ({ id: 'SI-8c', invoice: mod((i) => { Object.assign(i, { billingPartyType: 'NVOCC', upstreamInvoiceDate: null, invoiceDate: '2026-04-27', dueDate: '2026-05-27' }); }), tariff: MAERSK, calendar: null }),
  'SI-9': () => ({ id: 'SI-9', invoice: si9('2024-05-27'), tariff: null, calendar: null }),
  'SI-9b': () => ({ id: 'SI-9b', invoice: si9('2024-05-28'), tariff: null, calendar: null }),
  'SI-10': () => ({ id: 'SI-10', invoice: si10(), tariff: null, calendar: null }),
  'SI-11': () => ({ id: 'SI-11', invoice: mod((i) => { Object.assign(c0(i), { freeDays: 5, freeTimeEnd: '2026-03-06', periods: [per('2026-03-07', '2026-03-09', '210.00', '630.00'), per('2026-03-10', '2026-03-13', '260.00', '1040.00'), per('2026-03-14', '2026-03-20', '290.00', '2030.00')] }); i.totalDue = '3700.00'; }), tariff: MAERSK, calendar: null }),
  // review F3: only an inaccurate item (541.8(a) window) -> 541.6 accuracy texts, clause 541.6(d)
  'SI-13': () => ({ id: 'SI-13', invoice: mod((i) => { i.disputeRequestDays = 14; }), tariff: MAERSK, calendar: null }),
  'SI-12': () => ({ id: 'SI-12', invoice: mod((i) => { i.direction = 'EXPORT'; i.portOfDischarge = null; }), tariff: MAERSK, calendar: null }),
};
/** T3 table: [rule, amount, review][] and recoverable / pending, exactly as in test-spec. */
export const EXPECT: Record<string, { f: [string, string, boolean][]; rec: string; pend: string }> = {
  'SI-1': { f: [], rec: '0.00', pend: '0.00' },
  'SI-2': { f: [['DD-541-6-CONTENT', '3910.00', true]], rec: '0.00', pend: '3910.00' },
  'SI-3': { f: [['DD-541-7-LATE', '3910.00', true]], rec: '0.00', pend: '3910.00' },
  'SI-3b': { f: [], rec: '0.00', pend: '0.00' },
  'SI-4': { f: [['DD-TARIFF-OVERCHARGE', '290.00', false], ['DD-541-6-CONTENT', '3910.00', true]], rec: '290.00', pend: '3910.00' },
  'SI-5': { f: [['DD-PERIOD-ARITH', '100.00', false]], rec: '100.00', pend: '0.00' },
  'SI-5b': { f: [['DD-TOTAL-MISMATCH', '100.00', false], ['DD-PERIOD-ARITH', '100.00', false]], rec: '200.00', pend: '0.00' },
  'SI-6': { f: [['DD-TARIFF-OVERCHARGE', '300.00', false], ['DD-545-RETURN-REFUSED', '550.00', true]], rec: '300.00', pend: '550.00' },
  'SI-6b': { f: [['DD-545-RETURN-REFUSED', '600.00', true]], rec: '0.00', pend: '600.00' },
  'SI-7': { f: [['DD-545-AVAILABILITY', '150.00', true]], rec: '0.00', pend: '150.00' },
  'SI-8': { f: [['DD-541-7-LATE', '3910.00', true]], rec: '0.00', pend: '3910.00' },
  'SI-8b': { f: [], rec: '0.00', pend: '0.00' },
  'SI-8c': { f: [], rec: '0.00', pend: '0.00' },
  'SI-9': { f: [], rec: '0.00', pend: '0.00' },
  'SI-9b': { f: [['DD-541-6-CONTENT', '3910.00', true]], rec: '0.00', pend: '3910.00' },
  'SI-10': { f: [['DD-541-6-CONTENT', '3910.00', true]], rec: '0.00', pend: '3910.00' },
  'SI-11': { f: [['DD-541-6-CONTENT', '3700.00', true]], rec: '0.00', pend: '3700.00' },
  'SI-12': { f: [['DD-541-6-CONTENT', '3910.00', true]], rec: '0.00', pend: '3910.00' },
  'SI-13': { f: [['DD-541-6-CONTENT', '3910.00', true]], rec: '0.00', pend: '3910.00' },
};

// ---------------------------------------------------------------------------------------------------------------
// T2 worked examples
// ---------------------------------------------------------------------------------------------------------------
export interface Worked { id: string; tariff: OTariff; size: string; S: string; E: string; calendar: OCalendar; F: string; n: number; T: number }
const shut14 = Array.from({ length: 14 }, (_, k) => `2026-02-${String(k + 1).padStart(2, '0')}`);
export const WORKED: Worked[] = [
  { id: 'W1 maersk-us-import-detention-2026 40DV', tariff: MAERSK, size: '40DV', S: '2026-03-02', E: '2026-03-20', calendar: NO_CAL, F: '2026-03-05', n: 15, T: 391000 },
  { id: 'W2 maersk-us-import-detention-2026 40DV Memorial Day', tariff: MAERSK, size: '40DV', S: '2026-05-22', E: '2026-06-02', calendar: cal(['2026-05-25']), F: '2026-05-27', n: 6, T: 136000 },
  { id: 'W3 hapag-lloyd-us-import-detention-mh-2025 40HC', tariff: HAPAG, size: '40HC', S: '2026-07-02', E: '2026-07-20', calendar: cal(['2026-07-03'], ['2026-07-14']), F: '2026-07-09', n: 10, T: 255000 },
  { id: 'W3b hapag-lloyd-us-import-detention-mh-2025 40HC no shutout', tariff: HAPAG, size: '40HC', S: '2026-07-02', E: '2026-07-20', calendar: cal(['2026-07-03']), F: '2026-07-09', n: 11, T: 285000 },
  { id: 'W4 msc-us-import-demurrage 40DV Labor Day', tariff: MSC, size: '40DV', S: '2026-09-07', E: '2026-09-22', calendar: cal(['2026-09-07']), F: '2026-09-11', n: 11, T: 130000 },
  { id: 'W4b msc-us-import-demurrage 20DV', tariff: MSC, size: '20DV', S: '2026-09-07', E: '2026-09-22', calendar: cal(['2026-09-07']), F: '2026-09-11', n: 11, T: 104500 },
  { id: 'W4c msc-us-import-demurrage 40DV from 09-04', tariff: MSC, size: '40DV', S: '2026-09-04', E: '2026-09-22', calendar: cal(['2026-09-07']), F: '2026-09-10', n: 12, T: 145000 },
  { id: 'W5 cma-cgm-us-import-demurrage-standard 40DV (secondary source)', tariff: CMA, size: '40DV', S: '2026-02-02', E: '2026-02-20', calendar: NO_CAL, F: '2026-02-05', n: 15, T: 522500 },
  { id: 'E1 maersk-us-import-detention-2026 within free time', tariff: MAERSK, size: '40DV', S: '2026-03-02', E: '2026-03-05', calendar: NO_CAL, F: '2026-03-05', n: 0, T: 0 },
  { id: 'E2 maersk-us-import-detention-2026 one day', tariff: MAERSK, size: '40DV', S: '2026-03-02', E: '2026-03-06', calendar: NO_CAL, F: '2026-03-05', n: 1, T: 21000 },
  { id: 'E3 maersk-us-import-detention-2026 start Sunday', tariff: MAERSK, size: '40DV', S: '2026-03-01', E: '2026-03-10', calendar: NO_CAL, F: '2026-03-05', n: 5, T: 110000 },
  { id: 'E4 hapag-lloyd-us-import-detention-mh-2025 40DV start Saturday', tariff: HAPAG, size: '40DV', S: '2026-07-04', E: '2026-07-15', calendar: cal(['2026-07-03']), F: '2026-07-09', n: 6, T: 135000 },
  { id: 'E5 maersk-us-import-detention-2026 freeDays 0', tariff: { ...MAERSK, freeDays: 0 }, size: '40DV', S: '2026-03-02', E: '2026-03-04', calendar: NO_CAL, F: '2026-03-01', n: 3, T: 63000 },
  { id: 'E6 hapag-lloyd-us-import-detention-mh-2025 freeDays 0', tariff: { ...HAPAG, freeDays: 0 }, size: '40DV', S: '2026-03-02', E: '2026-03-04', calendar: NO_CAL, F: '2026-03-02', n: 2, T: 40000 },
  { id: 'E7 maersk-us-import-detention-2026 working charge basis Mon-Fri', tariff: { ...MAERSK, chargeDayBasis: 'working', workingWeekdays: [1, 2, 3, 4, 5] }, size: '40DV', S: '2026-03-02', E: '2026-03-16', calendar: cal(['2026-03-09']), F: '2026-03-05', n: 6, T: 136000 },
  { id: 'E8 maersk-us-import-detention-2026 calendar free basis', tariff: { ...MAERSK, freeDayBasis: 'calendar' }, size: '40DV', S: '2026-03-02', E: '2026-03-12', calendar: cal([], ['2026-03-03']), F: '2026-03-06', n: 6, T: 136000 },
  { id: 'E9 maersk-us-import-detention-2026 14 shutout dates', tariff: MAERSK, size: '40DV', S: '2026-01-01', E: '2026-03-31', calendar: cal([], shut14), F: '2026-01-05', n: 71, T: 2015000 },
];
const W1_STEPS = ['Free time: 4 working day(s) counted from 2026-03-02 (start day included), ending 2026-03-05.', 'Chargeable calendar days from 2026-03-06 to 2026-03-20: 15.', 'Tier 1: 4 day(s) x $210.00 = $840.00.', 'Tier 2: 4 day(s) x $260.00 = $1040.00.', 'Tier 3: 7 day(s) x $290.00 = $2030.00.', 'Tariff charge = $3910.00.'];
const W3_STEPS = ['Free time: start day 2026-07-02 plus 4 working day(s), ending 2026-07-09.', 'Closed or shutout dates not counted as free time: 2026-07-03.', 'Chargeable calendar days from 2026-07-10 to 2026-07-20: 10.', 'Closed or shutout dates not charged: 2026-07-14.', 'Tier 1: 3 day(s) x $200.00 = $600.00.', 'Tier 2: 3 day(s) x $250.00 = $750.00.', 'Tier 3: 4 day(s) x $300.00 = $1200.00.', 'Tariff charge = $2550.00.'];
/** Exact step lists of test-spec T2 (full lists where given, otherwise the lines that must be present / absent). */
export const STEPS_EXACT: Record<string, string[]> = {
  W1: W1_STEPS,
  W2: ['Free time: 4 working day(s) counted from 2026-05-22 (start day included), ending 2026-05-27.', 'Closed or shutout dates not counted as free time: 2026-05-25.', 'Chargeable calendar days from 2026-05-28 to 2026-06-02: 6.', 'Tier 1: 4 day(s) x $210.00 = $840.00.', 'Tier 2: 2 day(s) x $260.00 = $520.00.', 'Tariff charge = $1360.00.'],
  W3: W3_STEPS,
  W3b: ['Free time: start day 2026-07-02 plus 4 working day(s), ending 2026-07-09.', 'Closed or shutout dates not counted as free time: 2026-07-03.', 'Chargeable calendar days from 2026-07-10 to 2026-07-20: 11.', 'Tier 1: 3 day(s) x $200.00 = $600.00.', 'Tier 2: 3 day(s) x $250.00 = $750.00.', 'Tier 3: 5 day(s) x $300.00 = $1500.00.', 'Tariff charge = $2850.00.'],
  W4: ['Free time: 4 working day(s) counted from 2026-09-07 (start day included), ending 2026-09-11.', 'Closed or shutout dates not counted as free time: 2026-09-07.', 'Chargeable calendar days from 2026-09-12 to 2026-09-22: 11.', 'Tier 1: 5 day(s) x $80.00 = $400.00.', 'Tier 2: 6 day(s) x $150.00 = $900.00.', 'Tariff charge = $1300.00.'],
  W4b: ['Free time: 4 working day(s) counted from 2026-09-07 (start day included), ending 2026-09-11.', 'Closed or shutout dates not counted as free time: 2026-09-07.', 'Chargeable calendar days from 2026-09-12 to 2026-09-22: 11.', 'Tier 1: 5 day(s) x $65.00 = $325.00.', 'Tier 2: 6 day(s) x $120.00 = $720.00.', 'Tariff charge = $1045.00.'],
  W4c: ['Free time: 4 working day(s) counted from 2026-09-04 (start day included), ending 2026-09-10.', 'Closed or shutout dates not counted as free time: 2026-09-07.', 'Chargeable calendar days from 2026-09-11 to 2026-09-22: 12.', 'Tier 1: 5 day(s) x $80.00 = $400.00.', 'Tier 2: 7 day(s) x $150.00 = $1050.00.', 'Tariff charge = $1450.00.'],
  W5: ['Free time: 4 working day(s) counted from 2026-02-02 (start day included), ending 2026-02-05.', 'Chargeable calendar days from 2026-02-06 to 2026-02-20: 15.', 'Tier 1: 5 day(s) x $295.00 = $1475.00.', 'Tier 2: 5 day(s) x $355.00 = $1775.00.', 'Tier 3: 5 day(s) x $395.00 = $1975.00.', 'Tariff charge = $5225.00.'],
  E1: ['Free time: 4 working day(s) counted from 2026-03-02 (start day included), ending 2026-03-05.', 'Clock stopped 2026-03-05, within free time. No charge.'],
};
export const W1_STEP_LIST = W1_STEPS;
export const W3_STEP_LIST = W3_STEPS;
