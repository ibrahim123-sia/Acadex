// Role-based access control. Permissions are granted through roles; each assignment of a
// role to a user carries a scope (the whole platform, or one school; group / campus /
// section scopes come with the multi-campus structure).
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { schools, users } from './core';

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull().default(''),
});

export const roles = pgTable(
  'roles',
  {
    id: serial('id').primaryKey(),
    /** NULL for built-in roles shared by every school; set for a school's custom roles. */
    schoolId: integer('school_id'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    /** 'platform' roles can only be granted platform-wide; 'school' roles per school. */
    scopeType: text('scope_type').notNull().default('school'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'roles_school_id_fkey' }).onDelete('cascade'),
    unique('roles_school_id_key_key').on(t.schoolId, t.key).nullsNotDistinct(),
    check('roles_scope_type_check', sql`${t.scopeType} IN ('platform', 'school')`),
    check('roles_system_has_no_school', sql`NOT ${t.isSystem} OR ${t.schoolId} IS NULL`),
  ]
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id').notNull(),
    permission: text('permission').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission], name: 'role_permissions_pkey' }),
    foreignKey({ columns: [t.roleId], foreignColumns: [roles.id], name: 'role_permissions_role_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.permission], foreignColumns: [permissions.key], name: 'role_permissions_permission_fkey' })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ]
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    roleId: integer('role_id').notNull(),
    scopeType: text('scope_type').notNull(),
    /** The school id for scope_type 'school'; NULL for 'platform'. */
    scopeId: integer('scope_id'),
    grantedBy: integer('granted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_user_roles_user').on(t.userId),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'user_roles_user_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.roleId], foreignColumns: [roles.id], name: 'user_roles_role_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.grantedBy], foreignColumns: [users.id], name: 'user_roles_granted_by_fkey' }).onDelete('set null'),
    unique('user_roles_user_role_scope_key').on(t.userId, t.roleId, t.scopeType, t.scopeId).nullsNotDistinct(),
    check('user_roles_scope_check', sql`(${t.scopeType} = 'platform' AND ${t.scopeId} IS NULL) OR (${t.scopeType} = 'school' AND ${t.scopeId} IS NOT NULL)`),
  ]
);
