/**
 * Four-eyes UI (REQ-20261009-four-eyes, spec B1/B2): self-authored approvals rows and review dialogs hide
 * the decision buttons and show the shared copy; a late 403 four_eyes_required shows the same copy as an
 * alert and refetches.
 */
import { FOUR_EYES_CLAIM_TEXT, FOUR_EYES_DOCUMENT_TEXT } from '@fr/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppRoot } from '../src/app-root';

import { U, doc, field } from './helpers/import-fixtures';

const tenant = { id: U(90), name: 'Acme Logistics (synthetic)' };
const manager = { id: U(1), email: 'manager@acme.test', name: 'Morgan Manager', role: 'MANAGER', tenant, mfaEnabled: false };
const ALL = ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'import:run', 'import:review'];
const FOUR_EYES_BODY = { error: { code: 'four_eyes_required', message: '<b>SERVER TEXT</b>', requestId: 'r' } };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function authed(handler: (u: string, init?: RequestInit) => Response | undefined) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user: manager });
    if (u === '/api/v1/me') return json(200, { user: manager, permissions: ALL });
    return handler(u, init) ?? json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
  };
}

const approvalItem = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: U(20 + n),
  claimNumber: `CLM-00${20 + n}`,
  loadNumber: 'LD-1',
  invoiceNumber: 'INV-1',
  carrierName: 'Carrier',
  shipperName: 'Shipper',
  perspective: 'SHIPPER',
  status: 'PENDING_REVIEW',
  amountClaimedCents: 100,
  recoverableCents: 100,
  pendingReviewCents: 0,
  currency: 'USD',
  assignee: null,
  latestPacket: { revision: 2, status: 'PENDING_REVIEW' },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  packetRevision: 2,
  pendingFindingsCount: 0,
  waitingSince: '2026-10-01T00:00:00.000Z',
  selfAuthored: false,
  ...overrides,
});

describe('four-eyes: approvals page', () => {
  it('replaces Approve/Reject with the fixed text on self-authored rows only; Edit and Send stay', async () => {
    const mine = approvalItem(1, { selfAuthored: true });
    const other = approvalItem(2);
    const approvedMine = approvalItem(3, { status: 'APPROVED', selfAuthored: true, latestPacket: { revision: 2, status: 'APPROVED' } });
    const fetchImpl = authed((u) =>
      u.startsWith('/api/v1/approvals') ? json(200, { items: [mine, other, approvedMine], page: 1, pageSize: 25, total: 3 }) : undefined,
    );
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/approvals']} />);
    const mineRow = (await screen.findByText('CLM-0021')).closest('tr') as HTMLElement;
    const otherRow = screen.getByText('CLM-0022').closest('tr') as HTMLElement;
    const approvedRow = screen.getByText('CLM-0023').closest('tr') as HTMLElement;
    expect(within(mineRow).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(mineRow).queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(within(mineRow).getByText(FOUR_EYES_CLAIM_TEXT)).toBeInTheDocument();
    expect(within(mineRow).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(otherRow).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(otherRow).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(within(otherRow).queryByText(FOUR_EYES_CLAIM_TEXT)).toBeNull();
    expect(within(approvedRow).getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(within(approvedRow).queryByText(FOUR_EYES_CLAIM_TEXT)).toBeNull();
  });

  it('maps a late 403 four_eyes_required to the claim text (never the server text) and refetches the queue', async () => {
    let queueCalls = 0;
    const fetchImpl = authed((u) => {
      if (u.startsWith('/api/v1/approvals')) {
        queueCalls += 1;
        return json(200, { items: [approvalItem(1)], page: 1, pageSize: 25, total: 1 });
      }
      if (u.endsWith('/packet/reject')) return json(403, FOUR_EYES_BODY);
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/approvals']} />);
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject CLM-0021' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Reason long enough here');
    const before = queueCalls;
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(FOUR_EYES_CLAIM_TEXT);
    expect(dialog.textContent).not.toContain('SERVER TEXT');
    expect(dialog.textContent).not.toContain('You do not have permission');
    await waitFor(() => expect(queueCalls).toBeGreaterThan(before));
  });
});

describe('four-eyes: review dialog', () => {
  const flagged = field({ id: U(310), key: 'invoice.total', needsReview: true, confidence: 0.6, reviewReasons: ['LOW_CONFIDENCE'] });
  const pending = doc({ status: 'NEEDS_REVIEW', displayName: 'scan.pdf', reviewReasons: ['FLAGGED_FIELDS'], fields: [flagged], unresolvedFlaggedCount: 1 });
  const queueItem = {
    documentId: pending.id,
    batchId: pending.batchId,
    batchLabel: 'Batch',
    displayName: 'scan.pdf',
    docType: 'INVOICE',
    reviewReasons: ['FLAGGED_FIELDS'],
    flaggedFieldCount: 1,
    unresolvedFlaggedCount: 1,
    uploadedBy: null,
    waitingSince: '2026-10-08T12:00:00.000Z',
  };
  const base = `/api/v1/imports/${pending.batchId}/documents/${pending.id}`;

  it('hides Accept document for a self-authored document and shows the fixed text; Reject and Close stay', async () => {
    const fetchImpl = authed((u, init) => {
      if (u.startsWith('/api/v1/reviews')) return json(200, { items: [queueItem], page: 1, pageSize: 25, total: 1 });
      if (u === base && (init?.method ?? 'GET') === 'GET') return json(200, { ...pending, selfAuthored: true });
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/import/review']} />);
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review scan.pdf' });
    expect(await within(dialog).findByText(FOUR_EYES_DOCUMENT_TEXT)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Accept document' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Reject document' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Correct Total' })).toBeInTheDocument();
  });

  it('maps a late 403 four_eyes_required on accept to the document text and refetches the document', async () => {
    let docCalls = 0;
    const fetchImpl = authed((u, init) => {
      if (u.startsWith('/api/v1/reviews')) return json(200, { items: [queueItem], page: 1, pageSize: 25, total: 1 });
      if (u === base && (init?.method ?? 'GET') === 'GET') {
        docCalls += 1;
        return json(200, pending);
      }
      if (u === `${base}/accept`) return json(403, FOUR_EYES_BODY);
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/import/review']} />);
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review scan.pdf' });
    await user.click(await within(dialog).findByRole('button', { name: 'Accept document' }));
    const accept = await screen.findByRole('dialog', { name: 'Accept document' });
    await user.type(within(accept).getByRole('textbox', { name: 'Reason' }), 'Checked against the paper copy');
    await user.click(within(accept).getByRole('checkbox', { name: 'Confirm all remaining flagged fields' }));
    const before = docCalls;
    await user.click(within(accept).getByRole('button', { name: 'Confirm' }));
    expect(await within(accept).findByRole('alert')).toHaveTextContent(FOUR_EYES_DOCUMENT_TEXT);
    expect(document.body.textContent).not.toContain('SERVER TEXT');
    await waitFor(() => expect(docCalls).toBeGreaterThan(before));
  });

  it('maps a 403 four_eyes_required on a field action to the document text', async () => {
    const fetchImpl = authed((u, init) => {
      if (u.startsWith('/api/v1/reviews')) return json(200, { items: [queueItem], page: 1, pageSize: 25, total: 1 });
      if (u === base && (init?.method ?? 'GET') === 'GET') return json(200, pending);
      if (u === `${base}/fields/${flagged.id}/resolve`) return json(403, FOUR_EYES_BODY);
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/import/review']} />);
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review scan.pdf' });
    await user.click(await within(dialog).findByRole('button', { name: 'Correct Total' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Corrected value' }), '12.00');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Corrected from the paper copy');
    await user.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(FOUR_EYES_DOCUMENT_TEXT);
  });
});
