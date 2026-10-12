// REQ-20261011-ocean-dd Tier L: T7 constants, presets, regulation text and copy (DD-K01..K04; Part C C1, C9, C10,
// C18) and T8 schemas (DD-V01..V04; Part C C4), plus the shared registries of C14-C16 (RBAC, audit actions, flag).
// Every expected value is restated from Part C.
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { CASES, PRESETS_EXPECTED, clone, loadDd, si1, type DdMod, type ZodLike } from './helpers/dd-fixtures.js';
import { O_REGULATION, oCanon, type OInvoice } from './helpers/dd-oracle.js';

let M: DdMod;
beforeAll(async () => { M = await loadDd(); });

/** SHA-256 of canonicalJson(DD_REGULATION_TEXT) computed by the test helper from the restated C10 text (5,062 bytes). */
export const REGULATION_SHA256 = '202c5302ca6360d4c75bc9e172f8096a9c9e24675b09eb29bedb3b4a5f8e37b1';
/** C13/C18 as amended in fix round 1 (covers invoices). */
export const LIMIT_TEXT = 'This organization has reached the maximum number of D&D tariffs, calendars or invoices.';
const DD_TEXT = { nav: 'Ocean D&D', invoices: 'Invoices', tariffs: 'Tariffs', calendars: 'Calendars', importCsv: 'Import CSV', newInvoice: 'New invoice', newTariff: 'New tariff', newCalendar: 'New calendar', fromPreset: 'Start from a public tariff', save: 'Save', delete: 'Delete draft', runAudit: 'Run audit', auditNote: 'Creates a claim with revision 1 for review. You will be recorded as its author, so another approver must approve it.', audited: 'Audit complete. The claim is ready for review.', checks: 'Checks', findings: 'Findings', noFindings: 'No findings.', kindBadge: 'D&D', forbidden: 'You do not have permission to do this.', conflict: 'This item already exists or changed. Reload to continue.', limit: LIMIT_TEXT, invalid: 'The invoice values cannot be audited automatically.', rateLimited: 'Too many requests. Try again later.', failed: 'Something went wrong. Try again.', csvErrors: 'Rows with errors were not imported.', csvTooLarge: 'The file is too large to import.' };
const DD_NOTE = 'Checks ocean demurrage and detention invoices against the content and timing rules of 46 CFR Part 541 (in force since 28 May 2024), the incentive principle of 46 CFR 545.5 and the tariff you attach. Not legal advice. Findings are drafts for human review.';
const DD_PACKET_DISCLAIMER = 'Automated checks of the invoice data entered, compared with 46 CFR Part 541, 46 CFR 545.5 and the attached tariff. Not legal advice. Findings are drafts for human review; have counsel review them before relying on them.';
const DD_PRESET_NOTE = 'Public tariff figures as published on the retrieval date. Your service contract or a newer tariff may differ; check before use.';
const CHECK_LABELS = { part541: 'Part 541 applies', content: 'Required invoice content (541.6)', issuance: '30-day issuance (541.7)', total: 'Invoice total', line_arithmetic: 'Line arithmetic', tariff: 'Tariff recomputation', availability: 'Cargo availability (545.5)', return_refused: 'Refused empty return (545.5)' };
const STATUS_LABELS = { ok: 'OK', finding: 'Finding', not_evaluated: 'Not checked', not_applicable: 'Not applicable' };
export const DD_AUDIT_ACTIONS = ['dd_tariff.created', 'dd_tariff.updated', 'dd_calendar.created', 'dd_calendar.updated', 'dd_invoice.created', 'dd_invoice.updated', 'dd_invoice.deleted', 'dd_invoice.audited'];
const FUNCS = ['ddDayNumber', 'ddDateFromDayNumber', 'ddIsoWeekday', 'ddAddDays', 'ddDaysBetween', 'computeFreeTimeEnd', 'computeTariffCharge', 'auditDdInvoice', 'buildDdDisputeLetter', 'parseDdCsv'];
const SCHEMAS = ['DdInvoiceData', 'DdInvoiceBody', 'DdTariffData', 'DdCalendarData', 'DdTariffView', 'DdCalendarView', 'DdTariffList', 'DdCalendarList', 'DdListQuery', 'DdInvoiceListQuery', 'DdInvoiceListItem', 'DdInvoiceList', 'DdInvoiceDetail', 'DdAuditResponse'];

function isDeepFrozen(o: unknown): boolean {
  if (!o || typeof o !== 'object') return true;
  return Object.isFrozen(o) && Object.values(o as object).every(isDeepFrozen);
}

describe('T7 constants and module surface (C1)', () => {
  it('DD-K01 every C1 constant value', () => {
    expect(M.DD_RULES_VERSION).toBe('dd-rules-v1');
    expect(M.DD_RULE_IDS).toEqual(['DD-TOTAL-MISMATCH', 'DD-PERIOD-ARITH', 'DD-TARIFF-OVERCHARGE', 'DD-545-RETURN-REFUSED', 'DD-545-AVAILABILITY', 'DD-541-7-LATE', 'DD-541-6-CONTENT']);
    expect(M.DD_PART541_EFFECTIVE).toBe('2024-05-28');
    expect([M.DD_ISSUE_DEADLINE_DAYS, M.DD_DISPUTE_MIN_DAYS, M.DD_RESOLUTION_MAX_DAYS]).toEqual([30, 30, 30]);
    expect(M.DD_REGULATION_VERSION).toBe('ecfr-2026-10-07');
    expect([M.DD_CONTAINERS_MAX, M.DD_PERIODS_MAX, M.DD_TIERS_MAX, M.DD_SIZES_MAX]).toEqual([50, 20, 10, 20]);
    expect([M.DD_CALENDAR_DATES_MAX, M.DD_REFUSED_DATES_MAX, M.DD_BL_MAX]).toEqual([400, 60, 20]);
    expect([M.DD_SPAN_MAX_DAYS, M.DD_PERIOD_SPAN_MAX_DAYS]).toEqual([730, 365]);
    expect([M.DD_CSV_MAX_CHARS, M.DD_CSV_MAX_ROWS, M.DD_CSV_MAX_INVOICES]).toEqual([1000000, 2000, 50]);
    expect([M.DD_TARIFFS_MAX, M.DD_CALENDARS_MAX]).toEqual([200, 200]);
    expect({ ...M.DD_SOURCE_FILES }).toEqual({ invoice: 'dd-invoice.json', tariff: 'dd-tariff.json', calendar: 'dd-calendar.json', regulation: 'ecfr-46-cfr-541-545.5.json' });
  });
  it('DD-K01 root exports present; functions callable; schemas have safeParse', () => {
    const names = ['DD_RULES_VERSION', 'DD_RULE_IDS', 'DD_PART541_EFFECTIVE', 'DD_ISSUE_DEADLINE_DAYS', 'DD_DISPUTE_MIN_DAYS', 'DD_RESOLUTION_MAX_DAYS', 'DD_REGULATION_VERSION', 'DD_CONTAINERS_MAX', 'DD_PERIODS_MAX', 'DD_TIERS_MAX', 'DD_SIZES_MAX', 'DD_CALENDAR_DATES_MAX', 'DD_REFUSED_DATES_MAX', 'DD_BL_MAX', 'DD_SPAN_MAX_DAYS', 'DD_PERIOD_SPAN_MAX_DAYS', 'DD_CSV_MAX_CHARS', 'DD_CSV_MAX_ROWS', 'DD_CSV_MAX_INVOICES', 'DD_TARIFFS_MAX', 'DD_CALENDARS_MAX', 'DD_INVOICES_MAX', 'DD_INVOICE_PAGE_SIZE_MAX', 'DD_INVOICE_BODY_LIMIT', 'DD_CSV_MAX_FILE_BYTES', 'DD_SOURCE_FILES', 'DD_REGULATION_TEXT', 'DD_TARIFF_PRESETS', 'DD_NOTE', 'DD_PACKET_DISCLAIMER', 'DD_PRESET_NOTE', 'DD_TEXT', 'DD_CHECK_LABELS', 'DD_CHECK_STATUS_LABELS', ...SCHEMAS, ...FUNCS];
    const missing = names.filter((n) => !(n in M));
    expect(missing, 'names missing from the @fr/shared root').toEqual([]);
    for (const f of FUNCS) expect(typeof M[f], f).toBe('function');
    for (const s of SCHEMAS) expect(typeof (M[s] as ZodLike).safeParse, s).toBe('function');
    expect(M.ddAddDays('2026-03-02', 3)).toBe('2026-03-05');
    expect(M.parseDdCsv('')).toEqual(expect.objectContaining({ invoices: [] }));
  });
});

describe('T7 fix round 1 constants and copy (C1, C12, C13, C18 amended)', () => {
  it('DD-K05 constants, limit and CSV texts, DdInvoiceListQuery pageSize 1..50', () => {
    expect([M.DD_INVOICES_MAX, M.DD_INVOICE_PAGE_SIZE_MAX, M.DD_INVOICE_BODY_LIMIT, M.DD_CSV_MAX_FILE_BYTES]).toEqual([2000, 50, 262144, 4000000]);
    expect(M.DD_CSV_MAX_FILE_BYTES).toBe(4 * M.DD_CSV_MAX_CHARS);
    expect(M.DD_TEXT.limit).toBe(LIMIT_TEXT);
    expect(M.DD_TEXT.csvTooLarge).toBe('The file is too large to import.');
    const Q = M.DdInvoiceListQuery as ZodLike;
    // query values arrive as strings
    for (const ok of [{}, { pageSize: '50' }, { page: '1', pageSize: '1', status: 'AUDITED' }]) expect(Q.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    for (const bad of [{ pageSize: '51' }, { pageSize: '0' }, { page: '0' }, { status: 'OPEN' }, { extra: '1' }]) expect(Q.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const L = M.DdListQuery as ZodLike;
    expect(L.safeParse({ pageSize: '100' }).success, 'tariff/calendar lists accept 100').toBe(true);
    expect(L.safeParse({ pageSize: '101' }).success).toBe(false);
  });
});

describe('T7 presets (C9)', () => {
  it('DD-K02 ids, order, data, provenance, frozen', () => {
    const P = M.DD_TARIFF_PRESETS;
    expect(P.map((p) => p.id)).toEqual(['maersk-us-import-detention-2026', 'msc-us-import-demurrage', 'hapag-lloyd-us-import-detention-mh-2025', 'cma-cgm-us-import-demurrage-standard']);
    expect(isDeepFrozen(P), 'DD_TARIFF_PRESETS deep-frozen').toBe(true);
    P.forEach((p, k) => {
      const e = PRESETS_EXPECTED[k];
      if (!e) throw new Error('preset count');
      expect(Object.keys(p).sort(), p.id).toEqual(['data', 'id', 'provenance']);
      expect(clone(p.data), `${p.id} data`).toEqual(e.data);
      // rate key order is part of C9 ("in that key order")
      for (let j = 0; j < e.data.tiers.length; j++) expect(Object.keys(p.data.tiers[j]?.rates ?? {}), `${p.id} tier ${j + 1} key order`).toEqual(Object.keys(e.data.tiers[j]?.rates ?? {}));
      const parsed = M.DdTariffData.safeParse(clone(p.data));
      expect(parsed.success, `${p.id} passes DdTariffData`).toBe(true);
      expect(parsed.data, `${p.id} already normalized`).toEqual(e.data);
      const { document, ...rest } = p.provenance;
      const { document: _d, ...restE } = e.provenance;
      void _d;
      expect(rest, `${p.id} provenance`).toEqual(restE);
      expect(typeof document === 'string' && document.trim().length > 0, `${p.id} provenance.document is a non-empty title`).toBe(true);
      expect(p.data.sourceUrl).toBe(p.provenance.url);
      expect(p.data.sourceRetrievedOn).toBe('2026-10-11');
    });
    const cma = P.find((p) => p.id === 'cma-cgm-us-import-demurrage-standard');
    expect(cma?.provenance.verification).toBe('secondary');
  });
});

describe('T7 regulation text (C10)', () => {
  it('DD-K03 keys in order, verbatim texts, no 541.4, frozen, canonical JSON sha256 pin', () => {
    const R = M.DD_REGULATION_TEXT;
    expect(Object.keys(R)).toEqual(Object.keys(O_REGULATION));
    for (const [k, v] of Object.entries(O_REGULATION)) expect(R[k], k).toBe(v);
    expect(Object.keys(R).some((k) => k.includes('541.4'))).toBe(false);
    expect(Object.isFrozen(R)).toBe(true);
    const a = M.canonicalJson(R);
    expect(a).toBe(oCanon(O_REGULATION));
    expect(M.canonicalJson(R)).toBe(a);
    expect(createHash('sha256').update(a, 'utf8').digest('hex')).toBe(REGULATION_SHA256);
    expect(Buffer.byteLength(a, 'utf8')).toBe(5062);
  });
});

describe('T7 copy and honesty (C18)', () => {
  it('DD-K04 copy strings exactly; Not legal advice; no dishonest wording', () => {
    expect(M.DD_NOTE).toBe(DD_NOTE);
    expect(M.DD_PACKET_DISCLAIMER).toBe(DD_PACKET_DISCLAIMER);
    expect(M.DD_PRESET_NOTE).toBe(DD_PRESET_NOTE);
    expect({ ...M.DD_TEXT }).toEqual(DD_TEXT);
    expect({ ...M.DD_CHECK_LABELS }).toEqual(CHECK_LABELS);
    expect({ ...M.DD_CHECK_STATUS_LABELS }).toEqual(STATUS_LABELS);
    expect(M.DD_NOTE).toContain('Not legal advice.');
    expect(M.DD_PACKET_DISCLAIMER).toContain('Not legal advice.');
    const all = [M.DD_NOTE, M.DD_PACKET_DISCLAIMER, M.DD_PRESET_NOTE, ...Object.values(M.DD_TEXT), ...Object.values(M.DD_CHECK_LABELS), ...Object.values(M.DD_CHECK_STATUS_LABELS)];
    for (const s of all) expect(s, s).not.toMatch(/accurate|guarantee|compliant|\d\s?%|percent/i);
  });
});

describe('C14-C16 shared registries (additive)', () => {
  it('RBAC: dd_invoices:manage and dd_tariffs:manage exactly per C14', () => {
    const can = M.can as (r: string, p: string) => boolean;
    for (const r of ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN']) {
      expect(can(r, 'dd_invoices:manage'), `${r} dd_invoices:manage`).toBe(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST'].includes(r));
      expect(can(r, 'dd_tariffs:manage'), `${r} dd_tariffs:manage`).toBe(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'].includes(r));
    }
  });
  it('AUDIT_ACTIONS ends with the C15 actions after price_data.imported (created before updated)', () => {
    const a = [...(M.AUDIT_ACTIONS as string[])];
    const i = a.indexOf('price_data.imported');
    expect(i).toBeGreaterThan(0);
    // REQ-20261012-hardening C9/C15 (additive): the three hardening actions follow the C15 step-8 actions.
    expect(a.slice(i + 1)).toEqual([...DD_AUDIT_ACTIONS, 'claim.analysis_failed', 'auth.password.change_failed', 'invite.existing_account']);
    expect(new Set(a).size).toBe(a.length);
  });
  it('flag registry entry intelligence.ocean_dd (C16), key order', () => {
    const F = M.FEATURE_FLAGS as { key: string }[];
    expect({ ...F.find((f) => f.key === 'intelligence.ocean_dd') }).toEqual({ key: 'intelligence.ocean_dd', description: 'Ocean demurrage and detention invoice audit', defaultEnabled: true, tenantVisible: true });
    expect(F.map((f) => f.key)).toEqual(['intelligence.charge_suggestions', 'intelligence.cost_outlook', 'intelligence.fuel_check', 'intelligence.ocean_dd', 'intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T8 schemas
// ---------------------------------------------------------------------------------------------------------------
const ok = (s: ZodLike, x: unknown) => s.safeParse(x).success;
const inv = (f: (i: OInvoice & Record<string, unknown>) => void): unknown => { const i = si1() as OInvoice & Record<string, unknown>; f(i); return i; };
const ctr = (i: OInvoice) => {
  const c = i.containers[0];
  if (!c) throw new Error('no container');
  return c;
};
const tariffBase = () => clone(PRESETS_EXPECTED[0]?.data);

describe('T8 schemas (C4)', () => {
  it('DD-V01 SI inputs parse; idempotent; normalization', () => {
    for (const [id, mk] of Object.entries(CASES)) {
      const c = mk();
      const p = M.DdInvoiceData.safeParse(clone(c.invoice));
      expect(p.success, id).toBe(true);
      expect(p.data, `${id} unchanged by normalization`).toEqual(c.invoice);
      expect(M.DdInvoiceData.parse(p.data), `${id} parse(parse(x))`).toEqual(p.data);
    }
    const raw = inv((i) => {
      const c = ctr(i);
      const [p0, p1, p2] = c.periods;
      if (!p0 || !p1 || !p2) throw new Error('periods');
      p0.rate = '210';
      p1.amount = '1040';
      c.periods = [p2, p0, p1];
      c.evidence.emptyReturnRefusedDates = ['2026-03-19', '2026-03-15'];
      i.totalDue = '3910';
    });
    const n = M.DdInvoiceData.parse(raw) as OInvoice;
    expect(ctr(n).periods.map((p) => [p.from, p.rate, p.amount])).toEqual([['2026-03-06', '210.00', '840.00'], ['2026-03-10', '260.00', '1040.00'], ['2026-03-14', '290.00', '2030.00']]);
    expect(ctr(n).evidence.emptyReturnRefusedDates).toEqual(['2026-03-15', '2026-03-19']);
    expect(n.totalDue).toBe('3910.00');
    const half = M.DdInvoiceData.parse(inv((i) => { i.totalDue = '0.5'; })) as OInvoice;
    expect(half.totalDue).toBe('0.50');
    const t = M.DdTariffData.parse({ ...tariffBase(), workingWeekdays: [6, 1, 3] }) as { workingWeekdays: number[] };
    expect(t.workingWeekdays).toEqual([1, 3, 6]);
    const k = M.DdCalendarData.parse({ name: 'Synthetic cal', closedDates: ['2026-07-03', '2026-01-01'], shutoutDates: ['2026-07-14', '2026-02-01'] }) as { closedDates: string[]; shutoutDates: string[] };
    expect([k.closedDates, k.shutoutDates]).toEqual([['2026-01-01', '2026-07-03'], ['2026-02-01', '2026-07-14']]);
    expect(ok(M.DdInvoiceBody, { ...si1(), tariffId: null, calendarId: null })).toBe(true);
    expect(ok(M.DdInvoiceBody, { ...si1(), tariffId: '00000000-0000-4000-8000-000000000001', calendarId: null })).toBe(true);
    expect(ok(M.DdInvoiceBody, { ...si1(), tariffId: 'not-a-uuid', calendarId: null })).toBe(false);
  });
  it('DD-V02 invoice refusals (each separately)', () => {
    const bad: [string, unknown][] = [
      ['unknown top-level key', inv((i) => { i.extra = 1; })],
      ['unknown container key', inv((i) => { (ctr(i) as unknown as Record<string, unknown>).extra = 1; })],
      ['unknown period key', inv((i) => { (ctr(i).periods[0] as unknown as Record<string, unknown>).extra = 1; })],
      ['unknown evidence key', inv((i) => { (ctr(i).evidence as unknown as Record<string, unknown>).extra = 1; })],
      ...['-1.00', '1.234', '10000000.00', '1e3'].map((a) => [`amount ${a}`, inv((i) => { const p = ctr(i).periods[0]; if (p) p.amount = a; })] as [string, unknown]),
      ['sizeType 40dv', inv((i) => { ctr(i).sizeType = '40dv'; })],
      ['containers []', inv((i) => { i.containers = []; })],
      ['51 containers', inv((i) => { i.containers = Array.from({ length: 51 }, () => clone(ctr(i))); })],
      ['21 periods', inv((i) => { ctr(i).periods = Array.from({ length: 21 }, (_, k) => ({ from: `2026-01-${String(k + 1).padStart(2, '0')}`, to: `2026-01-${String(k + 1).padStart(2, '0')}`, rate: '1.00', amount: '1.00' })); })],
      ['overlapping periods', inv((i) => { const p = ctr(i).periods[1]; if (p) p.from = '2026-03-09'; })],
      ['from > to', inv((i) => { const p = ctr(i).periods[0]; if (p) { p.from = '2026-03-10'; p.to = '2026-03-09'; } })],
      ['period of 367 days', inv((i) => { ctr(i).periods = [{ from: '2026-01-01', to: '2027-01-02', rate: null, amount: '1.00' }]; })],
      ['clockStart > clockStop', inv((i) => { ctr(i).evidence.clockStart = '2026-03-21'; })],
      ['clock span 731 days', inv((i) => { ctr(i).evidence.clockStart = '2024-03-19'; })],
      ['61 refused dates', inv((i) => { ctr(i).evidence.emptyReturnRefusedDates = Array.from({ length: 61 }, (_, k) => `2026-0${4 + Math.floor(k / 28)}-${String((k % 28) + 1).padStart(2, '0')}`); })],
      ['duplicate refused dates', inv((i) => { ctr(i).evidence.emptyReturnRefusedDates = ['2026-03-15', '2026-03-15']; })],
      ['freeDays 61', inv((i) => { ctr(i).freeDays = 61; })],
      ['disputeRequestDays 366', inv((i) => { i.disputeRequestDays = 366; })],
      ['control character', inv((i) => { i.billingPartyName = `Synthetic${String.fromCharCode(7)}Line`; })],
      ['bidi character', inv((i) => { i.billingPartyName = `Synthetic${String.fromCharCode(0x202e)}Line`; })],
      ['container number with a control character', inv((i) => { ctr(i).containerNumber = `SYNU${String.fromCharCode(1)}1`; })],
      ['121-character billing party', inv((i) => { i.billingPartyName = 'S'.repeat(121); })],
      ['21 B/L numbers', inv((i) => { i.billOfLadingNumbers = Array.from({ length: 21 }, (_, k) => `SYNBL${k}`); })],
      ['duplicate B/L numbers', inv((i) => { i.billOfLadingNumbers = ['SYNBL0001', 'SYNBL0001']; })],
    ];
    for (const [label, x] of bad) expect(ok(M.DdInvoiceData, x), label).toBe(false);
    // positive controls at the limits
    expect(ok(M.DdInvoiceData, inv((i) => { i.billingPartyName = 'S'.repeat(120); })), '120 characters').toBe(true);
    expect(ok(M.DdInvoiceData, inv((i) => { ctr(i).freeDays = 60; })), 'freeDays 60').toBe(true);
    expect(ok(M.DdInvoiceData, inv((i) => { ctr(i).evidence.clockStart = '2024-03-20'; })), 'clock span 730').toBe(true);
    expect(ok(M.DdInvoiceData, inv((i) => { ctr(i).periods = [{ from: '2026-01-01', to: '2027-01-01', rate: null, amount: '1.00' }]; })), 'period of 366 days (to - from = 365)').toBe(true);
    expect(ok(M.DdInvoiceData, inv((i) => { i.containers = Array.from({ length: 50 }, () => clone(ctr(i))); })), '50 containers').toBe(true);
    expect(ok(M.DdInvoiceData, inv((i) => { const p = ctr(i).periods[0]; if (p) p.amount = '9999999.99'; })), 'amount 9999999.99').toBe(true);
  });
  it('DD-V03 tariff refusals', () => {
    const t = (f: (x: Record<string, unknown> & { tiers: { days: number | null; rates: Record<string, string> }[] }) => void) => { const x = tariffBase() as unknown as Record<string, unknown> & { tiers: { days: number | null; rates: Record<string, string> }[] }; f(x); return x; };
    expect(ok(M.DdTariffData, tariffBase())).toBe(true);
    const bad: [string, unknown][] = [
      ['last tier with days', t((x) => { const l = x.tiers[2]; if (l) l.days = 5; })],
      ['non-last tier without days', t((x) => { const l = x.tiers[0]; if (l) l.days = null; })],
      ['different rate keys', t((x) => { const l = x.tiers[1]; if (l) l.rates = { '20DV': '260.00' }; })],
      ['rate 0.00', t((x) => { const l = x.tiers[0]; if (l) l.rates = { ...l.rates, '40DV': '0.00' }; })],
      ['11 tiers', t((x) => { x.tiers = [...Array.from({ length: 10 }, () => ({ days: 1, rates: { '40DV': '1.00' } })), { days: null, rates: { '40DV': '1.00' } }]; })],
      ['21 sizes', t((x) => { const r = Object.fromEntries(Array.from({ length: 21 }, (_, k) => [`${String(10 + k)}DV`, '1.00'])); x.tiers = [{ days: null, rates: r }]; })],
      ['workingWeekdays []', t((x) => { x.workingWeekdays = []; })],
      ['workingWeekdays [0]', t((x) => { x.workingWeekdays = [0]; })],
      ['workingWeekdays [8]', t((x) => { x.workingWeekdays = [8]; })],
      ['workingWeekdays duplicates', t((x) => { x.workingWeekdays = [1, 1]; })],
      ['sourceUrl http', t((x) => { x.sourceUrl = 'http://example.com/tariff.pdf'; })],
      ['sourceUrl with credentials', t((x) => { x.sourceUrl = 'https://user:pw@x.test/'; })],
      ['sourceUrl javascript:', t((x) => { x.sourceUrl = 'javascript:alert(1)'; })],
      ['unknown key', t((x) => { x.extra = true; })],
    ];
    for (const [label, x] of bad) expect(ok(M.DdTariffData, x), label).toBe(false);
    expect(ok(M.DdTariffData, t((x) => { x.tiers = [...Array.from({ length: 9 }, () => ({ days: 1, rates: { '40DV': '1.00' } })), { days: null, rates: { '40DV': '1.00' } }]; })), '10 tiers').toBe(true);
  });
  it('DD-V04 calendar refusals', () => {
    const many = Array.from({ length: 401 }, (_, k) => new Date(Date.UTC(2030, 0, 1) + k * 86400000).toISOString().slice(0, 10));
    expect(ok(M.DdCalendarData, { name: 'Synthetic', closedDates: many.slice(0, 400), shutoutDates: [] }), '400 dates').toBe(true);
    expect(ok(M.DdCalendarData, { name: 'Synthetic', closedDates: many, shutoutDates: [] }), '401 dates').toBe(false);
    expect(ok(M.DdCalendarData, { name: 'Synthetic', closedDates: [], shutoutDates: many }), '401 shutout dates').toBe(false);
    expect(ok(M.DdCalendarData, { name: 'Synthetic', closedDates: ['2026-07-03'], shutoutDates: ['2026-07-03'] }), 'date in both lists').toBe(false);
    expect(ok(M.DdCalendarData, { name: 'Synthetic', closedDates: ['2026-07-03', '2026-07-03'], shutoutDates: [] }), 'duplicate').toBe(false);
    expect(ok(M.DdCalendarData, { name: 'Synthetic', closedDates: ['2026-02-30'], shutoutDates: [] }), 'invalid date').toBe(false);
    expect(ok(M.DdCalendarData, { name: 'Synthetic', closedDates: [], shutoutDates: [], extra: 1 }), 'unknown key').toBe(false);
  });
});
