// The Drizzle schema in src/db/schema must describe the database the migrations build:
// same tables, columns, nullability, and constraint / index names. Hand-written migrations
// (renames, RLS) can't drift from the TypeScript schema without failing here.
import { describe, it, expect } from 'vitest';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema';
import { pool } from './helpers/fixture';

const tables = (Object.values(schema).filter((v) => v instanceof PgTable) as PgTable[]).map((t) => getTableConfig(t));

describe('schema drift', () => {
  it('every table and column in the TypeScript schema exists with the same nullability', async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
          AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')`
    );
    const db = new Set(rows.map((r) => `${r.table_name}.${r.column_name}:${r.is_nullable === 'YES' ? 'null' : 'not null'}`));
    const ts = new Set(
      tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}:${c.notNull || c.primary ? 'not null' : 'null'}`))
    );
    expect([...ts].filter((x) => !db.has(x)).sort()).toEqual([]);
    expect([...db].filter((x) => !ts.has(x)).sort()).toEqual([]);
  });

  it('constraint and index names match', async () => {
    const { rows: cons } = await pool.query<{ tbl: string; conname: string }>(
      `SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace AND contype IN ('f', 'u', 'c')
          AND conrelid::regclass::text <> 'schema_migrations'`
    );
    const { rows: idx } = await pool.query<{ tablename: string; indexname: string }>(
      `SELECT i.tablename, i.indexname FROM pg_indexes i
        WHERE i.schemaname = 'public' AND i.tablename <> 'schema_migrations'
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = i.indexname)`
    );
    const dbNames = new Set([...cons.map((c) => `${c.tbl}:${c.conname}`), ...idx.map((i) => `${i.tablename}:${i.indexname}`)]);
    const tsNames = new Set(
      tables.flatMap((t) => [
        ...t.foreignKeys.map((f) => `${t.name}:${f.getName()}`),
        ...t.uniqueConstraints.map((u) => `${t.name}:${u.name}`),
        ...t.checks.map((c) => `${t.name}:${c.name}`),
        ...t.indexes.map((i) => `${t.name}:${i.config.name}`),
      ])
    );
    expect([...tsNames].filter((x) => !dbNames.has(x)).sort()).toEqual([]);
    expect([...dbNames].filter((x) => !tsNames.has(x)).sort()).toEqual([]);
  });
});
