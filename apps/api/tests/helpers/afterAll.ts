import { afterAll } from 'vitest';
import { pool } from '../../src/db/pool';
import { pool as adminPool } from './fixture';

afterAll(async () => {
  await pool.end();
  await adminPool.end();
});
