// @vitest-environment jsdom
/* eslint-disable */
// T-UI-13 accessibility smoke (DOM part)
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import { createStub, mkClaim } from './helpers/stub.js';

setupDom();
const WAIT = { timeout: 5000 };

function accName(el: Element): string {
  const a = el.getAttribute('aria-label');
  if (a?.trim()) return a.trim();
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    if (t) return t;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) return Array.from(labels).map((l) => l.textContent).join(' ').trim();
  if (['BUTTON', 'A'].includes(el.tagName)) return (el.textContent ?? '').trim();
  return el.getAttribute('title')?.trim() ?? '';
}
function checkControls(label: string) {
  for (const el of Array.from(document.body.querySelectorAll('input:not([type=hidden]), select, textarea, button, [role=button], [role=checkbox], [role=textbox]'))) {
    expect(accName(el).length, `${label}: <${el.tagName.toLowerCase()} type=${el.getAttribute('type') ?? ''}> lacks an accessible name`).toBeGreaterThan(0);
  }
}
function checkLandmarks(label: string) {
  const seen = new Map<string, number>();
  for (const [role, sel] of [['navigation', 'nav, [role=navigation]'], ['main', 'main, [role=main]'], ['banner', 'header, [role=banner]'], ['complementary', 'aside, [role=complementary]']] as const) {
    const els = Array.from(document.body.querySelectorAll(sel));
    if (els.length > 1) for (const e of els) { const k = `${role}:${accName(e)}`; seen.set(k, (seen.get(k) ?? 0) + 1); expect(accName(e).length, `${label}: duplicate ${role} landmarks need distinct names`).toBeGreaterThan(0); }
  }
  for (const [k, n] of seen) expect(n, `${label}: duplicate landmark ${k}`).toBe(1);
}
function checkTabOrder(label: string) {
  const els = Array.from(document.body.querySelectorAll<HTMLElement>('[tabindex]'));
  for (const e of els) expect(Number(e.getAttribute('tabindex')), `${label}: positive tabindex breaks logical order`).toBeLessThanOrEqual(0);
}

describe('T-UI-13 accessibility smoke', () => {
  it('login: names, landmarks, tab order', async () => {
    await renderApp(createStub({ refreshFails: true }), ['/login']);
    await screen.findByRole('heading', { name: 'Sign in' }, WAIT);
    checkControls('login'); checkLandmarks('login'); checkTabOrder('login');
    const seq = Array.from(document.body.querySelectorAll<HTMLElement>('input, button, a[href]')).map((e) => accName(e));
    const idx = (n: string | RegExp) => seq.findIndex((s) => (typeof n === 'string' ? s === n : n.test(s)));
    expect(idx('Email')).toBeLessThan(idx('Password'));
    expect(idx('Password')).toBeLessThan(idx('Sign in'));
  });
  it('claims list and approvals: names, landmarks, dialogs are modal and labelled', async () => {
    const claims = Array.from({ length: 4 }, (_, i) => mkClaim(i + 1));
    const stub = createStub({ claims });
    const { user } = await renderApp(stub, ['/claims']);
    await signedIn();
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    checkControls('claims'); checkLandmarks('claims'); checkTabOrder('claims');
    await user.click(screen.getByRole('link', { name: 'CLM-0001' }));
    const dlg = await screen.findByRole('dialog', { name: 'Claim CLM-0001' }, WAIT);
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(accName(dlg).length).toBeGreaterThan(0);
    checkControls('claim sheet');
    cleanup();
    const r2 = await renderApp(createStub({ claims }), ['/approvals']);
    await screen.findByRole('heading', { name: 'Approvals' }, WAIT);
    await screen.findByText('CLM-0001', { exact: false }, WAIT);
    checkControls('approvals'); checkLandmarks('approvals'); checkTabOrder('approvals');
    const row = screen.getByText('CLM-0001', { exact: false }).closest('tr') as HTMLElement;
    await r2.user.click(within(row).getByRole('button', { name: 'Approve' }));
    const d = await screen.findByRole('dialog', { name: 'Approve CLM-0001' }, WAIT);
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(accName(d).length).toBeGreaterThan(0);
    checkControls('approve dialog');
  });
  it('prefers-reduced-motion: reduce removes animation from dialog transitions', async () => {
    const mm = (q: string) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
    (window as any).matchMedia = mm;
    const { user } = await renderApp(createStub(), ['/claims']);
    await signedIn();
    await user.click(screen.getByRole('button', { name: 'Command menu' }));
    const dlg = await screen.findByRole('dialog', { name: 'Command menu' }, WAIT);
    for (const el of [dlg, ...Array.from(dlg.querySelectorAll<HTMLElement>('*'))]) {
      const s = el.getAttribute('style') ?? '';
      expect(/animation(?!:\s*none)|transition(?!:\s*none)/.test(s) && !/(duration|transition|animation):\s*(none|0s|0ms)/.test(s), `inline motion on <${el.tagName.toLowerCase()}>`).toBe(false);
      expect(/\banimate-|\bfade-in\b|\bslide-in\b|\bzoom-in\b/.test(String(el.className)), `motion class on <${el.tagName.toLowerCase()}> ${el.className}`).toBe(false);
    }
  });
});