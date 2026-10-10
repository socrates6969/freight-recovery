// @vitest-environment jsdom
/* eslint-disable */
// REQ-20261010-step5-analysis UI: AN-W01..AN-W11 (test-spec T12; Part C P10). AppRoot with an in-memory router and a
// scripted fetch serving contract-shaped fixtures; queries by role and accessible name. [S] = bulk (should-have;
// ACC_SKIP_BULK=1 skips it when the bulk feature is cut).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupDom } from './helpers/render.js';
import { PERMS, createStub, deferred, json, mkClaim, mkPacket, type RoleName } from './helpers/stub.js';

const SKIP_BULK = process.env.ACC_SKIP_BULK === '1';
const WAIT = { timeout: 5000 };
const NOTE = 'Runs fixed rules on the accepted document fields. Findings are drafts for human review, not verified results.';
const AUTHOR = 'You will be recorded as the author of revision 1, so another approver must approve it.';
const NO_PACKET = 'No evidence packet yet. Analysis has not run for this claim.';
const T = {
  button: 'Analyze claim', busy: 'Analyzing...', success: 'Analysis complete. Revision 1 is ready for review.',
  conflict: 'This claim is no longer awaiting analysis or has no accepted documents. Reload to continue.',
  invalid: 'The extracted values of this claim cannot be analysed automatically.',
  forbidden: 'You do not have permission to analyze claims.', rateLimited: 'Too many requests. Try again later.', failed: 'Analysis failed. Try again.',
  bulkButton: 'Analyze awaiting claims', bulkTitle: 'Analyze awaiting claims', bulkIntro: 'Analyzes up to 10 claims awaiting analysis, oldest first.',
  bulkConfirm: 'Analyze', bulkCancel: 'Cancel', bulkClose: 'Close',
};
const ERR = (status: number, code: string) => json(status, { error: { code, message: `SERVER ${status} TEXT`, requestId: 'r' } }, status === 429 ? { 'retry-after': '30' } : {});

setupDom();

/** Stub with an explicit permission list (P4: claims:analyze for OWNER..ANALYST); AWAITING claims have no packet (404). */
function mkStub(role: RoleName, claims: any[], withAnalyze: boolean) {
  const stub = createStub({ role, claims });
  const perms = withAnalyze ? [...PERMS[role], 'claims:analyze'] : PERMS[role].filter((p) => p !== 'claims:analyze');
  stub.on('GET', /\/api\/v1\/me$/, () => json(200, { user: stub.user, permissions: perms }));
  stub.on('GET', /\/claims\/[^/]+\/packet$/, (c) => {
    const id = c.path.split('/').at(-2);
    const cl = claims.find((x) => x.id === id);
    if (cl && cl.status === 'AWAITING_ANALYSIS') return json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
    return undefined;
  });
  return stub;
}
const awaitingClaim = (i = 1, over: any = {}) => mkClaim(i, { status: 'AWAITING_ANALYSIS', latestPacket: null, amountClaimedCents: 0, recoverableCents: 0, pendingReviewCents: 0, ...over });

async function openSheet(stub: any, num = 'CLM-0001') {
  const r = await renderApp(stub, ['/claims']);
  await r.user.click(await screen.findByRole('link', { name: num }, WAIT));
  const dlg = await screen.findByRole('dialog', { name: `Claim ${num}` }, WAIT);
  return { ...r, dlg };
}
const tabs = (dlg: HTMLElement) => within(dlg).getAllByRole('tab');
const analyzeBtn = (dlg: HTMLElement) => within(dlg).queryByRole('button', { name: T.button });
const alertWith = (text: string) =>
  waitFor(() => {
    const hit = screen.queryAllByRole('alert').find((a) => (a.textContent ?? '').trim() === text);
    expect(hit, `role=alert "${text}"; alerts: ${JSON.stringify(screen.queryAllByRole('alert').map((a) => a.textContent))}`).toBeTruthy();
    return hit!;
  }, WAIT);

describe('AN-W01..W03 claim sheet visibility', () => {
  it('AN-W01: AWAITING claim + claims:analyze -> button and both notes on Summary; Evidence shows the no-packet text and the button', async () => {
    const c = awaitingClaim();
    const { dlg, user } = await openSheet(mkStub('ANALYST', [c], true));
    expect(within(dlg).getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true');
    expect(await within(dlg).findByRole('button', { name: T.button }, WAIT)).toBeTruthy();
    expect(dlg.textContent).toContain(NOTE);
    expect(dlg.textContent).toContain(AUTHOR);
    await user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
    expect(await within(dlg).findByText(NO_PACKET, {}, WAIT)).toBeTruthy();
    expect(analyzeBtn(dlg)).toBeTruthy();
    expect(dlg.textContent).toContain(NOTE);
    expect(dlg.textContent).toContain(AUTHOR);
  });
  it('AN-W02: VIEWER (no claims:analyze) -> no Analyze button on any tab', async () => {
    const c = awaitingClaim();
    const { dlg, user } = await openSheet(mkStub('VIEWER', [c], false));
    for (const t of tabs(dlg)) {
      await user.click(t);
      await waitFor(() => expect(t.getAttribute('aria-selected')).toBe('true'), WAIT);
      expect(analyzeBtn(dlg), `tab ${t.textContent}`).toBeNull();
    }
    expect(document.body.textContent).not.toContain(AUTHOR);
  });
  for (const status of ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY']) {
    it(`AN-W03: ${status} claim with the permission -> no Analyze button`, async () => {
      const c = mkClaim(1, { status, latestPacket: { revision: 1, status } });
      const { dlg, user } = await openSheet(mkStub('MANAGER', [c], true));
      for (const t of tabs(dlg)) {
        await user.click(t);
        await waitFor(() => expect(t.getAttribute('aria-selected')).toBe('true'), WAIT);
        expect(analyzeBtn(dlg), `${status} tab ${t.textContent}`).toBeNull();
      }
    });
  }
});

describe('AN-W04/W05 analyze from the claim sheet', () => {
  it('AN-W04: one POST with {}; busy state; success toast; claim and packet reloaded; Evidence tab shows revision 1', async () => {
    const c = awaitingClaim();
    const claims = [c];
    const stub = mkStub('ANALYST', claims, true);
    const gate = deferred();
    stub.on('POST', /\/claims\/[^/]+\/analyze$/, async () => {
      await gate.promise;
      Object.assign(c, { status: 'PENDING_REVIEW', latestPacket: { revision: 1, status: 'PENDING_REVIEW' }, recoverableCents: 32500, pendingReviewCents: 15000, amountClaimedCents: 47500 });
      stub.packets[c.id] = mkPacket(c, { revision: 1, status: 'PENDING_REVIEW' });
      return json(201, { claim: { id: c.id, status: 'PENDING_REVIEW', recoverableCents: 32500, pendingReviewCents: 15000, amountClaimedCents: 47500 }, packet: { id: stub.packets[c.id].id, revision: 1, status: 'PENDING_REVIEW', contentHash: 'c'.repeat(64) }, analysis: { rulesVersion: 'rules-v1', findingsCount: 1, pendingFindingsCount: 0, ignoredFindingsCount: 0 } });
    });
    const { dlg, user } = await openSheet(stub);
    const claimGets = () => stub.count('GET', new RegExp(`/claims/${c.id}$`));
    const packetGets = () => stub.count('GET', new RegExp(`/claims/${c.id}/packet$`));
    const g0 = claimGets(), p0 = packetGets();
    await user.click(await within(dlg).findByRole('button', { name: T.button }, WAIT));
    const busy = await within(dlg).findByRole('button', { name: T.busy }, WAIT);
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(stub.count('POST', /\/analyze$/)).toBe(1);
    const post = stub.calls.find((x) => x.method === 'POST' && /\/analyze$/.test(x.path))!;
    expect(post.path).toBe(`/api/v1/claims/${c.id}/analyze`);
    expect(post.body).toEqual({});
    gate.resolve();
    await waitFor(() => {
      const st = screen.getAllByRole('status').map((s) => s.textContent ?? '');
      expect(st.some((t) => t.includes(T.success)), JSON.stringify(st)).toBe(true);
    }, WAIT);
    await waitFor(() => { expect(claimGets()).toBeGreaterThan(g0); expect(packetGets()).toBeGreaterThan(p0); }, WAIT);
    await waitFor(() => expect(within(dlg).getByRole('tab', { name: 'Evidence' }).getAttribute('aria-selected')).toBe('true'), WAIT);
    expect(await within(dlg).findByText('Revision 1', { exact: false }, WAIT)).toBeTruthy();
    expect(dlg.textContent).not.toContain(NO_PACKET);
    expect(stub.count('POST', /\/analyze$/), 'exactly one request').toBe(1);
  });
  for (const [status, code, key] of [[409, 'invalid_state', 'conflict'], [422, 'analysis_input_invalid', 'invalid'], [403, 'forbidden', 'forbidden'], [429, 'rate_limited', 'rateLimited'], [500, 'internal', 'failed']] as const) {
    it(`AN-W05: ${status} -> alert "${(T as any)[key]}", button enabled again`, async () => {
      const c = awaitingClaim();
      const stub = mkStub('MANAGER', [c], true);
      stub.on('POST', /\/claims\/[^/]+\/analyze$/, () => ERR(status, code));
      const { dlg, user } = await openSheet(stub);
      await user.click(await within(dlg).findByRole('button', { name: T.button }, WAIT));
      await alertWith((T as any)[key]);
      expect(document.body.textContent).not.toContain(`SERVER ${status} TEXT`);
      await waitFor(() => expect((within(dlg).getByRole('button', { name: T.button }) as HTMLButtonElement).disabled).toBe(false), WAIT);
      expect(stub.count('POST', /\/analyze$/)).toBe(1);
    });
  }
});

describe.skipIf(SKIP_BULK)('[S] AN-W06..W10 bulk analyze on the claims page', () => {
  const page = async (role: RoleName, withAnalyze: boolean, onBulk?: (c: any) => Response | Promise<Response>) => {
    const claims = [awaitingClaim(1), awaitingClaim(2), mkClaim(3)];
    const stub = mkStub(role, claims, withAnalyze);
    if (onBulk) stub.on('POST', /\/claims\/analyze-awaiting$/, onBulk);
    const r = await renderApp(stub, ['/claims']);
    await screen.findByRole('heading', { name: 'Claims' }, WAIT);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    return { stub, ...r };
  };
  it('[S] AN-W06: button opens the modal dialog with intro, both notes, Analyze and Cancel', async () => {
    const { user } = await page('REVIEWER', true);
    await user.click(screen.getByRole('button', { name: T.bulkButton }));
    const dlg = await screen.findByRole('dialog', { name: T.bulkTitle }, WAIT);
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    for (const t of [T.bulkIntro, NOTE, AUTHOR]) expect(dlg.textContent).toContain(t);
    expect(within(dlg).getByRole('button', { name: T.bulkConfirm })).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: T.bulkCancel })).toBeTruthy();
  });
  it('[S] AN-W07: Analyze -> one POST {"limit":10}; summary in role=status; failed numbers; Close; list reloaded', async () => {
    const body = { limit: 10, examined: 4, analyzed: [
      { claimId: '00000000-0000-4000-8000-0000000c0001', claimNumber: 'CLM-0001', packetId: '00000000-0000-4000-8000-0000000d0001', findingsCount: 1, recoverableCents: 100, pendingReviewCents: 0 },
      { claimId: '00000000-0000-4000-8000-0000000c0002', claimNumber: 'CLM-0002', packetId: '00000000-0000-4000-8000-0000000d0002', findingsCount: 0, recoverableCents: 0, pendingReviewCents: 0 },
    ], skipped: [{ claimId: '00000000-0000-4000-8000-0000000c0003', claimNumber: 'CLM-0098', code: 'invalid_state' }], failed: [{ claimId: '00000000-0000-4000-8000-0000000c0004', claimNumber: 'CLM-0099', code: 'analysis_input_invalid' }], remaining: 3 };
    const { stub, user } = await page('OWNER', true, () => json(200, body));
    const lists0 = stub.count('GET', /\/api\/v1\/claims$/);
    await user.click(screen.getByRole('button', { name: T.bulkButton }));
    const dlg = await screen.findByRole('dialog', { name: T.bulkTitle }, WAIT);
    await user.click(within(dlg).getByRole('button', { name: T.bulkConfirm }));
    await waitFor(() => expect(stub.count('POST', /\/claims\/analyze-awaiting$/)).toBe(1), WAIT);
    const post = stub.calls.find((x) => x.method === 'POST' && /analyze-awaiting$/.test(x.path))!;
    expect(post.path).toBe('/api/v1/claims/analyze-awaiting');
    expect(post.body).toEqual({ limit: 10 });
    const summary = 'Analyzed 2. Skipped 1. Could not analyze 1. 3 still awaiting analysis.';
    await waitFor(() => expect(within(dlg).getAllByRole('status').some((s) => (s.textContent ?? '').includes(summary))).toBe(true), WAIT);
    expect(dlg.textContent).toContain('Could not analyze: CLM-0099');
    expect(within(dlg).getByRole('button', { name: T.bulkClose })).toBeTruthy();
    await waitFor(() => expect(stub.count('GET', /\/api\/v1\/claims$/)).toBeGreaterThan(lists0), WAIT);
    expect(stub.count('POST', /\/claims\/analyze-awaiting$/)).toBe(1);
  });
  it('[S] AN-W07b: 403 / 429 / 500 -> alert with forbidden / rateLimited / failed', async () => {
    for (const [st, code, text] of [[403, 'forbidden', T.forbidden], [429, 'rate_limited', T.rateLimited], [500, 'internal', T.failed]] as const) {
      const { user, view } = await page('MANAGER', true, () => ERR(st, code));
      await user.click(screen.getByRole('button', { name: T.bulkButton }));
      const dlg = await screen.findByRole('dialog', { name: T.bulkTitle }, WAIT);
      await user.click(within(dlg).getByRole('button', { name: T.bulkConfirm }));
      await alertWith(text);
      view.unmount();
    }
  });
  it('[S] AN-W08: a hostile failed claim number renders as literal text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { user } = await page('MANAGER', true, () => json(200, { limit: 10, examined: 1, analyzed: [], skipped: [], failed: [{ claimId: '00000000-0000-4000-8000-0000000c0009', claimNumber: evil, code: 'analysis_input_invalid' }], remaining: 1 }));
    await user.click(screen.getByRole('button', { name: T.bulkButton }));
    const dlg = await screen.findByRole('dialog', { name: T.bulkTitle }, WAIT);
    await user.click(within(dlg).getByRole('button', { name: T.bulkConfirm }));
    await waitFor(() => expect(dlg.textContent).toContain(`Could not analyze: ${evil}`), WAIT);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(dlg.querySelectorAll('img').length).toBe(0);
  });
  it('[S] AN-W09: Escape and Cancel close without a request; focus returns to the opener', async () => {
    const { stub, user } = await page('ADMIN', true);
    const opener = screen.getByRole('button', { name: T.bulkButton });
    await user.click(opener);
    await screen.findByRole('dialog', { name: T.bulkTitle }, WAIT);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: T.bulkTitle })).toBeNull(), WAIT);
    await waitFor(() => expect(document.activeElement).toBe(opener), WAIT);
    await user.click(opener);
    const dlg = await screen.findByRole('dialog', { name: T.bulkTitle }, WAIT);
    await user.click(within(dlg).getByRole('button', { name: T.bulkCancel }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: T.bulkTitle })).toBeNull(), WAIT);
    await waitFor(() => expect(document.activeElement).toBe(opener), WAIT);
    expect(stub.count('POST', /analyze-awaiting$/)).toBe(0);
  });
  it('[S] AN-W10: without claims:analyze there is no bulk button', async () => {
    await page('VIEWER', false);
    expect(screen.queryByRole('button', { name: T.bulkButton })).toBeNull();
  });
});

describe('AN-W11 copy constants come from @fr/shared', () => {
  it('the UI strings above equal the shared exports', async () => {
    const S: any = await import('@fr/shared');
    expect(S.ANALYSIS_NOTE).toBe(NOTE);
    expect(S.ANALYZE_AUTHOR_NOTE).toBe(AUTHOR);
    for (const [k, v] of Object.entries(T)) expect(S.ANALYSIS_TEXT[k], k).toBe(v);
    expect(S.ANALYSIS_TEXT.bulkFailedPrefix).toBe('Could not analyze: ');
    expect(S.ANALYSIS_TEXT.bulkSummary(2, 1, 1, 3)).toBe('Analyzed 2. Skipped 1. Could not analyze 1. 3 still awaiting analysis.');
  });
});
