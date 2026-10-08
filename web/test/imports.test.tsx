import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError } from '../src/api/client';
import { AppRoot } from '../src/app-root';
import { createSessionStore } from '../src/auth/session-store';
import { claimsExportPath } from '../src/features/claims/ClaimsPage';
import {
  commitSummary,
  confidenceText,
  formatFieldValue,
  formatMoneyDecimal,
  preFilter,
  sourceText,
  uploadErrorText,
} from '../src/features/imports/import-format';

import { fakeXhrFactory } from './helpers/fake-xhr';
import { HOSTILE, U, batch, doc, field } from './helpers/import-fixtures';

const tenant = { id: U(90), name: 'Acme Logistics (synthetic)' };
const manager = { id: U(1), email: 'manager@acme.test', name: 'Morgan Manager', role: 'MANAGER', tenant, mfaEnabled: false };
const ALL = ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes'];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const notFound = () => json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });

function authed(permissions: string[], handler: (u: string, init?: RequestInit) => Response | undefined) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user: manager });
    if (u === '/api/v1/me') return json(200, { user: manager, permissions });
    if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 1, total: 0 });
    return handler(u, init) ?? notFound();
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('import formatting helpers', () => {
  it('formats confidence, sources and values', () => {
    expect(confidenceText(0.95)).toBe('95% High');
    expect(confidenceText(0.6)).toMatch(/^60% /u);
    expect(sourceText({ page: 2, line: 14, start: 10, end: 18, row: null, excerpt: '' })).toBe('p.2 line 14 chars 10-18');
    expect(sourceText({ page: null, line: 3, start: 0, end: 4, row: 2, excerpt: '' })).toBe('line 3 chars 0-4');
    expect(sourceText(null)).toBe('Manual entry');
    expect(formatMoneyDecimal('1234.5')).toBe('$1,234.50');
    expect(formatMoneyDecimal('-0.01')).toBe('-$0.01');
    expect(formatMoneyDecimal('1.234')).toBe('$1.234');
    expect(formatFieldValue('invoice.total', 'DECIMAL', '10')).toBe('$10.00');
    expect(formatFieldValue('x', 'DATETIME', '2026-10-08T12:30:00')).toBe('2026-10-08 12:30:00');
    expect(formatFieldValue('x', 'STRING_LIST', '["a","b"]')).toBe('a, b');
    expect(commitSummary(1, 0)).toBe('Created 1 claim, updated 0.');
    expect(commitSummary(2, 3)).toBe('Created 2 claims, updated 3.');
  });

  it('maps upload failures to fixed texts only', () => {
    expect(uploadErrorText(new ApiError(413, 'payload_too_large', 'x'))).toBe('File is too large.');
    expect(uploadErrorText(new ApiError(415, 'unsupported_file', 'x'))).toBe('File type not supported.');
    expect(uploadErrorText(new ApiError(422, 'quota_exceeded', 'x'))).toBe('Storage quota reached.');
    expect(uploadErrorText(new ApiError(503, 'parser_busy', 'x'))).toBe('The parser is busy. Try again shortly.');
    expect(uploadErrorText(new ApiError(422, 'batch_full', '<b>server</b>'))).toBe('Upload failed.');
    expect(uploadErrorText(new Error('boom'))).toBe('Upload failed.');
    expect(preFilter({ name: 'a.exe', size: 1 })).toBe('File type not supported.');
    expect(preFilter({ name: 'a.PDF', size: 11 * 1024 * 1024 })).toBe('File is too large.');
    expect(preFilter({ name: 'a.csv', size: 10 })).toBeNull();
  });

  it('builds the claims export URL from the whitelisted list filters', () => {
    const p = new URLSearchParams('q=acme&status=APPROVED&page=3&evil=1&sort=-updatedAt');
    const url = claimsExportPath(p, 'xlsx');
    expect(url.startsWith('/api/v1/exports/claims?')).toBe(true);
    const q = new URL(url, 'http://x').searchParams;
    expect(q.get('format')).toBe('xlsx');
    expect(q.get('q')).toBe('acme');
    expect(q.get('page')).toBeNull();
    expect(q.get('evil')).toBeNull();
  });
});

describe('ApiClient.upload / download', () => {
  const user = { id: U(1), email: 'v@acme.test', name: 'V', role: 'ANALYST', tenant: null, mfaEnabled: false };

  it('sends raw bytes with Bearer + CSRF and reports progress', async () => {
    const { Xhr, requests } = fakeXhrFactory([{ status: 201, body: doc() }]);
    const fetchImpl = vi.fn(async () => json(200, { csrfToken: 'n.sig' }));
    const session = createSessionStore();
    session.getState().setSession('tok', user as never);
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, session, () => undefined, Xhr);
    const progress: number[] = [];
    const file = new Blob(['%PDF-1.4']);
    const result = await api.upload(U(100), file, 'a b.pdf', { onProgress: (p) => progress.push(p) });
    expect(result.displayName).toBe('invoice-1.pdf');
    expect(requests[0]?.url).toBe(`/api/v1/imports/${U(100)}/documents?filename=a%20b.pdf`);
    expect(requests[0]?.headers['authorization']).toBe('Bearer tok');
    expect(requests[0]?.headers['x-csrf-token']).toBe('n.sig');
    expect(requests[0]?.headers['content-type']).toBe('application/octet-stream');
    expect(requests[0]?.body).toBe(file);
    expect(progress).toEqual([50, 100]);
  });

  it('refreshes once on 401 and retries the upload', async () => {
    const { Xhr, requests } = fakeXhrFactory([
      { status: 401, body: { error: { code: 'unauthenticated', message: 'x', requestId: 'r' } } },
      { status: 201, body: doc() },
    ]);
    let refreshes = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/v1/auth/refresh') {
        refreshes += 1;
        return json(200, { accessToken: 'tok2', tokenType: 'Bearer', expiresIn: 600, user });
      }
      return json(200, { csrfToken: 'n.sig' });
    });
    const session = createSessionStore();
    session.getState().setSession('tok', user as never);
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, session, () => undefined, Xhr);
    await api.upload(U(100), new Blob(['x']), 'a.txt');
    expect(refreshes).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers['authorization']).toBe('Bearer tok2');
  });

  it('surfaces status and code but never trusts an invalid success body', async () => {
    const { Xhr } = fakeXhrFactory([
      { status: 503, body: { error: { code: 'parser_busy', message: 'busy', requestId: 'r' } }, headers: { 'Retry-After': '5' } },
      { status: 201, body: { not: 'a document' } },
    ]);
    const fetchImpl = vi.fn(async () => json(200, { csrfToken: 'n.sig' }));
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, createSessionStore(), () => undefined, Xhr);
    const e1 = await api.upload(U(100), new Blob(['x']), 'a.txt').catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ApiError);
    expect((e1 as ApiError).status).toBe(503);
    expect((e1 as ApiError).retryAfterSeconds).toBe(5);
    const e2 = await api.upload(U(100), new Blob(['x']), 'a.txt').catch((e: unknown) => e);
    expect((e2 as ApiError).code).toBe('bad_response');
    await expect(api.upload('../../x', new Blob(['x']), 'a.txt')).rejects.toThrow('invalid batch id');
  });

  it('downloads through a revoked object URL with a safe filename only', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      created.push('blob:x');
      return 'blob:x';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
      revoked.push(u);
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const replies = [
      new Response('a,b\n', { status: 200, headers: { 'content-disposition': 'attachment; filename="freight-recovery-claims-20261009T120000Z.csv"' } }),
      new Response('a,b\n', { status: 200, headers: { 'content-disposition': 'attachment; filename="../../evil.exe"' } }),
    ];
    const fetchImpl = vi.fn(async () => replies.shift() ?? notFound());
    const session = createSessionStore();
    session.getState().setSession('tok', user as never);
    const api = new ApiClient(fetchImpl as unknown as typeof fetch, session, () => undefined);
    await api.download('/api/v1/exports/claims?format=csv', 'fallback.csv');
    await api.download('/api/v1/exports/claims?format=csv', 'fallback.csv');
    expect(names).toEqual(['freight-recovery-claims-20261009T120000Z.csv', 'fallback.csv']);
    expect(revoked).toEqual(created);
    await expect(api.download('https://evil.test/x', 'x')).rejects.toThrow();
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});

describe('import page', () => {
  it('uploads with progress, shows results, details and commits', async () => {
    const accepted = doc({ displayName: HOSTILE, fields: [field(), field({ id: U(301), key: 'invoice.number', kind: 'STRING', value: null, effectiveValue: null, rawValue: HOSTILE, confidence: 0.4, needsReview: true, source: null, origin: 'MANUAL' })] });
    const { Xhr } = fakeXhrFactory([{ status: 201, body: accepted }]);
    const commits: unknown[] = [];
    const fetchImpl = authed(ALL, (u, init) => {
      if (u === '/api/v1/imports' && init?.method === 'POST') return json(201, batch);
      if (u === `/api/v1/imports/${U(100)}/commit`) {
        commits.push(JSON.parse(String(init?.body)));
        return json(200, { created: [{ claimId: U(500), claimNumber: 'CLM-0100', loadNumber: 'LD-1' }], updated: [], skipped: [] });
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} xhrImpl={Xhr} initialEntries={['/import']} />);
    expect(await screen.findByRole('heading', { name: 'Import documents' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Import' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Review queue' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Drop files here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Batch label' }), 'Week 41');
    await user.upload(screen.getByLabelText('Choose files to import'), new File(['%PDF-1.4'], 'inv.pdf', { type: 'application/pdf' }));
    const bar = await screen.findByRole('progressbar', { name: 'Uploading inv.pdf' });
    expect(bar).toHaveAttribute('aria-valuenow');
    const table = await screen.findByRole('table', { name: 'Import results' });
    await within(table).findByText('Accepted');
    for (const h of ['File', 'Type', 'Status', 'Fields', 'Needs review']) expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(document.querySelector('script, img')).toBeNull();
    expect(screen.getByText('Fields below 90% need review.', { exact: false })).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog', { name: `Document ${HOSTILE}` });
    const fields = within(dialog).getByRole('table', { name: 'Extracted fields' });
    expect(within(fields).getByText('95%')).toBeInTheDocument();
    expect(within(fields).getByText('p.2 line 14 chars 10-18')).toBeInTheDocument();
    expect(within(fields).getByText('Manual entry')).toBeInTheDocument();
    expect(within(dialog).getByText('Confidence is a rule-based parse score, not an accuracy measure.', { exact: false })).toBeInTheDocument();
    expect(document.querySelector('script, img')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    const commit = screen.getByRole('button', { name: 'Create claims from accepted documents' });
    expect(commit).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Perspective' }), 'CARRIER');
    expect(commit).toBeEnabled();
    await user.click(commit);
    await waitFor(() => expect(screen.getAllByRole('status').some((s) => s.textContent === 'Created 1 claim, updated 0.')).toBe(true));
    expect(commits).toEqual([{ perspective: 'CARRIER' }]);
  });

  it('shows fixed error texts and never the server message', async () => {
    const { Xhr } = fakeXhrFactory([{ status: 413, body: { error: { code: 'payload_too_large', message: '<b>SERVER</b>', requestId: 'r' } } }]);
    const fetchImpl = authed(ALL, (u, init) => (u === '/api/v1/imports' && init?.method === 'POST' ? json(201, batch) : undefined));
    const user = userEvent.setup({ applyAccept: false });
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} xhrImpl={Xhr} initialEntries={['/import']} />);
    await user.upload(await screen.findByLabelText('Choose files to import'), new File(['x'], 'a.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('File is too large.');
    expect(document.body.textContent).not.toContain('SERVER');
    await user.upload(screen.getByLabelText('Choose files to import'), new File(['x'], 'a.exe'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('File type not supported.'));
  });

  it('hides import navigation and page from users without permission', async () => {
    const fetchImpl = authed(['claims:read'], (u) => (u.startsWith('/api/v1/claims') ? json(200, { items: [], page: 1, pageSize: 25, total: 0 }) : undefined));
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/import']} />);
    expect(await screen.findByText('You do not have permission to import documents.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Import' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Review queue' })).toBeNull();
  });
});

describe('review queue', () => {
  const flagged = field({ id: U(310), key: 'invoice.total', needsReview: true, confidence: 0.6, reviewReasons: ['LOW_CONFIDENCE'] });
  const pending = doc({ status: 'NEEDS_REVIEW', displayName: 'scan.pdf', reviewReasons: ['FLAGGED_FIELDS'], fields: [flagged], unresolvedFlaggedCount: 1 });
  const queueItem = {
    documentId: pending.id,
    batchId: pending.batchId,
    batchLabel: HOSTILE,
    displayName: 'scan.pdf',
    docType: 'INVOICE',
    reviewReasons: ['FLAGGED_FIELDS'],
    flaggedFieldCount: 1,
    unresolvedFlaggedCount: 1,
    uploadedBy: null,
    waitingSince: '2026-10-08T12:00:00.000Z',
  };
  const base = `/api/v1/imports/${pending.batchId}/documents/${pending.id}`;

  it('corrects a field, maps 400 and 409 to fixed texts, and gates accept on reason length', async () => {
    const posts: { url: string; body: unknown }[] = [];
    let resolveStatus = 400;
    const fetchImpl = authed(ALL, (u, init) => {
      if (u.startsWith('/api/v1/reviews')) return json(200, { items: [queueItem], page: 1, pageSize: 25, total: 1 });
      if (u === base && (init?.method ?? 'GET') === 'GET') return json(200, pending);
      if (init?.method === 'POST') posts.push({ url: u, body: JSON.parse(String(init.body)) });
      if (u === `${base}/fields/${flagged.id}/resolve`) {
        const s = resolveStatus;
        resolveStatus = 409;
        return json(s, { error: { code: s === 400 ? 'invalid_request' : 'conflict', message: '<i>SERVER</i>', requestId: 'r' } });
      }
      if (u === `${base}/accept`) return json(200, { ...pending, status: 'ACCEPTED' });
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/import/review']} />);
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument();
    for (const h of ['File', 'Reason', 'Waiting since']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(document.querySelector('script, img')).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review scan.pdf' });
    await user.click(await within(dialog).findByRole('button', { name: 'Correct Total' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Corrected value' }), '12.00');
    const save = within(dialog).getByRole('button', { name: 'Save correction' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'short');
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), ' but now long enough');
    await user.click(save);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That value is not valid for this field.');
    await user.click(save);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('This item changed. Reload to continue.'));
    expect(document.body.textContent).not.toContain('SERVER');
    expect(posts[0]?.body).toEqual({ action: 'CORRECT', reason: 'short but now long enough', correctedValue: '12.00' });

    await user.click(within(dialog).getByRole('button', { name: 'Accept document' }));
    const accept = await screen.findByRole('dialog', { name: 'Accept document' });
    const confirm = within(accept).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await user.type(within(accept).getByRole('textbox', { name: 'Reason' }), '   nine c  ');
    expect(confirm).toBeDisabled();
    await user.type(within(accept).getByRole('textbox', { name: 'Reason' }), 'Checked against the paper copy');
    await user.click(within(accept).getByRole('checkbox', { name: 'Confirm all remaining flagged fields' }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts.at(-1)).toEqual({ url: `${base}/accept`, body: { reason: 'nine c  Checked against the paper copy', confirmRemaining: true } });
  });
});

describe('exports and claim sheet', () => {
  const claim = {
    id: U(20),
    claimNumber: 'CLM-0200',
    loadNumber: 'LD-1',
    invoiceNumber: null,
    carrierName: '',
    shipperName: '',
    perspective: 'SHIPPER',
    status: 'AWAITING_ANALYSIS',
    amountClaimedCents: 0,
    recoverableCents: 0,
    pendingReviewCents: 0,
    currency: 'USD',
    assignee: null,
    latestPacket: null,
    invoiceDate: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  it('offers CSV/XLSX export on the claims list with fixed result texts', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let exportStatus = 200;
    const urls: string[] = [];
    const fetchImpl = authed(ALL, (u) => {
      if (u.startsWith('/api/v1/exports/claims')) {
        urls.push(u);
        return exportStatus === 200 ? new Response('a\n', { status: 200 }) : json(exportStatus, { error: { code: 'export_too_large', message: 'x', requestId: 'r' } });
      }
      if (u.startsWith('/api/v1/claims')) return json(200, { items: [claim], page: 1, pageSize: 25, total: 1 });
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/claims?status=AWAITING_ANALYSIS']} />);
    const exportBtn = await screen.findByRole('button', { name: 'Export' });
    expect(exportBtn).toHaveAttribute('aria-haspopup', 'menu');
    expect(await screen.findByText('Awaiting analysis', { selector: 'option' })).toBeInTheDocument();
    await user.click(exportBtn);
    await user.click(screen.getByRole('menuitem', { name: 'Download CSV' }));
    await waitFor(() => expect(screen.getAllByRole('status').some((s) => s.textContent === 'Export downloaded')).toBe(true));
    expect(urls[0]).toContain('format=csv');
    expect(urls[0]).toContain('status=AWAITING_ANALYSIS');
    exportStatus = 422;
    await user.click(exportBtn);
    await user.click(screen.getByRole('menuitem', { name: 'Download Excel (.xlsx)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many rows to export. Narrow your filters.');
  });

  it('hides exports without permission', async () => {
    const fetchImpl = authed(['claims:read'], (u) => (u.startsWith('/api/v1/claims') ? json(200, { items: [], page: 1, pageSize: 25, total: 0 }) : undefined));
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/claims']} />);
    expect(await screen.findByText('No claims match these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('shows the empty evidence state, documents tab, and no packet export without a packet', async () => {
    const fetchImpl = authed(ALL, (u) => {
      if (u === `/api/v1/claims/${U(20)}`) return json(200, claim);
      if (u === `/api/v1/claims/${U(20)}/documents`) {
        return json(200, { items: [{ id: U(200), displayName: HOSTILE, docType: 'INVOICE', detectedType: 'PDF', sizeBytes: 10, sha256: 'b'.repeat(64), status: 'ACCEPTED', linkedAt: '2026-10-01T00:00:00.000Z' }] });
      }
      if (u.startsWith('/api/v1/claims')) return json(200, { items: [claim], page: 1, pageSize: 25, total: 1 });
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={[`/claims/${U(20)}`]} />);
    await user.click(await screen.findByRole('tab', { name: 'Evidence' }));
    expect(await screen.findByText('No evidence packet yet. Analysis has not run for this claim.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export packet' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText('b'.repeat(64))).toBeInTheDocument();
    expect(document.querySelector('script, img')).toBeNull();
  });
});
