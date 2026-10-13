import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/helpers/globalSetup.ts'],
    setupFiles: ['./tests/helpers/afterAll.ts'],
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false, // one shared test database; each file resets it
    testTimeout: 20000,
    hookTimeout: 120000,
  },
});
