import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts', 'test/**/*.test.ts'], exclude: ['test/integration/**', 'test/parity/**', '**/node_modules/**'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          // Parity (A13) runs here: it needs Python (fails in CI when missing).
          include: ['test/integration/**/*.int.test.ts', 'test/parity/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 180000,
          hookTimeout: 180000,
        },
      },
      {
        extends: true,
        test: {
          name: 'acceptance',
          include: ['test-acceptance/**/*.acc.test.ts'],
          fileParallelism: false,
          testTimeout: 60000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
