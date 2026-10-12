import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/helpers/globalSetup.mjs'],
    setupFiles: ['./tests/helpers/afterAll.mjs'],
    include: ['tests/**/*.test.mjs'],
    pool: 'forks',
    fileParallelism: false, // one shared test database; each file resets it
    testTimeout: 20000,
    hookTimeout: 120000,
  },
});
