// Tenants and accounts. Constraint names match the pre-Drizzle schema so migrations work on
// databases created by the legacy SQL files too.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';

/** School chains and university systems: several institutions under one umbrella. */
export const institutionGroups = pgTable(
  'institution_groups',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('institution_groups_slug_key').on(t.slug)]
);

export const institutions = pgTable(
  'institutions',
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
    /** school | chain | college | university | academy | training_center — drives the defaults */
    type: text('type').default('school').notNull(),
    groupId: integer('group_id'),
    country: text('country').default('PK').notNull(),
    /** terminology overrides, working days, storage quota, … (validated by @acadex/shared) */
    settings: jsonb('settings').default(sql`'{}'::jsonb`).notNull(),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  },
  (t) => [
    unique('institutions_slug_key').on(t.slug),
    check('institutions_currency_iso', sql`${t.currency} ~ '^[A-Z]{3}$'::text`),
    check('institutions_plan_check', sql`${t.plan} = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])`),
    foreignKey({ columns: [t.groupId], foreignColumns: [institutionGroups.id], name: 'institutions_group_id_fkey' }).onDelete('set null'),
    check(
      'institutions_type_check',
      sql`${t.type} IN ('school', 'chain', 'college', 'university', 'academy', 'training_center')`
    ),
    check('institutions_status_check', sql`${t.status} = ANY (ARRAY['active'::text, 'suspended'::text])`),
  ]
);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'), // NULL only for platform staff
    role: text('role').notNull(),
    email: text('email').notNull(),
    /** NULL until an invited user sets a password */
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    refId: integer('ref_id'), // teachers.id or students.id for profile linkage
    isActive: boolean('is_active').default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    tokenVersion: integer('token_version').default(0).notNull(),
    mustChangePassword: boolean('must_change_password').default(false).notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  },
  (t) => [
    index('idx_users_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'users_institution_id_fkey' }).onDelete('cascade'),
    unique('users_email_key').on(t.email),
    check(
      'users_role_check',
      sql`${t.role} = ANY (ARRAY['super_admin'::text, 'group_admin'::text, 'institution_admin'::text, 'teacher'::text, 'student'::text, 'parent'::text])`
    ),
  ]
);

/** Uploaded files (photos, documents, imports). Bytes live in the storage driver (local / S3). */
export const files = pgTable(
  'files',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    purpose: text('purpose').notNull(),
    scanStatus: text('scan_status').notNull().default('clean'),
    createdBy: integer('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
  },
  (t) => [
    index('idx_files_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'files_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'files_created_by_fkey' }).onDelete('set null'),
    unique('files_storage_key_key').on(t.storageKey),
    check('files_purpose_check', sql`${t.purpose} IN ('photo', 'document', 'import', 'logo', 'course', 'submission', 'feedback', 'package')`),
    check('files_scan_status_check', sql`${t.scanStatus} IN ('pending', 'clean', 'infected', 'skipped')`),
  ]
);
