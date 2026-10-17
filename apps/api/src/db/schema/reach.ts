// Reach and communication (Phase 5): conversations and messages (kept for safeguarding review,
// with reports), help-desk tickets, parent–teacher meetings, emergency broadcasts and the
// institution's live-class provider accounts (Zoom, Teams, Meet).
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { campuses, courseOfferings, students } from './academics';
import { institutions, users } from './core';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

// ---------------------------------------------------------------- messaging

export const conversations = pgTable(
  'conversations',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    kind: text('kind').notNull().default('direct'),
    title: text('title').notNull().default(''),
    /** a class group belongs to a course */
    offeringId: integer('offering_id'),
    createdBy: integer('created_by'),
    /** guardians were added because a student under 18 takes part */
    safeguarded: boolean('safeguarded').notNull().default(false),
    /** locked by safeguarding review: kept, but nobody can post */
    locked: boolean('locked').notNull().default(false),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (t) => [
    index('idx_conversations_institution').on(t.institutionId, t.lastMessageAt),
    tenant('conversations', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'conversations_offering_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'conversations_created_by_fkey' }).onDelete('set null'),
    check('conversations_kind_check', sql`${t.kind} IN ('direct', 'group', 'class')`),
  ]
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: integer('conversation_id').notNull(),
    userId: integer('user_id').notNull(),
    institutionId: integer('institution_id').notNull(),
    /** member, or cc (a guardian added for safeguarding) */
    role: text('role').notNull().default('member'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    muted: boolean('muted').notNull().default(false),
    ...created,
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId], name: 'conversation_members_pkey' }),
    index('idx_conversation_members_user').on(t.userId),
    tenant('conversation_members', t as never),
    foreignKey({ columns: [t.conversationId], foreignColumns: [conversations.id], name: 'conversation_members_conversation_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'conversation_members_user_id_fkey' }).onDelete('cascade'),
    check('conversation_members_role_check', sql`${t.role} IN ('member', 'cc')`),
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    conversationId: integer('conversation_id').notNull(),
    senderId: integer('sender_id'),
    body: text('body').notNull(),
    /** the profanity filter or the safety check matched (the review queue shows it) */
    flagged: boolean('flagged').notNull().default(false),
    flagReason: text('flag_reason'),
    /** hidden by safeguarding review or withdrawn by the sender: kept, not shown to members */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenBy: integer('hidden_by'),
    ...created,
  },
  (t) => [
    index('idx_messages_conversation').on(t.conversationId, t.id),
    index('idx_messages_flagged').on(t.institutionId).where(sql`${t.flagged}`),
    tenant('messages', t as never),
    foreignKey({ columns: [t.conversationId], foreignColumns: [conversations.id], name: 'messages_conversation_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.senderId], foreignColumns: [users.id], name: 'messages_sender_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.hiddenBy], foreignColumns: [users.id], name: 'messages_hidden_by_fkey' }).onDelete('set null'),
  ]
);

export const messageReports = pgTable(
  'message_reports',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    messageId: integer('message_id').notNull(),
    reporterId: integer('reporter_id'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    reviewedBy: integer('reviewed_by'),
    reviewNote: text('review_note').notNull().default(''),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    index('idx_message_reports_status').on(t.institutionId, t.status),
    tenant('message_reports', t as never),
    foreignKey({ columns: [t.messageId], foreignColumns: [messages.id], name: 'message_reports_message_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.reporterId], foreignColumns: [users.id], name: 'message_reports_reporter_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.reviewedBy], foreignColumns: [users.id], name: 'message_reports_reviewed_by_fkey' }).onDelete('set null'),
    check('message_reports_status_check', sql`${t.status} IN ('open', 'actioned', 'dismissed')`),
  ]
);

// ---------------------------------------------------------------- tickets

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    raisedBy: integer('raised_by'),
    studentId: integer('student_id'),
    category: text('category').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('normal'),
    assignedTo: integer('assigned_to'),
    anonymous: boolean('anonymous').notNull().default(false),
    dueAt: timestamp('due_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    satisfaction: integer('satisfaction'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_tickets_institution').on(t.institutionId, t.status),
    index('idx_tickets_raised_by').on(t.raisedBy),
    tenant('tickets', t as never),
    foreignKey({ columns: [t.raisedBy], foreignColumns: [users.id], name: 'tickets_raised_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.assignedTo], foreignColumns: [users.id], name: 'tickets_assigned_to_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'tickets_student_id_fkey' }).onDelete('set null'),
    check('tickets_category_check', sql`${t.category} IN ('complaint', 'feedback', 'suggestion', 'academic', 'fees', 'transport', 'it', 'facilities', 'other')`),
    check('tickets_status_check', sql`${t.status} IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')`),
    check('tickets_priority_check', sql`${t.priority} IN ('low', 'normal', 'high', 'urgent')`),
    check('tickets_satisfaction_check', sql`${t.satisfaction} IS NULL OR ${t.satisfaction} BETWEEN 1 AND 5`),
  ]
);

export const ticketComments = pgTable(
  'ticket_comments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    ticketId: integer('ticket_id').notNull(),
    authorId: integer('author_id'),
    body: text('body').notNull(),
    /** a note for the office only */
    internal: boolean('internal').notNull().default(false),
    ...created,
  },
  (t) => [
    index('idx_ticket_comments_ticket').on(t.ticketId),
    tenant('ticket_comments', t as never),
    foreignKey({ columns: [t.ticketId], foreignColumns: [tickets.id], name: 'ticket_comments_ticket_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.authorId], foreignColumns: [users.id], name: 'ticket_comments_author_id_fkey' }).onDelete('set null'),
  ]
);

// ---------------------------------------------------------------- parent–teacher meetings

export const ptmEvents = pgTable(
  'ptm_events',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    title: text('title').notNull(),
    date: date('date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    slotMinutes: integer('slot_minutes').notNull().default(10),
    mode: text('mode').notNull().default('in_person'),
    location: text('location').notNull().default(''),
    sectionIds: integer('section_ids').array().notNull(),
    allowStudents: boolean('allow_students').notNull().default(false),
    status: text('status').notNull().default('open'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    index('idx_ptm_events_institution').on(t.institutionId, t.date),
    tenant('ptm_events', t as never),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'ptm_events_created_by_fkey' }).onDelete('set null'),
    check('ptm_events_mode_check', sql`${t.mode} IN ('in_person', 'online')`),
    check('ptm_events_status_check', sql`${t.status} IN ('open', 'closed', 'cancelled')`),
  ]
);

export const ptmSlots = pgTable(
  'ptm_slots',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    eventId: integer('event_id').notNull(),
    teacherUserId: integer('teacher_user_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('open'),
    bookedBy: integer('booked_by'),
    studentId: integer('student_id'),
    note: text('note').notNull().default(''),
    joinUrl: text('join_url').notNull().default(''),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_ptm_slots_event').on(t.eventId, t.teacherUserId),
    unique('ptm_slots_event_id_teacher_user_id_starts_at_key').on(t.eventId, t.teacherUserId, t.startsAt),
    // one meeting with each teacher per child per event
    uniqueIndex('ptm_slots_one_per_student').on(t.eventId, t.teacherUserId, t.studentId).where(sql`${t.studentId} IS NOT NULL`),
    tenant('ptm_slots', t as never),
    foreignKey({ columns: [t.eventId], foreignColumns: [ptmEvents.id], name: 'ptm_slots_event_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherUserId], foreignColumns: [users.id], name: 'ptm_slots_teacher_user_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.bookedBy], foreignColumns: [users.id], name: 'ptm_slots_booked_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'ptm_slots_student_id_fkey' }).onDelete('set null'),
    check('ptm_slots_status_check', sql`${t.status} IN ('open', 'booked', 'blocked', 'done', 'no_show')`),
  ]
);

// ---------------------------------------------------------------- broadcasts

export const broadcasts = pgTable(
  'broadcasts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    audience: text('audience').notNull(),
    campusId: integer('campus_id'),
    sectionIds: integer('section_ids').array().notNull().default(sql`'{}'::integer[]`),
    channels: text('channels').array().notNull(),
    /** people reached per channel, filled in as delivery runs */
    counts: jsonb('counts').notNull().default(sql`'{}'::jsonb`),
    sentBy: integer('sent_by'),
    ...created,
  },
  (t) => [
    index('idx_broadcasts_institution').on(t.institutionId, t.createdAt),
    tenant('broadcasts', t as never),
    foreignKey({ columns: [t.sentBy], foreignColumns: [users.id], name: 'broadcasts_sent_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'broadcasts_campus_id_fkey' }).onDelete('set null'),
    check('broadcasts_audience_check', sql`${t.audience} IN ('everyone', 'staff', 'students', 'guardians')`),
  ]
);

// ---------------------------------------------------------------- live-class providers

export const integrationAccounts = pgTable(
  'integration_accounts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    provider: text('provider').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** non-secret settings (account id, client id, organizer) */
    publicConfig: jsonb('public_config').notNull().default(sql`'{}'::jsonb`),
    /** AES-256-GCM sealed JSON of the secrets; never returned by the API */
    secretSealed: text('secret_sealed'),
    updatedBy: integer('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('integration_accounts', t as never),
    foreignKey({ columns: [t.updatedBy], foreignColumns: [users.id], name: 'integration_accounts_updated_by_fkey' }).onDelete('set null'),
    unique('integration_accounts_institution_id_provider_key').on(t.institutionId, t.provider),
    check('integration_accounts_provider_check', sql`${t.provider} IN ('zoom', 'teams', 'meet')`),
  ]
);
