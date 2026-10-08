import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] } },
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
