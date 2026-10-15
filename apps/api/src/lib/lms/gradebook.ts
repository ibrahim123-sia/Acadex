// Grade arithmetic: late penalties, a student's effective due date (with extensions), and the
// course grade (weighted categories, drop lowest, excused / missing, overrides).
import { db } from '../../db/context';

export interface LatePolicy {
  mode: 'allow' | 'penalty' | 'block';
  penalty_percent_per_day?: number;
  max_penalty_percent?: number;
}

/** Percent taken off for handing in `minutesLate` minutes late. */
export function latePenalty(policy: LatePolicy, minutesLate: number): number {
  if (minutesLate <= 0 || policy.mode !== 'penalty') return 0;
  const days = Math.ceil(minutesLate / (24 * 60));
  return Math.min(policy.max_penalty_percent ?? 100, days * (policy.penalty_percent_per_day ?? 0));
}

export interface Due {
  due_at: Date | null;
  available_until: Date | null;
  extra_attempts: number;
  extra_time_percent: number;
}

/** A student's own dates and allowances for an assessment (their extension, or their group's). */
export async function effectiveDue(assessmentId: number, studentId: number): Promise<Due> {
  const { rows } = await db.query<Due & { acc: number | null }>(
    `SELECT COALESCE(x.due_at, a.due_at) AS due_at, COALESCE(x.available_until, a.available_until) AS available_until,
            COALESCE(x.extra_attempts, 0) AS extra_attempts,
            GREATEST(COALESCE(x.extra_time_percent, 0), COALESCE(ac.extra_time_percent, 0)) AS extra_time_percent
       FROM assessments a
       LEFT JOIN LATERAL (SELECT * FROM assessment_extensions e
                           WHERE e.assessment_id = a.id AND (e.student_id = $2 OR e.group_id IN (SELECT group_id FROM group_members WHERE student_id = $2))
                           ORDER BY e.student_id NULLS LAST, e.id DESC LIMIT 1) x ON true
       LEFT JOIN accommodations ac ON ac.student_id = $2
      WHERE a.id = $1`,
    [assessmentId, studentId]
  );
  return rows[0] ?? { due_at: null, available_until: null, extra_attempts: 0, extra_time_percent: 0 };
}

export interface GradeCell {
  assessment_id: number;
  points: number | null;
  excused: boolean;
  missing: boolean;
  late_penalty_percent: number;
}
export interface AssessmentCol {
  id: number;
  category_id: number | null;
  points: number;
  due_at: Date | null;
}
export interface Category {
  id: number;
  name: string;
  weight: number;
  drop_lowest: number;
}

/** Points after the late penalty. */
export const earned = (g: GradeCell) => (g.points == null ? null : Math.max(0, g.points * (1 - (g.late_penalty_percent || 0) / 100)));

/**
 * The course percentage for one student. Excused work doesn't count; missing work counts as 0
 * once it is marked missing; ungraded work doesn't count yet. With category weights each
 * category counts by its weight (weights of categories with nothing graded are shared out);
 * without weights, all points are added up.
 */
export function coursePercent(cols: AssessmentCol[], cats: Category[], grades: Map<number, GradeCell>): number | null {
  const scored = (c: AssessmentCol) => {
    const g = grades.get(c.id);
    if (!g || g.excused || c.points <= 0) return null;
    if (g.points == null) return g.missing ? { got: 0, max: c.points } : null;
    return { got: earned(g)!, max: c.points };
  };
  const weighted = cats.some((c) => c.weight > 0);
  if (!weighted) {
    let got = 0;
    let max = 0;
    for (const c of cols) {
      const s = scored(c);
      if (s) {
        got += s.got;
        max += s.max;
      }
    }
    return max ? Math.round((got / max) * 10000) / 100 : null;
  }
  let total = 0;
  let weightUsed = 0;
  for (const cat of cats) {
    let items = cols.filter((c) => c.category_id === cat.id).map(scored).filter((s): s is { got: number; max: number } => !!s);
    if (!items.length || cat.weight <= 0) continue;
    // drop the lowest scores (by percentage), keeping at least one
    if (cat.drop_lowest > 0) items = [...items].sort((a, b) => a.got / a.max - b.got / b.max).slice(Math.min(cat.drop_lowest, items.length - 1));
    const got = items.reduce((n, s) => n + s.got, 0);
    const max = items.reduce((n, s) => n + s.max, 0);
    total += (got / max) * cat.weight;
    weightUsed += cat.weight;
  }
  // uncategorised work counts like a category with the remaining weight, if there is any
  const loose = cols.filter((c) => !c.category_id || !cats.some((k) => k.id === c.category_id)).map(scored).filter((s): s is { got: number; max: number } => !!s);
  if (loose.length) {
    const rest = Math.max(0, 100 - cats.reduce((n, c) => n + c.weight, 0));
    if (rest > 0) {
      total += (loose.reduce((n, s) => n + s.got, 0) / loose.reduce((n, s) => n + s.max, 0)) * rest;
      weightUsed += rest;
    }
  }
  return weightUsed ? Math.round((total / weightUsed) * 10000) / 100 : null;
}

/** Everything needed for a course's gradebook, optionally for some students only. */
export async function gradebookData(offeringId: number, { studentIds, releasedOnly = false }: { studentIds?: number[]; releasedOnly?: boolean } = {}) {
  const [cols, cats, grades, overrides] = await Promise.all([
    db.query<AssessmentCol & { title: string; kind: string; status: string; points: string }>(
      `SELECT id, title, kind, category_id, points, due_at, status FROM assessments
        WHERE offering_id = $1 AND status <> 'draft'
        ORDER BY due_at NULLS LAST, position, id`,
      [offeringId]
    ),
    db.query<Category & { weight: string }>(`SELECT id, name, weight, drop_lowest FROM grade_categories WHERE offering_id = $1 ORDER BY position, id`, [offeringId]),
    db.query<GradeCell & { student_id: number; status: string; points: string | null; late_penalty_percent: string; released_at: Date | null; graded_at: Date | null }>(
      `SELECT g.student_id, g.assessment_id, g.points, g.excused, g.missing, g.late_penalty_percent, g.status, g.released_at, g.graded_at
         FROM grades g JOIN assessments a ON a.id = g.assessment_id
        WHERE a.offering_id = $1 AND ($2::int[] IS NULL OR g.student_id = ANY($2::int[])) AND ($3::boolean IS FALSE OR g.status = 'released')`,
      [offeringId, studentIds ?? null, releasedOnly]
    ),
    db.query<{ student_id: number; percent: string; reason: string }>(
      `SELECT student_id, percent, reason FROM final_grade_overrides WHERE offering_id = $1 AND ($2::int[] IS NULL OR student_id = ANY($2::int[]))`,
      [offeringId, studentIds ?? null]
    ),
  ]);
  const columns = cols.rows.map((c) => ({ ...c, points: Number(c.points) }));
  const categories = cats.rows.map((c) => ({ ...c, weight: Number(c.weight) }));
  const byStudent = new Map<number, Map<number, GradeCell & { status: string }>>();
  for (const g of grades.rows) {
    const m = byStudent.get(g.student_id) ?? new Map();
    m.set(g.assessment_id, { ...g, points: g.points == null ? null : Number(g.points), late_penalty_percent: Number(g.late_penalty_percent) });
    byStudent.set(g.student_id, m);
  }
  const override = new Map(overrides.rows.map((o) => [o.student_id, { percent: Number(o.percent), reason: o.reason }]));
  return { columns, categories, byStudent, override };
}
