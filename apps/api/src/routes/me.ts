// The signed-in person's own workspace: profile overviews and the role dashboards (what to do
// today). Course work, attendance, grades and notifications have their own routes.
import { Router } from 'express';
import { DEFAULT_ATTENDANCE_THRESHOLD, attendancePercent, institutionSettings } from '@acadex/shared';
import { db } from '../db/context';
import { institutionTimeZone } from '../lib/institution';
import { FEE_TOTALS_SQL, SHOW_TO_STUDENTS_SQL } from '../lib/finance/summary';
import { rosterSql } from '../lib/lms/access';
import { ATTENDANCE_COUNTS_SQL, RELEASED_GRADES_SQL } from '../lib/lms/student';
import { todayIn } from '../lib/locale';
import { auth, currentUser, requireInstitutionUser, requirePermission, institutionId } from '../middleware/auth';
import { streakOf } from '../lib/lms/rewards';

const router = Router();
router.use(auth);
router.use('/teacher', requirePermission('teaching.access'));
router.use('/student', requirePermission('learner.access'));

const ref = (req: Parameters<typeof currentUser>[0]) => currentUser(req).ref_id;

// ---------- STUDENT self ----------
router.get('/student/overview', async (req, res) => {
  const s = institutionId(req);
  const stu = ref(req);
  const [profile, grades, attendance, fee, show] = await Promise.all([
    db.query(`SELECT st.*, c.name section_name FROM students st LEFT JOIN sections c ON c.id=st.section_id WHERE st.id=$1 AND st.institution_id=$2`, [stu, s]),
    db.query(RELEASED_GRADES_SQL, [stu, s]),
    db.query(ATTENDANCE_COUNTS_SQL, [stu, s]),
    db.query(FEE_TOTALS_SQL, [stu, s]),
    db.query<{ show: boolean }>(SHOW_TO_STUDENTS_SQL, [s]),
  ]);
  const feeRow = show.rows[0]?.show && fee.rows[0]?.invoices ? fee.rows[0] : null;
  res.json({ profile: profile.rows[0] || null, grades: grades.rows, attendance: attendance.rows, fee: feeRow });
});

// ---------- TEACHER self ----------
router.get('/teacher/overview', async (req, res) => {
  const s = institutionId(req);
  const tch = ref(req);
  const [profile, sections, subjects, students] = await Promise.all([
    db.query(`SELECT * FROM teachers WHERE id=$1 AND institution_id=$2`, [tch, s]),
    db.query(
      `SELECT DISTINCT c.id, c.name FROM sections c WHERE c.institution_id=$2 AND (c.id IN (SELECT section_id FROM section_staff WHERE teacher_id=$1) OR c.homeroom_teacher_id=$1)`,
      [tch, s]
    ),
    db.query(
      `SELECT ts.offering_id AS id, co.name subject, c.name section_name
         FROM section_staff ts JOIN course_offerings su ON su.id=ts.offering_id LEFT JOIN courses co ON co.id=su.course_id LEFT JOIN sections c ON c.id=su.section_id
        WHERE ts.teacher_id=$1 AND ts.institution_id=$2`,
      [tch, s]
    ),
    db.query<{ c: number }>(
      `SELECT count(DISTINCT r.id)::int c FROM section_staff ts CROSS JOIN LATERAL (${rosterSql('ts.offering_id')}) r WHERE ts.teacher_id=$1 AND ts.institution_id=$2`,
      [tch, s]
    ),
  ]);
  res.json({ profile: profile.rows[0] || null, sections: sections.rows, subjects: subjects.rows, studentCount: students.rows[0]?.c ?? 0 });
});

/** Sections a teacher takes registers for (class teacher, or a course in it), with student counts. */
router.get('/teacher/sections', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.label, c.code, (c.homeroom_teacher_id = $1) AS homeroom,
            (SELECT count(*) FROM students s WHERE s.section_id=c.id AND COALESCE(s.status, 'active') = 'active')::int students,
            COALESCE((SELECT json_agg(json_build_object('offering_id', o.id, 'course', co.name) ORDER BY co.name)
                        FROM section_staff ss JOIN course_offerings o ON o.id = ss.offering_id JOIN courses co ON co.id = o.course_id
                       WHERE ss.teacher_id = $1 AND o.section_id = c.id), '[]') AS courses
       FROM sections c WHERE c.institution_id=$2 AND (c.homeroom_teacher_id = $1 OR c.id IN (SELECT o.section_id FROM section_staff ss JOIN course_offerings o ON o.id = ss.offering_id WHERE ss.teacher_id = $1))
      ORDER BY c.name, c.label`,
    [ref(req), institutionId(req)]
  );
  res.json(rows);
});

// ---------- DASHBOARDS ----------

/** What to do today, for whoever is signed in. */
router.get('/dashboard', requireInstitutionUser, async (req, res) => {
  const u = currentUser(req);
  const s = institutionId(req);
  const tz = await institutionTimeZone(s);
  const today = todayIn(tz);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const { rows: inst } = await db.query<{ settings: unknown }>(`SELECT settings FROM institutions WHERE id = $1`, [s]);
  const parsed = institutionSettings.safeParse(inst[0]?.settings ?? {});
  const threshold = (parsed.success && parsed.data.attendance_threshold) || DEFAULT_ATTENDANCE_THRESHOLD;
  const holiday = (await db.query<{ name: string }>(`SELECT name FROM holidays WHERE institution_id = $1 AND $2::date BETWEEN starts_on AND ends_on AND kind IN ('holiday', 'break') AND campus_id IS NULL LIMIT 1`, [s, today])).rows[0]?.name ?? null;

  if (u.role === 'student') {
    const sid = u.ref_id!;
    const [classes, due, grades, att, courses, announcements] = await Promise.all([
      holiday
        ? { rows: [] }
        : db.query(
            `SELECT p.name AS period, to_char(p.starts_at, 'HH24:MI') AS starts_at, to_char(p.ends_at, 'HH24:MI') AS ends_at, c.name AS course, r.code AS room,
                    COALESCE(st2.first_name || ' ' || st2.last_name, t.first_name || ' ' || t.last_name) AS teacher
               FROM timetable_slots ts JOIN periods p ON p.id = ts.period_id LEFT JOIN course_offerings o ON o.id = ts.offering_id LEFT JOIN courses c ON c.id = o.course_id
               LEFT JOIN rooms r ON r.id = ts.room_id LEFT JOIN teachers t ON t.id = ts.teacher_id
               LEFT JOIN substitutions su ON su.slot_id = ts.id AND su.date = $3 LEFT JOIN teachers st2 ON st2.id = su.substitute_teacher_id
              WHERE ts.section_id = (SELECT section_id FROM students WHERE id = $1) AND ts.weekday = $2 ORDER BY p.position`,
            [sid, weekday, today]
          ),
      db.query(
        `SELECT a.id, a.title, a.kind, a.offering_id, c.name AS course, COALESCE(x.due_at, a.due_at) AS due_at
           FROM assessments a JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
           LEFT JOIN assessment_extensions x ON x.assessment_id = a.id AND x.student_id = $1
          WHERE a.status = 'published' AND $1 IN (${rosterSql('a.offering_id')}) AND COALESCE(x.due_at, a.due_at) > now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM submissions sb WHERE sb.assessment_id = a.id AND sb.status <> 'draft' AND (sb.student_id = $1 OR sb.group_id IN (SELECT group_id FROM group_members WHERE student_id = $1)))
            AND NOT EXISTS (SELECT 1 FROM quiz_attempts q WHERE q.assessment_id = a.id AND q.student_id = $1 AND q.status <> 'in_progress')
          ORDER BY COALESCE(x.due_at, a.due_at) LIMIT 8`,
        [sid]
      ),
      db.query(`${RELEASED_GRADES_SQL.replace('LIMIT 200', 'LIMIT 5')}`, [sid, s]),
      db.query(ATTENDANCE_COUNTS_SQL, [sid, s]),
      db.query(
        `SELECT o.id, c.name, (SELECT count(*)::int FROM content_items i JOIN modules m ON m.id = i.module_id WHERE m.offering_id = o.id AND m.published AND i.published) AS items,
                (SELECT count(*)::int FROM content_progress p JOIN content_items i ON i.id = p.item_id JOIN modules m ON m.id = i.module_id WHERE m.offering_id = o.id AND p.student_id = $1 AND p.status = 'done') AS done
           FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.institution_id = $2 AND $1 IN (${rosterSql('o.id')}) ORDER BY c.name`,
        [sid, s]
      ),
      db.query(`SELECT id, title, created_at FROM announcements WHERE institution_id = $1 AND target_audience IN ('All', 'Students') AND offering_id IS NULL AND section_id IS NULL ORDER BY created_at DESC LIMIT 3`, [s]),
    ]);
    const counts = Object.fromEntries(att.rows.map((r: { status: string; c: number }) => [r.status.toLowerCase(), r.c]));
    const pct = attendancePercent(counts);
    return void res.json({
      role: 'student',
      today,
      holiday,
      classes: classes.rows,
      due: due.rows,
      recent_grades: grades.rows,
      attendance: { percent: pct, threshold, below: pct != null && pct < threshold },
      courses: courses.rows.map((c: { items: number; done: number }) => ({ ...c, percent: c.items ? Math.round((c.done / c.items) * 100) : 0 })),
      announcements: announcements.rows,
      streak: await streakOf(sid),
    });
  }

  if (u.role === 'teacher') {
    const tid = u.ref_id!;
    const [classes, toGrade, registers, leave, courses] = await Promise.all([
      holiday
        ? { rows: [] }
        : db.query(
            `SELECT ts.id AS slot_id, ts.section_id, ts.offering_id, p.id AS period_id, p.name AS period, to_char(p.starts_at, 'HH24:MI') AS starts_at, to_char(p.ends_at, 'HH24:MI') AS ends_at,
                    c.name AS course, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name, r.code AS room, (su.id IS NOT NULL) AS covering,
                    EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = ts.section_id AND a.offering_id IS NOT DISTINCT FROM ts.offering_id AND a.date = $3 AND a.period_id = p.id) AS register_taken
               FROM timetable_slots ts JOIN periods p ON p.id = ts.period_id JOIN sections sec ON sec.id = ts.section_id
               LEFT JOIN course_offerings o ON o.id = ts.offering_id LEFT JOIN courses c ON c.id = o.course_id LEFT JOIN rooms r ON r.id = ts.room_id
               LEFT JOIN substitutions su ON su.slot_id = ts.id AND su.date = $3 AND su.substitute_teacher_id = $1
              WHERE ts.weekday = $2 AND ((ts.teacher_id = $1 AND NOT EXISTS (SELECT 1 FROM substitutions x WHERE x.slot_id = ts.id AND x.date = $3)) OR su.id IS NOT NULL)
              ORDER BY p.position`,
            [tid, weekday, today]
          ),
      db.query(
        `SELECT a.id, a.title, a.offering_id, c.name AS course,
                (SELECT count(*)::int FROM submissions sb WHERE sb.assessment_id = a.id AND sb.status = 'submitted'
                    AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.assessment_id = a.id AND g.student_id = sb.student_id AND (g.points IS NOT NULL OR g.excused)))
                 + (SELECT count(*)::int FROM quiz_attempts q WHERE q.assessment_id = a.id AND q.status = 'submitted') AS waiting
           FROM assessments a JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
          WHERE a.offering_id IN (SELECT offering_id FROM section_staff WHERE teacher_id = $1) AND a.status <> 'draft'`,
        [tid]
      ),
      db.query(
        `SELECT sec.id AS section_id, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name,
                EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = sec.id AND a.offering_id IS NULL AND a.date = $2) AS taken
           FROM sections sec WHERE sec.homeroom_teacher_id = $1 AND sec.status = 'active'`,
        [tid, today]
      ),
      db.query(`SELECT count(*)::int n FROM leave_requests lr JOIN students st ON st.id = lr.student_id JOIN sections sec ON sec.id = st.section_id WHERE sec.homeroom_teacher_id = $1 AND lr.status = 'pending'`, [tid]),
      db.query(
        `SELECT o.id, c.name, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name FROM section_staff ss JOIN course_offerings o ON o.id = ss.offering_id
           JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id WHERE ss.teacher_id = $1 ORDER BY c.name`,
        [tid]
      ),
    ]);
    return void res.json({
      role: 'teacher',
      today,
      holiday,
      classes: classes.rows,
      to_grade: toGrade.rows.filter((r: { waiting: number }) => r.waiting > 0),
      registers: holiday ? [] : registers.rows,
      leave_to_decide: leave.rows[0]?.n ?? 0,
      courses: courses.rows,
      // the latest early-warning scores of students they teach (high and medium)
      at_risk: (
        await db.query(
          `SELECT DISTINCT ON (rs.student_id) rs.student_id, st.first_name || ' ' || st.last_name AS name, sec.name AS section, rs.score::int AS score, rs.level
             FROM risk_scores rs JOIN students st ON st.id = rs.student_id LEFT JOIN sections sec ON sec.id = st.section_id
            WHERE rs.institution_id = $1 AND rs.level IN ('high', 'medium') AND rs.computed_on > CURRENT_DATE - 7
              AND st.section_id IN (SELECT section_id FROM section_staff WHERE teacher_id = $2)
            ORDER BY rs.student_id, rs.computed_on DESC`,
          [s, u.ref_id ?? 0]
        )
      ).rows
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 6),
    });
  }

  if (u.role === 'parent') {
    const { rows: children } = await db.query<{ id: number; name: string; section_name: string | null; can_view_grades: boolean; can_view_fees: boolean }>(
      `SELECT st.id, st.first_name || ' ' || st.last_name AS name, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name, gs.can_view_grades, gs.can_view_fees
         FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id LEFT JOIN sections sec ON sec.id = st.section_id
        WHERE g.user_id = $1 AND gs.institution_id = $2 ORDER BY st.first_name`,
      [u.id, s]
    );
    const out: Record<string, unknown>[] = [];
    for (const c of children) {
      const [att, today_, due, grades, fee] = await Promise.all([
        db.query(ATTENDANCE_COUNTS_SQL, [c.id, s]),
        db.query(`SELECT r.status FROM attendance_records r JOIN attendance_sessions sn ON sn.id = r.session_id WHERE r.student_id = $1 AND sn.date = $2 AND sn.offering_id IS NULL LIMIT 1`, [c.id, today]),
        db.query(
          `SELECT a.id, a.title, c.name AS course, a.due_at FROM assessments a JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
            WHERE a.status = 'published' AND a.due_at > now() AND $1 IN (${rosterSql('a.offering_id')})
              AND NOT EXISTS (SELECT 1 FROM submissions sb WHERE sb.assessment_id = a.id AND sb.student_id = $1 AND sb.status <> 'draft') ORDER BY a.due_at LIMIT 5`,
          [c.id]
        ),
        c.can_view_grades ? db.query(RELEASED_GRADES_SQL.replace('LIMIT 200', 'LIMIT 5'), [c.id, s]) : { rows: null },
        c.can_view_fees ? db.query(FEE_TOTALS_SQL, [c.id, s]) : { rows: [] },
      ]);
      const counts = Object.fromEntries(att.rows.map((r: { status: string; c: number }) => [r.status.toLowerCase(), r.c]));
      const pct = attendancePercent(counts);
      out.push({ ...c, today: today_.rows[0]?.status ?? null, attendance: { percent: pct, threshold, below: pct != null && pct < threshold }, due: due.rows, recent_grades: grades.rows, fee: fee.rows[0]?.invoices ? fee.rows[0] : null });
    }
    return void res.json({ role: 'parent', today, holiday, children: out });
  }

  // administrators: today's registers and who needs attention
  const [registers, lowAttendance, leave, ungraded] = await Promise.all([
    db.query<{ total: number; taken: number }>(
      `SELECT count(*)::int total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = sec.id AND a.date = $2))::int taken
         FROM sections sec WHERE sec.institution_id = $1 AND sec.status = 'active'`,
      [s, today]
    ),
    db.query(
      `SELECT st.id, st.first_name || ' ' || st.last_name AS name, x.pct FROM (
          SELECT r.student_id, round(100.0 * count(*) FILTER (WHERE r.status IN ('present', 'late')) / NULLIF(count(*) FILTER (WHERE r.status IN ('present', 'late', 'absent')), 0), 1)::float AS pct
            FROM attendance_records r WHERE r.institution_id = $1 GROUP BY r.student_id HAVING count(*) >= 10) x
         JOIN students st ON st.id = x.student_id WHERE x.pct < $2 ORDER BY x.pct LIMIT 10`,
      [s, threshold]
    ),
    db.query(`SELECT count(*)::int n FROM leave_requests WHERE institution_id = $1 AND status = 'pending'`, [s]),
    db.query(`SELECT count(*)::int n FROM submissions sb WHERE sb.institution_id = $1 AND sb.status = 'submitted' AND sb.submitted_at < now() - interval '7 days'`, [s]),
  ]);
  res.json({
    role: 'admin',
    today,
    holiday,
    registers: registers.rows[0],
    low_attendance: lowAttendance.rows,
    threshold,
    leave_pending: leave.rows[0]?.n ?? 0,
    submissions_waiting_over_week: ungraded.rows[0]?.n ?? 0,
  });
});

export default router;
