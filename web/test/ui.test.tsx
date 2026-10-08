import type { PacketDto } from '@fr/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppRoot } from '../src/app-root';
import { UNPROCESSABLE_MESSAGE } from '../src/features/approvals/ApprovalsPage';
import { EvidencePanel } from '../src/features/claims/ClaimSheet';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = { id: U(90), name: 'Acme Logistics (synthetic)' };
const manager = { id: U(1), email: 'manager@acme.test', name: 'Morgan Manager', role: 'MANAGER', tenant, mfaEnabled: false };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1) \u202Eevil\u202C';

function packet(overrides: Partial<PacketDto> = {}): PacketDto {
  return {
    id: U(10),
    claimId: U(20),
    revision: 1,
    status: 'PENDING_REVIEW',
    perspective: 'SHIPPER',
    loadNumber: HOSTILE,
    generatedAt: '2026-10-08T12:00:00.000Z',
    disclaimer: 'MVP output',
    demandLetter: `Dear carrier ${HOSTILE}`,
    currency: 'USD',
    recoverableCents: 32500,
    pendingReviewCents: 15000,
    timeline: [{ id: U(30), occurredAt: '2025-03-03T08:00:00.000Z', kind: 'APPOINTMENT', label: HOSTILE, sourceId: U(40) }],
    sources: [{ id: U(40), filename: `${HOSTILE}.txt`, docType: 'INVOICE', sha256: 'a'.repeat(64), sizeBytes: 280 }],
    findings: [
      {
        id: U(50),
        ruleId: 'INV-LINEHAUL-RATE',
        title: HOSTILE,
        direction: 'OVERCHARGE',
        amountCents: 123456,
        explanation: HOSTILE,
        calculation: [HOSTILE],
        confidence: 0.95,
        needsHumanReview: true,
        citations: [{ sourceId: U(40), locator: 'invoice.txt:L7', excerpt: HOSTILE }],
        governingClause: { sourceId: U(40), label: 'Contracted linehaul rate', excerpt: HOSTILE, locator: 'rate_confirmation.txt:L4' },
      },
    ],
    verifier: { status: 'NOT_RUN', checkedAt: null, note: null },
    integrity: { contentHash: 'b'.repeat(64), recomputedHash: 'b'.repeat(64), valid: true },
    approvals: [],
    createdAt: '2026-10-08T12:00:00.000Z',
    createdBy: null,
    ...overrides,
  };
}

describe('evidence panel rendering safety', () => {
  it('renders hostile strings as inert text with the contract headings and badges', () => {
    const { container } = render(<EvidencePanel packet={packet()} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toContain('\u202E');
    for (const h of ['Timeline', 'Sources', 'Calculation', 'Governing clause']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText('Not independently verified')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Integrity verified')).toBeInTheDocument();
    expect(screen.getByText('Draft for human review. Not legal advice. Nothing is sent from this app.')).toBeInTheDocument();
    expect(screen.getByText('$1,234.56')).toBeInTheDocument();
    expect(screen.getByText('Needs human review')).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toContain('<script>alert(1)</script>');
  });

  it('shows the other verifier and integrity states', () => {
    render(
      <EvidencePanel
        packet={packet({ verifier: { status: 'FAILED', checkedAt: null, note: null }, integrity: { contentHash: 'a', recomputedHash: 'b', valid: false } })}
      />,
    );
    expect(screen.getByText('Verifier failed')).toBeInTheDocument();
    expect(screen.getByText('Integrity mismatch')).toBeInTheDocument();
  });
});

describe('AppRoot routing and auth', () => {
  it('sends anonymous users to the sign-in page with the contract controls', async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url) === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      return json(401, { error: { code: 'unauthenticated', message: 'Authentication required.', requestId: 'r' } });
    };
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/claims']} />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('shows a fixed message for invalid credentials', async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url) === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      return json(401, { error: { code: 'invalid_credentials', message: 'Invalid email or password.', requestId: 'r' } });
    };
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/login']} />);
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'viewer@acme.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('gates approval actions on reason length and acknowledgement', async () => {
    const item = {
      id: U(20),
      claimNumber: 'CLM-0013',
      loadNumber: 'LD-6091',
      invoiceNumber: 'INV-3169',
      carrierName: 'Northwind Haulage Co',
      shipperName: 'Widget Co',
      perspective: 'SHIPPER',
      status: 'PENDING_REVIEW',
      amountClaimedCents: 10000,
      recoverableCents: 5000,
      pendingReviewCents: 5000,
      currency: 'USD',
      assignee: null,
      latestPacket: { revision: 1, status: 'PENDING_REVIEW' },
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      packetRevision: 1,
      pendingFindingsCount: 1,
      waitingSince: '2026-10-01T00:00:00.000Z',
    };
    const approved = { ...item, id: U(21), claimNumber: 'CLM-0015', status: 'APPROVED', pendingFindingsCount: 0 };
    const fetchImpl = async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user: manager });
      if (u === '/api/v1/me') return json(200, { user: manager, permissions: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send'] });
      if (u.startsWith('/api/v1/approvals')) return json(200, { items: [item, approved], page: 1, pageSize: 25, total: 2 });
      return json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
    };
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/approvals']} />);
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve CLM-0013' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'too short');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), ' but now long enough');
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'I acknowledge findings pending human review' }));
    expect(confirm).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const send = await screen.findByRole('dialog', { name: 'Send CLM-0015' });
    expect(within(send).getByText('This marks the demand as ready to send. No email is sent from this app.')).toBeInTheDocument();
  });

  it('hides review actions from a viewer', async () => {
    const viewer = { ...manager, role: 'VIEWER', email: 'viewer@acme.test' };
    const fetchImpl = async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user: viewer });
      if (u === '/api/v1/me') return json(200, { user: viewer, permissions: ['claims:read'] });
      if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
      return json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
    };
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/approvals']} />);
    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

describe('fix round 1: fixed error texts, retry, Retry-After', () => {
  const authed = (handler: (u: string, init?: RequestInit) => Response | undefined) => async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user: manager });
    if (u === '/api/v1/me') return json(200, { user: manager, permissions: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send'] });
    return handler(u, init) ?? json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
  };

  it('shows the Retry-After value exactly (42 seconds) on a locked sign-in', async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url) === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      if (String(url) === '/api/v1/auth/login') {
        return new Response(JSON.stringify({ error: { code: 'account_locked', message: 'x', requestId: 'r' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '42' },
        });
      }
      return json(401, { error: { code: 'unauthenticated', message: 'x', requestId: 'r' } });
    };
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/login']} />);
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'lockme@acme.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 42 seconds.');
  });

  it('offers a working retry button when the claims list fails', async () => {
    let calls = 0;
    const fetchImpl = authed((u) => {
      if (u.startsWith('/api/v1/claims')) {
        calls += 1;
        if (calls <= 2) return json(500, { error: { code: 'internal_error', message: 'Internal server error.', requestId: 'r' } });
        return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
      }
      if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 1, total: 0 });
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/claims']} />);
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 });
    expect(screen.getByRole('alert')).toHaveTextContent('Claims could not be loaded.');
    await user.click(retry);
    expect(await screen.findByText('No claims match these filters.')).toBeInTheDocument();
    expect(calls).toBe(3);
  });

  it('never renders server error text on 422 in the approval dialog', async () => {
    const item = {
      id: U(20),
      claimNumber: 'CLM-0013',
      loadNumber: 'LD-1',
      invoiceNumber: 'INV-1',
      carrierName: 'C',
      shipperName: 'S',
      perspective: 'SHIPPER',
      status: 'PENDING_REVIEW',
      amountClaimedCents: 1,
      recoverableCents: 1,
      pendingReviewCents: 0,
      currency: 'USD',
      assignee: null,
      latestPacket: { revision: 1, status: 'PENDING_REVIEW' },
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      packetRevision: 1,
      pendingFindingsCount: 0,
      waitingSince: '2026-10-01T00:00:00.000Z',
    };
    const fetchImpl = authed((u) => {
      if (u.startsWith('/api/v1/approvals')) return json(200, { items: [item], page: 1, pageSize: 25, total: 1 });
      if (u.endsWith('/packet/approve')) return json(422, { error: { code: 'unprocessable', message: '<b>SERVER TEXT</b>', requestId: 'r' } });
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/approvals']} />);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve CLM-0013' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Reason long enough here');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(UNPROCESSABLE_MESSAGE);
    expect(dialog.textContent).not.toContain('SERVER TEXT');
  });
});
