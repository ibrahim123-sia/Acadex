// Time: attendance by session, leave requests, rooms and the bell schedule, the timetable with
// substitutions, and live classes.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { institutions, users } from './core';
import { campuses, courseOfferings, sections, students, teachers, terms } from './academics';
import { liveSessions } from './lms';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

export const rooms = pgTable(
  'rooms',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    campusId: integer('campus_id'),
    name: text('name').notNull(),
    code: text('code').notNull(),
    capacity: integer('capacity'),
    kind: text('kind').notNull().default('classroom'),
  },
  (t) => [
    tenant('rooms', t as never),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'rooms_campus_id_fkey' }).onDelete('cascade'),
    unique('rooms_institution_id_code_key').on(t.institutionId, t.code),
    check('rooms_kind_check', sql`${t.kind} IN ('classroom', 'lab', 'hall', 'library', 'ground', 'online', 'other')`),
  ]
);

/** The bell schedule: the periods of a school day (per campus, or institution-wide). */
export const periods = pgTable(
  'periods',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    campusId: integer('campus_id'),
    name: text('name').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    position: integer('position').notNull(),
    isBreak: boolean('is_break').notNull().default(false),
  },
  (t) => [
    tenant('periods', t as never),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'periods_campus_id_fkey' }).onDelete('cascade'),
    unique('periods_institution_id_campus_id_position_key').on(t.institutionId, t.campusId, t.position).nullsNotDistinct(),
    check('periods_times_check', sql`${t.endsAt} > ${t.startsAt}`),
  ]
);

export const timetableSlots = pgTable(
  'timetable_slots',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    termId: integer('term_id'),
    sectionId: integer('section_id').notNull(),
    offeringId: integer('offering_id'),
    teacherId: integer('teacher_id'),
    roomId: integer('room_id'),
    /** 0 = Sunday … 6 = Saturday */
    weekday: smallint('weekday').notNull(),
    periodId: integer('period_id').notNull(),
    ...created,
  },
  (t) => [
    index('idx_timetable_slots_teacher').on(t.teacherId),
    tenant('timetable_slots', t as never),
    foreignKey({ columns: [t.termId], foreignColumns: [terms.id], name: 'timetable_slots_term_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'timetable_slots_section_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'timetable_slots_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'timetable_slots_teacher_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.roomId], foreignColumns: [rooms.id], name: 'timetable_slots_room_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.periodId], foreignColumns: [periods.id], name: 'timetable_slots_period_id_fkey' }).onDelete('cascade'),
    // no clashes: a section, a teacher and a room are each in one place per period
    unique('timetable_slots_section_id_term_id_weekday_period_id_key').on(t.sectionId, t.termId, t.weekday, t.periodId).nullsNotDistinct(),
    uniqueIndex('timetable_slots_teacher_clash').on(t.teacherId, t.termId, t.weekday, t.periodId).where(sql`teacher_id IS NOT NULL`),
    uniqueIndex('timetable_slots_room_clash').on(t.roomId, t.termId, t.weekday, t.periodId).where(sql`room_id IS NOT NULL`),
    check('timetable_slots_weekday_check', sql`${t.weekday} BETWEEN 0 AND 6`),
  ]
);

/** When a teacher can't teach (for the timetable generator). */
export const teacherUnavailability = pgTable(
  'teacher_unavailability',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    weekday: smallint('weekday').notNull(),
    /** NULL = the whole day */
    periodId: integer('period_id'),
  },
  (t) => [
    tenant('teacher_unavailability', t as never),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'teacher_unavailability_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.periodId], foreignColumns: [periods.id], name: 'teacher_unavailability_period_id_fkey' }).onDelete('cascade'),
    unique('teacher_unavailability_teacher_id_weekday_period_id_key').on(t.teacherId, t.weekday, t.periodId).nullsNotDistinct(),
  ]
);

/** Rooms and resources booked outside the timetable (events, labs, the hall). */
export const roomBookings = pgTable(
  'room_bookings',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    roomId: integer('room_id').notNull(),
    title: text('title').notNull(),
    purpose: text('purpose').notNull().default(''),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    bookedBy: integer('booked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_room_bookings_room').on(t.roomId, t.startsAt),
    tenant('room_bookings', t as never),
    foreignKey({ columns: [t.roomId], foreignColumns: [rooms.id], name: 'room_bookings_room_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.bookedBy], foreignColumns: [users.id], name: 'room_bookings_booked_by_fkey' }).onDelete('set null'),
    check('room_bookings_times_check', sql`${t.endsAt} > ${t.startsAt}`),
  ]
);

export const substitutions = pgTable(
  'substitutions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    slotId: integer('slot_id').notNull(),
    date: date('date').notNull(),
    substituteTeacherId: integer('substitute_teacher_id').notNull(),
    reason: text('reason').notNull().default(''),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    index('idx_substitutions_date').on(t.institutionId, t.date),
    tenant('substitutions', t as never),
    foreignKey({ columns: [t.slotId], foreignColumns: [timetableSlots.id], name: 'substitutions_slot_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.substituteTeacherId], foreignColumns: [teachers.id], name: 'substitutions_substitute_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'substitutions_created_by_fkey' }).onDelete('set null'),
    unique('substitutions_slot_id_date_key').on(t.slotId, t.date),
  ]
);

/** One register: a whole day for a section, or one class (offering) in one period. */
export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    sectionId: integer('section_id').notNull(),
    offeringId: integer('offering_id'),
    date: date('date').notNull(),
    periodId: integer('period_id'),
    slotId: integer('slot_id'),
    kind: text('kind').notNull().default('day'),
    takenBy: integer('taken_by'),
    /** QR self check-in: the current secret and when it was issued (rotates) */
    qrSecret: text('qr_secret'),
    qrIssuedAt: timestamp('qr_issued_at', { withTimezone: true }),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_attendance_sessions_date').on(t.institutionId, t.date),
    tenant('attendance_sessions', t as never),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'attendance_sessions_section_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'attendance_sessions_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.periodId], foreignColumns: [periods.id], name: 'attendance_sessions_period_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.slotId], foreignColumns: [timetableSlots.id], name: 'attendance_sessions_slot_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.takenBy], foreignColumns: [users.id], name: 'attendance_sessions_taken_by_fkey' }).onDelete('set null'),
    unique('attendance_sessions_section_id_offering_id_date_period_id_key').on(t.sectionId, t.offeringId, t.date, t.periodId).nullsNotDistinct(),
    check('attendance_sessions_kind_check', sql`${t.kind} IN ('day', 'class')`),
  ]
);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    sessionId: integer('session_id').notNull(),
    studentId: integer('student_id').notNull(),
    institutionId: integer('institution_id').notNull(),
    status: text('status').notNull(),
    minutesLate: integer('minutes_late'),
    note: text('note').notNull().default(''),
    method: text('method').notNull().default('manual'),
    markedBy: integer('marked_by'),
    markedAt: timestamp('marked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.studentId], name: 'attendance_records_pkey' }),
    index('idx_attendance_records_student').on(t.studentId),
    tenant('attendance_records', t as never),
    foreignKey({ columns: [t.sessionId], foreignColumns: [attendanceSessions.id], name: 'attendance_records_session_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'attendance_records_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.markedBy], foreignColumns: [users.id], name: 'attendance_records_marked_by_fkey' }).onDelete('set null'),
    check('attendance_records_status_check', sql`${t.status} IN ('present', 'absent', 'late', 'excused', 'leave')`),
    check('attendance_records_method_check', sql`${t.method} IN ('manual', 'qr', 'leave', 'live', 'import', 'offline')`),
  ]
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id'),
    teacherId: integer('teacher_id'),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    kind: text('kind').notNull().default('personal'),
    reason: text('reason').notNull().default(''),
    status: text('status').notNull().default('pending'),
    requestedBy: integer('requested_by'),
    decidedBy: integer('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    ...created,
  },
  (t) => [
    index('idx_leave_requests_status').on(t.institutionId, t.status),
    tenant('leave_requests', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'leave_requests_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'leave_requests_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.requestedBy], foreignColumns: [users.id], name: 'leave_requests_requested_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.decidedBy], foreignColumns: [users.id], name: 'leave_requests_decided_by_fkey' }).onDelete('set null'),
    check('leave_requests_who_check', sql`(${t.studentId} IS NULL) <> (${t.teacherId} IS NULL)`),
    check('leave_requests_dates_check', sql`${t.toDate} >= ${t.fromDate}`),
    check('leave_requests_kind_check', sql`${t.kind} IN ('sick', 'personal', 'family', 'official', 'other')`),
    check('leave_requests_status_check', sql`${t.status} IN ('pending', 'approved', 'rejected', 'cancelled')`),
  ]
);



export const liveJoins = pgTable(
  'live_joins',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    liveSessionId: integer('live_session_id').notNull(),
    userId: integer('user_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_live_joins_session').on(t.liveSessionId),
    tenant('live_joins', t as never),
    foreignKey({ columns: [t.liveSessionId], foreignColumns: [liveSessions.id], name: 'live_joins_live_session_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'live_joins_user_id_fkey' }).onDelete('cascade'),
  ]
);
