// A student's released grades and attendance counts, as the overview pages and report card show them.

/** $1 = student, $2 = institution. Released grades only, newest first. */
export const RELEASED_GRADES_SQL = `
  SELECT co.name subject, a.title assignment_name, initcap(a.kind) assignment_type, g.points obtained_marks, a.points total_marks,
         g.excused, g.missing, ROUND(g.points * (1 - g.late_penalty_percent / 100) / NULLIF(a.points, 0) * 100, 1) percentage, g.released_at
    FROM grades g JOIN assessments a ON a.id = g.assessment_id JOIN course_offerings su ON su.id = a.offering_id LEFT JOIN courses co ON co.id = su.course_id
   WHERE g.student_id = $1 AND g.institution_id = $2 AND g.status = 'released'
   ORDER BY g.released_at DESC NULLS LAST, g.id DESC LIMIT 200`;

/** $1 = student, $2 = institution. Counts per status (Present, Absent, Late, Excused, Leave). */
export const ATTENDANCE_COUNTS_SQL = `
  SELECT initcap(r.status) status, count(*)::int c FROM attendance_records r WHERE r.student_id = $1 AND r.institution_id = $2 GROUP BY r.status`;
