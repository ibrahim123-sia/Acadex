// Admissions: public application forms, applications with documents and an entrance test,
// merit lists and offers, and the enquiry (lead) tracker with follow-ups.
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { files, institutions, users } from './core';
import { academicYears, campuses, programLevels, programs, students } from './academics';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

export const admissionForms = pgTable(
  'admission_forms',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** the public address: /apply/<institution slug>/<slug> */
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    academicYearId: integer('academic_year_id'),
    campusId: integer('campus_id'),
    programId: integer('program_id'),
    programLevelId: integer('program_level_id'),
    /** extra questions: [{ key, label, type: text | number | date | select | textarea, options?, required }] */
    fields: jsonb('fields').notNull().default(sql`'[]'::jsonb`),
    /** documents to upload: [{ key, label, required }] */
    documents: jsonb('documents').notNull().default(sql`'[]'::jsonb`),
    applicationFee: numeric('application_fee', { precision: 12, scale: 2 }).notNull().default('0'),
    /** online entrance test: { bank_id, tag?, count, minutes } or null for an in-person test / none */
    entranceTest: jsonb('entrance_test'),
    seats: integer('seats'),
    opensAt: timestamp('opens_at', { withTimezone: true }),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    status: text('status').notNull().default('draft'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('admission_forms', t as never),
    foreignKey({ columns: [t.academicYearId], foreignColumns: [academicYears.id], name: 'admission_forms_academic_year_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'admission_forms_campus_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.programId], foreignColumns: [programs.id], name: 'admission_forms_program_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.programLevelId], foreignColumns: [programLevels.id], name: 'admission_forms_program_level_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'admission_forms_created_by_fkey' }).onDelete('set null'),
    unique('admission_forms_institution_id_slug_key').on(t.institutionId, t.slug),
    check('admission_forms_status_check', sql`${t.status} IN ('draft', 'open', 'closed')`),
  ]
);

export const applications = pgTable(
  'applications',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    formId: integer('form_id').notNull(),
    number: text('number').notNull(),
    /** the applicant's private link (status, documents, payment, test, offer) */
    tokenHash: text('token_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull().default(''),
    dob: date('dob'),
    gender: text('gender'),
    email: text('email').notNull(),
    phone: text('phone').notNull().default(''),
    guardianName: text('guardian_name').notNull().default(''),
    guardianPhone: text('guardian_phone').notNull().default(''),
    guardianEmail: text('guardian_email').notNull().default(''),
    guardianRelationship: text('guardian_relationship').notNull().default('guardian'),
    previousSchool: text('previous_school').notNull().default(''),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('submitted'),
    /** entrance test */
    testAt: timestamp('test_at', { withTimezone: true }),
    testVenue: text('test_venue').notNull().default(''),
    testScore: numeric('test_score', { precision: 7, scale: 2 }),
    testMax: numeric('test_max', { precision: 7, scale: 2 }),
    /** online test: the questions given and the answers */
    testLayout: jsonb('test_layout'),
    testAnswers: jsonb('test_answers'),
    testStartedAt: timestamp('test_started_at', { withTimezone: true }),
    testDeadline: timestamp('test_deadline', { withTimezone: true }),
    interviewScore: numeric('interview_score', { precision: 7, scale: 2 }),
    meritRank: integer('merit_rank'),
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    decidedBy: integer('decided_by'),
    studentId: integer('student_id'),
    enquiryId: integer('enquiry_id'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_applications_form').on(t.formId, t.status),
    tenant('applications', t as never),
    foreignKey({ columns: [t.formId], foreignColumns: [admissionForms.id], name: 'applications_form_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.decidedBy], foreignColumns: [users.id], name: 'applications_decided_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'applications_student_id_fkey' }).onDelete('set null'),
    unique('applications_institution_id_number_key').on(t.institutionId, t.number),
    unique('applications_token_hash_key').on(t.tokenHash),
    check(
      'applications_status_check',
      sql`${t.status} IN ('submitted', 'under_review', 'test_scheduled', 'tested', 'offered', 'accepted', 'declined', 'rejected', 'waitlisted', 'enrolled', 'withdrawn')`
    ),
  ]
);

export const applicationDocuments = pgTable(
  'application_documents',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    applicationId: integer('application_id').notNull(),
    key: text('key').notNull(),
    fileId: integer('file_id').notNull(),
    ...created,
  },
  (t) => [
    tenant('application_documents', t as never),
    foreignKey({ columns: [t.applicationId], foreignColumns: [applications.id], name: 'application_documents_application_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.fileId], foreignColumns: [files.id], name: 'application_documents_file_id_fkey' }).onDelete('cascade'),
    unique('application_documents_application_id_key_key').on(t.applicationId, t.key),
  ]
);

/** A lead: someone who asked about admission (walk-in, phone, website …). */
export const enquiries = pgTable(
  'enquiries',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    studentName: text('student_name').notNull().default(''),
    source: text('source').notNull().default('walk_in'),
    campusId: integer('campus_id'),
    programId: integer('program_id'),
    programLevelId: integer('program_level_id'),
    status: text('status').notNull().default('new'),
    assignedTo: integer('assigned_to'),
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),
    notes: text('notes').notNull().default(''),
    lostReason: text('lost_reason').notNull().default(''),
    createdBy: integer('created_by'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_enquiries_status').on(t.institutionId, t.status),
    tenant('enquiries', t as never),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'enquiries_campus_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.programId], foreignColumns: [programs.id], name: 'enquiries_program_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.programLevelId], foreignColumns: [programLevels.id], name: 'enquiries_program_level_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.assignedTo], foreignColumns: [users.id], name: 'enquiries_assigned_to_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'enquiries_created_by_fkey' }).onDelete('set null'),
    check('enquiries_source_check', sql`${t.source} IN ('walk_in', 'phone', 'website', 'social', 'referral', 'event', 'other')`),
    check('enquiries_status_check', sql`${t.status} IN ('new', 'contacted', 'visited', 'applied', 'enrolled', 'lost')`),
  ]
);

export const enquiryFollowups = pgTable(
  'enquiry_followups',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    enquiryId: integer('enquiry_id').notNull(),
    channel: text('channel').notNull().default('phone'),
    note: text('note').notNull(),
    outcome: text('outcome').notNull().default(''),
    nextAt: timestamp('next_at', { withTimezone: true }),
    userId: integer('user_id'),
    ...created,
  },
  (t) => [
    tenant('enquiry_followups', t as never),
    foreignKey({ columns: [t.enquiryId], foreignColumns: [enquiries.id], name: 'enquiry_followups_enquiry_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'enquiry_followups_user_id_fkey' }).onDelete('set null'),
    check('enquiry_followups_channel_check', sql`${t.channel} IN ('phone', 'email', 'whatsapp', 'sms', 'visit', 'other')`),
  ]
);

