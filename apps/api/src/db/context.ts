// Request-scoped database context and Row-Level Security.
//
// Every API request runs its queries in one transaction on one connection. Before the first
// query (and whenever the context changes) the transaction-local settings app.institution_id,
// app.user_id and app.bypass_rls are applied, and the RLS policies on tenant tables use them.
// A query that forgot its `institution_id = ...` filter therefore still cannot see another
// institution's rows.
//
// The transaction commits before the response is sent (so a failed commit can never look
// like a success to the client) and rolls back for error responses.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import type pg from 'pg';
import { pool } from './pool';
import { logger } from '../lib/logger';

interface DbStore {
  institutionId: number | null;
  userId: number | null;
  bypass: boolean;
  client?: pg.PoolClient;
  applied?: string; // settings currently applied on the client
  settled?: boolean;
  savepoints: number;
}

const als = new AsyncLocalStorage<DbStore>();

const settingsKey = (s: DbStore) => `${s.bypass ? 'on' : 'off'}|${s.institutionId ?? ''}|${s.userId ?? ''}`;

const intSetting = (v: number | null) => {
  if (v == null) return '';
  if (!Number.isSafeInteger(v)) throw new Error(`invalid id in database context: ${v}`);
  return String(v);
};

/** One statement setting all three values (only integers and on/off, so inlining is safe). */
const settingsSql = (s: DbStore) =>
  `SELECT set_config('app.bypass_rls', '${s.bypass ? 'on' : 'off'}', true), ` +
  `set_config('app.institution_id', '${intSetting(s.institutionId)}', true), ` +
  `set_config('app.user_id', '${intSetting(s.userId)}', true)`;

async function clientFor(store: DbStore): Promise<pg.PoolClient> {
  if (store.settled) throw new Error('database context already finished (query after the response was sent?)');
  const key = settingsKey(store);
  if (!store.client) {
    const client = await pool.connect();
    store.client = client;
    // BEGIN + settings in a single round trip
    await client.query(`BEGIN; ${settingsSql(store)}`);
    store.applied = key;
  } else if (store.applied !== key) {
    await store.client.query(settingsSql(store));
    store.applied = key;
  }
  return store.client;
}

async function settle(store: DbStore, ok: boolean): Promise<void> {
  if (store.settled) return;
  store.settled = true;
  const client = store.client;
  if (!client) return;
  try {
    await client.query(ok ? 'COMMIT' : 'ROLLBACK');
  } finally {
    client.release();
  }
}

/** pg-compatible query function bound to the current context. */
async function contextQuery(text: string | pg.QueryConfig, values?: unknown[]): Promise<pg.QueryResult> {
  const store = als.getStore();
  if (!store) throw new Error('database query outside a request or runAsSystem() context');
  const client = await clientFor(store);
  return client.query(text as string, values);
}

/**
 * The database for application code: every query runs in the current request's
 * transaction with its tenant settings. Use `db.query(sql, params)` like pg.
 */
export const db = {
  query: contextQuery as <R extends pg.QueryResultRow = any>(text: string | pg.QueryConfig, values?: unknown[]) => Promise<pg.QueryResult<R>>, // eslint-disable-line @typescript-eslint/no-explicit-any
};
export type Db = typeof db;

/** Express middleware: one database context (and transaction) per request. */
export const dbContext: RequestHandler = (req, res, next) => {
  const store: DbStore = { institutionId: null, userId: null, bypass: false, savepoints: 0 };
  // Commit / roll back right before the response is finished.
  const end = res.end.bind(res) as (...args: unknown[]) => typeof res;
  res.end = ((...args: unknown[]) => {
    const ok = res.statusCode < 400;
    settle(store, ok).then(
      () => end(...args),
      (err) => {
        // never report success for work that was not saved
        (req.log ?? logger).error({ err }, 'transaction commit failed');
        res.destroy(err);
      }
    );
    return res;
  }) as typeof res.end;
  // client went away before we answered: release the connection
  res.on('close', () => {
    if (!store.settled) settle(store, false).catch(() => {});
  });
  als.run(store, next);
};

/** After authentication: scope the rest of the request to the user's institution. */
export function setTenant(institutionId: number | null, userId: number | null): void {
  const store = als.getStore();
  if (!store) throw new Error('setTenant() outside a database context');
  store.institutionId = institutionId;
  store.userId = userId;
  store.bypass = false;
}

/** For routes that are cross-tenant by design (platform staff): bypass RLS for this request. */
export const systemContext: RequestHandler = (_req, _res, next) => {
  const store = als.getStore();
  if (!store) throw new Error('systemContext outside a database context');
  store.bypass = true;
  next();
};

/**
 * Run fn with RLS bypassed. Inside a request it temporarily switches the request's context
 * (e.g. auth lookups before the tenant is known); outside one (scripts, jobs) it opens its
 * own transaction.
 */
export async function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (store) {
    const prev = store.bypass;
    store.bypass = true;
    try {
      return await fn();
    } finally {
      store.bypass = prev;
    }
  }
  return runAsSystem(fn);
}

/** A standalone system transaction (scripts, background jobs). */
export async function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  const store: DbStore = { institutionId: null, userId: null, bypass: true, savepoints: 0 };
  return als.run(store, async () => {
    try {
      const result = await fn();
      await settle(store, true);
      return result;
    } catch (e) {
      await settle(store, false).catch(() => {});
      throw e;
    }
  });
}

/** A standalone transaction scoped to one institution (background jobs acting for a tenant). */
export async function runAsTenant<T>(institutionId: number, fn: () => Promise<T>): Promise<T> {
  const store: DbStore = { institutionId, userId: null, bypass: false, savepoints: 0 };
  return als.run(store, async () => {
    try {
      const result = await fn();
      await settle(store, true);
      return result;
    } catch (e) {
      await settle(store, false).catch(() => {});
      throw e;
    }
  });
}

/**
 * All-or-nothing block inside the current context (a SAVEPOINT in the request transaction).
 * fn receives the context's query interface.
 */
export async function withTransaction<T>(fn: (client: Db) => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (!store) return runAsSystem(() => withTransaction(fn));
  const name = `sp_${++store.savepoints}`;
  const client = await clientFor(store);
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn(db);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
    throw e;
  }
}
