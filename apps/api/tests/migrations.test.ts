// The Drizzle baseline must describe exactly the schema the legacy SQL migrations built,
// so pre-Drizzle databases (e.g. production on Neon) and new databases end up identical.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadLegacyMigrations, migrate } from '../src/db/migrate';

const base = new URL(process.env.DATABASE_URL!);
const urlFor = (db: string) => {
  const u = new URL(base.toString());
  u.pathname = `/${db}`;
  return u.toString();
};
const admin = new pg.Pool({ connectionString: urlFor('postgres') });
const LEGACY_DB = 'acadex_mig_legacy';
const FRESH_DB = 'acadex_mig_fresh';
let legacyPool: pg.Pool;
let freshPool: pg.Pool;

async function recreate(db: string) {
  await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  await admin.query(`CREATE DATABASE ${db}`);
}

async function catalog(pool: pg.Pool) {
  const q = async (sql: string) => (await pool.query(sql)).rows.map((r) => JSON.stringify(r)).sort();
  return {
    columns: await q(`SELECT table_name, column_name, data_type, is_nullable, column_default
                        FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'schema_migrations'`),
    constraints: await q(`SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
                            FROM pg_constraint WHERE connamespace='public'::regnamespace
                             AND conrelid::regclass::text <> 'schema_migrations'`),
    indexes: await q(`SELECT tablename, indexname, indexdef FROM pg_indexes
                       WHERE schemaname='public' AND tablename <> 'schema_migrations'`),
  };
}

beforeAll(async () => {
  await recreate(LEGACY_DB);
  await recreate(FRESH_DB);
  legacyPool = new pg.Pool({ connectionString: urlFor(LEGACY_DB) });
  freshPool = new pg.Pool({ connectionString: urlFor(FRESH_DB) });
}, 120000);

afterAll(async () => {
  await legacyPool?.end();
  await freshPool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${LEGACY_DB}`);
  await admin.query(`DROP DATABASE IF EXISTS ${FRESH_DB}`);
  await admin.end();
});

describe('migrations', () => {
  it('a pre-Drizzle database and a new database end up with the same schema', async () => {
    // simulate a Phase 0A database: legacy files applied and recorded by the old runner
    await legacyPool.query(`CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL,
                              applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const m of loadLegacyMigrations()) {
      await legacyPool.query(m.sql);
      await legacyPool.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1,$2)', [m.id, m.checksum]);
    }
    const legacyRan = await migrate(legacyPool, { log: () => {} });
    expect(legacyRan).toContain('drizzle:0000_baseline');

    const freshRan = await migrate(freshPool, { log: () => {} });
    expect(freshRan[0]).toBe('drizzle:0000_baseline');
    expect(freshRan.some((id) => !id.startsWith('drizzle:'))).toBe(false); // legacy files never run on new DBs

    const [a, b] = [await catalog(legacyPool), await catalog(freshPool)];
    expect(b.columns).toEqual(a.columns);
    expect(b.constraints).toEqual(a.constraints);
    expect(b.indexes).toEqual(a.indexes);
  }, 120000);

  it('running again changes nothing', async () => {
    expect(await migrate(legacyPool, { log: () => {} })).toEqual([]);
    expect(await migrate(freshPool, { log: () => {} })).toEqual([]);
  });

  it('refuses a migration that was edited after being applied', async () => {
    await freshPool.query(`UPDATE schema_migrations SET checksum='tampered' WHERE id='drizzle:0000_baseline'`);
    await expect(migrate(freshPool, { log: () => {} })).rejects.toThrow(/edited after it was applied/);
  });
});
