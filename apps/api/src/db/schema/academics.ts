import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { schools } from './core';

export const classes = pgTable(
  'classes',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    section: text('section').default('A'),
  },
  (t) => [
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'classes_school_id_fkey' }).onDelete('cascade'),
    unique('classes_school_id_code_key').on(t.schoolId, t.code),
  ]
);

export const subjects = pgTable(
  'subjects',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    classId: integer('class_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    index('idx_subjects_school').on(t.schoolId),
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'subjects_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'subjects_class_id_fkey' }).onDelete('cascade'),
  ]
);

export const teachers = pgTable(
  'teachers',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    gender: text('gender'),
    dob: date('dob'),
    email: text('email').notNull(),
    phone: text('phone'),
    cnic: text('cnic'),
    qualification: text('qualification').default(''),
    photoUrl: text('photo_url').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_teachers_school').on(t.schoolId),
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'teachers_school_id_fkey' }).onDelete('cascade'),
    unique('teachers_school_id_email_key').on(t.schoolId, t.email),
  ]
);

export const students = pgTable(
  'students',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    rollNo: text('roll_no'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    age: integer('age'),
    gender: text('gender'),
    email: text('email').notNull(),
    phone: text('phone'),
    dob: date('dob'),
    classId: integer('class_id'),
    guardianName: text('guardian_name').default(''),
    guardianPhone: text('guardian_phone').default(''),
    city: text('city').default(''),
    photoUrl: text('photo_url').default(''),
    admissionDate: date('admission_date').default(sql`CURRENT_DATE`),
    status: text('status').default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_students_school').on(t.schoolId),
    index('idx_students_class').on(t.classId),
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'students_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'students_class_id_fkey' }).onDelete('set null'),
    unique('students_school_id_email_key').on(t.schoolId, t.email),
    check('students_status_check', sql`${t.status} = ANY (ARRAY['active'::text, 'inactive'::text])`),
  ]
);

export const teacherSubjects = pgTable(
  'teacher_subjects',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    subjectId: integer('subject_id').notNull(),
    classId: integer('class_id'),
  },
  (t) => [
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'teacher_subjects_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'teacher_subjects_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.subjectId], foreignColumns: [subjects.id], name: 'teacher_subjects_subject_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'teacher_subjects_class_id_fkey' }).onDelete('cascade'),
  ]
);

export const timetable = pgTable(
  'timetable',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    classId: integer('class_id').notNull(),
    dayOfWeek: text('day_of_week').notNull(),
    timeSlot: text('time_slot').notNull(),
    subject: text('subject').notNull(),
    teacherId: integer('teacher_id'),
  },
  (t) => [
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'timetable_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'timetable_class_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'timetable_teacher_id_fkey' }).onDelete('set null'),
  ]
);

export const examSchedule = pgTable(
  'exam_schedule',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    classId: integer('class_id'),
    examName: text('exam_name').notNull(),
    subject: text('subject').notNull(),
    examDate: date('exam_date').notNull(),
    timeSlot: text('time_slot').default(''),
    totalMarks: integer('total_marks').default(100),
  },
  (t) => [
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'exam_schedule_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'exam_schedule_class_id_fkey' }).onDelete('cascade'),
  ]
);
