// @vitest-environment jsdom
/* eslint-disable */
// T-UI-10, T-UI-11
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupDom } from './helpers/render.js';
import { ACCESS_A, CSRF, createStub, deferred, json, mkClaim, type RoleName } from './helpers/stub.js';

setupDom();
const WAIT = { timeout: 5000 };
const mkStub = (role: RoleName = 'MANAGER') => {
  const claims = [
    mkClaim(1),
    mkClaim(2, { pendingReviewCents: 15000, recoverableCents: 10000 }),
    mkClaim(3, { status: 'APPROVED', latestPacket: { revision: 1, status: 'APPROVED' } }),
  ];
  return createStub({ role, claims });
};
const count = (name: string) => screen.queryAllByRole('button', { name }).length;
async function openQueue(role: RoleName = 'MANAGER') {
  const stub = mkStub(role);
  const r = await renderApp(stub, ['/approvals']);
  expect(await screen.findByRole('heading', { name: 'Approvals' }, WAIT)).toBeTruthy();
  await screen.findByText('CLM-0001', { exact: false }, WAIT);
  return { stub, ...r };
}
const rowOf = (num: string) => screen.getByText(num, { exact: false }).closest('tr') as HTMLElement;

describe('T-UI-10 action visibility by permission', () => {
  it('MANAGER: Approve/Reject/Edit on PENDING rows, Send only on APPROVED rows', async () => {
    await openQueue('MANAGER');
    expect([count('Approve'), count('Reject'), count('Edit'), count('Send')]).toEqual([2, 2, 2, 1]);
    expect(within(rowOf('CLM-0003')).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(rowOf('CLM-0003')).getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(within(rowOf('CLM-0001')).queryByRole('button', { name: 'Send' })).toBeNull();
  });
  it('REVIEWER: no Send', async () => {
    await openQueue('REVIEWER');
    expect([count('Approve'), count('Reject'), count('Edit'), count('Send')]).toEqual([2, 2, 2, 0]);
  });
  for (const role of ['ANALYST', 'VIEWER'] as RoleName[]) {
    it(`${role}: none of the four, and keyboard cannot open a dialog`, async () => {
      const { user } = await openQueue(role);
      expect([count('Approve'), count('Reject'), count('Edit'), count('Send')]).toEqual([0, 0, 0, 0]);
      await user.tab();
      await user.keyboard('{Enter}');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }
});

describe('T-UI-10 approve dialog', () => {
  it('Confirm gating, acknowledgement, request shape, no double submit, no optimistic update, toast, refetch', async () => {
    const { stub, user } = await openQueue('MANAGER');
    const gate = deferred<void>();
    let hits = 0;
    stub.on('POST', /packet\/approve$/, async () => {
      hits++;
      await gate.promise;
      const c = stub.claims.find((x) => x.claimNumber === 'CLM-0001')!;
      c.status = 'APPROVED';
      return json(200, { claim: { id: c.id, status: 'APPROVED' }, packet: { id: '00000000-0000-4000-8000-0000000000a3', revision: 1, status: 'APPROVED' } });
    });
    await user.click(within(rowOf('CLM-0001')).getByRole('button', { name: 'Approve' }));
    const dlg = await screen.findByRole('dialog', { name: 'Approve CLM-0001' }, WAIT);
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const reason = within(dlg).getByRole('textbox', { name: 'Reason' });
    const confirm = within(dlg).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    await user.type(reason, '123456789');
    expect(confirm.disabled).toBe(true);
    await user.clear(reason);
    await user.type(reason, '          x');
    expect(confirm.disabled, 'whitespace padding must not count').toBe(true);
    await user.clear(reason);
    await user.type(reason, 'Checked sources ok');
    expect(confirm.disabled).toBe(false);
    const approvalsBefore = stub.count('GET', /\/approvals$/);
    await user.dblClick(confirm);
    await waitFor(() => expect(hits).toBe(1), WAIT);
    expect((within(dlg).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
    expect(count('Approve'), 'no optimistic change while the request is pending').toBe(2);
    expect(hits).toBe(1);
    gate.resolve();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Approve CLM-0001' })).toBeNull(), WAIT);
    const call = stub.calls.find((c) => c.path.endsWith('/packet/approve'))!;
    expect(call.path).toBe(`/api/v1/claims/${stub.claims[0]!.id}/packet/approve`);
    expect(call.body).toMatchObject({ packetRevision: 1, reason: 'Checked sources ok' });
    expect(call.headers.get('authorization')).toBe(`Bearer ${ACCESS_A}`);
    expect(call.headers.get('x-csrf-token')).toBe(CSRF);
    const notes = screen.getByRole('status', { name: 'Notifications' });
    await waitFor(() => expect(notes.textContent!.trim().length).toBeGreaterThan(0), WAIT);
    await waitFor(() => expect(stub.count('GET', /\/approvals$/)).toBeGreaterThan(approvalsBefore), WAIT);
    await waitFor(() => expect(count('Approve')).toBe(1), WAIT);
  });
  it('pending findings require the acknowledgement checkbox and send acknowledgePendingFindings:true', async () => {
    const { stub, user } = await openQueue('MANAGER');
    await user.click(within(rowOf('CLM-0002')).getByRole('button', { name: 'Approve' }));
    const dlg = await screen.findByRole('dialog', { name: 'Approve CLM-0002' }, WAIT);
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'Reviewed the pending items');
    const confirm = within(dlg).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(within(dlg).getByRole('checkbox', { name: 'I acknowledge findings pending human review' }));
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(stub.count('POST', /packet\/approve$/)).toBe(1), WAIT);
    expect(stub.calls.find((c) => c.path.endsWith('/packet/approve'))!.body).toMatchObject({ packetRevision: 1, acknowledgePendingFindings: true });
  });
  it('409 shows the fixed conflict message and refetches; 422 shows a fixed message', async () => {
    const { stub, user } = await openQueue('MANAGER');
    stub.on('POST', /packet\/approve$/, () => json(409, { error: { code: 'stale_revision', message: 'SERVER 409 TEXT', requestId: 'r' } }));
    const before = stub.count('GET', /\/approvals$/);
    await user.click(within(rowOf('CLM-0001')).getByRole('button', { name: 'Approve' }));
    let dlg = await screen.findByRole('dialog', { name: 'Approve CLM-0001' }, WAIT);
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'Reason that is long enough');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('This item changed. Reload to continue.', { exact: false }, WAIT)).toBeTruthy();
    expect(document.body.textContent).not.toContain('SERVER 409 TEXT');
    await waitFor(() => expect(stub.count('GET', /\/approvals$/)).toBeGreaterThan(before), WAIT);
    // 422
    const stub2 = mkStub('MANAGER');
    stub2.on('POST', /packet\/approve$/, () => json(422, { error: { code: 'unprocessable', message: 'SERVER 422 TEXT', requestId: 'r' } }));
    cleanup();
    const r2 = await renderApp(stub2, ['/approvals']);
    await screen.findByText('CLM-0001', { exact: false }, WAIT);
    await r2.user.click(within(rowOf('CLM-0001')).getByRole('button', { name: 'Approve' }));
    dlg = await screen.findByRole('dialog', { name: 'Approve CLM-0001' }, WAIT);
    await r2.user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'Reason that is long enough');
    await r2.user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(stub2.count('POST', /packet\/approve$/)).toBe(1), WAIT);
    await new Promise((r) => setTimeout(r, 300));
    expect(document.body.textContent).not.toContain('SERVER 422 TEXT');
    expect((await screen.findAllByRole('alert', {}, WAIT)).length).toBeGreaterThan(0);
  });
});

describe('T-UI-10 edit and send dialogs', () => {
  it('Edit: prefilled letter, sends baseRevision/demandLetter/reason', async () => {
    const { stub, user } = await openQueue('MANAGER');
    await user.click(within(rowOf('CLM-0001')).getByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit CLM-0001' }, WAIT);
    const letter = (await within(dlg).findByRole('textbox', { name: 'Demand letter' }, WAIT)) as HTMLTextAreaElement;
    await waitFor(() => expect(letter.value).toBe('DRAFT letter for CLM-0001\nline two'), WAIT);
    await user.clear(letter);
    await user.type(letter, 'A rewritten demand letter');
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'Rewrite for clarity');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(stub.count('POST', /packet\/revisions$/)).toBe(1), WAIT);
    expect(stub.calls.find((c) => c.path.endsWith('/packet/revisions'))!.body).toEqual({ baseRevision: 1, demandLetter: 'A rewritten demand letter', reason: 'Rewrite for clarity' });
  });
  it('Send: states that nothing is emailed', async () => {
    const { stub, user } = await openQueue('MANAGER');
    await user.click(within(rowOf('CLM-0003')).getByRole('button', { name: 'Send' }));
    const dlg = await screen.findByRole('dialog', { name: 'Send CLM-0003' }, WAIT);
    expect(dlg.textContent).toContain('This marks the demand as ready to send. No email is sent from this app.');
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'Ready for the sender to dispatch');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(stub.count('POST', /packet\/send$/)).toBe(1), WAIT);
    expect(stub.calls.find((c) => c.path.endsWith('/packet/send'))!.body).toMatchObject({ packetRevision: 1, reason: 'Ready for the sender to dispatch' });
  });
});

describe('T-UI-11 permission-driven UI is only cosmetic', () => {
  it('a 403 from the server yields a fixed message and no state change', async () => {
    const { stub, user } = await openQueue('MANAGER');
    stub.on('POST', /packet\/approve$/, () => json(403, { error: { code: 'forbidden', message: 'SERVER 403 TEXT', requestId: 'r' } }));
    await user.click(within(rowOf('CLM-0001')).getByRole('button', { name: 'Approve' }));
    const dlg = await screen.findByRole('dialog', { name: 'Approve CLM-0001' }, WAIT);
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'Reason that is long enough');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/You do not have permission/i, {}, WAIT)).toBeTruthy();
    expect(document.body.textContent).not.toContain('SERVER 403 TEXT');
    expect(stub.claims[0]!.status).toBe('PENDING_REVIEW');
    expect(count('Approve')).toBeGreaterThanOrEqual(1);
  });
});