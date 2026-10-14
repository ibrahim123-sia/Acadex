// Turning marks into results with the right grading scheme: a program's own scheme if it has
// one, otherwise the institution's default.
import { GRADING_PRESETS, gpa, gradeFor, type GradingScheme } from '@acadex/shared';
import type { Queryable } from '../db/pool';
import { db } from '../db/context';

const defaultDb: Queryable = db;

export async function schemeForStudent(studentId: number, institutionId: number, db: Queryable = defaultDb): Promise<GradingScheme> {
  const { rows } = await db.query<{ name: string; kind: GradingScheme['kind']; bands: GradingScheme['bands']; gpa_scale: string | null; pass_percent: string }>(
    `SELECT g.name, g.kind, g.bands, g.gpa_scale, g.pass_percent
       FROM grading_schemes g
      WHERE g.institution_id = $2
        AND (g.id = (SELECT p.grading_scheme_id FROM students st JOIN sections sec ON sec.id = st.section_id
                       JOIN program_levels l ON l.id = sec.program_level_id JOIN programs p ON p.id = l.program_id WHERE st.id = $1)
             OR g.is_default)
      ORDER BY g.is_default ASC LIMIT 1`,
    [studentId, institutionId]
  );
  const r = rows[0];
  if (!r) return GRADING_PRESETS.school_letter;
  return { name: r.name, kind: r.kind, bands: r.bands, gpa_scale: r.gpa_scale == null ? null : Number(r.gpa_scale), pass_percent: Number(r.pass_percent) };
}

export interface CourseResult {
  course: string;
  code: string | null;
  credits: number | null;
  obtained: number;
  total: number;
  percent: number;
  grade: string;
  points: number | null;
  passed: boolean;
}

/** Per-course totals (all assessments added up) graded with the student's scheme. */
export async function courseResults(studentId: number, institutionId: number, db: Queryable = defaultDb) {
  const scheme = await schemeForStudent(studentId, institutionId, db);
  const { rows } = await db.query<{ course: string | null; code: string | null; credits: string | null; obtained: string; total: string }>(
    `SELECT co.name AS course, co.code, co.credit_hours AS credits, sum(g.obtained_marks) AS obtained, sum(g.total_marks) AS total
       FROM grades g LEFT JOIN course_offerings o ON o.id = g.offering_id LEFT JOIN courses co ON co.id = o.course_id
      WHERE g.student_id = $1 AND g.institution_id = $2
      GROUP BY co.id, co.name, co.code, co.credit_hours ORDER BY co.name NULLS LAST`,
    [studentId, institutionId]
  );
  const results: CourseResult[] = rows.map((r) => {
    const total = Number(r.total);
    const percent = total > 0 ? (Number(r.obtained) / total) * 100 : 0;
    const g = gradeFor(scheme, percent);
    return {
      course: r.course ?? 'General',
      code: r.code,
      credits: r.credits == null ? null : Number(r.credits),
      obtained: Number(r.obtained),
      total,
      percent: g.percent,
      grade: g.label,
      points: g.points,
      passed: g.passed,
    };
  });
  const overallPercent = results.length ? results.reduce((x, r) => x + r.percent, 0) / results.length : null;
  return {
    scheme,
    results,
    overall: overallPercent == null ? null : { ...gradeFor(scheme, overallPercent), gpa: gpa(scheme, results.map((r) => ({ percent: r.percent, credits: r.credits }))) },
  };
}
