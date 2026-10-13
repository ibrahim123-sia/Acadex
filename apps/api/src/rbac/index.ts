// Role-based access control: catalogue sync, grants and the can() check.
import { PERMISSIONS, SYSTEM_ROLES, type Permission, type ScopeType } from '@acadex/shared';
import type { Queryable } from '../db/pool';
import { db } from '../db/context';

const defaultDb: Queryable = db;

/** Where a role assignment applies. Campus grants are institution roles limited to one campus. */
export type GrantScope = ScopeType | 'campus';

export interface Grant {
  permission: Permission;
  scopeType: GrantScope;
  scopeId: number | null;
  /** the institution an institution / campus grant lives in */
  institutionId: number | null;
}

/** What a permission check is about (defaults to the caller's own institution, any campus). */
export interface AccessContext {
  institutionId?: number | null;
  /** a specific campus; omitted = "anywhere in the institution" (the data is then filtered by campusScope) */
  campusId?: number | null;
  groupId?: number | null;
}

type GrantHolder = { institution_id: number | null; grants: Grant[] };

/**
 * True when one of the user's role assignments grants `permission` for the context:
 * a platform grant covers everything, an institution grant its whole institution, a campus
 * grant one campus of it, and a group grant the group.
 */
export function can(user: GrantHolder, permission: Permission, ctx: AccessContext = {}): boolean {
  const institutionId = ctx.institutionId === undefined ? user.institution_id : ctx.institutionId;
  return user.grants.some((g) => {
    if (g.permission !== permission) return false;
    switch (g.scopeType) {
      case 'platform':
        return true;
      case 'institution':
        return g.scopeId != null && g.scopeId === institutionId;
      case 'campus':
        return g.institutionId != null && g.institutionId === institutionId && (ctx.campusId == null || g.scopeId === ctx.campusId);
      case 'group':
        return ctx.groupId != null && g.scopeId === ctx.groupId;
      default:
        return false;
    }
  });
}

/**
 * The campuses a user may act on with `permission`: null = every campus (an institution-wide
 * or platform grant), otherwise the campus ids of their campus grants (possibly none).
 */
export function campusScope(user: GrantHolder, permission: Permission, institutionId = user.institution_id): number[] | null {
  const campuses = new Set<number>();
  for (const g of user.grants) {
    if (g.permission !== permission) continue;
    if (g.scopeType === 'platform' || (g.scopeType === 'institution' && g.scopeId === institutionId)) return null;
    if (g.scopeType === 'campus' && g.institutionId === institutionId && g.scopeId != null) campuses.add(g.scopeId);
  }
  return [...campuses];
}

/** Groups in which the user holds `permission`. */
export function groupScope(user: GrantHolder, permission: Permission): number[] {
  return [...new Set(user.grants.filter((g) => g.permission === permission && g.scopeType === 'group' && g.scopeId != null).map((g) => g.scopeId!))];
}

/** The user's effective permission grants (all roles, all scopes). */
export async function loadGrants(userId: number, db: Queryable = defaultDb): Promise<Grant[]> {
  const { rows } = await db.query<{ permission: Permission; scope_type: GrantScope; scope_id: number | null; institution_id: number | null }>(
    `SELECT DISTINCT rp.permission, ur.scope_type, ur.scope_id, ur.institution_id
       FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1`,
    [userId]
  );
  return rows.map((r) => ({ permission: r.permission, scopeType: r.scope_type, scopeId: r.scope_id, institutionId: r.institution_id }));
}

/**
 * Assign a built-in role (e.g. when an account is created). `scopeId` is the institution for
 * institution roles, the group for group roles, and ignored for platform roles.
 */
export async function grantSystemRole(
  db: Queryable,
  userId: number,
  roleKey: string,
  scopeId: number | null,
  grantedBy: number | null = null
): Promise<void> {
  const { rowCount } = await db.query(
    `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, institution_id, granted_by)
     SELECT $1, r.id, r.scope_type, CASE WHEN r.scope_type = 'platform' THEN NULL ELSE $3::int END,
            CASE WHEN r.scope_type = 'institution' THEN $3::int END, $4
       FROM roles r WHERE r.key = $2 AND r.institution_id IS NULL AND r.is_system
     ON CONFLICT ON CONSTRAINT user_roles_user_role_scope_key DO NOTHING`,
    [userId, roleKey, scopeId, grantedBy]
  );
  if (rowCount === 0) {
    const exists = await db.query(`SELECT 1 FROM roles WHERE key = $1 AND institution_id IS NULL AND is_system`, [roleKey]);
    if (!exists.rowCount) throw new Error(`Unknown system role "${roleKey}" — has the database been migrated?`);
  }
}

/**
 * Make the database catalogue match @acadex/shared: every permission exists with its
 * description, and every built-in role has exactly its defined permission set.
 * Runs after migrations on every deploy.
 */
export async function syncRbacCatalogue(client: Queryable): Promise<void> {
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
      `INSERT INTO roles (institution_id, key, name, is_system, scope_type) VALUES (NULL, $1, $2, true, $3)
       ON CONFLICT ON CONSTRAINT roles_institution_id_key_key DO UPDATE SET name = EXCLUDED.name, scope_type = EXCLUDED.scope_type
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
