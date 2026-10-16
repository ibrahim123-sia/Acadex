import { Router } from 'express';
import { createInstitutionBody, id, updateInstitutionBody } from '@acadex/shared';
import { db, systemContext, withTransaction } from '../db/context';
import { audit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { parsePage, sendPage } from '../lib/pagination';
import { inviteUser } from '../auth/invites';
import { auth, currentUser, requirePermission } from '../middleware/auth';
import { grantSystemRole } from '../rbac';

const router = Router();
// Platform staff work across institutions: RLS bypass for this router (after auth + permission).
router.use(auth, systemContext);

// Platform KPIs
router.get('/stats', requirePermission('platform.institutions.read'), async (_req, res) => {
  const [institutions, students, teachers, revenue, recent] = await Promise.all([
    db.query<{ total: number; active: number }>(
      `SELECT count(*)::int total, count(*) FILTER (WHERE status='active')::int active FROM institutions`
    ),
    db.query<{ c: number }>(`SELECT count(*)::int c FROM students`),
    db.query<{ c: number }>(`SELECT count(*)::int c FROM teachers`),
    // fee collections per currency — amounts in different currencies must never be added up
    db.query<{ currency: string; amount: string }>(
      `SELECT sc.currency, SUM(p.amount)::numeric amount
         FROM payments p JOIN institutions sc ON sc.id=p.institution_id
        GROUP BY sc.currency ORDER BY amount DESC`
    ),
    db.query(
      `SELECT id, name, slug, plan, status, created_at,
              (SELECT count(*) FROM students s WHERE s.institution_id=sc.id)::int students
         FROM institutions sc ORDER BY created_at DESC LIMIT 5`
    ),
  ]);
  res.json({
    institutions: institutions.rows[0]?.total ?? 0,
    activeInstitutions: institutions.rows[0]?.active ?? 0,
    students: students.rows[0]?.c ?? 0,
    teachers: teachers.rows[0]?.c ?? 0,
    revenueByCurrency: revenue.rows.map((r) => ({ currency: r.currency, amount: Number(r.amount) })),
    recentInstitutions: recent.rows,
  });
});

// List all institutions with counts
router.get('/institutions', requirePermission('platform.institutions.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT sc.*,
            (SELECT count(*) FROM students s WHERE s.institution_id=sc.id)::int students,
            (SELECT count(*) FROM teachers t WHERE t.institution_id=sc.id)::int teachers,
            (SELECT count(*) FROM sections c WHERE c.institution_id=sc.id)::int sections,
            count(*) OVER() _total
       FROM institutions sc ORDER BY sc.created_at DESC, sc.id DESC LIMIT $1 OFFSET $2`,
    [pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// Register a new institution + its first admin
router.post('/institutions', requirePermission('platform.institutions.manage'), async (req, res) => {
  const b = createInstitutionBody.parse(req.body);
  const actor = currentUser(req);
  try {
    const out = await withTransaction(async (client) => {
      const institution = (
        await client.query(
          `INSERT INTO institutions (name, slug, plan, primary_color, contact_email, currency, timezone, locale)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [b.name, b.slug, b.plan, b.primary_color || '#2563EB', b.adminEmail, b.currency, b.timezone, b.locale]
        )
      ).rows[0];
      const admin = (
        await client.query<{ id: number }>(
          `INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES ($1,'institution_admin',$2,NULL,$3) RETURNING id`,
          [institution.id, b.adminEmail, b.adminName || `${b.name} Administrator`]
        )
      ).rows[0]!;
      await grantSystemRole(client, admin.id, 'institution_admin', institution.id, actor.id);
      await audit({ institutionId: institution.id, userId: actor.id, actor: actor.name, action: 'create_institution', entity: 'Institution', detail: b.name }, client);
      return { institution, adminId: admin.id };
    });
    const invite = await inviteUser(out.adminId, { id: actor.id, name: actor.name });
    res.status(201).json({ institution: out.institution, admin: { email: b.adminEmail, invite } });
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw conflict('Slug or admin email already exists');
    throw e;
  }
});

// Update institution (plan / status / locale)
router.patch('/institutions/:id', requirePermission('platform.institutions.manage'), async (req, res) => {
  const target = id.parse(req.params.id);
  const p = updateInstitutionBody.parse(req.body);
  const { rows } = await db.query(
    `UPDATE institutions SET plan=COALESCE($2,plan), status=COALESCE($3,status), currency=COALESCE($4,currency),
            timezone=COALESCE($5,timezone), locale=COALESCE($6,locale)
      WHERE id=$1 RETURNING *`,
    [target, p.plan ?? null, p.status ?? null, p.currency ?? null, p.timezone ?? null, p.locale ?? null]
  );
  if (!rows[0]) throw notFound('Institution not found');
  res.json(rows[0]);
});

router.get('/audit', requirePermission('platform.audit.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT a.*, sc.name institution_name, count(*) OVER() _total FROM audit_log a LEFT JOIN institutions sc ON sc.id=a.institution_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT $1 OFFSET $2`,
    [pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

export default router;
