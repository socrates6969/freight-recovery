/**
 * Step 6 web units (REQ-20261011-charge-intelligence, C13): the claim sheet Charges tab (flag-gated,
 * 404 hides it), chips and nearest example as text, controls only with charge_labels:manage, one PUT per
 * action with the fixed success/error texts.
 */
import { CHARGE_NOTE, CHARGE_TEXT, PERMISSION_MATRIX, type Role } from '@fr/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api/client';
import { AppRoot } from '../src/app-root';
import { chargeErrorText, isLabelable } from '../src/features/intelligence/ChargeLinesPanel';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(1)>';
const FLAGS_ON = { 'intelligence.charge_suggestions': true, 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const err = (status: number, code: string) => json(status, { error: { code, message: 'SERVER TEXT', requestId: 'r' } });

const claim = {
  id: U(500),
  claimNumber: 'CLM-0500',
  loadNumber: null,
  invoiceNumber: null,
  carrierName: 'Carrier',
  shipperName: 'Shipper',
  perspective: 'SHIPPER',
  status: 'PENDING_REVIEW',
  amountClaimedCents: 1,
  recoverableCents: 1,
  pendingReviewCents: 0,
  currency: 'USD',
  assignee: null,
  latestPacket: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  invoiceDate: null,
};

const lines = {
  claimId: claim.id,
  classifierVersion: 'charge-knn-v1',
  seedVersion: 'tariff-seed-v1',
  threshold: 0.3,
  lines: [
    {
      index: 0,
      description: `Pallet exchange ${HOSTILE}`,
      amount: '75.00',
      ruleCategory: 'other',
      suggestion: {
        category: 'accessorial',
        similarity: 0.45,
        abstained: false,
        reason: null,
        nearest: { text: `PALLET EXCHANGE ${HOSTILE}`, category: 'accessorial', origin: 'seed', source: 'xpo_2025', sourceLabel: 'XPO Tariff CNWY 199-AJ.4 (2025)', labelId: null },
      },
      label: null,
    },
    {
      index: 1,
      description: 'Linehaul',
      amount: '1500.00',
      ruleCategory: 'linehaul',
      suggestion: { category: null, similarity: 0.12, abstained: true, reason: 'below_threshold', nearest: { text: 'HEAVY LIFT', category: 'accessorial', origin: 'seed', source: 'xpo_2025', sourceLabel: 'XPO Tariff CNWY 199-AJ.4 (2025)', labelId: null } },
      label: { id: U(700), category: 'linehaul' },
    },
  ],
};

function setup(role: Role, opts: { flags?: Record<string, boolean>; chargeLines?: () => Response; put?: () => Response } = {}) {
  const user = { id: U(1), email: 'u@x.test', name: 'Test User', role, tenant: { id: U(90), name: 'Acme (synthetic)' }, mfaEnabled: true };
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user });
    if (u === '/api/v1/me') return json(200, { user, permissions: [...PERMISSION_MATRIX[role]] });
    if (u === '/api/v1/features') return json(200, { flags: opts.flags ?? FLAGS_ON });
    if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
    if (u === `/api/v1/claims/${claim.id}`) return json(200, claim);
    if (u === `/api/v1/claims/${claim.id}/charge-lines`) return opts.chargeLines ? opts.chargeLines() : json(200, lines);
    if (u === '/api/v1/charge-labels' && init?.method === 'PUT') {
      if (opts.put) return opts.put();
      const b = JSON.parse(String(init.body)) as { description: string; category: string };
      return json(200, {
        label: { id: U(800), description: b.description, normalizedText: 'pallet exchange', category: b.category, version: 1, createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z' },
        outcome: 'created',
      });
    }
    return err(404, 'not_found');
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe('claim sheet Charges tab', () => {
  it('renders lines, chips and the nearest example as text; viewers see no controls', async () => {
    const { fetchImpl } = setup('VIEWER');
    const u = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    await u.click(await screen.findByRole('tab', { name: 'Charges' }));
    expect(await screen.findByRole('heading', { name: CHARGE_TEXT.heading })).toBeInTheDocument();
    expect(screen.getByText(CHARGE_NOTE)).toBeInTheDocument();
    expect(screen.getByText('Rules: Other')).toBeInTheDocument();
    expect(screen.getByText('Suggested: Accessorial (0.450)')).toBeInTheDocument();
    expect(screen.getByText('No suggestion')).toBeInTheDocument();
    expect(screen.getByText('Team label: Linehaul')).toBeInTheDocument();
    expect(container.textContent).toContain(`Nearest example: 'PALLET EXCHANGE ${HOSTILE}' (XPO Tariff CNWY 199-AJ.4 (2025))`);
    expect(container.ownerDocument.querySelector('script, img')).toBeNull();
    expect(screen.queryByRole('button', { name: CHARGE_TEXT.save })).toBeNull();
    expect(screen.queryByRole('combobox', { name: CHARGE_TEXT.category })).toBeNull();
  });

  it('reviewers confirm a suggestion with one PUT, see the success toast and the lines reload', async () => {
    const { fetchImpl, calls } = setup('REVIEWER');
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    await u.click(await screen.findByRole('tab', { name: 'Charges' }));
    const list = await screen.findByRole('list', { name: CHARGE_TEXT.heading });
    expect(within(list).getAllByRole('combobox', { name: CHARGE_TEXT.category })).toHaveLength(2);
    // Confirm only where the suggestion is not abstained and differs from the team label.
    expect(within(list).getAllByRole('button', { name: 'Confirm Accessorial' })).toHaveLength(1);
    const before = calls.filter((c) => c.url.endsWith('/charge-lines')).length;
    await u.click(within(list).getByRole('button', { name: 'Confirm Accessorial' }));
    expect(await screen.findByText(CHARGE_TEXT.saved)).toBeInTheDocument();
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0]?.body ?? '{}')).toEqual({ description: `Pallet exchange ${HOSTILE}`, category: 'accessorial' });
    await screen.findByRole('list', { name: CHARGE_TEXT.heading });
    expect(calls.filter((c) => c.url.endsWith('/charge-lines')).length).toBeGreaterThan(before);
  });

  it('save with a chosen category; errors show fixed texts, never server text', async () => {
    const { fetchImpl, calls } = setup('MANAGER', { put: () => err(409, 'label_limit_reached') });
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    await u.click(await screen.findByRole('tab', { name: 'Charges' }));
    const list = await screen.findByRole('list', { name: CHARGE_TEXT.heading });
    const second = within(list).getAllByRole('listitem')[1];
    if (!second) throw new Error('row missing');
    await u.selectOptions(within(second).getByRole('combobox', { name: CHARGE_TEXT.category }), 'fuel');
    await u.click(within(second).getByRole('button', { name: CHARGE_TEXT.save }));
    expect(await screen.findByText(CHARGE_TEXT.limit)).toBeInTheDocument();
    expect(screen.queryByText('SERVER TEXT')).toBeNull();
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')?.body ?? '{}')).toEqual({ description: 'Linehaul', category: 'fuel' });
  });

  it('fix round 1 (S7): label actions are disabled for lines the server would refuse', async () => {
    const long = { ...lines, lines: [{ ...lines.lines[1], index: 0, description: 'x'.repeat(201), label: null }] };
    const { fetchImpl, calls } = setup('REVIEWER', { chargeLines: () => json(200, long) });
    const u = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    await u.click(await screen.findByRole('tab', { name: 'Charges' }));
    const list = await screen.findByRole('list', { name: CHARGE_TEXT.heading });
    expect(within(list).getByRole('button', { name: CHARGE_TEXT.save })).toBeDisabled();
    expect(within(list).getByRole('combobox', { name: CHARGE_TEXT.category })).toBeDisabled();
    expect(isLabelable('x'.repeat(201))).toBe(false);
    expect(isLabelable('a‮b')).toBe(false);
    expect(isLabelable('Lumper fee')).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('maps statuses to the fixed alert texts', () => {
    expect(chargeErrorText(new ApiError(403, 'forbidden', 'x'))).toBe(CHARGE_TEXT.forbidden);
    expect(chargeErrorText(new ApiError(409, 'label_limit_reached', 'x'))).toBe(CHARGE_TEXT.limit);
    expect(chargeErrorText(new ApiError(429, 'rate_limited', 'x'))).toBe(CHARGE_TEXT.rateLimited);
    expect(chargeErrorText(new ApiError(500, 'internal_error', 'x'))).toBe(CHARGE_TEXT.failed);
    expect(chargeErrorText(new Error('x'))).toBe(CHARGE_TEXT.failed);
  });

  it('no lines -> empty text; flag off -> no tab; 404 -> the tab disappears', async () => {
    const empty = setup('VIEWER', { chargeLines: () => json(200, { ...lines, lines: [] }) });
    const u = userEvent.setup();
    const first = render(<AppRoot fetchImpl={empty.fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    await u.click(await screen.findByRole('tab', { name: 'Charges' }));
    expect(await screen.findByText(CHARGE_TEXT.empty)).toBeInTheDocument();
    first.unmount();

    const off = setup('VIEWER', { flags: { ...FLAGS_ON, 'intelligence.charge_suggestions': false } });
    const second = render(<AppRoot fetchImpl={off.fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    expect(await screen.findByRole('tab', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Charges' })).toBeNull();
    second.unmount();

    const gone = setup('VIEWER', { chargeLines: () => err(404, 'not_found') });
    render(<AppRoot fetchImpl={gone.fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    await u.click(await screen.findByRole('tab', { name: 'Charges' }));
    await screen.findByRole('tab', { name: 'Summary', selected: true });
    expect(screen.queryByRole('tab', { name: 'Charges' })).toBeNull();
  });
});
