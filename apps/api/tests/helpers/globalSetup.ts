// Boots a throwaway PostgreSQL (embedded-postgres) for the test run, migrates it,
// and exposes its URL to the test workers through process.env.
// Set TEST_DATABASE_URL to use an existing server instead (CI does this).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from '../../src/db/migrate';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '../..');
const repoRoot = path.resolve(apiDir, '../..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

let embedded: EmbeddedPostgres | undefined;

// If a previous run was killed before teardown, its postgres.exe children keep the
// cluster's shared memory alive on Windows and the next start fails. Only processes
// running this repo's embedded binary are touched.
function killStrayEmbeddedPostgres() {
  if (process.platform !== 'win32') return;
  const binDir = path.join(repoRoot, 'node_modules', '@embedded-postgres').replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\\').IndexOf('${binDir}', [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
}

async function startEmbedded(): Promise<string> {
  killStrayEmbeddedPostgres();
  const port = await freePort();
  // The cluster is kept between runs (initdb is slow on Windows); the database is recreated each run.
  const dir = path.join(apiDir, '.tmp', 'pg-test');
  const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  embedded = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    onLog: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // PG18 io_worker children can outlive the postmaster on Windows and lock the next run.
    // fsync off: this cluster is disposable, and it makes the per-test resets much faster.
    postgresFlags: ['-c', 'io_method=sync', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'],
  });
  if (fresh) await embedded.initialise();
  await embedded.start();
  await embedded.dropDatabase('acadex_test').catch(() => {});
  await embedded.createDatabase('acadex_test');
  return `postgres://postgres:postgres@127.0.0.1:${port}/acadex_test`;
}

export async function setup() {
  const url = process.env.TEST_DATABASE_URL || (await startEmbedded());
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error('Refusing to run tests against DATABASE_URL — set a separate TEST_DATABASE_URL');
  }

  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool, { log: () => {} });
  // The API connects as an ordinary role: superusers bypass Row-Level Security, so testing
  // as one would prove nothing. Like production, it may run migrations and the seed.
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acadex_app') THEN
        CREATE ROLE acadex_app LOGIN PASSWORD 'acadex_app' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$`);
  for (const stmt of [
    'GRANT ALL ON SCHEMA public TO acadex_app',
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO acadex_app',
    'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO acadex_app',
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO acadex_app',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO acadex_app',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO acadex_app',
  ]) {
    await pool.query(stmt);
  }
  await pool.end();

  const appUrl = new URL(url);
  appUrl.username = 'acadex_app';
  appUrl.password = 'acadex_app';
  // uploads go to a throwaway folder
  process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), 'acadex-test-storage');
  process.env.TEST_ADMIN_DATABASE_URL = url; // superuser: fixture resets and assertions
  process.env.DATABASE_URL = appUrl.toString(); // what the API under test uses
  process.env.DATABASE_SSL = 'false';
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  process.env.NODE_ENV = 'test';
  process.env.JOBS_DRIVER = 'inline';
  process.env.PUSH_DRIVER = 'fake';
  process.env.LIVE_DRIVER = 'fake';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
  process.env.AI_RATE_LIMIT = '100000';
  process.env.API_RATE_LIMIT = '100000';
  process.env.WHATSAPP_DRIVER = 'fake';
}

export async function teardown() {
  if (embedded) await embedded.stop();
}
