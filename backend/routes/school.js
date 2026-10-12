const { Router } = require('../lib/router');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');

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
  const [students, teachers, classes, fees, feeStatus, attToday, topClasses, recent] = await Promise.all([
    pool.query(`SELECT count(*)::int c FROM students WHERE school_id=$1`, [s]),
    pool.query(`SELECT count(*)::int c FROM teachers WHERE school_id=$1`, [s]),
    pool.query(`SELECT count(*)::int c FROM classes WHERE school_id=$1`, [s]),
    pool.query(`SELECT COALESCE(SUM(paid_amount),0)::numeric collected, COALESCE(SUM(remaining_balance),0)::numeric outstanding FROM tuition_fee WHERE school_id=$1`, [s]),
    pool.query(`SELECT payment_status, count(*)::int c FROM tuition_fee WHERE school_id=$1 GROUP BY payment_status`, [s]),
    pool.query(`SELECT status, count(*)::int c FROM student_attendance WHERE school_id=$1 AND att_date >= CURRENT_DATE - 7 GROUP BY status`, [s]),
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
router.post('/announcements', async (req, res) => {
  const { title, target_audience = 'All', description, end_date } = req.body;
  if (!title || !description) return res.status(400).json({ error: 'title and description required' });
  const { rows } = await pool.query(
    `INSERT INTO announcements (school_id, title, target_audience, description, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [sid(req), title, target_audience, description, end_date || null]);
  res.status(201).json(rows[0]);
});

// ---------- WRITE: admissions / faculty / classes / fees ----------
// Admit a new student (creates student + login)
router.post('/students', async (req, res) => {
  const s = sid(req);
  const { first_name, last_name, email, gender, age, dob, class_id, guardian_name, guardian_phone, city, roll_no } = req.body;
  if (!first_name || !last_name || !email) return res.status(400).json({ error: 'first_name, last_name, email required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const st = (await client.query(
      `INSERT INTO students (school_id, roll_no, first_name, last_name, age, gender, email, dob, class_id, guardian_name, guardian_phone, city)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [s, roll_no || null, first_name, last_name, age || null, gender || null, email.toLowerCase(), dob || null, class_id || null, guardian_name || '', guardian_phone || '', city || ''])).rows[0];
    const hash = await bcrypt.hash('Acadex@123', 10);
    await client.query(`INSERT INTO users (school_id, role, email, password_hash, full_name, ref_id) VALUES ($1,'student',$2,$3,$4,$5)`,
      [s, email.toLowerCase(), hash, `${first_name} ${last_name}`, st.id]);
    await client.query('COMMIT');
    audit(s, req.user.name, 'admit_student', 'Student', `${first_name} ${last_name}`);
    res.status(201).json(st);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'A user with this email already exists' });
    throw e;
  } finally { client.release(); }
});

// Add a teacher (creates teacher + login)
router.post('/teachers', async (req, res) => {
  const s = sid(req);
  const { first_name, last_name, email, gender, dob, phone, cnic, qualification } = req.body;
  if (!first_name || !last_name || !email) return res.status(400).json({ error: 'first_name, last_name, email required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query(
      `INSERT INTO teachers (school_id, first_name, last_name, gender, dob, email, phone, cnic, qualification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [s, first_name, last_name, gender || null, dob || null, email.toLowerCase(), phone || '', cnic || '', qualification || ''])).rows[0];
    const hash = await bcrypt.hash('Acadex@123', 10);
    await client.query(`INSERT INTO users (school_id, role, email, password_hash, full_name, ref_id) VALUES ($1,'teacher',$2,$3,$4,$5)`,
      [s, email.toLowerCase(), hash, `${first_name} ${last_name}`, t.id]);
    await client.query('COMMIT');
    audit(s, req.user.name, 'add_teacher', 'Teacher', `${first_name} ${last_name}`);
    res.status(201).json(t);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'A user with this email already exists' });
    throw e;
  } finally { client.release(); }
});

// Create a class
router.post('/classes', async (req, res) => {
  const { code, name, section } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  try {
    const { rows } = await pool.query(`INSERT INTO classes (school_id, code, name, section) VALUES ($1,$2,$3,$4) RETURNING *`,
      [sid(req), code, name, section || 'A']);
    audit(sid(req), req.user.name, 'create_class', 'Class', name);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Class code already exists' });
    throw e;
  }
});

// Collect a fee
router.post('/fees', async (req, res) => {
  const s = sid(req);
  const { student_id, total_fee, paid_amount } = req.body;
  if (!student_id || total_fee == null) return res.status(400).json({ error: 'student_id and total_fee required' });
  const paid = Number(paid_amount || 0), total = Number(total_fee);
  const remaining = total - paid;
  const status = remaining <= 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Pending';
  const receipt = 'RCP-' + Date.now().toString().slice(-8);
  const { rows } = await pool.query(
    `INSERT INTO tuition_fee (school_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [s, receipt, student_id, total, paid, remaining, status]);
  audit(s, req.user.name, 'collect_fee', 'TuitionFee', receipt);
  res.status(201).json(rows[0]);
});

module.exports = router;
