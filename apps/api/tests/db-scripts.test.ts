// Bug #1/#2 + seed guard: migrate and seed must never silently destroy data.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers/http';

import fs from 'node:fs';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(apiDir, 'package.json'), 'utf8'));

// Runs a TypeScript script the way the npm scripts do (node + the tsx loader).
function run(script: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(apiDir, script), ...args], {
    cwd: apiDir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120000,
  });
}
const institutionCount = async () => Number((await fixture.pool.query('SELECT count(*) FROM institutions')).rows[0].count);

beforeEach(async () => {
  await fixture.resetDb();
});

describe('npm scripts', () => {
  it('dev and build entry points exist with that exact case', () => {
    expect(fs.readdirSync(path.join(apiDir, 'src'))).toContain('server.ts');
    expect(pkg.scripts.start).toBe('node dist/server.js');
  });

  it('has the scripts the README documents', () => {
    for (const s of ['db:migrate', 'db:seed', 'db:reset', 'dev', 'build', 'start', 'test', 'typecheck', 'lint']) {
      expect(pkg.scripts[s], s).toBeTruthy();
    }
  });
});

describe('migrate', () => {
  it('keeps existing data when run again', async () => {
    const before = await institutionCount();
    expect(before).toBe(2);
    const r = run('src/db/migrate.ts');
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(await institutionCount()).toBe(before);
  });

  it('records applied migrations and is idempotent', async () => {
    const r1 = run('src/db/migrate.ts');
    const r2 = run('src/db/migrate.ts');
    expect(r1.status, r1.stderr).toBe(0);
    expect(r2.status, r2.stderr).toBe(0);
    const { rows } = await fixture.pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toContain('drizzle:0000_baseline');
  });
});

describe('seed', () => {
  it('refuses to run on a database that already has data', async () => {
    const r = run('src/db/seed.ts');
    expect(r.status).not.toBe(0);
    expect(await institutionCount()).toBe(2);
  });

  it('refuses to run in production even with --reset', async () => {
    const r = run('src/db/seed.ts', ['--reset'], { NODE_ENV: 'production' });
    expect(r.status).not.toBe(0);
    expect(await institutionCount()).toBe(2);
  });

  it('replaces data when --reset is given', async () => {
    const r = run('src/db/seed.ts', ['--reset']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const { rows } = await fixture.pool.query('SELECT slug FROM institutions ORDER BY slug');
    expect(rows.map((x) => x.slug)).toEqual(['greenwood', 'sunrise']);
  }, 120000);
});
