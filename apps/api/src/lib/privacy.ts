// Retention: each institution decides how long messages, AI tutor conversations, audit
// entries and visitor logs are kept (Settings → Privacy). Nothing is removed unless a period is
// set. Runs daily.
import { db, runAsSystem } from '../db/context';
import { defineJob } from '../jobs/queue';
import { logger } from './logger';

const TARGETS = [
  { setting: 'messages_months', sql: `DELETE FROM messages WHERE institution_id = $1 AND created_at < now() - make_interval(months => $2)` },
  { setting: 'messages_months', sql: `DELETE FROM conversations c WHERE c.institution_id = $1 AND c.last_message_at < now() - make_interval(months => $2) AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)` },
  { setting: 'ai_conversations_months', sql: `DELETE FROM ai_conversations WHERE institution_id = $1 AND updated_at < now() - make_interval(months => $2)` },
  { setting: 'audit_months', sql: `DELETE FROM audit_log WHERE institution_id = $1 AND created_at < now() - make_interval(months => $2)` },
  { setting: 'visitor_logs_months', sql: `DELETE FROM visitor_logs WHERE institution_id = $1 AND check_in < now() - make_interval(months => $2)` },
] as const;

export async function applyRetention(institutionId?: number): Promise<Record<string, number>> {
  return runAsSystem(async () => {
    const { rows } = await db.query<{ id: number; r: Record<string, number | null> | null }>(
      `SELECT id, settings->'retention' AS r FROM institutions WHERE ($1::int IS NULL OR id = $1) AND settings ? 'retention'`,
      [institutionId ?? null]
    );
    const removed: Record<string, number> = {};
    for (const inst of rows) {
      for (const t of TARGETS) {
        const months = inst.r?.[t.setting];
        if (!months) continue;
        const { rowCount } = await db.query(t.sql, [inst.id, months]);
        removed[t.setting] = (removed[t.setting] ?? 0) + (rowCount ?? 0);
      }
    }
    return removed;
  });
}

export const retentionJob = defineJob<{ institutionId?: number }>({
  name: 'privacy.retention',
  cron: '15 2 * * *',
  async run({ institutionId }) {
    const removed = await applyRetention(institutionId);
    if (Object.values(removed).some(Boolean)) logger.info({ removed }, 'retention applied');
  },
});
