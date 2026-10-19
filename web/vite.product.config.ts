import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The public scoup.ai app: a second Vite entry of this workspace, built as a static bundle that runs the
 * shared rules engine in the visitor's browser. No API, no network calls, no storage. It is served under
 * the marketing site (`<SITE_URL>/app/`), so the base path follows SITE_URL like marketing/site/build.mjs.
 * Same CSP invariants as the main app (no inline script/style, no data: URIs, no sourcemaps), checked by
 * tools/check-product-dist.mjs.
 */
const siteUrl = (process.env['SITE_URL'] ?? 'https://example.invalid').replace(/\/$/u, '');
const base = `${new URL(siteUrl).pathname.replace(/\/$/u, '')}/app/`;
process.env['VITE_APP_URL'] = `${siteUrl}/app/`;
process.env['VITE_SITE_URL'] = `${siteUrl}/`;

export default defineConfig({
  root: fileURLToPath(new URL('./product', import.meta.url)),
  base,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['source'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    outDir: fileURLToPath(new URL('./dist-product', import.meta.url)),
    emptyOutDir: true,
  },
});