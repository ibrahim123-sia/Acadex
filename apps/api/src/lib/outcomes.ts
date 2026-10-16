// Outcome-based education: how well students attain course outcomes (CLOs), measured by
// whatever is aligned to each CLO — whole assessments, quiz questions, rubric criteria or
// paper exams (weighted) — and, through the CLO → PLO mapping, program outcomes (PLOs).
// A student attains an outcome at its pass percentage; a class meets it when the share of
// students who attain it reaches the target.
import { db } from '../db/context';
import { rosterSql } from './lms/access';

export interface CloRow {
  id: number;
  code: string;
  description: string;
  course_id: number;
  pass_percent: string;
  target_percent: string;
  bloom_level: string | null;
}

export interface OutcomeAttainment {
  outcome_id: number;
  code: string;
  description: string;
  students: number;
  attained: number;
  attainment_percent: number | null;
  average_percent: number | null;
  target_percent: number;
  met: boolean | null;
  per_student: { student_id: number; percent: number; attained: boolean }[];
}

/** Each student's percentage on each CLO of an offering's course. */
export async function cloScores(offeringId: number, cloIds: number[], releasedOnly: boolean) {
  if (!cloIds.length) return [] as { clo_id: number; student_id: number; percent: number }[];
  const { rows } = await db.query<{ clo_id: number; student_id: number; e: string; m: string }>(
    `WITH al AS (SELECT * FROM outcome_alignments WHERE clo_id = ANY($2::int[])),
          roster AS (${rosterSql('$1')}),
          a AS (SELECT al.clo_id, g.student_id, g.points AS earned, x.points AS max, al.weight
                  FROM al JOIN assessments x ON al.target_type = 'assessment' AND x.id = al.target_id AND x.offering_id = $1 AND x.deleted_at IS NULL
                  JOIN grades g ON g.assessment_id = x.id AND g.points IS NOT NULL AND NOT g.excused AND (NOT $3 OR g.status = 'released')),
          qn AS (SELECT al.clo_id, qa.student_id, max(COALESCE(aa.manual_points, aa.auto_points)) AS earned, max((l->>'points')::numeric) AS max, al.weight
                  FROM al JOIN attempt_answers aa ON al.target_type = 'question' AND aa.question_id = al.target_id
                  JOIN quiz_attempts qa ON qa.id = aa.attempt_id AND qa.status <> 'in_progress'
                  JOIN assessments x ON x.id = qa.assessment_id AND x.offering_id = $1
                  CROSS JOIN LATERAL jsonb_array_elements(qa.layout) l
                 WHERE (l->>'question_id')::int = al.target_id AND COALESCE(aa.manual_points, aa.auto_points) IS NOT NULL
                   AND (NOT $3 OR EXISTS (SELECT 1 FROM grades g WHERE g.assessment_id = x.id AND g.student_id = qa.student_id AND g.status = 'released'))
                 GROUP BY al.clo_id, qa.student_id, al.weight),
          cr AS (SELECT al.clo_id, g.student_id, (g.rubric_scores->(al.target_id::text)->>'points')::numeric AS earned,
                        (SELECT max((lv->>'points')::numeric) FROM jsonb_array_elements(c.levels) lv) AS max, al.weight
                  FROM al JOIN rubric_criteria c ON al.target_type = 'criterion' AND c.id = al.target_id
                  JOIN assessments x ON x.rubric_id = c.rubric_id AND x.offering_id = $1 AND x.deleted_at IS NULL
                  JOIN grades g ON g.assessment_id = x.id AND g.rubric_scores ? (al.target_id::text) AND (NOT $3 OR g.status = 'released')),
          ex AS (SELECT al.clo_id, m.student_id, CASE WHEN m.absent THEN 0 ELSE LEAST(s.total_marks, m.marks + m.adjustment) END AS earned, s.total_marks AS max, al.weight
                  FROM al JOIN exam_sessions s ON al.target_type = 'exam_session' AND s.id = al.target_id AND s.offering_id = $1
                  JOIN exam_series x ON x.id = s.series_id AND (NOT $3 OR x.status = 'published')
                  JOIN exam_marks m ON m.session_id = s.id AND (m.absent OR m.marks IS NOT NULL))
     SELECT clo_id, student_id, sum(earned * weight) AS e, sum(max * weight) AS m
       FROM (SELECT * FROM a UNION ALL SELECT * FROM qn UNION ALL SELECT * FROM cr UNION ALL SELECT * FROM ex) x
      WHERE student_id IN (SELECT id FROM roster)
      GROUP BY clo_id, student_id`,
    [offeringId, cloIds, releasedOnly]
  );
  return rows.filter((r) => Number(r.m) > 0).map((r) => ({ clo_id: r.clo_id, student_id: r.student_id, percent: Math.round((Number(r.e) / Number(r.m)) * 10000) / 100 }));
}

export function summarize(o: { id: number; code: string; description: string; pass_percent: string | number; target_percent: string | number }, scores: { student_id: number; percent: number }[]): OutcomeAttainment {
  const pass = Number(o.pass_percent);
  const per = scores.map((s) => ({ student_id: s.student_id, percent: s.percent, attained: s.percent >= pass }));
  const attained = per.filter((p) => p.attained).length;
  const pct = per.length ? Math.round((attained / per.length) * 10000) / 100 : null;
  return {
    outcome_id: o.id,
    code: o.code,
    description: o.description,
    students: per.length,
    attained,
    attainment_percent: pct,
    average_percent: per.length ? Math.round((per.reduce((n, p) => n + p.percent, 0) / per.length) * 100) / 100 : null,
    target_percent: Number(o.target_percent),
    met: pct == null ? null : pct >= Number(o.target_percent),
    per_student: per,
  };
}

/** CLO attainment for one offering (a class of a course). */
export async function offeringAttainment(offeringId: number, releasedOnly = false) {
  const { rows: clos } = await db.query<CloRow>(
    `SELECT lo.id, lo.code, lo.description, lo.course_id, lo.pass_percent, lo.target_percent, lo.bloom_level FROM learning_outcomes lo JOIN course_offerings o ON o.course_id = lo.course_id
      WHERE o.id = $1 AND lo.level = 'course' ORDER BY lo.position, lo.code`,
    [offeringId]
  );
  const scores = await cloScores(offeringId, clos.map((c) => c.id), releasedOnly);
  return clos.map((c) => ({ ...summarize(c, scores.filter((s) => s.clo_id === c.id)), bloom_level: c.bloom_level }));
}

/**
 * PLO attainment for a program (optionally one term): each student's PLO percentage is the
 * mean of their CLO percentages on mapped CLOs, weighted by the mapping strength.
 */
export async function programAttainment(programId: number, termId: number | null, releasedOnly = false) {
  const { rows: plos } = await db.query<{ id: number; code: string; description: string; pass_percent: string; target_percent: string }>(
    `SELECT id, code, description, pass_percent, target_percent FROM learning_outcomes WHERE program_id = $1 AND level = 'program' ORDER BY position, code`,
    [programId]
  );
  const { rows: maps } = await db.query<{ clo_id: number; plo_id: number; strength: number }>(
    `SELECT m.clo_id, m.plo_id, m.strength FROM outcome_mappings m JOIN learning_outcomes p ON p.id = m.plo_id WHERE p.program_id = $1`,
    [programId]
  );
  const { rows: offerings } = await db.query<{ id: number; course_id: number; course: string; section_name: string | null }>(
    `SELECT o.id, o.course_id, co.name AS course, sec.name AS section_name FROM course_offerings o JOIN courses co ON co.id = o.course_id
       JOIN sections sec ON sec.id = o.section_id JOIN program_levels pl ON pl.id = sec.program_level_id
      WHERE pl.program_id = $1 AND ($2::int IS NULL OR o.term_id = $2) ORDER BY co.name`,
    [programId, termId]
  );
  const cloIds = [...new Set(maps.map((m) => m.clo_id))];
  const all: { clo_id: number; student_id: number; percent: number }[] = [];
  const courses: { offering_id: number; course: string; section_name: string | null; clos: OutcomeAttainment[] }[] = [];
  for (const o of offerings) {
    const att = await offeringAttainment(o.id, releasedOnly);
    if (att.length) courses.push({ offering_id: o.id, course: o.course, section_name: o.section_name, clos: att.map(({ per_student: _p, ...r }) => ({ ...r, per_student: [] })) });
    for (const a of att) if (cloIds.includes(a.outcome_id)) all.push(...a.per_student.map((p) => ({ clo_id: a.outcome_id, student_id: p.student_id, percent: p.percent })));
  }
  const result = plos.map((p) => {
    const mine = maps.filter((m) => m.plo_id === p.id);
    const byStudent = new Map<number, { w: number; s: number }>();
    for (const sc of all) {
      const m = mine.find((x) => x.clo_id === sc.clo_id);
      if (!m) continue;
      const cur = byStudent.get(sc.student_id) ?? { w: 0, s: 0 };
      cur.w += m.strength;
      cur.s += sc.percent * m.strength;
      byStudent.set(sc.student_id, cur);
    }
    const scores = [...byStudent.entries()].map(([student_id, v]) => ({ student_id, percent: Math.round((v.s / v.w) * 100) / 100 }));
    return { ...summarize(p, scores), clos: mine.length };
  });
  return { plos: result, courses };
}
