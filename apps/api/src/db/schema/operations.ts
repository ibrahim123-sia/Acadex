import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { institutions, users } from './core';
import { campuses, courseOfferings, sections, students, teachers } from './academics';
import { guardians } from './people';

export const teacherAttendance = pgTable(
  'teacher_attendance',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    attDate: date('att_date').notNull(),
    status: text('status').notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'teacher_attendance_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'teacher_attendance_teacher_id_fkey' }).onDelete('cascade'),
    unique('teacher_attendance_teacher_id_att_date_key').on(t.teacherId, t.attDate),
    check('teacher_attendance_status_check', sql`${t.status} = ANY (ARRAY['Present'::text, 'Absent'::text, 'Leave'::text])`),
  ]
);

export const tuitionFee = pgTable(
  'tuition_fee',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    receiptId: text('receipt_id').notNull(),
    studentId: integer('student_id').notNull(),
    totalFee: numeric('total_fee', { precision: 10, scale: 2 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 10, scale: 2 }).default(sql`0`).notNull(),
    remainingBalance: numeric('remaining_balance', { precision: 10, scale: 2 }).default(sql`0`).notNull(),
    paymentDate: date('payment_date').default(sql`CURRENT_DATE`),
    paymentStatus: text('payment_status').default('Pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_fee_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'tuition_fee_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'tuition_fee_student_id_fkey' }).onDelete('cascade'),
    check('tuition_fee_payment_status_check', sql`${t.paymentStatus} = ANY (ARRAY['Paid'::text, 'Partial'::text, 'Pending'::text])`),
  ]
);

export const announcements = pgTable(
  'announcements',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    title: text('title').notNull(),
    targetAudience: text('target_audience').default('All').notNull(),
    description: text('description').notNull(),
    startDate: date('start_date').default(sql`CURRENT_DATE`),
    endDate: date('end_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    /** scope: the whole institution, or one campus, section or course */
    campusId: integer('campus_id'),
    sectionId: integer('section_id'),
    offeringId: integer('offering_id'),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_ann_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'announcements_institution_id_fkey' }).onDelete('cascade'),
    check('announcements_target_audience_check', sql`${t.targetAudience} IN ('All', 'Teachers', 'Students', 'Parents')`),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'announcements_campus_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'announcements_section_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'announcements_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'announcements_created_by_fkey' }).onDelete('set null'),
  ]
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'),
    userId: integer('user_id').notNull(),
    type: text('type').default('info').notNull(),
    title: text('title').notNull(),
    message: text('message').default(''),
    link: text('link').default(''),
    isRead: boolean('is_read').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    /** a person gets each key at most once (reminders, alerts) */
    dedupeKey: text('dedupe_key'),
  },
  (t) => [
    index('idx_notif_user').on(t.userId, t.isRead),
    unique('notifications_user_id_dedupe_key_key').on(t.userId, t.dedupeKey),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'notifications_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'notifications_user_id_fkey' }).onDelete('cascade'),
  ]
);

export const guardianships = pgTable(
  'guardianships',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    guardianId: integer('guardian_id').notNull(),
    studentId: integer('student_id').notNull(),
    relationship: text('relationship').notNull().default('guardian'),
    isPrimary: boolean('is_primary').notNull().default(false),
    canViewGrades: boolean('can_view_grades').notNull().default(true),
    canViewFees: boolean('can_view_fees').notNull().default(true),
    canMessage: boolean('can_message').notNull().default(true),
    isEmergencyContact: boolean('is_emergency_contact').notNull().default(false),
  },
  (t) => [
    index('idx_guardianships_student').on(t.studentId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'guardianships_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.guardianId], foreignColumns: [guardians.id], name: 'guardianships_guardian_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'guardianships_student_id_fkey' }).onDelete('cascade'),
    unique('guardianships_guardian_id_student_id_key').on(t.guardianId, t.studentId),
    check('guardianships_relationship_check', sql`${t.relationship} IN ('father', 'mother', 'guardian', 'grandparent', 'sibling', 'other')`),
  ]
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'),
    userId: integer('user_id'),
    actor: text('actor').default(''),
    action: text('action').notNull(),
    entity: text('entity').default(''),
    detail: text('detail').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    entityId: text('entity_id'),
    /** changed fields: { field: [before, after] } (masked for restricted tables) */
    changes: jsonb('changes'),
    ip: text('ip'),
    requestId: text('request_id'),
  },
  (t) => [
    index('idx_audit_institution').on(t.institutionId),
    index('idx_audit_entity').on(t.entity, t.entityId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'audit_log_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'audit_log_user_id_fkey' }).onDelete('set null'),
  ]
);
