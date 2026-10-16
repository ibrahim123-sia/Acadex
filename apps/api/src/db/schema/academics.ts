// Academic structure and people.
//
//   institution ─┬─ campuses ── departments ── programs ── program_levels
//                ├─ academic_years ── terms            (holidays on the calendar)
//                ├─ sections   a teaching group: a class, a batch, a cohort (one level, one year)
//                ├─ courses    the catalog
//                └─ course_offerings  a course taught in a term, to a section (school) or open
//                                     for enrolment with capacity and a waitlist (university)
//
// Soft-deletable tables carry deleted_at / deleted_by; a restrictive RLS policy hides deleted
// rows from every query (see drizzle/0008_*.sql).
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
  uniqueIndex,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { files, institutions, users } from './core';

const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: integer('deleted_by'),
};

export const campuses = pgTable(
  'campuses',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    address: text('address').notNull().default(''),
    phone: text('phone').notNull().default(''),
    isMain: boolean('is_main').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    ...softDelete,
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'campuses_institution_id_fkey' }).onDelete('cascade'),
    unique('campuses_institution_id_code_key').on(t.institutionId, t.code),
  ]
);

export const gradingSchemes = pgTable(
  'grading_schemes',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    /** [{ min: percent, label, points?, passed }] sorted by min descending */
    bands: jsonb('bands').notNull().default(sql`'[]'::jsonb`),
    gpaScale: numeric('gpa_scale', { precision: 3, scale: 1 }),
    passPercent: numeric('pass_percent', { precision: 5, scale: 2 }).notNull().default('50'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'grading_schemes_institution_id_fkey' }).onDelete('cascade'),
    unique('grading_schemes_institution_id_name_key').on(t.institutionId, t.name),
    uniqueIndex('grading_schemes_one_default').on(t.institutionId).where(sql`is_default`),
    check(
      'grading_schemes_kind_check',
      sql`${t.kind} IN ('percentage', 'letter', 'gpa', 'pass_fail', 'competency', 'custom')`
    ),
  ]
);

export const departments = pgTable(
  'departments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    campusId: integer('campus_id'),
    name: text('name').notNull(),
    code: text('code').notNull(),
    headTeacherId: integer('head_teacher_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    ...softDelete,
  },
  (t): PgTableExtraConfigValue[] => [ // annotated: departments ↔ teachers reference each other
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'departments_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'departments_campus_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.headTeacherId], foreignColumns: [teachers.id], name: 'departments_head_teacher_id_fkey' }).onDelete('set null'),
    unique('departments_institution_id_code_key').on(t.institutionId, t.code),
  ]
);

export const programs = pgTable(
  'programs',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    departmentId: integer('department_id'),
    name: text('name').notNull(),
    code: text('code').notNull(),
    description: text('description').notNull().default(''),
    /** overrides the institution's default grading scheme */
    gradingSchemeId: integer('grading_scheme_id'),
    creditsRequired: numeric('credits_required', { precision: 5, scale: 1 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    ...softDelete,
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'programs_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id], name: 'programs_department_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.gradingSchemeId], foreignColumns: [gradingSchemes.id], name: 'programs_grading_scheme_id_fkey' }).onDelete('set null'),
    unique('programs_institution_id_code_key').on(t.institutionId, t.code),
  ]
);

export const programLevels = pgTable(
  'program_levels',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    programId: integer('program_id').notNull(),
    name: text('name').notNull(),
    sequence: integer('sequence').notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'program_levels_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.programId], foreignColumns: [programs.id], name: 'program_levels_program_id_fkey' }).onDelete('cascade'),
    unique('program_levels_program_id_sequence_key').on(t.programId, t.sequence),
  ]
);

export const academicYears = pgTable(
  'academic_years',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    /** archived years (and their terms and sections) are read-only */
    status: text('status').notNull().default('active'),
    isCurrent: boolean('is_current').notNull().default(false),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'academic_years_institution_id_fkey' }).onDelete('cascade'),
    unique('academic_years_institution_id_name_key').on(t.institutionId, t.name),
    uniqueIndex('academic_years_one_current').on(t.institutionId).where(sql`is_current`),
    check('academic_years_status_check', sql`${t.status} IN ('planned', 'active', 'archived')`),
    check('academic_years_dates_check', sql`${t.endsOn} > ${t.startsOn}`),
  ]
);

export const terms = pgTable(
  'terms',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    academicYearId: integer('academic_year_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('annual'),
    sequence: integer('sequence').notNull().default(1),
    startsOn: date('starts_on').notNull(),
    /** NULL for rolling / self-paced terms */
    endsOn: date('ends_on'),
    status: text('status').notNull().default('active'),
  },
  (t) => [
    index('idx_terms_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'terms_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.academicYearId], foreignColumns: [academicYears.id], name: 'terms_academic_year_id_fkey' }).onDelete('cascade'),
    unique('terms_academic_year_id_name_key').on(t.academicYearId, t.name),
    check('terms_kind_check', sql`${t.kind} IN ('annual', 'semester', 'trimester', 'quarter', 'rolling', 'custom')`),
    check('terms_status_check', sql`${t.status} IN ('planned', 'active', 'archived')`),
    check('terms_dates_check', sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
  ]
);

export const holidays = pgTable(
  'holidays',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** NULL = every campus */
    campusId: integer('campus_id'),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    kind: text('kind').notNull().default('holiday'),
  },
  (t) => [
    index('idx_holidays_institution_dates').on(t.institutionId, t.startsOn),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'holidays_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'holidays_campus_id_fkey' }).onDelete('cascade'),
    check('holidays_kind_check', sql`${t.kind} IN ('holiday', 'break', 'exam_period', 'event')`),
    check('holidays_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
  ]
);

export const sections = pgTable(
  'sections',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    label: text('label').default('A'),
    campusId: integer('campus_id'),
    programLevelId: integer('program_level_id'),
    academicYearId: integer('academic_year_id'),
    capacity: integer('capacity'),
    homeroomTeacherId: integer('homeroom_teacher_id'),
    status: text('status').notNull().default('active'),
    ...softDelete,
  },
  (t) => [
    index('idx_sections_campus').on(t.campusId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'sections_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'sections_campus_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.programLevelId], foreignColumns: [programLevels.id], name: 'sections_program_level_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.academicYearId], foreignColumns: [academicYears.id], name: 'sections_academic_year_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.homeroomTeacherId], foreignColumns: [teachers.id], name: 'sections_homeroom_teacher_id_fkey' }).onDelete('set null'),
    unique('sections_institution_id_code_key').on(t.institutionId, t.code),
    check('sections_status_check', sql`${t.status} IN ('active', 'archived')`),
    check('sections_capacity_check', sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
  ]
);

export const courses = pgTable(
  'courses',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    departmentId: integer('department_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    creditHours: numeric('credit_hours', { precision: 4, scale: 1 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    ...softDelete,
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'courses_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id], name: 'courses_department_id_fkey' }).onDelete('set null'),
    unique('courses_institution_id_code_key').on(t.institutionId, t.code),
  ]
);

export const courseOfferings = pgTable(
  'course_offerings',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    sectionId: integer('section_id'),
    courseId: integer('course_id').notNull(),
    termId: integer('term_id'),
    /** 'section': everyone in the section takes it; 'open': students enrol individually */
    enrollmentMode: text('enrollment_mode').notNull().default('section'),
    capacity: integer('capacity'),
    waitlistEnabled: boolean('waitlist_enabled').notNull().default(true),
    /** after results are published the gradebook can't change */
    /** AI features in this course (the institution's settings still apply) */
    aiEnabled: boolean('ai_enabled').notNull().default(true),
    gradebookLockedAt: timestamp('gradebook_locked_at', { withTimezone: true }),
    /** how many timetable periods a week this course needs (timetable generator) */
    periodsPerWeek: integer('periods_per_week').notNull().default(0),
  },
  (t) => [
    index('idx_course_offerings_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'course_offerings_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'course_offerings_section_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.courseId], foreignColumns: [courses.id], name: 'course_offerings_course_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.termId], foreignColumns: [terms.id], name: 'course_offerings_term_id_fkey' }).onDelete('set null'),
    check('course_offerings_enrollment_mode_check', sql`${t.enrollmentMode} IN ('section', 'open')`),
    check('course_offerings_capacity_check', sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
  ]
);

export const teachers = pgTable(
  'teachers',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
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
    employeeNo: text('employee_no'),
    designation: text('designation').notNull().default(''),
    staffType: text('staff_type').notNull().default('teaching'),
    employmentType: text('employment_type').notNull().default('full_time'),
    campusId: integer('campus_id'),
    departmentId: integer('department_id'),
    joiningDate: date('joining_date'),
    address: text('address').notNull().default(''),
    emergencyContactName: text('emergency_contact_name').notNull().default(''),
    emergencyContactPhone: text('emergency_contact_phone').notNull().default(''),
    photoFileId: integer('photo_file_id'),
    customData: jsonb('custom_data').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('active'),
    ...softDelete,
  },
  (t) => [
    index('idx_teachers_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'teachers_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'teachers_campus_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id], name: 'teachers_department_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.photoFileId], foreignColumns: [files.id], name: 'teachers_photo_file_id_fkey' }).onDelete('set null'),
    unique('teachers_institution_id_email_key').on(t.institutionId, t.email),
    unique('teachers_institution_id_employee_no_key').on(t.institutionId, t.employeeNo),
    check('teachers_staff_type_check', sql`${t.staffType} IN ('teaching', 'non_teaching')`),
    check('teachers_employment_type_check', sql`${t.employmentType} IN ('full_time', 'part_time', 'visiting', 'contract')`),
    check('teachers_status_check', sql`${t.status} IN ('active', 'on_leave', 'left')`),
  ]
);

export const students = pgTable(
  'students',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    rollNo: text('roll_no'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    age: integer('age'),
    gender: text('gender'),
    email: text('email').notNull(),
    phone: text('phone'),
    dob: date('dob'),
    /** the student's home section (class / batch); course enrolments are in enrollments */
    sectionId: integer('section_id'),
    city: text('city').default(''),
    photoUrl: text('photo_url').default(''),
    admissionDate: date('admission_date').default(sql`CURRENT_DATE`),
    status: text('status').default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    nationalId: text('national_id').notNull().default(''),
    nationality: text('nationality').notNull().default(''),
    religion: text('religion').notNull().default(''),
    address: text('address').notNull().default(''),
    photoFileId: integer('photo_file_id'),
    customData: jsonb('custom_data').notNull().default(sql`'{}'::jsonb`),
    leftOn: date('left_on'),
    ...softDelete,
  },
  (t) => [
    index('idx_students_institution').on(t.institutionId),
    index('idx_students_section').on(t.sectionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'students_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'students_section_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.photoFileId], foreignColumns: [files.id], name: 'students_photo_file_id_fkey' }).onDelete('set null'),
    unique('students_institution_id_email_key').on(t.institutionId, t.email),
    check('students_status_check', sql`${t.status} IN ('active', 'inactive', 'graduated', 'left')`),
  ]
);

export const sectionStaff = pgTable(
  'section_staff',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    sectionId: integer('section_id'),
    role: text('role').notNull().default('teacher'),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'section_staff_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'section_staff_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'section_staff_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: 'section_staff_section_id_fkey' }).onDelete('cascade'),
    check('section_staff_role_check', sql`${t.role} IN ('teacher', 'co_teacher', 'ta')`),
  ]
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    studentId: integer('student_id').notNull(),
    status: text('status').notNull().default('active'),
    /** position in the queue while status = 'waitlisted' */
    waitlistPosition: integer('waitlist_position'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_enrollments_student').on(t.studentId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'enrollments_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'enrollments_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'enrollments_student_id_fkey' }).onDelete('cascade'),
    unique('enrollments_offering_id_student_id_key').on(t.offeringId, t.studentId),
    check('enrollments_status_check', sql`${t.status} IN ('active', 'waitlisted', 'dropped', 'completed')`),
  ]
);

/** History of year-end moves (promoted, repeated, graduated, left). */
export const studentPromotions = pgTable(
  'student_promotions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    fromSectionId: integer('from_section_id'),
    toSectionId: integer('to_section_id'),
    action: text('action').notNull(),
    createdBy: integer('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_student_promotions_student').on(t.studentId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'student_promotions_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'student_promotions_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.fromSectionId], foreignColumns: [sections.id], name: 'student_promotions_from_section_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.toSectionId], foreignColumns: [sections.id], name: 'student_promotions_to_section_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'student_promotions_created_by_fkey' }).onDelete('set null'),
    check('student_promotions_action_check', sql`${t.action} IN ('promoted', 'repeated', 'graduated', 'left')`),
  ]
);




