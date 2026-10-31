import { Router } from 'express';
import { createInstitutionBody, id, institutionAdminBody, updateInstitutionBody } from '@acadex/shared';
import { db, systemContext, withTransaction } from '../db/context';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { assertCurrencyMayChange, countryChange, locationFor } from '../lib/country';
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
  // search by name, address name or contact email; filter by status
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const status = req.query.status === 'active' || req.query.status === 'suspended' ? req.query.status : null;
  const { rows } = await db.query(
    `SELECT sc.*,
            (SELECT count(*) FROM students s WHERE s.institution_id=sc.id)::int students,
            (SELECT count(*) FROM teachers t WHERE t.institution_id=sc.id)::int teachers,
            (SELECT count(*) FROM sections c WHERE c.institution_id=sc.id)::int sections,
            count(*) OVER() _total
       FROM institutions sc
      WHERE ($3 = '' OR sc.name ILIKE '%' || $3 || '%' OR sc.slug ILIKE '%' || $3 || '%' OR sc.contact_email ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR sc.status = $4)
      ORDER BY sc.created_at DESC, sc.id DESC LIMIT $1 OFFSET $2`,
    [pg.limit, pg.offset, search, status]
  );
  sendPage(res, rows, pg);
});

// Register a new institution + its first admin
router.post('/institutions', requirePermission('platform.institutions.manage'), async (req, res) => {
  const b = createInstitutionBody.parse(req.body);
  const actor = currentUser(req);
  // currency, timezone, formats and week start follow the country unless given
  const loc = locationFor(b.country, b);
  try {
    const out = await withTransaction(async (client) => {
      const institution = (
        await client.query(
          `INSERT INTO institutions (name, slug, type, plan, primary_color, contact_email, country, currency, timezone, locale, settings)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [b.name, b.slug, b.type, b.plan, b.primary_color || '#2563EB', b.adminEmail, loc.country, loc.currency, loc.timezone, loc.locale, JSON.stringify({ week_start: loc.weekStart })]
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

// Update an institution: its details, plan, status, and the country with what follows from it
router.patch('/institutions/:id', requirePermission('platform.institutions.manage'), async (req, res) => {
  const target = id.parse(req.params.id);
  const p = updateInstitutionBody.parse(req.body);
  const actor = currentUser(req);
  const { rows: cur } = await db.query<{ country: string; currency: string; timezone: string; locale: string }>(`SELECT country, currency, timezone, locale FROM institutions WHERE id = $1`, [target]);
  if (!cur[0]) throw notFound('Institution not found');
  const loc = countryChange(cur[0], p);
  await assertCurrencyMayChange(target, cur[0].currency, loc.currency);
  let row: { name: string } | undefined;
  try {
    const { rows } = await db.query(
      `UPDATE institutions SET plan=COALESCE($2,plan), status=COALESCE($3,status), currency=COALESCE($4,currency),
              timezone=COALESCE($5,timezone), locale=COALESCE($6,locale), country=COALESCE($7,country),
              name=COALESCE($8,name), slug=COALESCE($9,slug), type=COALESCE($10,type),
              contact_email=COALESCE($11,contact_email), primary_color=COALESCE($12,primary_color),
              group_id=CASE WHEN $13 THEN $14::int ELSE group_id END
        WHERE id=$1 RETURNING *`,
      [
        target, p.plan ?? null, p.status ?? null, loc.currency ?? null, loc.timezone ?? null, loc.locale ?? null, loc.country ?? null,
        p.name ?? null, p.slug ?? null, p.type ?? null, p.contact_email ?? null, p.primary_color ?? null,
        p.group_id !== undefined, p.group_id ?? null,
      ]
    );
    row = rows[0];
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') throw conflict('Another institution already uses this address name');
    if (code === '23503') throw badRequest('That group does not exist');
    throw e;
  }
  if (!row) throw notFound('Institution not found');
  const onlyStatus = Object.keys(p).length === 1 && p.status;
  const action = onlyStatus ? (p.status === 'suspended' ? 'suspend_institution' : 'reactivate_institution') : 'update_institution';
  await audit({ institutionId: target, userId: actor.id, actor: actor.name, action, entity: 'Institution', detail: `${row.name}: ${Object.keys(p).join(', ')}` });
  res.json(row);
});

// ---- The administrators of an institution: correct a mistyped email, resend, add another

interface AdminRow {
  id: number;
  full_name: string;
  email: string;
  password_hash: string | null;
}

async function loadAdmin(institution: number, userId: number): Promise<AdminRow> {
  const { rows } = await db.query<AdminRow>(
    `SELECT id, full_name, email, password_hash FROM users WHERE id = $1 AND institution_id = $2 AND role = 'institution_admin'`,
    [userId, institution]
  );
  if (!rows[0]) throw notFound('Administrator not found');
  return rows[0];
}

router.get('/institutions/:id/admins', requirePermission('platform.institutions.read'), async (req, res) => {
  const target = id.parse(req.params.id);
  const { rows } = await db.query<AdminRow & { last_login_at: string | null; is_active: boolean; full_admin: boolean }>(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.last_login_at, u.is_active,
            EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                     WHERE ur.user_id = u.id AND r.key = 'institution_admin' AND r.is_system) AS full_admin
       FROM users u
      WHERE u.institution_id = $1 AND u.role = 'institution_admin'
      ORDER BY u.created_at, u.id`,
    [target]
  );
  // never send the password hash; "invited" = hasn't set a password yet
  res.json(rows.map(({ password_hash, ...u }) => ({ ...u, status: password_hash ? 'active' : 'invited' })));
});

// Add another administrator (for example when the first one has left)
router.post('/institutions/:id/admins', requirePermission('platform.institutions.manage'), async (req, res) => {
  const target = id.parse(req.params.id);
  const b = institutionAdminBody.parse(req.body);
  const actor = currentUser(req);
  const { rows: inst } = await db.query<{ name: string }>(`SELECT name FROM institutions WHERE id = $1`, [target]);
  if (!inst[0]) throw notFound('Institution not found');
  let adminId: number;
  try {
    adminId = await withTransaction(async (client) => {
      const admin = (
        await client.query<{ id: number }>(
          `INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES ($1,'institution_admin',$2,NULL,$3) RETURNING id`,
          [target, b.email, b.name]
        )
      ).rows[0]!;
      await grantSystemRole(client, admin.id, 'institution_admin', target, actor.id);
      await audit({ institutionId: target, userId: actor.id, actor: actor.name, action: 'add_institution_admin', entity: 'User', detail: `${inst[0]!.name}: ${b.email}` }, client);
      return admin.id;
    });
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw conflict('This email already belongs to an account');
    throw e;
  }
  const invite = await inviteUser(adminId, { id: actor.id, name: actor.name });
  res.status(201).json({ id: adminId, invite });
});

// Correct the name, or the mistyped email of an administrator who hasn't accepted the invitation
// yet — a new invitation goes to the corrected address and the old link stops working.
router.patch('/institutions/:id/admins/:userId', requirePermission('platform.institutions.manage'), async (req, res) => {
  const target = id.parse(req.params.id);
  const b = institutionAdminBody.parse(req.body);
  const actor = currentUser(req);
  const admin = await loadAdmin(target, id.parse(req.params.userId));
  const emailChanged = b.email !== admin.email;
  if (emailChanged && admin.password_hash) {
    throw badRequest('This administrator has already activated their account, so only they can change their email. Add a new administrator instead.');
  }
  try {
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET full_name = $2, email = $3 WHERE id = $1`, [admin.id, b.name, b.email]);
      // the contact email started as the administrator's address: keep the two in step
      if (emailChanged) await client.query(`UPDATE institutions SET contact_email = $2 WHERE id = $1 AND contact_email = $3`, [target, b.email, admin.email]);
      await audit({ institutionId: target, userId: actor.id, actor: actor.name, action: 'update_institution_admin', entity: 'User', detail: emailChanged ? `${admin.email} → ${b.email}` : b.email }, client);
    });
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw conflict('This email already belongs to an account');
    throw e;
  }
  const invite = emailChanged ? await inviteUser(admin.id, { id: actor.id, name: actor.name }) : null;
  res.json({ id: admin.id, invite });
});

// Send the invitation again (the previous link stops working)
router.post('/institutions/:id/admins/:userId/invite', requirePermission('platform.institutions.manage'), async (req, res) => {
  const target = id.parse(req.params.id);
  const actor = currentUser(req);
  const admin = await loadAdmin(target, id.parse(req.params.userId));
  if (admin.password_hash) throw badRequest('This administrator has already activated their account. They can use "Forgot password".');
  const invite = await inviteUser(admin.id, { id: actor.id, name: actor.name });
  await audit({ institutionId: target, userId: actor.id, actor: actor.name, action: 'resend_invite', entity: 'User', detail: admin.email });
  res.json({ invite });
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
