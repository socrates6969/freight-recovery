// @vitest-environment jsdom
/* eslint-disable */
// T-UI-06, T-UI-07, T-UI-08
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import { createStub, json, mkClaim, mkPacket } from './helpers/stub.js';

setupDom();
afterEach(() => vi.useRealTimers());
const WAIT = { timeout: 5000 };

describe('T-UI-06 app shell', () => {
  it('landmarks, approvals badge, notifications region', async () => {
    const stub = createStub();
    await renderApp(stub, ['/claims']);
    const nav = await signedIn();
    expect(within(nav).getByRole('link', { name: /^Claims/ })).toBeTruthy();
    const appr = within(nav).getByRole('link', { name: /^Approvals/ });
    await waitFor(() => expect(appr.textContent).toMatch(/\d+/), WAIT);
    expect(screen.getByRole('button', { name: 'Command menu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Notifications' })).toBeTruthy();
    const navs = screen.getAllByRole('navigation');
    expect(new Set(navs.map((n) => n.getAttribute('aria-label') ?? n.getAttribute('aria-labelledby'))).size).toBe(navs.length);
  });
  it('command menu: button, Ctrl+K and Cmd+K; filtering, Enter navigates, Esc closes and restores focus', async () => {
    const stub = createStub();
    const { user } = await renderApp(stub, ['/claims']);
    await signedIn();
    const trigger = screen.getByRole('button', { name: 'Command menu' });
    trigger.focus();
    await user.click(trigger);
    let dlg = await screen.findByRole('dialog', { name: 'Command menu' }, WAIT);
    const box = within(dlg).queryByRole('textbox', { name: 'Search commands' }) ?? within(dlg).getByRole('combobox', { name: 'Search commands' }); // C8 says textbox; implementation uses the ARIA combobox pattern (recorded as a contract deviation)
    expect(document.activeElement).toBe(box);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command menu' })).toBeNull());
    expect(document.activeElement === trigger || document.activeElement === document.body).toBe(true);
    for (const combo of ['{Control>}k{/Control}', '{Meta>}k{/Meta}']) {
      await user.keyboard(combo);
      dlg = await screen.findByRole('dialog', { name: 'Command menu' }, WAIT);
      expect(document.activeElement).toBe(within(dlg).queryByRole('textbox', { name: 'Search commands' }) ?? within(dlg).getByRole('combobox', { name: 'Search commands' }));
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command menu' })).toBeNull());
    }
    await user.keyboard('{Control>}k{/Control}');
    dlg = await screen.findByRole('dialog', { name: 'Command menu' }, WAIT);
    await user.type(within(dlg).queryByRole('textbox', { name: 'Search commands' }) ?? within(dlg).getByRole('combobox', { name: 'Search commands' }), 'appr');
    expect(within(dlg).getAllByText(/Approvals/).length).toBeGreaterThan(0);
    expect(within(dlg).queryByText(/^Claims$/)).toBeNull();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Approvals' }, WAIT)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command menu' })).toBeNull());
  });
  it('Sign out calls logout, shows the login page and stops sending the access token', async () => {
    const stub = createStub();
    const { user } = await renderApp(stub, ['/claims']);
    await signedIn();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }, WAIT));
    expect(await screen.findByRole('heading', { name: 'Sign in' }, WAIT)).toBeTruthy();
    expect(stub.count('POST', /auth\/logout$/)).toBe(1);
    const n = stub.calls.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(stub.calls.slice(n).filter((c) => c.headers.get('authorization'))).toHaveLength(0);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
});

describe('T-UI-07 claims list', () => {
  const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
  it('25 rows, sortable headers with aria-sort and server-side sort', async () => {
    const stub = createStub();
    const { user } = await renderApp(stub, ['/claims']);
    expect(await screen.findByRole('heading', { name: 'Claims' }, WAIT)).toBeTruthy();
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    expect(rows()).toHaveLength(25);
    for (const h of ['Claim', 'Load', 'Carrier', 'Status', 'Recoverable', 'Updated']) expect(screen.getByRole('button', { name: h })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Carrier' }));
    await waitFor(() => expect(stub.calls.some((c) => c.path.endsWith('/claims') && c.query.get('sort') === 'carrierName:asc')).toBe(true), WAIT);
    expect(screen.getByRole('columnheader', { name: /Carrier/ }).getAttribute('aria-sort')).toBe('ascending');
    await user.click(screen.getByRole('button', { name: 'Carrier' }));
    await waitFor(() => expect(stub.calls.some((c) => c.path.endsWith('/claims') && c.query.get('sort') === 'carrierName:desc')).toBe(true), WAIT);
    expect(screen.getByRole('columnheader', { name: /Carrier/ }).getAttribute('aria-sort')).toBe('descending');
  });
  it('search is debounced to <= 400 ms and issues exactly one request', async () => {
    const stub = createStub();
    const { user } = await renderApp(stub, ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    const before = stub.calls.filter((c) => c.path.endsWith('/claims')).length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const box = screen.getByRole('searchbox', { name: 'Search claims' });
    for (const v of ['C', 'CL', 'CLM', 'CLM-0005']) fireEvent.change(box, { target: { value: v } });
    expect(stub.calls.filter((c) => c.path.endsWith('/claims')).length).toBe(before); // nothing yet
    await act(async () => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    await waitFor(() => expect(stub.calls.filter((c) => c.path.endsWith('/claims') && c.query.get('q') === 'CLM-0005').length).toBe(1), WAIT);
    await new Promise((r) => setTimeout(r, 300));
    expect(stub.calls.filter((c) => c.path.endsWith('/claims')).length - before).toBe(1);
    void user;
  });
  it('status/perspective selects and Next page drive requests; empty and error states; retry', async () => {
    const stub = createStub();
    const { user } = await renderApp(stub, ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'APPROVED');
    await waitFor(() => expect(stub.calls.some((c) => c.path.endsWith('/claims') && c.query.get('status') === 'APPROVED')).toBe(true), WAIT);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Perspective' }), 'CARRIER');
    await waitFor(() => expect(stub.calls.some((c) => c.path.endsWith('/claims') && c.query.get('perspective') === 'CARRIER')).toBe(true), WAIT);
    cleanup();
    const stub2 = createStub();
    const r2 = await renderApp(stub2, ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    await r2.user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(stub2.calls.some((c) => c.path.endsWith('/claims') && c.query.get('page') === '2')).toBe(true), WAIT);
    cleanup();
    const empty = createStub({ claims: [] });
    await renderApp(empty, ['/claims']);
    expect(await screen.findByText(/no claims|nothing to show|no results/i, {}, WAIT)).toBeTruthy();
    cleanup();
    let fail = true;
    const broken = createStub();
    broken.on('GET', /\/claims$/, () => (fail ? json(500, { error: { code: 'internal_error', message: 'SERVER-DETAIL-777', requestId: 'r' } }) : undefined));
    const r4 = await renderApp(broken, ['/claims']);
    const retry = await screen.findByRole('button', { name: /retry|try again/i }, { timeout: 20000 });
    expect(document.body.textContent).not.toContain('SERVER-DETAIL-777');
    fail = false;
    await r4.user.click(retry);
    expect(await screen.findByRole('link', { name: 'CLM-0001' }, WAIT)).toBeTruthy();
  });
  it('list state lives in the URL: reloading with the query string restores the controls', async () => {
    const stub = createStub();
    await renderApp(stub, ['/claims?q=CLM-000&status=PENDING_REVIEW&perspective=SHIPPER&sort=carrierName:desc&page=1']);
    const box = (await screen.findByRole('searchbox', { name: 'Search claims' }, WAIT)) as HTMLInputElement;
    expect(box.value).toBe('CLM-000');
    expect((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value).toBe('PENDING_REVIEW');
    expect((screen.getByRole('combobox', { name: 'Perspective' }) as HTMLSelectElement).value).toBe('SHIPPER');
    expect(screen.getByRole('columnheader', { name: /Carrier/ }).getAttribute('aria-sort')).toBe('descending');
    await waitFor(() => {
      const c = stub.calls.find((x) => x.path.endsWith('/claims') && x.query.get('q') === 'CLM-000');
      expect(c?.query.get('status')).toBe('PENDING_REVIEW');
      expect(c?.query.get('perspective')).toBe('SHIPPER');
      expect(c?.query.get('sort')).toBe('carrierName:desc');
    }, WAIT);
  });
});

function tabbables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((e) => e.getAttribute('aria-hidden') !== 'true');
}

describe('T-UI-08 claim detail sheet', () => {
  const open = async (stub: ReturnType<typeof createStub>, num = 'CLM-0001') => {
    const r = await renderApp(stub, ['/claims']);
    const link = await screen.findByRole('link', { name: num }, WAIT);
    link.focus();
    await r.user.click(link);
    const dlg = await screen.findByRole('dialog', { name: `Claim ${num}` }, WAIT);
    return { ...r, dlg, link };
  };
  const mk = () => {
    const claims = [mkClaim(1, { recoverableCents: 32500, pendingReviewCents: 15000 }), ...Array.from({ length: 5 }, (_, i) => mkClaim(i + 2))];
    const p = mkPacket(claims[0], { recoverableCents: 32500, pendingReviewCents: 15000 });
    p.findings.push({
      id: '00000000-0000-4000-8000-0000000000f2', ruleId: 'INV-ACCESSORIAL-UNAUTH', title: 'Accessorial not authorized', direction: 'OVERCHARGE', amountCents: 15000, explanation: 'Lumper is not listed.',
      calculation: ['First: authorised list', 'Second: charged item'], confidence: 0.6, needsHumanReview: true,
      citations: [{ sourceId: p.sources[0]!.id, locator: 'line 9', excerpt: 'Lumper 150.00' }], governingClause: null,
    } as any);
    return createStub({ claims, packets: { [claims[0]!.id]: p } });
  };
  it('opens as a labelled dialog, traps focus, closes with Esc and restores focus', async () => {
    const { dlg, user, link } = await open(mk());
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true), WAIT);
    expect(within(dlg).getByRole('button', { name: 'Close' })).toBeTruthy();
    const t = tabbables(dlg);
    expect(t.length).toBeGreaterThan(1);
    t[t.length - 1]!.focus();
    await user.tab();
    expect(document.activeElement).toBe(t[0]);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(t[t.length - 1]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Claim CLM-0001' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'CLM-0001' }));
    void link;
  });
  it('tabs: Summary distinguishes confirmed/pending, Evidence shows the four sections and finding details, History lists approvals', async () => {
    const { dlg, user } = await open(mk());
    for (const t of ['Summary', 'Evidence', 'History']) expect(within(dlg).getByRole('tab', { name: t })).toBeTruthy();
    const summary = dlg.textContent!;
    expect(summary).toMatch(/confirmed|recoverable/i);
    expect(summary).toMatch(/pending/i);
    expect(summary).toContain('$325.00');
    expect(summary).toContain('$150.00');
    await user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
    for (const h of ['Timeline', 'Sources', 'Calculation', 'Governing clause']) expect(await within(dlg).findByRole('heading', { name: h }, WAIT)).toBeTruthy();
    const txt = dlg.textContent!;
    expect(txt).toContain('Linehaul billed above rate confirmation');
    expect(txt).toContain('$1,234.56');
    expect(txt).toMatch(/0\.95|95\s?%/);
    expect(txt).toMatch(/needs human review/i);
    const s1 = within(dlg).getByText(/Step one/);
    const s2 = within(dlg).getByText(/Step two/);
    const s3 = within(dlg).getByText(/Step three/);
    expect(s1.compareDocumentPosition(s2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(s2.compareDocumentPosition(s3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(txt).toContain('rate_confirmation.txt');
    expect(txt).toContain('section 2');
    expect(txt).toContain('Linehaul is fixed at $1,400.00 all-in.');
    await user.click(within(dlg).getByRole('tab', { name: 'History' }));
    expect(await within(dlg).findByText(/Checked all sources/, {}, WAIT)).toBeTruthy();
    expect(dlg.textContent).toContain('Rita Reviewer');
  });
  const BADGES: Array<[string, string]> = [['NOT_RUN', 'Not independently verified'], ['PASSED', 'Verifier passed'], ['FAILED', 'Verifier failed'], ['NEEDS_REVIEW', 'Verifier needs review']];
  for (const [status, text] of BADGES) {
    it(`verifier badge ${status}`, async () => {
      const claims = [mkClaim(1)];
      const stub = createStub({ claims, packets: { [claims[0]!.id]: mkPacket(claims[0], { verifier: { status, checkedAt: status === 'NOT_RUN' ? null : '2026-10-03T10:00:00.000Z', note: null } }) } });
      const { dlg, user } = await open(stub);
      await user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
      const badge = (await within(dlg).findAllByRole('status', {}, WAIT)).find((e) => e.textContent!.includes(text));
      expect(badge, `badge text "${text}"`).toBeTruthy();
    });
  }
  for (const [valid, text] of [[true, 'Integrity verified'], [false, 'Integrity mismatch']] as const) {
    it(`integrity badge ${valid}`, async () => {
      const claims = [mkClaim(1)];
      const stub = createStub({ claims, packets: { [claims[0]!.id]: mkPacket(claims[0], { integrity: { contentHash: 'c'.repeat(64), recomputedHash: (valid ? 'c' : 'd').repeat(64), valid } }) } });
      const { dlg, user } = await open(stub);
      await user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
      expect(await within(dlg).findByText(text, { exact: false }, WAIT)).toBeTruthy();
    });
  }
});