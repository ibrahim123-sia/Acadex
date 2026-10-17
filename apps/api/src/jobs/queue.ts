// Background jobs. Work that must not hold up a request (email and push delivery, reminders,
// the nightly recycle-bin purge) is queued here and run by workers.
//
//   JOBS_DRIVER=pgboss → pg-boss queues in the same PostgreSQL (schema pgboss). A job queued
//                        inside a request is written in that request's transaction, so it exists
//                        only if the request's work commits.
//   JOBS_DRIVER=inline → kept in memory once the transaction commits; drainJobs() runs them
//                        (tests, scripts).
// Workers run inside the API process (JOBS_WORKER=true, the default) or in `npm run worker`.
// Schedules: pg-boss cron (JOBS_SCHEDULE=internal) or an outside caller (external, see routes/internal.ts).
import { PgBoss } from 'pg-boss';
import { getConfig } from '../config';
import { afterCommit, db, inContext } from '../db/context';
import { logger } from '../lib/logger';
import { directDatabaseUrl } from '../db/pool';

export interface JobDef<T = Record<string, unknown>> {
  name: string;
  run: (data: T) => Promise<void>;
  /** cron schedule (in the server's job timezone, UTC) */
  cron?: string;
  retryLimit?: number;
}

const registry = new Map<string, JobDef<never>>();

export function defineJob<T extends object>(def: JobDef<T>): JobDef<T> {
  registry.set(def.name, def as unknown as JobDef<never>);
  return def;
}

export interface EnqueueOptions {
  /** run no earlier than this */
  startAfter?: Date;
  /** at most one queued job with this key */
  singletonKey?: string;
}

// ---------------------------------------------------------------- inline driver
interface Pending {
  name: string;
  data: object;
  runAt: number;
  singletonKey?: string;
}
let pending: Pending[] = [];

/** Run queued inline jobs that are due (now by default). Returns how many ran. */
export async function drainJobs({ now = Date.now(), rounds = 10 }: { now?: number; rounds?: number } = {}): Promise<number> {
  let ran = 0;
  for (let i = 0; i < rounds; i++) {
    const due = pending.filter((p) => p.runAt <= now);
    if (!due.length) break;
    pending = pending.filter((p) => p.runAt > now);
    for (const job of due) {
      await runJob(job.name, job.data);
      ran++;
    }
  }
  return ran;
}

/** Inline jobs not yet run (tests). */
export const pendingJobs = () => pending.map((p) => ({ name: p.name, data: p.data, runAt: new Date(p.runAt) }));
export const clearJobs = () => {
  pending = [];
};

/** The jobs that run on a schedule (name and cron), for an outside scheduler. */
export const cronJobs = () => [...registry.values()].filter((d) => d.cron).map((d) => ({ name: d.name, cron: d.cron! }));

/** Run one job's handler now (tests, and cron jobs triggered by hand). */
export async function runJob(name: string, data: object = {}): Promise<void> {
  const def = registry.get(name);
  if (!def) throw new Error(`unknown job: ${name}`);
  await def.run(data as never);
}

// ---------------------------------------------------------------- pg-boss driver
let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

function sslOption() {
  const mode = (process.env.DATABASE_SSL || 'true').toLowerCase();
  if (mode === 'false') return false;
  return { rejectUnauthorized: mode !== 'no-verify' };
}

async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= (async () => {
    const b = new PgBoss({ connectionString: directDatabaseUrl(), ssl: sslOption(), max: 4, schema: 'pgboss', application_name: 'acadex-jobs' });
    b.on('error', (err) => logger.error({ err }, 'job queue error'));
    await b.start();
    for (const def of registry.values()) await b.createQueue(def.name, { retryLimit: def.retryLimit ?? 3, retryBackoff: true });
    boss = b;
    return b;
  })();
  return starting;
}

/** Queue a job. Inside a request it belongs to the request's transaction. */
export async function enqueue(name: string, data: object = {}, opts: EnqueueOptions = {}): Promise<void> {
  if (!registry.has(name)) throw new Error(`unknown job: ${name}`);
  if (getConfig().jobsDriver === 'inline') {
    const job: Pending = { name, data, runAt: opts.startAfter?.getTime() ?? 0, singletonKey: opts.singletonKey };
    afterCommit(() => {
      if (job.singletonKey && pending.some((p) => p.name === name && p.singletonKey === job.singletonKey)) return;
      pending.push(job);
    });
    return;
  }
  const b = await getBoss();
  const options = { startAfter: opts.startAfter, singletonKey: opts.singletonKey };
  if (inContext()) await b.send(name, data, { ...options, db: { executeSql: (text, values) => db.query(text, values) } });
  else await b.send(name, data, options);
}

/** Start the workers and the cron schedules (API process or `npm run worker`). */
export async function startWorkers(): Promise<() => Promise<void>> {
  if (getConfig().jobsDriver === 'inline') return async () => {};
  const b = await getBoss();
  for (const def of registry.values()) {
    await b.work<object>(def.name, { batchSize: 5 }, async (jobs) => {
      for (const job of jobs) await def.run(job.data as never);
    });
    // JOBS_SCHEDULE=external: POST /api/internal/cron queues them instead (a sleeping container
    // misses pg-boss schedules); drop schedules saved by an earlier internal run
    if (def.cron && getConfig().jobsSchedule === 'internal') await b.schedule(def.name, def.cron, {}, { tz: 'UTC' });
    else if (def.cron) await b.unschedule(def.name);
  }
  logger.info({ jobs: [...registry.keys()] }, 'job workers started');
  return async () => {
    await b.stop({ graceful: true, timeout: 10_000 });
    boss = undefined;
    starting = undefined;
  };
}
