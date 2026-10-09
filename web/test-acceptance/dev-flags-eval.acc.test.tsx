/* eslint-disable */
// T-WEB-05 flags, T-WEB-06 evaluation, T-WEB-07 platform audit.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devStub, evalDetail, evalRun, flag, json } from './helpers/dev-stub.js';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import { CSRF, deferred, type RoleName } from './helpers/stub.js';

setupDom();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const WAIT = { timeout: 5000 };
const EVAL_NOTE = 'Results are computed on synthetic fixtures checked into the repository. They test whether the pipeline reproduces known answers and whether repeated runs agree. They are not an accuracy measure on real customer documents.';
const DET_NOTE = 'Every case produced identical output on all runs, so pass^k equals pass^1 for this deterministic pipeline.';
const FORBIDDEN_TEXT = /neural mesh|hebbian|solved-problems cache|ai-powered|faster than|\d+(\.\d+)?\s*[x\u00d7]\s*(faster|speed)|\d+(\.\d+)?\s*%\s*accura|accuracy of \d/i;
async function open(role: RoleName, path: string, setup?: (s: ReturnType<typeof devStub>) => void) {
  const stub = devStub({ role });
  setup?.(stub);
  const r = await renderApp(stub, [path]);
  await signedIn().catch(() => undefined);
  return { stub, ...r };
}
const headers = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((h) => h.textContent);
const KEY = 'intelligence.worklist';
const sw = (key = KEY) => screen.getByRole('switch', { name: key });

describe('T-WEB-05 flags screen', () => {
  it('three rows with switches named by key; no optimistic update; success toast; CSRF and body are exact', async () => {
    const gate = deferred<void>();
    const stub = devStub({ role: 'PLATFORM_DEV', putGate: gate.promise });
    const { user } = await renderApp(stub, ['/dev/flags']);
    await signedIn().catch(() => undefined);
    await screen.findByRole('heading', { name: 'Feature flags' }, WAIT);
    const table = await screen.findByRole('table', { name: 'Feature flags' }, WAIT);
    expect(headers(table)).toEqual(['Flag', 'Description', 'State', 'Version', 'Last change']);
    expect(within(table).getAllByRole('row').length).toBe(4);
    expect(screen.getAllByRole('switch').length).toBe(3);
    for (const k of ['intelligence.provenance', 'intelligence.similar_claims', KEY]) expect(sw(k).getAttribute('aria-checked')).toBe('true');
    await user.click(sw());
    const dlg = await screen.findByRole('dialog', { name: `Change ${KEY}` }, WAIT);
    const confirm = within(dlg).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const reason = within(dlg).getByRole('textbox', { name: 'Reason' });
    await user.type(reason, '   too short   ');
    expect(confirm.disabled).toBe(true);
    await user.clear(reason);
    await user.type(reason, 'switch off for tests');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(stub.calls.some((c) => c.method === 'PUT')).toBe(true), WAIT);
    const put = stub.calls.find((c) => c.method === 'PUT')!;
    expect(decodeURIComponent(put.path)).toMatch(new RegExp(`/platform/flags/${KEY.replace('.', '\\.')}$`));
    expect(put.body).toEqual({ enabled: false, expectedVersion: 1, reason: 'switch off for tests' });
    expect(put.headers.get('x-csrf-token')).toBe(CSRF);
    expect(sw().getAttribute('aria-checked'), 'no optimistic update before the response').toBe('true');
    gate.resolve();
    const toast = await screen.findByText('Flag updated', {}, WAIT);
    expect(toast).toBeTruthy();
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'), WAIT);
  });
  it('Space and Enter open the dialog; Cancel and Escape close it and return focus to the switch; focus stays inside', async () => {
    const { user } = await open('PLATFORM_DEV', '/dev/flags');
    await screen.findByRole('table', { name: 'Feature flags' }, WAIT);
    for (const how of [' ', '{Enter}']) {
      sw().focus();
      await user.keyboard(how);
      const dlg = await screen.findByRole('dialog', { name: `Change ${KEY}` }, WAIT);
      expect(dlg.getAttribute('aria-modal')).toBe('true');
      await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true), WAIT);
      for (let i = 0; i < 6; i++) { await user.tab(); expect(dlg.contains(document.activeElement), `focus escaped after ${i + 1} tabs`).toBe(true); }
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
      expect(document.activeElement).toBe(sw());
    }
    await user.click(sw());
    const dlg2 = await screen.findByRole('dialog', { name: `Change ${KEY}` }, WAIT);
    await user.click(within(dlg2).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(document.activeElement).toBe(sw());
  });
  it('a stale version shows the fixed alert and refetches', async () => {
    const { stub, user } = await open('PLATFORM_DEV', '/dev/flags', (s) => s.on('PUT', /\/platform\/flags\/[^/]+$/, () => json(409, { error: { code: 'stale_revision', message: 'SECRET-LEAK', requestId: 'r' } })));
    await screen.findByRole('table', { name: 'Feature flags' }, WAIT);
    const gets = () => stub.calls.filter((c) => c.method === 'GET' && /platform\/flags$/.test(c.path)).length;
    const n = gets();
    await user.click(sw());
    const dlg = await screen.findByRole('dialog', { name: `Change ${KEY}` }, WAIT);
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'stale version probe');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    const a = await screen.findByRole('alert', {}, WAIT);
    expect(a.textContent).toBe('This flag changed. Reload to continue.');
    await waitFor(() => expect(gets()).toBeGreaterThan(n), WAIT);
    expect(document.body.textContent).not.toMatch(/SECRET-LEAK/);
  });
});

describe('T-WEB-06 evaluation screen', () => {
  it('note, runs table and details dialog with one-decimal percentages', async () => {
    const { user } = await open('PLATFORM_DEV', '/dev/evaluation');
    await screen.findByRole('heading', { name: 'Evaluation runs' }, WAIT);
    expect(await screen.findByText(EVAL_NOTE, {}, WAIT)).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Runs' }, WAIT);
    expect(headers(table).slice(0, 6)).toEqual(['Run', 'Set', 'k', 'Cases', 'pass^k', 'Finished']); // the app adds a 7th action column (Details); spec lists six
    const row = within(table).getAllByRole('row')[1]!.textContent!;
    expect(row).toContain('a1b2c3d4');
    expect(row).toContain('mini');
    expect(row).toContain('41.7%');
    await user.click(within(table).getByRole('button', { name: /Details/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Run a1b2c3d4' }, WAIT);
    const t = dlg.textContent!;
    expect(t).toMatch(/Cases\W{0,6}12/);
    expect(t).toMatch(/Runs per case \(k\)\W{0,6}3/);
    expect(t).toMatch(/Per-run pass rate\W{0,6}41\.7%/);
    expect(t).toMatch(/Cases passing all k runs\W{0,6}5/);
    expect(t).toMatch(/pass\^k\W{0,6}41\.7%/);
    expect(t).toMatch(/95% interval \(Wilson\)\W{0,6}19\.3% - 68\.0%/);
    expect(t).toMatch(/Flaky cases\W{0,6}0/);
    const results = await within(dlg).findByRole('table', { name: 'Case results' }, WAIT);
    expect(headers(results)).toEqual(['Case', 'Category', 'Passed', 'Distinct outputs', 'First failure']);
    expect(within(results).getAllByRole('row').length).toBe(4);
    expect(t).toContain(DET_NOTE);
    expect(FORBIDDEN_TEXT.test(document.body.textContent ?? '')).toBe(false);
  });
  it('the deterministic note appears only when every case was deterministic; empty state', async () => {
    const { user } = await open('PLATFORM_DEV', '/dev/evaluation', (s) => s.on('GET', /\/platform\/eval\/runs\/[^/]+$/, () => json(200, evalDetail({ deterministicCases: 11 }))));
    const table = await screen.findByRole('table', { name: 'Runs' }, WAIT);
    await user.click(within(table).getByRole('button', { name: /Details/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Run a1b2c3d4' }, WAIT);
    await within(dlg).findByRole('table', { name: 'Case results' }, WAIT);
    expect(dlg.textContent).not.toContain(DET_NOTE);
    cleanup();
    await open('PLATFORM_DEV', '/dev/evaluation', (s) => s.on('GET', /\/platform\/eval\/runs$/, () => json(200, { items: [] })));
    expect(await screen.findByText('No evaluation runs recorded.', {}, WAIT)).toBeTruthy();
    void evalRun; void flag;
  });
});

describe('T-WEB-07 platform audit', () => {
  it('lists events and reports the chain verification result', async () => {
    const { user } = await open('SUPER_ADMIN', '/dev/audit');
    await screen.findByRole('heading', { name: 'Platform audit' }, WAIT);
    const table = await screen.findByRole('table', { name: 'Platform audit events' }, WAIT);
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
    await user.click(screen.getByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByText('Chain valid (12 events checked)', {}, WAIT)).toBeTruthy();
    expect(screen.getAllByRole('status').some((e) => e.textContent === 'Chain valid (12 events checked)')).toBe(true);
    cleanup();
    const second = await open('SUPER_ADMIN', '/dev/audit', (s) => s.on('GET', /\/platform\/audit\/verify$/, () => json(200, { valid: false, eventsChecked: 5, brokenAtSeq: 4 })));
    await second.user.click(await screen.findByRole('button', { name: 'Verify chain' }, WAIT));
    expect(await screen.findByText('Chain broken at event 4', {}, WAIT)).toBeTruthy();
  });
});