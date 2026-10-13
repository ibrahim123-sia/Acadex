// Forward-only, versioned migrations. Each file in migrations/ (NNNN_name.sql) runs once,
// inside a transaction, and is recorded in schema_migrations with a checksum.
// Destructive statements are refused unless the file is explicitly marked as reviewed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
const LOCK_KEY = 4242001; // pg_advisory_lock key so two deploys can't migrate at once
const DESTRUCTIVE = /\b(DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|TYPE)|TRUNCATE)\b/i;
const ALLOW_DESTRUCTIVE = '-- acadex:reviewed-destructive';

interface Migration {
  id: string;
  sql: string;
  checksum: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      // normalise line endings so Windows and Linux checkouts hash the same
      const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
      return {
        id: file.replace(/\.sql$/, ''),
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

export async function migrate(pool: pg.Pool, { log = console.log }: { log?: (msg: string) => void } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = new Map<string, string>(
      (await client.query<{ id: string; checksum: string }>('SELECT id, checksum FROM schema_migrations')).rows.map(
        (r) => [r.id, r.checksum]
      )
    );

    const ran: string[] = [];
    for (const m of loadMigrations()) {
      if (applied.has(m.id)) {
        if (applied.get(m.id) !== m.checksum) {
          throw new Error(`Migration ${m.id} was edited after it was applied. Add a new migration instead.`);
        }
        continue;
      }
      if (DESTRUCTIVE.test(m.sql) && !m.sql.includes(ALLOW_DESTRUCTIVE)) {
        throw new Error(`Migration ${m.id} contains DROP/TRUNCATE. Review it and add "${ALLOW_DESTRUCTIVE}" if intended.`);
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1,$2)', [m.id, m.checksum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.id} failed: ${(e as Error).message}`);
      }
      log(`  applied ${m.id}`);
      ran.push(m.id);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { pool } = await import('./pool');
  migrate(pool)
    .then((ran) => console.log(ran.length ? `✅ ${ran.length} migration(s) applied` : '✅ Database is up to date'))
    .catch((e: Error) => {
      console.error('❌ Migration failed:', e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
