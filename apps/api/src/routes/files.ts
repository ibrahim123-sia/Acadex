// Downloading stored files. A file is only served to someone who may see what it belongs to:
// a person's document or photo follows the rules for that person; import files need
// imports.run. Mounted at /api/files.
import { Router, type Request } from 'express';
import { id } from '@acadex/shared';
import { db } from '../db/context';
import { assertCanViewStudent } from '../lib/access';
import { forbidden, notFound } from '../lib/errors';
import { assertCampusAllowed, campusesFor } from '../lib/structure';
import { auth, currentUser, institutionId, userCan } from '../middleware/auth';
import { sendFile, storeUpload, type StoredFile } from '../storage/files';
import { z } from 'zod';
import { oneFile, requireFile } from '../lib/upload';
import { courseAccess } from '../lib/lms/access';

const router = Router();
router.use(auth);

async function assertMayViewStudent(req: Request, studentId: number) {
  const user = currentUser(req);
  if (userCan(req, 'students.read')) {
    const { rows } = await db.query<{ campus_id: number | null }>(
      `SELECT sec.campus_id FROM students st LEFT JOIN sections sec ON sec.id = st.section_id WHERE st.id = $1`,
      [studentId]
    );
    assertCampusAllowed(campusesFor(req, 'students.read'), rows[0]?.campus_id ?? null);
    return;
  }
  // the student, a linked guardian, or a teacher of the student's class
  await assertCanViewStudent(user, studentId, { allowTeachers: true });
}

async function assertMayViewStaff(req: Request, staffId: number) {
  const user = currentUser(req);
  if (user.role === 'teacher' && user.ref_id === staffId) return;
  if (!userCan(req, 'staff.read')) throw forbidden();
  const { rows } = await db.query<{ campus_id: number | null }>(`SELECT campus_id FROM teachers WHERE id = $1`, [staffId]);
  assertCampusAllowed(campusesFor(req, 'staff.read'), rows[0]?.campus_id ?? null);
}

/** Upload a file for a course, a submission or feedback; it is attached by id afterwards. */
router.post('/', oneFile(300), async (req, res) => {
  const purpose = z.enum(['course', 'submission', 'feedback', 'package']).parse(req.query.purpose ?? req.body?.purpose);
  const u = currentUser(req);
  if (purpose === 'submission' && !userCan(req, 'submissions.create') && !userCan(req, 'teaching.access')) throw forbidden();
  if (purpose !== 'submission' && !userCan(req, 'teaching.access') && !userCan(req, 'courses.manage_any') && !userCan(req, 'blueprints.manage')) throw forbidden();
  const file = requireFile(req);
  const stored = await storeUpload({ institutionId: institutionId(req), userId: u.id, purpose, body: file.buffer, originalName: file.originalname });
  res.status(201).json({ id: stored.id, original_name: stored.original_name, content_type: stored.content_type, size_bytes: stored.size_bytes });
});

/** May the caller see an LMS file? null = not an LMS file. */
async function lmsFileAllowed(req: Request, fileId: number): Promise<boolean | null> {
  const u = currentUser(req);
  const { rows } = await db.query<{ offering_id: number; student_id: number | null; group_id: number | null; kind: string; assessment_id: number | null }>(
    `SELECT m.offering_id, NULL::int AS student_id, NULL::int AS group_id, 'content' AS kind, NULL::int AS assessment_id
       FROM content_items i JOIN modules m ON m.id = i.module_id WHERE i.file_id = $1 AND m.offering_id IS NOT NULL
     UNION ALL
     SELECT a.offering_id, s.student_id, s.group_id, 'submission', a.id FROM submission_versions v JOIN submissions s ON s.id = v.submission_id JOIN assessments a ON a.id = s.assessment_id WHERE $1 = ANY(v.file_ids)
     UNION ALL
     SELECT a.offering_id, g.student_id, NULL, CASE WHEN g.status = 'released' THEN 'feedback' ELSE 'draft_feedback' END, a.id FROM grades g JOIN assessments a ON a.id = g.assessment_id WHERE $1 = ANY(g.feedback_file_ids)
     UNION ALL
     SELECT a.offering_id, q.student_id, NULL, 'submission', a.id FROM attempt_answers aa JOIN quiz_attempts q ON q.id = aa.attempt_id JOIN assessments a ON a.id = q.assessment_id
      WHERE jsonb_typeof(aa.response) = 'object' AND aa.response ? 'file_ids' AND aa.response->'file_ids' @> to_jsonb($1::int)
     LIMIT 20`,
    [fileId]
  );
  if (!rows.length) return null;
  for (const r of rows) {
    const a = await courseAccess(u, r.offering_id).catch(() => null);
    if (!a) continue;
    if (a.role === 'staff') return true;
    if (r.kind === 'content') return true;
    if (r.kind === 'draft_feedback') continue;
    if (r.student_id && a.studentIds.includes(r.student_id)) return true;
    if (r.group_id) {
      const { rows: m } = await db.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND student_id = ANY($2::int[])`, [r.group_id, a.studentIds]);
      if (m[0]) return true;
    }
    // peer reviewers see the work they review
    if (r.kind === 'submission' && a.role === 'student') {
      const { rows: pr } = await db.query(
        `SELECT 1 FROM peer_reviews p JOIN submission_versions v ON v.submission_id = p.submission_id WHERE $1 = ANY(v.file_ids) AND p.reviewer_student_id = $2`,
        [fileId, a.studentIds[0]]
      );
      if (pr[0]) return true;
    }
  }
  return false;
}

router.get('/:id', async (req, res) => {
  const fileId = id.parse(req.params.id);
  const s = institutionId(req);
  const { rows } = await db.query<StoredFile & { scan_status: string }>(
    `SELECT id, original_name, content_type, size_bytes, purpose, storage_key, scan_status FROM files WHERE id = $1 AND institution_id = $2`,
    [fileId, s]
  );
  const file = rows[0];
  if (!file || file.scan_status === 'infected') throw notFound('File not found');

  // what is this file attached to?
  const [doc, studentPhoto, staffPhoto] = await Promise.all([
    db.query<{ owner_type: string; owner_id: number }>(`SELECT owner_type, owner_id FROM person_documents WHERE file_id = $1 LIMIT 1`, [fileId]),
    db.query<{ id: number }>(`SELECT id FROM students WHERE photo_file_id = $1 LIMIT 1`, [fileId]),
    db.query<{ id: number }>(`SELECT id FROM teachers WHERE photo_file_id = $1 LIMIT 1`, [fileId]),
  ]);
  const d = doc.rows[0];
  const lms = !d && !studentPhoto.rows[0] && !staffPhoto.rows[0] ? await lmsFileAllowed(req, fileId) : null;
  if (lms === false) throw notFound('File not found');
  if (lms === true) {
    // an LMS file the caller may see
  } else if (d?.owner_type === 'student') await assertMayViewStudent(req, d.owner_id);
  else if (d?.owner_type === 'staff') await assertMayViewStaff(req, d.owner_id);
  else if (d?.owner_type === 'guardian') {
    if (!userCan(req, 'guardians.read')) throw forbidden();
  } else if (studentPhoto.rows[0]) await assertMayViewStudent(req, studentPhoto.rows[0].id);
  else if (staffPhoto.rows[0]) {
    // staff photos are shown across the institution (directories, timetables, ID cards)
  } else if (file.purpose === 'import') {
    if (!userCan(req, 'imports.run')) throw forbidden();
  } else if (file.purpose !== 'logo') {
    // not attached to anything: only whoever uploaded it
    const { rows: own } = await db.query(`SELECT 1 FROM files WHERE id = $1 AND created_by = $2`, [fileId, currentUser(req).id]);
    if (!own[0]) throw notFound('File not found');
  }
  await sendFile(res, file, { inline: req.query.download !== '1' });
});

export default router;
