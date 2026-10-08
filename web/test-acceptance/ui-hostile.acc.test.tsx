// @vitest-environment jsdom
/* eslint-disable */
// T-UI-09 (hostile strings inert), T-UI-14 (money display)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupDom } from './helpers/render.js';
import { createStub, json, mkClaim, mkPacket } from './helpers/stub.js';

setupDom();
const WAIT = { timeout: 5000 };
const LONG = 'Z'.repeat(5000);
const VECTORS = [
  '<img src=x onerror=alert(1)>', '<script>window.__pwn=1</script>', '"><svg onload=alert(1)>', 'javascript:alert(1)', '[x](javascript:alert(1))',
  '**bold**', '{{7*7}}', '${7*7}', '%s%n', '\u202ereversed text', 'zero\u200bwidth\u200dchars', LONG, '</pre><script>window.__pwn=2</script>', '&lt;b&gt;',
];

function assertInert(label: string) {
  const bad = document.body.querySelector('script, img, iframe, object, embed, link, base, form[action], svg[onload]');
  expect(bad, `${label}: injected element ${bad?.outerHTML.slice(0, 80)}`).toBeNull();
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      expect(/^on/i.test(a.name), `${label}: <${el.tagName.toLowerCase()} ${a.name}>`).toBe(false);
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(a.name.toLowerCase())) expect(/^\s*javascript:/i.test(a.value), `${label}: ${a.name}=${a.value.slice(0, 40)}`).toBe(false);
    }
  }
  expect((window as any).__pwn, `${label}: script executed`).toBeUndefined();
}

function hostileData() {
  const claims = VECTORS.map((v, i) => mkClaim(i + 1, { carrierName: v, shipperName: VECTORS[(i + 3) % VECTORS.length], loadNumber: `LD-${i}-${v.slice(0, 20)}`, assignee: i === 0 ? { id: '00000000-0000-4000-8000-0000000000aa', name: VECTORS[1]! } : null, pendingReviewCents: i === 1 ? 5000 : 0 }));
  const first = claims[0]!;
  const p = mkPacket(first, {
    demandLetter: VECTORS.join('\n'),
    approvals: [{ id: '00000000-0000-4000-8000-0000000000a1', action: 'APPROVE', reason: VECTORS[4]!, packetRevision: 1, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED', actor: { id: '00000000-0000-4000-8000-0000000000a2', name: VECTORS[0]!, role: 'REVIEWER' }, createdAt: '2026-10-03T10:00:00.000Z' }],
  });
  p.findings[0]!.title = VECTORS[2]!;
  p.findings[0]!.explanation = VECTORS[3]!;
  p.findings[0]!.calculation = [VECTORS[5]!, VECTORS[6]!, VECTORS[7]!];
  p.sources[0]!.filename = VECTORS[8]!;
  p.findings[0]!.governingClause!.excerpt = VECTORS[9]!;
  p.findings[0]!.governingClause!.label = VECTORS[10]!;
  return createStub({ claims, packets: { [first.id]: p } });
}

describe('T-UI-09 hostile strings are inert', () => {
  it('list: every vector renders as literal text', async () => {
    await renderApp(hostileData(), ['/claims']);
    await screen.findByRole('heading', { name: 'Claims' }, WAIT);
    await waitFor(() => expect(document.body.textContent).toContain('**bold**'), WAIT);
    assertInert('list');
    const text = document.body.textContent!;
    for (const raw of VECTORS) { const v = raw.replace(/[\u202a-\u202e\u2066-\u2069]/g, ''); /* displayText strips bidi overrides by design */ expect(text.includes(v), `visible as text: ${v.slice(0, 30)}`).toBe(true); }
    const longEl = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((e) => e.textContent!.includes(LONG) && !Array.from(e.children).some((c) => c.textContent!.includes(LONG))).at(0);
    expect(longEl, 'element holding the 5000-char string').toBeTruthy();
    const cs = getComputedStyle(longEl!);
    let ok = /break-word|anywhere|break-all/.test(`${cs.overflowWrap} ${cs.wordBreak}`);
    for (let e: HTMLElement | null = longEl!; e && !ok; e = e.parentElement) ok = !!e.className && /break|wrap|truncate|overflow|ellipsis/.test(String(e.className)) || /break-word|anywhere|break-all|overflow/.test(e.getAttribute('style') ?? '');
    expect(ok, 'long unbroken string must be contained (overflow-wrap/word-break or class)').toBe(true);
  });
  it('detail sheet, all tabs, and the approvals page + dialog are inert', async () => {
    const stub = hostileData();
    const { user } = await renderApp(stub, ['/claims']);
    const link = await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    await user.click(link);
    const dlg = await screen.findByRole('dialog', { name: 'Claim CLM-0001' }, WAIT);
    assertInert('summary');
    for (const t of ['Evidence', 'History']) {
      await user.click(within(dlg).getByRole('tab', { name: t }));
      await new Promise((r) => setTimeout(r, 150));
      assertInert(t);
    }
    const t = dlg.textContent!;
    for (const v of [VECTORS[4]!]) expect(t.includes(v), `history shows ${v.slice(0, 20)} literally`).toBe(true);
    await user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
    for (const raw of [VECTORS[2]!, VECTORS[3]!, VECTORS[8]!, VECTORS[9]!]) {
      const v = raw.replace(/[\u202a-\u202e\u2066-\u2069]/g, ''); // bidi overrides are stripped by displayText by design
      expect(dlg.textContent!.includes(v), `evidence shows ${v.slice(0, 20)} literally`).toBe(true);
    }
    await user.keyboard('{Escape}');
    cleanup();
    const s2 = hostileData();
    const r2 = await renderApp(s2, ['/approvals']);
    await screen.findByRole('heading', { name: 'Approvals' }, WAIT);
    await screen.findByText('CLM-0001', { exact: false }, WAIT);
    assertInert('approvals');
    const row = screen.getByText('CLM-0001', { exact: false }).closest('tr') as HTMLElement;
    s2.on('POST', /packet\/approve$/, () => json(200, { claim: { id: s2.claims[0]!.id, status: 'APPROVED' }, packet: { id: '00000000-0000-4000-8000-0000000000a3', revision: 1, status: 'APPROVED' } }));
    await r2.user.click(within(row).getByRole('button', { name: 'Approve' }));
    const d = await screen.findByRole('dialog', { name: 'Approve CLM-0001' }, WAIT);
    assertInert('dialog');
    await r2.user.type(within(d).getByRole('textbox', { name: 'Reason' }), VECTORS[0]!);
    await r2.user.click(within(d).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(s2.count('POST', /packet\/approve$/)).toBe(1), WAIT);
    await new Promise((r) => setTimeout(r, 300));
    assertInert('toast');
  });
  it('static: web/src never uses HTML-injection or code-eval primitives', () => {
    const src = resolve(__dirname, '..', 'src');
    expect(existsSync(src)).toBe(true);
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|jsx?|mjs|html)$/.test(p) && !/\.test\./.test(p)) files.push(p); } };
    walk(src);
    expect(files.length).toBeGreaterThan(5);
    const FORBIDDEN = [/dangerouslySetInnerHTML/, /\.innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/];
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      for (const re of FORBIDDEN) expect(re.test(t), `${f}: ${re}`).toBe(false);
    }
  });
});

describe('T-UI-14 money display', () => {
  it('formats cents as $x,xxx.xx with tabular numerals; never NaN/undefined/exponent', async () => {
    const cases: Array<[number, string]> = [[0, '$0.00'], [1250, '$12.50'], [123456, '$1,234.56'], [100000000, '$1,000,000.00'], [-500, '-$5.00']];
    const claims = cases.map(([c], i) => mkClaim(i + 1, { recoverableCents: c, amountClaimedCents: Math.abs(c), pendingReviewCents: 0 }));
    await renderApp(createStub({ claims }), ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    const text = document.body.textContent!;
    for (const [, want] of cases) expect(text, want).toContain(want);
    expect(text).not.toMatch(/NaN|undefined|\d[eE][+-]?\d/);
    const el = Array.from(document.body.querySelectorAll<HTMLElement>('td, span, div')).find((e) => e.children.length === 0 && e.textContent!.trim() === '$12.50');
    expect(el, 'element showing $12.50').toBeTruthy();
    let tab = false;
    for (let e: HTMLElement | null = el!; e && !tab; e = e.parentElement) tab = /tabular|tnum|numeric|mono|\bnum\b/i.test(String(e.className)) || /tabular-nums/.test(e.getAttribute('style') ?? '') || /tabular-nums/.test(getComputedStyle(e).fontVariantNumeric ?? '');
    expect(tab, 'tabular numerals applied').toBe(true);
  });
});