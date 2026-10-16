import { z } from 'zod';
import { id, isoDate, optionalId, requiredText, text } from './common';

export const EXAM_KINDS = ['midterm', 'final', 'monthly', 'board', 'supplementary', 'other'] as const;
export const EXAM_SERIES_STATUSES = ['planning', 'scheduled', 'in_progress', 'marking', 'published'] as const;
export const PAPER_STATUSES = ['scheduled', 'marks_entry', 'submitted', 'hod_approved', 'approved'] as const;
export const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected a time as HH:MM');
const marks = z.coerce.number().min(0).max(10000);

export const examSeriesBody = z.object({
  name: requiredText(120),
  term_id: optionalId,
  kind: z.enum(EXAM_KINDS).default('final'),
  result_style: z.enum(['board', 'university']).default('board'),
  eligibility: z.object({ attendance: z.boolean().default(true), fees: z.boolean().default(false) }).default({ attendance: true, fees: false }),
  instructions: text(3000).default(''),
});

export const examSessionBody = z
  .object({
    offering_id: id,
    date: isoDate,
    starts_at: time,
    ends_at: time,
    total_marks: marks.default(100),
    pass_marks: marks.default(33),
  })
  .refine((b) => b.ends_at > b.starts_at, { message: 'Must end after it starts', path: ['ends_at'] })
  .refine((b) => b.pass_marks <= b.total_marks, { message: 'Pass marks above the total', path: ['pass_marks'] });

/** Lay out a date sheet: every course of the chosen sections, one paper per slot, skipping days off. */
export const examTimetableBody = z.object({
  section_ids: z.array(id).min(1).max(200),
  from: isoDate,
  slots: z.array(z.object({ starts_at: time, ends_at: time })).min(1).max(4),
  /** weekdays with no papers (0 = Sunday) */
  days_off: z.array(z.number().int().min(0).max(6)).max(6).default([0]),
  /** days between two papers of the same section */
  gap_days: z.coerce.number().int().min(0).max(5).default(0),
  total_marks: marks.default(100),
  pass_marks: marks.default(33),
  commit: z.boolean().default(false),
});

export const seatingBody = z.object({ date: isoDate, room_ids: z.array(id).min(1).max(100) });
export const dutyBody = z.object({ room_id: id, teacher_id: id, role: z.enum(['chief', 'invigilator']).default('invigilator') });
export const autoDutiesBody = z.object({ date: isoDate, per_students: z.coerce.number().int().min(5).max(200).default(30) });

export const marksEntryBody = z.object({
  marks: z
    .array(z.object({ student_id: id, marks: marks.nullable().optional(), absent: z.boolean().default(false), remarks: text(200).default('') }))
    .min(1)
    .max(2000),
});

export const moderationBody = z
  .object({ add: z.coerce.number().min(-100).max(100).optional(), scale_to: marks.optional(), note: requiredText(300) })
  .refine((b) => (b.add !== undefined) !== (b.scale_to !== undefined), { message: 'Either add marks or scale to a top mark', path: ['add'] });

export const returnMarksBody = z.object({ note: requiredText(300) });
export const overrideAdmitBody = z.object({ reason: requiredText(300) });

export const meritQuery = z.object({ scope: z.enum(['section', 'level', 'all']).default('section'), top: z.coerce.number().int().min(1).max(500).default(10) });

// ---------------------------------------------------------------- outcomes (OBE)

export const outcomeBody = z
  .object({
    level: z.enum(['program', 'course']),
    program_id: optionalId,
    course_id: optionalId,
    code: requiredText(20),
    description: requiredText(1000),
    bloom_level: z.enum(BLOOM_LEVELS).nullable().optional(),
    pass_percent: z.coerce.number().min(0).max(100).default(50),
    target_percent: z.coerce.number().min(0).max(100).default(70),
  })
  .refine((b) => (b.level === 'program' ? !!b.program_id && !b.course_id : !!b.course_id && !b.program_id), { message: 'A PLO belongs to a program, a CLO to a course', path: ['level'] });

export const outcomeMappingBody = z.object({ mappings: z.array(z.object({ clo_id: id, plo_id: id, strength: z.coerce.number().int().min(1).max(3) })).max(2000) });

export const outcomeAlignmentBody = z.object({
  target_type: z.enum(['question', 'criterion', 'assessment', 'exam_session']),
  target_id: id,
  clo_ids: z.array(id).max(20),
});
