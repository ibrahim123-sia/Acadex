// The AI layer: usage and cost per call, an institution's own provider keys, the course
// knowledge base (chunks with embeddings and full-text search), tutor conversations,
// copilot proposals (approve before apply), learning-process evidence, early-warning risk
// scores and interventions, media transcripts and report-card comments.
import { sql } from 'drizzle-orm';
import { boolean, check, customType, date, foreignKey, index, integer, jsonb, numeric, pgTable, real, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { files, institutions, users } from './core';
import { courseOfferings, students, terms } from './academics';
import { assessments, submissions } from './lms';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** Every model call: who, for what, which model, tokens and estimated cost. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'),
    userId: integer('user_id'),
    feature: text('feature').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    latencyMs: integer('latency_ms').notNull().default(0),
    status: text('status').notNull().default('ok'),
    error: text('error'),
    byoKey: boolean('byo_key').notNull().default(false),
    ...created,
  },
  (t) => [
    index('idx_ai_usage_institution').on(t.institutionId, t.createdAt),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'ai_usage_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'ai_usage_user_id_fkey' }).onDelete('set null'),
    check('ai_usage_status_check', sql`${t.status} IN ('ok', 'error', 'blocked', 'quota')`),
  ]
);

/** An institution's own key for a provider (bring your own key), sealed. */
export const aiProviderKeys = pgTable(
  'ai_provider_keys',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    provider: text('provider').notNull(),
    keySealed: text('key_sealed').notNull(),
    updatedBy: integer('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('ai_provider_keys', t as never),
    foreignKey({ columns: [t.updatedBy], foreignColumns: [users.id], name: 'ai_provider_keys_updated_by_fkey' }).onDelete('set null'),
    unique('ai_provider_keys_institution_id_provider_key').on(t.institutionId, t.provider),
    check('ai_provider_keys_provider_check', sql`${t.provider} IN ('openai', 'anthropic', 'gemini', 'groq')`),
  ]
);

/**
 * The knowledge base: course material (and Acadex's own help articles, with no institution)
 * split into chunks, each with an embedding and a full-text index for hybrid search.
 */
export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'),
    offeringId: integer('offering_id'),
    sourceType: text('source_type').notNull(),
    sourceId: integer('source_id').notNull(),
    chunkNo: integer('chunk_no').notNull(),
    title: text('title').notNull(),
    /** where in the course it is (a link the citation opens) */
    locator: text('locator').notNull().default(''),
    content: text('content').notNull(),
    tokens: integer('tokens').notNull().default(0),
    embedding: real('embedding').array(),
    embeddingModel: text('embedding_model'),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('simple', title || ' ' || content)`),
    hash: text('hash').notNull(),
    ...created,
  },
  (t) => [
    index('idx_kb_chunks_offering').on(t.offeringId),
    index('idx_kb_chunks_tsv').using('gin', t.tsv),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'kb_chunks_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'kb_chunks_offering_id_fkey' }).onDelete('cascade'),
    unique('kb_chunks_source_type_source_id_chunk_no_key').on(t.sourceType, t.sourceId, t.chunkNo),
    check('kb_chunks_source_type_check', sql`${t.sourceType} IN ('content_item', 'assessment', 'file', 'transcript', 'help')`),
  ]
);

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    userId: integer('user_id').notNull(),
    kind: text('kind').notNull().default('tutor'),
    studentId: integer('student_id'),
    offeringId: integer('offering_id'),
    assessmentId: integer('assessment_id'),
    title: text('title').notNull().default(''),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_ai_conversations_user').on(t.userId, t.updatedAt),
    tenant('ai_conversations', t as never),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'ai_conversations_user_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'ai_conversations_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'ai_conversations_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'ai_conversations_assessment_id_fkey' }).onDelete('set null'),
    check('ai_conversations_kind_check', sql`${t.kind} IN ('tutor', 'helpdesk', 'ask')`),
  ]
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    conversationId: integer('conversation_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    /** [{ chunk_id, title, locator }] */
    citations: jsonb('citations').notNull().default(sql`'[]'::jsonb`),
    /** why a message was refused or changed (moderation, policy, off-topic, leak) */
    flag: text('flag'),
    /** the course item the question was mostly about (anonymous "stuck points") */
    topicItemId: integer('topic_item_id'),
    ...created,
  },
  (t) => [
    index('idx_ai_messages_conversation').on(t.conversationId),
    tenant('ai_messages', t as never),
    foreignKey({ columns: [t.conversationId], foreignColumns: [aiConversations.id], name: 'ai_messages_conversation_id_fkey' }).onDelete('cascade'),
    check('ai_messages_role_check', sql`${t.role} IN ('user', 'assistant')`),
  ]
);

/** A copilot proposal: generated, previewed and edited by a person, then applied or rejected. */
export const aiActions = pgTable(
  'ai_actions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    userId: integer('user_id').notNull(),
    offeringId: integer('offering_id'),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('proposed'),
    input: jsonb('input').notNull(),
    proposal: jsonb('proposal').notNull(),
    /** what the person applied (their edits to the proposal) */
    applied: jsonb('applied'),
    result: jsonb('result'),
    model: text('model').notNull().default(''),
    decidedBy: integer('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    index('idx_ai_actions_user').on(t.userId, t.createdAt),
    tenant('ai_actions', t as never),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'ai_actions_user_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'ai_actions_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.decidedBy], foreignColumns: [users.id], name: 'ai_actions_decided_by_fkey' }).onDelete('set null'),
    check('ai_actions_status_check', sql`${t.status} IN ('proposed', 'applied', 'rejected', 'failed')`),
  ]
);

/** How a student wrote a piece of work: time actively writing, typing and pasting. */
export const submissionActivity = pgTable(
  'submission_activity',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assessmentId: integer('assessment_id').notNull(),
    studentId: integer('student_id').notNull(),
    activeSeconds: integer('active_seconds').notNull().default(0),
    keystrokes: integer('keystrokes').notNull().default(0),
    pastes: integer('pastes').notNull().default(0),
    pastedChars: integer('pasted_chars').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('submission_activity', t as never),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'submission_activity_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'submission_activity_student_id_fkey' }).onDelete('cascade'),
    unique('submission_activity_assessment_id_student_id_key').on(t.assessmentId, t.studentId),
  ]
);

/** "Explain your work": questions generated from the student's own submission, and answers. */
export const vivaSessions = pgTable(
  'viva_sessions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    submissionId: integer('submission_id').notNull(),
    questions: jsonb('questions').notNull(),
    answers: jsonb('answers').notNull().default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('open'),
    teacherNote: text('teacher_note').notNull().default(''),
    createdBy: integer('created_by'),
    ...created,
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    tenant('viva_sessions', t as never),
    foreignKey({ columns: [t.submissionId], foreignColumns: [submissions.id], name: 'viva_sessions_submission_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'viva_sessions_created_by_fkey' }).onDelete('set null'),
    check('viva_sessions_status_check', sql`${t.status} IN ('open', 'answered', 'reviewed')`),
  ]
);

/** The nightly early-warning score of a student, with the factors behind it. */
export const riskScores = pgTable(
  'risk_scores',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    computedOn: date('computed_on').notNull(),
    score: integer('score').notNull(),
    level: text('level').notNull(),
    /** [{ key, label, value, weight, points }] */
    factors: jsonb('factors').notNull(),
    ...created,
  },
  (t) => [
    index('idx_risk_scores_level').on(t.institutionId, t.computedOn, t.level),
    tenant('risk_scores', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'risk_scores_student_id_fkey' }).onDelete('cascade'),
    unique('risk_scores_student_id_computed_on_key').on(t.studentId, t.computedOn),
    check('risk_scores_level_check', sql`${t.level} IN ('low', 'medium', 'high')`),
    check('risk_scores_score_check', sql`${t.score} BETWEEN 0 AND 100`),
  ]
);

export const interventions = pgTable(
  'interventions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    kind: text('kind').notNull(),
    note: text('note').notNull().default(''),
    ownerId: integer('owner_id'),
    status: text('status').notNull().default('open'),
    dueOn: date('due_on'),
    outcome: text('outcome').notNull().default(''),
    guardianAlerted: boolean('guardian_alerted').notNull().default(false),
    createdBy: integer('created_by'),
    ...created,
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_interventions_student').on(t.studentId),
    tenant('interventions', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'interventions_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.ownerId], foreignColumns: [users.id], name: 'interventions_owner_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'interventions_created_by_fkey' }).onDelete('set null'),
    check('interventions_kind_check', sql`${t.kind} IN ('meeting', 'call_guardian', 'tutoring', 'counselling', 'study_plan', 'fee_plan', 'other')`),
    check('interventions_status_check', sql`${t.status} IN ('open', 'done', 'cancelled')`),
  ]
);

/** Captions and transcripts of uploaded audio and video (and their translations). */
export const mediaTranscripts = pgTable(
  'media_transcripts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    fileId: integer('file_id').notNull(),
    language: text('language').notNull().default('en'),
    text: text('text').notNull().default(''),
    vtt: text('vtt').notNull().default(''),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('media_transcripts', t as never),
    foreignKey({ columns: [t.fileId], foreignColumns: [files.id], name: 'media_transcripts_file_id_fkey' }).onDelete('cascade'),
    unique('media_transcripts_file_id_language_key').on(t.fileId, t.language),
    check('media_transcripts_status_check', sql`${t.status} IN ('pending', 'done', 'failed')`),
  ]
);

/** A comment on a student's report card for a term (written, or drafted by the copilot and approved). */
export const reportComments = pgTable(
  'report_comments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    termId: integer('term_id'),
    comment: text('comment').notNull(),
    aiAssisted: boolean('ai_assisted').notNull().default(false),
    createdBy: integer('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('report_comments', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'report_comments_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.termId], foreignColumns: [terms.id], name: 'report_comments_term_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'report_comments_created_by_fkey' }).onDelete('set null'),
    unique('report_comments_student_id_term_id_key').on(t.studentId, t.termId).nullsNotDistinct(),
  ]
);
