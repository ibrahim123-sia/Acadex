import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { institutions, users } from './core';
import { classes, students, teachers } from './academics';

export const studentAttendance = pgTable(
  'student_attendance',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    classId: integer('class_id'),
    subject: text('subject').default(''),
    attDate: date('att_date').notNull(),
    status: text('status').notNull(),
  },
  (t) => [
    index('idx_satt_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'student_attendance_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'student_attendance_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'student_attendance_class_id_fkey' }).onDelete('cascade'),
    check('student_attendance_status_check', sql`${t.status} = ANY (ARRAY['Present'::text, 'Absent'::text, 'Leave'::text])`),
  ]
);

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
  },
  (t) => [
    index('idx_ann_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'announcements_institution_id_fkey' }).onDelete('cascade'),
    check('announcements_target_audience_check', sql`${t.targetAudience} = ANY (ARRAY['All'::text, 'Teachers'::text, 'Students'::text])`),
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
  },
  (t) => [
    index('idx_notif_user').on(t.userId, t.isRead),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'notifications_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'notifications_user_id_fkey' }).onDelete('cascade'),
  ]
);

export const parentChildren = pgTable(
  'parent_children',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    parentUserId: integer('parent_user_id').notNull(),
    studentId: integer('student_id').notNull(),
  },
  (t) => [
    index('idx_pc_parent').on(t.parentUserId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'parent_children_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.parentUserId], foreignColumns: [users.id], name: 'parent_children_parent_user_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'parent_children_student_id_fkey' }).onDelete('cascade'),
    unique('parent_children_parent_user_id_student_id_key').on(t.parentUserId, t.studentId),
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
  },
  (t) => [
    index('idx_audit_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'audit_log_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'audit_log_user_id_fkey' }).onDelete('set null'),
  ]
);
