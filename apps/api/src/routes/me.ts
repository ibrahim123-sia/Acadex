import { Router } from 'express';
import { assignmentBody, attendanceBody, gradesBody, id, rosterQuery, submissionBody } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertStudentsInClass, assertTeachesClass } from '../lib/access';
import { forbidden, notFound } from '../lib/errors';
import { todayIn } from '../lib/locale';
import { parsePage, sendPage } from '../lib/pagination';
import { institutionTimeZone } from '../lib/institution';
import { auth, currentUser, requirePermission, institutionId } from '../middleware/auth';

const router = Router();
router.use(auth);
router.use('/teacher', requirePermission('teaching.access'));
router.use('/student', requirePermission('learner.access'));

const ref = (req: Parameters<typeof currentUser>[0]) => currentUser(req).ref_id;

// ---------- STUDENT self ----------
router.get('/student/overview', async (req, res) => {
  const s = institutionId(req);
  const stu = ref(req);
  const [profile, grades, attendance, fee] = await Promise.all([
    db.query(
      `SELECT st.*, c.name section_name FROM students st LEFT JOIN sections c ON c.id=st.section_id WHERE st.id=$1 AND st.institution_id=$2`,
      [stu, s]
    ),
    db.query(
      `SELECT co.name subject, g.assignment_type, g.assignment_name, g.obtained_marks, g.total_marks,
              ROUND(g.obtained_marks/NULLIF(g.total_marks,0)*100,1) percentage
         FROM grades g LEFT JOIN course_offerings su ON su.id=g.offering_id LEFT JOIN courses co ON co.id=su.course_id
        WHERE g.student_id=$1 AND g.institution_id=$2 ORDER BY g.id DESC`,
      [stu, s]
    ),
    db.query(
      `SELECT status, count(*)::int c FROM student_attendance WHERE student_id=$1 AND institution_id=$2 GROUP BY status`,
      [stu, s]
    ),
    db.query(
      `SELECT total_fee, paid_amount, remaining_balance, payment_status, receipt_id
         FROM tuition_fee WHERE student_id=$1 AND institution_id=$2 ORDER BY id DESC LIMIT 1`,
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
  const s = institutionId(req);
  const tch = ref(req);
  const [profile, sections, subjects, students] = await Promise.all([
    db.query(`SELECT * FROM teachers WHERE id=$1 AND institution_id=$2`, [tch, s]),
    db.query(
      `SELECT DISTINCT c.id, c.name FROM section_staff ts JOIN sections c ON c.id=ts.section_id
        WHERE ts.teacher_id=$1 AND ts.institution_id=$2`,
      [tch, s]
    ),
    db.query(
      `SELECT ts.id, co.name subject, c.name section_name
         FROM section_staff ts JOIN course_offerings su ON su.id=ts.offering_id LEFT JOIN courses co ON co.id=su.course_id LEFT JOIN sections c ON c.id=ts.section_id
        WHERE ts.teacher_id=$1 AND ts.institution_id=$2`,
      [tch, s]
    ),
    db.query<{ c: number }>(
      `SELECT count(DISTINCT st.id)::int c
         FROM section_staff ts JOIN students st ON st.section_id=ts.section_id AND st.institution_id=ts.institution_id
        WHERE ts.teacher_id=$1 AND ts.institution_id=$2`,
      [tch, s]
    ),
  ]);
  res.json({
    profile: profile.rows[0] || null,
    sections: sections.rows,
    subjects: subjects.rows,
    studentCount: students.rows[0]?.c ?? 0,
  });
});

// Teacher: students in their sections (for gradebook / attendance)
router.get('/teacher/students', async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT st.id, st.roll_no, st.first_name||' '||st.last_name name, c.name section_name
       FROM section_staff ts
       JOIN students st ON st.section_id=ts.section_id AND st.institution_id=ts.institution_id
       JOIN sections c ON c.id=st.section_id
      WHERE ts.teacher_id=$1 AND ts.institution_id=$2 ORDER BY c.name, st.roll_no`,
    [ref(req), institutionId(req)]
  );
  res.json(rows);
});

// Announcements filtered by role audience
router.get('/announcements', requirePermission('announcements.view'), async (req, res) => {
  const aud = currentUser(req).role === 'teacher' ? ['All', 'Teachers'] : ['All', 'Students'];
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT id, title, target_audience, description, start_date, end_date, count(*) OVER() _total FROM announcements
      WHERE institution_id=$1 AND target_audience = ANY($2) ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [institutionId(req), aud, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ================= TEACHER WORKFLOWS =================

// Teacher's sections (distinct) with student counts
router.get('/teacher/sections', async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT c.id, c.name, c.code,
            (SELECT count(*) FROM students s WHERE s.section_id=c.id)::int students
       FROM section_staff ts JOIN sections c ON c.id=ts.section_id
      WHERE ts.teacher_id=$1 AND ts.institution_id=$2 ORDER BY c.id`,
    [ref(req), institutionId(req)]
  );
  res.json(rows);
});

// Roster for a class + attendance already marked for a date (defaults to today)
router.get('/teacher/class/:sectionId/roster', async (req, res) => {
  const sectionId = id.parse(req.params.sectionId);
  await assertTeachesClass(currentUser(req), sectionId);
  // "today" is the institution's calendar date, not the server's (UTC) one
  const date = rosterQuery.parse(req.query).date ?? todayIn(await institutionTimeZone(institutionId(req)));
  const { rows } = await db.query(
    `SELECT st.id, st.roll_no, st.first_name||' '||st.last_name name,
            (SELECT status FROM student_attendance a WHERE a.student_id=st.id AND a.section_id=$2 AND a.att_date=$3 LIMIT 1) status
       FROM students st WHERE st.section_id=$1 AND st.institution_id=$4 ORDER BY st.roll_no`,
    [sectionId, sectionId, date, institutionId(req)]
  );
  res.json({ date, students: rows });
});

// Bulk-save attendance for a whole class on a date (replaces that class's day)
router.post('/teacher/attendance', requirePermission('attendance.mark'), async (req, res) => {
  const { section_id, date, records } = attendanceBody.parse(req.body);
  const s = institutionId(req);
  await assertTeachesClass(currentUser(req), section_id);
  await assertStudentsInClass(s, section_id, records.map((r) => r.student_id));
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM student_attendance WHERE institution_id=$1 AND section_id=$2 AND att_date=$3`, [s, section_id, date]);
    for (const r of records) {
      await client.query(
        `INSERT INTO student_attendance (institution_id, student_id, section_id, att_date, status) VALUES ($1,$2,$3,$4,$5)`,
        [s, r.student_id, section_id, date, r.status]
      );
    }
  });
  res.json({ saved: records.length });
});

// Bulk grade entry for a class/subject (all-or-nothing)
router.post('/teacher/grades', requirePermission('grades.enter'), async (req, res) => {
  const b = gradesBody.parse(req.body);
  const s = institutionId(req);
  await assertTeachesClass(currentUser(req), b.section_id, b.offering_id);
  await assertStudentsInClass(s, b.section_id, b.records.map((r) => r.student_id));
  await withTransaction(async (client) => {
    for (const r of b.records) {
      await client.query(
        `INSERT INTO grades (institution_id, student_id, section_id, offering_id, assignment_type, assignment_name, obtained_marks, total_marks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s, r.student_id, b.section_id, b.offering_id, b.assignment_type, b.assignment_name, r.obtained_marks, b.total_marks]
      );
    }
  });
  res.json({ saved: b.records.length });
});

// Teacher's assignments
router.get('/teacher/assignments', async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.description, a.due_date, c.name section_name, co.name subject,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id=a.id)::int submissions, count(*) OVER() _total
       FROM assignments a LEFT JOIN sections c ON c.id=a.section_id LEFT JOIN course_offerings su ON su.id=a.offering_id LEFT JOIN courses co ON co.id=su.course_id
      WHERE a.teacher_id=$1 AND a.institution_id=$2 ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4`,
    [ref(req), institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// Assign an assignment to a whole class at once
router.post('/teacher/assignments', requirePermission('assignments.manage'), async (req, res) => {
  const { section_id, offering_id, title, description, due_date } = assignmentBody.parse(req.body);
  const s = institutionId(req);
  await assertTeachesClass(currentUser(req), section_id, offering_id);
  const { rows } = await db.query(
    `INSERT INTO assignments (institution_id, section_id, offering_id, teacher_id, title, description, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [s, section_id, offering_id, ref(req), title, description, due_date]
  );
  // notify students of the class (best effort: a failure only undoes this savepoint)
  await withTransaction((tx) =>
    tx.query(
      `INSERT INTO notifications (institution_id, user_id, type, title, message)
       SELECT $1, u.id, 'assignment', 'New assignment: ' || $2, 'A new assignment has been posted for your class.'
         FROM users u WHERE u.role='student' AND u.institution_id=$1
          AND u.ref_id IN (SELECT id FROM students WHERE section_id=$3 AND institution_id=$1)`,
      [s, title, section_id]
    )
  ).catch((err: unknown) => req.log.warn({ err }, 'assignment notifications failed'));
  res.status(201).json(rows[0]);
});

// ================= STUDENT =================
router.get('/student/assignments', async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.description, a.due_date, co.name subject,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=$1)::int submitted,
            count(*) OVER() _total
       FROM assignments a LEFT JOIN course_offerings su ON su.id=a.offering_id LEFT JOIN courses co ON co.id=su.course_id
      WHERE a.institution_id=$2 AND a.section_id=(SELECT section_id FROM students WHERE id=$1 AND institution_id=$2)
      ORDER BY a.due_date NULLS LAST, a.id LIMIT $3 OFFSET $4`,
    [ref(req), institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.post('/student/submissions', requirePermission('submissions.create'), async (req, res) => {
  const { assignment_id, title, file_link } = submissionBody.parse(req.body);
  const s = institutionId(req);
  // the assignment must exist in this institution and be set for the student's own class
  const { rows: found } = await db.query<{ own_class: boolean }>(
    `SELECT a.section_id = st.section_id AS own_class
       FROM assignments a JOIN students st ON st.id = $3 AND st.institution_id = a.institution_id
      WHERE a.id = $1 AND a.institution_id = $2`,
    [assignment_id, s, ref(req)]
  );
  if (!found[0]) throw notFound('Assignment not found');
  if (!found[0].own_class) throw forbidden('This assignment is not for your class');
  const { rows } = await db.query(
    `INSERT INTO submissions (institution_id, assignment_id, student_id, title, file_link) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [s, assignment_id, ref(req), title, file_link]
  );
  res.status(201).json(rows[0]);
});

// ================= NOTIFICATIONS (all roles) =================
router.get('/notifications', async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 20 });
  const userId = currentUser(req).id;
  const [items, counts] = await Promise.all([
    db.query(
      `SELECT id, type, title, message, is_read, created_at FROM notifications WHERE user_id=$1
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, pg.limit, pg.offset]
    ),
    db.query<{ total: number; unread: number }>(
      `SELECT count(*)::int total, count(*) FILTER (WHERE NOT is_read)::int unread FROM notifications WHERE user_id=$1`,
      [userId]
    ),
  ]);
  res.json({ items: items.rows, unread: counts.rows[0]?.unread ?? 0, total: counts.rows[0]?.total ?? 0 });
});

router.post('/notifications/read-all', async (req, res) => {
  await db.query(`UPDATE notifications SET is_read=TRUE WHERE user_id=$1`, [currentUser(req).id]);
  res.json({ ok: true });
});

export default router;
