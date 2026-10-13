const { Router } = require('../lib/router');
const crypto = require('crypto');
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { assertInSchool } = require('../lib/access');
const { HttpError } = require('../lib/errors');
const { z, id, optionalId, isoDate, text, requiredText, money } = require('../lib/validate');
const { withTransaction } = require('../db/tx');
const { todayIn } = require('../lib/locale');
const { schoolSettings } = require('../lib/school');
const { generateTempPassword, hashPassword } = require('../lib/passwords');

const router = Router();
// Every /api/school route is for the school's administrator only.
router.use(auth, requireRole('school_admin'));

// tenant id helper — everything is scoped to the caller's school
const sid = (req) => req.user.school_id;
const audit = (school, actor, action, entity, detail) =>
  pool.query(`INSERT INTO audit_log (school_id, actor, action, entity, detail) VALUES ($1,$2,$3,$4,$5)`,
    [school, actor, action, entity, detail]).catch(() => {});

// ---------- Admin dashboard ----------
router.get('/dashboard', async (req, res) => {
  const s = sid(req);
  const today = todayIn((await schoolSettings(s)).timezone);
  const [students, teachers, classes, fees, feeStatus, attToday, topClasses, recent] = await Promise.all([
    pool.query(`SELECT count(*)::int c FROM students WHERE school_id=$1`, [s]),
    pool.query(`SELECT count(*)::int c FROM teachers WHERE school_id=$1`, [s]),
    pool.query(`SELECT count(*)::int c FROM classes WHERE school_id=$1`, [s]),
    pool.query(`SELECT COALESCE(SUM(paid_amount),0)::numeric collected, COALESCE(SUM(remaining_balance),0)::numeric outstanding FROM tuition_fee WHERE school_id=$1`, [s]),
    pool.query(`SELECT payment_status, count(*)::int c FROM tuition_fee WHERE school_id=$1 GROUP BY payment_status`, [s]),
    pool.query(`SELECT status, count(*)::int c FROM student_attendance WHERE school_id=$1 AND att_date >= $2::date - 7 GROUP BY status`, [s, today]),
    pool.query(`SELECT c.name, count(st.id)::int students FROM classes c LEFT JOIN students st ON st.class_id=c.id WHERE c.school_id=$1 GROUP BY c.id, c.name ORDER BY students DESC`, [s]),
    pool.query(`SELECT id, first_name, last_name, roll_no, created_at FROM students WHERE school_id=$1 ORDER BY created_at DESC LIMIT 6`, [s]),
  ]);
  res.json({
    students: students.rows[0].c,
    teachers: teachers.rows[0].c,
    classes: classes.rows[0].c,
    feeCollected: Number(fees.rows[0].collected),
    feeOutstanding: Number(fees.rows[0].outstanding),
    feeStatus: feeStatus.rows,
    attendance: attToday.rows,
    classDistribution: topClasses.rows,
    recentStudents: recent.rows,
  });
});

// ---------- Students ----------
router.get('/students', async (req, res) => {
  const q = `%${(req.query.search || '').toLowerCase()}%`;
  const { rows } = await pool.query(
    `SELECT st.id, st.roll_no, st.first_name, st.last_name, st.email, st.gender, st.age, st.status,
            c.name class_name,
            COALESCE((SELECT payment_status FROM tuition_fee f WHERE f.student_id=st.id ORDER BY id DESC LIMIT 1),'—') fee_status
     FROM students st LEFT JOIN classes c ON c.id=st.class_id
     WHERE st.school_id=$1 AND (LOWER(st.first_name||' '||st.last_name) LIKE $2 OR LOWER(st.roll_no) LIKE $2)
     ORDER BY st.created_at DESC`, [sid(req), q]);
  res.json(rows);
});

// ---------- Teachers ----------
router.get('/teachers', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.first_name, t.last_name, t.email, t.gender, t.phone, t.qualification,
            (SELECT count(*) FROM teacher_subjects ts WHERE ts.teacher_id=t.id)::int subjects
     FROM teachers t WHERE t.school_id=$1 ORDER BY t.created_at DESC`, [sid(req)]);
  res.json(rows);
});

// ---------- Classes & subjects ----------
router.get('/classes', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.code, c.name, c.section,
       (SELECT count(*) FROM students s WHERE s.class_id=c.id)::int students,
       (SELECT count(*) FROM subjects su WHERE su.class_id=c.id)::int subjects
     FROM classes c WHERE c.school_id=$1 ORDER BY c.id`, [sid(req)]);
  res.json(rows);
});

// ---------- Fees ----------
router.get('/fees', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.id, f.receipt_id, f.total_fee, f.paid_amount, f.remaining_balance, f.payment_status, f.payment_date,
            st.first_name||' '||st.last_name student, st.roll_no
     FROM tuition_fee f JOIN students st ON st.id=f.student_id
     WHERE f.school_id=$1 ORDER BY f.id DESC`, [sid(req)]);
  res.json(rows);
});

// ---------- Grades ----------
router.get('/grades', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, st.first_name||' '||st.last_name student, st.roll_no, c.name class_name,
            su.name subject, g.assignment_type, g.assignment_name, g.obtained_marks, g.total_marks,
            ROUND(g.obtained_marks / NULLIF(g.total_marks,0) * 100, 1) percentage
     FROM grades g JOIN students st ON st.id=g.student_id
       LEFT JOIN classes c ON c.id=g.class_id LEFT JOIN subjects su ON su.id=g.subject_id
     WHERE g.school_id=$1 ORDER BY g.id DESC LIMIT 100`, [sid(req)]);
  res.json(rows);
});

// ---------- Attendance (recent, grouped) ----------
router.get('/attendance', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.att_date, st.first_name||' '||st.last_name student, st.roll_no, c.name class_name, a.subject, a.status
     FROM student_attendance a JOIN students st ON st.id=a.student_id LEFT JOIN classes c ON c.id=a.class_id
     WHERE a.school_id=$1 ORDER BY a.att_date DESC, a.id DESC LIMIT 60`, [sid(req)]);
  res.json(rows);
});

// ---------- Timetable ----------
router.get('/timetable', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT tt.day_of_week, tt.time_slot, tt.subject, c.name class_name,
            t.first_name||' '||t.last_name teacher
     FROM timetable tt JOIN classes c ON c.id=tt.class_id LEFT JOIN teachers t ON t.id=tt.teacher_id
     WHERE tt.school_id=$1 ORDER BY c.id, tt.time_slot`, [sid(req)]);
  res.json(rows);
});

// ---------- Exams ----------
router.get('/exams', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.exam_name, e.subject, e.exam_date, e.time_slot, e.total_marks, c.name class_name
     FROM exam_schedule e LEFT JOIN classes c ON c.id=e.class_id
     WHERE e.school_id=$1 ORDER BY e.exam_date`, [sid(req)]);
  res.json(rows);
});

// ---------- Announcements ----------
router.get('/announcements', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, target_audience, description, start_date, end_date, created_at
     FROM announcements WHERE school_id=$1 ORDER BY created_at DESC`, [sid(req)]);
  res.json(rows);
});
const announcementBody = z.object({
  title: requiredText(200),
  target_audience: z.enum(['All', 'Teachers', 'Students']).default('All'),
  description: requiredText(5000),
  end_date: z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => v || null),
});
router.post('/announcements', async (req, res) => {
  const { title, target_audience, description, end_date } = announcementBody.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO announcements (school_id, title, target_audience, description, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [sid(req), title, target_audience, description, end_date]);
  res.status(201).json(rows[0]);
});

// ---------- WRITE: admissions / faculty / classes / fees ----------
const optionalDate = z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => v || null);
const person = {
  first_name: requiredText(80),
  last_name: requiredText(80),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  gender: text(20).optional().transform((v) => v || null),
  dob: optionalDate,
};

// Admit a new student (creates student + login)
const studentBody = z.object({
  ...person,
  age: z.union([z.coerce.number().int().min(1).max(120), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v)),
  class_id: optionalId,
  guardian_name: text(120).default(''),
  guardian_phone: text(30).default(''),
  city: text(80).default(''),
  roll_no: text(40).optional().transform((v) => v || null),
});
router.post('/students', async (req, res) => {
  const s = sid(req);
  const b = studentBody.parse(req.body);
  if (b.class_id) await assertInSchool('classes', b.class_id, s);
  const tempPassword = generateTempPassword();
  try {
    const st = await withTransaction(async (client) => {
      const row = (await client.query(
        `INSERT INTO students (school_id, roll_no, first_name, last_name, age, gender, email, dob, class_id, guardian_name, guardian_phone, city)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [s, b.roll_no, b.first_name, b.last_name, b.age, b.gender, b.email, b.dob, b.class_id, b.guardian_name, b.guardian_phone, b.city])).rows[0];
      await client.query(
        `INSERT INTO users (school_id, role, email, password_hash, full_name, ref_id, must_change_password) VALUES ($1,'student',$2,$3,$4,$5,TRUE)`,
        [s, b.email, await hashPassword(tempPassword), `${b.first_name} ${b.last_name}`, row.id]);
      return row;
    });
    audit(s, req.user.name, 'admit_student', 'Student', `${b.first_name} ${b.last_name}`);
    res.status(201).json({ ...st, login: { email: b.email, tempPassword } });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'A user with this email already exists');
    throw e;
  }
});

// Add a teacher (creates teacher + login)
const teacherBody = z.object({
  ...person,
  phone: text(30).default(''),
  cnic: text(30).default(''),
  qualification: text(120).default(''),
});
router.post('/teachers', async (req, res) => {
  const s = sid(req);
  const b = teacherBody.parse(req.body);
  const tempPassword = generateTempPassword();
  try {
    const t = await withTransaction(async (client) => {
      const row = (await client.query(
        `INSERT INTO teachers (school_id, first_name, last_name, gender, dob, email, phone, cnic, qualification)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [s, b.first_name, b.last_name, b.gender, b.dob, b.email, b.phone, b.cnic, b.qualification])).rows[0];
      await client.query(
        `INSERT INTO users (school_id, role, email, password_hash, full_name, ref_id, must_change_password) VALUES ($1,'teacher',$2,$3,$4,$5,TRUE)`,
        [s, b.email, await hashPassword(tempPassword), `${b.first_name} ${b.last_name}`, row.id]);
      return row;
    });
    audit(s, req.user.name, 'add_teacher', 'Teacher', `${b.first_name} ${b.last_name}`);
    res.status(201).json({ ...t, login: { email: b.email, tempPassword } });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'A user with this email already exists');
    throw e;
  }
});

// Create a class
const classBody = z.object({ code: requiredText(20), name: requiredText(80), section: text(20).optional().transform((v) => v || 'A') });
router.post('/classes', async (req, res) => {
  const { code, name, section } = classBody.parse(req.body);
  try {
    const { rows } = await pool.query(`INSERT INTO classes (school_id, code, name, section) VALUES ($1,$2,$3,$4) RETURNING *`,
      [sid(req), code, name, section]);
    audit(sid(req), req.user.name, 'create_class', 'Class', name);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Class code already exists');
    throw e;
  }
});

// Collect a fee
const feeBody = z
  .object({ student_id: id, total_fee: money, paid_amount: money.default(0) })
  .refine((b) => b.paid_amount <= b.total_fee, { message: 'Paid amount cannot exceed the total fee', path: ['paid_amount'] });
router.post('/fees', async (req, res) => {
  const s = sid(req);
  const { student_id, total_fee: total, paid_amount: paid } = feeBody.parse(req.body);
  await assertInSchool('students', student_id, s);
  const remaining = total - paid;
  const status = remaining <= 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Pending';
  const receipt = 'RCP-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const paidOn = todayIn((await schoolSettings(s)).timezone);
  const { rows } = await pool.query(
    `INSERT INTO tuition_fee (school_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status, payment_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [s, receipt, student_id, total, paid, remaining, status, paidOn]);
  audit(s, req.user.name, 'collect_fee', 'TuitionFee', receipt);
  res.status(201).json(rows[0]);
});

module.exports = router;
