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
  sectionId: number,
  offeringId: number | null = null,
  db: Queryable = defaultDb
): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1
       FROM section_staff ts
       JOIN sections c ON c.id = ts.section_id AND c.institution_id = ts.institution_id
      WHERE ts.institution_id = $1 AND ts.teacher_id = $2 AND ts.section_id = $3
        AND ($4::int IS NULL OR ts.offering_id = $4)
      LIMIT 1`,
    [user.institution_id, user.ref_id, sectionId, offeringId]
  );
  if (!rows[0]) {
    throw forbidden(offeringId ? 'You do not teach this subject in this class' : 'You do not teach this class');
  }
}

/**
 * Every student id must be enrolled in this class of this institution. Rejects the whole batch,
 * listing the offending ids, so nothing is half-written.
 */
export async function assertStudentsInClass(
  institutionId: number,
  sectionId: number,
  studentIds: number[],
  db: Queryable = defaultDb
): Promise<void> {
  const unique = [...new Set(studentIds)];
  if (unique.length !== studentIds.length) throw badRequest('The same student appears more than once');
  if (!unique.length) return;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM students WHERE institution_id = $1 AND section_id = $2 AND id = ANY($3::int[])`,
    [institutionId, sectionId, unique]
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.filter((sid) => !found.has(sid));
  if (missing.length) throw badRequest('Some students are not in this class', { student_ids: missing });
}

const INSTITUTION_TABLES = {
  students: 'Student',
  sections: 'Section',
  teachers: 'Staff member',
  course_offerings: 'Course offering',
  courses: 'Course',
  campuses: 'Campus',
  departments: 'Department',
  programs: 'Program',
  program_levels: 'Level',
  academic_years: 'Academic year',
  terms: 'Term',
  guardians: 'Guardian',
  grading_schemes: 'Grading scheme',
  fee_structures: 'Fee structure',
  discounts: 'Discount',
  rooms: 'Room',
  files: 'File',
  question_banks: 'Question bank',
  exam_series: 'Exam series',
  learning_outcomes: 'Outcome',
  admission_forms: 'Admission form',
} as const;
export type InstitutionTable = keyof typeof INSTITUTION_TABLES;

/** A row referenced by id must exist in the caller's institution (for admin writes). */
export async function assertInInstitution(
  table: InstitutionTable,
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
 *   a linked guardian (subject to that guardian's permissions: `guardian` says which one the
 *   record needs), and — only when allowTeachers — a teacher assigned to the student's section.
 * A student outside the caller's institution is reported as 404 so ids can't be probed.
 */
export async function assertCanViewStudent(
  user: AuthUser,
  studentId: number,
  { allowTeachers = false, guardian = 'any' }: { allowTeachers?: boolean; guardian?: 'any' | 'grades' | 'fees' } = {},
  db: Queryable = defaultDb
): Promise<{ id: number; section_id: number | null }> {
  if (!user.institution_id) throw forbidden();
  const { rows } = await db.query<{ id: number; section_id: number | null }>(
    `SELECT id, section_id FROM students WHERE id = $1 AND institution_id = $2`,
    [studentId, user.institution_id]
  );
  const student = rows[0];
  if (!student) throw notFound('Student not found');

  let allowed = false;
  if (can(user, 'records.read_any', { institutionId: user.institution_id })) allowed = true;
  else if (user.role === 'student') allowed = user.ref_id === student.id;
  else if (user.role === 'parent') {
    const link = await guardianLink(user.id, student.id, user.institution_id, db);
    allowed = !!link && (guardian === 'any' || (guardian === 'grades' ? link.can_view_grades : link.can_view_fees));
  } else if (user.role === 'teacher' && allowTeachers && student.section_id) {
    const r = await db.query(
      `SELECT 1 FROM section_staff WHERE teacher_id = $1 AND section_id = $2 AND institution_id = $3 LIMIT 1`,
      [user.ref_id, student.section_id, user.institution_id]
    );
    allowed = (r.rowCount ?? 0) > 0;
  }
  if (!allowed) throw forbidden();
  return student;
}

export interface GuardianLink {
  guardian_id: number;
  can_view_grades: boolean;
  can_view_fees: boolean;
  can_message: boolean;
}

/** The link between a guardian's account and a student, with that guardian's permissions. */
export async function guardianLink(userId: number, studentId: number, institutionId: number, db: Queryable = defaultDb) {
  const { rows } = await db.query<GuardianLink>(
    `SELECT gs.guardian_id, gs.can_view_grades, gs.can_view_fees, gs.can_message
       FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id
      WHERE g.user_id = $1 AND gs.student_id = $2 AND gs.institution_id = $3`,
    [userId, studentId, institutionId]
  );
  return rows[0] ?? null;
}
