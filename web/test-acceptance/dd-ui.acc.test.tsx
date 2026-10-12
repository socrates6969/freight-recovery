// @vitest-environment jsdom
// REQ-20261011-ocean-dd Tier H web, SHOULD-HAVE S1: T14 /ocean screens (DD-W01..W06; Part C C18). AppRoot with a
// scripted fetch serving contract-shaped DTOs (previews computed with the product's shared auditDdInvoice on the
// synthetic SI-4 invoice). Set ACC_SKIP_OCEAN_UI=1 when S1 was cut (recorded in test-plan.md).
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderApp, setupDom } from './helpers/render.js';
import { createStub, json, mkClaim, type RoleName } from './helpers/stub.js';

const SKIP = process.env.ACC_SKIP_OCEAN_UI === '1';
/** Accessible name of the CSV file input (not fixed by C18; taken from the S1 UI). */
const CSV_INPUT = 'CSV file';
const WAIT = { timeout: 5000 };
const NOW = '2026-10-11T10:00:00.000Z';
const SERVER_TEXT = 'SERVER-SIDE-DETAIL-MUST-NOT-RENDER';
const HOSTILE = '<img src=x onerror=alert(1)>';
const FEATS: Record<string, boolean> = { 'intelligence.charge_suggestions': true, 'intelligence.cost_outlook': true, 'intelligence.fuel_check': true, 'intelligence.ocean_dd': true, 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true };
const DD_NOTE = 'Checks ocean demurrage and detention invoices against the content and timing rules of 46 CFR Part 541 (in force since 28 May 2024), the incentive principle of 46 CFR 545.5 and the tariff you attach. Not legal advice. Findings are drafts for human review.';
const DD_PRESET_NOTE = 'Public tariff figures as published on the retrieval date. Your service contract or a newer tariff may differ; check before use.';
const TXT = {
  nav: 'Ocean D&D', invoices: 'Invoices', tariffs: 'Tariffs', calendars: 'Calendars', importCsv: 'Import CSV', newTariff: 'New tariff', newInvoice: 'New invoice', newCalendar: 'New calendar', fromPreset: 'Start from a public tariff',
  runAudit: 'Run audit', audited: 'Audit complete. The claim is ready for review.', forbidden: 'You do not have permission to do this.', conflict: 'This item already exists or changed. Reload to continue.',
  limit: 'This organization has reached the maximum number of D&D tariffs, calendars or invoices.', csvTooLarge: 'The file is too large to import.', invalid: 'The invoice values cannot be audited automatically.', rateLimited: 'Too many requests. Try again later.',
  failed: 'Something went wrong. Try again.', csvErrors: 'Rows with errors were not imported.', kindBadge: 'D&D',
};
const CHECK_LABELS = ['Part 541 applies', 'Required invoice content (541.6)', '30-day issuance (541.7)', 'Invoice total', 'Line arithmetic', 'Tariff recomputation', 'Cargo availability (545.5)', 'Refused empty return (545.5)'];
/** C14 permissions as /me would list them (the shared web stub predates step 8, so /me is overridden here). */
const PERMS: Record<RoleName, string[]> = {
  OWNER: ['claims:read', 'claims:analyze', 'packets:edit', 'packets:approve', 'dd_invoices:manage', 'dd_tariffs:manage'],
  ADMIN: ['claims:read', 'claims:analyze', 'packets:edit', 'packets:approve', 'dd_invoices:manage', 'dd_tariffs:manage'],
  MANAGER: ['claims:read', 'claims:analyze', 'packets:edit', 'packets:approve', 'dd_invoices:manage', 'dd_tariffs:manage'],
  REVIEWER: ['claims:read', 'claims:analyze', 'packets:edit', 'packets:approve', 'dd_invoices:manage', 'dd_tariffs:manage'],
  ANALYST: ['claims:read', 'claims:analyze', 'dd_invoices:manage'],
  VIEWER: ['claims:read'],
  PLATFORM_DEV: ['platform:health', 'platform:logs', 'platform:flags', 'platform:eval'],
  SUPER_ADMIN: ['platform:health', 'platform:tenants:list', 'platform:cross_tenant_read', 'platform:audit'],
};
const U = (n: number) => `00000000-0000-4000-8000-${String(880000 + n).padStart(12, '0')}`;
const four = (r: string) => ({ '20DV': r, '40DV': r, '40HC': r, '45HC': r });
const MAERSK = {
  name: 'Maersk US import detention (2026)', carrier: 'Maersk', chargeType: 'DETENTION', direction: 'IMPORT', ruleReference: 'Maersk US import detention tariff effective 01 Jan 2026',
  sourceUrl: 'https://www.maersk.com/~/media_sc9/maersk/local-information/files/north-america/united-states-of-america/import/us-import-detention-tariff-effective-01-jan-2026.pdf',
  sourceRetrievedOn: '2026-10-11', freeDays: 4, freeDayBasis: 'working', startDayRule: 'included', chargeDayBasis: 'calendar', workingWeekdays: [1, 2, 3, 4, 5, 6],
  tiers: [{ days: 4, rates: four('210.00') }, { days: 4, rates: four('260.00') }, { days: null, rates: four('290.00') }],
};
function si4(over: Record<string, unknown> = {}) {
  return {
    invoiceNumber: 'SYN-DD-0004', billingPartyName: 'Synthetic Ocean Line A', billingPartyType: 'OCEAN_CARRIER', billedPartyName: 'Synthetic Importer Inc', direction: 'IMPORT',
    invoiceDate: '2026-03-27', dueDate: '2026-04-26', upstreamInvoiceDate: null, billOfLadingNumbers: ['SYNBL0001'], portOfDischarge: 'Synthetic Port 1',
    liabilityBasis: 'Consignee named on the bill of lading', totalDue: '4200.00', ruleReference: 'Synthetic tariff rule DET-1', disputeContact: 'disputes@example.com',
    disputeDigitalMeans: 'https://example.com/dd-disputes', disputeRequestDays: 30, disputeResolutionDays: 30, certifiesFmcRules: true, certifiesPerformance: true,
    containers: [{
      containerNumber: 'SYNU0000001', sizeType: '40DV', chargeType: 'DETENTION', freeDays: 4, freeTimeStart: '2026-03-02', freeTimeEnd: '2026-03-05', availabilityDate: '2026-02-27', earliestReturnDate: null,
      periods: [{ from: '2026-03-05', to: '2026-03-08', rate: '210.00', amount: '840.00' }, { from: '2026-03-09', to: '2026-03-12', rate: '260.00', amount: '1040.00' }, { from: '2026-03-13', to: '2026-03-20', rate: '290.00', amount: '2320.00' }],
      evidence: { clockStart: '2026-03-02', clockStop: '2026-03-20', cargoAvailableDate: null, emptyReturnRefusedDates: [] },
    }],
    ...over,
  };
}
interface Shared { auditDdInvoice(a: unknown): unknown; DD_TARIFF_PRESETS: { id: string; data: Record<string, unknown>; provenance: { carrier: string; document: string; retrieved: string; verification: string; assumptions: string[] } }[] }
let SH: Shared;
beforeAll(async () => { SH = (await import('@fr/shared')) as unknown as Shared; });

const err = (status: number, code: string) => json(status, { error: { code, message: SERVER_TEXT, requestId: 'r' } });
const INV_ID = U(1);
const TARIFF_ID = U(2);
function detail(status: 'DRAFT' | 'AUDITED', inv = si4()) {
  return {
    id: INV_ID, status, version: 1, invoice: { ...inv, tariffId: TARIFF_ID, calendarId: null }, claimId: status === 'AUDITED' ? U(9) : null, claimNumber: status === 'AUDITED' ? 'CLM-0042' : null,
    auditedAt: status === 'AUDITED' ? NOW : null, createdAt: NOW, updatedAt: NOW, preview: SH.auditDdInvoice({ invoice: inv, tariff: MAERSK, calendar: null }),
  };
}
const listItem = (inv = si4()) => ({ id: INV_ID, status: 'DRAFT', version: 1, invoiceNumber: inv.invoiceNumber, billingPartyName: inv.billingPartyName, direction: 'IMPORT', invoiceDate: '2026-03-27', totalDueCents: 420000, containerCount: 1, claimId: null, auditedAt: null, updatedAt: NOW });

interface StubO { features?: Record<string, boolean>; audit?: () => Response; inv?: ReturnType<typeof si4>; status?: 'DRAFT' | 'AUDITED'; claims?: unknown[]; tariffName?: string }
function mkStub(role: RoleName, o: StubO = {}) {
  const stub = createStub({ role, claims: o.claims ?? [mkClaim(1)] });
  const calls: { method: string; path: string; body: unknown }[] = [];
  const inv = o.inv ?? si4();
  stub.on('GET', /\/me$/, () => json(200, { user: stub.user, permissions: PERMS[role] }));
  stub.on('GET', /\/features$/, () => json(200, { flags: o.features ?? FEATS }));
  stub.on('GET', /\/dd\/invoices(\?.*)?$/, () => json(200, { items: [listItem(inv)], page: 1, pageSize: 25, total: 1 }));
  stub.on('GET', /\/dd\/invoices\/[^/]+$/, () => json(200, detail(o.status ?? 'DRAFT', inv)));
  stub.on('POST', /\/dd\/invoices\/[^/]+\/audit$/, (call) => {
    calls.push({ method: 'POST', path: call.path, body: call.body });
    return o.audit ? o.audit() : json(201, { invoiceId: INV_ID, claim: { id: U(9), claimNumber: 'CLM-0042', status: 'PENDING_REVIEW', recoverableCents: 29000, pendingReviewCents: 391000, amountClaimedCents: 420000 }, packet: { id: U(10), revision: 1, status: 'PENDING_REVIEW', contentHash: 'c'.repeat(64) }, audit: { rulesVersion: 'dd-rules-v1', findingsCount: 2, pendingFindingsCount: 1 } });
  });
  stub.on('GET', /\/dd\/tariffs(\?.*)?$/, () => json(200, { items: [{ id: TARIFF_ID, version: 1, data: { ...MAERSK, name: o.tariffName ?? MAERSK.name }, createdAt: NOW, updatedAt: NOW }], page: 1, pageSize: 25, total: 1 }));
  stub.on('GET', /\/dd\/calendars(\?.*)?$/, () => json(200, { items: [], page: 1, pageSize: 25, total: 0 }));
  stub.on('POST', /\/dd\/tariffs$/, (call) => { calls.push({ method: 'POST', path: call.path, body: call.body }); return json(201, { id: U(3), version: 1, data: call.body, createdAt: NOW, updatedAt: NOW }); });
  return { stub, calls };
}
async function openOcean(role: RoleName, o: StubO = {}) {
  const m = mkStub(role, o);
  const r = await renderApp(m.stub, ['/claims']);
  await r.user.click(await screen.findByRole('link', { name: TXT.nav }, WAIT));
  return { ...m, ...r };
}
async function openInvoice(role: RoleName, o: StubO = {}) {
  const r = await openOcean(role, o);
  // the invoice list opens a row with a button named by the invoice number
  await r.user.click(await screen.findByRole('button', { name: (o.inv ?? si4()).invoiceNumber }, WAIT));
  await screen.findByText(DD_NOTE, {}, WAIT);
  return r;
}

setupDom();
afterEach(() => { vi.restoreAllMocks(); });

describe.skipIf(SKIP)('T14 web /ocean (C18)', () => {
  it('DD-W01 nav item only with the flag on and claims:read; /ocean shows the four tabs; tab controls follow permissions', async () => {
    const { view } = await openOcean('OWNER');
    for (const t of [TXT.invoices, TXT.tariffs, TXT.calendars, TXT.importCsv]) expect(await screen.findByRole('tab', { name: t }, WAIT)).toBeTruthy();
    view.unmount();
    const off = mkStub('OWNER', { features: { ...FEATS, 'intelligence.ocean_dd': false } });
    const r2 = await renderApp(off.stub, ['/claims']);
    await screen.findByRole('navigation', { name: 'Main' }, WAIT);
    await waitFor(() => expect(screen.queryByRole('link', { name: TXT.nav })).toBeNull(), WAIT);
    r2.view.unmount();
    const fails = mkStub('OWNER');
    fails.stub.on('GET', /\/features$/, () => err(500, 'internal'));
    const r3 = await renderApp(fails.stub, ['/claims']);
    await screen.findByRole('navigation', { name: 'Main' }, WAIT);
    await waitFor(() => expect(screen.queryByRole('link', { name: TXT.nav }), 'flag read error counts as off').toBeNull(), WAIT);
    r3.view.unmount();
    const v = await openOcean('VIEWER');
    await screen.findByRole('tab', { name: TXT.invoices }, WAIT);
    expect(screen.queryByRole('button', { name: TXT.newInvoice })).toBeNull();
    await v.user.click(screen.getByRole('tab', { name: TXT.tariffs }));
    await screen.findByText(MAERSK.name, { exact: false }, WAIT);
    expect(screen.queryByRole('button', { name: TXT.newTariff })).toBeNull();
    v.view.unmount();
    const a = await openOcean('ANALYST');
    expect(await screen.findByRole('button', { name: TXT.newInvoice }, WAIT)).toBeTruthy();
    await a.user.click(screen.getByRole('tab', { name: TXT.tariffs }));
    await screen.findByText(MAERSK.name, { exact: false }, WAIT);
    expect(screen.queryByRole('button', { name: TXT.newTariff }), 'ANALYST lacks dd_tariffs:manage').toBeNull();
  });
  it('DD-W02 invoice detail: note, check labels, findings with amounts and "needs human review"; Run audit -> toast and claim link', async () => {
    const { user, calls } = await openInvoice('ANALYST');
    for (const l of CHECK_LABELS.slice(0, 5)) expect(screen.getAllByText(l, { exact: false }).length, l).toBeGreaterThan(0);
    for (const t of ['DD-TARIFF-OVERCHARGE', 'Charges exceed the attached tariff', '$290.00', 'DD-541-6-CONTENT', '$3910.00']) expect(screen.getAllByText(t, { exact: false }).length, t).toBeGreaterThan(0);
    expect(screen.getAllByText(/needs human review/i).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: TXT.runAudit }));
    await screen.findByText(TXT.audited, { exact: false }, WAIT);
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/audit'))).toHaveLength(1);
    // C18 "links to the claim": a link to the new claim's route (its text is not fixed by the contract)
    await waitFor(() => expect(screen.getAllByRole('link').some((l) => (l.getAttribute('href') ?? '').endsWith(`/claims/${U(9)}`))).toBe(true), WAIT);
  });
  it('DD-W02 Run audit hidden for AUDITED invoices and for users without claims:analyze', async () => {
    const a = await openInvoice('ANALYST', { status: 'AUDITED' });
    expect(screen.queryByRole('button', { name: TXT.runAudit })).toBeNull();
    a.view.unmount();
    await openInvoice('VIEWER');
    expect(screen.queryByRole('button', { name: TXT.runAudit })).toBeNull();
  });
  it.each([
    [403, 'forbidden', TXT.forbidden], [409, 'invalid_state', TXT.conflict], [409, 'dd_limit_reached', TXT.limit], [422, 'analysis_input_invalid', TXT.invalid],
    [429, 'rate_limited', TXT.rateLimited], [500, 'internal', TXT.failed],
  ] as const)('DD-W02 audit error %i %s -> alert text; server text never shown', async (status, code, text) => {
    const { user } = await openInvoice('ANALYST', { audit: () => err(status, code) });
    await user.click(screen.getByRole('button', { name: TXT.runAudit }));
    const alert = await screen.findByRole('alert', {}, WAIT);
    await waitFor(() => expect(alert.textContent).toContain(text), WAIT);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });
  it('DD-W03 tariff form: each preset fills the form and shows the preset note and provenance', async () => {
    const { user } = await openOcean('OWNER');
    await user.click(await screen.findByRole('tab', { name: TXT.tariffs }, WAIT));
    await user.click(await screen.findByRole('button', { name: TXT.newTariff }, WAIT));
    const select = await screen.findByLabelText(TXT.fromPreset, {}, WAIT);
    for (const p of SH.DD_TARIFF_PRESETS) {
      await user.selectOptions(select, p.id);
      await screen.findByText(DD_PRESET_NOTE, { exact: false }, WAIT);
      // REQ-20261012-hardening C7.7 (contract change): the verification enum is shown as `Verification: ` + its C6 text.
      const vText = `Verification: ${(SH as unknown as { DD_PRESET_VERIFICATION_TEXT: Record<string, string> }).DD_PRESET_VERIFICATION_TEXT[p.provenance.verification]}`;
      for (const t of [p.provenance.carrier, p.provenance.document, p.provenance.retrieved, vText, ...p.provenance.assumptions]) expect(screen.getAllByText(t, { exact: false }).length, `${p.id}: ${t}`).toBeGreaterThan(0);
      // HD-W09 (hardening C7.7): no raw verification enum next to "Verification: "
      expect(document.body.textContent, `${p.id}: raw enum`).not.toContain('primary_search_extract');
      expect(document.body.textContent).not.toMatch(/Verification: (primary|secondary)\b/);
      expect((screen.getByLabelText('Name') as HTMLInputElement).value, `${p.id} fills the name`).toBe(p.data.name);
      expect((screen.getByLabelText('Carrier') as HTMLInputElement).value).toBe(p.data.carrier);
    }
  });
  it('DD-W04 CSV tab: an invalid file shows csvErrors with row/column/code; an oversize file is refused without parsing', async () => {
    const { user } = await openOcean('ANALYST');
    await user.click(await screen.findByRole('tab', { name: TXT.importCsv }, WAIT));
    const input = (await screen.findByLabelText(CSV_INPUT, { selector: 'input' }, WAIT)) as HTMLInputElement;
    const header = 'invoice_number,billing_party,billing_party_type,billed_party,direction,invoice_date,due_date,upstream_invoice_date,bl_numbers,port_of_discharge,liability_basis,total_due,rule_reference,dispute_contact,dispute_digital_means,dispute_request_days,dispute_resolution_days,certifies_fmc_rules,certifies_performance,container_number,size_type,charge_type,free_days,free_time_start,free_time_end,availability_date,earliest_return_date,period_from,period_to,rate,amount,clock_start,clock_stop,cargo_available_date,return_refused_dates';
    const row = 'SYN-DD-0001,Synthetic Ocean Line A,ocean_carrier,Synthetic Importer Inc,import,03/27/2026,2026-04-26,,SYNBL0001,Synthetic Port 1,Consignee named on the bill of lading,840.00,Synthetic tariff rule DET-1,disputes@example.com,https://example.com/dd-disputes,30,30,yes,yes,SYNU0000001,40dv,detention,4,2026-03-02,2026-03-05,2026-02-27,,2026-03-06,2026-03-09,210,840.00,2026-03-02,2026-03-20,,';
    await user.upload(input, new File([`${header}\n${row}\n`], 'dd.csv', { type: 'text/csv' }));
    await screen.findByText(TXT.csvErrors, { exact: false }, WAIT);
    for (const t of ['invoice_date', 'invalid_value']) expect(screen.getAllByText(t, { exact: false }).length, t).toBeGreaterThan(0);
    // C18 (review F6): more than 1,000,000 characters is refused before parsing with csvTooLarge
    await user.upload(input, new File(['x'.repeat(1_000_001)], 'big.csv', { type: 'text/csv' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(TXT.csvTooLarge), WAIT);
    expect(screen.queryByText(TXT.csvErrors, { exact: false }), 'not parsed').toBeNull();
  });
  it('DD-W07 a 4,000,001-byte CSV file is refused before reading (alert csvTooLarge, no read, no request); exactly 4,000,000 bytes is read; > 1,000,000 characters refused before parsing; 1,000,000 characters parsed', async () => {
    const reads = [vi.spyOn(Blob.prototype, 'text'), vi.spyOn(Blob.prototype, 'arrayBuffer'), vi.spyOn(FileReader.prototype, 'readAsText'), vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')];
    const read = () => reads.reduce((n, sp) => n + sp.mock.calls.length, 0);
    const { user, stub } = await openOcean('ANALYST');
    await user.click(await screen.findByRole('tab', { name: TXT.importCsv }, WAIT));
    const input = (await screen.findByLabelText(CSV_INPUT, { selector: 'input' }, WAIT)) as HTMLInputElement;
    const before = stub.calls.length;
    await user.upload(input, new File(['x'.repeat(4_000_001)], 'big.csv', { type: 'text/csv' }));
    const alert = await screen.findByRole('alert', {}, WAIT);
    await waitFor(() => expect(alert.textContent).toContain(TXT.csvTooLarge), WAIT);
    expect(read(), 'file contents never read').toBe(0);
    expect(stub.calls.slice(before).filter((c) => c.method !== 'GET'), 'no request sent').toEqual([]);
    await user.upload(input, new File(['x'.repeat(4_000_000)], 'edge.csv', { type: 'text/csv' }));
    await waitFor(() => expect(read(), 'exactly 4,000,000 bytes is read').toBeGreaterThan(0), WAIT);
    // DD-W07 as amended (review F6): more than 1,000,000 characters -> refused before parsing with csvTooLarge
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(TXT.csvTooLarge), WAIT);
    expect(screen.queryByRole('table', { name: 'Invoices to import' }), 'nothing parsed into invoices').toBeNull();
    expect(screen.queryByText(TXT.csvErrors, { exact: false }), 'not parsed').toBeNull();
    expect(stub.calls.slice(before).filter((c) => c.method !== 'GET'), 'nothing sent').toEqual([]);
    // a 1,000,000-character file is parsed normally (the T6 sample row padded with ignored trailing empty lines)
    const header = 'invoice_number,billing_party,billing_party_type,billed_party,direction,invoice_date,due_date,upstream_invoice_date,bl_numbers,port_of_discharge,liability_basis,total_due,rule_reference,dispute_contact,dispute_digital_means,dispute_request_days,dispute_resolution_days,certifies_fmc_rules,certifies_performance,container_number,size_type,charge_type,free_days,free_time_start,free_time_end,availability_date,earliest_return_date,period_from,period_to,rate,amount,clock_start,clock_stop,cargo_available_date,return_refused_dates';
    const row = 'SYN-DD-0001,Synthetic Ocean Line A,ocean_carrier,Synthetic Importer Inc,import,2026-03-27,2026-04-26,,SYNBL0001,Synthetic Port 1,Consignee named on the bill of lading,840.00,Synthetic tariff rule DET-1,disputes@example.com,https://example.com/dd-disputes,30,30,yes,yes,SYNU0000001,40dv,detention,4,2026-03-02,2026-03-05,2026-02-27,,2026-03-06,2026-03-09,210,840.00,2026-03-02,2026-03-20,,';
    const head = [header, row, ''].join(String.fromCharCode(10));
    const exact = head + String.fromCharCode(10).repeat(1_000_000 - head.length);
    expect(exact.length).toBe(1_000_000);
    await user.upload(input, new File([exact], 'exact.csv', { type: 'text/csv' }));
    expect(await screen.findByRole('table', { name: 'Invoices to import' }, WAIT), 'parsed normally').toBeTruthy();
  });
  it('DD-W05 the claims list and claim sheet show the D&D badge for OCEAN_DD claims only', async () => {
    const claims = [mkClaim(1, { kind: 'OCEAN_DD', loadNumber: null, invoiceNumber: 'SYN-DD-0004' }), mkClaim(2)];
    const { stub } = mkStub('REVIEWER', { claims });
    const r = await renderApp(stub, ['/claims']);
    const row1 = (await screen.findByRole('link', { name: 'CLM-0001' }, WAIT)).closest('tr') as HTMLElement;
    const row2 = screen.getByRole('link', { name: 'CLM-0002' }).closest('tr') as HTMLElement;
    expect(within(row1).getByText(TXT.kindBadge)).toBeTruthy();
    expect(within(row2).queryByText(TXT.kindBadge)).toBeNull();
    await r.user.click(screen.getByRole('link', { name: 'CLM-0001' }));
    const dlg = await screen.findByRole('dialog', { name: /^Claim CLM-0001/ }, WAIT);
    expect(within(dlg).getAllByText(TXT.kindBadge).length).toBeGreaterThan(0);
  });
  it('DD-W06 hostile strings render as text (billing party, container number, tariff name)', async () => {
    const inv = si4({ billingPartyName: `Synthetic ${HOSTILE}` });
    const first = inv.containers[0];
    if (first) inv.containers[0] = { ...first, containerNumber: 'SYNU<b>1</b>' };
    const r = await openInvoice('ANALYST', { inv, tariffName: `Tariff ${HOSTILE}` });
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getAllByText(`Synthetic ${HOSTILE}`, { exact: false }).length).toBeGreaterThan(0);
    await r.user.click(screen.getByRole('tab', { name: TXT.tariffs }));
    await screen.findByText(`Tariff ${HOSTILE}`, { exact: false }, WAIT);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
