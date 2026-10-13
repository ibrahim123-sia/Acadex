import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import {
  announcementBody,
  collectFeeBody,
  createClassBody,
  createStudentBody,
  createTeacherBody,
  studentSearchQuery,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { conflict } from '../lib/errors';
import { id } from '@acadex/shared';
import { todayIn } from '../lib/locale';
import { parsePage, sendPage } from '../lib/pagination';
import { inviteUser } from '../auth/invites';
import { institutionTimeZone } from '../lib/institution';
import { auth, currentUser, requirePermission, institutionId, userCan } from '../middleware/auth';
import { grantSystemRole } from '../rbac';

const router = Router();
// Institution administration: each route requires its own permission (institution admins hold all of
// them; custom roles such as "Accountant" can hold a subset).
router.use(auth);

/** An institution account with no password yet: the person sets one through the invitation. */
const createAccount = async (client: typeof db, institutionIdValue: number, role: string, email: string, fullName: string, refId: number | null) =>
  (
    await client.query<{ id: number }>(
      `INSERT INTO users (institution_id, role, email, password_hash, full_name, ref_id) VALUES ($1,$2,$3,NULL,$4,$5) RETURNING id`,
      [institutionIdValue, role, email, fullName, refId]
    )
  ).rows[0]!.id;
const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';
const auditAs = (req: Request, action: string, entity: string, detail: string) =>
  audit({ institutionId: institutionId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity, detail });

// ---------- Admin dashboard ----------
router.get('/dashboard', requirePermission('institution.dashboard.read'), async (req, res) => {
  const s = institutionId(req);
  const today = todayIn(await institutionTimeZone(s));
  const [students, teachers, classes, fees, feeStatus, attToday, topClasses, recent] = await Promise.all([
    db.query<{ c: number }>(`SELECT count(*)::int c FROM students WHERE institution_id=$1`, [s]),
    db.query<{ c: number }>(`SELECT count(*)::int c FROM teachers WHERE institution_id=$1`, [s]),
    db.query<{ c: number }>(`SELECT count(*)::int c FROM classes WHERE institution_id=$1`, [s]),
    db.query<{ collected: string; outstanding: string }>(
      `SELECT COALESCE(SUM(paid_amount),0)::numeric collected, COALESCE(SUM(remaining_balance),0)::numeric outstanding
         FROM tuition_fee WHERE institution_id=$1`,
      [s]
    ),
    db.query(`SELECT payment_status, count(*)::int c FROM tuition_fee WHERE institution_id=$1 GROUP BY payment_status`, [s]),
    db.query(
      `SELECT status, count(*)::int c FROM student_attendance WHERE institution_id=$1 AND att_date >= $2::date - 7 GROUP BY status`,
      [s, today]
    ),
    db.query(
      `SELECT c.name, count(st.id)::int students FROM classes c LEFT JOIN students st ON st.class_id=c.id
        WHERE c.institution_id=$1 GROUP BY c.id, c.name ORDER BY students DESC`,
      [s]
    ),
    db.query(
      `SELECT id, first_name, last_name, roll_no, created_at FROM students WHERE institution_id=$1 ORDER BY created_at DESC LIMIT 6`,
      [s]
    ),
  ]);
  res.json({
    students: students.rows[0]?.c ?? 0,
    teachers: teachers.rows[0]?.c ?? 0,
    classes: classes.rows[0]?.c ?? 0,
    feeCollected: Number(fees.rows[0]?.collected ?? 0),
    feeOutstanding: Number(fees.rows[0]?.outstanding ?? 0),
    feeStatus: feeStatus.rows,
    attendance: attToday.rows,
    classDistribution: topClasses.rows,
    recentStudents: recent.rows,
  });
});

// ---------- Students ----------
router.get('/students', requirePermission('students.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { search } = studentSearchQuery.parse({ search: req.query.search });
  const q = `%${search.toLowerCase()}%`;
  const { rows } = await db.query(
    `SELECT st.id, st.roll_no, st.first_name, st.last_name, st.email, st.gender, st.age, st.status,
            c.name class_name,
            COALESCE((SELECT payment_status FROM tuition_fee f WHERE f.student_id=st.id AND f.institution_id=st.institution_id
                      ORDER BY id DESC LIMIT 1),'—') fee_status,
            u.id user_id, (u.id IS NOT NULL AND u.password_hash IS NULL) invite_pending,
            count(*) OVER() _total
       FROM students st LEFT JOIN classes c ON c.id=st.class_id
       LEFT JOIN users u ON u.ref_id=st.id AND u.role='student' AND u.institution_id=st.institution_id
      WHERE st.institution_id=$1 AND (LOWER(st.first_name||' '||st.last_name) LIKE $2 OR LOWER(st.roll_no) LIKE $2)
      ORDER BY st.created_at DESC, st.id DESC LIMIT $3 OFFSET $4`,
    [institutionId(req), q, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Teachers ----------
router.get('/teachers', requirePermission('staff.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT t.id, t.first_name, t.last_name, t.email, t.gender, t.phone, t.qualification,
            (SELECT count(*) FROM teacher_subjects ts WHERE ts.teacher_id=t.id)::int subjects,
            u.id user_id, (u.id IS NOT NULL AND u.password_hash IS NULL) invite_pending,
            count(*) OVER() _total
       FROM teachers t LEFT JOIN users u ON u.ref_id=t.id AND u.role='teacher' AND u.institution_id=t.institution_id
      WHERE t.institution_id=$1 ORDER BY t.created_at DESC, t.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Classes & subjects ----------
router.get('/classes', requirePermission('classes.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 }); // also feeds class dropdowns
  const { rows } = await db.query(
    `SELECT c.id, c.code, c.name, c.section,
            (SELECT count(*) FROM students s WHERE s.class_id=c.id)::int students,
            (SELECT count(*) FROM subjects su WHERE su.class_id=c.id)::int subjects,
            count(*) OVER() _total
       FROM classes c WHERE c.institution_id=$1 ORDER BY c.id LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Fees ----------
router.get('/fees', requirePermission('fees.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT f.id, f.receipt_id, f.total_fee, f.paid_amount, f.remaining_balance, f.payment_status, f.payment_date,
            st.first_name||' '||st.last_name student, st.roll_no, count(*) OVER() _total
       FROM tuition_fee f JOIN students st ON st.id=f.student_id
      WHERE f.institution_id=$1 ORDER BY f.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// Fee totals for the whole institution (the fees list is paginated, so the UI can't add it up)
router.get('/fees/summary', requirePermission('fees.read'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(paid_amount),0)::float8 collected, COALESCE(SUM(remaining_balance),0)::float8 outstanding
       FROM tuition_fee WHERE institution_id=$1`,
    [institutionId(req)]
  );
  res.json(rows[0]);
});

// ---------- Grades ----------
router.get('/grades', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT g.id, st.first_name||' '||st.last_name student, st.roll_no, c.name class_name,
            su.name subject, g.assignment_type, g.assignment_name, g.obtained_marks, g.total_marks,
            ROUND(g.obtained_marks / NULLIF(g.total_marks,0) * 100, 1) percentage, count(*) OVER() _total
       FROM grades g JOIN students st ON st.id=g.student_id
       LEFT JOIN classes c ON c.id=g.class_id LEFT JOIN subjects su ON su.id=g.subject_id
      WHERE g.institution_id=$1 ORDER BY g.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Attendance (most recent first) ----------
router.get('/attendance', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT a.att_date, st.first_name||' '||st.last_name student, st.roll_no, c.name class_name, a.subject, a.status,
            count(*) OVER() _total
       FROM student_attendance a JOIN students st ON st.id=a.student_id LEFT JOIN classes c ON c.id=a.class_id
      WHERE a.institution_id=$1 ORDER BY a.att_date DESC, a.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Timetable ----------
router.get('/timetable', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT tt.day_of_week, tt.time_slot, tt.subject, c.name class_name,
            t.first_name||' '||t.last_name teacher, count(*) OVER() _total
       FROM timetable tt JOIN classes c ON c.id=tt.class_id LEFT JOIN teachers t ON t.id=tt.teacher_id
      WHERE tt.institution_id=$1 ORDER BY c.id, tt.time_slot, tt.id LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Exams ----------
router.get('/exams', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT e.exam_name, e.subject, e.exam_date, e.time_slot, e.total_marks, c.name class_name, count(*) OVER() _total
       FROM exam_schedule e LEFT JOIN classes c ON c.id=e.class_id
      WHERE e.institution_id=$1 ORDER BY e.exam_date, e.id LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Announcements ----------
router.get('/announcements', requirePermission('announcements.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT id, title, target_audience, description, start_date, end_date, created_at, count(*) OVER() _total
       FROM announcements WHERE institution_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.post('/announcements', requirePermission('announcements.manage'), async (req, res) => {
  const { title, target_audience, description, end_date } = announcementBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO announcements (institution_id, title, target_audience, description, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [institutionId(req), title, target_audience, description, end_date]
  );
  res.status(201).json(rows[0]);
});

// ---------- WRITE: admissions / faculty / classes / fees ----------

// Admit a new student (creates the student record and an account, and emails an invitation)
router.post('/students', requirePermission('students.manage'), async (req, res) => {
  const s = institutionId(req);
  const b = createStudentBody.parse(req.body);
  if (b.class_id) await assertInInstitution('classes', b.class_id, s);
  try {
    const st = await withTransaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO students (institution_id, roll_no, first_name, last_name, age, gender, email, dob, class_id, guardian_name, guardian_phone, city)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [s, b.roll_no, b.first_name, b.last_name, b.age, b.gender, b.email, b.dob, b.class_id, b.guardian_name, b.guardian_phone, b.city]
        )
      ).rows[0];
      const userId = await createAccount(client, s, 'student', b.email, `${b.first_name} ${b.last_name}`, row.id);
      await grantSystemRole(client, userId, 'student', s, currentUser(req).id);
      return { row, userId };
    });
    const invite = await inviteUser(st.userId, { id: currentUser(req).id, name: currentUser(req).name });
    await auditAs(req, 'admit_student', 'Student', `${b.first_name} ${b.last_name}`);
    res.status(201).json({ ...st.row, user_id: st.userId, invite });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A user with this email already exists');
    throw e;
  }
});

// Add a teacher (creates the staff record and an account, and emails an invitation)
router.post('/teachers', requirePermission('staff.manage'), async (req, res) => {
  const s = institutionId(req);
  const b = createTeacherBody.parse(req.body);
  try {
    const t = await withTransaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO teachers (institution_id, first_name, last_name, gender, dob, email, phone, cnic, qualification)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [s, b.first_name, b.last_name, b.gender, b.dob, b.email, b.phone, b.cnic, b.qualification]
        )
      ).rows[0];
      const userId = await createAccount(client, s, 'teacher', b.email, `${b.first_name} ${b.last_name}`, row.id);
      await grantSystemRole(client, userId, 'teacher', s, currentUser(req).id);
      return { row, userId };
    });
    const invite = await inviteUser(t.userId, { id: currentUser(req).id, name: currentUser(req).name });
    await auditAs(req, 'add_teacher', 'Teacher', `${b.first_name} ${b.last_name}`);
    res.status(201).json({ ...t.row, user_id: t.userId, invite });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A user with this email already exists');
    throw e;
  }
});

// Send a new invitation (the previous link stops working). Only for accounts that haven't
// set a password yet; others can use "forgot password".
router.post('/users/:userId/invite', async (req, res) => {
  const userId = id.parse(req.params.userId);
  const { rows } = await db.query<{ id: number; role: string; password_hash: string | null }>(
    `SELECT id, role, password_hash FROM users WHERE id=$1 AND institution_id=$2`,
    [userId, institutionId(req)]
  );
  const u = rows[0];
  if (!u) throw notFound('User not found');
  const needed = u.role === 'student' ? 'students.manage' : u.role === 'parent' ? 'students.manage' : 'staff.manage';
  if (!userCan(req, needed)) throw forbidden('You do not have permission to do this');
  if (u.password_hash) throw badRequest('This person has already activated their account. They can use "Forgot password".');
  const invite = await inviteUser(u.id, { id: currentUser(req).id, name: currentUser(req).name });
  await auditAs(req, 'resend_invite', 'User', invite.email);
  res.json({ invite });
});

// Create a class
router.post('/classes', requirePermission('classes.manage'), async (req, res) => {
  const { code, name, section } = createClassBody.parse(req.body);
  try {
    const { rows } = await db.query(
      `INSERT INTO classes (institution_id, code, name, section) VALUES ($1,$2,$3,$4) RETURNING *`,
      [institutionId(req), code, name, section]
    );
    await auditAs(req, 'create_class', 'Class', name);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Class code already exists');
    throw e;
  }
});

// Collect a fee
router.post('/fees', requirePermission('fees.manage'), async (req, res) => {
  const s = institutionId(req);
  const { student_id, total_fee: total, paid_amount: paid } = collectFeeBody.parse(req.body);
  await assertInInstitution('students', student_id, s);
  const remaining = total - paid;
  const status = remaining <= 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Pending';
  const receipt = 'RCP-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const paidOn = todayIn(await institutionTimeZone(s));
  const { rows } = await db.query(
    `INSERT INTO tuition_fee (institution_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status, payment_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [s, receipt, student_id, total, paid, remaining, status, paidOn]
  );
  await auditAs(req, 'collect_fee', 'TuitionFee', receipt);
  res.status(201).json(rows[0]);
});

export default router;
