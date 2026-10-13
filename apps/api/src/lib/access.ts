// Ownership checks. Never trust an id from the client: every check is scoped to the
// caller's school and to what their role is actually linked to.
import { pool, type Queryable } from '../db/pool';
import type { AuthUser } from '../middleware/auth';
import { can } from '../rbac';
import { badRequest, forbidden, notFound } from './errors';

/** The teacher must be assigned to this class (and, if given, this subject in that class). */
export async function assertTeachesClass(
  user: AuthUser,
  classId: number,
  subjectId: number | null = null,
  db: Queryable = pool
): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1
       FROM teacher_subjects ts
       JOIN classes c ON c.id = ts.class_id AND c.school_id = ts.school_id
      WHERE ts.school_id = $1 AND ts.teacher_id = $2 AND ts.class_id = $3
        AND ($4::int IS NULL OR ts.subject_id = $4)
      LIMIT 1`,
    [user.school_id, user.ref_id, classId, subjectId]
  );
  if (!rows[0]) {
    throw forbidden(subjectId ? 'You do not teach this subject in this class' : 'You do not teach this class');
  }
}

/**
 * Every student id must be enrolled in this class of this school. Rejects the whole batch,
 * listing the offending ids, so nothing is half-written.
 */
export async function assertStudentsInClass(
  schoolId: number,
  classId: number,
  studentIds: number[],
  db: Queryable = pool
): Promise<void> {
  const unique = [...new Set(studentIds)];
  if (unique.length !== studentIds.length) throw badRequest('The same student appears more than once');
  if (!unique.length) return;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND id = ANY($3::int[])`,
    [schoolId, classId, unique]
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.filter((sid) => !found.has(sid));
  if (missing.length) throw badRequest('Some students are not in this class', { student_ids: missing });
}

const SCHOOL_TABLES = { students: 'Student', classes: 'Class', teachers: 'Teacher', subjects: 'Subject' } as const;

/** A row referenced by id must exist in the caller's school (for admin writes). */
export async function assertInSchool(
  table: keyof typeof SCHOOL_TABLES,
  rowId: number,
  schoolId: number,
  db: Queryable = pool
): Promise<void> {
  const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND school_id = $2`, [rowId, schoolId]);
  if (!rows[0]) throw badRequest(`${SCHOOL_TABLES[table]} not found in this school`);
}

/**
 * Who may see a student's records (report card, fee voucher, ...):
 *   anyone holding records.read_any in that school (school admins), the student themself,
 *   a linked parent, and — only when allowTeachers — a teacher assigned to the student's class.
 * A student outside the caller's school is reported as 404 so ids can't be probed.
 */
export async function assertCanViewStudent(
  user: AuthUser,
  studentId: number,
  { allowTeachers = false }: { allowTeachers?: boolean } = {},
  db: Queryable = pool
): Promise<{ id: number; class_id: number | null }> {
  if (!user.school_id) throw forbidden();
  const { rows } = await db.query<{ id: number; class_id: number | null }>(
    `SELECT id, class_id FROM students WHERE id = $1 AND school_id = $2`,
    [studentId, user.school_id]
  );
  const student = rows[0];
  if (!student) throw notFound('Student not found');

  let allowed = false;
  if (can(user, 'records.read_any', { schoolId: user.school_id })) allowed = true;
  else if (user.role === 'student') allowed = user.ref_id === student.id;
  else if (user.role === 'parent') {
    const r = await db.query(
      `SELECT 1 FROM parent_children WHERE parent_user_id = $1 AND student_id = $2 AND school_id = $3`,
      [user.id, student.id, user.school_id]
    );
    allowed = (r.rowCount ?? 0) > 0;
  } else if (user.role === 'teacher' && allowTeachers && student.class_id) {
    const r = await db.query(
      `SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND class_id = $2 AND school_id = $3 LIMIT 1`,
      [user.ref_id, student.class_id, user.school_id]
    );
    allowed = (r.rowCount ?? 0) > 0;
  }
  if (!allowed) throw forbidden();
  return student;
}
