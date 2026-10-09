/* eslint-disable */
// T-UI-IMP UI-08 export, UI-09 claims without a packet.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './helpers/imp-stub.js';
import { loadAppRoot, setupDom, signedIn } from './helpers/render.js';
import { createStub, mkClaim, mkPacket, type RoleName } from './helpers/stub.js';

setupDom();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open(role: RoleName, path: string, stub = createStub({ role })) {
  const AppRoot = await loadAppRoot();
  const user = userEvent.setup();
  render(<AppRoot fetchImpl={stub.fetch} initialEntries={[path]} />);
  await signedIn().catch(() => undefined);
  return { stub, user };
}
function mockDownload() {
  const create = vi.fn(() => 'blob:mock'), revoke = vi.fn();
  (URL as any).createObjectURL = create; (URL as any).revokeObjectURL = revoke;
  const clicks: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
  return { create, revoke, clicks };
}
const csvResp = () => new Response(new Blob(['a,b\r\n']), { status: 200, headers: { 'content-type': 'text/csv' } });

describe('UI-08 export', () => {
  it('Export menu on /claims downloads with the current filters, announces success, revokes the object URL', async () => {
    const dl = mockDownload();
    const stub = createStub({ role: 'ANALYST' });
    stub.on('GET', /\/exports\/claims$/, () => csvResp());
    const { user } = await open('ANALYST', '/claims?q=acme&status=APPROVED&sort=claimNumber:asc', stub);
    const btn = await screen.findByRole('button', { name: 'Export' });
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    await user.click(btn);
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    await waitFor(() => expect(stub.calls.some((c) => /\/exports\/claims$/.test(c.path))).toBe(true));
    const c = stub.calls.find((x) => /\/exports\/claims$/.test(x.path))!;
    expect(c.query.get('format')).toBe('csv');
    expect(c.query.get('q')).toBe('acme');
    expect(c.query.get('status')).toBe('APPROVED');
    expect(c.query.get('sort')).toBe('claimNumber:asc');
    expect(c.query.has('page') || c.query.has('pageSize')).toBe(false);
    expect(c.headers.get('authorization')).toMatch(/^Bearer /);
    await waitFor(() => expect(dl.create).toHaveBeenCalled());
    expect((dl.create.mock.calls[0] as any[])[0]).toBeInstanceOf(Blob);
    await waitFor(() => expect(dl.clicks.length).toBe(1));
    expect(dl.clicks[0]!.hasAttribute('download')).toBe(true);
    await waitFor(() => expect(dl.revoke).toHaveBeenCalled());
    expect((await screen.findByText('Export downloaded')).textContent).toBe('Export downloaded');
  });
  it('failures: 500 and 422 show the fixed alerts', async () => {
    mockDownload();
    for (const [status, text] of [[500, 'Export failed. Try again.'], [422, 'Too many rows to export. Narrow your filters.']] as [number, string][]) {
      const stub = createStub({ role: 'MANAGER' });
      stub.on('GET', /\/exports\/claims$/, () => json(status, { error: { code: 'x', message: 'SECRET-LEAK', requestId: 'r' } }));
      const { user } = await open('MANAGER', '/claims', stub);
      await user.click(await screen.findByRole('button', { name: 'Export' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Download Excel (.xlsx)' }));
      expect((await screen.findByRole('alert')).textContent).toContain(text);
      expect(document.body.textContent).not.toContain('SECRET-LEAK');
      cleanup();
    }
  });
  it('role gating: VIEWER has no Export; ANALYST has no Export decisions; REVIEWER has Export decisions and Export packet only when a packet exists', async () => {
    await open('VIEWER', '/claims');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    cleanup();
    await open('ANALYST', '/approvals');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('button', { name: 'Export decisions' })).toBeNull();
    cleanup();
    await open('REVIEWER', '/approvals');
    expect(await screen.findByRole('button', { name: 'Export decisions' })).toBeTruthy();
  });
});

describe('UI-09 claims with no packet', () => {
  it('Awaiting analysis label, Evidence empty state, Documents tab lists name/type/sha256 as text, no Export packet', async () => {
    const claim = mkClaim(1, { status: 'AWAITING_ANALYSIS', latestPacket: null, amountClaimedCents: 0, recoverableCents: 0 });
    const withPacket = mkClaim(2);
    const stub = createStub({ role: 'REVIEWER', claims: [claim, withPacket] });
    stub.on('GET', /\/claims\/[^/]+\/packet$/, (c) => (c.path.includes(claim.id) ? json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } }) : json(200, mkPacket(withPacket))));
    stub.on('GET', /\/claims\/[^/]+\/documents$/, () => json(200, { items: [{ id: '00000000-0000-4000-8000-0000000000d1', displayName: 'invoice<b>.txt', docType: 'INVOICE', detectedType: 'TXT', sizeBytes: 10, sha256: 'ab'.repeat(32), status: 'ACCEPTED', linkedAt: '2026-10-08T10:00:00.000Z' }] }));
    const { user } = await open('REVIEWER', '/claims', stub);
    await screen.findByText('CLM-0001');
    expect(screen.getAllByText('Awaiting analysis').length).toBeGreaterThan(0);
    await user.click(screen.getByText('CLM-0001'));
    const sheet = await screen.findByRole('dialog');
    for (const tab of ['Summary', 'Evidence', 'History', 'Documents']) expect(await within(sheet).findByRole('tab', { name: tab })).toBeTruthy();
    await user.click(within(sheet).getByRole('tab', { name: 'Evidence' }));
    expect(await within(sheet).findByText('No evidence packet yet. Analysis has not run for this claim.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Export packet' })).toBeNull();
    await user.click(within(sheet).getByRole('tab', { name: 'Documents' }));
    await waitFor(() => expect(sheet.textContent).toContain('invoice<b>.txt'));
    expect(sheet.textContent).toContain('ab'.repeat(32));
    expect(sheet.innerHTML).not.toMatch(/<b>/);
  });
});

describe('UI-08 claim sheet Export packet and busy state', () => {
  it('Export packet (REVIEWER, packet exists) downloads the packet export for that claim; the trigger is aria-busy while running', async () => {
    const dl = mockDownload();
    const claim = mkClaim(1);
    const stub = createStub({ role: 'REVIEWER', claims: [claim] });
    let release: () => void = () => undefined;
    stub.on('GET', /\/exports\/packets$/, () => new Promise<Response>((res) => { release = () => res(csvResp()); }));
    const { user } = await open('REVIEWER', '/claims', stub);
    await user.click(await screen.findByText('CLM-0001'));
    const sheet = await screen.findByRole('dialog');
    const btn = await within(sheet).findByRole('button', { name: 'Export packet' });
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    await user.click(btn);
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    await waitFor(() => expect(stub.calls.some((c) => /\/exports\/packets$/.test(c.path))).toBe(true));
    const c = stub.calls.find((x) => /\/exports\/packets$/.test(x.path))!;
    expect(c.query.get('format')).toBe('csv');
    expect(c.query.get('claimId')).toBe(claim.id);
    const live = () => within(sheet).getByRole('button', { name: 'Export packet' }) as HTMLButtonElement;
    await waitFor(() => expect(live().getAttribute('aria-busy')).toBe('true'));
    expect(live().disabled).toBe(true);
    release();
    await waitFor(() => expect(dl.clicks.length).toBe(1));
    await waitFor(() => expect(live().getAttribute('aria-busy')).not.toBe('true'));
  });
});

describe('UI-10 dialogs: focus trap and keyboard operation', () => {
  it('focus stays inside the claim sheet while Tab is pressed repeatedly; Escape closes it', async () => {
    const stub = createStub({ role: 'REVIEWER', claims: [mkClaim(1)] });
    const { user } = await open('REVIEWER', '/claims', stub);
    await user.click(await screen.findByText('CLM-0001'));
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByRole('tab', { name: 'Summary' });
    for (let i = 0; i < 25; i++) { await user.tab(); expect(sheet.contains(document.activeElement), 'focus escaped after ' + (i + 1) + ' tabs').toBe(true); }
    for (let i = 0; i < 25; i++) { await user.tab({ shift: true }); expect(sheet.contains(document.activeElement)).toBe(true); }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
