// T-WEB-01: navigation and guards for the Dev dashboard and the Intelligence page.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devStub, json } from './helpers/dev-stub.js';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import type { RoleName } from './helpers/stub.js';

setupDom();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const WAIT = { timeout: 5000 };
const nav = () => screen.getByRole('navigation', { name: 'Main' });
const tabNames = () => within(screen.getByRole('tablist', { name: 'Dev sections' })).getAllByRole('tab').map((t) => t.textContent);

async function open(role: RoleName, path: string, o: Parameters<typeof devStub>[0] = {}) {
  const stub = devStub({ role, ...o });
  const r = await renderApp(stub, [path]);
  await signedIn().catch(() => undefined);
  return { stub, ...r };
}

describe('T-WEB-01 navigation and guards', () => {
  it('PLATFORM_DEV: Dev dashboard only; /dev lands on the pipeline tab; tabs exclude Audit', async () => {
    await open('PLATFORM_DEV', '/dev');
    await screen.findByRole('heading', { name: 'Dev dashboard' }, WAIT);
    await screen.findByRole('heading', { name: 'Pipeline health' }, WAIT);
    const n = nav();
    expect(within(n).getByRole('link', { name: 'Dev dashboard' })).toBeTruthy();
    for (const name of ['Claims', 'Approvals', 'Import', 'Intelligence']) expect(within(n).queryByRole('link', { name })).toBeNull();
    expect(tabNames()).toEqual(['Pipeline health', 'Telemetry', 'Logs', 'Feature flags', 'Evaluation']);
    expect(within(screen.getByRole('tablist', { name: 'Dev sections' })).getByRole('tab', { name: 'Pipeline health' }).getAttribute('aria-selected')).toBe('true');
  });
  it('SUPER_ADMIN: Pipeline health, Telemetry and Audit; the logs tab is not available', async () => {
    await open('SUPER_ADMIN', '/dev/logs');
    await screen.findByRole('heading', { name: 'Dev dashboard' }, WAIT);
    await screen.findByRole('heading', { name: 'Pipeline health' }, WAIT);
    expect(tabNames()).toEqual(['Pipeline health', 'Telemetry', 'Audit']);
    expect(screen.queryByRole('heading', { name: 'Recent logs' })).toBeNull();
  });
  it('tenant users have no Dev dashboard link and /dev is redirected to the claims list', async () => {
    await open('MANAGER', '/dev/pipeline');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pipeline health' })).toBeNull(), WAIT);
    await screen.findByRole('table', {}, WAIT);
    expect(within(nav()).queryByRole('link', { name: 'Dev dashboard' })).toBeNull();
    expect(within(nav()).getByRole('link', { name: /^Claims/ })).toBeTruthy();
  });
  it('the Intelligence link follows the worklist flag; a disabled or unreadable flag shows a fixed message', async () => {
    await open('MANAGER', '/claims');
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Intelligence' })).toBeTruthy(), WAIT);
    cleanup();
    await open('MANAGER', '/claims', { features: { 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': false } });
    await screen.findByRole('table', {}, WAIT);
    expect(within(nav()).queryByRole('link', { name: 'Intelligence' })).toBeNull();
    cleanup();
    await open('MANAGER', '/claims', { features: 'fail' });
    await screen.findByRole('table', {}, WAIT);
    expect(within(nav()).queryByRole('link', { name: 'Intelligence' })).toBeNull();
    cleanup();
    const off = devStub({ role: 'VIEWER', features: { 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': false } });
    off.on('GET', /\/intelligence\/worklist$/, () => json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } })); // the real API answers 404 when the flag is off
    await renderApp(off, ['/intelligence']);
    await signedIn().catch(() => undefined);
    expect(await screen.findByText('Not available.', {}, WAIT)).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Prioritised worklist' })).toBeNull();
  });
});