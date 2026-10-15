// Who may do what in a course (an offering). Never trust ids from the client: every check
// loads the course in the caller's institution and works out the caller's relationship to it.
//   staff    — a teacher assigned to the course (section_staff), or someone with courses.manage_any
//   student  — on the course roster (the whole section, or enrolled for open courses)
//   guardian — linked to a student on the roster (read-only, released grades only)
import type { Request } from 'express';
import type { AuthUser } from '../../middleware/auth';
import { currentUser } from '../../middleware/auth';
import { db } from '../../db/context';
import { can } from '../../rbac';
import { forbidden, notFound } from '../errors';

/**
 * SQL selecting the student ids on a course's roster; `$n` is the offering id parameter.
 * Students who left, graduated or were deleted are not on it.
 */
export const rosterSql = (param: string) => `
  SELECT st.id FROM course_offerings ro
    JOIN students st ON st.institution_id = ro.institution_id AND COALESCE(st.status, 'active') = 'active'
   WHERE ro.id = ${param}
     AND ((ro.enrollment_mode = 'section' AND st.section_id = ro.section_id)
          OR EXISTS (SELECT 1 FROM enrollments e WHERE e.offering_id = ro.id AND e.student_id = st.id AND e.status IN ('active', 'completed')))`;

export interface CourseRow {
  id: number;
  institution_id: number;
  section_id: number | null;
  course_id: number;
  term_id: number | null;
  code: string;
  name: string;
  section_name: string | null;
  campus_id: number | null;
  enrollment_mode: string;
  gradebook_locked_at: Date | null;
  archived: boolean;
}

export type CourseRole = 'staff' | 'student' | 'guardian';
export interface CourseAccess {
  course: CourseRow;
  role: CourseRole;
  /** staff may edit (false for read-only viewers such as institution auditors) */
  canEdit: boolean;
  /** the caller's own student id (students) or the linked children on the roster (guardians) */
  studentIds: number[];
}

export async function loadCourse(offeringId: number, institutionId: number): Promise<CourseRow> {
  const { rows } = await db.query<CourseRow>(
    `SELECT o.id, o.institution_id, o.section_id, o.course_id, o.term_id, c.code, c.name,
            NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name, sec.campus_id, o.enrollment_mode,
            o.gradebook_locked_at, COALESCE(ay.status = 'archived', false) OR COALESCE(tm.status = 'archived', false) AS archived
       FROM course_offerings o JOIN courses c ON c.id = o.course_id
       LEFT JOIN sections sec ON sec.id = o.section_id
       LEFT JOIN terms tm ON tm.id = o.term_id
       LEFT JOIN academic_years ay ON ay.id = COALESCE(tm.academic_year_id, sec.academic_year_id)
      WHERE o.id = $1 AND o.institution_id = $2`,
    [offeringId, institutionId]
  );
  if (!rows[0]) throw notFound('Course not found');
  return rows[0];
}

/** The caller's access to a course, or 404 / 403. */
export async function courseAccess(user: AuthUser, offeringId: number): Promise<CourseAccess> {
  if (!user.institution_id) throw forbidden();
  const course = await loadCourse(offeringId, user.institution_id);
  const ctx = { institutionId: user.institution_id, campusId: course.campus_id };
  if (user.role === 'teacher' || can(user, 'courses.manage_any', ctx)) {
    const { rows } = await db.query(`SELECT 1 FROM section_staff WHERE offering_id = $1 AND teacher_id = $2 AND institution_id = $3 LIMIT 1`, [
      offeringId,
      user.ref_id,
      user.institution_id,
    ]);
    if (rows[0] && can(user, 'teaching.access', ctx)) return { course, role: 'staff', canEdit: !course.archived, studentIds: [] };
    if (can(user, 'courses.manage_any', ctx)) return { course, role: 'staff', canEdit: !course.archived, studentIds: [] };
    if (can(user, 'academics.read', ctx)) return { course, role: 'staff', canEdit: false, studentIds: [] };
  } else if (can(user, 'academics.read', ctx)) {
    return { course, role: 'staff', canEdit: false, studentIds: [] };
  }
  if (user.role === 'student' && user.ref_id) {
    const { rows } = await db.query(`SELECT 1 FROM (${rosterSql('$1')}) r WHERE r.id = $2`, [offeringId, user.ref_id]);
    if (rows[0]) return { course, role: 'student', canEdit: false, studentIds: [user.ref_id] };
  }
  if (user.role === 'parent') {
    const { rows } = await db.query<{ student_id: number }>(
      `SELECT gs.student_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id
        WHERE g.user_id = $1 AND gs.institution_id = $2 AND gs.can_view_grades AND gs.student_id IN (${rosterSql('$3')})`,
      [user.id, user.institution_id, offeringId]
    );
    if (rows.length) return { course, role: 'guardian', canEdit: false, studentIds: rows.map((r) => r.student_id) };
  }
  throw forbidden('You are not part of this course');
}

/** Staff who may change the course (assigned teachers or course managers, not in an archived year). */
export async function assertCourseEditor(req: Request, offeringId: number): Promise<CourseAccess> {
  const a = await courseAccess(currentUser(req), offeringId);
  if (a.role !== 'staff') throw forbidden('Only the course staff can do this');
  if (!a.canEdit) throw forbidden(a.course.archived ? 'This course belongs to an archived year and is read-only' : 'You can view this course but not change it');
  return a;
}

/** Anyone in the course: staff see everything, students and guardians what is published. */
export const assertCourseMember = (req: Request, offeringId: number) => courseAccess(currentUser(req), offeringId);

/** The offering an assessment belongs to (in the caller's institution). */
export async function offeringOfAssessment(assessmentId: number, institutionId: number): Promise<number> {
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM assessments WHERE id = $1 AND institution_id = $2`, [assessmentId, institutionId]);
  if (!rows[0]) throw notFound('Not found');
  return rows[0].offering_id;
}

/** Users (accounts) of the students on a course roster, optionally only some students. */
export async function rosterUserIds(offeringId: number, studentIds?: number[]): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT u.id FROM users u WHERE u.role = 'student' AND u.is_active AND u.ref_id IN (${rosterSql('$1')})
       AND ($2::int[] IS NULL OR u.ref_id = ANY($2::int[]))`,
    [offeringId, studentIds ?? null]
  );
  return rows.map((r) => r.id);
}

/** Accounts of the guardians (who may see grades) of these students. */
export async function guardianUserIds(studentIds: number[]): Promise<number[]> {
  if (!studentIds.length) return [];
  const { rows } = await db.query<{ user_id: number }>(
    `SELECT DISTINCT g.user_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id
      WHERE gs.student_id = ANY($1::int[]) AND g.user_id IS NOT NULL AND gs.can_view_grades`,
    [studentIds]
  );
  return rows.map((r) => r.user_id);
}

/** Accounts of the course's teachers. */
export async function staffUserIds(offeringId: number): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT u.id FROM users u JOIN section_staff ss ON ss.teacher_id = u.ref_id AND u.role = 'teacher' AND u.institution_id = ss.institution_id
      WHERE ss.offering_id = $1 AND u.is_active`,
    [offeringId]
  );
  return rows.map((r) => r.id);
}
