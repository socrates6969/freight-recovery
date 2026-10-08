/* eslint-disable */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { CSRF, type createStub } from './stub.js';

type Stub = ReturnType<typeof createStub>;

export async function loadAppRoot(): Promise<React.ComponentType<any>> {
  const mod: any = await import('../../src/app-root.js');
  return mod.AppRoot;
}

export function setupDom() {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
  beforeEach(() => {
    document.cookie = `fr_csrf=${CSRF}; path=/`;
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => cleanup());
}

export async function renderApp(stub: Stub, entries: string[] = ['/claims']) {
  const AppRoot = await loadAppRoot();
  const user = userEvent.setup();
  const view = render(<AppRoot fetchImpl={stub.fetch} initialEntries={entries} />);
  return { user, view, ...screen };
}

/** Wait for the signed-in shell (Main navigation). */
export async function signedIn() {
  return screen.findByRole('navigation', { name: 'Main' }, { timeout: 5000 });
}

export const names = (els: HTMLElement[]) => els.map((e) => e.textContent);
export { screen, waitFor };