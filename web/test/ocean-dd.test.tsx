/**
 * Step 8 web units (REQ-20261011-ocean-dd, Part B, C18): the Ocean D&D page (flag-gated nav, invoices list and
 * detail with checks/findings, Run audit, editor validation messages, preset fill with provenance, CSV
 * preview and errors), fixed error texts, the D&D badge on the claims list. Untrusted strings render as text.
 */
import {
  DD_CHECK_LABELS,
  DD_NOTE,
  DD_PRESET_NOTE,
  DD_TARIFF_PRESETS,
  DD_TEXT,
  DD_CSV_COLUMNS,
  DdInvoiceData,
  PERMISSION_MATRIX,
  auditDdInvoice,
  type Role,
} from '@fr/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api/client';
import { AppRoot } from '../src/app-root';
import { ddErrorText } from '../src/features/ocean-dd/dd-common';
import { formToBody, EMPTY_INVOICE } from '../src/features/ocean-dd/invoice-form';
import { textToTiers, tiersToText } from '../src/features/ocean-dd/TariffsTab';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(1)>';
const FLAGS = {
  'intelligence.charge_suggestions': true,
  'intelligence.cost_outlook': true,
  'intelligence.fuel_check': true,
  'intelligence.ocean_dd': true,
  'intelligence.provenance': true,
  'intelligence.similar_claims': true,
  'intelligence.worklist': true,
};
const MAERSK = DD_TARIFF_PRESETS[0]?.data;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const err = (status: number, code: string) => json(status, { error: { code, message: 'SERVER TEXT', requestId: 'r' } });

const invoice = DdInvoiceData.parse({
  invoiceNumber: `SYN-1 ${HOSTILE}`,
  billingPartyName: `Synthetic Line ${HOSTILE}`,
  billingPartyType: 'OCEAN_CARRIER',
  billedPartyName: 'Example Importer LLC',
  direction: 'IMPORT',
  invoiceDate: '2026-03-25',
  dueDate: '2026-04-24',
  upstreamInvoiceDate: null,
  billOfLadingNumbers: ['SYNBL0001'],
  portOfDischarge: 'Port of Example',
  liabilityBasis: 'Consignee',
  totalDue: '4350.00',
  ruleReference: 'Rule 1',
  disputeContact: 'disputes@example.test',
  disputeDigitalMeans: 'https://example.test/d',
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
    },
  ],
});
const preview = auditDdInvoice({ invoice, tariff: MAERSK ?? null, calendar: null });
const TS = '2026-10-11T00:00:00.000Z';
const detail = { id: U(700), status: 'DRAFT', version: 1, invoice: { ...invoice, tariffId: U(800), calendarId: null }, claimId: null, claimNumber: null, auditedAt: null, createdAt: TS, updatedAt: TS, preview };
const listItem = { id: U(700), status: 'DRAFT', version: 1, invoiceNumber: invoice.invoiceNumber, billingPartyName: invoice.billingPartyName, direction: 'IMPORT', invoiceDate: '2026-03-25', totalDueCents: 435000, containerCount: 1, claimId: null, auditedAt: null, updatedAt: TS };
const claim = (kind: string) => ({
  id: U(500),
  claimNumber: 'CLM-0500',
  kind,
  loadNumber: null,
  invoiceNumber: null,
  carrierName: 'Carrier',
  shipperName: 'Shipper',
  perspective: 'SHIPPER',
  status: 'PENDING_REVIEW',
  amountClaimedCents: 0,
  recoverableCents: 0,
  pendingReviewCents: 0,
  currency: 'USD',
  assignee: null,
  latestPacket: null,
  createdAt: TS,
  updatedAt: TS,
});

function setup(role: Role, opts: { flags?: Record<string, boolean>; audit?: () => Response } = {}) {
  const user = { id: U(1), email: 'u@x.test', name: 'Test User', role, tenant: { id: U(90), name: 'Acme (synthetic)' }, mfaEnabled: true };
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null });
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user });
    if (u === '/api/v1/me') return json(200, { user, permissions: [...PERMISSION_MATRIX[role]] });
    if (u === '/api/v1/features') return json(200, { flags: opts.flags ?? FLAGS });
    if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
    if (u.startsWith('/api/v1/claims?') || u === '/api/v1/claims') return json(200, { items: [claim('OCEAN_DD')], page: 1, pageSize: 25, total: 1 });
    if (u.startsWith('/api/v1/dd/tariffs')) return json(200, { items: [{ id: U(800), version: 1, data: MAERSK, createdAt: TS, updatedAt: TS }], page: 1, pageSize: 100, total: 1 });
    if (u.startsWith('/api/v1/dd/calendars')) return json(200, { items: [], page: 1, pageSize: 100, total: 0 });
    if (u === `/api/v1/dd/invoices/${U(700)}/audit` && method === 'POST') {
      if (opts.audit) return opts.audit();
      return json(201, {
        invoiceId: U(700),
        claim: { id: U(500), claimNumber: 'CLM-0500', status: 'PENDING_REVIEW', recoverableCents: 44000, pendingReviewCents: 0, amountClaimedCents: 44000 },
        packet: { id: U(501), revision: 1, status: 'PENDING_REVIEW', contentHash: 'a'.repeat(64) },
        audit: { rulesVersion: 'dd-rules-v1', findingsCount: 1, pendingFindingsCount: 0 },
      });
    }
    if (u === `/api/v1/dd/invoices/${U(700)}`) return json(200, detail);
    if (u.startsWith('/api/v1/dd/invoices')) return json(200, { items: [listItem], page: 1, pageSize: 25, total: 1 });
    return err(404, 'not_found');
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe('Ocean D&D page', () => {
  it('nav link and page with the flag on; untrusted text stays text; detail shows checks, findings and Run audit', async () => {
    const { fetchImpl, calls } = setup('ANALYST');
    const u = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/ocean']} />);
    expect(await screen.findByRole('link', { name: DD_TEXT.nav })).toHaveAttribute('href', '/ocean');
    expect((await screen.findAllByText(DD_NOTE)).length).toBeGreaterThan(0);
    const row = await screen.findByRole('button', { name: invoice.invoiceNumber });
    expect(container.ownerDocument.querySelector('script, img')).toBeNull();
    await u.click(row);
    expect(await screen.findByText(DD_CHECK_LABELS.tariff)).toBeInTheDocument();
    expect(screen.getByText('DD-TARIFF-OVERCHARGE')).toBeInTheDocument();
    expect(screen.getByText(DD_TEXT.auditNote)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: DD_TEXT.runAudit }));
    expect(await screen.findByText(DD_TEXT.audited)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the claim/u })).toHaveAttribute('href', `/claims/${U(500)}`);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/audit'))).toBe(true);
    expect(container.ownerDocument.querySelector('script, img')).toBeNull();
  });

  it('flag off: no nav link and the page shows not found', async () => {
    const { fetchImpl } = setup('OWNER', { flags: { ...FLAGS, 'intelligence.ocean_dd': false } });
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/ocean']} />);
    expect(await screen.findByText('Not found.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: DD_TEXT.nav })).toBeNull();
  });

  it('viewer sees no New invoice and no Run audit; audit errors show fixed texts', async () => {
    const { fetchImpl } = setup('VIEWER');
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/ocean']} />);
    await u.click(await screen.findByRole('button', { name: invoice.invoiceNumber }));
    await screen.findByText(DD_CHECK_LABELS.tariff);
    expect(screen.queryByRole('button', { name: DD_TEXT.newInvoice })).toBeNull();
    expect(screen.queryByRole('button', { name: DD_TEXT.runAudit })).toBeNull();

    const s2 = setup('REVIEWER', { audit: () => err(422, 'analysis_input_invalid') });
    const r2 = render(<AppRoot fetchImpl={s2.fetchImpl} initialEntries={['/ocean']} />);
    const w = within(r2.container);
    await u.click(await w.findByRole('button', { name: invoice.invoiceNumber }));
    await u.click(await w.findByRole('button', { name: DD_TEXT.runAudit }));
    expect(await w.findByText(DD_TEXT.invalid)).toBeInTheDocument();
    expect(r2.container.textContent).not.toContain('SERVER TEXT');
  });

  it('editor: Save with missing values names the fields; nothing is sent', async () => {
    const { fetchImpl, calls } = setup('ANALYST');
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/ocean']} />);
    await u.click(await screen.findByRole('button', { name: DD_TEXT.newInvoice }));
    await u.click(screen.getByRole('button', { name: DD_TEXT.save }));
    expect(await screen.findByText('Check these values:')).toBeInTheDocument();
    expect(screen.getByText('invoiceNumber')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/dd/invoices')).toBe(false);
  });

  it('tariff editor: a preset fills the form and shows the note and provenance', async () => {
    const { fetchImpl } = setup('REVIEWER');
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/ocean']} />);
    await u.click(await screen.findByRole('tab', { name: DD_TEXT.tariffs }));
    await u.click(await screen.findByRole('button', { name: DD_TEXT.newTariff }));
    await u.selectOptions(screen.getByLabelText(DD_TEXT.fromPreset), 'msc-us-import-demurrage');
    expect(screen.getByLabelText('Name')).toHaveValue('MSC US import demurrage (all ports except Baltimore)');
    expect(screen.getByText(DD_PRESET_NOTE)).toBeInTheDocument();
    expect(screen.getByLabelText('Preset provenance').textContent).toContain('Verification: primary');
  });

  it('CSV import: preview of invoices and row errors (DD_TEXT.csvErrors)', async () => {
    const { fetchImpl } = setup('ANALYST');
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/ocean']} />);
    await u.click(await screen.findByRole('tab', { name: DD_TEXT.importCsv }));
    const cells: Record<string, string> = {
      invoice_number: 'SYN-CSV-1',
      billing_party: 'Synthetic Line',
      billing_party_type: 'ocean_carrier',
      billed_party: 'Example Importer LLC',
      direction: 'import',
      size_type: '40DV',
      charge_type: 'detention',
      container_number: 'SYNU1',
    };
    const row = (o: Record<string, string>) => DD_CSV_COLUMNS.map((c) => o[c] ?? '').join(',');
    const csv = [DD_CSV_COLUMNS.join(','), row(cells), row({ ...cells, invoice_number: 'SYN-CSV-2', size_type: '' })].join('\n');
    await u.upload(screen.getByLabelText('CSV file'), new File([csv], 'dd.csv', { type: 'text/csv' }));
    expect(await screen.findByText(DD_TEXT.csvErrors)).toBeInTheDocument();
    expect(screen.getByText('Row 3, size_type: required')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Invoices to import' })).getByText('SYN-CSV-1')).toBeInTheDocument();
  });

  it('CSV import refuses a file above 4 x 1,000,000 bytes before reading it (fix round 1, S5)', async () => {
    const { fetchImpl } = setup('ANALYST');
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/ocean']} />);
    await u.click(await screen.findByRole('tab', { name: DD_TEXT.importCsv }));
    const file = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: 4_000_001 });
    let read = false;
    Object.defineProperty(file, 'text', { value: () => { read = true; return Promise.resolve('x'); } });
    await u.upload(screen.getByLabelText('CSV file'), file);
    expect(await screen.findByText('The file is too large to import.')).toBeInTheDocument();
    expect(read).toBe(false);
  });

  it('claims list shows the D&D badge for OCEAN_DD claims', async () => {
    const { fetchImpl } = setup('OWNER');
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/claims']} />);
    expect(await screen.findByText(DD_TEXT.kindBadge)).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('error texts by status and code (never the server message)', () => {
    expect(ddErrorText(new ApiError(403, 'forbidden', 'x'))).toBe(DD_TEXT.forbidden);
    expect(ddErrorText(new ApiError(409, 'dd_limit_reached', 'x'))).toBe(DD_TEXT.limit);
    expect(ddErrorText(new ApiError(409, 'stale_revision', 'x'))).toBe(DD_TEXT.conflict);
    expect(ddErrorText(new ApiError(422, 'analysis_input_invalid', 'x'))).toBe(DD_TEXT.invalid);
    expect(ddErrorText(new ApiError(429, 'rate_limited', 'x'))).toBe(DD_TEXT.rateLimited);
    expect(ddErrorText(new ApiError(500, 'internal_error', 'x'))).toBe(DD_TEXT.failed);
    expect(ddErrorText(new Error('boom'))).toBe(DD_TEXT.failed);
  });

  it('tier text round-trips; an empty form does not validate', () => {
    expect(MAERSK).toBeDefined();
    if (!MAERSK) return;
    expect(textToTiers(tiersToText(MAERSK.tiers))).toEqual(MAERSK.tiers);
    const r = formToBody(EMPTY_INVOICE);
    expect(r.ok).toBe(false);
  });
});
