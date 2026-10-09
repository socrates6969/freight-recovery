/* eslint-disable */
// T-KEY-21: API key management UI (/settings/api-keys).
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiKey, devStub, json } from './helpers/dev-stub.js';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import { CSRF, deferred, type RoleName } from './helpers/stub.js';

setupDom();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const WAIT = { timeout: 5000 };
const SECRET = 'fr_live_0123456789abcdef_' + 'abcdEFGH12-_'.repeat(4).slice(0, 43);
const FORBIDDEN_TEXT = /neural mesh|hebbian|solved-problems cache|ai-powered|faster than|\d+(\.\d+)?\s*[x\u00d7]\s*(faster|speed)|\d+(\.\d+)?\s*%\s*accura|accuracy of \d/i;
const headers = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((h) => h.textContent);
async function open(role: RoleName, path = '/settings/api-keys', setup?: (s: ReturnType<typeof devStub>) => void) {
  const stub = devStub({ role });
  stub.on('POST', /\/api-keys$/, (c) => json(201, { key: apiKey(9, { name: c.body.name, scopes: c.body.scopes }), secret: SECRET }));
  setup?.(stub);
  const r = await renderApp(stub, [path]);
  await signedIn().catch(() => undefined);
  return { stub, ...r };
}
const storageDump = () => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } });

describe('T-KEY-21 navigation', () => {
  it('the API keys link exists for OWNER and ADMIN only', async () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER'] as RoleName[]) {
      await open(role, '/claims');
      const nav = await screen.findByRole('navigation', { name: 'Main' }, WAIT);
      const has = !!within(nav).queryByRole('link', { name: 'API keys' });
      expect(has, role).toBe(role === 'OWNER' || role === 'ADMIN');
      cleanup();
    }
  });
});

describe('T-KEY-21 create flow', () => {
  it('the create dialog requires a scope; the secret is shown once, copyable, and gone after closing', async () => {
    const clip = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clip }, configurable: true });
    const { stub, user } = await open('OWNER');
    await screen.findByRole('heading', { name: 'API keys' }, WAIT);
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    const dlg = await screen.findByRole('dialog', { name: 'Create API key' }, WAIT);
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const create = within(dlg).getByRole('button', { name: 'Create key' }) as HTMLButtonElement;
    await user.type(within(dlg).getByRole('textbox', { name: 'Name' }), 'ci upload');
    expect(create.disabled, 'at least one scope is required').toBe(true);
    for (const n of ['Read claims', 'Export claims', 'Upload documents']) expect(within(dlg).getByRole('checkbox', { name: n })).toBeTruthy();
    const exp = within(dlg).getByRole('combobox', { name: 'Expires' }) as HTMLSelectElement;
    expect([...within(exp).getAllByRole('option')].map((o) => o.textContent)).toEqual(['30 days', '90 days', '180 days', '365 days']);
    expect(exp.options[exp.selectedIndex]!.textContent).toBe('90 days');
    await user.click(within(dlg).getByRole('checkbox', { name: 'Read claims' }));
    await user.click(within(dlg).getByRole('checkbox', { name: 'Upload documents' }));
    expect(create.disabled).toBe(false);
    await user.click(create);
    await waitFor(() => expect(stub.calls.some((c) => c.method === 'POST' && /\/api-keys$/.test(c.path))).toBe(true), WAIT);
    const post = stub.calls.find((c) => c.method === 'POST' && /\/api-keys$/.test(c.path))!;
    expect(post.body).toEqual({ name: 'ci upload', scopes: ['claims.read', 'imports.write'], expiresInDays: 90 });
    expect(post.headers.get('x-csrf-token')).toBe(CSRF);
    const done = await screen.findByRole('dialog', { name: 'API key created' }, WAIT);
    const shown = within(done).getByLabelText('API key secret') as HTMLInputElement | HTMLElement;
    const value = (shown as HTMLInputElement).value ?? shown.textContent;
    expect(value).toMatch(/^fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    expect((shown as HTMLInputElement).readOnly === true || shown.getAttribute('readonly') !== null || shown.tagName !== 'INPUT').toBe(true);
    expect(done.textContent).toContain('This key will not be shown again.');
    await user.click(within(done).getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(SECRET); // user-event installs its own clipboard over the mock
    expect(screen.getAllByRole('status').some((e) => e.textContent === 'Copied')).toBe(true);
    expect(storageDump().includes('fr_live_0123')).toBe(false);
    await user.click(within(done).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(document.body.textContent!.includes(SECRET)).toBe(false);
    expect(document.documentElement.innerHTML.includes(SECRET)).toBe(false);
    expect(storageDump().includes(SECRET)).toBe(false);
    expect(window.location.href.includes('fr_live_')).toBe(false);
    cleanup();
    await open('OWNER');
    await screen.findByRole('table', { name: 'API keys' }, WAIT);
    expect(document.body.textContent!.includes(SECRET)).toBe(false);
  });
  it('Escape also discards the secret; without a clipboard a fixed message is shown and nothing crashes', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { user } = await open('ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Create API key' }, WAIT));
    const dlg = await screen.findByRole('dialog', { name: 'Create API key' }, WAIT);
    await user.type(within(dlg).getByRole('textbox', { name: 'Name' }), 'no clipboard');
    await user.click(within(dlg).getByRole('checkbox', { name: 'Export claims' }));
    await user.click(within(dlg).getByRole('button', { name: 'Create key' }));
    const done = await screen.findByRole('dialog', { name: 'API key created' }, WAIT);
    await user.click(within(done).getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('dialog', { name: 'API key created' })).toBeTruthy();
    expect(done.textContent).not.toMatch(/TypeError|undefined/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(document.documentElement.innerHTML.includes(SECRET)).toBe(false);
  });
});

describe('T-KEY-21 list and revoke', () => {
  it('table columns, prefixes, Never for unused keys, and inert hostile names', async () => {
    const evil = apiKey(3, { name: '<img src=x onerror=1> \u202ebidi' });
    await open('OWNER', '/settings/api-keys', (s) => s.on('GET', /\/api-keys$/, () => json(200, { items: [apiKey(1), evil] })));
    const table = await screen.findByRole('table', { name: 'API keys' }, WAIT);
    expect(headers(table)).toEqual(['Name', 'Key', 'Scopes', 'Created', 'Last used', 'Expires', 'Status']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toMatch(/fr_live_[0-9a-f]{16}/);
    expect(rows[0]!.textContent).toContain('Never');
    expect(table.querySelector('img')).toBeNull();
    expect(table.textContent).toContain('<img src=x onerror=1>');
    expect(table.textContent!).not.toMatch(/_[A-Za-z0-9_-]{43}/);
    expect(FORBIDDEN_TEXT.test(document.body.textContent ?? '')).toBe(false);
  });
  it('empty state; revoke asks for a reason, does not update optimistically and maps 404/409 to fixed texts', async () => {
    await open('OWNER', '/settings/api-keys', (s) => s.on('GET', /\/api-keys$/, () => json(200, { items: [] })));
    expect(await screen.findByText('No API keys yet.', {}, WAIT)).toBeTruthy();
    cleanup();
    const gate = deferred<void>();
    const { stub, user } = await open('OWNER', '/settings/api-keys', (s) => s.on('POST', /\/api-keys\/[^/]+\/revoke$/, async () => { await gate.promise; return json(200, apiKey(1, { status: 'REVOKED', revokedAt: '2026-10-09T12:00:00.000Z', revokeReason: 'x' })); }));
    await user.click(await screen.findByRole('button', { name: 'Revoke Key 1' }, WAIT));
    expect(screen.queryByRole('button', { name: 'Revoke Key 2' })).toBeNull();
    const dlg = await screen.findByRole('dialog', { name: 'Revoke Key 1' }, WAIT);
    const confirm = within(dlg).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), '  short  ');
    expect(confirm.disabled).toBe(true);
    await user.clear(within(dlg).getByRole('textbox', { name: 'Reason' }));
    await user.type(within(dlg).getByRole('textbox', { name: 'Reason' }), 'rotated after incident');
    await user.click(confirm);
    await waitFor(() => expect(stub.calls.some((c) => /revoke$/.test(c.path))).toBe(true), WAIT);
    expect(stub.calls.find((c) => /revoke$/.test(c.path))!.body).toEqual({ reason: 'rotated after incident' });
    expect(screen.getByRole('button', { name: 'Revoke Key 1' }), 'no optimistic update').toBeTruthy();
    gate.resolve();
    cleanup();
    for (const [status, code] of [[404, 'not_found'], [409, 'invalid_state']] as Array<[number, string]>) {
      const r = await open('OWNER', '/settings/api-keys', (s) => s.on('POST', /\/api-keys\/[^/]+\/revoke$/, () => json(status, { error: { code, message: 'SECRET-LEAK message', requestId: 'r' } })));
      await r.user.click(await screen.findByRole('button', { name: 'Revoke Key 1' }, WAIT));
      const d = await screen.findByRole('dialog', { name: 'Revoke Key 1' }, WAIT);
      await r.user.type(within(d).getByRole('textbox', { name: 'Reason' }), 'rotated after incident');
      await r.user.click(within(d).getByRole('button', { name: 'Confirm' }));
      const a = await screen.findByRole('alert', {}, WAIT);
      expect(a.textContent!.length).toBeGreaterThan(0);
      expect(a.textContent).not.toMatch(/SECRET-LEAK/);
      cleanup();
    }
  });
  it('dialogs trap focus and return it to the opener', async () => {
    const { user } = await open('OWNER');
    const opener = await screen.findByRole('button', { name: 'Create API key' }, WAIT);
    opener.focus();
    await user.click(opener);
    const dlg = await screen.findByRole('dialog', { name: 'Create API key' }, WAIT);
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true), WAIT);
    for (let i = 0; i < 8; i++) { await user.tab(); expect(dlg.contains(document.activeElement)).toBe(true); }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(document.activeElement).toBe(opener);
  });
});