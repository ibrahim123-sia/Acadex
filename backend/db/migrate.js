// Forward-only, versioned migrations. Each file in db/migrations (NNNN_name.sql) runs once,
// inside a transaction, and is recorded in schema_migrations with a checksum.
// Destructive statements are refused unless the file is explicitly marked as reviewed.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 4242001; // pg_advisory_lock key so two deploys can't migrate at once
const DESTRUCTIVE = /\b(DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|TYPE)|TRUNCATE)\b/i;
const ALLOW_DESTRUCTIVE = '-- acadex:reviewed-destructive';

function loadMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      // normalise line endings so Windows and Linux checkouts hash the same
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n');
      return {
        id: file.replace(/\.sql$/, ''),
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

async function migrate(pool, { log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = new Map(
      (await client.query('SELECT id, checksum FROM schema_migrations')).rows.map((r) => [r.id, r.checksum])
    );

    const ran = [];
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
        throw new Error(`Migration ${m.id} failed: ${e.message}`);
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

module.exports = { migrate };

if (require.main === module) {
  const pool = require('./pool');
  migrate(pool)
    .then((ran) => console.log(ran.length ? `✅ ${ran.length} migration(s) applied` : '✅ Database is up to date'))
    .catch((e) => {
      console.error('❌ Migration failed:', e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
