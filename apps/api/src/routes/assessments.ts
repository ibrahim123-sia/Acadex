// Assessments of a course (assignments, quizzes, exams, projects, participation): setting them,
// extensions and accommodations, hand-in (versioned, by student or group), grading with rubrics,
// annotations and feedback, draft vs released grades, peer review, rubrics and groups.
// Mounted under /api.
import { Router, type Request } from 'express';
import {
  accommodationBody,
  annotationBody,
  assessmentBody,
  assessmentPatch,
  bulkGradesBody,
  extensionBody,
  groupSetBody,
  groupsBody,
  id,
  peerReviewBody,
  releaseBody,
  rubricBody,
  submitBody,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cleanHtml, htmlToText } from '../lib/html';
import { institutionTimeZone } from '../lib/institution';
import { assertCourseEditor, assertCourseMember, guardianUserIds, rosterSql, rosterUserIds, staffUserIds, type CourseAccess } from '../lib/lms/access';
import { effectiveDue, latePenalty, type LatePolicy } from '../lib/lms/gradebook';
import { completeAssessmentItems } from '../lib/lms/space';
import { todayIn } from '../lib/locale';
import { notify } from '../lib/notify';
import { softDelete } from '../lib/soft-delete';
import { assertOpenDay, nextOpenDay } from '../lib/structure';
import { HttpError } from '../lib/errors';
import { publicSecure, staffSecure, type SecureSettings } from '../lib/lms/secure';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';

const router = Router();

export interface AssessmentRow {
  id: number;
  institution_id: number;
  offering_id: number;
  category_id: number | null;
  kind: string;
  title: string;
  instructions_html: string;
  points: string;
  available_from: Date | null;
  due_at: Date | null;
  available_until: Date | null;
  status: string;
  submission_types: string[];
  allowed_attempts: number | null;
  late_policy: LatePolicy;
  group_set_id: number | null;
  peer_review: { reviews_per_student: number; due_at: string | null; anonymous: boolean } | null;
  rubric_id: number | null;
  ai_policy: string;
  quiz: Record<string, unknown> | null;
  secure: SecureSettings | null;
  release_mode: string;
  grades_released_at: Date | null;
}

export async function loadAssessment(req: Request, assessmentId: number): Promise<AssessmentRow> {
  const { rows } = await db.query<AssessmentRow>(`SELECT * FROM assessments WHERE id = $1 AND institution_id = $2`, [assessmentId, institutionId(req)]);
  if (!rows[0]) throw notFound('Not found');
  return rows[0];
}

/** The assessment and the caller's access to its course; students never see drafts. */
export async function assessmentFor(req: Request, assessmentId: number, { edit = false } = {}) {
  const a = await loadAssessment(req, assessmentId);
  const access = edit ? await assertCourseEditor(req, a.offering_id) : await assertCourseMember(req, a.offering_id);
  if (access.role !== 'staff' && a.status === 'draft') throw notFound('Not found');
  return { a, access };
}

/** Grade changes are refused once the course gradebook is locked. */
export function assertGradebookOpen(access: CourseAccess) {
  if (access.course.gradebook_locked_at) throw conflict('The gradebook of this course is locked (results are published)', 'GRADEBOOK_LOCKED');
}

async function assertCourseRefs(offeringId: number, b: { category_id?: number | null; rubric_id?: number | null; group_set_id?: number | null }) {
  if (b.category_id) {
    const { rows } = await db.query(`SELECT 1 FROM grade_categories WHERE id = $1 AND offering_id = $2`, [b.category_id, offeringId]);
    if (!rows[0]) throw badRequest('That grade category is not part of this course', { category_id: 'invalid' });
  }
  if (b.rubric_id) {
    const { rows } = await db.query(`SELECT 1 FROM rubrics WHERE id = $1 AND (offering_id = $2 OR offering_id IS NULL)`, [b.rubric_id, offeringId]);
    if (!rows[0]) throw badRequest('That rubric is not available in this course', { rubric_id: 'invalid' });
  }
  if (b.group_set_id) {
    const { rows } = await db.query(`SELECT 1 FROM group_sets WHERE id = $1 AND offering_id = $2`, [b.group_set_id, offeringId]);
    if (!rows[0]) throw badRequest('That group set is not part of this course', { group_set_id: 'invalid' });
  }
}

/** A due date on a holiday or a closed day is refused, with the next open day suggested. */
async function assertDueOnOpenDay(access: CourseAccess, dueAt: Date | null) {
  if (!dueAt) return;
  const s = access.course.institution_id;
  const day = todayIn(await institutionTimeZone(s), dueAt);
  try {
    await assertOpenDay(s, access.course.campus_id, day, 'a due date');
  } catch (e) {
    if (e instanceof HttpError) e.details = { ...(e.details as object), suggested_date: await nextOpenDay(s, access.course.campus_id, day) };
    throw e;
  }
}

async function announceNewWork(a: { id: number; institution_id: number; offering_id: number; title: string; due_at: Date | null; kind: string }, courseName: string) {
  await notify({
    institutionId: a.institution_id,
    userIds: await rosterUserIds(a.offering_id),
    type: 'assignment_posted',
    title: `New ${a.kind === 'quiz' ? 'quiz' : 'work'} in ${courseName}: ${a.title}`,
    message: a.due_at ? `Due ${a.due_at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '',
    link: `/learn/courses/${a.offering_id}/work/${a.id}`,
    dedupeKey: `posted:${a.id}`,
  });
}

// ---------------------------------------------------------------- set work

router.get('/courses/:id/assessments', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const access = await assertCourseMember(req, offeringId);
  if (access.role === 'staff') {
    const { rows } = await db.query(
      `SELECT a.id, a.kind, a.title, a.points, a.due_at, a.status, a.category_id, c.name AS category, a.group_set_id, a.release_mode, a.grades_released_at,
              (SELECT count(*)::int FROM (${rosterSql('$1')}) r) AS students,
              (SELECT count(*)::int FROM submissions s WHERE s.assessment_id = a.id AND s.status <> 'draft')
                + (SELECT count(DISTINCT q.student_id)::int FROM quiz_attempts q WHERE q.assessment_id = a.id AND q.status <> 'in_progress') AS submitted,
              (SELECT count(*)::int FROM grades g WHERE g.assessment_id = a.id AND (g.points IS NOT NULL OR g.excused)) AS graded,
              (SELECT count(*)::int FROM grades g WHERE g.assessment_id = a.id AND g.status = 'draft' AND g.points IS NOT NULL) AS unreleased
         FROM assessments a LEFT JOIN grade_categories c ON c.id = a.category_id
        WHERE a.offering_id = $1 ORDER BY a.due_at NULLS LAST, a.position, a.id`,
      [offeringId]
    );
    return void res.json(rows);
  }
  const sid = Number(req.query.student_id) || access.studentIds[0]!;
  if (!access.studentIds.includes(sid)) throw forbidden();
  const { rows } = await db.query(
    `SELECT a.id, a.kind, a.title, a.points, a.status, a.category_id, c.name AS category,
            COALESCE(x.due_at, a.due_at) AS due_at, COALESCE(x.available_until, a.available_until) AS available_until, a.available_from,
            (SELECT s.status FROM submissions s WHERE s.assessment_id = a.id AND s.status <> 'draft'
               AND (s.student_id = $2 OR s.group_id IN (SELECT group_id FROM group_members WHERE student_id = $2)) ORDER BY s.attempt DESC LIMIT 1) AS submission_status,
            (SELECT count(*)::int FROM quiz_attempts q WHERE q.assessment_id = a.id AND q.student_id = $2 AND q.status <> 'in_progress') AS attempts,
            g.points AS score, g.excused, g.missing, g.late_penalty_percent
       FROM assessments a LEFT JOIN grade_categories c ON c.id = a.category_id
       LEFT JOIN LATERAL (SELECT e.due_at, e.available_until FROM assessment_extensions e WHERE e.assessment_id = a.id AND e.student_id = $2 LIMIT 1) x ON true
       LEFT JOIN grades g ON g.assessment_id = a.id AND g.student_id = $2 AND g.status = 'released'
      WHERE a.offering_id = $1 AND a.status <> 'draft' ORDER BY COALESCE(x.due_at, a.due_at) NULLS LAST, a.position, a.id`,
    [offeringId, sid]
  );
  res.json(rows);
});

router.post('/courses/:id/assessments', requireAny('assignments.manage', 'courses.manage_any'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const access = await assertCourseEditor(req, offeringId);
  const b = assessmentBody.parse(req.body);
  await assertCourseRefs(offeringId, b);
  await assertDueOnOpenDay(access, b.due_at);
  if (b.due_at && b.available_from && b.due_at < b.available_from) throw badRequest('The due date is before the work opens', { due_at: 'invalid' });
  const quiz = b.kind === 'quiz' ? (b.quiz ?? { time_limit_minutes: null, shuffle_questions: false, shuffle_options: true, one_at_a_time: false, show_results: 'after_release', scoring: 'highest' }) : b.quiz;
  const created = await withTransaction(async () => {
    const { rows } = await db.query<AssessmentRow>(
      `INSERT INTO assessments (institution_id, offering_id, category_id, kind, title, instructions_html, points, available_from, due_at, available_until, status,
                                submission_types, allowed_attempts, late_policy, group_set_id, peer_review, rubric_id, ai_policy, quiz, release_mode, created_by, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, (SELECT COALESCE(max(position) + 1, 0) FROM assessments WHERE offering_id = $2))
       RETURNING *`,
      [
        institutionId(req), offeringId, b.category_id, b.kind, b.title, cleanHtml(b.instructions_html), b.points, b.available_from, b.due_at, b.available_until, b.status,
        b.kind === 'quiz' ? ['none'] : b.submission_types, b.allowed_attempts, JSON.stringify(b.late_policy), b.group_set_id,
        b.peer_review ? JSON.stringify(b.peer_review) : null, b.rubric_id, b.ai_policy, quiz ? JSON.stringify(quiz) : null, b.release_mode, currentUser(req).id,
      ]
    );
    const a = rows[0]!;
    if (b.module_id) {
      const { rows: m } = await db.query(`SELECT 1 FROM modules WHERE id = $1 AND offering_id = $2`, [b.module_id, offeringId]);
      if (!m[0]) throw badRequest('That module is not part of this course', { module_id: 'invalid' });
      await db.query(
        `INSERT INTO content_items (institution_id, module_id, kind, title, assessment_id, completion, position)
         VALUES ($1, $2, 'assessment', $3, $4, 'submit', (SELECT COALESCE(max(position) + 1, 0) FROM content_items WHERE module_id = $2))`,
        [institutionId(req), b.module_id, b.title, a.id]
      );
    }
    return a;
  });
  if (created.status === 'published') await announceNewWork(created, access.course.name);
  res.status(201).json(created);
});

router.get('/assessments/:id', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  const { rows: rubric } = a.rubric_id
    ? await db.query(`SELECT r.id, r.title, COALESCE((SELECT json_agg(c ORDER BY c.position, c.id) FROM rubric_criteria c WHERE c.rubric_id = r.id), '[]') AS criteria FROM rubrics r WHERE r.id = $1`, [a.rubric_id])
    : { rows: [] };
  const base = { ...a, secure: access.role === 'staff' ? staffSecure(a.secure) : publicSecure(a.secure), course: { id: access.course.id, name: access.course.name, section_name: access.course.section_name }, role: access.role, can_edit: access.canEdit, rubric: rubric[0] ?? null };
  if (access.role === 'staff') {
    const { rows: ext } = await db.query(
      `SELECT e.*, st.first_name || ' ' || st.last_name AS student_name, g.name AS group_name FROM assessment_extensions e
         LEFT JOIN students st ON st.id = e.student_id LEFT JOIN student_groups g ON g.id = e.group_id WHERE e.assessment_id = $1 ORDER BY e.id`,
      [a.id]
    );
    return void res.json({ ...base, extensions: ext });
  }
  const sid = Number(req.query.student_id) || access.studentIds[0]!;
  if (!access.studentIds.includes(sid)) throw forbidden();
  const due = await effectiveDue(a.id, sid);
  const { rows: grade } = await db.query(
    `SELECT points, excused, missing, late_penalty_percent, feedback_html, feedback_file_ids, rubric_scores, released_at FROM grades WHERE assessment_id = $1 AND student_id = $2 AND status = 'released'`,
    [a.id, sid]
  );
  res.json({ ...base, quiz: a.quiz, my: { ...due, attempts_allowed: a.allowed_attempts == null ? null : a.allowed_attempts + due.extra_attempts }, grade: grade[0] ?? null });
});

router.patch('/assessments/:id', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  const b = assessmentPatch.parse(req.body);
  await assertCourseRefs(a.offering_id, b);
  if (b.due_at !== undefined && b.due_at?.getTime() !== a.due_at?.getTime()) await assertDueOnOpenDay(access, b.due_at);
  if (b.points !== undefined && Number(a.points) !== b.points) assertGradebookOpen(access);
  const sets: string[] = [];
  const vals: unknown[] = [a.id];
  const json = new Set(['late_policy', 'peer_review', 'quiz']);
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    vals.push(k === 'instructions_html' ? cleanHtml(v as string) : json.has(k) && v !== null ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) throw badRequest('Nothing to change');
  const { rows } = await db.query<AssessmentRow>(`UPDATE assessments SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals);
  if (b.title) await db.query(`UPDATE content_items SET title = $2 WHERE assessment_id = $1`, [a.id, b.title]);
  if (a.status === 'draft' && rows[0]!.status === 'published') await announceNewWork(rows[0]!, access.course.name);
  res.json({ ...rows[0], secure: staffSecure(rows[0]!.secure) });
});

router.delete('/assessments/:id', async (req, res) => {
  const { a } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  const { rows } = await db.query(`SELECT count(*)::int n FROM grades WHERE assessment_id = $1 AND status = 'released'`, [a.id]);
  if (rows[0].n && req.query.force !== 'true') throw conflict('Students already have released grades for this. Delete anyway with force=true.', 'HAS_GRADES', { grades: rows[0].n });
  await softDelete('assessments', a.id, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

// ---------------------------------------------------------------- extensions & accommodations

router.post('/assessments/:id/extensions', async (req, res) => {
  const { a } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  const b = extensionBody.parse(req.body);
  if (b.student_id) {
    const { rows } = await db.query(`SELECT 1 FROM (${rosterSql('$1')}) r WHERE r.id = $2`, [a.offering_id, b.student_id]);
    if (!rows[0]) throw badRequest('This student is not in the course', { student_id: 'invalid' });
  }
  if (b.group_id) {
    const { rows } = await db.query(`SELECT 1 FROM student_groups g JOIN group_sets gs ON gs.id = g.group_set_id WHERE g.id = $1 AND gs.offering_id = $2`, [b.group_id, a.offering_id]);
    if (!rows[0]) throw badRequest('This group is not in the course', { group_id: 'invalid' });
  }
  const { rows } = await db.query(
    `INSERT INTO assessment_extensions (institution_id, assessment_id, student_id, group_id, due_at, available_until, extra_attempts, extra_time_percent, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT ON CONSTRAINT assessment_extensions_assessment_id_student_id_group_id_key
     DO UPDATE SET due_at = EXCLUDED.due_at, available_until = EXCLUDED.available_until, extra_attempts = EXCLUDED.extra_attempts,
                   extra_time_percent = EXCLUDED.extra_time_percent, reason = EXCLUDED.reason
     RETURNING *`,
    [institutionId(req), a.id, b.student_id, b.group_id, b.due_at, b.available_until, b.extra_attempts, b.extra_time_percent, b.reason, currentUser(req).id]
  );
  res.status(201).json(rows[0]);
});

router.delete('/assessments/:id/extensions/:extId', async (req, res) => {
  const { a } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  const { rowCount } = await db.query(`DELETE FROM assessment_extensions WHERE id = $1 AND assessment_id = $2`, [id.parse(req.params.extId), a.id]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

router.get('/students/:id/accommodations', requirePermission('students.manage'), async (req, res) => {
  const sid = id.parse(req.params.id);
  await assertInInstitution('students', sid, institutionId(req));
  const { rows } = await db.query(`SELECT extra_time_percent, notes, updated_at FROM accommodations WHERE student_id = $1`, [sid]);
  res.json(rows[0] ?? { extra_time_percent: 0, notes: '', updated_at: null });
});

router.put('/students/:id/accommodations', requirePermission('students.manage'), async (req, res) => {
  const sid = id.parse(req.params.id);
  await assertInInstitution('students', sid, institutionId(req));
  const b = accommodationBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO accommodations (student_id, institution_id, extra_time_percent, notes, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (student_id) DO UPDATE SET extra_time_percent = EXCLUDED.extra_time_percent, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING extra_time_percent, notes, updated_at`,
    [sid, institutionId(req), b.extra_time_percent, b.notes, currentUser(req).id]
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------------- hand-in

/** The group a student belongs to for a group assessment (or null for individual work). */
async function groupOf(a: AssessmentRow, studentId: number): Promise<number | null> {
  if (!a.group_set_id) return null;
  const { rows } = await db.query<{ group_id: number }>(`SELECT group_id FROM group_members WHERE group_set_id = $1 AND student_id = $2`, [a.group_set_id, studentId]);
  if (!rows[0]) throw conflict('This is group work and you are not in a group yet. Ask your teacher (or join one).', 'NO_GROUP');
  return rows[0].group_id;
}

router.post('/assessments/:id/submission', requirePermission('submissions.create'), async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'student') throw forbidden('Only students hand in work');
  if (a.kind === 'quiz') throw badRequest('Quizzes are answered by starting an attempt');
  if (a.status !== 'published') throw conflict('This is closed for hand-in', 'CLOSED');
  if (a.submission_types.includes('none')) throw badRequest('Nothing is handed in online for this');
  const b = submitBody.parse(req.body);
  const sid = access.studentIds[0]!;
  const u = currentUser(req);
  const now = new Date();
  if (a.available_from && a.available_from > now) throw conflict('This is not open yet', 'NOT_OPEN');
  const due = await effectiveDue(a.id, sid);
  if (due.available_until && due.available_until < now) throw conflict('The hand-in period has ended', 'CLOSED');
  const minutesLate = due.due_at && now > due.due_at ? Math.ceil((now.getTime() - due.due_at.getTime()) / 60000) : 0;
  if (b.submit && minutesLate > 0 && a.late_policy.mode === 'block') throw conflict('The due date has passed and late work is not accepted', 'LATE_BLOCKED');
  if (b.file_ids.length) {
    if (!a.submission_types.includes('file') && !a.submission_types.includes('audio') && !a.submission_types.includes('video')) throw badRequest('Files are not accepted for this');
    const { rows } = await db.query(`SELECT count(*)::int n FROM files WHERE id = ANY($1::int[]) AND created_by = $2 AND purpose = 'submission'`, [b.file_ids, u.id]);
    if (rows[0].n !== new Set(b.file_ids).size) throw badRequest('Upload the files first (as your own submission files)', { file_ids: 'invalid' });
  }
  if (b.link_url && !a.submission_types.includes('link')) throw badRequest('Links are not accepted for this');
  if (b.submit && !b.text_html.trim() && !b.link_url && !b.file_ids.length) throw badRequest('Add your work before handing it in');
  const groupId = await groupOf(a, sid);
  const owner = groupId ? { col: 'group_id', val: groupId } : { col: 'student_id', val: sid };

  const result = await withTransaction(async () => {
    // one hand-in at a time per student / group
    await db.query(`SELECT pg_advisory_xact_lock($1, $2)`, [a.id, groupId ? -groupId : sid]);
    const { rows: subs } = await db.query<{ id: number; attempt: number; status: string }>(
      `SELECT id, attempt, status FROM submissions WHERE assessment_id = $1 AND ${owner.col} = $2 ORDER BY attempt DESC`,
      [a.id, owner.val]
    );
    const handedIn = subs.filter((s) => s.status !== 'draft').length;
    let sub = subs.find((s) => s.status === 'draft');
    if (!sub) {
      const allowed = a.allowed_attempts == null ? null : a.allowed_attempts + due.extra_attempts;
      if (allowed != null && handedIn >= allowed) throw conflict(allowed === 1 ? 'You have already handed this in' : `You have used all ${allowed} attempts`, 'NO_ATTEMPTS_LEFT');
      const { rows } = await db.query<{ id: number; attempt: number; status: string }>(
        `INSERT INTO submissions (institution_id, assessment_id, student_id, group_id, attempt, status, submitted_by) VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING id, attempt, status`,
        [institutionId(req), a.id, groupId ? null : sid, groupId, (subs[0]?.attempt ?? 0) + 1, u.id]
      );
      sub = rows[0]!;
    }
    const { rows: v } = await db.query<{ version: number }>(
      `INSERT INTO submission_versions (institution_id, submission_id, version, text_html, link_url, file_ids, created_by)
       VALUES ($1, $2, (SELECT COALESCE(max(version), 0) + 1 FROM submission_versions WHERE submission_id = $2), $3, $4, $5, $6) RETURNING version`,
      [institutionId(req), sub.id, cleanHtml(b.text_html), b.link_url, b.file_ids, u.id]
    );
    if (b.submit) {
      await db.query(`UPDATE submissions SET status = 'submitted', submitted_at = now(), late = $2, minutes_late = $3, submitted_by = $4, updated_at = now() WHERE id = $1`, [
        sub.id,
        minutesLate > 0,
        minutesLate,
        u.id,
      ]);
    } else await db.query(`UPDATE submissions SET updated_at = now() WHERE id = $1`, [sub.id]);
    return { submission_id: sub.id, attempt: sub.attempt, version: v[0]!.version, status: b.submit ? 'submitted' : 'draft', late: minutesLate > 0, minutes_late: minutesLate };
  });
  if (b.submit) {
    const members = groupId ? (await db.query<{ student_id: number }>(`SELECT student_id FROM group_members WHERE group_id = $1`, [groupId])).rows.map((r) => r.student_id) : [sid];
    await completeAssessmentItems(institutionId(req), a.id, members, 'submit');
    await notify({
      institutionId: institutionId(req),
      userIds: await staffUserIds(a.offering_id),
      type: 'submission_received',
      title: `${u.name} handed in ${a.title}${minutesLate > 0 ? ' (late)' : ''}`,
      link: `/teach/courses/${a.offering_id}/work/${a.id}/grade?student=${sid}`,
    });
  }
  res.status(b.submit ? 201 : 200).json(result);
});

const VERSIONS_SQL = `COALESCE((SELECT json_agg(json_build_object('id', v.id, 'version', v.version, 'text_html', v.text_html, 'link_url', v.link_url,
    'file_ids', v.file_ids, 'created_at', v.created_at,
    'files', (SELECT COALESCE(json_agg(json_build_object('id', f.id, 'name', f.original_name, 'type', f.content_type, 'size', f.size_bytes)), '[]') FROM files f WHERE f.id = ANY(v.file_ids)))
    ORDER BY v.version) FROM submission_versions v WHERE v.submission_id = s.id), '[]')`;

/** A student's own hand-ins (every attempt, every saved version) and reviews of them. */
router.get('/assessments/:id/submission', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role === 'staff') throw badRequest('Use the submissions list');
  const sid = Number(req.query.student_id) || access.studentIds[0]!;
  if (!access.studentIds.includes(sid)) throw forbidden();
  const { rows } = await db.query(
    `SELECT s.id, s.attempt, s.status, s.submitted_at, s.late, s.minutes_late, s.group_id, ${VERSIONS_SQL} AS versions
       FROM submissions s WHERE s.assessment_id = $1 AND (s.student_id = $2 OR s.group_id IN (SELECT group_id FROM group_members WHERE student_id = $2))
      ORDER BY s.attempt`,
    [a.id, sid]
  );
  const anonymous = a.peer_review?.anonymous ?? true;
  const { rows: reviews } = await db.query(
    `SELECT p.id, p.rubric_scores, p.comments, p.submitted_at, ${anonymous ? `NULL` : `st.first_name || ' ' || st.last_name`} AS reviewer
       FROM peer_reviews p JOIN submissions s ON s.id = p.submission_id JOIN students st ON st.id = p.reviewer_student_id
      WHERE p.assessment_id = $1 AND p.submitted_at IS NOT NULL AND (s.student_id = $2 OR s.group_id IN (SELECT group_id FROM group_members WHERE student_id = $2))`,
    [a.id, sid]
  );
  res.json({ submissions: rows, peer_reviews: reviews });
});

/** Staff: every student with their latest hand-in and grade (the grading list). */
router.get('/assessments/:id/submissions', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'staff') throw forbidden();
  const { rows } = await db.query(
    `SELECT st.id AS student_id, st.first_name || ' ' || st.last_name AS name, st.roll_no, gm.group_id, grp.name AS group_name,
            s.id AS submission_id, s.attempt, s.status AS submission_status, s.submitted_at, s.late, s.minutes_late,
            g.points, g.excused, g.missing, g.status AS grade_status, g.late_penalty_percent, g.released_at,
            (SELECT COALESCE(x.due_at, NULL) FROM assessment_extensions x WHERE x.assessment_id = $2 AND x.student_id = st.id LIMIT 1) AS extended_due_at
       FROM students st
       LEFT JOIN group_members gm ON gm.group_set_id = $3 AND gm.student_id = st.id
       LEFT JOIN student_groups grp ON grp.id = gm.group_id
       LEFT JOIN LATERAL (SELECT * FROM submissions s WHERE s.assessment_id = $2 AND s.status <> 'draft' AND (s.student_id = st.id OR s.group_id = gm.group_id)
                           ORDER BY s.attempt DESC LIMIT 1) s ON true
       LEFT JOIN grades g ON g.assessment_id = $2 AND g.student_id = st.id
      WHERE st.id IN (${rosterSql('$1')}) ORDER BY grp.name NULLS LAST, st.roll_no NULLS LAST, st.first_name`,
    [a.offering_id, a.id, a.group_set_id ?? 0]
  );
  res.json(rows);
});

/** One hand-in with every version and the teacher's annotations (staff, or its owners). */
router.get('/submissions/:id', async (req, res) => {
  const subId = id.parse(req.params.id);
  const { rows } = await db.query<{ id: number; assessment_id: number; student_id: number | null; group_id: number | null }>(
    `SELECT id, assessment_id, student_id, group_id FROM submissions WHERE id = $1 AND institution_id = $2`,
    [subId, institutionId(req)]
  );
  const sub = rows[0];
  if (!sub) throw notFound();
  const { access } = await assessmentFor(req, sub.assessment_id);
  if (access.role !== 'staff') {
    const mine = sub.student_id ? access.studentIds.includes(sub.student_id) : (await db.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND student_id = ANY($2::int[])`, [sub.group_id, access.studentIds])).rows[0];
    if (!mine) throw forbidden();
  }
  const { rows: full } = await db.query(
    `SELECT s.*, ${VERSIONS_SQL} AS versions,
            COALESCE((SELECT json_agg(n ORDER BY n.id) FROM submission_annotations n JOIN submission_versions v ON v.id = n.version_id WHERE v.submission_id = s.id), '[]') AS annotations
       FROM submissions s WHERE s.id = $1`,
    [subId]
  );
  res.json(full[0]);
});

router.post('/submissions/:id/versions/:versionId/annotations', async (req, res) => {
  const subId = id.parse(req.params.id);
  const versionId = id.parse(req.params.versionId);
  const { rows } = await db.query<{ assessment_id: number }>(
    `SELECT s.assessment_id FROM submissions s JOIN submission_versions v ON v.submission_id = s.id WHERE s.id = $1 AND v.id = $2 AND s.institution_id = $3`,
    [subId, versionId, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  await assessmentFor(req, rows[0].assessment_id, { edit: true });
  const b = annotationBody.parse(req.body);
  if (b.file_id) {
    const { rows: f } = await db.query(`SELECT 1 FROM submission_versions WHERE id = $1 AND $2 = ANY(file_ids)`, [versionId, b.file_id]);
    if (!f[0]) throw badRequest('That file is not part of this version', { file_id: 'invalid' });
  }
  const { rows: out } = await db.query(
    `INSERT INTO submission_annotations (institution_id, version_id, file_id, page, shape, comment, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [institutionId(req), versionId, b.file_id, b.page, JSON.stringify(b.shape), b.comment, currentUser(req).id]
  );
  res.status(201).json(out[0]);
});

router.delete('/annotations/:id', async (req, res) => {
  const annId = id.parse(req.params.id);
  const { rows } = await db.query<{ assessment_id: number }>(
    `SELECT s.assessment_id FROM submission_annotations n JOIN submission_versions v ON v.id = n.version_id JOIN submissions s ON s.id = v.submission_id WHERE n.id = $1 AND n.institution_id = $2`,
    [annId, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  await assessmentFor(req, rows[0].assessment_id, { edit: true });
  await db.query(`DELETE FROM submission_annotations WHERE id = $1`, [annId]);
  res.status(204).end();
});

// ---------------------------------------------------------------- grading

/** Points from rubric scores (the sum of the chosen levels). */
async function rubricTotal(rubricId: number, scores: Record<string, { points: number }>): Promise<number> {
  const { rows } = await db.query<{ id: number; max: number }>(
    `SELECT id, (SELECT max((l->>'points')::numeric) FROM jsonb_array_elements(levels) l)::float AS max FROM rubric_criteria WHERE rubric_id = $1`,
    [rubricId]
  );
  let total = 0;
  for (const [cid, s] of Object.entries(scores)) {
    const c = rows.find((r) => r.id === Number(cid));
    if (!c) throw badRequest('The rubric scores name a criterion this rubric does not have', { rubric_scores: cid });
    if (s.points > c.max) throw badRequest('A rubric score is above the criterion maximum', { rubric_scores: cid });
    total += s.points;
  }
  return total;
}

router.put('/assessments/:id/grades', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  assertGradebookOpen(access);
  const { grades } = bulkGradesBody.parse(req.body);
  const ids = grades.map((g) => g.student_id);
  if (new Set(ids).size !== ids.length) throw badRequest('The same student appears more than once');
  const { rows: onRoster } = await db.query<{ id: number }>(`SELECT id FROM (${rosterSql('$1')}) r WHERE r.id = ANY($2::int[])`, [a.offering_id, ids]);
  const missing = ids.filter((x) => !onRoster.some((r) => r.id === x));
  if (missing.length) throw badRequest('Some students are not in this course', { student_ids: missing });
  const max = Number(a.points);
  const u = currentUser(req);
  const release = a.release_mode === 'on_grading';
  const out = await withTransaction(async () => {
    const saved: number[] = [];
    for (const g of grades) {
      let points = g.points;
      if (g.rubric_scores && a.rubric_id) {
        const total = await rubricTotal(a.rubric_id, g.rubric_scores);
        if (points == null) points = total;
      }
      if (points != null && points > max * 2) throw badRequest(`A score above twice the maximum (${max}) looks like a typo`, { student_id: g.student_id });
      // the late penalty follows the latest hand-in
      const { rows: sub } = await db.query<{ minutes_late: number }>(
        `SELECT s.minutes_late FROM submissions s WHERE s.assessment_id = $1 AND s.status <> 'draft'
            AND (s.student_id = $2 OR s.group_id IN (SELECT group_id FROM group_members WHERE student_id = $2)) ORDER BY s.attempt DESC LIMIT 1`,
        [a.id, g.student_id]
      );
      const penalty = latePenalty(a.late_policy, sub[0]?.minutes_late ?? 0);
      const { rows: prev } = await db.query<{ id: number; points: string | null; excused: boolean; status: string }>(
        `SELECT id, points, excused, status FROM grades WHERE assessment_id = $1 AND student_id = $2 FOR UPDATE`,
        [a.id, g.student_id]
      );
      const p = prev[0];
      const changed = p && (Number(p.points ?? -1) !== (points ?? -1) || p.excused !== g.excused);
      if (p && p.status === 'released' && changed && !g.reason) throw badRequest('Say why a released grade is changing (it is kept in the grade history)', { student_id: g.student_id, reason: 'required' });
      if (p && changed) {
        await db.query(`INSERT INTO grade_history (institution_id, grade_id, points, excused, status, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
          institutionId(req), p.id, p.points, p.excused, p.status, g.reason, u.id,
        ]);
      }
      const status = release || p?.status === 'released' ? 'released' : 'draft';
      await db.query(
        `INSERT INTO grades (institution_id, assessment_id, student_id, points, excused, missing, late_penalty_percent, feedback_html, feedback_file_ids, rubric_scores, status, graded_by, graded_at, released_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11, now(), CASE WHEN $10 = 'released' THEN now() END, now())
         ON CONFLICT ON CONSTRAINT grades_assessment_id_student_id_key DO UPDATE SET
           points = EXCLUDED.points, excused = EXCLUDED.excused, missing = false, late_penalty_percent = EXCLUDED.late_penalty_percent,
           feedback_html = EXCLUDED.feedback_html, feedback_file_ids = EXCLUDED.feedback_file_ids, rubric_scores = EXCLUDED.rubric_scores,
           status = EXCLUDED.status, graded_by = EXCLUDED.graded_by, graded_at = now(), released_at = COALESCE(grades.released_at, EXCLUDED.released_at), updated_at = now()`,
        [institutionId(req), a.id, g.student_id, points, g.excused, penalty, cleanHtml(g.feedback_html), g.feedback_file_ids, g.rubric_scores ? JSON.stringify(g.rubric_scores) : null, status, u.id]
      );
      saved.push(g.student_id);
    }
    return saved;
  });
  if (release) await afterRelease(a, out);
  res.json({ saved: out.length, released: release });
});

/** Tell students (and guardians) about released grades, and tick off "pass" items. */
async function afterRelease(a: AssessmentRow, studentIds: number[]) {
  if (!studentIds.length) return;
  await db.query(`UPDATE submissions SET status = 'returned' WHERE assessment_id = $1 AND status = 'submitted' AND (student_id = ANY($2::int[]) OR group_id IN (SELECT group_id FROM group_members WHERE student_id = ANY($2::int[])))`, [a.id, studentIds]);
  const { rows: passed } = await db.query<{ student_id: number }>(
    `SELECT student_id FROM grades WHERE assessment_id = $1 AND student_id = ANY($2::int[]) AND points IS NOT NULL AND points * (1 - late_penalty_percent / 100) >= $3 * 0.5`,
    [a.id, studentIds, Number(a.points)]
  );
  await completeAssessmentItems(a.institution_id, a.id, passed.map((p) => p.student_id), 'pass');
  const users = await rosterUserIds(a.offering_id, studentIds);
  await notify({ institutionId: a.institution_id, userIds: users, type: 'grade_released', title: `Grade ready: ${a.title}`, message: 'Your grade and feedback are ready.', link: `/learn/courses/${a.offering_id}/work/${a.id}` });
  await notify({ institutionId: a.institution_id, userIds: await guardianUserIds(studentIds), type: 'grade_released', title: `New grade: ${a.title}`, link: `/family` });
}

router.post('/assessments/:id/release', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  assertGradebookOpen(access);
  const { student_ids } = releaseBody.parse(req.body ?? {});
  const { rows } = await db.query<{ student_id: number }>(
    `UPDATE grades SET status = 'released', released_at = now(), updated_at = now()
      WHERE assessment_id = $1 AND status = 'draft' AND (points IS NOT NULL OR excused OR missing) AND ($2::int[] IS NULL OR student_id = ANY($2::int[]))
      RETURNING student_id`,
    [a.id, student_ids ?? null]
  );
  if (!student_ids) await db.query(`UPDATE assessments SET grades_released_at = now() WHERE id = $1`, [a.id]);
  await afterRelease(a, rows.map((r) => r.student_id));
  res.json({ released: rows.length });
});

/** Mark everyone who hasn't handed in (after the due date) as missing — it counts as zero. */
router.post('/assessments/:id/mark-missing', requireAny('grades.enter', 'courses.manage_any'), async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  assertGradebookOpen(access);
  const { rows } = await db.query<{ student_id: number }>(
    `INSERT INTO grades (institution_id, assessment_id, student_id, missing, status, graded_by, graded_at)
     SELECT $1, $2, r.id, true, 'draft', $4, now() FROM (${rosterSql('$3')}) r
      WHERE NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assessment_id = $2 AND s.status <> 'draft' AND (s.student_id = r.id OR s.group_id IN (SELECT group_id FROM group_members WHERE student_id = r.id)))
        AND NOT EXISTS (SELECT 1 FROM quiz_attempts q WHERE q.assessment_id = $2 AND q.student_id = r.id AND q.status <> 'in_progress')
        AND COALESCE((SELECT x.due_at FROM assessment_extensions x WHERE x.assessment_id = $2 AND x.student_id = r.id LIMIT 1), $5) < now()
     ON CONFLICT ON CONSTRAINT grades_assessment_id_student_id_key DO UPDATE SET missing = true WHERE grades.points IS NULL AND NOT grades.excused
     RETURNING student_id`,
    [institutionId(req), a.id, a.offering_id, currentUser(req).id, a.due_at ?? new Date(8.64e15)]
  );
  res.json({ marked: rows.length });
});

router.get('/assessments/:id/grades/:studentId/history', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'staff') throw forbidden();
  const { rows } = await db.query(
    `SELECT h.points, h.excused, h.status, h.reason, h.changed_at, u.full_name AS changed_by FROM grade_history h JOIN grades g ON g.id = h.grade_id
       LEFT JOIN users u ON u.id = h.changed_by WHERE g.assessment_id = $1 AND g.student_id = $2 ORDER BY h.changed_at DESC`,
    [a.id, id.parse(req.params.studentId)]
  );
  res.json(rows);
});

/** Staff: one student's grade with feedback (drafts included). */
router.get('/assessments/:id/grades/:studentId', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role !== 'staff') throw forbidden();
  const { rows } = await db.query(`SELECT * FROM grades WHERE assessment_id = $1 AND student_id = $2`, [a.id, id.parse(req.params.studentId)]);
  res.json(rows[0] ?? null);
});

// ---------------------------------------------------------------- peer review

router.post('/assessments/:id/peer-reviews/assign', async (req, res) => {
  const { a } = await assessmentFor(req, id.parse(req.params.id), { edit: true });
  if (!a.peer_review) throw badRequest('Turn on peer review for this assessment first');
  const n = a.peer_review.reviews_per_student;
  const { rows: subs } = await db.query<{ id: number; student_id: number | null; group_id: number | null }>(
    `SELECT DISTINCT ON (COALESCE(student_id, -group_id)) id, student_id, group_id FROM submissions WHERE assessment_id = $1 AND status <> 'draft' ORDER BY COALESCE(student_id, -group_id), attempt DESC`,
    [a.id]
  );
  if (subs.length < 2) throw conflict('At least two hand-ins are needed for peer review', 'TOO_FEW');
  // reviewers: the authors (each member for group work), shuffled; each reviews the next n hand-ins round the circle
  const authors = await Promise.all(
    subs.map(async (s) => (s.student_id ? [s.student_id] : (await db.query<{ student_id: number }>(`SELECT student_id FROM group_members WHERE group_id = $1`, [s.group_id])).rows.map((r) => r.student_id)))
  );
  const order = subs.map((_, i) => i).sort(() => Math.random() - 0.5);
  let created = 0;
  await withTransaction(async () => {
    for (let k = 0; k < order.length; k++) {
      const mine = order[k]!;
      for (let j = 1; j <= Math.min(n, order.length - 1); j++) {
        const target = subs[order[(k + j) % order.length]!]!;
        for (const reviewer of authors[mine]!) {
          const r = await db.query(
            `INSERT INTO peer_reviews (institution_id, assessment_id, submission_id, reviewer_student_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [institutionId(req), a.id, target.id, reviewer]
          );
          created += r.rowCount ?? 0;
        }
      }
    }
  });
  res.json({ assigned: created });
});

router.get('/assessments/:id/peer-reviews', async (req, res) => {
  const { a, access } = await assessmentFor(req, id.parse(req.params.id));
  if (access.role === 'staff') {
    const { rows } = await db.query(
      `SELECT p.id, p.submission_id, p.reviewer_student_id, st.first_name || ' ' || st.last_name AS reviewer, p.rubric_scores, p.comments, p.submitted_at
         FROM peer_reviews p JOIN students st ON st.id = p.reviewer_student_id WHERE p.assessment_id = $1 ORDER BY p.submission_id, p.id`,
      [a.id]
    );
    return void res.json(rows);
  }
  if (access.role !== 'student') throw forbidden();
  const { rows } = await db.query(
    `SELECT p.id, p.submission_id, p.rubric_scores, p.comments, p.submitted_at,
            (SELECT json_build_object('text_html', v.text_html, 'link_url', v.link_url, 'file_ids', v.file_ids) FROM submission_versions v WHERE v.submission_id = p.submission_id ORDER BY v.version DESC LIMIT 1) AS work
       FROM peer_reviews p WHERE p.assessment_id = $1 AND p.reviewer_student_id = $2 ORDER BY p.id`,
    [a.id, access.studentIds[0]]
  );
  res.json(rows);
});

router.put('/peer-reviews/:id', requirePermission('submissions.create'), async (req, res) => {
  const reviewId = id.parse(req.params.id);
  const { rows } = await db.query<{ assessment_id: number; reviewer_student_id: number }>(
    `SELECT assessment_id, reviewer_student_id FROM peer_reviews WHERE id = $1 AND institution_id = $2`,
    [reviewId, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  const { a, access } = await assessmentFor(req, rows[0].assessment_id);
  if (access.role !== 'student' || access.studentIds[0] !== rows[0].reviewer_student_id) throw forbidden();
  if (a.peer_review?.due_at && new Date(a.peer_review.due_at) < new Date()) throw conflict('Peer review has closed', 'CLOSED');
  const b = peerReviewBody.parse(req.body);
  await db.query(`UPDATE peer_reviews SET rubric_scores = $2, comments = $3, submitted_at = now() WHERE id = $1`, [reviewId, b.rubric_scores ? JSON.stringify(b.rubric_scores) : null, htmlToText(b.comments, 10_000)]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- rubrics

router.get('/rubrics', async (req, res) => {
  const offeringId = req.query.offering_id ? id.parse(req.query.offering_id) : null;
  if (offeringId) await assertCourseEditor(req, offeringId);
  else if (!userCan(req, 'teaching.access') && !userCan(req, 'courses.manage_any')) throw forbidden();
  const { rows } = await db.query(
    `SELECT r.id, r.title, r.offering_id, COALESCE((SELECT json_agg(c ORDER BY c.position, c.id) FROM rubric_criteria c WHERE c.rubric_id = r.id), '[]') AS criteria
       FROM rubrics r WHERE r.institution_id = $1 AND (r.offering_id IS NULL OR r.offering_id = $2) ORDER BY r.offering_id NULLS LAST, r.title`,
    [institutionId(req), offeringId]
  );
  res.json(rows);
});

async function saveCriteria(rubricId: number, criteria: ReturnType<typeof rubricBody.parse>['criteria'], s: number) {
  await db.query(`DELETE FROM rubric_criteria WHERE rubric_id = $1`, [rubricId]);
  for (const [i, c] of criteria.entries()) {
    await db.query(`INSERT INTO rubric_criteria (institution_id, rubric_id, title, description, position, levels) VALUES ($1,$2,$3,$4,$5,$6)`, [
      s, rubricId, c.title, c.description, i, JSON.stringify([...c.levels].sort((x, y) => y.points - x.points)),
    ]);
  }
}

router.post('/rubrics', async (req, res) => {
  const b = rubricBody.parse(req.body);
  if (b.offering_id) await assertCourseEditor(req, b.offering_id);
  else if (!userCan(req, 'teaching.access') && !userCan(req, 'courses.manage_any')) throw forbidden();
  const s = institutionId(req);
  const out = await withTransaction(async () => {
    const { rows } = await db.query<{ id: number }>(`INSERT INTO rubrics (institution_id, offering_id, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [s, b.offering_id, b.title, currentUser(req).id]);
    await saveCriteria(rows[0]!.id, b.criteria, s);
    return rows[0]!;
  });
  res.status(201).json(out);
});

async function rubricForEdit(req: Request, rubricId: number) {
  const { rows } = await db.query<{ offering_id: number | null; created_by: number | null }>(`SELECT offering_id, created_by FROM rubrics WHERE id = $1 AND institution_id = $2`, [rubricId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if (rows[0].offering_id) await assertCourseEditor(req, rows[0].offering_id);
  else if (rows[0].created_by !== currentUser(req).id && !userCan(req, 'courses.manage_any')) throw forbidden('Only its author or a course manager can change a shared rubric');
}

router.put('/rubrics/:id', async (req, res) => {
  const rubricId = id.parse(req.params.id);
  await rubricForEdit(req, rubricId);
  const b = rubricBody.parse(req.body);
  await withTransaction(async () => {
    await db.query(`UPDATE rubrics SET title = $2 WHERE id = $1`, [rubricId, b.title]);
    await saveCriteria(rubricId, b.criteria, institutionId(req));
  });
  res.json({ ok: true });
});

router.delete('/rubrics/:id', async (req, res) => {
  const rubricId = id.parse(req.params.id);
  await rubricForEdit(req, rubricId);
  await db.query(`DELETE FROM rubrics WHERE id = $1`, [rubricId]);
  res.status(204).end();
});

// ---------------------------------------------------------------- groups

router.get('/courses/:id/group-sets', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const access = await assertCourseMember(req, offeringId);
  const { rows } = await db.query(
    `SELECT gs.id, gs.name, gs.self_signup, gs.max_size,
            COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name,
                 'members', (SELECT COALESCE(json_agg(json_build_object('student_id', st.id, 'name', st.first_name || ' ' || st.last_name) ORDER BY st.first_name), '[]')
                               FROM group_members m JOIN students st ON st.id = m.student_id WHERE m.group_id = g.id)) ORDER BY g.name)
               FROM student_groups g WHERE g.group_set_id = gs.id), '[]') AS groups
       FROM group_sets gs WHERE gs.offering_id = $1 ORDER BY gs.name`,
    [offeringId]
  );
  // students see their own group set memberships (and open groups to join)
  res.json(access.role === 'staff' ? rows : rows.filter((r) => r.self_signup || r.groups.some((g: { members: { student_id: number }[] }) => g.members.some((m) => access.studentIds.includes(m.student_id)))));
});

router.post('/courses/:id/group-sets', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const b = groupSetBody.parse(req.body);
  const s = institutionId(req);
  const out = await withTransaction(async () => {
    const { rows } = await db.query<{ id: number }>(`INSERT INTO group_sets (institution_id, offering_id, name, self_signup, max_size) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [
      s, offeringId, b.name, b.self_signup, b.max_size,
    ]);
    const set = rows[0]!;
    if (b.auto_size) {
      const { rows: roster } = await db.query<{ id: number }>(`SELECT id FROM (${rosterSql('$1')}) r ORDER BY random()`, [offeringId]);
      const count = Math.max(1, Math.ceil(roster.length / b.auto_size));
      for (let g = 0; g < count; g++) {
        const { rows: grp } = await db.query<{ id: number }>(`INSERT INTO student_groups (institution_id, group_set_id, name) VALUES ($1,$2,$3) RETURNING id`, [s, set.id, `Group ${g + 1}`]);
        const members = roster.filter((_, i) => i % count === g).map((r) => r.id);
        if (members.length) await db.query(`INSERT INTO group_members (group_id, student_id, group_set_id, institution_id) SELECT $1, m, $2, $3 FROM unnest($4::int[]) m`, [grp[0]!.id, set.id, s, members]);
      }
    }
    return set;
  });
  res.status(201).json(out);
});

router.put('/group-sets/:id/groups', async (req, res) => {
  const setId = id.parse(req.params.id);
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM group_sets WHERE id = $1 AND institution_id = $2`, [setId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  await assertCourseEditor(req, rows[0].offering_id);
  const { groups } = groupsBody.parse(req.body);
  const all = groups.flatMap((g) => g.student_ids);
  if (new Set(all).size !== all.length) throw badRequest('A student can be in only one group of a set');
  const { rows: ok } = await db.query<{ id: number }>(`SELECT id FROM (${rosterSql('$1')}) r WHERE r.id = ANY($2::int[])`, [rows[0].offering_id, all]);
  if (ok.length !== all.length) throw badRequest('Some students are not in this course');
  const s = institutionId(req);
  await withTransaction(async () => {
    // submissions point at groups: keep groups that still exist (matched by name)
    const { rows: existing } = await db.query<{ id: number; name: string }>(`SELECT id, name FROM student_groups WHERE group_set_id = $1`, [setId]);
    await db.query(`DELETE FROM group_members WHERE group_set_id = $1`, [setId]);
    const keep: number[] = [];
    for (const g of groups) {
      let gid = existing.find((e) => e.name === g.name)?.id;
      if (!gid) gid = (await db.query<{ id: number }>(`INSERT INTO student_groups (institution_id, group_set_id, name) VALUES ($1,$2,$3) RETURNING id`, [s, setId, g.name])).rows[0]!.id;
      keep.push(gid);
      if (g.student_ids.length) await db.query(`INSERT INTO group_members (group_id, student_id, group_set_id, institution_id) SELECT $1, m, $2, $3 FROM unnest($4::int[]) m`, [gid, setId, s, g.student_ids]);
    }
    await db.query(`DELETE FROM student_groups WHERE group_set_id = $1 AND NOT (id = ANY($2::int[])) AND NOT EXISTS (SELECT 1 FROM submissions WHERE group_id = student_groups.id)`, [setId, keep]);
  });
  res.json({ ok: true });
});

router.post('/group-sets/:id/groups/:groupId/join', requirePermission('learner.access'), async (req, res) => {
  const setId = id.parse(req.params.id);
  const groupId = id.parse(req.params.groupId);
  const { rows } = await db.query<{ offering_id: number; self_signup: boolean; max_size: number | null }>(
    `SELECT gs.offering_id, gs.self_signup, gs.max_size FROM group_sets gs JOIN student_groups g ON g.group_set_id = gs.id WHERE gs.id = $1 AND g.id = $2 AND gs.institution_id = $3`,
    [setId, groupId, institutionId(req)]
  );
  const set = rows[0];
  if (!set) throw notFound();
  const access = await assertCourseMember(req, set.offering_id);
  if (access.role !== 'student') throw forbidden();
  if (!set.self_signup) throw forbidden('Your teacher sets these groups');
  const sid = access.studentIds[0]!;
  await withTransaction(async () => {
    await db.query(`SELECT id FROM student_groups WHERE id = $1 FOR UPDATE`, [groupId]);
    const { rows: n } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM group_members WHERE group_id = $1`, [groupId]);
    if (set.max_size && n[0]!.n >= set.max_size) throw conflict('This group is full', 'GROUP_FULL');
    await db.query(`DELETE FROM group_members WHERE group_set_id = $1 AND student_id = $2`, [setId, sid]);
    await db.query(`INSERT INTO group_members (group_id, student_id, group_set_id, institution_id) VALUES ($1,$2,$3,$4)`, [groupId, sid, setId, institutionId(req)]);
  });
  res.json({ ok: true });
});

router.delete('/group-sets/:id', async (req, res) => {
  const setId = id.parse(req.params.id);
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM group_sets WHERE id = $1 AND institution_id = $2`, [setId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  await assertCourseEditor(req, rows[0].offering_id);
  const { rows: used } = await db.query(`SELECT 1 FROM assessments WHERE group_set_id = $1 LIMIT 1`, [setId]);
  if (used[0]) throw conflict('Group work uses this set; change that work first', 'IN_USE');
  await db.query(`DELETE FROM group_sets WHERE id = $1`, [setId]);
  res.status(204).end();
});

export default router;
