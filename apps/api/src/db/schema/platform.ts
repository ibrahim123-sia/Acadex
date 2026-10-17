// The SaaS platform (Phase 6): plans with limits and features, tenant billing (invoices with
// tax and dunning), daily usage metering, platform announcements, custom domains, tenant data
// exports, public API keys and webhooks, consents and data-subject requests, report
// schedules, demo requests and product feedback.
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { institutions, users } from './core';
export { plans } from './core';
import { students } from './academics';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

// ---------------------------------------------------------------- plans and billing

/** Invoices the platform sends to institutions (Acadex's own revenue, not school fees). */
export const platformInvoices = pgTable(
  'platform_invoices',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    number: text('number').notNull(),
    plan: text('plan').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    currency: text('currency').notNull(),
    /** [{ label, quantity, unit, amount }] */
    lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    taxLabel: text('tax_label').notNull().default(''),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    tax: numeric('tax', { precision: 12, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
    status: text('status').notNull().default('open'),
    dueDate: date('due_date').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    method: text('method'),
    reference: text('reference').notNull().default(''),
    checkoutId: text('checkout_id'),
    remindersSent: integer('reminders_sent').notNull().default(0),
    ...created,
  },
  (t) => [
    unique('platform_invoices_number_key').on(t.number),
    unique('platform_invoices_institution_id_period_start_key').on(t.institutionId, t.periodStart),
    index('idx_platform_invoices_status').on(t.status, t.dueDate),
    tenant('platform_invoices', t as never),
    check('platform_invoices_status_check', sql`${t.status} IN ('open', 'paid', 'void', 'overdue')`),
    check('platform_invoices_method_check', sql`${t.method} IS NULL OR ${t.method} IN ('stripe', 'bank', 'manual', 'free')`),
  ]
);

/** One row per institution per day: what it uses (and what that costs the platform). */
export const usageSnapshots = pgTable(
  'usage_snapshots',
  {
    institutionId: integer('institution_id').notNull(),
    day: date('day').notNull(),
    students: integer('students').notNull().default(0),
    staff: integer('staff').notNull().default(0),
    storageBytes: numeric('storage_bytes', { precision: 18, scale: 0 }).notNull().default('0'),
    aiUsd: numeric('ai_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    aiTokens: integer('ai_tokens').notNull().default(0),
    sms: integer('sms').notNull().default(0),
    whatsapp: integer('whatsapp').notNull().default(0),
    emails: integer('emails').notNull().default(0),
    activeUsers: integer('active_users').notNull().default(0),
    ...created,
  },
  (t) => [primaryKey({ columns: [t.institutionId, t.day], name: 'usage_snapshots_pkey' }), tenant('usage_snapshots', t as never)]
);

/** Platform-wide settings (unit costs for margins, billing defaults, legal entity). */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Messages from the platform to institutions (shown as a banner to their administrators). */
export const platformAnnouncements = pgTable(
  'platform_announcements',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    level: text('level').notNull().default('info'),
    /** null: every institution; else only these plans */
    plans: text('plans').array(),
    startsAt: timestamp('starts_at', { withTimezone: true }).defaultNow().notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'platform_announcements_created_by_fkey' }).onDelete('set null'),
    check('platform_announcements_level_check', sql`${t.level} IN ('info', 'warning', 'critical')`),
  ]
);

/** An institution's own domain (white-label), verified by a DNS TXT record. */
export const customDomains = pgTable(
  'custom_domains',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    domain: text('domain').notNull(),
    token: text('token').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...created,
  },
  (t) => [unique('custom_domains_domain_key').on(t.domain), tenant('custom_domains', t as never)]
);

/** Full exports of an institution's data (CSV per table + files, as a ZIP). */
export const dataExports = pgTable(
  'data_exports',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    requestedBy: integer('requested_by'),
    /** institution (everything) or person (one data subject) */
    scope: text('scope').notNull().default('institution'),
    subjectUserId: integer('subject_user_id'),
    status: text('status').notNull().default('queued'),
    storageKey: text('storage_key'),
    sizeBytes: integer('size_bytes'),
    error: text('error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    tenant('data_exports', t as never),
    foreignKey({ columns: [t.requestedBy], foreignColumns: [users.id], name: 'data_exports_requested_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.subjectUserId], foreignColumns: [users.id], name: 'data_exports_subject_user_id_fkey' }).onDelete('set null'),
    check('data_exports_scope_check', sql`${t.scope} IN ('institution', 'person')`),
    check('data_exports_status_check', sql`${t.status} IN ('queued', 'running', 'done', 'failed', 'expired')`),
  ]
);

// ---------------------------------------------------------------- public API and webhooks

export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    /** first characters, to recognise the key */
    prefix: text('prefix').notNull(),
    /** SHA-256 of the key; the key itself is shown once */
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdBy: integer('created_by'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    unique('api_keys_key_hash_key').on(t.keyHash),
    tenant('api_keys', t as never),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'api_keys_created_by_fkey' }).onDelete('set null'),
  ]
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    url: text('url').notNull(),
    events: text('events').array().notNull(),
    /** sealed signing secret (HMAC-SHA256) */
    secretSealed: text('secret_sealed').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    failures: integer('failures').notNull().default(0),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [tenant('webhook_endpoints', t as never), foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'webhook_endpoints_created_by_fkey' }).onDelete('set null')]
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    endpointId: integer('endpoint_id').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseCode: integer('response_code'),
    error: text('error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    index('idx_webhook_deliveries_endpoint').on(t.endpointId, t.id),
    tenant('webhook_deliveries', t as never),
    foreignKey({ columns: [t.endpointId], foreignColumns: [webhookEndpoints.id], name: 'webhook_deliveries_endpoint_id_fkey' }).onDelete('cascade'),
    check('webhook_deliveries_status_check', sql`${t.status} IN ('pending', 'delivered', 'failed')`),
  ]
);

/** External learning tools launched with LTI 1.3 (Acadex is the platform). */
export const ltiTools = pgTable(
  'lti_tools',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    clientId: text('client_id').notNull(),
    /** the tool's OIDC login initiation URL */
    loginUrl: text('login_url').notNull(),
    /** where the signed launch is posted */
    launchUrl: text('launch_url').notNull(),
    /** the tool's public keys (to verify deep-link responses) */
    jwksUrl: text('jwks_url').notNull().default(''),
    deploymentId: text('deployment_id').notNull(),
    /** share name / email with the tool */
    sendPii: boolean('send_pii').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    ...created,
  },
  (t) => [tenant('lti_tools', t as never)]
);

/** One-time OIDC login states of LTI launches (nonce, who, which course). */
export const ltiLaunches = pgTable(
  'lti_launches',
  {
    state: text('state').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    toolId: integer('tool_id').notNull(),
    userId: integer('user_id').notNull(),
    offeringId: integer('offering_id'),
    nonce: text('nonce').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    tenant('lti_launches', t as never),
    foreignKey({ columns: [t.toolId], foreignColumns: [ltiTools.id], name: 'lti_launches_tool_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'lti_launches_user_id_fkey' }).onDelete('cascade'),
  ]
);

// ---------------------------------------------------------------- privacy

/** Consents given (guardians for minors: photos, AI features, data processing; tenant AI consent). */
export const consents = pgTable(
  'consents',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** who gave it */
    userId: integer('user_id'),
    /** whom it is about (a child), when not the giver */
    studentId: integer('student_id'),
    kind: text('kind').notNull(),
    granted: boolean('granted').notNull(),
    /** the text version agreed to */
    version: text('version').notNull().default('1'),
    ip: text('ip'),
    ...created,
  },
  (t) => [
    index('idx_consents_subject').on(t.institutionId, t.studentId, t.kind),
    tenant('consents', t as never),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'consents_user_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'consents_student_id_fkey' }).onDelete('cascade'),
    check('consents_kind_check', sql`${t.kind} IN ('data_processing', 'photos', 'ai_features', 'messaging', 'marketing', 'tenant_ai', 'tenant_dpa')`),
  ]
);

/** Requests from people about their own data: a copy, a correction, deletion. */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    userId: integer('user_id'),
    kind: text('kind').notNull(),
    details: text('details').notNull().default(''),
    status: text('status').notNull().default('open'),
    handledBy: integer('handled_by'),
    response: text('response').notNull().default(''),
    exportId: integer('export_id'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    tenant('privacy_requests', t as never),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'privacy_requests_user_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.handledBy], foreignColumns: [users.id], name: 'privacy_requests_handled_by_fkey' }).onDelete('set null'),
    check('privacy_requests_kind_check', sql`${t.kind} IN ('access', 'correction', 'deletion')`),
    check('privacy_requests_status_check', sql`${t.status} IN ('open', 'done', 'rejected')`),
  ]
);

// ---------------------------------------------------------------- reports

/** Reports emailed on a schedule (as Excel / PDF attachments). */
export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    report: text('report').notNull(),
    filters: jsonb('filters').notNull().default(sql`'{}'::jsonb`),
    format: text('format').notNull().default('xlsx'),
    frequency: text('frequency').notNull(),
    recipients: text('recipients').array().notNull(),
    createdBy: integer('created_by'),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    ...created,
  },
  (t) => [
    tenant('report_schedules', t as never),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'report_schedules_created_by_fkey' }).onDelete('set null'),
    check('report_schedules_format_check', sql`${t.format} IN ('xlsx', 'csv', 'pdf')`),
    check('report_schedules_frequency_check', sql`${t.frequency} IN ('daily', 'weekly', 'monthly')`),
  ]
);

// ---------------------------------------------------------------- the public site and feedback

export const demoRequests = pgTable('demo_requests', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull().default(''),
  institution: text('institution').notNull(),
  type: text('type').notNull().default('school'),
  size: text('size').notNull().default(''),
  message: text('message').notNull().default(''),
  status: text('status').notNull().default('new'),
  ...created,
});

export const productFeedback = pgTable(
  'product_feedback',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'),
    userId: integer('user_id'),
    page: text('page').notNull().default(''),
    rating: integer('rating'),
    message: text('message').notNull(),
    ...created,
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'product_feedback_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'product_feedback_user_id_fkey' }).onDelete('set null'),
    check('product_feedback_rating_check', sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  ]
);
