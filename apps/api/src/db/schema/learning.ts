import { date, foreignKey, index, integer, numeric, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { schools } from './core';
import { classes, students, subjects, teachers } from './academics';

export const assignments = pgTable(
  'assignments',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    classId: integer('class_id'),
    subjectId: integer('subject_id'),
    teacherId: integer('teacher_id'),
    title: text('title').notNull(),
    description: text('description').default(''),
    dueDate: date('due_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'assignments_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'assignments_class_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.subjectId], foreignColumns: [subjects.id], name: 'assignments_subject_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'assignments_teacher_id_fkey' }).onDelete('set null'),
  ]
);

export const submissions = pgTable(
  'submissions',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    assignmentId: integer('assignment_id').notNull(),
    studentId: integer('student_id').notNull(),
    title: text('title').default(''),
    fileLink: text('file_link').default(''),
    grade: text('grade').default(''),
    submittedDate: timestamp('submitted_date', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'submissions_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.assignmentId], foreignColumns: [assignments.id], name: 'submissions_assignment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'submissions_student_id_fkey' }).onDelete('cascade'),
  ]
);

export const grades = pgTable(
  'grades',
  {
    id: serial('id').primaryKey(),
    schoolId: integer('school_id').notNull(),
    studentId: integer('student_id').notNull(),
    classId: integer('class_id'),
    subjectId: integer('subject_id'),
    assignmentType: text('assignment_type').notNull(),
    assignmentName: text('assignment_name').notNull(),
    obtainedMarks: numeric('obtained_marks', { precision: 10, scale: 2 }).notNull(),
    totalMarks: numeric('total_marks', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_grades_school').on(t.schoolId),
    foreignKey({ columns: [t.schoolId], foreignColumns: [schools.id], name: 'grades_school_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'grades_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.classId], foreignColumns: [classes.id], name: 'grades_class_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.subjectId], foreignColumns: [subjects.id], name: 'grades_subject_id_fkey' }).onDelete('set null'),
  ]
);
