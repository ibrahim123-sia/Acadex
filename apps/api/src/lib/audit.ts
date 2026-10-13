import { pool, type Queryable } from '../db/pool';
import { logger } from './logger';

export interface AuditEntry {
  schoolId: number | null;
  userId?: number | null;
  actor: string;
  action: string;
  entity?: string;
  detail?: string;
}

/** Append to the audit trail. Best effort: a failed audit write is logged, never surfaced. */
export async function audit(entry: AuditEntry, db: Queryable = pool): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_log (school_id, user_id, actor, action, entity, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [entry.schoolId, entry.userId ?? null, entry.actor, entry.action, entry.entity ?? '', entry.detail ?? '']
    );
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
}
