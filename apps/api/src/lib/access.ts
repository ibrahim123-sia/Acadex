// Ownership checks. Never trust an id from the client: every check is scoped to the
// caller's institution and to what their role is actually linked to.
import type { Queryable } from '../db/pool';
import { db } from '../db/context';

const defaultDb: Queryable = db;
import type { AuthUser } from '../middleware/auth';
import { can } from '../rbac';
import { badRequest, forbidden, notFound } from './errors';

/** The teacher must be assigned to this class (and, if given, this subject in that class). */
export async function assertTeachesClass(
  user: AuthUser,
  classId: number,
  subjectId: number | null = null,
  db: Queryable = defaultDb
): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1
       FROM teacher_subjects ts
       JOIN classes c ON c.id = ts.class_id AND c.institution_id = ts.institution_id
      WHERE ts.institution_id = $1 AND ts.teacher_id = $2 AND ts.class_id = $3
        AND ($4::int IS NULL OR ts.subject_id = $4)
      LIMIT 1`,
    [user.institution_id, user.ref_id, classId, subjectId]
  );
  if (!rows[0]) {
    throw forbidden(subjectId ? 'You do not teach this subject in this class' : 'You do not teach this class');
  }
}

/**
 * Every student id must be enrolled in this class of this institution. Rejects the whole batch,
 * listing the offending ids, so nothing is half-written.
 */
export async function assertStudentsInClass(
  institutionId: number,
  classId: number,
  studentIds: number[],
  db: Queryable = defaultDb
): Promise<void> {
  const unique = [...new Set(studentIds)];
  if (unique.length !== studentIds.length) throw badRequest('The same student appears more than once');
  if (!unique.length) return;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM students WHERE institution_id = $1 AND class_id = $2 AND id = ANY($3::int[])`,
    [institutionId, classId, unique]
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.filter((sid) => !found.has(sid));
  if (missing.length) throw badRequest('Some students are not in this class', { student_ids: missing });
}

const INSTITUTION_TABLES = { students: 'Student', classes: 'Class', teachers: 'Teacher', subjects: 'Subject' } as const;

/** A row referenced by id must exist in the caller's institution (for admin writes). */
export async function assertInInstitution(
  table: keyof typeof INSTITUTION_TABLES,
  rowId: number,
  institutionId: number,
  db: Queryable = defaultDb
): Promise<void> {
  const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND institution_id = $2`, [rowId, institutionId]);
  if (!rows[0]) throw badRequest(`${INSTITUTION_TABLES[table]} not found in this institution`);
}

/**
 * Who may see a student's records (report card, fee voucher, ...):
 *   anyone holding records.read_any in that institution (institution admins), the student themself,
 *   a linked parent, and — only when allowTeachers — a teacher assigned to the student's class.
 * A student outside the caller's institution is reported as 404 so ids can't be probed.
 */
export async function assertCanViewStudent(
  user: AuthUser,
  studentId: number,
  { allowTeachers = false }: { allowTeachers?: boolean } = {},
  db: Queryable = defaultDb
): Promise<{ id: number; class_id: number | null }> {
  if (!user.institution_id) throw forbidden();
  const { rows } = await db.query<{ id: number; class_id: number | null }>(
    `SELECT id, class_id FROM students WHERE id = $1 AND institution_id = $2`,
    [studentId, user.institution_id]
  );
  const student = rows[0];
  if (!student) throw notFound('Student not found');

  let allowed = false;
  if (can(user, 'records.read_any', { institutionId: user.institution_id })) allowed = true;
  else if (user.role === 'student') allowed = user.ref_id === student.id;
  else if (user.role === 'parent') {
    const r = await db.query(
      `SELECT 1 FROM parent_children WHERE parent_user_id = $1 AND student_id = $2 AND institution_id = $3`,
      [user.id, student.id, user.institution_id]
    );
    allowed = (r.rowCount ?? 0) > 0;
  } else if (user.role === 'teacher' && allowTeachers && student.class_id) {
    const r = await db.query(
      `SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND class_id = $2 AND institution_id = $3 LIMIT 1`,
      [user.ref_id, student.class_id, user.institution_id]
    );
    allowed = (r.rowCount ?? 0) > 0;
  }
  if (!allowed) throw forbidden();
  return student;
}
