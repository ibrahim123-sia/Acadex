import { Router } from 'express';
import { createSchoolBody, id, updateSchoolBody } from '@acadex/shared';
import { pool } from '../db/pool';
import { withTransaction } from '../db/tx';
import { audit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { parsePage, sendPage } from '../lib/pagination';
import { generateTempPassword, hashPassword } from '../lib/passwords';
import { auth, currentUser, requirePermission } from '../middleware/auth';
import { grantSystemRole } from '../rbac';

const router = Router();
router.use(auth);

// Platform KPIs
router.get('/stats', requirePermission('platform.schools.read'), async (_req, res) => {
  const [schools, students, teachers, revenue, recent] = await Promise.all([
    pool.query<{ total: number; active: number }>(
      `SELECT count(*)::int total, count(*) FILTER (WHERE status='active')::int active FROM schools`
    ),
    pool.query<{ c: number }>(`SELECT count(*)::int c FROM students`),
    pool.query<{ c: number }>(`SELECT count(*)::int c FROM teachers`),
    // fee collections per currency — amounts in different currencies must never be added up
    pool.query<{ currency: string; amount: string }>(
      `SELECT sc.currency, SUM(f.paid_amount)::numeric amount
         FROM tuition_fee f JOIN schools sc ON sc.id=f.school_id
        GROUP BY sc.currency ORDER BY amount DESC`
    ),
    pool.query(
      `SELECT id, name, slug, plan, status, created_at,
              (SELECT count(*) FROM students s WHERE s.school_id=sc.id)::int students
         FROM schools sc ORDER BY created_at DESC LIMIT 5`
    ),
  ]);
  res.json({
    schools: schools.rows[0]?.total ?? 0,
    activeSchools: schools.rows[0]?.active ?? 0,
    students: students.rows[0]?.c ?? 0,
    teachers: teachers.rows[0]?.c ?? 0,
    revenueByCurrency: revenue.rows.map((r) => ({ currency: r.currency, amount: Number(r.amount) })),
    recentSchools: recent.rows,
  });
});

// List all schools with counts
router.get('/schools', requirePermission('platform.schools.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await pool.query(
    `SELECT sc.*,
            (SELECT count(*) FROM students s WHERE s.school_id=sc.id)::int students,
            (SELECT count(*) FROM teachers t WHERE t.school_id=sc.id)::int teachers,
            (SELECT count(*) FROM classes c WHERE c.school_id=sc.id)::int classes,
            count(*) OVER() _total
       FROM schools sc ORDER BY sc.created_at DESC, sc.id DESC LIMIT $1 OFFSET $2`,
    [pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// Register a new school + its first admin
router.post('/schools', requirePermission('platform.schools.manage'), async (req, res) => {
  const b = createSchoolBody.parse(req.body);
  const actor = currentUser(req);
  try {
    const out = await withTransaction(async (client) => {
      const school = (
        await client.query(
          `INSERT INTO schools (name, slug, plan, primary_color, contact_email, currency, timezone, locale)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [b.name, b.slug, b.plan, b.primary_color || '#2563EB', b.adminEmail, b.currency, b.timezone, b.locale]
        )
      ).rows[0];
      const tempPassword = generateTempPassword();
      const admin = (
        await client.query<{ id: number }>(
          `INSERT INTO users (school_id, role, email, password_hash, full_name, must_change_password)
           VALUES ($1,'school_admin',$2,$3,$4,TRUE) RETURNING id`,
          [school.id, b.adminEmail, await hashPassword(tempPassword), b.adminName || `${b.name} Administrator`]
        )
      ).rows[0]!;
      await grantSystemRole(client, admin.id, 'school_admin', school.id, actor.id);
      await audit({ schoolId: school.id, userId: actor.id, actor: actor.name, action: 'create_school', entity: 'School', detail: b.name }, client);
      return { school, admin: { email: b.adminEmail, tempPassword } };
    });
    res.status(201).json(out);
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw conflict('Slug or admin email already exists');
    throw e;
  }
});

// Update school (plan / status / locale)
router.patch('/schools/:id', requirePermission('platform.schools.manage'), async (req, res) => {
  const target = id.parse(req.params.id);
  const p = updateSchoolBody.parse(req.body);
  const { rows } = await pool.query(
    `UPDATE schools SET plan=COALESCE($2,plan), status=COALESCE($3,status), currency=COALESCE($4,currency),
            timezone=COALESCE($5,timezone), locale=COALESCE($6,locale)
      WHERE id=$1 RETURNING *`,
    [target, p.plan ?? null, p.status ?? null, p.currency ?? null, p.timezone ?? null, p.locale ?? null]
  );
  if (!rows[0]) throw notFound('School not found');
  res.json(rows[0]);
});

router.get('/audit', requirePermission('platform.audit.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await pool.query(
    `SELECT a.*, sc.name school_name, count(*) OVER() _total FROM audit_log a LEFT JOIN schools sc ON sc.id=a.school_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT $1 OFFSET $2`,
    [pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

export default router;
