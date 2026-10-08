import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Production build: no sourcemaps, no inlined assets (CSP forbids data: URIs), no modulepreload
// polyfill, no inline script or style in index.html (checked by tools/check-dist.mjs).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['source'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
});
