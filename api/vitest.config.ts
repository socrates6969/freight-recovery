import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts', 'test/**/*.test.ts'], exclude: ['test/integration/**', '**/node_modules/**'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int.test.ts'],
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
