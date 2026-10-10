import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppRoot } from '../src/app-root';
import { BRAND_NAME, BrandLockup } from '../src/components/ui/BrandLockup';

// Brand: one name, always lowercase "scoup.ai" (brand/README.md).
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(webDir, '..');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const manager = { id: U(1), email: 'manager@acme.test', name: 'Morgan Manager', role: 'MANAGER', tenant: { id: U(90), name: 'Acme (synthetic)' }, mfaEnabled: false };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('brand lockup', () => {
  it('renders an inline SVG lockup named with the lowercase brand name', () => {
    render(<BrandLockup height={24} />);
    const img = screen.getByRole('img', { name: 'scoup.ai' });
    expect(BRAND_NAME).toBe('scoup.ai');
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img).not.toHaveAttribute('style');
    expect(img).toHaveAttribute('height', '24');
    expect(img).toHaveAttribute('width', '129');
  });

  it('never renders below the 20px minimum height', () => {
    render(<BrandLockup height={10} />);
    expect(screen.getByRole('img', { name: 'scoup.ai' })).toHaveAttribute('height', '20');
  });

  it('draws exactly the geometry and light-surface colours of brand/lockup-horizontal.svg', () => {
    const file = readFileSync(path.join(repoDir, 'brand', 'lockup-horizontal.svg'), 'utf8');
    const { container } = render(<BrandLockup height={24} />);
    const el = container.querySelector('svg');
    expect(el?.getAttribute('viewBox')).toBe(/viewBox="([^"]+)"/u.exec(file)?.[1]);
    const attrs = (s: string) =>
      [...s.matchAll(/\b(d|cx|cy|r|rx|width|height|transform|fill|stroke|stroke-width)="([^"]+)"/gu)].map((m) => `${m[1]}=${m[2]}`);
    const fromFile = attrs(file.replace(/^<svg[^>]*>/u, '').replace(/<title>[^<]*<\/title>/u, ''));
    const rendered = attrs((el ? new XMLSerializer().serializeToString(el).replace(/^<svg[^>]*>/u, '') : '').replace(/ class="[^"]*"/gu, ''));
    expect(rendered.length).toBeGreaterThan(20);
    expect(rendered).toEqual(fromFile);
  });

  it('shows the logo on the sign-in page instead of the old text name', async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url) === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      return json(401, { error: { code: 'unauthenticated', message: 'Authentication required.', requestId: 'r' } });
    };
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/login']} />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'scoup.ai' }).tagName.toLowerCase()).toBe('svg');
    // The logo adds no <img>: the "untrusted content never becomes an <img>" checks stay meaningful.
    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Freight Recovery/u);
  });

  it('shows the logo and the descriptor line in the app sidebar', async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
      if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user: manager });
      if (u === '/api/v1/me') return json(200, { user: manager, permissions: ['claims:read'] });
      if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
      return json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
    };
    render(<AppRoot fetchImpl={fetchImpl as typeof fetch} initialEntries={['/approvals']} />);
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
    const aside = screen.getByRole('complementary');
    expect(within(aside).getByRole('img', { name: 'scoup.ai' })).toBeInTheDocument();
    expect(aside).toHaveTextContent('Freight invoice recovery');
    expect(document.body.textContent).not.toMatch(/Freight Recovery/u);
  });
});

describe('brand files and names', () => {
  it('index.html uses the brand title and the SVG favicon', () => {
    const html = readFileSync(path.join(webDir, 'index.html'), 'utf8');
    expect(html).toContain('<title>scoup.ai</title>');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
  });

  it('the public favicon is a byte-identical copy of brand/favicon.svg', () => {
    expect(readFileSync(path.join(webDir, 'public', 'favicon.svg'), 'utf8')).toBe(readFileSync(path.join(repoDir, 'brand', 'favicon.svg'), 'utf8'));
  });

  it('never uppercases the brand via CSS and swaps to the on-dark palette in the dark theme', () => {
    const css = readFileSync(path.join(webDir, 'src', 'styles', 'app.css'), 'utf8');
    expect(css).not.toMatch(/\.brand-lockup[^{]*\{[^}]*text-transform/u);
    expect(css).toMatch(/\[data-theme='dark'\] \.brand-lockup \.brand-tile \{\s*fill: #e2e8f0;/u);
    expect(css).toMatch(/\[data-theme='dark'\] \.brand-lockup \.brand-letters \{\s*stroke: #e2e8f0;/u);
  });

  it('no user-facing source uses the old name or a capitalised brand name', () => {
    for (const f of walk(path.join(webDir, 'src')).filter((p) => /\.(tsx?|css|html)$/u.test(p))) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/Freight Recovery/u);
      expect(text, f).not.toMatch(/Scoup|SCOUP/u);
    }
  });
});
