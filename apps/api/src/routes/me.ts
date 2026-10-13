import { Router } from 'express';
import { assignmentBody, attendanceBody, gradesBody, id, rosterQuery, submissionBody } from '@acadex/shared';
import { pool } from '../db/pool';
import { withTransaction } from '../db/tx';
import { assertStudentsInClass, assertTeachesClass } from '../lib/access';
import { forbidden, notFound } from '../lib/errors';
import { todayIn } from '../lib/locale';
import { parsePage, sendPage } from '../lib/pagination';
import { schoolTimeZone } from '../lib/school';
import { auth, currentUser, requirePermission, schoolId } from '../middleware/auth';

const router = Router();
router.use(auth);
router.use('/teacher', requirePermission('teaching.access'));
router.use('/student', requirePermission('learner.access'));

const ref = (req: Parameters<typeof currentUser>[0]) => currentUser(req).ref_id;

// ---------- STUDENT self ----------
router.get('/student/overview', async (req, res) => {
  const s = schoolId(req);
  const stu = ref(req);
  const [profile, grades, attendance, fee] = await Promise.all([
    pool.query(
      `SELECT st.*, c.name class_name FROM students st LEFT JOIN classes c ON c.id=st.class_id WHERE st.id=$1 AND st.school_id=$2`,
      [stu, s]
    ),
    pool.query(
      `SELECT su.name subject, g.assignment_type, g.assignment_name, g.obtained_marks, g.total_marks,
              ROUND(g.obtained_marks/NULLIF(g.total_marks,0)*100,1) percentage
         FROM grades g LEFT JOIN subjects su ON su.id=g.subject_id
        WHERE g.student_id=$1 AND g.school_id=$2 ORDER BY g.id DESC`,
      [stu, s]
    ),
    pool.query(
      `SELECT status, count(*)::int c FROM student_attendance WHERE student_id=$1 AND school_id=$2 GROUP BY status`,
      [stu, s]
    ),
    pool.query(
      `SELECT total_fee, paid_amount, remaining_balance, payment_status, receipt_id
         FROM tuition_fee WHERE student_id=$1 AND school_id=$2 ORDER BY id DESC LIMIT 1`,
      [stu, s]
    ),
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
  const s = schoolId(req);
  const tch = ref(req);
  const [profile, classes, subjects, students] = await Promise.all([
    pool.query(`SELECT * FROM teachers WHERE id=$1 AND school_id=$2`, [tch, s]),
    pool.query(
      `SELECT DISTINCT c.id, c.name FROM teacher_subjects ts JOIN classes c ON c.id=ts.class_id
        WHERE ts.teacher_id=$1 AND ts.school_id=$2`,
      [tch, s]
    ),
    pool.query(
      `SELECT ts.id, su.name subject, c.name class_name
         FROM teacher_subjects ts JOIN subjects su ON su.id=ts.subject_id LEFT JOIN classes c ON c.id=ts.class_id
        WHERE ts.teacher_id=$1 AND ts.school_id=$2`,
      [tch, s]
    ),
    pool.query<{ c: number }>(
      `SELECT count(DISTINCT st.id)::int c
         FROM teacher_subjects ts JOIN students st ON st.class_id=ts.class_id AND st.school_id=ts.school_id
        WHERE ts.teacher_id=$1 AND ts.school_id=$2`,
      [tch, s]
    ),
  ]);
  res.json({
    profile: profile.rows[0] || null,
    classes: classes.rows,
    subjects: subjects.rows,
    studentCount: students.rows[0]?.c ?? 0,
  });
});

// Teacher: students in their classes (for gradebook / attendance)
router.get('/teacher/students', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT st.id, st.roll_no, st.first_name||' '||st.last_name name, c.name class_name
       FROM teacher_subjects ts
       JOIN students st ON st.class_id=ts.class_id AND st.school_id=ts.school_id
       JOIN classes c ON c.id=st.class_id
      WHERE ts.teacher_id=$1 AND ts.school_id=$2 ORDER BY c.name, st.roll_no`,
    [ref(req), schoolId(req)]
  );
  res.json(rows);
});

// Announcements filtered by role audience
router.get('/announcements', requirePermission('announcements.view'), async (req, res) => {
  const aud = currentUser(req).role === 'teacher' ? ['All', 'Teachers'] : ['All', 'Students'];
  const pg = parsePage(req.query);
  const { rows } = await pool.query(
    `SELECT id, title, target_audience, description, start_date, end_date, count(*) OVER() _total FROM announcements
      WHERE school_id=$1 AND target_audience = ANY($2) ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [schoolId(req), aud, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ================= TEACHER WORKFLOWS =================

// Teacher's classes (distinct) with student counts
router.get('/teacher/classes', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.code,
            (SELECT count(*) FROM students s WHERE s.class_id=c.id)::int students
       FROM teacher_subjects ts JOIN classes c ON c.id=ts.class_id
      WHERE ts.teacher_id=$1 AND ts.school_id=$2 ORDER BY c.id`,
    [ref(req), schoolId(req)]
  );
  res.json(rows);
});

// Roster for a class + attendance already marked for a date (defaults to today)
router.get('/teacher/class/:classId/roster', async (req, res) => {
  const classId = id.parse(req.params.classId);
  await assertTeachesClass(currentUser(req), classId);
  // "today" is the school's calendar date, not the server's (UTC) one
  const date = rosterQuery.parse(req.query).date ?? todayIn(await schoolTimeZone(schoolId(req)));
  const { rows } = await pool.query(
    `SELECT st.id, st.roll_no, st.first_name||' '||st.last_name name,
            (SELECT status FROM student_attendance a WHERE a.student_id=st.id AND a.class_id=$2 AND a.att_date=$3 LIMIT 1) status
       FROM students st WHERE st.class_id=$1 AND st.school_id=$4 ORDER BY st.roll_no`,
    [classId, classId, date, schoolId(req)]
  );
  res.json({ date, students: rows });
});

// Bulk-save attendance for a whole class on a date (replaces that class's day)
router.post('/teacher/attendance', requirePermission('attendance.mark'), async (req, res) => {
  const { class_id, date, records } = attendanceBody.parse(req.body);
  const s = schoolId(req);
  await assertTeachesClass(currentUser(req), class_id);
  await assertStudentsInClass(s, class_id, records.map((r) => r.student_id));
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM student_attendance WHERE school_id=$1 AND class_id=$2 AND att_date=$3`, [s, class_id, date]);
    for (const r of records) {
      await client.query(
        `INSERT INTO student_attendance (school_id, student_id, class_id, att_date, status) VALUES ($1,$2,$3,$4,$5)`,
        [s, r.student_id, class_id, date, r.status]
      );
    }
  });
  res.json({ saved: records.length });
});

// Bulk grade entry for a class/subject (all-or-nothing)
router.post('/teacher/grades', requirePermission('grades.enter'), async (req, res) => {
  const b = gradesBody.parse(req.body);
  const s = schoolId(req);
  await assertTeachesClass(currentUser(req), b.class_id, b.subject_id);
  await assertStudentsInClass(s, b.class_id, b.records.map((r) => r.student_id));
  await withTransaction(async (client) => {
    for (const r of b.records) {
      await client.query(
        `INSERT INTO grades (school_id, student_id, class_id, subject_id, assignment_type, assignment_name, obtained_marks, total_marks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s, r.student_id, b.class_id, b.subject_id, b.assignment_type, b.assignment_name, r.obtained_marks, b.total_marks]
      );
    }
  });
  res.json({ saved: b.records.length });
});

// Teacher's assignments
router.get('/teacher/assignments', async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.description, a.due_date, c.name class_name, su.name subject,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id=a.id)::int submissions, count(*) OVER() _total
       FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects su ON su.id=a.subject_id
      WHERE a.teacher_id=$1 AND a.school_id=$2 ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4`,
    [ref(req), schoolId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// Assign an assignment to a whole class at once
router.post('/teacher/assignments', requirePermission('assignments.manage'), async (req, res) => {
  const { class_id, subject_id, title, description, due_date } = assignmentBody.parse(req.body);
  const s = schoolId(req);
  await assertTeachesClass(currentUser(req), class_id, subject_id);
  const { rows } = await pool.query(
    `INSERT INTO assignments (school_id, class_id, subject_id, teacher_id, title, description, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [s, class_id, subject_id, ref(req), title, description, due_date]
  );
  // notify students of the class (best effort)
  await pool
    .query(
      `INSERT INTO notifications (school_id, user_id, type, title, message)
       SELECT $1, u.id, 'assignment', 'New assignment: ' || $2, 'A new assignment has been posted for your class.'
         FROM users u WHERE u.role='student' AND u.school_id=$1
          AND u.ref_id IN (SELECT id FROM students WHERE class_id=$3 AND school_id=$1)`,
      [s, title, class_id]
    )
    .catch((err: unknown) => req.log.warn({ err }, 'assignment notifications failed'));
  res.status(201).json(rows[0]);
});

// ================= STUDENT =================
router.get('/student/assignments', async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.description, a.due_date, su.name subject,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=$1)::int submitted,
            count(*) OVER() _total
       FROM assignments a LEFT JOIN subjects su ON su.id=a.subject_id
      WHERE a.school_id=$2 AND a.class_id=(SELECT class_id FROM students WHERE id=$1 AND school_id=$2)
      ORDER BY a.due_date NULLS LAST, a.id LIMIT $3 OFFSET $4`,
    [ref(req), schoolId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.post('/student/submissions', requirePermission('submissions.create'), async (req, res) => {
  const { assignment_id, title, file_link } = submissionBody.parse(req.body);
  const s = schoolId(req);
  // the assignment must exist in this school and be set for the student's own class
  const { rows: found } = await pool.query<{ own_class: boolean }>(
    `SELECT a.class_id = st.class_id AS own_class
       FROM assignments a JOIN students st ON st.id = $3 AND st.school_id = a.school_id
      WHERE a.id = $1 AND a.school_id = $2`,
    [assignment_id, s, ref(req)]
  );
  if (!found[0]) throw notFound('Assignment not found');
  if (!found[0].own_class) throw forbidden('This assignment is not for your class');
  const { rows } = await pool.query(
    `INSERT INTO submissions (school_id, assignment_id, student_id, title, file_link) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [s, assignment_id, ref(req), title, file_link]
  );
  res.status(201).json(rows[0]);
});

// ================= NOTIFICATIONS (all roles) =================
router.get('/notifications', async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 20 });
  const userId = currentUser(req).id;
  const [items, counts] = await Promise.all([
    pool.query(
      `SELECT id, type, title, message, is_read, created_at FROM notifications WHERE user_id=$1
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, pg.limit, pg.offset]
    ),
    pool.query<{ total: number; unread: number }>(
      `SELECT count(*)::int total, count(*) FILTER (WHERE NOT is_read)::int unread FROM notifications WHERE user_id=$1`,
      [userId]
    ),
  ]);
  res.json({ items: items.rows, unread: counts.rows[0]?.unread ?? 0, total: counts.rows[0]?.total ?? 0 });
});

router.post('/notifications/read-all', async (req, res) => {
  await pool.query(`UPDATE notifications SET is_read=TRUE WHERE user_id=$1`, [currentUser(req).id]);
  res.json({ ok: true });
});

export default router;
