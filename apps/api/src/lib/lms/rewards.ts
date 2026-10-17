// What finishing course work earns: points, badges and streaks (when the institution turns
// gamification on) and the course certificate (issued automatically once its conditions are met).
import { institutionSettings } from '@acadex/shared';
import { db } from '../../db/context';
import { verifyCode } from '../documents';
import { notify } from '../notify';
import { coursePercent, gradebookData } from './gradebook';

async function gamificationOn(institutionId: number) {
  const { rows } = await db.query<{ settings: unknown }>(`SELECT settings FROM institutions WHERE id = $1`, [institutionId]);
  const p = institutionSettings.safeParse(rows[0]?.settings ?? {});
  return p.success && !!p.data.gamification?.enabled;
}

/** Course progress (percent of published items done) for students. */
async function progressOf(offeringId: number, studentId: number) {
  const { rows } = await db.query<{ done: number; total: number }>(
    `WITH items AS (SELECT i.id FROM content_items i JOIN modules m ON m.id = i.module_id WHERE m.offering_id = $1 AND m.published AND i.published)
     SELECT (SELECT count(*)::int FROM content_progress p WHERE p.student_id = $2 AND p.status = 'done' AND p.item_id IN (SELECT id FROM items)) AS done,
            (SELECT count(*)::int FROM items) AS total`,
    [offeringId, studentId]
  );
  const r = rows[0]!;
  return r.total ? Math.round((r.done / r.total) * 100) : 0;
}

/** Days in a row (ending today or yesterday) with something completed. */
export async function streakOf(studentId: number) {
  const { rows } = await db.query<{ d: string }>(
    `SELECT DISTINCT completed_at::date::text AS d FROM content_progress WHERE student_id = $1 AND completed_at > now() - interval '400 days' ORDER BY d DESC`,
    [studentId]
  );
  let streak = 0;
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (rows[0] && rows[0].d !== iso(day)) day.setUTCDate(day.getUTCDate() - 1);
  for (const r of rows) {
    if (r.d !== iso(day)) break;
    streak++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return streak;
}

/** Call after students complete items in a course. */
export async function onProgress(institutionId: number, offeringId: number, studentIds: number[], ref: string) {
  if (!studentIds.length) return;
  const gamified = await gamificationOn(institutionId);
  for (const sid of studentIds) {
    if (gamified) {
      await db.query(
        `INSERT INTO points_ledger (institution_id, student_id, offering_id, points, reason, ref) VALUES ($1,$2,$3,10,'Completed course work',$4) ON CONFLICT DO NOTHING`,
        [institutionId, sid, offeringId, `${ref}:${sid}`]
      );
      const { rows: badges } = await db.query<{ id: number; name: string; criteria: { kind: string; threshold?: number } }>(
        `SELECT id, name, criteria FROM badges WHERE institution_id = $1 AND criteria->>'kind' IN ('items_completed', 'streak_days')
            AND NOT EXISTS (SELECT 1 FROM badge_awards a WHERE a.badge_id = badges.id AND a.student_id = $2)`,
        [institutionId, sid]
      );
      if (badges.length) {
        const { rows: c } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM content_progress WHERE student_id = $1 AND status = 'done'`, [sid]);
        const streak = badges.some((b) => b.criteria.kind === 'streak_days') ? await streakOf(sid) : 0;
        for (const b of badges) {
          const earned = b.criteria.kind === 'items_completed' ? c[0]!.n >= (b.criteria.threshold ?? 1) : streak >= (b.criteria.threshold ?? 1);
          if (earned) await db.query(`INSERT INTO badge_awards (institution_id, badge_id, student_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [institutionId, b.id, sid]);
        }
      }
    }
    await maybeIssueCertificate(institutionId, offeringId, sid);
  }
}

/** Issue the course certificate when its progress and grade conditions are met. */
export async function maybeIssueCertificate(institutionId: number, offeringId: number, studentId: number, { force = false } = {}) {
  const { rows } = await db.query<{ id: number; title: string; body: string; auto_issue: boolean; min_progress_percent: number; min_grade_percent: string | null }>(
    `SELECT id, title, body, auto_issue, min_progress_percent, min_grade_percent FROM certificate_templates WHERE offering_id = $1 AND institution_id = $2`,
    [offeringId, institutionId]
  );
  const t = rows[0];
  if (!t || (!t.auto_issue && !force)) return null;
  const { rows: has } = await db.query(`SELECT 1 FROM certificates WHERE template_id = $1 AND student_id = $2`, [t.id, studentId]);
  if (has[0]) return null;
  const progress = await progressOf(offeringId, studentId);
  const data = await gradebookData(offeringId, { studentIds: [studentId], releasedOnly: true });
  const grade = data.override.get(studentId)?.percent ?? coursePercent(data.columns, data.categories, data.byStudent.get(studentId) ?? new Map());
  if (!force) {
    if (progress < t.min_progress_percent) return null;
    if (t.min_grade_percent != null && (grade == null || grade < Number(t.min_grade_percent))) return null;
  }
  const { rows: who } = await db.query<{ name: string; course: string; institution: string }>(
    `SELECT st.first_name || ' ' || st.last_name AS name, c.name AS course, i.name AS institution
       FROM students st, course_offerings o JOIN courses c ON c.id = o.course_id JOIN institutions i ON i.id = o.institution_id WHERE st.id = $1 AND o.id = $2`,
    [studentId, offeringId]
  );
  const w = who[0]!;
  const fill = (s: string) => s.replace(/\{\{\s*(student|course|institution|date|grade)\s*\}\}/g, (_m, k: string) =>
    ({ student: w.name, course: w.course, institution: w.institution, date: new Date().toISOString().slice(0, 10), grade: grade == null ? '' : `${grade}%` })[k] ?? ''
  );
  const { rows: cert } = await db.query<{ id: number; verify_code: string }>(
    `INSERT INTO certificates (institution_id, template_id, student_id, offering_id, verify_code, title, body, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING RETURNING id, verify_code`,
    [institutionId, t.id, studentId, offeringId, verifyCode(), fill(t.title), fill(t.body), JSON.stringify({ progress, grade })]
  );
  if (cert[0]) {
    const { rows: u } = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'student' AND ref_id = $1 AND institution_id = $2`, [studentId, institutionId]);
    await notify({ institutionId, userIds: u.map((x) => x.id), type: 'certificate_issued', title: `Certificate: ${fill(t.title)}`, message: 'Congratulations — your certificate is ready.', link: '/learn/achievements' });
  }
  return cert[0] ?? null;
}
