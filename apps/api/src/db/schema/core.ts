// Tenants and accounts. Constraint names match the pre-Drizzle schema so migrations work on
// databases created by the legacy SQL files too.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const schools = pgTable(
  'schools',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logoUrl: text('logo_url').default(''),
    primaryColor: text('primary_color').default('#2563EB'),
    contactEmail: text('contact_email').default(''),
    phone: text('phone').default(''),
    address: text('address').default(''),
    plan: text('plan').default('free').notNull(),
    status: text('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    currency: text('currency').default('PKR').notNull(),
    timezone: text('timezone').default('Asia/Karachi').notNull(),
    locale: text('locale').default('en-PK').notNull(),
  },
  (t) => [
    unique('schools_slug_key').on(t.slug),
    check('schools_currency_iso', sql`${t.currency} ~ '^[A-Z]{3}$'::text`),
    check('schools_plan_check', sql`${t.plan} = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])`),
    check('schools_status_check', sql`${t.status} = ANY (ARRAY['active'::text, 'suspended'::text])`),
  ]
);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id'), // NULL only for platform staff
    role: text('role').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    refId: integer('ref_id'), // teachers.id or students.id for profile linkage
    isActive: boolean('is_active').default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    tokenVersion: integer('token_version').default(0).notNull(),
    mustChangePassword: boolean('must_change_password').default(false).notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_users_school').on(t.schoolId),
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'users_school_id_fkey' }).onDelete('cascade'),
    unique('users_email_key').on(t.email),
    check(
      'users_role_check',
      sql`${t.role} = ANY (ARRAY['super_admin'::text, 'school_admin'::text, 'teacher'::text, 'student'::text, 'parent'::text])`
    ),
  ]
);
