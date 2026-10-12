const { Router } = require('../lib/router');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');

const router = Router();
router.use(auth, requireRole('super_admin'));

// Platform KPIs
router.get('/stats', async (req, res) => {
  const [schools, students, teachers, revenue, recent] = await Promise.all([
    pool.query(`SELECT count(*)::int total, count(*) FILTER (WHERE status='active')::int active FROM schools`),
    pool.query(`SELECT count(*)::int c FROM students`),
    pool.query(`SELECT count(*)::int c FROM teachers`),
    pool.query(`SELECT COALESCE(SUM(paid_amount),0)::numeric rev FROM tuition_fee`),
    pool.query(`SELECT id, name, slug, plan, status, created_at,
                  (SELECT count(*) FROM students s WHERE s.school_id=sc.id)::int students
                FROM schools sc ORDER BY created_at DESC LIMIT 5`),
  ]);
  res.json({
    schools: schools.rows[0].total,
    activeSchools: schools.rows[0].active,
    students: students.rows[0].c,
    teachers: teachers.rows[0].c,
    revenue: Number(revenue.rows[0].rev),
    recentSchools: recent.rows,
  });
});

// List all schools with counts
router.get('/schools', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT sc.*,
      (SELECT count(*) FROM students s WHERE s.school_id=sc.id)::int students,
      (SELECT count(*) FROM teachers t WHERE t.school_id=sc.id)::int teachers,
      (SELECT count(*) FROM classes c WHERE c.school_id=sc.id)::int classes
    FROM schools sc ORDER BY sc.created_at DESC`);
  res.json(rows);
});

// Register a new school + its first admin
router.post('/schools', async (req, res) => {
  const { name, slug, plan = 'free', adminName, adminEmail, primary_color } = req.body;
  if (!name || !slug || !adminEmail) return res.status(400).json({ error: 'name, slug, adminEmail required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(
      `INSERT INTO schools (name, slug, plan, primary_color, contact_email) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, slug.toLowerCase(), plan, primary_color || '#2563EB', adminEmail]);
    const school = s.rows[0];
    const tempPassword = 'Acadex@' + Math.floor(1000 + (Date.now() % 9000));
    const hash = await bcrypt.hash(tempPassword, 10);
    await client.query(
      `INSERT INTO users (school_id, role, email, password_hash, full_name) VALUES ($1,'school_admin',$2,$3,$4)`,
      [school.id, adminEmail.toLowerCase(), hash, adminName || `${name} Administrator`]);
    await client.query(`INSERT INTO audit_log (school_id, actor, action, entity, detail) VALUES ($1,$2,'create_school','School',$3)`,
      [school.id, req.user.name, name]);
    await client.query('COMMIT');
    res.status(201).json({ school, admin: { email: adminEmail, tempPassword } });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Slug or admin email already exists' });
    throw e;
  } finally { client.release(); }
});

// Update school (plan/status)
router.patch('/schools/:id', async (req, res) => {
  const { plan, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE schools SET plan=COALESCE($2,plan), status=COALESCE($3,status) WHERE id=$1 RETURNING *`,
    [req.params.id, plan, status]);
  if (!rows[0]) return res.status(404).json({ error: 'School not found' });
  res.json(rows[0]);
});

router.get('/audit', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, sc.name school_name FROM audit_log a LEFT JOIN schools sc ON sc.id=a.school_id
     ORDER BY a.created_at DESC LIMIT 50`);
  res.json(rows);
});

module.exports = router;
