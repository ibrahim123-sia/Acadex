const { Router } = require('../lib/router');
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { assertTeachesClass, assertStudentsInClass } = require('../lib/access');
const { z, id, optionalId, isoDate, requiredText, text, httpUrl } = require('../lib/validate');
const { forbidden, notFound } = require('../lib/errors');
const { withTransaction } = require('../db/tx');

const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Leave'];
const ASSESSMENT_TYPES = ['Quiz', 'Midterm', 'Assignment', 'Final', 'Test', 'Project'];

const router = Router();
router.use(auth);
router.use('/teacher', requireRole('teacher'));
router.use('/student', requireRole('student'));

const sid = (req) => req.user.school_id;
const ref = (req) => req.user.ref_id;

// ---------- STUDENT self ----------
router.get('/student/overview', async (req, res) => {
  const s = sid(req), stu = ref(req);
  const [profile, grades, attendance, fee] = await Promise.all([
    pool.query(`SELECT st.*, c.name class_name FROM students st LEFT JOIN classes c ON c.id=st.class_id WHERE st.id=$1 AND st.school_id=$2`, [stu, s]),
    pool.query(`SELECT su.name subject, g.assignment_type, g.assignment_name, g.obtained_marks, g.total_marks,
                  ROUND(g.obtained_marks/NULLIF(g.total_marks,0)*100,1) percentage
                FROM grades g LEFT JOIN subjects su ON su.id=g.subject_id WHERE g.student_id=$1 AND g.school_id=$2 ORDER BY g.id DESC`, [stu, s]),
    pool.query(`SELECT status, count(*)::int c FROM student_attendance WHERE student_id=$1 AND school_id=$2 GROUP BY status`, [stu, s]),
    pool.query(`SELECT total_fee, paid_amount, remaining_balance, payment_status, receipt_id FROM tuition_fee WHERE student_id=$1 AND school_id=$2 ORDER BY id DESC LIMIT 1`, [stu, s]),
  ]);
  res.json({
    profile: profile.rows[0] || null,
    grades: grades.rows,
    attendance: attendance.rows,
    fee: fee.rows[0] || null,
  });
});

// ---------- TEACHER self ----------
router.get('/teacher/overview', async (req, res) => {
  const s = sid(req), tch = ref(req);
  const [profile, classes, subjects, students] = await Promise.all([
    pool.query(`SELECT * FROM teachers WHERE id=$1 AND school_id=$2`, [tch, s]),
    pool.query(`SELECT DISTINCT c.id, c.name FROM teacher_subjects ts JOIN classes c ON c.id=ts.class_id WHERE ts.teacher_id=$1 AND ts.school_id=$2`, [tch, s]),
    pool.query(`SELECT ts.id, su.name subject, c.name class_name FROM teacher_subjects ts JOIN subjects su ON su.id=ts.subject_id LEFT JOIN classes c ON c.id=ts.class_id WHERE ts.teacher_id=$1 AND ts.school_id=$2`, [tch, s]),
    pool.query(`SELECT count(DISTINCT st.id)::int c FROM teacher_subjects ts JOIN students st ON st.class_id=ts.class_id AND st.school_id=ts.school_id WHERE ts.teacher_id=$1 AND ts.school_id=$2`, [tch, s]),
  ]);
  res.json({
    profile: profile.rows[0] || null,
    classes: classes.rows,
    subjects: subjects.rows,
    studentCount: students.rows[0].c,
  });
});

// Teacher: students in their classes (for gradebook / attendance)
router.get('/teacher/students', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT st.id, st.roll_no, st.first_name||' '||st.last_name name, c.name class_name
     FROM teacher_subjects ts JOIN students st ON st.class_id=ts.class_id AND st.school_id=ts.school_id JOIN classes c ON c.id=st.class_id
     WHERE ts.teacher_id=$1 AND ts.school_id=$2 ORDER BY c.name, st.roll_no`, [ref(req), sid(req)]);
  res.json(rows);
});

// Announcements filtered by role audience
router.get('/announcements', requireRole('teacher', 'student', 'parent'), async (req, res) => {
  const aud = req.user.role === 'teacher' ? ['All', 'Teachers'] : ['All', 'Students'];
  const { rows } = await pool.query(
    `SELECT id, title, target_audience, description, start_date, end_date FROM announcements
     WHERE school_id=$1 AND target_audience = ANY($2) ORDER BY created_at DESC`, [sid(req), aud]);
  res.json(rows);
});

// ================= TEACHER WORKFLOWS =================

// Teacher's classes (distinct) with student counts
router.get('/teacher/classes', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.code,
       (SELECT count(*) FROM students s WHERE s.class_id=c.id)::int students
     FROM teacher_subjects ts JOIN classes c ON c.id=ts.class_id
     WHERE ts.teacher_id=$1 AND ts.school_id=$2 ORDER BY c.id`, [ref(req), sid(req)]);
  res.json(rows);
});

// Roster for a class + attendance already marked for a date (defaults today)
router.get('/teacher/class/:classId/roster', async (req, res) => {
  const classId = id.parse(req.params.classId);
  await assertTeachesClass(req.user, classId);
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT st.id, st.roll_no, st.first_name||' '||st.last_name name,
            (SELECT status FROM student_attendance a WHERE a.student_id=st.id AND a.class_id=$2 AND a.att_date=$3 LIMIT 1) status
     FROM students st WHERE st.class_id=$1 AND st.school_id=$4 ORDER BY st.roll_no`,
    [classId, classId, date, sid(req)]);
  res.json({ date, students: rows });
});

// Bulk-save attendance for a whole class on a date (replaces that class's day)
const attendanceBody = z.object({
  class_id: id,
  date: isoDate,
  records: z.array(z.object({ student_id: id, status: z.enum(ATTENDANCE_STATUSES) })).max(500),
});
router.post('/teacher/attendance', async (req, res) => {
  const { class_id, date, records } = attendanceBody.parse(req.body);
  await assertTeachesClass(req.user, class_id);
  await assertStudentsInClass(sid(req), class_id, records.map((r) => r.student_id));
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM student_attendance WHERE school_id=$1 AND class_id=$2 AND att_date=$3`, [sid(req), class_id, date]);
    for (const r of records) {
      await client.query(`INSERT INTO student_attendance (school_id, student_id, class_id, att_date, status) VALUES ($1,$2,$3,$4,$5)`,
        [sid(req), r.student_id, class_id, date, r.status]);
    }
  });
  res.json({ saved: records.length });
});

// Bulk grade entry for a class/subject (all-or-nothing)
const gradesBody = z
  .object({
    class_id: id,
    subject_id: optionalId,
    assignment_type: z.enum(ASSESSMENT_TYPES).default('Quiz'),
    assignment_name: requiredText(120),
    total_marks: z.coerce.number().positive().max(10000).default(100),
    records: z.array(z.object({ student_id: id, obtained_marks: z.coerce.number().min(0) })).max(500),
  })
  .refine((b) => b.records.every((r) => r.obtained_marks <= b.total_marks), {
    message: 'Obtained marks cannot exceed total marks',
    path: ['records'],
  });
router.post('/teacher/grades', async (req, res) => {
  const b = gradesBody.parse(req.body);
  await assertTeachesClass(req.user, b.class_id, b.subject_id);
  await assertStudentsInClass(sid(req), b.class_id, b.records.map((r) => r.student_id));
  await withTransaction(async (client) => {
    for (const r of b.records) {
      await client.query(
        `INSERT INTO grades (school_id, student_id, class_id, subject_id, assignment_type, assignment_name, obtained_marks, total_marks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sid(req), r.student_id, b.class_id, b.subject_id, b.assignment_type, b.assignment_name, r.obtained_marks, b.total_marks]);
    }
  });
  res.json({ saved: b.records.length });
});

// Teacher's assignments
router.get('/teacher/assignments', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.description, a.due_date, c.name class_name, su.name subject,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id=a.id)::int submissions
     FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects su ON su.id=a.subject_id
     WHERE a.teacher_id=$1 AND a.school_id=$2 ORDER BY a.created_at DESC`, [ref(req), sid(req)]);
  res.json(rows);
});

// Assign an assignment to a whole class at once
const assignmentBody = z.object({
  class_id: id,
  subject_id: optionalId,
  title: requiredText(200),
  description: text(5000).default(''),
  due_date: z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => v || null),
});
router.post('/teacher/assignments', async (req, res) => {
  const { class_id, subject_id, title, description, due_date } = assignmentBody.parse(req.body);
  await assertTeachesClass(req.user, class_id, subject_id);
  const { rows } = await pool.query(
    `INSERT INTO assignments (school_id, class_id, subject_id, teacher_id, title, description, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sid(req), class_id, subject_id, ref(req), title, description, due_date]);
  // notify students of the class
  await pool.query(
    `INSERT INTO notifications (school_id, user_id, type, title, message)
     SELECT $1, u.id, 'assignment', 'New assignment: ' || $2, 'A new assignment has been posted for your class.'
     FROM users u WHERE u.role='student' AND u.school_id=$1 AND u.ref_id IN (SELECT id FROM students WHERE class_id=$3 AND school_id=$1)`,
    [sid(req), title, class_id]).catch(() => {});
  res.status(201).json(rows[0]);
});

// ================= STUDENT =================
router.get('/student/assignments', async (req, res) => {
  const stu = ref(req);
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.description, a.due_date, su.name subject,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=$1)::int submitted
     FROM assignments a LEFT JOIN subjects su ON su.id=a.subject_id
     WHERE a.school_id=$2 AND a.class_id=(SELECT class_id FROM students WHERE id=$1 AND school_id=$2) ORDER BY a.due_date`, [stu, sid(req)]);
  res.json(rows);
});
const submissionBody = z.object({ assignment_id: id, title: text(200).default(''), file_link: httpUrl });
router.post('/student/submissions', async (req, res) => {
  const { assignment_id, title, file_link } = submissionBody.parse(req.body);
  // the assignment must exist in this school and be set for the student's own class
  const { rows: found } = await pool.query(
    `SELECT a.class_id = st.class_id AS own_class
       FROM assignments a JOIN students st ON st.id = $3 AND st.school_id = a.school_id
      WHERE a.id = $1 AND a.school_id = $2`,
    [assignment_id, sid(req), ref(req)]);
  if (!found[0]) throw notFound('Assignment not found');
  if (!found[0].own_class) throw forbidden('This assignment is not for your class');
  const { rows } = await pool.query(
    `INSERT INTO submissions (school_id, assignment_id, student_id, title, file_link) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [sid(req), assignment_id, ref(req), title, file_link]);
  res.status(201).json(rows[0]);
});

// ================= NOTIFICATIONS (all roles) =================
router.get('/notifications', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, type, title, message, is_read, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [req.user.id]);
  res.json({ items: rows, unread: rows.filter((r) => !r.is_read).length });
});
router.post('/notifications/read-all', async (req, res) => {
  await pool.query(`UPDATE notifications SET is_read=TRUE WHERE user_id=$1`, [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
