// REQ-20261011-ocean-dd Tier H helpers: synthetic D&D invoices (T3 SI cases), the C9 public tariff data (restated),
// canonical-JSON sha256 (test-owned) and small request helpers for the /api/v1/dd routes. Invoices are synthetic
// (`Synthetic ...`, `SYN...`, example.com); tariff figures are the real published C9 figures.
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { Res, Session } from './client.js';
import { oCanon } from './canon-oracle.js';
import { withAdmin } from './db.js';
import * as I from './intel.js';

export const sha256Canon = (v: unknown): string => createHash('sha256').update(oCanon(v), 'utf8').digest('hex');
export const sizeCanon = (v: unknown): number => Buffer.byteLength(oCanon(v), 'utf8');
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const uniq = (p: string) => `${p} ${Math.random().toString(36).slice(2, 8)}`;

const four = (r: string) => ({ '20DV': r, '40DV': r, '40HC': r, '45HC': r });
export const MAERSK = {
  name: 'Maersk US import detention (2026)', carrier: 'Maersk', chargeType: 'DETENTION', direction: 'IMPORT',
  ruleReference: 'Maersk US import detention tariff effective 01 Jan 2026',
  sourceUrl: 'https://www.maersk.com/~/media_sc9/maersk/local-information/files/north-america/united-states-of-america/import/us-import-detention-tariff-effective-01-jan-2026.pdf',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'included', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5, 6],
  tiers: [{ days: 4, rates: four('210.00') }, { days: 4, rates: four('260.00') }, { days: null, rates: four('290.00') }],
};
export const HAPAG = {
  name: 'Hapag-Lloyd US import detention, merchant haulage (excl. California)', carrier: 'Hapag-Lloyd', chargeType: 'DETENTION', direction: 'IMPORT',
  ruleReference: 'Hapag-Lloyd USA Detention effective October 1, 2025, Import Merchant Haulage, Regular',
  sourceUrl: 'https://www.hapag-lloyd.com/content/dam/website/downloads/detention_demurrage/USA_Detention_Effective_October_01_2025.pdf',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'additional', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5],
  tiers: [{ days: 3, rates: four('200.00') }, { days: 3, rates: four('250.00') }, { days: null, rates: four('300.00') }],
};
export const MSC = {
  name: 'MSC US import demurrage (all ports except Baltimore)', carrier: 'MSC', chargeType: 'DEMURRAGE', direction: 'IMPORT',
  ruleReference: 'MSC detention, demurrage and per diem charges, A.1 import containers',
  sourceUrl: 'https://www.msc.com/-/media/files/msc-cargo/local-information/america/united-states/detention-demurrage-and-per-diem-charges.pdf',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'included', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5],
  tiers: [{ days: 5, rates: { '20DV': '65.00', '40DV': '80.00', '40HC': '80.00', '45HC': '80.00' } }, { days: null, rates: { '20DV': '120.00', '40DV': '150.00', '40HC': '150.00', '45HC': '150.00' } }],
};
export const HAPAG_CAL = { name: 'Synthetic terminal A 2026', closedDates: ['2026-07-03'], shutoutDates: ['2026-07-14'] };

export interface DdPeriodT { from: string; to: string; rate: string | null; amount: string }
export interface DdEvidenceT { clockStart: string | null; clockStop: string | null; cargoAvailableDate: string | null; emptyReturnRefusedDates: string[] }
export interface DdContainerT { [k: string]: unknown; containerNumber: string | null; sizeType: string; periods: DdPeriodT[]; evidence: DdEvidenceT }
export interface Inv { [k: string]: unknown; containers: DdContainerT[] }
export const c0 = (i: Inv): DdContainerT => {
  const c = i.containers[0];
  if (!c) throw new Error('fixture has no container');
  return c;
};
export function si1(): Inv {
  return {
    invoiceNumber: 'SYN-DD-0001', billingPartyName: 'Synthetic Ocean Line A', billingPartyType: 'OCEAN_CARRIER', billedPartyName: 'Synthetic Importer Inc',
    direction: 'IMPORT', invoiceDate: '2026-03-27', dueDate: '2026-04-26', upstreamInvoiceDate: null, billOfLadingNumbers: ['SYNBL0001'],
    portOfDischarge: 'Synthetic Port 1', liabilityBasis: 'Consignee named on the bill of lading', totalDue: '3910.00', ruleReference: 'Synthetic tariff rule DET-1',
    disputeContact: 'disputes@example.com', disputeDigitalMeans: 'https://example.com/dd-disputes', disputeRequestDays: 30, disputeResolutionDays: 30,
    certifiesFmcRules: true, certifiesPerformance: true,
    containers: [{
      containerNumber: 'SYNU0000001', sizeType: '40DV', chargeType: 'DETENTION', freeDays: 4, freeTimeStart: '2026-03-02', freeTimeEnd: '2026-03-05',
      availabilityDate: '2026-02-27', earliestReturnDate: null,
      periods: [{ from: '2026-03-06', to: '2026-03-09', rate: '210.00', amount: '840.00' }, { from: '2026-03-10', to: '2026-03-13', rate: '260.00', amount: '1040.00' }, { from: '2026-03-14', to: '2026-03-20', rate: '290.00', amount: '2030.00' }],
      evidence: { clockStart: '2026-03-02', clockStop: '2026-03-20', cargoAvailableDate: null, emptyReturnRefusedDates: [] },
    }],
  };
}
export function si4(): Inv {
  const i = si1();
  c0(i).periods = [{ from: '2026-03-05', to: '2026-03-08', rate: '210.00', amount: '840.00' }, { from: '2026-03-09', to: '2026-03-12', rate: '260.00', amount: '1040.00' }, { from: '2026-03-13', to: '2026-03-20', rate: '290.00', amount: '2320.00' }];
  i.totalDue = '4200.00';
  return i;
}
export function si6(): Inv {
  const i = si1();
  Object.assign(i, { invoiceNumber: 'SYN-DD-0006', invoiceDate: '2026-07-31', dueDate: '2026-08-30', totalDue: '2850.00' });
  Object.assign(c0(i), {
    containerNumber: 'SYNU0000006', sizeType: '40HC', freeTimeStart: '2026-07-02', freeTimeEnd: '2026-07-09', availabilityDate: '2026-07-01',
    periods: [{ from: '2026-07-10', to: '2026-07-12', rate: '200.00', amount: '600.00' }, { from: '2026-07-13', to: '2026-07-15', rate: '250.00', amount: '750.00' }, { from: '2026-07-16', to: '2026-07-20', rate: '300.00', amount: '1500.00' }],
    evidence: { clockStart: '2026-07-02', clockStop: '2026-07-20', cargoAvailableDate: null, emptyReturnRefusedDates: ['2026-07-16', '2026-07-17'] },
  });
  return i;
}
export function si8(): Inv {
  return { ...si1(), containers: si1().containers, billingPartyType: 'NVOCC', upstreamInvoiceDate: '2026-03-25', invoiceDate: '2026-04-27', dueDate: '2026-05-27' };
}
/** test-spec T3 SI-4 (MAERSK attached, no calendar): findings as stored rows (cents). */
export const SI4_FINDINGS = [
  {
    ruleId: 'DD-TARIFF-OVERCHARGE', title: 'Charges exceed the attached tariff', amountCents: 29000, needsHumanReview: false, confidence: 0.9,
    explanation: "Container SYNU0000001 (40DV, detention): the attached tariff 'Maersk US import detention (2026)' gives $3910.00 for 15 chargeable day(s), but the invoice charges $4200.00.",
    calculation: ['Clock start 2026-03-02 (your evidence); clock stop 2026-03-20 (your evidence).', 'Free time: 4 working day(s) counted from 2026-03-02 (start day included), ending 2026-03-05.', 'Chargeable calendar days from 2026-03-06 to 2026-03-20: 15.', 'Tier 1: 4 day(s) x $210.00 = $840.00.', 'Tier 2: 4 day(s) x $260.00 = $1040.00.', 'Tier 3: 7 day(s) x $290.00 = $2030.00.', 'Tariff charge = $3910.00.', 'Invoice charges for this container = $4200.00.', 'Difference = $290.00.'],
  },
  {
    // review F3: only an inaccurate item -> accuracy title and explanation
    ruleId: 'DD-541-6-CONTENT', title: 'Required invoice information inaccurate (46 CFR 541.6)', amountCents: 391000, needsHumanReview: true, confidence: 0.7,
    explanation: 'The invoice misstates 1 item(s) that 46 CFR 541.6 requires: End date of free time. 46 CFR 541.6 requires this information to be accurate - review whether to dispute the charge.',
    calculation: ['46 CFR 541.6(b)(5) End date of free time: Container SYNU0000001 is charged on 2026-03-05, on or before the stated free time end 2026-03-05.', 'Remaining invoice charges = $3910.00.'],
  },
];
/** plain(C10 46 CFR 541.6(b) text, 200): the first 197 characters followed by '...'. */
export const REG_541_6B_200 = 'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to identify the relevant time for which the charges apply and the applicable due date for invoiced charges and at a minimum must include: (1) The invoice date; (2) The invoice due date; (3) The allowed free time in days; (4) The start date of free time; (5) The end date of free time; (6) For imports, the container availability date; (7) For exports, the earliest return date; and (8) The specific date(s) for which demurrage and/or detention were charged.'.slice(0, 197) + '...';
export const REG_541_5 = 'Failure to include any of the required minimum information in this part in a demurrage or detention invoice eliminates any obligation of the billed party to pay the applicable charge.';
export const DD_PACKET_DISCLAIMER = 'Automated checks of the invoice data entered, compared with 46 CFR Part 541, 46 CFR 545.5 and the attached tariff. Not legal advice. Findings are drafts for human review; have counsel review them before relying on them.';
// Fix round 1 (C13 amended): the message covers invoices.
export const LIMIT_MSG = 'This organization has reached the maximum number of D&D tariffs, calendars or invoices.';
export const AUDIT_KEYS = {
  tariff: ['chargeType', 'dataSha256', 'direction', 'tariffId', 'tierCount', 'version'],
  calendar: ['calendarId', 'closedCount', 'dataSha256', 'shutoutCount', 'version'],
  invoice: ['containerCount', 'dataSha256', 'invoiceId', 'version'],
  deleted: ['invoiceId', 'version'],
  audited: ['calendarId', 'claimId', 'claimNumber', 'contentHash', 'findingsCount', 'invoiceId', 'packetId', 'pendingFindingsCount', 'pendingReviewCents', 'recoverableCents', 'revision', 'rulesVersion', 'snapshotSha256', 'tariffId'],
};

export const tariffs = (s: Session, qs = '') => s.get(`/dd/tariffs${qs}`);
export const calendars = (s: Session, qs = '') => s.get(`/dd/calendars${qs}`);
export const invoices = (s: Session, qs = '') => s.get(`/dd/invoices${qs}`);
export const postTariff = (s: Session, body: unknown, o = {}) => s.post('/dd/tariffs', body, o);
export const putTariff = (s: Session, id: string, body: unknown, o = {}) => I.put(s, `/dd/tariffs/${id}`, body, o);
export const postCalendar = (s: Session, body: unknown, o = {}) => s.post('/dd/calendars', body, o);
export const putCalendar = (s: Session, id: string, body: unknown, o = {}) => I.put(s, `/dd/calendars/${id}`, body, o);
export const postInvoice = (s: Session, body: unknown, o = {}) => s.post('/dd/invoices', body, o);
export const getInvoice = (s: Session, id: string) => s.get(`/dd/invoices/${id}`);
export const putInvoice = (s: Session, id: string, body: unknown, o = {}) => I.put(s, `/dd/invoices/${id}`, body, o);
export const delInvoice = (s: Session, id: string, o = {}) => s.destroy(`/dd/invoices/${id}`, o);
export const audit = (s: Session, id: string, o = {}) => s.post(`/dd/invoices/${id}/audit`, {}, o);

export function expectCode(r: Res, status: number, code: string, label = '') {
  expect(r.status, `${label} ${r.text}`).toBe(status);
  expect(r.body?.error?.code, label).toBe(code);
  if (code === 'dd_limit_reached') expect(r.body.error.message, label).toBe(LIMIT_MSG);
  expect(r.text, `${label}: no internals`).not.toMatch(/SQLSTATE|prisma|stack|\.ts:\d+|P0001/i);
}
export async function newTariff(s: Session, data: Record<string, unknown>): Promise<string> {
  const r = await postTariff(s, data);
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
}
export async function newCalendar(s: Session, data: Record<string, unknown>): Promise<string> {
  const r = await postCalendar(s, data);
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
}
export async function newInvoice(s: Session, inv: Inv, tariffId: string | null, calendarId: string | null = null): Promise<{ id: string; version: number; [k: string]: unknown }> {
  const r = await postInvoice(s, { ...inv, tariffId, calendarId });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; version: number; [k: string]: unknown };
}
/** Metadata must never carry names, numbers or free text of the invoice/tariff. */
export function noFreeText(evs: I.Ev[], banned: string[]) {
  for (const e of evs) {
    const t = JSON.stringify(e.metadata);
    for (const b of banned) expect(t.includes(b), `${e.action} metadata contains ${b}`).toBe(false);
  }
}

/** Fix round 1 (DD-A07): a maximal valid invoice, 50 containers x 20 one-day periods (synthetic). */
export function maximalInvoice(invoiceNumber: string): Inv {
  const i = si1();
  i.invoiceNumber = invoiceNumber;
  const base = c0(i);
  const periods: DdPeriodT[] = Array.from({ length: 20 }, (_, k) => {
    const d = `2026-03-${String(k + 6).padStart(2, '0')}`;
    return { from: d, to: d, rate: '290.00', amount: '290.00' };
  });
  i.containers = Array.from({ length: 50 }, (_, k) => ({ ...clone(base), containerNumber: `SYNU${String(k).padStart(7, '0')}`, periods: clone(periods), evidence: { ...clone(base.evidence), clockStop: '2026-03-25' } }));
  i.totalDue = '290000.00';
  return i;
}
/** A syntactically valid JSON body of exactly `bytes` bytes (ASCII). */
export const paddedJson = (bytes: number): string => `{"pad":"${'x'.repeat(bytes - 10)}"}`;
/** Fix round 1 (DD-A09): seed `n` DRAFT invoices directly as the owner role inside the tenant (RLS FORCE applies to the owner too). */
export async function seedDraftInvoices(tenantId: string, userId: string, n: number, prefix: string): Promise<void> {
  await withAdmin(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      await c.query(
        `insert into dd_invoices (id, tenant_id, invoice_number, billing_party_name, invoice_date, total_due_cents, data, created_by_id, updated_by_id, updated_at)
         select gen_random_uuid(), $1, $2 || '-' || g, 'Synthetic Ocean Line A', date '2026-03-27', 391000,
                jsonb_set($3::jsonb, '{invoiceNumber}', to_jsonb($2 || '-' || g)), $4, $4, now()
           from generate_series(1, $5::int) g`,
        [tenantId, prefix, JSON.stringify(si1()), userId, n],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}
