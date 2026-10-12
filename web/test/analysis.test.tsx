/**
 * Step 5 analysis UI (REQ-20261010-step5-analysis, spec B1/B2, P10): the claim sheet's Analyze action on
 * AWAITING_ANALYSIS claims (Summary and Evidence tabs), its fixed error alerts, and the claims page's bulk
 * dialog. Role-aware: without `claims:analyze` nothing is shown.
 */
import { ANALYSIS_FAILURE_TEXT, ANALYSIS_NOTE, ANALYSIS_TEXT, ANALYZE_AUTHOR_NOTE, BULK_ANALYZE_INTRO, BULK_STOPPED_TEXT, findingConfidenceText } from '@fr/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppRoot } from '../src/app-root';
import { NO_PACKET_TEXT } from '../src/features/claims/ClaimSheet';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = { id: U(90), name: 'Acme Logistics (synthetic)' };
const analyst = { id: U(1), email: 'analyst@acme.test', name: 'Avery Analyst', role: 'ANALYST', tenant, mfaEnabled: false };
const WITH = ['claims:read', 'import:run', 'export:claims', 'claims:analyze'];
const WITHOUT = ['claims:read', 'import:run', 'export:claims'];
const CLAIM_ID = U(20);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const errorBody = (code: string) => ({ error: { code, message: '<b>SERVER TEXT</b>', requestId: 'r' } });

function claim(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: CLAIM_ID,
    kind: 'FREIGHT', claimNumber: 'CLM-0042',
    loadNumber: 'LD-42',
    invoiceNumber: 'INV-42',
    invoiceDate: null,
    analysisFailure: null,
    carrierName: 'Acme Freight LLC',
    shipperName: 'Widget Co',
    perspective: 'SHIPPER',
    status,
    amountClaimedCents: status === 'AWAITING_ANALYSIS' ? 0 : 47500,
    recoverableCents: status === 'AWAITING_ANALYSIS' ? 0 : 32500,
    pendingReviewCents: status === 'AWAITING_ANALYSIS' ? 0 : 15000,
    currency: 'USD',
    assignee: null,
    latestPacket: status === 'AWAITING_ANALYSIS' ? null : { revision: 1, status: 'PENDING_REVIEW' },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const packet = {
  id: U(10),
  claimId: CLAIM_ID,
  revision: 1,
  status: 'PENDING_REVIEW',
  perspective: 'SHIPPER',
  loadNumber: 'LD-42',
  generatedAt: '2026-10-10T12:00:00.000Z',
  disclaimer: 'MVP / pre-product output.',
  demandLetter: 'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.',
  currency: 'USD',
  recoverableCents: 32500,
  pendingReviewCents: 15000,
  timeline: [],
  sources: [],
  findings: [],
  verifier: { status: 'NOT_RUN', checkedAt: null, note: null },
  integrity: { contentHash: 'b'.repeat(64), recomputedHash: 'b'.repeat(64), valid: true },
  approvals: [],
  createdAt: '2026-10-10T12:00:00.000Z',
  createdBy: { id: U(1), name: 'Avery Analyst' },
};

const analyzeResponse = {
  claim: { id: CLAIM_ID, status: 'PENDING_REVIEW', recoverableCents: 32500, pendingReviewCents: 15000, amountClaimedCents: 47500 },
  packet: { id: U(10), revision: 1, status: 'PENDING_REVIEW', contentHash: 'b'.repeat(64) },
  analysis: { rulesVersion: 'rules-v1', findingsCount: 3, pendingFindingsCount: 1, ignoredFindingsCount: 0, classifierVersion: 'charge-knn-v1', learnedFindingsCount: 0, reviewFlagsCount: 0, fuelCheckStatus: 'off', fuelFindingsCount: 0 },
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function backend(opts: {
  permissions?: string[];
  status?: string;
  analyze?: () => Response;
  bulk?: () => Response;
  claimOverrides?: Record<string, unknown>;
  packet?: unknown;
}) {
  const calls: Call[] = [];
  let status = opts.status ?? 'AWAITING_ANALYSIS';
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null });
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user: analyst });
    if (u === '/api/v1/me') return json(200, { user: analyst, permissions: opts.permissions ?? WITH });
    if (u === `/api/v1/claims/${CLAIM_ID}/analyze` && method === 'POST') {
      const r = opts.analyze ? opts.analyze() : json(201, analyzeResponse);
      if (r.status === 201) status = 'PENDING_REVIEW';
      return r;
    }
    if (u === '/api/v1/claims/analyze-awaiting' && method === 'POST') return opts.bulk ? opts.bulk() : json(500, errorBody('internal_error'));
    if (u === `/api/v1/claims/${CLAIM_ID}`) return json(200, claim(status, opts.claimOverrides));
    if (u === `/api/v1/claims/${CLAIM_ID}/packet`) return status === 'AWAITING_ANALYSIS' ? json(404, errorBody('not_found')) : json(200, opts.packet ?? packet);
    if (u.startsWith('/api/v1/claims?')) return json(200, { items: [claim(status)], page: 1, pageSize: 25, total: 1 });
    if (u.startsWith('/api/v1/features')) return json(200, { features: {} });
    return json(404, errorBody('not_found'));
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe('claim sheet: Analyze action', () => {
  it('shows the action with both notes in Summary and Evidence; analyzes and switches to the new revision', async () => {
    const be = backend({});
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    const sheet = await screen.findByRole('dialog', { name: /Claim CLM-0042/u });
    const button = await within(sheet).findByRole('button', { name: ANALYSIS_TEXT.button });
    expect(within(sheet).getByText(ANALYSIS_NOTE)).toBeInTheDocument();
    expect(within(sheet).getByText(ANALYZE_AUTHOR_NOTE)).toBeInTheDocument();

    await user.click(within(sheet).getByRole('tab', { name: 'Evidence' }));
    expect(within(sheet).getByText(NO_PACKET_TEXT)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: ANALYSIS_TEXT.button })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('tab', { name: 'Summary' }));
    expect(button).toBeDefined();

    await user.click(within(sheet).getByRole('button', { name: ANALYSIS_TEXT.button }));
    expect(await screen.findByText(ANALYSIS_TEXT.success)).toBeInTheDocument();
    const posts = be.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/analyze'));
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]?.body ?? 'null')).toEqual({});
    await waitFor(() => expect(within(sheet).getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true'));
    expect(await within(sheet).findByText('DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: ANALYSIS_TEXT.button })).toBeNull();
  });

  it('disables the button while pending and labels it Analyzing...', async () => {
    let release: (r: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const be = backend({});
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).endsWith('/analyze') ? pending : be.fetchImpl(url, init)) as typeof fetch;
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    await user.click(await screen.findByRole('button', { name: ANALYSIS_TEXT.button }));
    expect(await screen.findByRole('button', { name: ANALYSIS_TEXT.busy })).toBeDisabled();
    release(json(409, errorBody('invalid_state')));
    expect(await screen.findByRole('alert')).toHaveTextContent(ANALYSIS_TEXT.conflict);
  });

  it.each([
    [409, 'invalid_state', ANALYSIS_TEXT.conflict],
    [422, 'analysis_input_invalid', ANALYSIS_TEXT.invalid],
    [403, 'forbidden', ANALYSIS_TEXT.forbidden],
    [429, 'rate_limited', ANALYSIS_TEXT.rateLimited],
    [500, 'internal_error', ANALYSIS_TEXT.failed],
  ])('maps HTTP %i to its fixed alert text (never the server message)', async (status, code, text) => {
    const be = backend({ analyze: () => json(status, errorBody(code)) });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    await user.click(await screen.findByRole('button', { name: ANALYSIS_TEXT.button }));
    const sheet = screen.getByRole('dialog', { name: /Claim CLM-0042/u });
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(text);
    expect(sheet.textContent).not.toContain('SERVER TEXT');
  });

  it('is absent without claims:analyze and for claims in any other status', async () => {
    const noPerm = backend({ permissions: WITHOUT });
    const { unmount } = render(<AppRoot fetchImpl={noPerm.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    expect(await screen.findByText('Acme Freight LLC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ANALYSIS_TEXT.button })).toBeNull();
    expect(screen.queryByText(ANALYSIS_NOTE)).toBeNull();
    unmount();

    const pendingClaim = backend({ status: 'PENDING_REVIEW' });
    render(<AppRoot fetchImpl={pendingClaim.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    expect(await screen.findByText('Acme Freight LLC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ANALYSIS_TEXT.button })).toBeNull();
  });
});

describe('claims page: bulk analyze', () => {
  it('opens the dialog, posts limit 10 and shows the summary with failed claim numbers as text', async () => {
    const be = backend({
      bulk: () =>
        json(200, {
          limit: 10,
          examined: 3,
          analyzed: [{ claimId: U(21), claimNumber: 'CLM-0021', packetId: U(31), findingsCount: 2, recoverableCents: 100, pendingReviewCents: 0 }],
          skipped: [{ claimId: U(22), claimNumber: 'CLM-0022', code: 'invalid_state' }],
          failed: [{ claimId: U(23), claimNumber: '<b>CLM-0023</b>', code: 'analysis_input_invalid', reasonCode: 'input_values' }],
          remaining: 4,
          stoppedBy: 'candidates',
        }),
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={['/claims']} />);
    await user.click(await screen.findByRole('button', { name: ANALYSIS_TEXT.bulkButton }));
    const dialog = await screen.findByRole('dialog', { name: ANALYSIS_TEXT.bulkTitle });
    // Hardening (C7.4): the intro says failed claims are tried after the others.
    expect(within(dialog).getByText(BULK_ANALYZE_INTRO)).toBeInTheDocument();
    expect(within(dialog).getByText(ANALYSIS_NOTE)).toBeInTheDocument();
    expect(within(dialog).getByText(ANALYZE_AUTHOR_NOTE)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: ANALYSIS_TEXT.bulkCancel })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: ANALYSIS_TEXT.bulkConfirm }));
    const status = await within(dialog).findByRole('status');
    expect(status).toHaveTextContent(ANALYSIS_TEXT.bulkSummary(1, 1, 1, 4));
    // Hardening (C7.4): the stop reason follows the summary line.
    expect(status).toHaveTextContent(BULK_STOPPED_TEXT.candidates);
    expect(status).toHaveTextContent(`${ANALYSIS_TEXT.bulkFailedPrefix}<b>CLM-0023</b>`);
    expect(status.querySelector('b')).toBeNull();
    const posts = be.calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/claims/analyze-awaiting');
    expect(posts.map((c) => JSON.parse(c.body ?? 'null') as unknown)).toEqual([{ limit: 10 }]);
    await user.click(within(dialog).getByRole('button', { name: ANALYSIS_TEXT.bulkClose }));
    expect(screen.queryByRole('dialog', { name: ANALYSIS_TEXT.bulkTitle })).toBeNull();
  });

  it('shows a fixed alert on error and closes on Escape', async () => {
    const be = backend({ bulk: () => json(429, errorBody('rate_limited')) });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={['/claims']} />);
    await user.click(await screen.findByRole('button', { name: ANALYSIS_TEXT.bulkButton }));
    const dialog = await screen.findByRole('dialog', { name: ANALYSIS_TEXT.bulkTitle });
    await user.click(within(dialog).getByRole('button', { name: ANALYSIS_TEXT.bulkConfirm }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(ANALYSIS_TEXT.rateLimited);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ANALYSIS_TEXT.bulkTitle })).toBeNull());
  });

  it('has no bulk button without claims:analyze', async () => {
    const be = backend({ permissions: WITHOUT });
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={['/claims']} />);
    expect(await screen.findByText('CLM-0042')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ANALYSIS_TEXT.bulkButton })).toBeNull();
  });
});

describe('hardening: failed analysis, confidence wording (C7.2, C7.3)', () => {
  const details = (code: string) => ({ error: { code: 'analysis_input_invalid', message: '<b>SERVER TEXT</b>', requestId: 'r', details: [{ path: 'analysis', code }] } });

  it.each([
    ['fuel_check', ANALYSIS_FAILURE_TEXT.fuel_check],
    ['amount_out_of_range', ANALYSIS_FAILURE_TEXT.amount_out_of_range],
    ['input_values', ANALYSIS_FAILURE_TEXT.input_values],
    ['something_else', ANALYSIS_TEXT.invalid],
  ])('a 422 with reason %s shows its fixed alert text', async (code, text) => {
    const be = backend({ analyze: () => json(422, details(code)) });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    await user.click(await screen.findByRole('button', { name: ANALYSIS_TEXT.button }));
    const sheet = screen.getByRole('dialog', { name: /Claim CLM-0042/u });
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(text);
    expect(sheet.textContent).not.toContain('SERVER TEXT');
  });

  it('shows the persistent failure note to every reader, also without claims:analyze', async () => {
    const be = backend({
      permissions: WITHOUT,
      claimOverrides: { analysisFailure: { lastFailedAt: '2026-10-11T09:30:00.000Z', reasonCode: 'input_values', failedAttempts: 2 } },
    });
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    const sheet = await screen.findByRole('dialog', { name: /Claim CLM-0042/u });
    const note = await within(sheet).findByText((t) => t.startsWith('Last analysis attempt failed on '));
    expect(note.textContent).toContain('(2 failed attempts so far). ');
    expect(note.textContent?.endsWith(ANALYSIS_FAILURE_TEXT.input_values)).toBe(true);
    expect(within(sheet).queryByRole('button', { name: ANALYSIS_TEXT.button })).toBeNull();
  });

  it('shows no failure note without analysisFailure', async () => {
    const be = backend({});
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    const sheet = await screen.findByRole('dialog', { name: /Claim CLM-0042/u });
    await within(sheet).findByRole('button', { name: ANALYSIS_TEXT.button });
    expect(within(sheet).queryByText((t) => t.startsWith('Last analysis attempt failed'))).toBeNull();
  });

  it('labels finding confidence as a fixed rule setting, never a percentage', async () => {
    const finding = {
      id: U(50),
      ruleId: 'INV-LINEHAUL-RATE',
      title: 'Linehaul above contract',
      direction: 'OVERCHARGE',
      amountCents: 32500,
      explanation: 'Synthetic explanation.',
      calculation: ['1 - 1 = 0'],
      confidence: 0.9,
      needsHumanReview: false,
      citations: [],
      governingClause: null,
    };
    const be = backend({ status: 'PENDING_REVIEW', packet: { ...packet, findings: [finding] } });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={be.fetchImpl} initialEntries={[`/claims/${CLAIM_ID}`]} />);
    const sheet = await screen.findByRole('dialog', { name: /Claim CLM-0042/u });
    await user.click(within(sheet).getByRole('tab', { name: 'Evidence' }));
    expect(await within(sheet).findByText((t) => t.includes(findingConfidenceText(0.9)))).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/confidence [0-9]+%/u);
    expect(within(sheet).getByRole('table', { name: 'Packet sources' })).toBeInTheDocument();
  });
});

