import { date, foreignKey, index, integer, numeric, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { institutions } from './core';
import { sections, students, courseOfferings, teachers } from './academics';

export const assignments = pgTable(
  'assignments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    sectionId: integer('section_id'),
    offeringId: integer('offering_id'),
    teacherId: integer('teacher_id'),
    title: text('title').notNull(),
    description: text('description').default(''),
    dueDate: date('due_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'assignments_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'assignments_section_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'assignments_offering_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'assignments_teacher_id_fkey' }).onDelete('set null'),
  ]
);

export const submissions = pgTable(
  'submissions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assignmentId: integer('assignment_id').notNull(),
    studentId: integer('student_id').notNull(),
    title: text('title').default(''),
    fileLink: text('file_link').default(''),
    grade: text('grade').default(''),
    submittedDate: timestamp('submitted_date', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'submissions_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.assignmentId], foreignColumns: [assignments.id], name: 'submissions_assignment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'submissions_student_id_fkey' }).onDelete('cascade'),
  ]
);

export const grades = pgTable(
  'grades',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    sectionId: integer('section_id'),
    offeringId: integer('offering_id'),
    assignmentType: text('assignment_type').notNull(),
    assignmentName: text('assignment_name').notNull(),
    obtainedMarks: numeric('obtained_marks', { precision: 10, scale: 2 }).notNull(),
    totalMarks: numeric('total_marks', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_grades_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'grades_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'grades_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'grades_section_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'grades_offering_id_fkey' }).onDelete('set null'),
  ]
);
