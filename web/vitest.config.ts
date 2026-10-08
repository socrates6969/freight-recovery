import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    css: false,
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'] } },
      { extends: true, test: { name: 'acceptance', include: ['test-acceptance/**/*.acc.test.{ts,tsx}'] } },
    ],
  },
});
