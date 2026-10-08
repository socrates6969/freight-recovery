import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] } },
      { extends: true, test: { name: 'acceptance', include: ['test-acceptance/**/*.acc.test.ts'] } },
    ],
  },
});
