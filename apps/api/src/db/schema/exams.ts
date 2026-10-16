// The exams office (paper exams: series, papers, seating, invigilation, marks with moderation,
// results publishing, admit cards) and outcome-based education (CLOs, PLOs, mapping,
// alignment of questions / rubric criteria / assessments to CLOs).
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, serial, text, time, timestamp, unique } from 'drizzle-orm/pg-core';
import { institutions, users } from './core';
import { courseOfferings, courses, programs, students, teachers, terms } from './academics';
import { assessments } from './lms';
import { rooms } from './schedule';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

/** An exam series: "Mid-term examinations, October 2026". */
export const examSeries = pgTable(
  'exam_series',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    termId: integer('term_id'),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('final'),
    /** board: school result card with positions; university: transcript with SGPA / CGPA */
    resultStyle: text('result_style').notNull().default('board'),
    status: text('status').notNull().default('planning'),
    /** students below the attendance threshold (or with fees due) don't get admit cards */
    eligibility: jsonb('eligibility').notNull().default(sql`'{"attendance": true, "fees": false}'::jsonb`),
    instructions: text('instructions').notNull().default(''),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: integer('published_by'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('exam_series', t as never),
    foreignKey({ columns: [t.termId], foreignColumns: [terms.id], name: 'exam_series_term_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.publishedBy], foreignColumns: [users.id], name: 'exam_series_published_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'exam_series_created_by_fkey' }).onDelete('set null'),
    check('exam_series_kind_check', sql`${t.kind} IN ('midterm', 'final', 'monthly', 'board', 'supplementary', 'other')`),
    check('exam_series_result_style_check', sql`${t.resultStyle} IN ('board', 'university')`),
    check('exam_series_status_check', sql`${t.status} IN ('planning', 'scheduled', 'in_progress', 'marking', 'published')`),
  ]
);

/** One paper: a course's exam in the series, on a date and time. */
export const examSessions = pgTable(
  'exam_sessions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    seriesId: integer('series_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    /** its column in the gradebook (kind exam), filled when results are published */
    assessmentId: integer('assessment_id'),
    date: date('date').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    totalMarks: numeric('total_marks', { precision: 7, scale: 2 }).notNull().default('100'),
    passMarks: numeric('pass_marks', { precision: 7, scale: 2 }).notNull().default('33'),
    /** marks entry → submitted (teacher) → hod_approved → approved (exam controller) */
    status: text('status').notNull().default('scheduled'),
    marksBy: integer('marks_by'),
    ...created,
  },
  (t) => [
    index('idx_exam_sessions_series').on(t.seriesId),
    tenant('exam_sessions', t as never),
    foreignKey({ columns: [t.seriesId], foreignColumns: [examSeries.id], name: 'exam_sessions_series_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'exam_sessions_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'exam_sessions_assessment_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.marksBy], foreignColumns: [teachers.id], name: 'exam_sessions_marks_by_fkey' }).onDelete('set null'),
    unique('exam_sessions_series_id_offering_id_key').on(t.seriesId, t.offeringId),
    check('exam_sessions_times_check', sql`${t.endsAt} > ${t.startsAt}`),
    check('exam_sessions_marks_check', sql`${t.passMarks} <= ${t.totalMarks}`),
    check('exam_sessions_status_check', sql`${t.status} IN ('scheduled', 'marks_entry', 'submitted', 'hod_approved', 'approved')`),
  ]
);

export const examSeats = pgTable(
  'exam_seats',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    sessionId: integer('session_id').notNull(),
    studentId: integer('student_id').notNull(),
    roomId: integer('room_id').notNull(),
    seatNo: integer('seat_no').notNull(),
  },
  (t) => [
    tenant('exam_seats', t as never),
    foreignKey({ columns: [t.sessionId], foreignColumns: [examSessions.id], name: 'exam_seats_session_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'exam_seats_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.roomId], foreignColumns: [rooms.id], name: 'exam_seats_room_id_fkey' }).onDelete('cascade'),
    unique('exam_seats_session_id_student_id_key').on(t.sessionId, t.studentId),
  ]
);

export const invigilatorDuties = pgTable(
  'invigilator_duties',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    sessionId: integer('session_id').notNull(),
    roomId: integer('room_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    role: text('role').notNull().default('invigilator'),
  },
  (t) => [
    tenant('invigilator_duties', t as never),
    foreignKey({ columns: [t.sessionId], foreignColumns: [examSessions.id], name: 'invigilator_duties_session_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.roomId], foreignColumns: [rooms.id], name: 'invigilator_duties_room_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'invigilator_duties_teacher_id_fkey' }).onDelete('cascade'),
    unique('invigilator_duties_session_id_teacher_id_key').on(t.sessionId, t.teacherId),
    check('invigilator_duties_role_check', sql`${t.role} IN ('chief', 'invigilator')`),
  ]
);

export const examMarks = pgTable(
  'exam_marks',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    sessionId: integer('session_id').notNull(),
    studentId: integer('student_id').notNull(),
    marks: numeric('marks', { precision: 7, scale: 2 }),
    absent: boolean('absent').notNull().default(false),
    /** grace or moderation added on top of the marks */
    adjustment: numeric('adjustment', { precision: 7, scale: 2 }).notNull().default('0'),
    remarks: text('remarks').notNull().default(''),
    enteredBy: integer('entered_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('exam_marks', t as never),
    foreignKey({ columns: [t.sessionId], foreignColumns: [examSessions.id], name: 'exam_marks_session_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'exam_marks_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.enteredBy], foreignColumns: [users.id], name: 'exam_marks_entered_by_fkey' }).onDelete('set null'),
    unique('exam_marks_session_id_student_id_key').on(t.sessionId, t.studentId),
    check('exam_marks_marks_check', sql`${t.marks} IS NULL OR ${t.marks} >= 0`),
  ]
);

/** Every step of the marks workflow: submit, approve, return, moderate. */
export const examModerations = pgTable(
  'exam_moderations',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    sessionId: integer('session_id').notNull(),
    action: text('action').notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    /** a moderation applied to everyone: { add: n } or { scale_to: max } */
    change: jsonb('change'),
    note: text('note').notNull().default(''),
    userId: integer('user_id'),
    ...created,
  },
  (t) => [
    index('idx_exam_moderations_session').on(t.sessionId),
    tenant('exam_moderations', t as never),
    foreignKey({ columns: [t.sessionId], foreignColumns: [examSessions.id], name: 'exam_moderations_session_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'exam_moderations_user_id_fkey' }).onDelete('set null'),
    check('exam_moderations_action_check', sql`${t.action} IN ('open', 'submit', 'approve', 'return', 'moderate')`),
  ]
);

export const admitCards = pgTable(
  'admit_cards',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    seriesId: integer('series_id').notNull(),
    studentId: integer('student_id').notNull(),
    verifyCode: text('verify_code').notNull(),
    eligible: boolean('eligible').notNull(),
    blockedReason: text('blocked_reason'),
    /** the office may let a blocked student sit anyway */
    overriddenBy: integer('overridden_by'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('admit_cards', t as never),
    foreignKey({ columns: [t.seriesId], foreignColumns: [examSeries.id], name: 'admit_cards_series_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'admit_cards_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.overriddenBy], foreignColumns: [users.id], name: 'admit_cards_overridden_by_fkey' }).onDelete('set null'),
    unique('admit_cards_series_id_student_id_key').on(t.seriesId, t.studentId),
    unique('admit_cards_verify_code_key').on(t.verifyCode),
  ]
);

// ---------------------------------------------------------------- outcome-based education

/** A program outcome (PLO) or course outcome (CLO). */
export const learningOutcomes = pgTable(
  'learning_outcomes',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    level: text('level').notNull(),
    programId: integer('program_id'),
    courseId: integer('course_id'),
    code: text('code').notNull(),
    description: text('description').notNull(),
    bloomLevel: text('bloom_level'),
    /** a student attains it at this percent; the course target is the share of students who should */
    passPercent: numeric('pass_percent', { precision: 5, scale: 2 }).notNull().default('50'),
    targetPercent: numeric('target_percent', { precision: 5, scale: 2 }).notNull().default('70'),
    position: integer('position').notNull().default(0),
    ...created,
  },
  (t) => [
    tenant('learning_outcomes', t as never),
    foreignKey({ columns: [t.programId], foreignColumns: [programs.id], name: 'learning_outcomes_program_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.courseId], foreignColumns: [courses.id], name: 'learning_outcomes_course_id_fkey' }).onDelete('cascade'),
    check('learning_outcomes_level_check', sql`${t.level} IN ('program', 'course')`),
    check('learning_outcomes_owner_check', sql`(${t.level} = 'program' AND ${t.programId} IS NOT NULL AND ${t.courseId} IS NULL) OR (${t.level} = 'course' AND ${t.courseId} IS NOT NULL AND ${t.programId} IS NULL)`),
    check('learning_outcomes_bloom_check', sql`${t.bloomLevel} IS NULL OR ${t.bloomLevel} IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')`),
    unique('learning_outcomes_program_id_course_id_code_key').on(t.programId, t.courseId, t.code).nullsNotDistinct(),
  ]
);

/** CLO → PLO with a correlation strength (1 low, 2 medium, 3 high). */
export const outcomeMappings = pgTable(
  'outcome_mappings',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    cloId: integer('clo_id').notNull(),
    ploId: integer('plo_id').notNull(),
    strength: integer('strength').notNull().default(2),
  },
  (t) => [
    tenant('outcome_mappings', t as never),
    foreignKey({ columns: [t.cloId], foreignColumns: [learningOutcomes.id], name: 'outcome_mappings_clo_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.ploId], foreignColumns: [learningOutcomes.id], name: 'outcome_mappings_plo_id_fkey' }).onDelete('cascade'),
    unique('outcome_mappings_clo_id_plo_id_key').on(t.cloId, t.ploId),
    check('outcome_mappings_strength_check', sql`${t.strength} BETWEEN 1 AND 3`),
  ]
);

/** What measures a CLO: a question, a rubric criterion, a whole assessment or a paper exam. */
export const outcomeAlignments = pgTable(
  'outcome_alignments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    cloId: integer('clo_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: integer('target_id').notNull(),
    /** share of the target's marks that count for this CLO (1 = all) */
    weight: numeric('weight', { precision: 4, scale: 2 }).notNull().default('1'),
  },
  (t) => [
    index('idx_outcome_alignments_target').on(t.targetType, t.targetId),
    tenant('outcome_alignments', t as never),
    foreignKey({ columns: [t.cloId], foreignColumns: [learningOutcomes.id], name: 'outcome_alignments_clo_id_fkey' }).onDelete('cascade'),
    unique('outcome_alignments_clo_id_target_type_target_id_key').on(t.cloId, t.targetType, t.targetId),
    check('outcome_alignments_target_type_check', sql`${t.targetType} IN ('question', 'criterion', 'assessment', 'exam_session')`),
    check('outcome_alignments_weight_check', sql`${t.weight} > 0 AND ${t.weight} <= 1`),
  ]
);
