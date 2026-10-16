// Request bodies for the LMS: course space, assessments, quizzes, the gradebook, attendance,
// the timetable and engagement (discussions, polls, surveys, live classes, certificates).
import { z } from 'zod';
import { httpUrl, id, isoDate, optionalId, patchSchema, requiredText, text } from './common';
import { QUESTION_TYPES } from '../quiz';

/** An ISO date-time, '' / null → null. */
export const optionalDateTime = z
  .union([z.iso.datetime({ offset: true }), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v) : null));
const percent = z.coerce.number().min(0).max(100);
const points = z.coerce.number().min(0).max(100000);
const html = (max = 200_000) => z.string().max(max).default('');
const ids = z.array(id).max(1000);

// ---------------------------------------------------------------- course space

export const CONTENT_KINDS = ['page', 'file', 'link', 'video', 'embed', 'assessment', 'live', 'scorm'] as const;
export const COMPLETION_RULES = ['view', 'mark_done', 'submit', 'pass'] as const;

export const moduleBody = z.object({
  title: requiredText(200),
  description: text(2000).default(''),
  published: z.boolean().default(false),
  unlock_at: optionalDateTime,
  prerequisite_module_id: optionalId,
  mastery_percent: z.union([percent, z.null()]).optional().default(null),
});
export const orderBody = z.object({ ids: z.array(id).min(1).max(500) });

export const contentItemBody = z.object({
  module_id: id,
  kind: z.enum(CONTENT_KINDS),
  title: requiredText(200),
  /** rich pages: the editor's HTML (sanitised on the server) and its JSON document */
  body_html: html(),
  body_json: z.unknown().optional(),
  url: z.union([httpUrl, z.literal('')]).default(''),
  file_id: optionalId,
  assessment_id: optionalId,
  live_session_id: optionalId,
  scorm_package_id: optionalId,
  published: z.boolean().default(true),
  unlock_at: optionalDateTime,
  completion: z.enum(COMPLETION_RULES).default('view'),
  duration_minutes: z.coerce.number().int().min(0).max(10000).nullable().default(null),
});
export const contentItemPatch = patchSchema(contentItemBody.shape).omit({ kind: true });

export const progressBody = z.object({
  status: z.enum(['started', 'done']).default('started'),
  percent: z.coerce.number().int().min(0).max(100).default(0),
  resume: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional(),
});

export const blueprintBody = z.object({ title: requiredText(200), description: text(2000).default(''), course_id: optionalId, from_offering_id: optionalId });
export const blueprintApplyBody = z.object({ offering_ids: z.array(id).min(1).max(200) });

// ---------------------------------------------------------------- assessments

export const ASSESSMENT_KINDS = ['assignment', 'quiz', 'exam', 'project', 'participation'] as const;
export const SUBMISSION_TYPES = ['text', 'file', 'link', 'audio', 'video', 'none'] as const;
export const AI_POLICIES = ['allowed', 'limited', 'not_allowed'] as const;

export const latePolicy = z
  .object({
    mode: z.enum(['allow', 'penalty', 'block']).default('allow'),
    penalty_percent_per_day: percent.default(10),
    max_penalty_percent: percent.default(50),
  })
  .default({ mode: 'allow', penalty_percent_per_day: 10, max_penalty_percent: 50 });

export const quizSettings = z.object({
  time_limit_minutes: z.coerce.number().int().min(1).max(600).nullable().default(null),
  shuffle_questions: z.boolean().default(false),
  shuffle_options: z.boolean().default(true),
  one_at_a_time: z.boolean().default(false),
  /** when students see right answers */
  show_results: z.enum(['never', 'after_submit', 'after_due', 'after_release']).default('after_release'),
  /** which attempt counts */
  scoring: z.enum(['highest', 'latest', 'average']).default('highest'),
});

export const peerReviewSettings = z.object({
  reviews_per_student: z.coerce.number().int().min(1).max(10).default(2),
  due_at: optionalDateTime,
  anonymous: z.boolean().default(true),
});

export const assessmentBody = z.object({
  kind: z.enum(ASSESSMENT_KINDS).default('assignment'),
  title: requiredText(200),
  instructions_html: html(),
  points: points.default(100),
  category_id: optionalId,
  available_from: optionalDateTime,
  due_at: optionalDateTime,
  available_until: optionalDateTime,
  status: z.enum(['draft', 'published', 'closed']).default('draft'),
  submission_types: z.array(z.enum(SUBMISSION_TYPES)).min(1).max(6).default(['text', 'file']),
  /** submissions allowed; null = unlimited */
  allowed_attempts: z.coerce.number().int().min(1).max(100).nullable().default(1),
  late_policy: latePolicy,
  group_set_id: optionalId,
  peer_review: peerReviewSettings.nullable().default(null),
  rubric_id: optionalId,
  ai_policy: z.enum(AI_POLICIES).default('allowed'),
  quiz: quizSettings.nullable().default(null),
  release_mode: z.enum(['manual', 'on_grading']).default('manual'),
  /** add it to this module of the course space */
  module_id: optionalId,
});
export const assessmentPatch = patchSchema(assessmentBody.shape).omit({ module_id: true });

export const extensionBody = z
  .object({
    student_id: optionalId,
    group_id: optionalId,
    due_at: optionalDateTime,
    available_until: optionalDateTime,
    extra_attempts: z.coerce.number().int().min(0).max(20).default(0),
    extra_time_percent: z.coerce.number().int().min(0).max(300).default(0),
    reason: text(500).default(''),
  })
  .refine((b) => !!b.student_id !== !!b.group_id, { message: 'Give a student or a group', path: ['student_id'] });

export const accommodationBody = z.object({ extra_time_percent: z.coerce.number().int().min(0).max(300), notes: text(1000).default('') });

export const submitBody = z.object({
  text_html: html(),
  link_url: z.union([httpUrl, z.literal('')]).default(''),
  file_ids: z.array(id).max(20).default([]),
  /** false keeps it as a draft */
  submit: z.boolean().default(true),
});

export const rubricScores = z.record(z.string().regex(/^\d+$/), z.object({ points: points, comment: text(2000).default('') }));

export const gradeBody = z.object({
  student_id: id,
  points: z.union([points, z.null()]).default(null),
  excused: z.boolean().default(false),
  feedback_html: html(50_000),
  feedback_file_ids: z.array(id).max(10).default([]),
  rubric_scores: rubricScores.nullable().default(null),
  /** why a released grade changed (kept in the grade history) */
  reason: text(500).default(''),
});
export const bulkGradesBody = z.object({ grades: z.array(gradeBody).min(1).max(1000) });
export const releaseBody = z.object({ student_ids: z.array(id).max(1000).optional() });

export const annotationBody = z.object({
  file_id: optionalId,
  page: z.coerce.number().int().min(1).max(5000).default(1),
  shape: z.object({
    kind: z.enum(['pin', 'box', 'ink']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1).optional(),
    h: z.number().min(0).max(1).optional(),
    points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).max(2000).optional(),
  }),
  comment: text(2000).default(''),
});

export const rubricBody = z.object({
  title: requiredText(200),
  /** null = the institution's shared library */
  offering_id: optionalId,
  criteria: z
    .array(
      z.object({
        title: requiredText(200),
        description: text(1000).default(''),
        levels: z.array(z.object({ points, label: requiredText(80), description: text(1000).default('') })).min(1).max(10),
      })
    )
    .min(1)
    .max(30),
});

export const groupSetBody = z.object({
  name: requiredText(120),
  self_signup: z.boolean().default(false),
  max_size: z.coerce.number().int().min(1).max(100).nullable().default(null),
  /** split the roster automatically into groups of this size */
  auto_size: z.coerce.number().int().min(1).max(100).optional(),
});
export const groupsBody = z.object({ groups: z.array(z.object({ name: requiredText(120), student_ids: ids })).max(200) });

export const peerReviewBody = z.object({ rubric_scores: rubricScores.nullable().default(null), comments: text(10_000).default('') });

// ---------------------------------------------------------------- question bank & quizzes

export const questionBankBody = z.object({ name: requiredText(200), course_id: optionalId });
export const questionBody = z.object({
  bank_id: id,
  type: z.enum(QUESTION_TYPES),
  prompt_html: z.string().min(1).max(50_000),
  data: z.record(z.string(), z.unknown()).default({}),
  points: points.default(1),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export const questionPatch = patchSchema(questionBody.shape).omit({ bank_id: true });

export const quizItemsBody = z.object({
  items: z
    .array(
      z.union([
        z.object({ question_id: id, points: points.nullable().default(null) }),
        z.object({ pool_bank_id: id, pool_tag: text(40).nullable().default(null), pool_count: z.coerce.number().int().min(1).max(200), points: points.nullable().default(null) }),
      ])
    )
    .max(500),
});
export const answerBody = z.object({ question_id: id, response: z.unknown() });
export const attemptEventBody = z.object({ kind: z.enum(['blur', 'focus', 'visibility_hidden', 'paste', 'copy', 'fullscreen_exit', 'fullscreen_enter', 'context_menu']), data: z.record(z.string(), z.unknown()).optional() });
export const manualGradeBody = z.object({
  answers: z.array(z.object({ question_id: id, points: points, feedback: text(5000).default('') })).min(1).max(500),
});
export const regradeBody = z.object({
  question_id: id,
  /** full_credit: everyone gets the points; rescore: grade again with the corrected answer */
  mode: z.enum(['rescore', 'full_credit']),
});

// ---------------------------------------------------------------- gradebook

export const categoryBody = z.object({
  name: requiredText(80),
  weight: percent.default(0),
  drop_lowest: z.coerce.number().int().min(0).max(20).default(0),
});
export const finalOverrideBody = z.object({ student_id: id, percent: z.union([percent, z.null()]), reason: text(500).default('') });

// ---------------------------------------------------------------- attendance

export const ATTENDANCE_STATUS = ['present', 'absent', 'late', 'excused', 'leave'] as const;
export type AttendanceMark = (typeof ATTENDANCE_STATUS)[number];

export const registerBody = z.object({
  section_id: id,
  /** a class in one period (with the course) or the whole day (no course) */
  offering_id: optionalId,
  period_id: optionalId,
  date: isoDate,
  records: z
    .array(
      z.object({
        student_id: id,
        status: z.enum(ATTENDANCE_STATUS),
        minutes_late: z.coerce.number().int().min(0).max(600).nullable().default(null),
        note: text(300).default(''),
      })
    )
    .max(1000),
  /** saved from the offline queue on the phone */
  offline: z.boolean().default(false),
});
export const registerQuery = z.object({ section_id: id, offering_id: optionalId, period_id: optionalId, date: isoDate.optional() });
export const qrCheckinBody = z.object({ session_id: id, code: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/) });

export const LEAVE_KINDS = ['sick', 'personal', 'family', 'official', 'other'] as const;
export const leaveBody = z
  .object({
    /** parents: which child; staff and students: themselves */
    student_id: optionalId,
    from_date: isoDate,
    to_date: isoDate,
    kind: z.enum(LEAVE_KINDS).default('personal'),
    reason: text(1000).default(''),
  })
  .refine((b) => b.to_date >= b.from_date, { message: 'The last day is before the first', path: ['to_date'] });
export const leaveDecisionBody = z.object({ status: z.enum(['approved', 'rejected']), note: text(500).default('') });
export const staffAttendanceBody = z.object({
  date: isoDate,
  records: z.array(z.object({ teacher_id: id, status: z.enum(['Present', 'Absent', 'Leave']) })).max(1000),
});

// ---------------------------------------------------------------- timetable

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected a time as HH:MM');
export const roomBody = z.object({
  name: requiredText(120),
  code: requiredText(30),
  campus_id: optionalId,
  capacity: z.coerce.number().int().min(1).max(10000).nullable().default(null),
  kind: z.enum(['classroom', 'lab', 'hall', 'library', 'ground', 'online', 'other']).default('classroom'),
});
export const periodsBody = z.object({
  campus_id: optionalId,
  periods: z
    .array(z.object({ name: requiredText(40), starts_at: hhmm, ends_at: hhmm, is_break: z.boolean().default(false) }))
    .max(20)
    .refine((ps) => ps.every((p) => p.ends_at > p.starts_at), { message: 'Each period must end after it starts' }),
});
export const slotBody = z.object({
  term_id: optionalId,
  section_id: id,
  offering_id: optionalId,
  teacher_id: optionalId,
  room_id: optionalId,
  weekday: z.coerce.number().int().min(0).max(6),
  period_id: id,
});
export const unavailabilityBody = z.object({ entries: z.array(z.object({ weekday: z.coerce.number().int().min(0).max(6), period_id: optionalId })).max(100) });
export const substitutionBody = z.object({ slot_id: id, date: isoDate, substitute_teacher_id: id, reason: text(300).default('') });
export const generateTimetableBody = z.object({ term_id: optionalId, section_ids: z.array(id).min(1).max(200), apply: z.boolean().default(false) });
export const timetableQuery = z.object({ section_id: optionalId, teacher_id: optionalId, room_id: optionalId, term_id: optionalId, week_of: isoDate.optional() });

// ---------------------------------------------------------------- engagement

export const discussionBody = z.object({ title: requiredText(200), body_html: html(50_000), mode: z.enum(['open', 'qa']).default('open'), pinned: z.boolean().default(false) });
export const discussionPatch = patchSchema(discussionBody.shape).extend({ locked: z.boolean().optional() });
export const postBody = z.object({ body_html: z.string().min(1).max(50_000), parent_id: optionalId });
export const moderateBody = z.object({ hidden: z.boolean() });

export const pollBody = z.object({
  offering_id: optionalId,
  question: requiredText(300),
  options: z.array(requiredText(200)).min(2).max(10),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(true),
  closes_at: optionalDateTime,
});
export const voteBody = z.object({ choices: z.array(z.coerce.number().int().min(0).max(9)).min(1).max(10) });

export const surveyQuestion = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  kind: z.enum(['rating', 'choice', 'text']),
  label: requiredText(300),
  options: z.array(requiredText(200)).max(10).optional(),
  required: z.boolean().default(false),
});
export const surveyBody = z.object({
  offering_id: optionalId,
  title: requiredText(200),
  description: text(2000).default(''),
  anonymous: z.boolean().default(true),
  audience: z.enum(['students', 'staff', 'guardians', 'everyone']).default('students'),
  questions: z.array(surveyQuestion).min(1).max(50),
  status: z.enum(['draft', 'open', 'closed']).default('draft'),
  opens_at: optionalDateTime,
  closes_at: optionalDateTime,
});
export const surveyResponseBody = z.object({ answers: z.record(z.string(), z.union([z.string().max(5000), z.number(), z.null()])) });

export const LIVE_PROVIDERS = ['jitsi', 'zoom', 'meet', 'teams', 'other'] as const;
export const liveSessionBody = z.object({
  title: requiredText(200),
  provider: z.enum(LIVE_PROVIDERS).default('jitsi'),
  /** empty for Jitsi: a room is created */
  join_url: z.union([httpUrl, z.literal('')]).default(''),
  starts_at: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  duration_minutes: z.coerce.number().int().min(5).max(600).default(45),
  auto_attendance: z.boolean().default(true),
  recording_url: z.union([httpUrl, z.literal('')]).default(''),
  module_id: optionalId,
});

export const announcementBody = z.object({
  title: requiredText(200),
  description: text(10_000).default(''),
  target_audience: z.enum(['All', 'Teachers', 'Students', 'Parents']).default('All'),
  campus_id: optionalId,
  section_id: optionalId,
  offering_id: optionalId,
  start_date: z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => v || null),
  end_date: z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => v || null),
  notify: z.boolean().default(true),
});

export const courseCertificateBody = z.object({
  title: requiredText(200),
  body: requiredText(5000),
  auto_issue: z.boolean().default(true),
  min_progress_percent: z.coerce.number().int().min(0).max(100).default(100),
  min_grade_percent: z.union([percent, z.null()]).default(null),
});

export const badgeBody = z.object({
  name: requiredText(80),
  description: text(500).default(''),
  icon: z.enum(['award', 'star', 'flame', 'trophy', 'medal', 'rocket', 'book']).default('award'),
  criteria: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('items_completed'), threshold: z.coerce.number().int().min(1).max(10000) }),
    z.object({ kind: z.literal('streak_days'), threshold: z.coerce.number().int().min(1).max(365) }),
    z.object({ kind: z.literal('perfect_score'), threshold: z.coerce.number().int().min(1).max(1000).default(1) }),
    z.object({ kind: z.literal('manual') }),
  ]),
});
export const awardBody = z.object({ student_id: id, offering_id: optionalId });

export const importContentQuery = z.object({ format: z.enum(['imscc', 'mbz', 'qti', 'scorm']) });
export const classroomImportBody = z.object({ course_ref: requiredText(200) });

/** Secure exam mode for a quiz or online exam (the access code is stored hashed). */
export const secureExamBody = z.object({
  enabled: z.boolean().default(true),
  /** a code the invigilator gives out in the room; '' keeps the current one, null removes it */
  access_code: z.string().trim().min(4).max(40).nullable().optional(),
  /** only from these networks (CIDR, e.g. 203.0.113.0/24 for the campus) */
  ip_allowlist: z.array(z.string().trim().max(50)).max(20).default([]),
  require_fullscreen: z.boolean().default(true),
  /** one question at a time, no going back */
  lock_navigation: z.boolean().default(false),
  block_copy_paste: z.boolean().default(true),
  /** hand in automatically after this many times leaving the exam (null: only log) */
  max_violations: z.coerce.number().int().min(1).max(50).nullable().default(null),
});
