import 'dotenv/config';
import pg from 'pg';

const { Pool, types } = pg;

// DATE columns stay 'YYYY-MM-DD' strings. The default parser turns them into a JS Date at
// server-local midnight, which shifts the day when the server and school timezones differ.
types.setTypeParser(types.builtins.DATE, (v: string) => v);

// DATABASE_SSL: "false" for local Postgres, "no-verify" to skip cert checks,
// anything else (default) = verified TLS, which Neon supports.
function sslConfig(): false | { rejectUnauthorized: boolean } {
  const mode = (process.env.DATABASE_SSL || 'true').toLowerCase();
  if (mode === 'false') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  max: Number(process.env.DATABASE_POOL_MAX || 10),
});

// An idle client losing its connection must not crash the process.
pool.on('error', (err) => console.error('pg pool error:', err.message));

export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export default pool;
