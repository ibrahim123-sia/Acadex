// Turning marks into results with the right grading scheme: a program's own scheme if it has
// one, otherwise the institution's default.
import { GRADING_PRESETS, gpa, gradeFor, type GradingScheme } from '@acadex/shared';
import type { Queryable } from '../db/pool';
import { db } from '../db/context';
import { coursePercent, earned, gradebookData } from './lms/gradebook';

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

/**
 * Per-course results from the gradebook (released grades only: weighted categories, drop
 * lowest, excused and missing work, late penalties, and a teacher's override), graded with
 * the student's scheme.
 */
export async function courseResults(studentId: number, institutionId: number, db: Queryable = defaultDb, { termId }: { termId?: number | null } = {}) {
  const scheme = await schemeForStudent(studentId, institutionId, db);
  const { rows: offerings } = await db.query<{ id: number; course: string; code: string | null; credits: string | null }>(
    `SELECT DISTINCT o.id, co.name AS course, co.code, co.credit_hours AS credits
       FROM course_offerings o JOIN courses co ON co.id = o.course_id
      WHERE o.institution_id = $2 AND ($3::int IS NULL OR o.term_id = $3)
        AND (EXISTS (SELECT 1 FROM grades g JOIN assessments a ON a.id = g.assessment_id WHERE a.offering_id = o.id AND g.student_id = $1 AND g.status = 'released')
             OR EXISTS (SELECT 1 FROM final_grade_overrides f WHERE f.offering_id = o.id AND f.student_id = $1))
      ORDER BY co.name`,
    [studentId, institutionId, termId ?? null]
  );
  const results: CourseResult[] = [];
  for (const o of offerings) {
    const data = await gradebookData(o.id, { studentIds: [studentId], releasedOnly: true });
    const cells = data.byStudent.get(studentId) ?? new Map();
    const computed = coursePercent(data.columns, data.categories, cells);
    const override = data.override.get(studentId);
    const percent = override?.percent ?? computed;
    if (percent == null) continue;
    let obtained = 0;
    let total = 0;
    for (const c of data.columns) {
      const g = cells.get(c.id);
      if (!g || g.excused || (g.points == null && !g.missing)) continue;
      obtained += earned(g) ?? 0;
      total += c.points;
    }
    const g = gradeFor(scheme, percent);
    results.push({
      course: o.course,
      code: o.code,
      credits: o.credits == null ? null : Number(o.credits),
      obtained: Math.round(obtained * 100) / 100,
      total,
      percent: g.percent,
      grade: g.label,
      points: g.points,
      passed: g.passed,
    });
  }
  const overallPercent = results.length ? results.reduce((x, r) => x + r.percent, 0) / results.length : null;
  return {
    scheme,
    results,
    overall: overallPercent == null ? null : { ...gradeFor(scheme, overallPercent), gpa: gpa(scheme, results.map((r) => ({ percent: r.percent, credits: r.credits }))) },
  };
}
