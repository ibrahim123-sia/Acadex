// Boots a throwaway PostgreSQL (embedded-postgres) for the test run, migrates it,
// and exposes its URL to the test workers through process.env.
// Set TEST_DATABASE_URL to use an existing server instead (CI does this).
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '../..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let pg;

async function startEmbedded() {
  const EmbeddedPostgres = require('embedded-postgres').default;
  const port = await freePort();
  // The cluster is kept between runs (initdb is slow on Windows); the database is recreated each run.
  const dir = path.join(backendDir, '.tmp', 'pg-test');
  const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    onLog: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // PG18 io_worker children can outlive the postmaster on Windows and lock the next run.
    postgresFlags: ['-c', 'io_method=sync'],
  });
  if (fresh) await pg.initialise();
  await pg.start();
  await pg.dropDatabase('acadex_test').catch(() => {});
  await pg.createDatabase('acadex_test');
  return `postgres://postgres:postgres@127.0.0.1:${port}/acadex_test`;
}

export async function setup() {
  const url = process.env.TEST_DATABASE_URL || (await startEmbedded());
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error('Refusing to run tests against DATABASE_URL â€” set a separate TEST_DATABASE_URL');
  }

  process.env.DATABASE_URL = url;
  process.env.DATABASE_SSL = 'false';
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  process.env.NODE_ENV = 'test';

  const { Pool } = require('pg');
  const { migrate } = require('../../db/migrate.js');
  const pool = new Pool({ connectionString: url });
  await migrate(pool, { log: () => {} });
  await pool.end();
}

export async function teardown() {
  if (pg) await pg.stop();
}
