import type { Queryable } from '../db/pool';
import { db, withTransaction } from '../db/context';
import { logger } from './logger';

const defaultDb: Queryable = db;

export interface AuditEntry {
  schoolId: number | null;
  userId?: number | null;
  actor: string;
  action: string;
  entity?: string;
  detail?: string;
}

/** Append to the audit trail. Best effort: a failed audit write is logged, never surfaced. */
export async function audit(entry: AuditEntry, db: Queryable = defaultDb): Promise<void> {
  const insert = (q: Queryable) =>
    q.query(
      `INSERT INTO audit_log (school_id, user_id, actor, action, entity, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [entry.schoolId, entry.userId ?? null, entry.actor, entry.action, entry.entity ?? '', entry.detail ?? '']
    );
  try {
    // in a savepoint, so a failed audit write never aborts the caller's transaction
    if (db === defaultDb) await withTransaction((tx) => insert(tx));
    else await insert(db);
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
}
