// Bug #1/#2 + seed guard: migrate and seed must never silently destroy data.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers/http.mjs';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse((await import('node:fs')).readFileSync(path.join(backendDir, 'package.json'), 'utf8'));

function run(script, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(backendDir, script), ...args], {
    cwd: backendDir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120000,
  });
}
const schoolCount = async () => Number((await fixture.pool.query('SELECT count(*) FROM schools')).rows[0].count);

beforeEach(async () => {
  await fixture.resetDb();
});

describe('npm scripts', () => {
  it('start points at a file that exists with that exact case', async () => {
    const fs = await import('node:fs');
    const file = pkg.scripts.start.replace(/^node\s+/, '');
    expect(fs.readdirSync(backendDir)).toContain(file);
  });

  it('has the migrate / seed scripts the README documents', () => {
    for (const s of ['db:migrate', 'db:seed', 'db:reset', 'migrate', 'seed', 'test']) {
      expect(pkg.scripts[s], s).toBeTruthy();
    }
  });
});

describe('migrate', () => {
  it('keeps existing data when run again', async () => {
    const before = await schoolCount();
    expect(before).toBe(2);
    const r = run('db/migrate.js');
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(await schoolCount()).toBe(before);
  });

  it('records applied migrations and is idempotent', async () => {
    const r1 = run('db/migrate.js');
    const r2 = run('db/migrate.js');
    expect(r1.status, r1.stderr).toBe(0);
    expect(r2.status, r2.stderr).toBe(0);
    const { rows } = await fixture.pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toContain('0001_baseline');
  });
});

describe('seed', () => {
  it('refuses to run on a database that already has data', async () => {
    const r = run('db/seed.js');
    expect(r.status).not.toBe(0);
    expect(await schoolCount()).toBe(2);
  });

  it('refuses to run in production even with --reset', async () => {
    const r = run('db/seed.js', ['--reset'], { NODE_ENV: 'production' });
    expect(r.status).not.toBe(0);
    expect(await schoolCount()).toBe(2);
  });

  it('replaces data when --reset is given', async () => {
    const r = run('db/seed.js', ['--reset']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const { rows } = await fixture.pool.query('SELECT slug FROM schools ORDER BY slug');
    expect(rows.map((x) => x.slug)).toEqual(['greenwood', 'sunrise']);
  }, 120000);
});
