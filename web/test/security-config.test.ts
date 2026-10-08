import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// @ts-expect-error - plain ESM tooling scripts without type declarations
import { checkCss, checkHtml } from '../tools/check-dist.mjs';
// @ts-expect-error - plain ESM tooling scripts without type declarations
import { renderNginxConf } from '../tools/gen-nginx-conf.mjs';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(path.join(webDir, 'security-headers.json'), 'utf8')) as {
  headers: Record<string, string>;
  cacheControl: Record<string, string>;
};

describe('web/security-headers.json', () => {
  it('contains the required headers', () => {
    for (const h of [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
    ]) {
      expect(spec.headers[h], h).toBeTruthy();
    }
    const csp = spec.headers['Content-Security-Policy'] ?? '';
    for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) {
      expect(csp).toContain(d);
    }
    expect(spec.cacheControl['index.html']).toBe('no-store');
    expect(spec.cacheControl['assets']).toBe('public, max-age=31536000, immutable');
  });

  it('has no forbidden CSP tokens anywhere', () => {
    const all = JSON.stringify(spec);
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'data:', ' * ', "'unsafe-hashes'", 'http:']) {
      expect(all, bad).not.toContain(bad);
    }
    expect(spec.headers['Content-Security-Policy']).not.toMatch(/(^|\s)\*(\s|;|$)/u);
  });

  it('web/nginx.conf is generated from the JSON', () => {
    const current = readFileSync(path.join(webDir, 'nginx.conf'), 'utf8').replaceAll('\r\n', '\n');
    expect(current).toBe(renderNginxConf(spec));
    expect(current).toContain(`add_header Content-Security-Policy "${spec.headers['Content-Security-Policy']}" always;`);
    expect(current).toContain('proxy_pass http://api:3001;');
    expect(current).toContain('server_tokens off;');
  });
});

describe('dist checker', () => {
  const ok =
    '<!doctype html><html lang="en"><head><meta name="robots" content="noindex" /><title>Freight Recovery</title><script type="module" src="/assets/a.js"></script><link rel="stylesheet" href="/assets/a.css"></head><body><div id="root"></div></body></html>';
  it('accepts a clean index.html', () => {
    expect(checkHtml(ok)).toEqual([]);
  });
  it('rejects inline scripts, styles, handlers and meta refresh', () => {
    expect(checkHtml(ok.replace('</head>', '<script>alert(1)</script></head>'))).toContain('inline <script> without src');
    expect(checkHtml(ok.replace('</head>', '<style>p{}</style></head>'))).toContain('inline <style>');
    expect(checkHtml(ok.replace('<div id="root">', '<div id="root" onclick="x()">'))).toContain('inline event handler attribute');
    expect(checkHtml(ok.replace('<div id="root">', '<div id="root" style="color:red">'))).toContain('style attribute');
    expect(checkHtml(ok.replace('</head>', '<meta http-equiv="refresh" content="0;url=/x"></head>'))).toContain('meta refresh');
  });
  it('rejects data: URLs in CSS', () => {
    expect(checkCss('@font-face{src:url(data:font/woff2;base64,AAA)}')).toEqual(['data: URL in CSS']);
    expect(checkCss('@font-face{src:url(/assets/inter.woff2)}')).toEqual([]);
  });
});
