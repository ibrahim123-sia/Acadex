const { Router } = require('../lib/router');
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { HttpError, notFound } = require('../lib/errors');
const { z, id, text, requiredText } = require('../lib/validate');
const { withTransaction } = require('../db/tx');
const { generateTempPassword, hashPassword } = require('../lib/passwords');
const { isValidCurrency, isValidTimeZone, isValidLocale } = require('../lib/locale');

const PLANS = ['free', 'pro', 'enterprise'];
const localeFields = {
  currency: z.string().trim().toUpperCase().refine(isValidCurrency, 'Unknown ISO 4217 currency code'),
  timezone: z.string().trim().refine(isValidTimeZone, 'Unknown IANA timezone (e.g. Asia/Karachi)'),
  locale: z.string().trim().max(35).refine(isValidLocale, 'Invalid locale tag (e.g. en-PK)'),
};

const router = Router();
router.use(auth, requireRole('super_admin'));

// Platform KPIs
router.get('/stats', async (req, res) => {
  const [schools, students, teachers, revenue, recent] = await Promise.all([
    pool.query(`SELECT count(*)::int total, count(*) FILTER (WHERE status='active')::int active FROM schools`),
    pool.query(`SELECT count(*)::int c FROM students`),
    pool.query(`SELECT count(*)::int c FROM teachers`),
    // fee collections per currency — amounts in different currencies must never be added up
    pool.query(`SELECT sc.currency, SUM(f.paid_amount)::numeric amount
                FROM tuition_fee f JOIN schools sc ON sc.id=f.school_id
                GROUP BY sc.currency ORDER BY amount DESC`),
    pool.query(`SELECT id, name, slug, plan, status, created_at,
                  (SELECT count(*) FROM students s WHERE s.school_id=sc.id)::int students
                FROM schools sc ORDER BY created_at DESC LIMIT 5`),
  ]);
  res.json({
    schools: schools.rows[0].total,
    activeSchools: schools.rows[0].active,
    students: students.rows[0].c,
    teachers: teachers.rows[0].c,
    revenueByCurrency: revenue.rows.map((r) => ({ currency: r.currency, amount: Number(r.amount) })),
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
  currency: localeFields.currency.default('PKR'),
  timezone: localeFields.timezone.default('Asia/Karachi'),
  locale: localeFields.locale.default('en-PK'),
});
router.post('/schools', async (req, res) => {
  const { name, slug, plan, adminName, adminEmail, primary_color, currency, timezone, locale } = schoolBody.parse(req.body);
  try {
    const out = await withTransaction(async (client) => {
      const school = (await client.query(
        `INSERT INTO schools (name, slug, plan, primary_color, contact_email, currency, timezone, locale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [name, slug, plan, primary_color || '#2563EB', adminEmail, currency, timezone, locale])).rows[0];
      const tempPassword = generateTempPassword();
      await client.query(
        `INSERT INTO users (school_id, role, email, password_hash, full_name, must_change_password) VALUES ($1,'school_admin',$2,$3,$4,TRUE)`,
        [school.id, adminEmail, await hashPassword(tempPassword), adminName || `${name} Administrator`]);
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
const schoolPatch = z.object({
  plan: z.enum(PLANS).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  currency: localeFields.currency.optional(),
  timezone: localeFields.timezone.optional(),
  locale: localeFields.locale.optional(),
});
router.patch('/schools/:id', async (req, res) => {
  const schoolId = id.parse(req.params.id);
  const p = schoolPatch.parse(req.body);
  const { rows } = await pool.query(
    `UPDATE schools SET plan=COALESCE($2,plan), status=COALESCE($3,status), currency=COALESCE($4,currency),
       timezone=COALESCE($5,timezone), locale=COALESCE($6,locale)
     WHERE id=$1 RETURNING *`,
    [schoolId, p.plan ?? null, p.status ?? null, p.currency ?? null, p.timezone ?? null, p.locale ?? null]);
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
