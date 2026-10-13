// Roles & permissions for a school: built-in roles plus the school's own custom roles
// ("Exam Controller", "Accountant", ...), and who holds which role.
import { Router, type Request } from 'express';
import { PERMISSIONS, SCHOOL_ASSIGNABLE_PERMISSIONS, assignRoleBody, createRoleBody, id, updateRoleBody } from '@acadex/shared';
import { pool } from '../db/pool';
import { withTransaction } from '../db/tx';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { auth, currentUser, requirePermission, schoolId } from '../middleware/auth';

const router = Router();
// Mounted under /api/school next to other routers, so the guard is per route (a router-level
// use() would also run for every other /api/school request).
const guard = [auth, requirePermission('roles.manage')];

interface RoleRow {
  id: number;
  school_id: number | null;
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  scope_type: string;
}

const auditAs = (req: Request, action: string, detail: string) =>
  audit({ schoolId: schoolId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity: 'Role', detail });

/** A role this school may see and assign: a built-in school role, or one of its own. */
async function findRole(req: Request, roleId: number): Promise<RoleRow> {
  const { rows } = await pool.query<RoleRow>(
    `SELECT * FROM roles WHERE id=$1 AND ((school_id IS NULL AND is_system AND scope_type='school') OR school_id=$2)`,
    [roleId, schoolId(req)]
  );
  if (!rows[0]) throw notFound('Role not found');
  return rows[0];
}

async function findSchoolUser(req: Request, userId: number) {
  const { rows } = await pool.query<{ id: number; full_name: string; role: string }>(
    `SELECT id, full_name, role FROM users WHERE id=$1 AND school_id=$2`,
    [userId, schoolId(req)]
  );
  if (!rows[0]) throw notFound('User not found');
  return rows[0];
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'role';

// The permissions a school role can hold, with descriptions (for the role editor).
router.get('/permissions', ...guard, (_req, res) => {
  res.json(SCHOOL_ASSIGNABLE_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })));
});

router.get('/roles', ...guard, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.key, r.name, r.description, r.is_system,
            COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') permissions,
            (SELECT count(*) FROM user_roles ur WHERE ur.role_id = r.id AND ur.scope_type='school' AND ur.scope_id=$1)::int members
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE (r.school_id IS NULL AND r.is_system AND r.scope_type='school') OR r.school_id=$1
      GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
    [schoolId(req)]
  );
  res.json(rows);
});

router.post('/roles', ...guard, async (req, res) => {
  const b = createRoleBody.parse(req.body);
  const s = schoolId(req);
  const key = `custom_${slugify(b.name)}`;
  try {
    const role = await withTransaction(async (client) => {
      const r = (
        await client.query<RoleRow>(
          `INSERT INTO roles (school_id, key, name, description, is_system, scope_type) VALUES ($1,$2,$3,$4,false,'school') RETURNING *`,
          [s, key, b.name, b.description]
        )
      ).rows[0]!;
      await client.query(`INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`, [r.id, b.permissions]);
      return r;
    });
    await auditAs(req, 'create_role', `${b.name}: ${b.permissions.join(', ')}`);
    res.status(201).json({ ...role, permissions: b.permissions, members: 0 });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('A role with this name already exists');
    throw e;
  }
});

router.patch('/roles/:id', ...guard, async (req, res) => {
  const role = await findRole(req, id.parse(req.params.id));
  if (role.is_system) throw badRequest("Built-in roles can't be changed. Create a custom role instead.");
  const b = updateRoleBody.parse(req.body);
  await withTransaction(async (client) => {
    await client.query(`UPDATE roles SET name=COALESCE($2,name), description=COALESCE($3,description) WHERE id=$1`, [
      role.id,
      b.name ?? null,
      b.description ?? null,
    ]);
    if (b.permissions) {
      await client.query(`DELETE FROM role_permissions WHERE role_id=$1`, [role.id]);
      await client.query(`INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`, [role.id, b.permissions]);
    }
  });
  await auditAs(req, 'update_role', `${b.name ?? role.name}${b.permissions ? `: ${b.permissions.join(', ')}` : ''}`);
  res.json({ ok: true });
});

router.delete('/roles/:id', ...guard, async (req, res) => {
  const role = await findRole(req, id.parse(req.params.id));
  if (role.is_system) throw badRequest("Built-in roles can't be deleted.");
  await pool.query(`DELETE FROM roles WHERE id=$1`, [role.id]);
  await auditAs(req, 'delete_role', role.name);
  res.json({ ok: true });
});

// ---------- who holds which role ----------
router.get('/users/:userId/roles', ...guard, async (req, res) => {
  const user = await findSchoolUser(req, id.parse(req.params.userId));
  const { rows } = await pool.query(
    `SELECT r.id, r.key, r.name, r.is_system FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id=$1 AND ur.scope_type='school' AND ur.scope_id=$2 ORDER BY r.name`,
    [user.id, schoolId(req)]
  );
  res.json(rows);
});

router.post('/users/:userId/roles', ...guard, async (req, res) => {
  const user = await findSchoolUser(req, id.parse(req.params.userId));
  const role = await findRole(req, assignRoleBody.parse(req.body).role_id);
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, granted_by) VALUES ($1,$2,'school',$3,$4)
     ON CONFLICT ON CONSTRAINT user_roles_user_role_scope_key DO NOTHING`,
    [user.id, role.id, schoolId(req), currentUser(req).id]
  );
  await auditAs(req, 'grant_role', `${role.name} → ${user.full_name}`);
  res.status(201).json({ ok: true });
});

router.delete('/users/:userId/roles/:roleId', ...guard, async (req, res) => {
  const user = await findSchoolUser(req, id.parse(req.params.userId));
  const role = await findRole(req, id.parse(req.params.roleId));
  if (role.key === 'school_admin') {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE r.key='school_admin' AND r.is_system AND ur.scope_type='school' AND ur.scope_id=$1 AND ur.user_id <> $2`,
      [schoolId(req), user.id]
    );
    if (!rows[0]?.n) throw badRequest('A school needs at least one administrator.');
  }
  await pool.query(`DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2 AND scope_type='school' AND scope_id=$3`, [
    user.id,
    role.id,
    schoolId(req),
  ]);
  await auditAs(req, 'revoke_role', `${role.name} ✕ ${user.full_name}`);
  res.json({ ok: true });
});

export default router;
