// Ownership checks. Never trust an id from the client: every check is scoped to the
// caller's school and to what their role is actually linked to.
const pool = require('../db/pool');
const { forbidden } = require('./errors');

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

module.exports = { assertTeachesClass };
