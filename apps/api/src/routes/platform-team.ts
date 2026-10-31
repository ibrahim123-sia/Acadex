// The platform owner's people: groups of institutions with their group administrators, and the
// platform team itself (other platform administrators). Mounted at /api/platform.
import { Router } from 'express';
import { id, institutionAdminBody, institutionGroupBody, updateInstitutionGroupBody } from '@acadex/shared';
import { db, systemContext, withTransaction } from '../db/context';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { inviteUser } from '../auth/invites';
import { auth, currentUser, requirePermission } from '../middleware/auth';
import { grantSystemRole } from '../rbac';

const router = Router();
// cross-tenant by design: RLS bypass after auth (every route below checks a platform permission)
router.use(auth, systemContext);

const read = requirePermission('platform.institutions.read');
const manage = requirePermission('platform.institutions.manage');

const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';

/** Create a person without an institution (group or platform administrator) and invite them. */
async function createAndInvite(req: Parameters<typeof currentUser>[0], role: 'group_admin' | 'super_admin', scope: number | null, b: { name: string; email: string }, detail: string) {
  const actor = currentUser(req);
  let userId: number;
  try {
    userId = await withTransaction(async (client) => {
      const u = (
        await client.query<{ id: number }>(`INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES (NULL,$1,$2,NULL,$3) RETURNING id`, [role, b.email, b.name])
      ).rows[0]!;
      await grantSystemRole(client, u.id, role, scope, actor.id);
      await audit({ institutionId: null, userId: actor.id, actor: actor.name, action: role === 'group_admin' ? 'add_group_admin' : 'add_platform_admin', entity: 'User', detail }, client);
      return u.id;
    });
  } catch (e) {
    if (isUnique(e)) throw conflict('This email already belongs to an account');
    throw e;
  }
  return { id: userId, invite: await inviteUser(userId, { id: actor.id, name: actor.name }) };
}

async function resendTo(req: Parameters<typeof currentUser>[0], userId: number, role: 'group_admin' | 'super_admin') {
  const actor = currentUser(req);
  const { rows } = await db.query<{ email: string; password_hash: string | null }>(`SELECT email, password_hash FROM users WHERE id = $1 AND role = $2`, [userId, role]);
  if (!rows[0]) throw notFound('Person not found');
  if (rows[0].password_hash) throw badRequest('They have already activated their account. They can use "Forgot password".');
  const invite = await inviteUser(userId, { id: actor.id, name: actor.name });
  await audit({ institutionId: null, userId: actor.id, actor: actor.name, action: 'resend_invite', entity: 'User', detail: rows[0].email });
  return invite;
}

// ---------------------------------------------------------------- groups of institutions

router.get('/groups', read, async (_req, res) => {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.slug, g.created_at,
            COALESCE((SELECT json_agg(json_build_object('id', i.id, 'name', i.name, 'slug', i.slug) ORDER BY i.name) FROM institutions i WHERE i.group_id = g.id), '[]') AS institutions,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email, 'is_active', u.is_active,
                                                         'status', CASE WHEN u.password_hash IS NULL THEN 'invited' ELSE 'active' END) ORDER BY u.id)
                        FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
                       WHERE r.key = 'group_admin' AND r.is_system AND ur.scope_id = g.id), '[]') AS admins
       FROM institution_groups g ORDER BY g.name`
  );
  res.json(rows);
});

router.post('/groups', manage, async (req, res) => {
  const b = institutionGroupBody.parse(req.body);
  const actor = currentUser(req);
  try {
    const { rows } = await db.query(`INSERT INTO institution_groups (name, slug) VALUES ($1, $2) RETURNING *`, [b.name, b.slug]);
    await audit({ institutionId: null, userId: actor.id, actor: actor.name, action: 'create_group', entity: 'InstitutionGroup', detail: b.name });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUnique(e)) throw conflict('Another group already uses this address name');
    throw e;
  }
});

router.patch('/groups/:id', manage, async (req, res) => {
  const group = id.parse(req.params.id);
  const b = updateInstitutionGroupBody.parse(req.body);
  const { rows } = await db.query(`UPDATE institution_groups SET name = $2 WHERE id = $1 RETURNING *`, [group, b.name]);
  if (!rows[0]) throw notFound('Group not found');
  res.json(rows[0]);
});

// Only an empty group can be deleted (no institutions, no administrators)
router.delete('/groups/:id', manage, async (req, res) => {
  const group = id.parse(req.params.id);
  const actor = currentUser(req);
  const { rows } = await db.query<{ name: string; institutions: number; admins: number }>(
    `SELECT g.name, (SELECT count(*)::int FROM institutions i WHERE i.group_id = g.id) institutions,
            (SELECT count(*)::int FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'group_admin' AND ur.scope_id = g.id) admins
       FROM institution_groups g WHERE g.id = $1`,
    [group]
  );
  const g = rows[0];
  if (!g) throw notFound('Group not found');
  if (g.institutions || g.admins) throw badRequest('Take the institutions and administrators out of the group first');
  await db.query(`DELETE FROM institution_groups WHERE id = $1`, [group]);
  await audit({ institutionId: null, userId: actor.id, actor: actor.name, action: 'delete_group', entity: 'InstitutionGroup', detail: g.name });
  res.status(204).end();
});

// A group administrator sees every institution of the group (read-only)
router.post('/groups/:id/admins', manage, async (req, res) => {
  const group = id.parse(req.params.id);
  const b = institutionAdminBody.parse(req.body);
  const { rows } = await db.query<{ name: string }>(`SELECT name FROM institution_groups WHERE id = $1`, [group]);
  if (!rows[0]) throw notFound('Group not found');
  res.status(201).json(await createAndInvite(req, 'group_admin', group, b, `${rows[0].name}: ${b.email}`));
});

router.post('/groups/:id/admins/:userId/invite', manage, async (req, res) => {
  id.parse(req.params.id);
  res.json({ invite: await resendTo(req, id.parse(req.params.userId), 'group_admin') });
});

// ---------------------------------------------------------------- the platform team

router.get('/team', read, async (req, res) => {
  const me = currentUser(req).id;
  const { rows } = await db.query<{ id: number; password_hash: string | null }>(
    `SELECT id, full_name, email, is_active, last_login_at, password_hash FROM users WHERE role = 'super_admin' ORDER BY id`
  );
  res.json(rows.map(({ password_hash, ...u }) => ({ ...u, status: password_hash ? 'active' : 'invited', you: u.id === me })));
});

router.post('/team', manage, async (req, res) => {
  const b = institutionAdminBody.parse(req.body);
  res.status(201).json(await createAndInvite(req, 'super_admin', null, b, b.email));
});

router.post('/team/:userId/invite', manage, async (req, res) => {
  res.json({ invite: await resendTo(req, id.parse(req.params.userId), 'super_admin') });
});

// Turn a platform administrator's access off (or back on). Nobody can lock themselves out, and
// the last active platform administrator stays.
router.patch('/team/:userId', manage, async (req, res) => {
  const target = id.parse(req.params.userId);
  const actor = currentUser(req);
  const active = req.body?.active;
  if (typeof active !== 'boolean') throw badRequest('Send { "active": true } or { "active": false }');
  if (target === actor.id && !active) throw badRequest('You cannot turn off your own access');
  const out = await withTransaction(async (client) => {
    const { rows } = await client.query<{ email: string }>(
      `UPDATE users SET is_active = $2, token_version = token_version + CASE WHEN $2 THEN 0 ELSE 1 END
        WHERE id = $1 AND role = 'super_admin' RETURNING email`,
      [target, active]
    );
    if (!rows[0]) throw notFound('Platform administrator not found');
    const { rows: left } = await client.query<{ n: number }>(`SELECT count(*)::int n FROM users WHERE role = 'super_admin' AND is_active`);
    if (!left[0]!.n) throw badRequest('At least one platform administrator must keep access');
    await audit({ institutionId: null, userId: actor.id, actor: actor.name, action: active ? 'enable_platform_admin' : 'disable_platform_admin', entity: 'User', detail: rows[0].email }, client);
    return rows[0];
  });
  res.json({ email: out.email, active });
});

export default router;
