// The LMS: course space (modules, content, progress, blueprints), assessments (assignments,
// quizzes, projects…) with submissions, groups, peer review, extensions and rubrics, the
// question bank and quiz attempts, and the gradebook.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { files, institutions, users } from './core';
import { courseOfferings, courses, students } from './academics';

const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: integer('deleted_by'),
};
const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

// ---------------------------------------------------------------- course space

/** A course built once and copied to many sections or campuses. */
export const courseBlueprints = pgTable(
  'course_blueprints',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    courseId: integer('course_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    createdBy: integer('created_by'),
    ...created,
    ...softDelete,
  },
  (t) => [
    tenant('course_blueprints', t as never),
    foreignKey({ columns: [t.courseId], foreignColumns: [courses.id], name: 'course_blueprints_course_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'course_blueprints_created_by_fkey' }).onDelete('set null'),
  ]
);

export const modules = pgTable(
  'modules',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** exactly one of offering (a live course) or blueprint (a template) */
    offeringId: integer('offering_id'),
    blueprintId: integer('blueprint_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),
    published: boolean('published').notNull().default(false),
    /** drip release */
    unlockAt: timestamp('unlock_at', { withTimezone: true }),
    prerequisiteModuleId: integer('prerequisite_module_id'),
    /** with a prerequisite: the score (percent) needed on its graded items */
    masteryPercent: numeric('mastery_percent', { precision: 5, scale: 2 }),
    /** the blueprint module this was copied from (updates can be pushed) */
    sourceModuleId: integer('source_module_id'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    index('idx_modules_offering').on(t.offeringId, t.position),
    index('idx_modules_blueprint').on(t.blueprintId, t.position),
    tenant('modules', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'modules_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.blueprintId], foreignColumns: [courseBlueprints.id], name: 'modules_blueprint_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.prerequisiteModuleId], foreignColumns: [t.id], name: 'modules_prerequisite_module_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.sourceModuleId], foreignColumns: [t.id], name: 'modules_source_module_id_fkey' }).onDelete('set null'),
    check('modules_owner_check', sql`(${t.offeringId} IS NULL) <> (${t.blueprintId} IS NULL)`),
  ]
);

export const contentItems = pgTable(
  'content_items',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    moduleId: integer('module_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** rich pages: sanitised HTML for display, the editor's JSON for editing */
    bodyHtml: text('body_html').notNull().default(''),
    bodyJson: jsonb('body_json'),
    url: text('url').notNull().default(''),
    fileId: integer('file_id'),
    videoProvider: text('video_provider'),
    videoRef: text('video_ref'),
    assessmentId: integer('assessment_id'),
    scormPackageId: integer('scorm_package_id'),
    liveSessionId: integer('live_session_id'),
    position: integer('position').notNull().default(0),
    published: boolean('published').notNull().default(true),
    unlockAt: timestamp('unlock_at', { withTimezone: true }),
    /** when the item counts as done: viewed, marked done, submitted, or passed */
    completion: text('completion').notNull().default('view'),
    durationMinutes: integer('duration_minutes'),
    sourceItemId: integer('source_item_id'),
    /** edited after copying from a blueprint: blueprint updates leave it alone */
    locallyModified: boolean('locally_modified').notNull().default(false),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...softDelete,
  },
  (t): PgTableExtraConfigValue[] => [
    index('idx_content_items_module').on(t.moduleId, t.position),
    tenant('content_items', t as never),
    foreignKey({ columns: [t.moduleId], foreignColumns: [modules.id], name: 'content_items_module_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.fileId], foreignColumns: [files.id], name: 'content_items_file_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'content_items_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.sourceItemId], foreignColumns: [t.id], name: 'content_items_source_item_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.scormPackageId], foreignColumns: [scormPackages.id], name: 'content_items_scorm_package_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.liveSessionId], foreignColumns: [liveSessions.id], name: 'content_items_live_session_id_fkey' }).onDelete('cascade'),
    check('content_items_kind_check', sql`${t.kind} IN ('page', 'file', 'link', 'video', 'embed', 'assessment', 'live', 'scorm')`),
    check('content_items_completion_check', sql`${t.completion} IN ('view', 'mark_done', 'submit', 'pass')`),
  ]
);

export const contentProgress = pgTable(
  'content_progress',
  {
    studentId: integer('student_id').notNull(),
    itemId: integer('item_id').notNull(),
    institutionId: integer('institution_id').notNull(),
    status: text('status').notNull().default('started'),
    percent: integer('percent').notNull().default(0),
    /** where to resume (video seconds, scroll position, SCORM location) */
    resume: jsonb('resume'),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.itemId], name: 'content_progress_pkey' }),
    index('idx_content_progress_item').on(t.itemId),
    tenant('content_progress', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'content_progress_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.itemId], foreignColumns: [contentItems.id], name: 'content_progress_item_id_fkey' }).onDelete('cascade'),
    check('content_progress_status_check', sql`${t.status} IN ('started', 'done')`),
  ]
);

// ---------------------------------------------------------------- live classes & packages
export const liveSessions = pgTable(
  'live_sessions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    title: text('title').notNull(),
    provider: text('provider').notNull(),
    joinUrl: text('join_url').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(45),
    recordingUrl: text('recording_url').notNull().default(''),
    /** attendance taken from the joins (Acadex records each join through its link) */
    autoAttendance: boolean('auto_attendance').notNull().default(true),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    index('idx_live_sessions_offering').on(t.offeringId, t.startsAt),
    tenant('live_sessions', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'live_sessions_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'live_sessions_created_by_fkey' }).onDelete('set null'),
    check('live_sessions_provider_check', sql`${t.provider} IN ('jitsi', 'zoom', 'meet', 'teams', 'other')`),
  ]
);

export const scormPackages = pgTable(
  'scorm_packages',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    title: text('title').notNull(),
    version: text('version').notNull(),
    /** entry file inside the package and where its files are stored */
    launchPath: text('launch_path').notNull(),
    storagePrefix: text('storage_prefix').notNull(),
    fileId: integer('file_id'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('scorm_packages', t as never),
    foreignKey({ columns: [t.fileId], foreignColumns: [files.id], name: 'scorm_packages_file_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'scorm_packages_created_by_fkey' }).onDelete('set null'),
    check('scorm_packages_version_check', sql`${t.version} IN ('1.2', '2004')`),
  ]
);

// ---------------------------------------------------------------- assessments

export const gradeCategories = pgTable(
  'grade_categories',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    name: text('name').notNull(),
    /** share of the final grade, in percent (weights need not add to 100: they are normalised) */
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull().default('0'),
    dropLowest: integer('drop_lowest').notNull().default(0),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    tenant('grade_categories', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'grade_categories_offering_id_fkey' }).onDelete('cascade'),
    unique('grade_categories_offering_id_name_key').on(t.offeringId, t.name),
  ]
);

export const rubrics = pgTable(
  'rubrics',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** NULL = the institution's shared library */
    offeringId: integer('offering_id'),
    title: text('title').notNull(),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('rubrics', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'rubrics_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'rubrics_created_by_fkey' }).onDelete('set null'),
  ]
);

export const rubricCriteria = pgTable(
  'rubric_criteria',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    rubricId: integer('rubric_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),
    /** [{ points, label, description }] from best to worst */
    levels: jsonb('levels').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    tenant('rubric_criteria', t as never),
    foreignKey({ columns: [t.rubricId], foreignColumns: [rubrics.id], name: 'rubric_criteria_rubric_id_fkey' }).onDelete('cascade'),
  ]
);

export const groupSets = pgTable(
  'group_sets',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    name: text('name').notNull(),
    selfSignup: boolean('self_signup').notNull().default(false),
    maxSize: integer('max_size'),
  },
  (t) => [
    tenant('group_sets', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'group_sets_offering_id_fkey' }).onDelete('cascade'),
  ]
);

export const studentGroups = pgTable(
  'student_groups',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    groupSetId: integer('group_set_id').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    tenant('student_groups', t as never),
    foreignKey({ columns: [t.groupSetId], foreignColumns: [groupSets.id], name: 'student_groups_group_set_id_fkey' }).onDelete('cascade'),
  ]
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: integer('group_id').notNull(),
    studentId: integer('student_id').notNull(),
    groupSetId: integer('group_set_id').notNull(),
    institutionId: integer('institution_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.studentId], name: 'group_members_pkey' }),
    tenant('group_members', t as never),
    foreignKey({ columns: [t.groupId], foreignColumns: [studentGroups.id], name: 'group_members_group_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'group_members_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.groupSetId], foreignColumns: [groupSets.id], name: 'group_members_group_set_id_fkey' }).onDelete('cascade'),
    // one group per set for each student
    unique('group_members_group_set_id_student_id_key').on(t.groupSetId, t.studentId),
  ]
);

export const assessments = pgTable(
  'assessments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    categoryId: integer('category_id'),
    kind: text('kind').notNull().default('assignment'),
    title: text('title').notNull(),
    instructionsHtml: text('instructions_html').notNull().default(''),
    points: numeric('points', { precision: 7, scale: 2 }).notNull().default('100'),
    availableFrom: timestamp('available_from', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    availableUntil: timestamp('available_until', { withTimezone: true }),
    status: text('status').notNull().default('draft'),
    /** assignments: what students may hand in */
    submissionTypes: text('submission_types').array().notNull().default(sql`ARRAY['text','file']::text[]`),
    /** submissions allowed (resubmission); NULL = unlimited */
    allowedAttempts: integer('allowed_attempts').default(1),
    /** { mode: allow | penalty | block, penalty_percent_per_day, max_penalty_percent } */
    latePolicy: jsonb('late_policy').notNull().default(sql`'{"mode":"allow"}'::jsonb`),
    groupSetId: integer('group_set_id'),
    /** { reviews_per_student, due_at, anonymous } when peer review is on */
    peerReview: jsonb('peer_review'),
    rubricId: integer('rubric_id'),
    /** what AI help is allowed (enforced by the AI tutor in Phase 4) */
    aiPolicy: text('ai_policy').notNull().default('allowed'),
    /** quizzes: { time_limit_minutes, shuffle_questions, shuffle_options, one_at_a_time, show_results } */
    quiz: jsonb('quiz'),
    /** secure exam mode: { access_code_hash, ip_allowlist: [cidr], require_fullscreen, block_copy_paste, proctoring: null } */
    secure: jsonb('secure'),
    /** grades become visible to students when released (manually or as each is graded) */
    releaseMode: text('release_mode').notNull().default('manual'),
    gradesReleasedAt: timestamp('grades_released_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    createdBy: integer('created_by'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...softDelete,
  },
  (t): PgTableExtraConfigValue[] => [
    index('idx_assessments_offering').on(t.offeringId),
    tenant('assessments', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'assessments_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.categoryId], foreignColumns: [gradeCategories.id], name: 'assessments_category_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.groupSetId], foreignColumns: [groupSets.id], name: 'assessments_group_set_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.rubricId], foreignColumns: [rubrics.id], name: 'assessments_rubric_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'assessments_created_by_fkey' }).onDelete('set null'),
    check('assessments_kind_check', sql`${t.kind} IN ('assignment', 'quiz', 'exam', 'project', 'participation')`),
    check('assessments_status_check', sql`${t.status} IN ('draft', 'published', 'closed')`),
    check('assessments_ai_policy_check', sql`${t.aiPolicy} IN ('allowed', 'limited', 'not_allowed')`),
    check('assessments_release_mode_check', sql`${t.releaseMode} IN ('manual', 'on_grading')`),
    check('assessments_points_check', sql`${t.points} >= 0`),
  ]
);

/** Per-student (or per-group) extensions: a later due date, more attempts, more time. */
export const assessmentExtensions = pgTable(
  'assessment_extensions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assessmentId: integer('assessment_id').notNull(),
    studentId: integer('student_id'),
    groupId: integer('group_id'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    availableUntil: timestamp('available_until', { withTimezone: true }),
    extraAttempts: integer('extra_attempts').notNull().default(0),
    extraTimePercent: integer('extra_time_percent').notNull().default(0),
    reason: text('reason').notNull().default(''),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('assessment_extensions', t as never),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'assessment_extensions_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'assessment_extensions_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.groupId], foreignColumns: [studentGroups.id], name: 'assessment_extensions_group_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'assessment_extensions_created_by_fkey' }).onDelete('set null'),
    unique('assessment_extensions_assessment_id_student_id_group_id_key').on(t.assessmentId, t.studentId, t.groupId).nullsNotDistinct(),
    check('assessment_extensions_target_check', sql`(${t.studentId} IS NULL) <> (${t.groupId} IS NULL)`),
  ]
);

/** Standing accommodations (e.g. 25% extra time on every timed quiz). */
export const accommodations = pgTable(
  'accommodations',
  {
    studentId: integer('student_id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    extraTimePercent: integer('extra_time_percent').notNull().default(0),
    notes: text('notes').notNull().default(''),
    updatedBy: integer('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('accommodations', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'accommodations_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.updatedBy], foreignColumns: [users.id], name: 'accommodations_updated_by_fkey' }).onDelete('set null'),
    check('accommodations_extra_time_check', sql`${t.extraTimePercent} BETWEEN 0 AND 300`),
  ]
);

export const submissions = pgTable(
  'submissions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assessmentId: integer('assessment_id').notNull(),
    /** a student's own submission, or a group's */
    studentId: integer('student_id'),
    groupId: integer('group_id'),
    attempt: integer('attempt').notNull().default(1),
    status: text('status').notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    late: boolean('late').notNull().default(false),
    minutesLate: integer('minutes_late').notNull().default(0),
    submittedBy: integer('submitted_by'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_submissions_assessment').on(t.assessmentId),
    tenant('submissions', t as never),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'submissions_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'submissions_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.groupId], foreignColumns: [studentGroups.id], name: 'submissions_group_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.submittedBy], foreignColumns: [users.id], name: 'submissions_submitted_by_fkey' }).onDelete('set null'),
    unique('submissions_assessment_id_student_id_group_id_attempt_key').on(t.assessmentId, t.studentId, t.groupId, t.attempt).nullsNotDistinct(),
    check('submissions_owner_check', sql`(${t.studentId} IS NULL) <> (${t.groupId} IS NULL)`),
    check('submissions_status_check', sql`${t.status} IN ('draft', 'submitted', 'returned')`),
  ]
);

/** Every save of a submission is kept (draft history is learning-process evidence). */
export const submissionVersions = pgTable(
  'submission_versions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    submissionId: integer('submission_id').notNull(),
    version: integer('version').notNull(),
    textHtml: text('text_html').notNull().default(''),
    linkUrl: text('link_url').notNull().default(''),
    fileIds: integer('file_ids').array().notNull().default(sql`ARRAY[]::integer[]`),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('submission_versions', t as never),
    foreignKey({ columns: [t.submissionId], foreignColumns: [submissions.id], name: 'submission_versions_submission_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'submission_versions_created_by_fkey' }).onDelete('set null'),
    unique('submission_versions_submission_id_version_key').on(t.submissionId, t.version),
  ]
);

/** Teacher marks on a submitted file (highlights, pins, drawings) with comments. */
export const submissionAnnotations = pgTable(
  'submission_annotations',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    versionId: integer('version_id').notNull(),
    fileId: integer('file_id'),
    page: integer('page').notNull().default(1),
    /** { kind: pin | box | ink, x, y, w, h, points } in page-relative coordinates (0–1) */
    shape: jsonb('shape').notNull(),
    comment: text('comment').notNull().default(''),
    authorId: integer('author_id'),
    ...created,
  },
  (t) => [
    index('idx_submission_annotations_version').on(t.versionId),
    tenant('submission_annotations', t as never),
    foreignKey({ columns: [t.versionId], foreignColumns: [submissionVersions.id], name: 'submission_annotations_version_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.fileId], foreignColumns: [files.id], name: 'submission_annotations_file_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.authorId], foreignColumns: [users.id], name: 'submission_annotations_author_id_fkey' }).onDelete('set null'),
  ]
);

export const peerReviews = pgTable(
  'peer_reviews',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assessmentId: integer('assessment_id').notNull(),
    submissionId: integer('submission_id').notNull(),
    reviewerStudentId: integer('reviewer_student_id').notNull(),
    rubricScores: jsonb('rubric_scores'),
    comments: text('comments').notNull().default(''),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    tenant('peer_reviews', t as never),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'peer_reviews_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.submissionId], foreignColumns: [submissions.id], name: 'peer_reviews_submission_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.reviewerStudentId], foreignColumns: [students.id], name: 'peer_reviews_reviewer_student_id_fkey' }).onDelete('cascade'),
    unique('peer_reviews_submission_id_reviewer_student_id_key').on(t.submissionId, t.reviewerStudentId),
  ]
);

// ---------------------------------------------------------------- question bank & quizzes

export const questionBanks = pgTable(
  'question_banks',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** shared by every section that teaches this course; NULL = institution-wide */
    courseId: integer('course_id'),
    name: text('name').notNull(),
    createdBy: integer('created_by'),
    ...created,
    ...softDelete,
  },
  (t) => [
    tenant('question_banks', t as never),
    foreignKey({ columns: [t.courseId], foreignColumns: [courses.id], name: 'question_banks_course_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'question_banks_created_by_fkey' }).onDelete('set null'),
  ]
);

export const questions = pgTable(
  'questions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    bankId: integer('bank_id').notNull(),
    type: text('type').notNull(),
    promptHtml: text('prompt_html').notNull(),
    /** type-specific: options + correct keys, tolerance, formula, pairs, order, blanks */
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    points: numeric('points', { precision: 6, scale: 2 }).notNull().default('1'),
    difficulty: text('difficulty'),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    createdBy: integer('created_by'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...softDelete,
  },
  (t) => [
    index('idx_questions_bank').on(t.bankId),
    tenant('questions', t as never),
    foreignKey({ columns: [t.bankId], foreignColumns: [questionBanks.id], name: 'questions_bank_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'questions_created_by_fkey' }).onDelete('set null'),
    check(
      'questions_type_check',
      sql`${t.type} IN ('mcq', 'multi', 'true_false', 'short', 'numeric', 'formula', 'essay', 'matching', 'ordering', 'fill_blank', 'file_upload', 'audio')`
    ),
    check('questions_difficulty_check', sql`${t.difficulty} IS NULL OR ${t.difficulty} IN ('easy', 'medium', 'hard')`),
  ]
);

/** What a quiz contains: fixed questions, or "pick N from this bank (and tag)". */
export const assessmentQuestions = pgTable(
  'assessment_questions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assessmentId: integer('assessment_id').notNull(),
    questionId: integer('question_id'),
    poolBankId: integer('pool_bank_id'),
    poolTag: text('pool_tag'),
    poolCount: integer('pool_count'),
    /** overrides the question's points */
    points: numeric('points', { precision: 6, scale: 2 }),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    tenant('assessment_questions', t as never),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'assessment_questions_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.questionId], foreignColumns: [questions.id], name: 'assessment_questions_question_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.poolBankId], foreignColumns: [questionBanks.id], name: 'assessment_questions_pool_bank_id_fkey' }).onDelete('cascade'),
    check('assessment_questions_source_check', sql`(${t.questionId} IS NULL) <> (${t.poolBankId} IS NULL)`),
    check('assessment_questions_pool_check', sql`${t.poolBankId} IS NULL OR ${t.poolCount} > 0`),
  ]
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assessmentId: integer('assessment_id').notNull(),
    studentId: integer('student_id').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    status: text('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    /** start + time limit (with accommodations); answers after it are refused */
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    score: numeric('score', { precision: 7, scale: 2 }),
    maxScore: numeric('max_score', { precision: 7, scale: 2 }).notNull().default('0'),
    /** the questions this student got, in order, with their option orders */
    layout: jsonb('layout').notNull(),
    ip: text('ip'),
    /** one question at a time: the question the student is on (no going back) */
    position: integer('position').notNull().default(0),
  },
  (t) => [
    tenant('quiz_attempts', t as never),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'quiz_attempts_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'quiz_attempts_student_id_fkey' }).onDelete('cascade'),
    unique('quiz_attempts_assessment_id_student_id_attempt_no_key').on(t.assessmentId, t.studentId, t.attemptNo),
    check('quiz_attempts_status_check', sql`${t.status} IN ('in_progress', 'submitted', 'graded')`),
  ]
);

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    attemptId: integer('attempt_id').notNull(),
    questionId: integer('question_id').notNull(),
    response: jsonb('response'),
    autoPoints: numeric('auto_points', { precision: 6, scale: 2 }),
    manualPoints: numeric('manual_points', { precision: 6, scale: 2 }),
    feedback: text('feedback').notNull().default(''),
    gradedBy: integer('graded_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('attempt_answers', t as never),
    foreignKey({ columns: [t.attemptId], foreignColumns: [quizAttempts.id], name: 'attempt_answers_attempt_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.questionId], foreignColumns: [questions.id], name: 'attempt_answers_question_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.gradedBy], foreignColumns: [users.id], name: 'attempt_answers_graded_by_fkey' }).onDelete('set null'),
    unique('attempt_answers_attempt_id_question_id_key').on(t.attemptId, t.questionId),
  ]
);

/** Integrity signals during an attempt (focus lost, tab switched, …), shown to the teacher. */
export const attemptEvents = pgTable(
  'attempt_events',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    attemptId: integer('attempt_id').notNull(),
    kind: text('kind').notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
    data: jsonb('data'),
  },
  (t) => [
    index('idx_attempt_events_attempt').on(t.attemptId),
    tenant('attempt_events', t as never),
    foreignKey({ columns: [t.attemptId], foreignColumns: [quizAttempts.id], name: 'attempt_events_attempt_id_fkey' }).onDelete('cascade'),
  ]
);

// ---------------------------------------------------------------- gradebook

export const grades = pgTable(
  'grades',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    assessmentId: integer('assessment_id').notNull(),
    studentId: integer('student_id').notNull(),
    points: numeric('points', { precision: 7, scale: 2 }),
    excused: boolean('excused').notNull().default(false),
    /** not handed in by the due date (counts as zero unless excused) */
    missing: boolean('missing').notNull().default(false),
    /** percent taken off by the late policy */
    latePenaltyPercent: numeric('late_penalty_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    feedbackHtml: text('feedback_html').notNull().default(''),
    feedbackFileIds: integer('feedback_file_ids').array().notNull().default(sql`ARRAY[]::integer[]`),
    rubricScores: jsonb('rubric_scores'),
    /** suggested by the AI grading assistant and accepted by the teacher */
    aiAssisted: boolean('ai_assisted').notNull().default(false),
    status: text('status').notNull().default('draft'),
    gradedBy: integer('graded_by'),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_grades_student').on(t.studentId),
    tenant('grades', t as never),
    foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id], name: 'grades_assessment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'grades_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.gradedBy], foreignColumns: [users.id], name: 'grades_graded_by_fkey' }).onDelete('set null'),
    unique('grades_assessment_id_student_id_key').on(t.assessmentId, t.studentId),
    check('grades_status_check', sql`${t.status} IN ('draft', 'released')`),
    check('grades_points_check', sql`${t.points} IS NULL OR ${t.points} >= 0`),
  ]
);

export const gradeHistory = pgTable(
  'grade_history',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    gradeId: integer('grade_id').notNull(),
    points: numeric('points', { precision: 7, scale: 2 }),
    excused: boolean('excused').notNull(),
    status: text('status').notNull(),
    reason: text('reason').notNull().default(''),
    changedBy: integer('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_grade_history_grade').on(t.gradeId),
    tenant('grade_history', t as never),
    foreignKey({ columns: [t.gradeId], foreignColumns: [grades.id], name: 'grade_history_grade_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.changedBy], foreignColumns: [users.id], name: 'grade_history_changed_by_fkey' }).onDelete('set null'),
  ]
);

/** A teacher's decision to set a student's course grade by hand. */
export const finalGradeOverrides = pgTable(
  'final_grade_overrides',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    offeringId: integer('offering_id').notNull(),
    studentId: integer('student_id').notNull(),
    percent: numeric('percent', { precision: 5, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    setBy: integer('set_by'),
    setAt: timestamp('set_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('final_grade_overrides', t as never),
    foreignKey({ columns: [t.offeringId], foreignColumns: [courseOfferings.id], name: 'final_grade_overrides_offering_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'final_grade_overrides_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.setBy], foreignColumns: [users.id], name: 'final_grade_overrides_set_by_fkey' }).onDelete('set null'),
    unique('final_grade_overrides_offering_id_student_id_key').on(t.offeringId, t.studentId),
    check('final_grade_overrides_percent_check', sql`${t.percent} BETWEEN 0 AND 100`),
  ]
);
