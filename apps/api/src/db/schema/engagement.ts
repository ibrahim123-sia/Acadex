// Engagement and communication: discussions, polls, surveys, badges and points, course
// certificates, notification preferences and push, calendar feeds, SCORM / xAPI, imports.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { institutions, users } from './core';
import { courseOfferings, students } from './academics';
import { contentItems, courseBlueprints, scormPackages } from './lms';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

export const discussions = pgTable(
  'discussions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    title: text('title').notNull(),
    bodyHtml: text('body_html').notNull().default(''),
    /** qa: students see the others' posts only after posting their own */
    mode: text('mode').notNull().default('open'),
    locked: boolean('locked').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false),
    createdBy: integer('created_by'),
    ...created,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
  },
  (t) => [
    index('idx_discussions_offering').on(t.offeringId),
    tenant('discussions', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'discussions_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'discussions_created_by_fkey' }).onDelete('set null'),
    check('discussions_mode_check', sql`${t.mode} IN ('open', 'qa')`),
  ]
);

export const discussionPosts = pgTable(
  'discussion_posts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    discussionId: integer('discussion_id').notNull(),
    parentId: integer('parent_id'),
    authorId: integer('author_id'),
    bodyHtml: text('body_html').notNull(),
    /** moderation: hidden posts are visible only to staff */
    hidden: boolean('hidden').notNull().default(false),
    hiddenBy: integer('hidden_by'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_discussion_posts_discussion').on(t.discussionId),
    tenant('discussion_posts', t as never),
    foreignKey({ columns: [t.discussionId], foreignColumns: [discussions.id], name: 'discussion_posts_discussion_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'discussion_posts_parent_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.authorId], foreignColumns: [users.id], name: 'discussion_posts_author_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.hiddenBy], foreignColumns: [users.id], name: 'discussion_posts_hidden_by_fkey' }).onDelete('set null'),
  ]
);

export const polls = pgTable(
  'polls',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id'),
    question: text('question').notNull(),
    options: jsonb('options').notNull(),
    multiple: boolean('multiple').notNull().default(false),
    anonymous: boolean('anonymous').notNull().default(true),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('polls', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'polls_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'polls_created_by_fkey' }).onDelete('set null'),
  ]
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: integer('poll_id').notNull(),
    userId: integer('user_id').notNull(),
    institutionId: integer('institution_id').notNull(),
    choices: integer('choices').array().notNull(),
    ...created,
  },
  (t) => [
    primaryKey({ columns: [t.pollId, t.userId], name: 'poll_votes_pkey' }),
    tenant('poll_votes', t as never),
    foreignKey({ columns: [t.pollId], foreignColumns: [polls.id], name: 'poll_votes_poll_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'poll_votes_user_id_fkey' }).onDelete('cascade'),
  ]
);

/** Course / teacher evaluations and general forms. */
export const surveys = pgTable(
  'surveys',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    anonymous: boolean('anonymous').notNull().default(true),
    /** [{ id, kind: rating | choice | text, label, options?, required }] */
    questions: jsonb('questions').notNull(),
    audience: text('audience').notNull().default('students'),
    status: text('status').notNull().default('draft'),
    opensAt: timestamp('opens_at', { withTimezone: true }),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('surveys', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'surveys_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'surveys_created_by_fkey' }).onDelete('set null'),
    check('surveys_audience_check', sql`${t.audience} IN ('students', 'staff', 'guardians', 'everyone')`),
    check('surveys_status_check', sql`${t.status} IN ('draft', 'open', 'closed')`),
  ]
);

export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    surveyId: integer('survey_id').notNull(),
    /** NULL for anonymous surveys; respondent_hash still stops anyone answering twice */
    respondentId: integer('respondent_id'),
    respondentHash: text('respondent_hash').notNull(),
    answers: jsonb('answers').notNull(),
    ...created,
  },
  (t) => [
    tenant('survey_responses', t as never),
    foreignKey({ columns: [t.surveyId], foreignColumns: [surveys.id], name: 'survey_responses_survey_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.respondentId], foreignColumns: [users.id], name: 'survey_responses_respondent_id_fkey' }).onDelete('set null'),
    unique('survey_responses_survey_id_respondent_hash_key').on(t.surveyId, t.respondentHash),
  ]
);

// ---------------------------------------------------------------- gamification (optional per institution)

export const badges = pgTable(
  'badges',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default('award'),
    /** { kind: items_completed | streak_days | perfect_score | manual, threshold } */
    criteria: jsonb('criteria').notNull(),
    ...created,
  },
  (t) => [tenant('badges', t as never), unique('badges_institution_id_name_key').on(t.institutionId, t.name)]
);

export const badgeAwards = pgTable(
  'badge_awards',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    badgeId: integer('badge_id').notNull(),
    studentId: integer('student_id').notNull(),
    offeringId: integer('offering_id'),
    awardedBy: integer('awarded_by'),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('badge_awards', t as never),
    foreignKey({ columns: [t.badgeId], foreignColumns: [badges.id], name: 'badge_awards_badge_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'badge_awards_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'badge_awards_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.awardedBy], foreignColumns: [users.id], name: 'badge_awards_awarded_by_fkey' }).onDelete('set null'),
    unique('badge_awards_badge_id_student_id_offering_id_key').on(t.badgeId, t.studentId, t.offeringId).nullsNotDistinct(),
  ]
);

export const pointsLedger = pgTable(
  'points_ledger',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    offeringId: integer('offering_id'),
    points: integer('points').notNull(),
    reason: text('reason').notNull(),
    /** what earned it (e.g. "item:42"), so the same thing never pays twice */
    ref: text('ref').notNull(),
    ...created,
  },
  (t) => [
    tenant('points_ledger', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'points_ledger_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'points_ledger_offering_id_fkey' }).onDelete('cascade'),
    unique('points_ledger_student_id_ref_key').on(t.studentId, t.ref),
  ]
);

// ---------------------------------------------------------------- course certificates

export const certificateTemplates = pgTable(
  'certificate_templates',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** issue automatically when { min_progress_percent, min_grade_percent } are met */
    autoIssue: boolean('auto_issue').notNull().default(true),
    minProgressPercent: integer('min_progress_percent').notNull().default(100),
    minGradePercent: numeric('min_grade_percent', { precision: 5, scale: 2 }),
    ...created,
  },
  (t) => [
    tenant('certificate_templates', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'certificate_templates_offering_id_fkey' }).onDelete('cascade'),
  ]
);

export const certificates = pgTable(
  'certificates',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    templateId: integer('template_id'),
    studentId: integer('student_id').notNull(),
    offeringId: integer('offering_id'),
    verifyCode: text('verify_code').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    tenant('certificates', t as never),
    foreignKey({ columns: [t.templateId], foreignColumns: [certificateTemplates.id], name: 'certificates_template_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'certificates_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'certificates_offering_id_fkey' }).onDelete('set null'),
    unique('certificates_verify_code_key').on(t.verifyCode),
    unique('certificates_template_id_student_id_key').on(t.templateId, t.studentId),
  ]
);

// ---------------------------------------------------------------- notifications

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: integer('user_id').primaryKey(),
    institutionId: integer('institution_id'),
    /** { [type]: { email: boolean, push: boolean } } — in-app is always on */
    channels: jsonb('channels').notNull().default(sql`'{}'::jsonb`),
    /** no email / push between these local times, e.g. { start: "21:00", end: "07:00" } */
    quietHours: jsonb('quiet_hours'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'notification_preferences_user_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'notification_preferences_institution_id_fkey' }).onDelete('cascade'),
  ]
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent').notNull().default(''),
    ...created,
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_push_subscriptions_user').on(t.userId),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'push_subscriptions_user_id_fkey' }).onDelete('cascade'),
    unique('push_subscriptions_endpoint_key').on(t.endpoint),
  ]
);

export const deliveryLogs = pgTable(
  'delivery_logs',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'),
    notificationId: integer('notification_id'),
    userId: integer('user_id'),
    /** phone number for SMS / WhatsApp */
    toAddress: text('to_address'),
    channel: text('channel').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(1),
    ...created,
  },
  (t) => [
    index('idx_delivery_logs_notification').on(t.notificationId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'delivery_logs_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'delivery_logs_user_id_fkey' }).onDelete('cascade'),
    check('delivery_logs_channel_check', sql`${t.channel} IN ('email', 'push', 'sms', 'whatsapp')`),
    check('delivery_logs_status_check', sql`${t.status} IN ('sent', 'failed', 'skipped')`),
  ]
);

/** A secret per person for their calendar (ICS) feed URL. */
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    userId: integer('user_id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    ...created,
  },
  (t) => [
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'calendar_feeds_user_id_fkey' }).onDelete('cascade'),
    unique('calendar_feeds_token_hash_key').on(t.tokenHash),
  ]
);

// ---------------------------------------------------------------- packages & imports



export const scormAttempts = pgTable(
  'scorm_attempts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    packageId: integer('package_id').notNull(),
    itemId: integer('item_id'),
    studentId: integer('student_id').notNull(),
    /** the SCORM data model as the package last committed it */
    cmi: jsonb('cmi').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('incomplete'),
    scorePercent: numeric('score_percent', { precision: 5, scale: 2 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('scorm_attempts', t as never),
    foreignKey({ columns: [t.packageId], foreignColumns: [scormPackages.id], name: 'scorm_attempts_package_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.itemId], foreignColumns: [contentItems.id], name: 'scorm_attempts_item_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'scorm_attempts_student_id_fkey' }).onDelete('cascade'),
    unique('scorm_attempts_package_id_student_id_item_id_key').on(t.packageId, t.studentId, t.itemId).nullsNotDistinct(),
  ]
);

/** A minimal learning record store for xAPI statements from content packages. */
export const xapiStatements = pgTable(
  'xapi_statements',
  {
    id: uuid('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    userId: integer('user_id'),
    verb: text('verb').notNull(),
    objectId: text('object_id').notNull(),
    statement: jsonb('statement').notNull(),
    storedAt: timestamp('stored_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_xapi_statements_user').on(t.userId),
    tenant('xapi_statements', t as never),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'xapi_statements_user_id_fkey' }).onDelete('set null'),
  ]
);

export const contentImports = pgTable(
  'content_imports',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id'),
    blueprintId: integer('blueprint_id'),
    format: text('format').notNull(),
    fileName: text('file_name').notNull().default(''),
    status: text('status').notNull(),
    /** what was created, and what was skipped and why */
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('content_imports', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'content_imports_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.blueprintId], foreignColumns: [courseBlueprints.id], name: 'content_imports_blueprint_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'content_imports_created_by_fkey' }).onDelete('set null'),
    check('content_imports_format_check', sql`${t.format} IN ('imscc', 'mbz', 'qti', 'classroom', 'scorm')`),
    check('content_imports_status_check', sql`${t.status} IN ('completed', 'failed')`),
  ]
);
