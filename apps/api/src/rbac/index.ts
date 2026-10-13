// Role-based access control: catalogue sync, grants and the can() check.
import type pg from 'pg';
import { PERMISSIONS, SYSTEM_ROLES, type Permission, type ScopeType } from '@acadex/shared';
import { pool, type Queryable } from '../db/pool';

export interface Grant {
  permission: Permission;
  scopeType: ScopeType;
  scopeId: number | null;
}

/** What a permission check is about (defaults to the caller's own school). */
export interface AccessContext {
  schoolId?: number | null;
}

/**
 * True when one of the user's role assignments grants `permission` for the context:
 * a platform-scoped grant covers everything, a school-scoped one only its school.
 */
export function can(
  user: { school_id: number | null; grants: Grant[] },
  permission: Permission,
  ctx: AccessContext = {}
): boolean {
  const schoolId = ctx.schoolId === undefined ? user.school_id : ctx.schoolId;
  return user.grants.some(
    (g) => g.permission === permission && (g.scopeType === 'platform' || (g.scopeType === 'school' && g.scopeId != null && g.scopeId === schoolId))
  );
}

/** The user's effective permission grants (all roles, all scopes). */
export async function loadGrants(userId: number, db: Queryable = pool): Promise<Grant[]> {
  const { rows } = await db.query<{ permission: Permission; scope_type: ScopeType; scope_id: number | null }>(
    `SELECT DISTINCT rp.permission, ur.scope_type, ur.scope_id
       FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1`,
    [userId]
  );
  return rows.map((r) => ({ permission: r.permission, scopeType: r.scope_type, scopeId: r.scope_id }));
}

/** Assign a built-in role (e.g. when an account is created). */
export async function grantSystemRole(
  db: Queryable,
  userId: number,
  roleKey: string,
  schoolId: number | null,
  grantedBy: number | null = null
): Promise<void> {
  const { rowCount } = await db.query(
    `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, granted_by)
     SELECT $1, r.id, r.scope_type, CASE WHEN r.scope_type = 'platform' THEN NULL ELSE $3::int END, $4
       FROM roles r WHERE r.key = $2 AND r.school_id IS NULL AND r.is_system
     ON CONFLICT ON CONSTRAINT user_roles_user_role_scope_key DO NOTHING`,
    [userId, roleKey, schoolId, grantedBy]
  );
  if (rowCount === 0) {
    const exists = await db.query(`SELECT 1 FROM roles WHERE key = $1 AND school_id IS NULL AND is_system`, [roleKey]);
    if (!exists.rowCount) throw new Error(`Unknown system role "${roleKey}" — has the database been migrated?`);
  }
}

/**
 * Make the database catalogue match @acadex/shared: every permission exists with its
 * description, and every built-in role has exactly its defined permission set.
 * Runs after migrations on every deploy.
 */
export async function syncRbacCatalogue(client: pg.PoolClient | pg.Pool): Promise<void> {
  const keys = Object.keys(PERMISSIONS);
  await client.query(
    `INSERT INTO permissions (key, description)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
    [keys, keys.map((k) => PERMISSIONS[k as Permission])]
  );
  await client.query(`DELETE FROM permissions WHERE NOT (key = ANY($1::text[]))`, [keys]);
  for (const role of SYSTEM_ROLES) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO roles (school_id, key, name, is_system, scope_type) VALUES (NULL, $1, $2, true, $3)
       ON CONFLICT ON CONSTRAINT roles_school_id_key_key DO UPDATE SET name = EXCLUDED.name, scope_type = EXCLUDED.scope_type
       RETURNING id`,
      [role.key, role.name, role.scope]
    );
    const roleId = rows[0]!.id;
    await client.query(`DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission = ANY($2::text[]))`, [
      roleId,
      role.permissions,
    ]);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [roleId, role.permissions]
    );
  }
}
