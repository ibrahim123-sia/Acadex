// Live updates for open browser tabs (server-sent events). Code that changes something a person
// should see right away calls publish(); the message goes out through PostgreSQL NOTIFY, so it
// is sent only when the transaction commits and reaches every API process. Each process holds
// one LISTEN connection and passes messages to the streams of the people they are for.
import pg from 'pg';
import { db, inContext } from '../db/context';
import { directDatabaseUrl, pool } from '../db/pool';
import { logger } from './logger';

const CHANNEL = 'acadex_events';

export interface LiveEvent {
  /** e.g. notification, grade, attendance, discussion */
  kind: string;
  data?: Record<string, unknown>;
}

/** Send a live event to these people (on commit). */
export async function publish(userIds: number[], event: LiveEvent): Promise<void> {
  const ids = [...new Set(userIds)];
  // NOTIFY payloads are limited to 8000 bytes: send big audiences in chunks
  for (let i = 0; i < ids.length; i += 500) {
    const payload = JSON.stringify({ u: ids.slice(i, i + 500), e: event });
    if (inContext()) await db.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
    else await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
  }
}

type Listener = (event: LiveEvent) => void;
const listeners = new Map<number, Set<Listener>>();
let client: pg.Client | undefined;
let connecting: Promise<void> | undefined;
let retryMs = 1000;

function dispatch(raw: string) {
  try {
    const { u, e } = JSON.parse(raw) as { u: number[]; e: LiveEvent };
    for (const id of u) for (const fn of listeners.get(id) ?? []) fn(e);
  } catch (err) {
    logger.warn({ err }, 'bad live event');
  }
}

async function connect(): Promise<void> {
  const c = new pg.Client({ connectionString: directDatabaseUrl(), ssl: (pool.options as pg.PoolConfig).ssl });
  c.on('notification', (m) => m.payload && dispatch(m.payload));
  c.on('error', (err) => {
    logger.warn({ err }, 'live events connection lost');
    if (client === c) client = undefined;
    c.end().catch(() => {});
    scheduleReconnect();
  });
  await c.connect();
  await c.query(`LISTEN ${CHANNEL}`);
  client = c;
  retryMs = 1000;
}

function scheduleReconnect() {
  if (!listeners.size) return;
  setTimeout(() => void ensureListening(), retryMs).unref();
  retryMs = Math.min(retryMs * 2, 30_000);
}

function ensureListening(): Promise<void> {
  if (client) return Promise.resolve();
  connecting ??= connect()
    .catch((err) => {
      logger.warn({ err }, 'could not listen for live events');
      scheduleReconnect();
    })
    .finally(() => {
      connecting = undefined;
    });
  return connecting;
}

/** Receive live events for a person. Returns the unsubscribe function. */
export async function subscribe(userId: number, fn: Listener): Promise<() => void> {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  await ensureListening();
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(userId);
    if (!listeners.size && client) {
      const c = client;
      client = undefined;
      c.end().catch(() => {});
    }
  };
}

/** Open streams (health checks, tests). */
export const liveStreamCount = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
