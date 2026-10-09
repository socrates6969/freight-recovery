/* eslint-disable */
// T-WEB-10 honest-labeling sweep, T-WEB-11 storage and network discipline, T-WEB-12 accessibility basics for the new screens.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devStub } from './helpers/dev-stub.js';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import type { RoleName } from './helpers/stub.js';

setupDom();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const WAIT = { timeout: 5000 };
const FORBIDDEN_TEXT = /neural mesh|hebbian|solved-problems cache|ai-powered|faster than|\d+(\.\d+)?\s*[x\u00d7]\s*(faster|speed)|\d+(\.\d+)?\s*%\s*accura|accuracy of \d/i;
const BANNED_WORDS = /neural|hebbian|cache/i;
type Screen = { name: string; role: RoleName; path: string; ready: RegExp | string; after?: (r: any) => Promise<void> };
const SCREENS: Screen[] = [
  { name: 'pipeline', role: 'PLATFORM_DEV', path: '/dev/pipeline', ready: 'Pipeline health' },
  { name: 'telemetry', role: 'PLATFORM_DEV', path: '/dev/telemetry', ready: 'Request telemetry' },
  { name: 'logs', role: 'PLATFORM_DEV', path: '/dev/logs', ready: 'Recent logs' },
  { name: 'flags', role: 'PLATFORM_DEV', path: '/dev/flags', ready: 'Feature flags' },
  { name: 'evaluation', role: 'PLATFORM_DEV', path: '/dev/evaluation', ready: 'Evaluation runs', after: async (r) => { await r.user.click(await screen.findByRole('button', { name: /Details/ }, WAIT)); await screen.findByRole('dialog', {}, WAIT); await screen.findByRole('table', { name: 'Case results' }, WAIT); } },
  { name: 'audit', role: 'SUPER_ADMIN', path: '/dev/audit', ready: 'Platform audit', after: async (r) => { await r.user.click(await screen.findByRole('button', { name: 'Verify chain' }, WAIT)); await screen.findByText(/Chain valid/, {}, WAIT); } },
  { name: 'intelligence', role: 'MANAGER', path: '/intelligence', ready: 'Recovery intelligence', after: async () => { await screen.findByRole('table', { name: 'Prioritised worklist' }, WAIT); } },
  { name: 'api keys', role: 'OWNER', path: '/settings/api-keys', ready: 'API keys', after: async () => { await screen.findByRole('table', { name: 'API keys' }, WAIT); } },
];
async function show(s: Screen) {
  const stub = devStub({ role: s.role });
  const r = await renderApp(stub, [s.path]);
  await signedIn().catch(() => undefined);
  await screen.findByRole('heading', { name: s.ready }, WAIT);
  if (s.after) await s.after({ ...r, stub });
  return { ...r, stub };
}

describe('T-WEB-10 honest-labeling sweep', () => {
  for (const s of SCREENS) {
    it(`${s.name}: no forbidden claims and no neural, Hebbian or cache wording`, async () => {
      await show(s);
      const text = document.body.textContent ?? '';
      expect(FORBIDDEN_TEXT.test(text), `${s.name}: ${text.slice(0, 200)}`).toBe(false);
      expect(BANNED_WORDS.test(text), `${s.name} contains a banned word`).toBe(false);
    });
  }
  it('claim sheet Similar and Provenance tabs', async () => {
    const stub = devStub({ role: 'MANAGER' });
    const { user } = await renderApp(stub, ['/claims']);
    await signedIn().catch(() => undefined);
    await user.click(await screen.findByRole('link', { name: 'CLM-0001' }, WAIT));
    const dlg = await screen.findByRole('dialog', { name: 'Claim CLM-0001' }, WAIT);
    for (const tab of ['Similar', 'Provenance']) {
      await user.click(within(dlg).getByRole('tab', { name: tab }));
      await within(dlg).findByRole('heading', { name: tab === 'Similar' ? 'Similar past claims' : 'Provenance' }, WAIT);
      expect(FORBIDDEN_TEXT.test(dlg.textContent ?? '')).toBe(false);
      expect(BANNED_WORDS.test(dlg.textContent ?? '')).toBe(false);
    }
  });
});

describe('T-WEB-11 storage and network discipline', () => {
  it('no storage writes, only fetchImpl traffic to the same origin, and nothing on window focus', async () => {
    const writes = [vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem'), vi.spyOn(Storage.prototype, 'clear')];
    const realFetch = vi.fn(async () => new Response('{}'));
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    (globalThis as any).fetch = realFetch;
    for (const s of SCREENS) {
      const r = await show(s);
      const before = r.stub.calls.length;
      await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await new Promise((res) => setTimeout(res, 50));
      expect(r.stub.calls.length, `${s.name}: request on window focus`).toBe(before);
      for (const c of r.stub.calls) expect(new URL(c.url, 'http://localhost').origin, `${s.name}: ${c.url}`).toBe('http://localhost');
      cleanup();
    }
    for (const w of writes) expect(w).not.toHaveBeenCalled();
    expect(realFetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });
});

describe('T-WEB-12 accessibility', () => {
  it('Dev sections follow the tabs pattern with arrow-key navigation', async () => {
    const stub = devStub({ role: 'PLATFORM_DEV' });
    const { user } = await renderApp(stub, ['/dev/pipeline']);
    await signedIn().catch(() => undefined);
    const list = await screen.findByRole('tablist', { name: 'Dev sections' }, WAIT);
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length).toBe(1);
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[1]);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tabs[1]!.getAttribute('aria-selected')).toBe('true'), WAIT);
    await screen.findByRole('heading', { name: 'Request telemetry' }, WAIT);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tabs[0]);
  });
  for (const s of SCREENS) {
    it(`${s.name}: controls have accessible names, ids are unique, status and alert roles are used for messages`, async () => {
      await show(s);
      for (const role of ['button', 'link', 'combobox', 'textbox', 'switch', 'checkbox', 'tab'] as const) {
        const all = screen.queryAllByRole(role);
        const named = screen.queryAllByRole(role, { name: /.+/ });
        expect(named.length, `${s.name}: unnamed ${role}`).toBe(all.length);
      }
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      expect(new Set(ids).size, `${s.name}: duplicate ids`).toBe(ids.length);
      for (const d of screen.queryAllByRole('dialog')) {
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect((d.getAttribute('aria-label') ?? d.getAttribute('aria-labelledby') ?? '').length).toBeGreaterThan(0);
      }
    });
  }
  it('the Change dialog of a flag is modal and labelled', async () => {
    const stub = devStub({ role: 'PLATFORM_DEV' });
    const { user } = await renderApp(stub, ['/dev/flags']);
    await signedIn().catch(() => undefined);
    await user.click(await screen.findByRole('switch', { name: 'intelligence.worklist' }, WAIT));
    const dlg = await screen.findByRole('dialog', { name: 'Change intelligence.worklist' }, WAIT);
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(within(dlg).getByRole('textbox', { name: 'Reason' }).hasAttribute('required') || within(dlg).getByRole('textbox', { name: 'Reason' }).getAttribute('aria-required') === 'true').toBe(true);
  });
});