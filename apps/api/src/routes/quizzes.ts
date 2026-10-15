// Question banks (shared by every section of a course), quizzes built from fixed questions and
// random pools, timed attempts with per-student layouts, automatic and manual marking, the
// teacher's item analysis and regrading. Mounted under /api.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import {
  MANUAL_TYPES,
  answerBody,
  attemptEventBody,
  autoScore,
  formulaValues,
  id,
  patchSchema,
  manualGradeBody,
  parseQuestionData,
  questionBankBody,
  questionBody,
  questionPatch,
  quizItemsBody,
  regradeBody,
  studentView,
  type QuestionType,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cleanHtml } from '../lib/html';
import { effectiveDue } from '../lib/lms/gradebook';
import { completeAssessmentItems } from '../lib/lms/space';
import { softDelete } from '../lib/soft-delete';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';
import { assertGradebookOpen, assessmentFor, type AssessmentRow } from './assessments';

const router = Router();

// ---------------------------------------------------------------- banks & questions

/** Teachers of the bank's course (or course managers) may change it; any teacher a shared bank. */
async function bankFor(req: Request, bankId: number, { edit = false } = {}) {
  const { rows } = await db.query<{ id: number; course_id: number | null; created_by: number | null; name: string }>(
    `SELECT id, course_id, created_by, name FROM question_banks WHERE id = $1 AND institution_id = $2`,
    [bankId, institutionId(req)]
  );
  const bank = rows[0];
  if (!bank) throw notFound('Question bank not found');
  await assertBankAccess(req, bank.course_id, edit);
  return bank;
}

async function assertBankAccess(req: Request, courseId: number | null, _edit: boolean) {
  if (userCan(req, 'courses.manage_any')) return;
  if (!userCan(req, 'teaching.access')) throw forbidden();
  if (!courseId) return;
  const { rows } = await db.query(
    `SELECT 1 FROM section_staff ss JOIN course_offerings o ON o.id = ss.offering_id WHERE o.course_id = $1 AND ss.teacher_id = $2 LIMIT 1`,
    [courseId, currentUser(req).ref_id]
  );
  if (!rows[0]) throw forbidden('You do not teach this course');
}

router.get('/question-banks', async (req, res) => {
  if (!userCan(req, 'teaching.access') && !userCan(req, 'courses.manage_any')) throw forbidden();
  const courseId = req.query.course_id ? id.parse(req.query.course_id) : null;
  const { rows } = await db.query(
    `SELECT b.id, b.name, b.course_id, c.name AS course_name, (SELECT count(*)::int FROM questions q WHERE q.bank_id = b.id) AS questions,
            (SELECT COALESCE(array_agg(DISTINCT t), '{}') FROM questions q, unnest(q.tags) t WHERE q.bank_id = b.id) AS tags
       FROM question_banks b LEFT JOIN courses c ON c.id = b.course_id
      WHERE b.institution_id = $1 AND ($2::int IS NULL OR b.course_id = $2 OR b.course_id IS NULL) ORDER BY b.course_id NULLS LAST, b.name`,
    [institutionId(req), courseId]
  );
  res.json(rows);
});

router.post('/question-banks', async (req, res) => {
  const b = questionBankBody.parse(req.body);
  await assertBankAccess(req, b.course_id, true);
  const { rows } = await db.query(`INSERT INTO question_banks (institution_id, course_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [
    institutionId(req), b.course_id, b.name, currentUser(req).id,
  ]);
  res.status(201).json(rows[0]);
});

router.patch('/question-banks/:id', async (req, res) => {
  const bank = await bankFor(req, id.parse(req.params.id), { edit: true });
  const b = patchSchema(questionBankBody.shape).parse(req.body);
  const { rows } = await db.query(`UPDATE question_banks SET name = COALESCE($2, name) WHERE id = $1 RETURNING *`, [bank.id, b.name ?? null]);
  res.json(rows[0]);
});

router.delete('/question-banks/:id', async (req, res) => {
  const bank = await bankFor(req, id.parse(req.params.id), { edit: true });
  await softDelete('question_banks', bank.id, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

router.get('/question-banks/:id/questions', async (req, res) => {
  const bank = await bankFor(req, id.parse(req.params.id));
  const { rows } = await db.query(
    `SELECT id, type, prompt_html, data, points, difficulty, tags, updated_at FROM questions WHERE bank_id = $1 ORDER BY id`,
    [bank.id]
  );
  res.json(rows);
});

function checkedData(type: QuestionType, data: unknown) {
  const r = parseQuestionData(type, data);
  if (!r.ok) throw badRequest(r.error, { data: 'invalid' });
  return r.data;
}

router.post('/questions', async (req, res) => {
  const b = questionBody.parse(req.body);
  await bankFor(req, b.bank_id, { edit: true });
  const { rows } = await db.query(
    `INSERT INTO questions (institution_id, bank_id, type, prompt_html, data, points, difficulty, tags, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [institutionId(req), b.bank_id, b.type, cleanHtml(b.prompt_html), JSON.stringify(checkedData(b.type, b.data)), b.points, b.difficulty, b.tags, currentUser(req).id]
  );
  res.status(201).json(rows[0]);
});

async function questionFor(req: Request, qid: number) {
  const { rows } = await db.query<{ id: number; bank_id: number; type: QuestionType; data: Record<string, unknown> }>(`SELECT id, bank_id, type, data FROM questions WHERE id = $1 AND institution_id = $2`, [qid, institutionId(req)]);
  if (!rows[0]) throw notFound('Question not found');
  await bankFor(req, rows[0].bank_id, { edit: true });
  return rows[0];
}

router.patch('/questions/:id', async (req, res) => {
  const q = await questionFor(req, id.parse(req.params.id));
  const b = questionPatch.parse(req.body);
  const type = b.type ?? q.type;
  const data = b.data !== undefined || b.type ? checkedData(type, b.data ?? q.data) : null;
  const { rows } = await db.query(
    `UPDATE questions SET type = $2, prompt_html = COALESCE($3, prompt_html), data = COALESCE($4, data), points = COALESCE($5, points),
            difficulty = CASE WHEN $6 THEN $7 ELSE difficulty END, tags = COALESCE($8, tags), updated_at = now() WHERE id = $1 RETURNING *`,
    [q.id, type, b.prompt_html ? cleanHtml(b.prompt_html) : null, data ? JSON.stringify(data) : null, b.points ?? null, b.difficulty !== undefined, b.difficulty ?? null, b.tags ?? null]
  );
  res.json(rows[0]);
});

router.delete('/questions/:id', async (req, res) => {
  const q = await questionFor(req, id.parse(req.params.id));
  await softDelete('questions', q.id, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

// ---------------------------------------------------------------- what a quiz contains

router.get('/assessments/:id/questions', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'staff') throw forbidden();
  const { rows } = await db.query(
    `SELECT aq.id, aq.question_id, aq.pool_bank_id, aq.pool_tag, aq.pool_count, aq.points, aq.position,
            q.type, q.prompt_html, q.points AS question_points, b.name AS pool_bank_name
       FROM assessment_questions aq LEFT JOIN questions q ON q.id = aq.question_id LEFT JOIN question_banks b ON b.id = aq.pool_bank_id
      WHERE aq.assessment_id = $1 ORDER BY aq.position, aq.id`,
    [a.id]
  );
  res.json(rows);
});

router.put('/assessments/:id/questions', async (req, res) => {
  const { a } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  if (a.kind !== 'quiz' && a.kind !== 'exam') throw badRequest('Only quizzes and exams have questions');
  const { items } = quizItemsBody.parse(req.body);
  const { rows: started } = await db.query(`SELECT 1 FROM quiz_attempts WHERE assessment_id = $1 LIMIT 1`, [a.id]);
  if (started[0]) throw conflict('Students have started this quiz; change questions with regrade instead', 'HAS_ATTEMPTS');
  for (const it of items) {
    if ('question_id' in it) {
      const { rows } = await db.query(`SELECT bank_id FROM questions WHERE id = $1 AND institution_id = $2`, [it.question_id, institutionId(req)]);
      if (!rows[0]) throw badRequest('A question was not found', { question_id: it.question_id });
      await bankFor(req, rows[0].bank_id);
    } else {
      await bankFor(req, it.pool_bank_id);
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM questions WHERE bank_id = $1 AND ($2::text IS NULL OR $2 = ANY(tags))`, [it.pool_bank_id, it.pool_tag]);
      if (rows[0]!.n < it.pool_count) throw badRequest(`The pool has only ${rows[0]!.n} matching questions`, { pool_bank_id: it.pool_bank_id });
    }
  }
  await withTransaction(async () => {
    await db.query(`DELETE FROM assessment_questions WHERE assessment_id = $1`, [a.id]);
    for (const [i, it] of items.entries()) {
      await db.query(
        `INSERT INTO assessment_questions (institution_id, assessment_id, question_id, pool_bank_id, pool_tag, pool_count, points, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [institutionId(req), a.id, 'question_id' in it ? it.question_id : null, 'pool_bank_id' in it ? it.pool_bank_id : null, 'pool_bank_id' in it ? it.pool_tag : null, 'pool_bank_id' in it ? it.pool_count : null, it.points, i]
      );
    }
  });
  res.json({ ok: true, items: items.length });
});

// ---------------------------------------------------------------- attempts

interface LayoutItem {
  question_id: number;
  points: number;
  /** option orders etc. for this student */
  view: Record<string, unknown>;
  /** formula values for this student */
  vars?: Record<string, number>;
}
interface AttemptRow {
  id: number;
  assessment_id: number;
  student_id: number;
  attempt_no: number;
  status: string;
  started_at: Date;
  deadline_at: Date | null;
  submitted_at: Date | null;
  score: string | null;
  max_score: string;
  layout: LayoutItem[];
}

const shuffled = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

async function buildLayout(a: AssessmentRow): Promise<LayoutItem[]> {
  const settings = (a.quiz ?? {}) as { shuffle_questions?: boolean; shuffle_options?: boolean };
  const { rows: items } = await db.query<{ question_id: number | null; pool_bank_id: number | null; pool_tag: string | null; pool_count: number | null; points: string | null }>(
    `SELECT question_id, pool_bank_id, pool_tag, pool_count, points FROM assessment_questions WHERE assessment_id = $1 ORDER BY position, id`,
    [a.id]
  );
  if (!items.length) throw conflict('This quiz has no questions yet', 'NO_QUESTIONS');
  const chosen: { id: number; points: number }[] = [];
  const used = new Set<number>();
  for (const it of items) {
    if (it.question_id) {
      const { rows } = await db.query<{ id: number; points: string }>(`SELECT id, points FROM questions WHERE id = $1`, [it.question_id]);
      if (rows[0]) {
        chosen.push({ id: rows[0].id, points: Number(it.points ?? rows[0].points) });
        used.add(rows[0].id);
      }
    } else {
      const { rows } = await db.query<{ id: number; points: string }>(
        `SELECT id, points FROM questions WHERE bank_id = $1 AND ($2::text IS NULL OR $2 = ANY(tags)) AND NOT (id = ANY($3::int[])) ORDER BY random() LIMIT $4`,
        [it.pool_bank_id, it.pool_tag, [...used], it.pool_count]
      );
      for (const r of rows) {
        chosen.push({ id: r.id, points: Number(it.points ?? r.points) });
        used.add(r.id);
      }
    }
  }
  const { rows: qs } = await db.query<{ id: number; type: QuestionType; data: Record<string, unknown> }>(`SELECT id, type, data FROM questions WHERE id = ANY($1::int[])`, [[...used]]);
  const byId = new Map(qs.map((q) => [q.id, q]));
  const ordered = settings.shuffle_questions ? shuffled(chosen) : chosen;
  return ordered.map((c) => {
    const q = byId.get(c.id)!;
    const view = studentView(q.type, q.data, settings.shuffle_options === false ? (xs) => xs : shuffled);
    return { question_id: c.id, points: c.points, view, ...(q.type === 'formula' ? { vars: formulaValues(q.data, () => crypto.randomInt(1_000_000) / 1_000_000) } : {}) };
  });
}

async function loadAttempt(req: Request, attemptId: number) {
  const { rows } = await db.query<AttemptRow>(`SELECT * FROM quiz_attempts WHERE id = $1 AND institution_id = $2`, [attemptId, institutionId(req)]);
  if (!rows[0]) throw notFound('Attempt not found');
  const { a, access } = await assessmentFor(req, rows[0].assessment_id);
  if (access.role !== 'staff' && !access.studentIds.includes(rows[0].student_id)) throw forbidden();
  return { attempt: rows[0], a, access };
}

/** Score an attempt from its answers; writes the student's grade for the quiz. */
async function scoreAttempt(a: AssessmentRow, attempt: AttemptRow): Promise<{ score: number; max: number; needsMarking: boolean }> {
  const { rows: qs } = await db.query<{ id: number; type: QuestionType; data: Record<string, unknown> }>(`SELECT id, type, data FROM questions WHERE id = ANY($1::int[])`, [attempt.layout.map((l) => l.question_id)]);
  const { rows: answers } = await db.query<{ question_id: number; response: unknown; manual_points: string | null }>(`SELECT question_id, response, manual_points FROM attempt_answers WHERE attempt_id = $1`, [attempt.id]);
  let score = 0;
  let max = 0;
  let needsMarking = false;
  for (const l of attempt.layout) {
    const q = qs.find((x) => x.id === l.question_id);
    max += l.points;
    if (!q) continue;
    const ans = answers.find((x) => x.question_id === l.question_id);
    if (ans?.manual_points != null) {
      score += Number(ans.manual_points);
      continue;
    }
    const frac = autoScore(q.type, q.data, ans?.response, l.vars);
    if (frac == null) {
      if (ans && ans.response != null && ans.response !== '') needsMarking = true;
      continue;
    }
    const pts = Math.round(frac * l.points * 100) / 100;
    score += pts;
    await db.query(
      `INSERT INTO attempt_answers (institution_id, attempt_id, question_id, response, auto_points) VALUES ($1,$2,$3,NULL,$4)
       ON CONFLICT ON CONSTRAINT attempt_answers_attempt_id_question_id_key DO UPDATE SET auto_points = EXCLUDED.auto_points`,
      [a.institution_id, attempt.id, l.question_id, pts]
    );
  }
  score = Math.round(score * 100) / 100;
  await db.query(`UPDATE quiz_attempts SET score = $2, max_score = $3, status = $4 WHERE id = $1`, [attempt.id, score, max, needsMarking ? 'submitted' : 'graded']);
  await syncQuizGrade(a, attempt.student_id);
  return { score, max, needsMarking };
}

/** The gradebook entry for a quiz: highest, latest or average attempt, scaled to the quiz's points. */
async function syncQuizGrade(a: AssessmentRow, studentId: number) {
  const scoring = ((a.quiz ?? {}) as { scoring?: string }).scoring ?? 'highest';
  const { rows: done } = await db.query<{ score: string | null; max_score: string; attempt_no: number; status: string }>(
    `SELECT score, max_score, attempt_no, status FROM quiz_attempts WHERE assessment_id = $1 AND student_id = $2 AND status <> 'in_progress' ORDER BY attempt_no`,
    [a.id, studentId]
  );
  const pcts = done.filter((d) => d.score != null && Number(d.max_score) > 0).map((d) => Number(d.score) / Number(d.max_score));
  if (!pcts.length) return;
  const pct = scoring === 'average' ? pcts.reduce((n, x) => n + x, 0) / pcts.length : scoring === 'latest' ? pcts[pcts.length - 1]! : Math.max(...pcts);
  const r = { pct, pending: done.some((d) => d.status === 'submitted') };
  const points = Math.round(r.pct * Number(a.points) * 100) / 100;
  const release = a.release_mode === 'on_grading' && !r.pending;
  await db.query(
    `INSERT INTO grades (institution_id, assessment_id, student_id, points, status, graded_at, released_at, updated_at)
     VALUES ($1,$2,$3,$4,$5, now(), CASE WHEN $5 = 'released' THEN now() END, now())
     ON CONFLICT ON CONSTRAINT grades_assessment_id_student_id_key DO UPDATE SET points = EXCLUDED.points, missing = false,
       status = CASE WHEN grades.status = 'released' THEN 'released' ELSE EXCLUDED.status END, graded_at = now(),
       released_at = COALESCE(grades.released_at, EXCLUDED.released_at), updated_at = now()`,
    [a.institution_id, a.id, studentId, points, release ? 'released' : 'draft']
  );
}

/** Hand in an attempt (by the student, or automatically when time runs out). */
async function finishAttempt(a: AssessmentRow, attempt: AttemptRow) {
  if (attempt.status !== 'in_progress') return;
  await db.query(`UPDATE quiz_attempts SET status = 'submitted', submitted_at = LEAST(now(), COALESCE(deadline_at, now())) WHERE id = $1`, [attempt.id]);
  attempt.status = 'submitted';
  await scoreAttempt(a, attempt);
  await completeAssessmentItems(a.institution_id, a.id, [attempt.student_id], 'submit');
}

const GRACE_MS = 30_000;
const expired = (t: AttemptRow) => t.status === 'in_progress' && t.deadline_at && t.deadline_at.getTime() + GRACE_MS < Date.now();

router.post('/assessments/:id/attempts', requirePermission('submissions.create'), async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'student') throw forbidden('Only students take quizzes');
  if (a.kind !== 'quiz' && a.kind !== 'exam') throw badRequest('This is not a quiz');
  if (a.status !== 'published') throw conflict('This quiz is closed', 'CLOSED');
  const sid = access.studentIds[0]!;
  const now = new Date();
  if (a.available_from && a.available_from > now) throw conflict('This quiz has not opened yet', 'NOT_OPEN');
  const due = await effectiveDue(a.id, sid);
  if (due.available_until && due.available_until < now) throw conflict('This quiz has closed', 'CLOSED');
  if (due.due_at && due.due_at < now && a.late_policy.mode === 'block') throw conflict('The due date has passed', 'LATE_BLOCKED');
  const out = await withTransaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock($1, $2)`, [a.id, sid]);
    const { rows: prev } = await db.query<AttemptRow>(`SELECT * FROM quiz_attempts WHERE assessment_id = $1 AND student_id = $2 ORDER BY attempt_no DESC`, [a.id, sid]);
    const open = prev.find((p) => p.status === 'in_progress');
    if (open && !expired(open)) return open;
    if (open) await finishAttempt(a, open);
    const allowed = a.allowed_attempts == null ? null : a.allowed_attempts + due.extra_attempts;
    if (allowed != null && prev.length >= allowed) throw conflict(allowed === 1 ? 'You have already taken this quiz' : `You have used all ${allowed} attempts`, 'NO_ATTEMPTS_LEFT');
    const layout = await buildLayout(a);
    const limit = ((a.quiz ?? {}) as { time_limit_minutes?: number | null }).time_limit_minutes;
    let deadline = limit ? new Date(now.getTime() + limit * 60_000 * (1 + due.extra_time_percent / 100)) : null;
    if (due.available_until && (!deadline || due.available_until < deadline)) deadline = due.available_until;
    const { rows } = await db.query<AttemptRow>(
      `INSERT INTO quiz_attempts (institution_id, assessment_id, student_id, attempt_no, deadline_at, max_score, layout, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [institutionId(req), a.id, sid, (prev[0]?.attempt_no ?? 0) + 1, deadline, layout.reduce((n, l) => n + l.points, 0), JSON.stringify(layout), req.ip ?? null]
    );
    return rows[0]!;
  });
  res.status(201).json({ id: out.id, attempt_no: out.attempt_no, deadline_at: out.deadline_at });
});

/** When the student may see right answers. */
function resultsVisible(a: AssessmentRow, attempt: AttemptRow, releasedGrade: boolean): boolean {
  const when = ((a.quiz ?? {}) as { show_results?: string }).show_results ?? 'after_release';
  if (attempt.status === 'in_progress') return false;
  if (when === 'after_submit') return true;
  if (when === 'after_due') return !!a.due_at && a.due_at < new Date();
  if (when === 'after_release') return releasedGrade;
  return false;
}

router.get('/attempts/:id', async (req, res) => {
  const { attempt, a, access } = await loadAttempt(req, id.parse(req.params.id));
  if (expired(attempt)) await withTransaction(() => finishAttempt(a, attempt));
  const { rows: qs } = await db.query<{ id: number; type: QuestionType; prompt_html: string; data: Record<string, unknown> }>(
    `SELECT id, type, prompt_html, data FROM questions WHERE id = ANY($1::int[])`,
    [attempt.layout.map((l) => l.question_id)]
  );
  const { rows: answers } = await db.query<{ question_id: number; response: unknown; auto_points: string | null; manual_points: string | null; feedback: string }>(
    `SELECT question_id, response, auto_points, manual_points, feedback FROM attempt_answers WHERE attempt_id = $1`,
    [attempt.id]
  );
  const { rows: g } = await db.query(`SELECT 1 FROM grades WHERE assessment_id = $1 AND student_id = $2 AND status = 'released'`, [a.id, attempt.student_id]);
  const staff = access.role === 'staff';
  const show = staff || resultsVisible(a, attempt, !!g[0]);
  const fill = (html: string, vars?: Record<string, number>) => (vars ? html.replace(/\{([a-z]\w{0,9})\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : html);
  res.json({
    id: attempt.id,
    assessment_id: a.id,
    title: a.title,
    attempt_no: attempt.attempt_no,
    status: attempt.status,
    started_at: attempt.started_at,
    deadline_at: attempt.deadline_at,
    submitted_at: attempt.submitted_at,
    one_at_a_time: ((a.quiz ?? {}) as { one_at_a_time?: boolean }).one_at_a_time ?? false,
    score: show || attempt.status === 'graded' ? attempt.score : null,
    max_score: attempt.max_score,
    questions: attempt.layout.map((l, i) => {
      const q = qs.find((x) => x.id === l.question_id);
      const ans = answers.find((x) => x.question_id === l.question_id);
      return {
        n: i + 1,
        question_id: l.question_id,
        type: q?.type,
        prompt_html: fill(q?.prompt_html ?? '', l.vars),
        points: l.points,
        view: l.view,
        response: ans?.response ?? null,
        ...(show && q
          ? { earned: ans?.manual_points != null ? Number(ans.manual_points) : ans?.auto_points != null ? Number(ans.auto_points) : null, feedback: ans?.feedback ?? '', answer: q.data }
          : {}),
      };
    }),
  });
});

router.put('/attempts/:id/answers', requirePermission('submissions.create'), async (req, res) => {
  const { attempt, a, access } = await loadAttempt(req, id.parse(req.params.id));
  if (access.role !== 'student') throw forbidden();
  if (attempt.status !== 'in_progress') throw conflict('This attempt has been handed in', 'SUBMITTED');
  if (expired(attempt)) {
    await withTransaction(() => finishAttempt(a, attempt));
    throw conflict('Time is up — your answers so far were handed in', 'TIME_UP');
  }
  const b = answerBody.parse(req.body);
  if (!attempt.layout.some((l) => l.question_id === b.question_id)) throw badRequest('That question is not in this attempt');
  const raw = JSON.stringify(b.response ?? null);
  if (raw.length > 100_000) throw badRequest('The answer is too long');
  // file answers must be the student's own uploads
  const fileIds = (b.response as { file_ids?: unknown } | null)?.file_ids;
  if (Array.isArray(fileIds) && fileIds.length) {
    const { rows } = await db.query(`SELECT count(*)::int n FROM files WHERE id = ANY($1::int[]) AND created_by = $2`, [fileIds.map(Number), currentUser(req).id]);
    if (rows[0].n !== fileIds.length) throw badRequest('Upload the files first');
  }
  await db.query(
    `INSERT INTO attempt_answers (institution_id, attempt_id, question_id, response, updated_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT ON CONSTRAINT attempt_answers_attempt_id_question_id_key DO UPDATE SET response = EXCLUDED.response, updated_at = now()`,
    [institutionId(req), attempt.id, b.question_id, raw]
  );
  res.json({ ok: true, saved_at: new Date() });
});

router.post('/attempts/:id/events', async (req, res) => {
  const { attempt, access } = await loadAttempt(req, id.parse(req.params.id));
  if (access.role !== 'student' || attempt.status !== 'in_progress') return void res.status(204).end();
  const b = attemptEventBody.parse(req.body);
  await db.query(`INSERT INTO attempt_events (institution_id, attempt_id, kind, data) VALUES ($1,$2,$3,$4)`, [institutionId(req), attempt.id, b.kind, b.data ? JSON.stringify(b.data) : null]);
  res.status(204).end();
});

router.post('/attempts/:id/submit', requirePermission('submissions.create'), async (req, res) => {
  const { attempt, a, access } = await loadAttempt(req, id.parse(req.params.id));
  if (access.role !== 'student') throw forbidden();
  if (attempt.status !== 'in_progress') throw conflict('This attempt has already been handed in', 'SUBMITTED');
  await withTransaction(() => finishAttempt(a, attempt));
  const { rows } = await db.query(`SELECT status, score, max_score FROM quiz_attempts WHERE id = $1`, [attempt.id]);
  const show = resultsVisible(a, { ...attempt, status: rows[0].status }, false);
  res.json({ status: rows[0].status, ...(show ? { score: rows[0].score, max_score: rows[0].max_score } : {}) });
});

// ---------------------------------------------------------------- staff: attempts, marking, analysis

router.get('/assessments/:id/attempts', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'staff') throw forbidden();
  const { rows } = await db.query(
    `SELECT q.id, q.student_id, st.first_name || ' ' || st.last_name AS name, q.attempt_no, q.status, q.started_at, q.submitted_at, q.score, q.max_score,
            (SELECT count(*)::int FROM attempt_events e WHERE e.attempt_id = q.id) AS integrity_events
       FROM quiz_attempts q JOIN students st ON st.id = q.student_id WHERE q.assessment_id = $1 ORDER BY st.first_name, q.attempt_no`,
    [a.id]
  );
  res.json(rows);
});

router.get('/attempts/:id/events', async (req, res) => {
  const { attempt, access } = await loadAttempt(req, id.parse(req.params.id));
  if (access.role !== 'staff') throw forbidden();
  const { rows } = await db.query(`SELECT kind, at, data FROM attempt_events WHERE attempt_id = $1 ORDER BY at`, [attempt.id]);
  res.json(rows);
});

router.put('/attempts/:id/grades', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const { attempt, a, access } = await loadAttempt(req, id.parse(req.params.id));
  if (access.role !== 'staff' || !access.canEdit) throw forbidden();
  assertGradebookOpen(access);
  if (attempt.status === 'in_progress') throw conflict('The student is still answering', 'IN_PROGRESS');
  const b = manualGradeBody.parse(req.body);
  await withTransaction(async () => {
    for (const ans of b.answers) {
      const l = attempt.layout.find((x) => x.question_id === ans.question_id);
      if (!l) throw badRequest('That question is not in this attempt', { question_id: ans.question_id });
      if (ans.points > l.points) throw badRequest(`At most ${l.points} points for question ${ans.question_id}`);
      await db.query(
        `INSERT INTO attempt_answers (institution_id, attempt_id, question_id, manual_points, feedback, graded_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ON CONSTRAINT attempt_answers_attempt_id_question_id_key DO UPDATE SET manual_points = EXCLUDED.manual_points, feedback = EXCLUDED.feedback, graded_by = EXCLUDED.graded_by, updated_at = now()`,
        [institutionId(req), attempt.id, ans.question_id, ans.points, ans.feedback, currentUser(req).id]
      );
    }
    await scoreAttempt(a, attempt);
  });
  const { rows } = await db.query(`SELECT status, score, max_score FROM quiz_attempts WHERE id = $1`, [attempt.id]);
  res.json(rows[0]);
});

/** Item analysis: how hard each question was and how well it separates strong from weak students. */
router.get('/assessments/:id/item-analysis', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'staff') throw forbidden();
  const { rows: attempts } = await db.query<{ id: number; score: string; max_score: string; layout: LayoutItem[] }>(
    `SELECT id, score, max_score, layout FROM quiz_attempts WHERE assessment_id = $1 AND status <> 'in_progress' AND score IS NOT NULL`,
    [a.id]
  );
  const { rows: answers } = await db.query<{ attempt_id: number; question_id: number; response: unknown; pts: number | null }>(
    `SELECT aa.attempt_id, aa.question_id, aa.response, COALESCE(aa.manual_points, aa.auto_points)::float AS pts
       FROM attempt_answers aa JOIN quiz_attempts q ON q.id = aa.attempt_id WHERE q.assessment_id = $1 AND q.status <> 'in_progress'`,
    [a.id]
  );
  const qids = [...new Set(attempts.flatMap((t) => t.layout.map((l) => l.question_id)))];
  const { rows: qs } = await db.query<{ id: number; type: string; prompt_html: string; data: { options?: { id: string; text: string }[] } }>(
    `SELECT id, type, prompt_html, data FROM questions WHERE id = ANY($1::int[])`,
    [qids]
  );
  const totals = new Map(attempts.map((t) => [t.id, Number(t.score) / (Number(t.max_score) || 1)]));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);
  const items = qs.map((q) => {
    const seen = attempts.filter((t) => t.layout.some((l) => l.question_id === q.id));
    const pairs = seen.map((t) => {
      const l = t.layout.find((x) => x.question_id === q.id)!;
      const ans = answers.find((x) => x.attempt_id === t.id && x.question_id === q.id);
      return { item: ans?.pts != null ? ans.pts / (l.points || 1) : 0, total: totals.get(t.id) ?? 0, response: ans?.response };
    });
    const mi = mean(pairs.map((p) => p.item));
    const mt = mean(pairs.map((p) => p.total));
    const cov = mean(pairs.map((p) => (p.item - mi) * (p.total - mt)));
    const sd = (xs: number[], m: number) => Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
    const si = sd(pairs.map((p) => p.item), mi);
    const st = sd(pairs.map((p) => p.total), mt);
    const options = q.data.options?.map((o) => ({ id: o.id, text: o.text, chosen: pairs.filter((p) => p.response === o.id || (Array.isArray(p.response) && p.response.includes(o.id))).length }));
    return {
      question_id: q.id,
      type: q.type,
      prompt_html: q.prompt_html,
      answered: pairs.length,
      /** share of available points earned (difficulty index: low = hard) */
      facility: Math.round(mi * 100) / 100,
      /** correlation with the total score (low or negative = check the question) */
      discrimination: si && st ? Math.round((cov / (si * st)) * 100) / 100 : null,
      options,
    };
  });
  res.json({ attempts: attempts.length, mean_percent: Math.round(mean([...totals.values()]) * 1000) / 10, items });
});

/** Fix a question after the fact: score every attempt again, or give everyone full marks for it. */
router.post('/assessments/:id/regrade', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  assertGradebookOpen(access);
  const b = regradeBody.parse(req.body);
  const { rows: attempts } = await db.query<AttemptRow>(`SELECT * FROM quiz_attempts WHERE assessment_id = $1 AND status <> 'in_progress'`, [a.id]);
  const affected = attempts.filter((t) => t.layout.some((l) => l.question_id === b.question_id));
  const { rows: qs } = await db.query<{ type: QuestionType }>(`SELECT type FROM questions WHERE id = $1`, [b.question_id]);
  if (!qs[0]) throw notFound('Question not found');
  await withTransaction(async () => {
    for (const t of affected) {
      const l = t.layout.find((x) => x.question_id === b.question_id)!;
      if (b.mode === 'full_credit') {
        await db.query(
          `INSERT INTO attempt_answers (institution_id, attempt_id, question_id, manual_points, feedback, graded_by) VALUES ($1,$2,$3,$4,'Full marks given on regrade',$5)
           ON CONFLICT ON CONSTRAINT attempt_answers_attempt_id_question_id_key DO UPDATE SET manual_points = EXCLUDED.manual_points, feedback = EXCLUDED.feedback, graded_by = EXCLUDED.graded_by, updated_at = now()`,
          [institutionId(req), t.id, b.question_id, l.points, currentUser(req).id]
        );
      } else if (!MANUAL_TYPES.includes(qs[0]!.type)) {
        await db.query(`UPDATE attempt_answers SET manual_points = NULL WHERE attempt_id = $1 AND question_id = $2`, [t.id, b.question_id]);
      }
      await scoreAttempt(a, t);
    }
  });
  res.json({ regraded: affected.length });
});

export default router;
