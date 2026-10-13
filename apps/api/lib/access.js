// Ownership checks. Never trust an id from the client: every check is scoped to the
// caller's school and to what their role is actually linked to.
const pool = require('../db/pool');
const { forbidden, badRequest, notFound } = require('./errors');

// The teacher must be assigned to this class (and, if given, this subject in that class).
async function assertTeachesClass(user, classId, subjectId = null, db = pool) {
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

// Every student id must be enrolled in this class of this school. Rejects the whole batch,
// listing the offending ids, so nothing is half-written.
async function assertStudentsInClass(schoolId, classId, studentIds, db = pool) {
  const unique = [...new Set(studentIds)];
  if (unique.length !== studentIds.length) throw badRequest('The same student appears more than once');
  if (!unique.length) return;
  const { rows } = await db.query(
    `SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND id = ANY($3::int[])`,
    [schoolId, classId, unique]
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.filter((sid) => !found.has(sid));
  if (missing.length) throw badRequest('Some students are not in this class', { student_ids: missing });
}

// A row referenced by id must exist in the caller's school (for admin writes).
const SCHOOL_TABLES = { students: 'Student', classes: 'Class', teachers: 'Teacher', subjects: 'Subject' };
async function assertInSchool(table, rowId, schoolId, db = pool) {
  if (!SCHOOL_TABLES[table]) throw new Error(`assertInSchool: unsupported table ${table}`);
  const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND school_id = $2`, [rowId, schoolId]);
  if (!rows[0]) throw badRequest(`${SCHOOL_TABLES[table]} not found in this school`);
}

// Who may see a student's records (report card, fee voucher, ...):
//   school admin of that school, the student themself, a linked parent, and — only when
//   allowTeachers — a teacher assigned to the student's class.
// A student outside the caller's school is reported as 404 so ids can't be probed.
async function assertCanViewStudent(user, studentId, { allowTeachers = false } = {}, db = pool) {
  if (!user.school_id) throw forbidden();
  const { rows } = await db.query(`SELECT id, class_id FROM students WHERE id = $1 AND school_id = $2`, [
    studentId,
    user.school_id,
  ]);
  const student = rows[0];
  if (!student) throw notFound('Student not found');

  let allowed = false;
  if (user.role === 'school_admin') allowed = true;
  else if (user.role === 'student') allowed = user.ref_id === student.id;
  else if (user.role === 'parent') {
    const r = await db.query(
      `SELECT 1 FROM parent_children WHERE parent_user_id = $1 AND student_id = $2 AND school_id = $3`,
      [user.id, student.id, user.school_id]
    );
    allowed = r.rowCount > 0;
  } else if (user.role === 'teacher' && allowTeachers && student.class_id) {
    const r = await db.query(
      `SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND class_id = $2 AND school_id = $3 LIMIT 1`,
      [user.ref_id, student.class_id, user.school_id]
    );
    allowed = r.rowCount > 0;
  }
  if (!allowed) throw forbidden();
  return student;
}

module.exports = { assertTeachesClass, assertStudentsInClass, assertInSchool, assertCanViewStudent };
