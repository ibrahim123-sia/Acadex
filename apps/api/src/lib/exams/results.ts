// Results of an exam series: every student's marks per paper (after moderation), totals,
// percentage, grade with their own grading scheme, pass / fail, and position in the class
// (board style) or grade points and SGPA weighted by credit hours (university style).
import crypto from 'node:crypto';
import { gpa, gradeFor, type GradingScheme } from '@acadex/shared';
import { db } from '../../db/context';
import { schemeForStudent } from '../grading';
import { rosterSql } from '../lms/access';
import { notFound } from '../errors';

export interface PaperResult {
  session_id: number;
  offering_id: number;
  course: string;
  code: string | null;
  credits: number | null;
  total: number;
  pass: number;
  marks: number | null;
  absent: boolean;
  obtained: number;
  passed: boolean;
  grade: string;
  points: number | null;
}

export interface StudentResult {
  student_id: number;
  name: string;
  roll_no: string | null;
  section_id: number | null;
  section_name: string | null;
  program_level_id: number | null;
  papers: PaperResult[];
  obtained: number;
  total: number;
  percent: number;
  grade: string;
  passed: boolean;
  gpa: number | null;
  position: number | null;
}

export async function loadSeries(seriesId: number, institutionId: number) {
  const { rows } = await db.query(`SELECT * FROM exam_series WHERE id = $1 AND institution_id = $2`, [seriesId, institutionId]);
  if (!rows[0]) throw notFound('Exam series not found');
  return rows[0] as { id: number; institution_id: number; name: string; kind: string; result_style: 'board' | 'university'; status: string; term_id: number | null; eligibility: { attendance: boolean; fees: boolean }; published_at: Date | null };
}

/** Students sitting each paper of a series (the course roster). */
export async function seriesRoster(seriesId: number) {
  const { rows } = await db.query<{ session_id: number; student_id: number }>(
    `SELECT s.id AS session_id, r.id AS student_id FROM exam_sessions s CROSS JOIN LATERAL (${rosterSql('s.offering_id')}) r WHERE s.series_id = $1`,
    [seriesId]
  );
  return rows;
}

export async function computeResults(seriesId: number, institutionId: number, opts: { studentIds?: number[] } = {}): Promise<StudentResult[]> {
  const series = await loadSeries(seriesId, institutionId);
  const { rows: papers } = await db.query<{ id: number; offering_id: number; course: string; code: string | null; credits: string | null; total_marks: string; pass_marks: string }>(
    `SELECT s.id, s.offering_id, co.name AS course, co.code, co.credit_hours AS credits, s.total_marks, s.pass_marks
       FROM exam_sessions s JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
      WHERE s.series_id = $1 ORDER BY s.date, s.starts_at, co.name`,
    [seriesId]
  );
  const roster = await seriesRoster(seriesId);
  const ids = [...new Set(roster.map((r) => r.student_id))].filter((s) => !opts.studentIds || opts.studentIds.includes(s));
  if (!ids.length) return [];
  const { rows: students } = await db.query<{ id: number; name: string; roll_no: string | null; section_id: number | null; section_name: string | null; program_level_id: number | null }>(
    `SELECT st.id, st.first_name || ' ' || st.last_name AS name, st.roll_no, st.section_id, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name, sec.program_level_id
       FROM students st LEFT JOIN sections sec ON sec.id = st.section_id WHERE st.id = ANY($1::int[]) ORDER BY st.roll_no NULLS LAST, st.first_name`,
    [ids]
  );
  const { rows: marks } = await db.query<{ session_id: number; student_id: number; marks: string | null; absent: boolean; adjustment: string }>(
    `SELECT m.session_id, m.student_id, m.marks, m.absent, m.adjustment FROM exam_marks m JOIN exam_sessions s ON s.id = m.session_id WHERE s.series_id = $1 AND m.student_id = ANY($2::int[])`,
    [seriesId, ids]
  );
  const schemes = new Map<number, GradingScheme>();
  const out: StudentResult[] = [];
  for (const st of students) {
    const scheme = schemes.get(st.id) ?? (await schemeForStudent(st.id, institutionId));
    schemes.set(st.id, scheme);
    const mine = papers.filter((p) => roster.some((r) => r.session_id === p.id && r.student_id === st.id));
    const rows: PaperResult[] = mine.map((p) => {
      const m = marks.find((x) => x.session_id === p.id && x.student_id === st.id);
      const total = Number(p.total_marks);
      const obtained = m && !m.absent && m.marks != null ? Math.min(total, Math.max(0, Number(m.marks) + Number(m.adjustment))) : 0;
      const g = gradeFor(scheme, total ? (obtained / total) * 100 : 0);
      return {
        session_id: p.id,
        offering_id: p.offering_id,
        course: p.course,
        code: p.code,
        credits: p.credits == null ? null : Number(p.credits),
        total,
        pass: Number(p.pass_marks),
        marks: m?.marks == null ? null : Number(m.marks),
        absent: !!m?.absent,
        obtained: Math.round(obtained * 100) / 100,
        passed: !!m && !m.absent && obtained >= Number(p.pass_marks),
        grade: m?.absent ? 'ABS' : g.label,
        points: m?.absent ? 0 : g.points,
      };
    });
    const obtained = rows.reduce((n, r) => n + r.obtained, 0);
    const total = rows.reduce((n, r) => n + r.total, 0);
    const percent = total ? Math.round((obtained / total) * 10000) / 100 : 0;
    out.push({
      ...st,
      student_id: st.id,
      papers: rows,
      obtained: Math.round(obtained * 100) / 100,
      total,
      percent,
      grade: gradeFor(scheme, percent).label,
      passed: rows.length > 0 && rows.every((r) => r.passed),
      gpa: series.result_style === 'university' ? gpa({ ...scheme, kind: 'gpa' }, rows.map((r) => ({ percent: r.total ? (r.obtained / r.total) * 100 : 0, credits: r.credits }))) : null,
      position: null,
    });
  }
  // positions within each class (ties share a position), passing students first
  const bySection = new Map<number | null, StudentResult[]>();
  for (const r of out) bySection.set(r.section_id, [...(bySection.get(r.section_id) ?? []), r]);
  for (const list of bySection.values()) rank(list);
  return out;
}

/** Give positions by percentage (passed before failed); equal percentages share a position. */
export function rank(list: StudentResult[], key: 'position' = 'position') {
  const sorted = [...list].sort((a, b) => Number(b.passed) - Number(a.passed) || b.percent - a.percent);
  let pos = 0;
  let prev: StudentResult | null = null;
  sorted.forEach((r, i) => {
    if (!prev || prev.percent !== r.percent || prev.passed !== r.passed) pos = i + 1;
    r[key] = pos;
    prev = r;
  });
  return sorted;
}

export const verifyCode = () => crypto.randomBytes(10).toString('hex').toUpperCase().slice(0, 12);
