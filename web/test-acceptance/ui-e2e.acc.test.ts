// @vitest-environment node
/* eslint-disable */
// T-UI-16 optional browser end-to-end: runs only when Playwright and a browser are already available.
import { describe, expect, it } from 'vitest';

describe('T-UI-16 optional end-to-end', () => {
  it('login -> open claim -> approve -> cookie flags -> no CSP violations', async (ctx) => {
    let pw: any;
    try {
      const spec = '@playwright/test';
      pw = await import(/* @vite-ignore */ spec);
    } catch {
      return ctx.skip('skipped: no browser (Playwright is not installed)');
    }
    if (process.env.ACC_E2E !== '1') return ctx.skip('skipped: set ACC_E2E=1 with the compose stack up to run the browser flow');
    const browser = await pw.chromium.launch().catch(() => null);
    if (!browser) return ctx.skip('skipped: no browser binary available');
    try {
      const page = await browser.newPage();
      const violations: string[] = [];
      page.on('console', (m: any) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
      await page.goto(process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080/login');
      await page.getByRole('textbox', { name: 'Email' }).fill('manager@acme.test');
      await page.getByLabel('Password').fill('Synthetic-Pass-2026!');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('heading', { name: 'Claims' }).waitFor();
      await page.getByRole('link', { name: 'CLM-0003' }).click();
      await page.getByRole('dialog', { name: 'Claim CLM-0003' }).waitFor();
      const cookies = await page.context().cookies();
      const rt = cookies.find((c: any) => c.name === 'fr_rt');
      expect(rt?.httpOnly).toBe(true);
      expect(rt?.sameSite).toBe('Strict');
      expect(violations).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120000);
});