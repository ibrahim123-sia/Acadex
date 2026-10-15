// Scheduled jobs: emptying the recycle bin after the retention period, reminders before work is
// due, and alerts when a student's attendance falls below the institution's threshold.
import { DEFAULT_ATTENDANCE_THRESHOLD, RECYCLABLE, institutionSettings } from '@acadex/shared';
import { db, runAsSystem, withDeleted } from '../db/context';
import { rosterSql } from '../lib/lms/access';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { RETENTION_DAYS, purgeRecord } from '../lib/soft-delete';
import { defineJob } from './queue';

/** LMS records that are deleted softly and purged without further clean-up. */
const PLAIN_SOFT_DELETED = ['assessments', 'content_items', 'question_banks', 'questions', 'discussions', 'course_blueprints'] as const;

export const purgeJob = defineJob<{ olderThanDays?: number }>({
  name: 'recycle.purge',
  cron: '30 2 * * *',
  async run({ olderThanDays = RETENTION_DAYS }) {
    let purged = 0;
    for (const t of RECYCLABLE) {
      const rows = await runAsSystem(() =>
        withDeleted(async () => (await db.query<{ id: number; institution_id: number }>(`SELECT id, institution_id FROM ${t} WHERE deleted_at < now() - make_interval(days => $1)`, [olderThanDays])).rows)
      );
      for (const r of rows) {
        if (await runAsSystem(() => purgeRecord(t, r.id, r.institution_id))) purged++;
      }
    }
    for (const t of PLAIN_SOFT_DELETED) {
      const n = await runAsSystem(() => withDeleted(async () => (await db.query(`DELETE FROM ${t} WHERE deleted_at < now() - make_interval(days => $1)`, [olderThanDays])).rowCount ?? 0));
      purged += n;
    }
    if (purged) logger.info({ purged }, 'recycle bin: purged records past retention');
  },
});

/** Remind students about work due soon that they haven't handed in (once per assessment). */
export const dueRemindersJob = defineJob<{ now?: string }>({
  name: 'reminders.due',
  cron: '5 * * * *',
  async run({ now }) {
    const at = now ? new Date(now) : new Date();
    await runAsSystem(async () => {
      const { rows } = await db.query<{ id: number; institution_id: number; offering_id: number; title: string; kind: string; due_at: Date; course: string; hours: number }>(
        `SELECT a.id, a.institution_id, a.offering_id, a.title, a.kind, a.due_at, c.name AS course,
                COALESCE((i.settings->>'due_reminder_hours')::int, 24) AS hours
           FROM assessments a JOIN institutions i ON i.id = a.institution_id
           JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
          WHERE a.status = 'published' AND a.deleted_at IS NULL AND a.due_at > $1
            AND a.due_at <= $1 + make_interval(hours => COALESCE((i.settings->>'due_reminder_hours')::int, 24))`,
        [at]
      );
      for (const a of rows) {
        // students who haven't handed it in (and whose own due date hasn't moved later)
        const { rows: users } = await db.query<{ id: number }>(
          `SELECT u.id FROM users u
            WHERE u.role = 'student' AND u.is_active AND u.ref_id IN (${rosterSql('$1')})
              AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assessment_id = $2 AND s.status <> 'draft'
                               AND (s.student_id = u.ref_id OR s.group_id IN (SELECT gm.group_id FROM group_members gm WHERE gm.student_id = u.ref_id)))
              AND NOT EXISTS (SELECT 1 FROM quiz_attempts q WHERE q.assessment_id = $2 AND q.student_id = u.ref_id AND q.status <> 'in_progress')
              AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.assessment_id = $2 AND g.student_id = u.ref_id AND (g.excused OR g.points IS NOT NULL))
              AND NOT EXISTS (SELECT 1 FROM assessment_extensions x WHERE x.assessment_id = $2 AND x.student_id = u.ref_id AND x.due_at > $3)`,
          [a.offering_id, a.id, a.due_at]
        );
        await notify({
          institutionId: a.institution_id,
          userIds: users.map((u) => u.id),
          type: 'due_soon',
          title: `Due soon: ${a.title}`,
          message: `${a.course} — due ${a.due_at.toISOString().slice(0, 16).replace('T', ' ')} UTC. Hand it in before then.`,
          link: `/learn/courses/${a.offering_id}/work/${a.id}`,
          dedupeKey: `due:${a.id}`,
        });
      }
    });
  },
});

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7)}`;
};

/** Weekly at most: students below the attendance threshold, their guardians and class teacher. */
export const attendanceAlertsJob = defineJob<{ now?: string; minSessions?: number }>({
  name: 'attendance.alerts',
  cron: '0 15 * * *',
  async run({ now, minSessions = 10 }) {
    const at = now ? new Date(now) : new Date();
    const week = isoWeek(at);
    await runAsSystem(async () => {
      const { rows: insts } = await db.query<{ id: number; settings: unknown }>(`SELECT id, settings FROM institutions WHERE status = 'active'`);
      for (const inst of insts) {
        const parsed = institutionSettings.safeParse(inst.settings ?? {});
        const threshold = (parsed.success && parsed.data.attendance_threshold) || DEFAULT_ATTENDANCE_THRESHOLD;
        // this academic year's registers
        const { rows } = await db.query<{ student_id: number; name: string; pct: number; user_id: number | null; homeroom_user: number | null }>(
          `WITH yr AS (SELECT starts_on, ends_on FROM academic_years WHERE institution_id = $1 AND is_current LIMIT 1),
                c AS (SELECT r.student_id,
                             count(*) FILTER (WHERE r.status IN ('present', 'late')) AS attended,
                             count(*) FILTER (WHERE r.status = 'absent') AS absent
                        FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id
                       WHERE r.institution_id = $1 AND s.date BETWEEN COALESCE((SELECT starts_on FROM yr), '-infinity') AND COALESCE((SELECT ends_on FROM yr), 'infinity')
                       GROUP BY r.student_id)
           SELECT c.student_id, st.first_name || ' ' || st.last_name AS name,
                  round(c.attended * 100.0 / NULLIF(c.attended + c.absent, 0), 1)::float AS pct,
                  (SELECT u.id FROM users u WHERE u.role = 'student' AND u.ref_id = st.id AND u.institution_id = $1 AND u.is_active LIMIT 1) AS user_id,
                  (SELECT u.id FROM users u JOIN sections sec ON sec.homeroom_teacher_id = u.ref_id WHERE sec.id = st.section_id AND u.role = 'teacher' AND u.is_active LIMIT 1) AS homeroom_user
             FROM c JOIN students st ON st.id = c.student_id
            WHERE c.attended + c.absent >= $2 AND COALESCE(st.status, 'active') = 'active'
              AND c.attended * 100.0 / NULLIF(c.attended + c.absent, 0) < $3`,
          [inst.id, minSessions, threshold]
        );
        for (const r of rows) {
          const message = `${r.name}'s attendance is ${r.pct}% — below the required ${threshold}%.`;
          const link = `/attendance/students/${r.student_id}`;
          if (r.user_id) await notify({ institutionId: inst.id, userIds: [r.user_id], type: 'attendance_alert', title: 'Your attendance is low', message, link, dedupeKey: `att:${r.student_id}:${week}` });
          const { rows: g } = await db.query<{ user_id: number }>(
            `SELECT DISTINCT g.user_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE gs.student_id = $1 AND g.user_id IS NOT NULL`,
            [r.student_id]
          );
          await notify({ institutionId: inst.id, userIds: g.map((x) => x.user_id), type: 'attendance_alert', title: `Low attendance: ${r.name}`, message, link, dedupeKey: `att:${r.student_id}:${week}` });
          if (r.homeroom_user) await notify({ institutionId: inst.id, userIds: [r.homeroom_user], type: 'attendance_alert', title: `Low attendance: ${r.name}`, message, link, dedupeKey: `att:${r.student_id}:${week}` });
        }
      }
    });
  },
});
