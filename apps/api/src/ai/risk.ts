// Early warning: a nightly, explainable risk score per student from the data Acadex already
// holds — attendance and its trend, grades and their trend, missed and late work, inactivity
// and (optionally) overdue fees. Every point of the score is a named factor staff can see.
import { db, runAsSystem } from '../db/context';
import { defineJob } from '../jobs/queue';
import { todayIn } from '../lib/locale';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { aiSettings } from './client';

export interface Factor {
  key: string;
  label: string;
  value: string;
  points: number;
}

export const level = (score: number) => (score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low');

interface Facts {
  att_recent: number | null;
  att_before: number | null;
  grade_recent: number | null;
  grade_before: number | null;
  missed: number;
  late: number;
  inactive_days: number | null;
  overdue_fees: number;
}

/** The score and its factors from a student's facts (pure, so it is easy to test and explain). */
export function score(f: Facts, opts: { fees: boolean }): { score: number; factors: Factor[] } {
  const factors: Factor[] = [];
  const add = (key: string, label: string, value: string, points: number) => points > 0 && factors.push({ key, label, value, points: Math.round(points) });
  if (f.att_recent != null) {
    if (f.att_recent < 75) add('attendance', 'Attendance below 75% (last 2 weeks)', `${f.att_recent}%`, Math.min(30, (75 - f.att_recent) * 0.8 + 10));
    if (f.att_before != null && f.att_before - f.att_recent >= 10) add('attendance_trend', 'Attendance falling', `${f.att_before}% → ${f.att_recent}%`, 10);
  }
  if (f.grade_recent != null) {
    if (f.grade_recent < 50) add('grades', 'Average grade below 50% (last month)', `${f.grade_recent}%`, Math.min(20, (50 - f.grade_recent) * 0.5 + 8));
    if (f.grade_before != null && f.grade_before - f.grade_recent >= 10) add('grade_trend', 'Grades falling', `${f.grade_before}% → ${f.grade_recent}%`, 15);
  }
  if (f.missed) add('missed_work', 'Work not handed in (last month)', String(f.missed), Math.min(20, f.missed * 5));
  if (f.late) add('late_work', 'Late work (last month)', String(f.late), Math.min(10, f.late * 2));
  if (f.inactive_days != null && f.inactive_days >= 14) add('inactive', 'No activity in Acadex', `${f.inactive_days} days`, f.inactive_days >= 30 ? 15 : 8);
  if (opts.fees && f.overdue_fees > 0) add('fees', 'Overdue fees', String(f.overdue_fees), 10);
  return { score: Math.min(100, factors.reduce((n, x) => n + x.points, 0)), factors: factors.sort((a, b) => b.points - a.points) };
}

/** Score every active student of an institution for a day. */
export async function computeRisk(institutionId: number, day: string): Promise<{ students: number; high: number }> {
  const s = await aiSettings(institutionId);
  const { rows } = await db.query<Facts & { student_id: number }>(
    `WITH st AS (SELECT id FROM students WHERE institution_id = $1 AND COALESCE(status, 'active') = 'active'),
          att AS (SELECT r.student_id,
                         round(100.0 * count(*) FILTER (WHERE sn.date > $2::date - 14 AND r.status IN ('present', 'late')) / NULLIF(count(*) FILTER (WHERE sn.date > $2::date - 14 AND r.status IN ('present', 'late', 'absent')), 0)) AS recent,
                         round(100.0 * count(*) FILTER (WHERE sn.date <= $2::date - 14 AND r.status IN ('present', 'late')) / NULLIF(count(*) FILTER (WHERE sn.date <= $2::date - 14 AND r.status IN ('present', 'late', 'absent')), 0)) AS before
                    FROM attendance_records r JOIN attendance_sessions sn ON sn.id = r.session_id
                   WHERE r.student_id IN (SELECT id FROM st) AND sn.date > $2::date - 42 AND sn.date <= $2::date GROUP BY r.student_id),
          gr AS (SELECT g.student_id,
                        round(100.0 * sum(g.points) FILTER (WHERE g.graded_at > $2::date - 30) / NULLIF(sum(a.points) FILTER (WHERE g.graded_at > $2::date - 30), 0)) AS recent,
                        round(100.0 * sum(g.points) FILTER (WHERE g.graded_at <= $2::date - 30) / NULLIF(sum(a.points) FILTER (WHERE g.graded_at <= $2::date - 30), 0)) AS before
                   FROM grades g JOIN assessments a ON a.id = g.assessment_id
                  WHERE g.student_id IN (SELECT id FROM st) AND g.points IS NOT NULL AND NOT g.excused AND g.graded_at > $2::date - 90 GROUP BY g.student_id),
          missed AS (SELECT st.id AS student_id, count(a.id)::int AS n FROM st
                       JOIN students s ON s.id = st.id JOIN course_offerings o ON o.section_id = s.section_id
                       JOIN assessments a ON a.offering_id = o.id AND a.status = 'published' AND a.deleted_at IS NULL AND a.kind IN ('assignment', 'project')
                        AND a.due_at < $2::date AND a.due_at > $2::date - 30
                      WHERE NOT EXISTS (SELECT 1 FROM submissions sb WHERE sb.assessment_id = a.id AND sb.student_id = st.id AND sb.status <> 'draft')
                        AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.assessment_id = a.id AND g.student_id = st.id AND g.excused)
                      GROUP BY st.id),
          late AS (SELECT sb.student_id, count(*)::int AS n FROM submissions sb WHERE sb.student_id IN (SELECT id FROM st) AND sb.late AND sb.submitted_at > $2::date - 30 GROUP BY sb.student_id),
          active AS (SELECT st.id AS student_id,
                            GREATEST((SELECT max(u.last_login_at) FROM users u WHERE u.role = 'student' AND u.ref_id = st.id),
                                     (SELECT max(p.updated_at) FROM content_progress p WHERE p.student_id = st.id),
                                     (SELECT max(sb.submitted_at) FROM submissions sb WHERE sb.student_id = st.id)) AS last_at
                       FROM st),
          fees AS (SELECT student_id, count(*)::int AS n FROM invoices WHERE student_id IN (SELECT id FROM st) AND status IN ('issued', 'partially_paid') AND due_date < $2::date GROUP BY student_id)
     SELECT st.id AS student_id, att.recent::float8 AS att_recent, att.before::float8 AS att_before, gr.recent::float8 AS grade_recent, gr.before::float8 AS grade_before,
            COALESCE(missed.n, 0) AS missed, COALESCE(late.n, 0) AS late,
            CASE WHEN active.last_at IS NULL THEN NULL ELSE ($2::date - active.last_at::date) END AS inactive_days, COALESCE(fees.n, 0) AS overdue_fees
       FROM st LEFT JOIN att ON att.student_id = st.id LEFT JOIN gr ON gr.student_id = st.id LEFT JOIN missed ON missed.student_id = st.id
       LEFT JOIN late ON late.student_id = st.id LEFT JOIN active ON active.student_id = st.id LEFT JOIN fees ON fees.student_id = st.id`,
    [institutionId, day]
  );
  let high = 0;
  for (const r of rows) {
    const out = score(r, { fees: s.risk_include_fees });
    const lv = level(out.score);
    if (lv === 'high') high++;
    await db.query(
      `INSERT INTO risk_scores (institution_id, student_id, computed_on, score, level, factors) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ON CONSTRAINT risk_scores_student_id_computed_on_key DO UPDATE SET score = EXCLUDED.score, level = EXCLUDED.level, factors = EXCLUDED.factors`,
      [institutionId, r.student_id, day, out.score, lv, JSON.stringify(out.factors)]
    );
  }
  return { students: rows.length, high };
}

/** Tell a student's guardians (with a portal account) that the school would like to talk. */
export async function alertGuardians(institutionId: number, studentId: number, note: string) {
  const { rows } = await db.query<{ user_id: number }>(
    `SELECT g.user_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE gs.student_id = $1 AND g.user_id IS NOT NULL`,
    [studentId]
  );
  return notify({ institutionId, userIds: rows.map((r) => r.user_id), type: 'system', title: 'The school would like to talk with you', message: note || 'Your child may need some extra support. Please contact the class teacher.', link: '/parent' });
}

export const riskNightlyJob = defineJob<{ day?: string; institutionId?: number }>({
  name: 'risk.nightly',
  cron: '30 1 * * *',
  async run({ day, institutionId }) {
    const insts = await runAsSystem(async () => (await db.query<{ id: number; timezone: string }>(`SELECT id, timezone FROM institutions WHERE status = 'active' AND ($1::int IS NULL OR id = $1)`, [institutionId ?? null])).rows);
    for (const i of insts) {
      try {
        const settings = await runAsSystem(() => aiSettings(i.id));
        if (!settings.enabled || settings.features.risk === false) continue;
        const r = await runAsSystem(() => computeRisk(i.id, day ?? todayIn(i.timezone)));
        logger.info({ institution: i.id, ...r }, 'risk: nightly scores');
      } catch (err) {
        logger.error({ err, institution: i.id }, 'risk: nightly run failed');
      }
    }
  },
});
