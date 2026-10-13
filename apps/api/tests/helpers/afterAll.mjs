import { afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

afterAll(async () => {
  await require('../../db/pool.js').end();
});
