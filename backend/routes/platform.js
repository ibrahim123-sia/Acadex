const { Router } = require('../lib/router');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { HttpError, notFound } = require('../lib/errors');
const { z, id, text, requiredText } = require('../lib/validate');
const { withTransaction } = require('../db/tx');

const PLANS = ['free', 'pro', 'enterprise'];

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
const schoolBody = z.object({
  name: requiredText(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'Use 1-40 lowercase letters, digits or hyphens'),
  plan: z.enum(PLANS).default('free'),
  adminName: text(120).optional(),
  adminEmail: z.string().trim().toLowerCase().pipe(z.email()),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
router.post('/schools', async (req, res) => {
  const { name, slug, plan, adminName, adminEmail, primary_color } = schoolBody.parse(req.body);
  try {
    const out = await withTransaction(async (client) => {
      const school = (await client.query(
        `INSERT INTO schools (name, slug, plan, primary_color, contact_email) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, slug, plan, primary_color || '#2563EB', adminEmail])).rows[0];
      const tempPassword = 'Acadex@' + Math.floor(1000 + (Date.now() % 9000));
      const hash = await bcrypt.hash(tempPassword, 10);
      await client.query(
        `INSERT INTO users (school_id, role, email, password_hash, full_name) VALUES ($1,'school_admin',$2,$3,$4)`,
        [school.id, adminEmail, hash, adminName || `${name} Administrator`]);
      await client.query(`INSERT INTO audit_log (school_id, actor, action, entity, detail) VALUES ($1,$2,'create_school','School',$3)`,
        [school.id, req.user.name, name]);
      return { school, admin: { email: adminEmail, tempPassword } };
    });
    res.status(201).json(out);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Slug or admin email already exists');
    throw e;
  }
});

// Update school (plan/status)
const schoolPatch = z.object({ plan: z.enum(PLANS).optional(), status: z.enum(['active', 'suspended']).optional() });
router.patch('/schools/:id', async (req, res) => {
  const schoolId = id.parse(req.params.id);
  const { plan, status } = schoolPatch.parse(req.body);
  const { rows } = await pool.query(
    `UPDATE schools SET plan=COALESCE($2,plan), status=COALESCE($3,status) WHERE id=$1 RETURNING *`,
    [schoolId, plan ?? null, status ?? null]);
  if (!rows[0]) throw notFound('School not found');
  res.json(rows[0]);
});

router.get('/audit', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, sc.name school_name FROM audit_log a LEFT JOIN schools sc ON sc.id=a.school_id
     ORDER BY a.created_at DESC LIMIT 50`);
  res.json(rows);
});

module.exports = router;
