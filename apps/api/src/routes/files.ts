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
import { sendFile, type StoredFile } from '../storage/files';

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
  if (d?.owner_type === 'student') await assertMayViewStudent(req, d.owner_id);
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
