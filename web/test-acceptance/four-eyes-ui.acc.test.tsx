// @vitest-environment jsdom
/* eslint-disable */
// REQ-20261009-four-eyes UI: FE-U01..FE-U10 (test-spec T7; Part C P3, P7). AppRoot with an in-memory router and a
// scripted fetch serving contract-shaped fixtures; queries by role and accessible name.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeXHR, json, mkDoc, mkField } from './helpers/imp-stub.js';
import { loadAppRoot, renderApp, setupDom, signedIn } from './helpers/render.js';
import { createStub, mkClaim, type RoleName } from './helpers/stub.js';

const CLAIM_TEXT = 'You edited this revision. Another approver must approve it.';
// REQ-20261012-hardening C7.1 (contract change): a self-authored queue row shows the basis text; the stub's default
// basis is revision_author. CLAIM_TEXT (unchanged constant) stays the late-refusal alert text (FE-U04).
const BASIS_TEXT = 'You created a revision of this claim (by editing, analyzing or running the D&D audit). Another approver must approve it.';
const DOC_TEXT = 'You uploaded or edited this document. Another reviewer must accept it.';
const FE_BODY = { error: { code: 'four_eyes_required', message: 'A different person must make this decision.', requestId: 'r' } };
const WAIT = { timeout: 5000 };

setupDom();
beforeEach(() => FakeXHR.reset());
afterEach(() => cleanup());

const btn = (scope: HTMLElement, name: string) => within(scope).queryByRole('button', { name });
const rowOf = (num: string) => screen.getByText(num, { exact: false }).closest('tr') as HTMLElement;
const alertWith = async (text: string) =>
  waitFor(() => {
    const hit = screen.queryAllByRole('alert').find((a) => (a.textContent ?? '').trim() === text);
    expect(hit, `role=alert with exactly "${text}"; alerts: ${JSON.stringify(screen.queryAllByRole('alert').map((a) => a.textContent))}`).toBeTruthy();
    return hit!;
  }, WAIT);

async function openQueue(role: RoleName, claims: any[], self: string[]) {
  const stub = createStub({ role, claims, selfAuthored: new Set(self) });
  const r = await renderApp(stub, ['/approvals']);
  await screen.findByRole('heading', { name: 'Approvals' }, WAIT);
  await screen.findByText(claims[0].claimNumber, { exact: false }, WAIT);
  return { stub, ...r };
}

describe('FE-U01..U03 approvals page', () => {
  it('FE-U01 MANAGER: self-authored PENDING row has no Approve/Reject, shows the copy, keeps Edit; other row unchanged', async () => {
    const a = mkClaim(1), b = mkClaim(2);
    await openQueue('MANAGER', [a, b], [a.id]);
    const ra = rowOf('CLM-0001'), rb = rowOf('CLM-0002');
    expect(btn(ra, 'Approve')).toBeNull();
    expect(btn(ra, 'Reject')).toBeNull();
    expect(btn(ra, 'Edit')).toBeTruthy();
    expect(ra.textContent).toContain(BASIS_TEXT);
    expect(btn(rb, 'Approve')).toBeTruthy();
    expect(btn(rb, 'Reject')).toBeTruthy();
    expect(btn(rb, 'Edit')).toBeTruthy();
    expect(rb.textContent).not.toContain(BASIS_TEXT);
    expect(screen.getAllByText(BASIS_TEXT)).toHaveLength(1);
    expect(document.body.textContent).not.toContain(CLAIM_TEXT);
  });
  it('FE-U02 OWNER: APPROVED self-authored row keeps Send; no copy', async () => {
    const c = mkClaim(3, { status: 'APPROVED', latestPacket: { revision: 1, status: 'APPROVED' } });
    await openQueue('OWNER', [c], [c.id]);
    const r = rowOf('CLM-0003');
    expect(btn(r, 'Send')).toBeTruthy();
    expect(r.textContent).not.toContain(CLAIM_TEXT);
    expect(document.body.textContent).not.toContain(CLAIM_TEXT);
    expect(document.body.textContent).not.toContain(BASIS_TEXT);
  });
  it('FE-U03 VIEWER: no Approve/Reject and no copy even when selfAuthored', async () => {
    const c = mkClaim(1);
    await openQueue('VIEWER', [c], [c.id]);
    const r = rowOf('CLM-0001');
    expect(btn(r, 'Approve')).toBeNull();
    expect(btn(r, 'Reject')).toBeNull();
    expect(document.body.textContent).not.toContain(CLAIM_TEXT);
    expect(document.body.textContent).not.toContain(BASIS_TEXT);
  });
});

describe('FE-U04/U05 late refusal in the approve dialog', () => {
  async function submitApprove(status: number, body: any) {
    const a = mkClaim(1), b = mkClaim(2);
    const { stub, user } = await openQueue('MANAGER', [a, b], []);
    stub.on('POST', /packet\/approve$/, () => json(status, body));
    const before = stub.count('GET', /\/approvals$/);
    await user.click(within(rowOf('CLM-0001')).getByRole('button', { name: 'Approve' }));
    const dlg = await screen.findByRole('dialog', { name: 'Approve CLM-0001' }, WAIT);
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'Reason that is long enough');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(stub.count('POST', /packet\/approve$/)).toBe(1), WAIT);
    return { stub, before };
  }
  it('FE-U04: 403 four_eyes_required -> alert with exactly the claim copy; queue refetched', async () => {
    const { stub, before } = await submitApprove(403, FE_BODY);
    await alertWith(CLAIM_TEXT);
    expect(document.body.textContent).not.toMatch(/You do not have permission/i);
    expect(document.body.textContent).not.toContain('This item changed. Reload to continue.');
    expect(document.body.textContent).not.toContain('A different person must make this decision.');
    await waitFor(() => expect(stub.count('GET', /\/approvals$/)).toBeGreaterThan(before), WAIT);
  });
  it('FE-U05: 409 stale_revision keeps the existing stale text', async () => {
    const { stub, before } = await submitApprove(409, { error: { code: 'stale_revision', message: 'SERVER 409 TEXT', requestId: 'r' } });
    expect(await screen.findByText('This item changed. Reload to continue.', { exact: false }, WAIT)).toBeTruthy();
    expect(document.body.textContent).not.toContain(CLAIM_TEXT);
    expect(document.body.textContent).not.toContain('SERVER 409 TEXT');
    await waitFor(() => expect(stub.count('GET', /\/approvals$/)).toBeGreaterThan(before), WAIT);
  });
});

const BID = '00000000-0000-4000-8000-0000000b0001';
const reviewDoc = (o: Record<string, any> = {}) => mkDoc({ displayName: 'rc.pdf', status: 'NEEDS_REVIEW', batchId: BID, reviewReasons: ['FLAGGED_FIELDS'], fields: [mkField('rate_confirmation.carrier', 'Acme', { confidence: 0.85, needsReview: true, reviewReasons: ['LOW_CONFIDENCE'] })], ...o });
async function openReview(initial: any, opts: { onResolve?: (d: any) => any; accept?: () => Response } = {}) {
  const state = { doc: initial };
  const stub = createStub({ role: 'REVIEWER' });
  stub.on('GET', /\/reviews$/, () => json(200, { items: [{ documentId: state.doc.id, batchId: BID, batchLabel: null, displayName: state.doc.displayName, docType: state.doc.docType, reviewReasons: state.doc.reviewReasons, flaggedFieldCount: 1, unresolvedFlaggedCount: 1, uploadedBy: { id: '00000000-0000-4000-8000-0000000000e2', name: 'U' }, waitingSince: '2026-10-08T09:00:00.000Z' }], page: 1, pageSize: 25, total: 1 }));
  stub.on('GET', /\/imports\/00000000-0000-4000-8000-0000000b0001\/documents\/[^/]+$/, () => json(200, state.doc));
  stub.on('POST', /\/resolve$/, (c) => {
    const f = { ...state.doc.fields[0], status: 'CORRECTED', correctedValue: c.body?.correctedValue ?? null, effectiveValue: c.body?.correctedValue ?? null, resolvedAt: '2026-10-09T10:00:00.000Z', resolvedBy: { id: '00000000-0000-4000-8000-000000000008', name: 'Test REVIEWER', role: 'REVIEWER' } };
    state.doc = opts.onResolve ? opts.onResolve(state.doc) : state.doc;
    return json(200, f);
  });
  stub.on('POST', /\/accept$/, () => (opts.accept ? opts.accept() : json(200, { ...state.doc, status: 'ACCEPTED' })));
  const AppRoot = await loadAppRoot();
  const user = userEvent.setup();
  render(<AppRoot fetchImpl={stub.fetch} xhrImpl={FakeXHR as any} initialEntries={['/import/review']} />);
  await signedIn().catch(() => undefined);
  await screen.findByRole('heading', { name: 'Review queue' }, WAIT);
  await user.click(await screen.findByRole('button', { name: 'Review' }, WAIT));
  const dlg = await screen.findByRole('dialog', { name: 'Review rc.pdf' }, WAIT);
  await within(dlg).findByRole('button', { name: 'Reject document' }, WAIT);
  return { stub, user, dlg, state };
}
const docGets = (stub: ReturnType<typeof createStub>) => stub.count('GET', /\/imports\/[^/]+\/documents\/[^/]+$/);

describe('FE-U06..U09 review dialog', () => {
  it('FE-U06: selfAuthored true -> no Accept document, copy shown; Reject document, Close and field actions remain', async () => {
    const { dlg } = await openReview(reviewDoc({ selfAuthored: true }));
    expect(btn(dlg, 'Accept document')).toBeNull();
    expect(dlg.textContent).toContain(DOC_TEXT);
    expect(btn(dlg, 'Reject document')).toBeTruthy();
    expect(btn(dlg, 'Close')).toBeTruthy();
    for (const n of ['Confirm Carrier', 'Correct Carrier', 'Reject Carrier']) expect(btn(dlg, n), n).toBeTruthy();
  });
  it('FE-U07: selfAuthored false -> Accept document present, no copy', async () => {
    const { dlg } = await openReview(reviewDoc({ selfAuthored: false }));
    expect(btn(dlg, 'Accept document')).toBeTruthy();
    expect(document.body.textContent).not.toContain(DOC_TEXT);
  });
  it('FE-U08: after the user corrects a field and the detail reloads with selfAuthored true, Accept disappears and the copy appears', async () => {
    const { user, dlg, stub } = await openReview(reviewDoc({ selfAuthored: false }), { onResolve: (d) => ({ ...d, selfAuthored: true }) });
    expect(btn(dlg, 'Accept document')).toBeTruthy();
    const gets = docGets(stub);
    await user.click(within(dlg).getByRole('button', { name: 'Correct Carrier' }));
    await user.type(await screen.findByRole('textbox', { name: 'Corrected value' }, WAIT), 'Other Carrier LLC');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'value read from the paper copy');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(stub.count('POST', /\/resolve$/)).toBe(1), WAIT);
    await waitFor(() => expect(docGets(stub)).toBeGreaterThan(gets), WAIT);
    const d2 = await screen.findByRole('dialog', { name: 'Review rc.pdf' }, WAIT);
    await waitFor(() => expect(btn(d2, 'Accept document')).toBeNull(), WAIT);
    await waitFor(() => expect(d2.textContent).toContain(DOC_TEXT), WAIT);
  });
  it('FE-U09: accept answered by 403 four_eyes_required -> alert with exactly the document copy; document re-fetched', async () => {
    const { user, dlg, stub } = await openReview(reviewDoc({ selfAuthored: false }), { accept: () => json(403, FE_BODY) });
    const gets = docGets(stub);
    await user.click(within(dlg).getByRole('button', { name: 'Accept document' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Confirm all remaining flagged fields' }, WAIT));
    await user.type(await screen.findByRole('textbox', { name: 'Reason' }, WAIT), 'accepting after review');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(stub.count('POST', /\/accept$/)).toBe(1), WAIT);
    await alertWith(DOC_TEXT);
    expect(document.body.textContent).not.toMatch(/You do not have permission/i);
    expect(document.body.textContent).not.toContain('A different person must make this decision.');
    await waitFor(() => expect(docGets(stub)).toBeGreaterThan(gets), WAIT);
  });
});

describe('FE-U10 selfAuthored is required by the client schemas', () => {
  it('approvals items without selfAuthored are a parse failure (no action buttons rendered)', async () => {
    const a = mkClaim(1);
    const stub = createStub({ role: 'MANAGER', claims: [a] });
    stub.on('GET', /\/approvals$/, () => json(200, { items: [{ ...a, packetRevision: 1, pendingFindingsCount: 0, waitingSince: a.updatedAt }], page: 1, pageSize: 25, total: 1 }));
    await renderApp(stub, ['/approvals']);
    await screen.findByRole('heading', { name: 'Approvals' }, WAIT);
    expect(await screen.findByText('The approval queue could not be loaded.', { exact: false }, WAIT)).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'Approve' })).toHaveLength(0);
  });
  it('document detail without selfAuthored is a parse failure (no Accept document)', async () => {
    const d: any = reviewDoc();
    delete d.selfAuthored;
    const stub = createStub({ role: 'REVIEWER' });
    stub.on('GET', /\/reviews$/, () => json(200, { items: [{ documentId: d.id, batchId: BID, batchLabel: null, displayName: d.displayName, docType: d.docType, reviewReasons: d.reviewReasons, flaggedFieldCount: 1, unresolvedFlaggedCount: 1, uploadedBy: null, waitingSince: '2026-10-08T09:00:00.000Z' }], page: 1, pageSize: 25, total: 1 }));
    stub.on('GET', /\/imports\/00000000-0000-4000-8000-0000000b0001\/documents\/[^/]+$/, () => json(200, d));
    const AppRoot = await loadAppRoot();
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={stub.fetch} xhrImpl={FakeXHR as any} initialEntries={['/import/review']} />);
    await user.click(await screen.findByRole('button', { name: 'Review' }, WAIT));
    expect(await screen.findByText('This document could not be loaded.', { exact: false }, WAIT)).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'Accept document' })).toHaveLength(0);
  });
  it('the shared stub fixtures carry selfAuthored (helpers updated)', async () => {
    expect(mkDoc().selfAuthored).toBe(false);
    const c = mkClaim(1);
    const stub = createStub({ claims: [c], selfAuthored: new Set([c.id]) });
    const r = await stub.fetch('/api/v1/approvals', { headers: { authorization: 'Bearer x' } });
    const body = await r.json();
    expect(body.items[0].selfAuthored).toBe(true);
    expect(body.items[0].selfAuthoredBasis).toBe('revision_author');
  });
});
