// Request bodies for the academic structure (campuses → departments → programs → levels →
// sections; years → terms; courses → offerings → enrolments; the calendar).
import { z } from 'zod';
import { HOLIDAY_KINDS, INSTITUTION_TYPES, SECTION_STAFF_ROLES, TERM_KINDS, institutionSettings } from '../academics';
import { currency, id, isoDate, locale, optionalDate, optionalId, requiredText, text, timeZone } from './common';

const codeText = (max = 20) =>
  z
    .string()
    .trim()
    .min(1, 'Required')
    .max(max)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, digits, dot, dash or underscore');

const optionalPositiveInt = (max: number) =>
  z
    .union([z.coerce.number().int().min(1).max(max), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

const optionalDecimal = (max: number) =>
  z
    .union([z.coerce.number().min(0).max(max), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

/** PATCH bodies: every field optional, at least one present. */
const patchOf = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to change');

export const campusBody = z.object({
  name: requiredText(120),
  code: codeText(),
  address: text(300).default(''),
  phone: text(40).default(''),
});
export const updateCampusBody = patchOf(campusBody.shape);

export const departmentBody = z.object({
  name: requiredText(120),
  code: codeText(),
  campus_id: optionalId,
  head_teacher_id: optionalId,
});
export const updateDepartmentBody = patchOf(departmentBody.shape);

export const programBody = z.object({
  name: requiredText(150),
  code: codeText(),
  department_id: optionalId,
  description: text(2000).default(''),
  grading_scheme_id: optionalId,
  credits_required: optionalDecimal(1000),
  /** level names in order (Class 1 … Class 5, Semester 1 … 8) */
  levels: z.array(requiredText(80)).max(30).default([]),
});
export const updateProgramBody = patchOf({ ...programBody.omit({ levels: true }).shape });
export const levelBody = z.object({ name: requiredText(80) });
export const reorderLevelsBody = z.object({ level_ids: z.array(id).min(1).max(30) });

export const termBody = z
  .object({
    name: requiredText(80),
    kind: z.enum(TERM_KINDS).default('annual'),
    starts_on: isoDate,
    ends_on: optionalDate,
  })
  .refine((t) => !t.ends_on || t.ends_on >= t.starts_on, { message: 'A term cannot end before it starts', path: ['ends_on'] });

export const academicYearBody = z
  .object({
    name: requiredText(40),
    starts_on: isoDate,
    ends_on: isoDate,
    is_current: z.boolean().default(false),
    terms: z.array(termBody).max(12).default([]),
  })
  .refine((y) => y.ends_on > y.starts_on, { message: 'The year must end after it starts', path: ['ends_on'] })
  .refine((y) => y.terms.every((t) => t.starts_on >= y.starts_on && t.starts_on <= y.ends_on && (!t.ends_on || t.ends_on <= y.ends_on)), {
    message: 'Every term must fall inside the year',
    path: ['terms'],
  });
export const updateAcademicYearBody = patchOf({
  name: requiredText(40),
  starts_on: isoDate,
  ends_on: isoDate,
  is_current: z.boolean(),
});
export const updateTermBody = patchOf({
  name: requiredText(80),
  kind: z.enum(TERM_KINDS),
  starts_on: isoDate,
  ends_on: optionalDate,
  status: z.enum(['planned', 'active']),
});

export const holidayBody = z
  .object({
    name: requiredText(120),
    starts_on: isoDate,
    ends_on: optionalDate,
    kind: z.enum(HOLIDAY_KINDS).default('holiday'),
    campus_id: optionalId,
  })
  .transform((h) => ({ ...h, ends_on: h.ends_on ?? h.starts_on }))
  .refine((h) => h.ends_on >= h.starts_on, { message: 'A holiday cannot end before it starts', path: ['ends_on'] });

export const calendarQuery = z
  .object({ from: isoDate, to: isoDate, campus_id: optionalId })
  .refine((q) => q.to >= q.from, { message: '"to" must not be before "from"', path: ['to'] })
  .refine((q) => (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86400000 <= 400, {
    message: 'At most about a year at a time',
    path: ['to'],
  });

export const updateSectionBody = patchOf({
  code: codeText(),
  name: requiredText(80),
  label: text(20),
  campus_id: optionalId,
  academic_year_id: optionalId,
  program_level_id: optionalId,
  homeroom_teacher_id: optionalId,
  capacity: optionalPositiveInt(10000),
});
export const sectionListQuery = z.object({
  campus_id: optionalId,
  academic_year_id: optionalId,
  program_level_id: optionalId,
  status: z.enum(['active', 'archived', 'all']).default('active'),
  search: z.string().trim().max(100).default(''),
});

export const courseBody = z.object({
  code: codeText(),
  name: requiredText(150),
  description: text(4000).default(''),
  department_id: optionalId,
  credit_hours: optionalDecimal(50),
});
export const updateCourseBody = patchOf(courseBody.shape);
export const courseListQuery = z.object({ search: z.string().trim().max(100).default(''), department_id: optionalId });

export const offeringBody = z.object({
  course_id: id,
  term_id: optionalId,
  section_id: optionalId,
  enrollment_mode: z.enum(['section', 'open']).default('section'),
  capacity: optionalPositiveInt(10000),
  waitlist_enabled: z.boolean().default(true),
});
export const updateOfferingBody = patchOf({
  term_id: optionalId,
  section_id: optionalId,
  enrollment_mode: z.enum(['section', 'open']),
  capacity: optionalPositiveInt(10000),
  waitlist_enabled: z.boolean(),
});
export const offeringListQuery = z.object({ term_id: optionalId, section_id: optionalId, course_id: optionalId, campus_id: optionalId });
export const offeringStaffBody = z.object({ teacher_id: id, role: z.enum(SECTION_STAFF_ROLES).default('teacher') });
export const enrollBody = z.object({ student_ids: z.array(id).min(1).max(500) });

// ---------- institution settings & onboarding ----------

export const institutionProfileBody = patchOf({
  name: requiredText(200),
  type: z.enum(INSTITUTION_TYPES),
  contact_email: z.union([z.literal(''), z.email()]),
  phone: text(40),
  address: text(300),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'A colour like #2563EB'),
  currency,
  timezone: timeZone,
  locale,
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Two-letter country code'),
  settings: institutionSettings,
});

export const onboardingApplyBody = z.object({
  type: z.enum(INSTITUTION_TYPES),
  /** create the current academic year and its terms from the type's defaults */
  academic_year: z.boolean().default(true),
  /** create the grading scheme from the type's defaults (unless one exists) */
  grading: z.boolean().default(true),
  /** program templates to create (by code) — defaults to all of the type's templates */
  programs: z.array(z.string().max(20)).max(20).optional(),
  /** extra campuses / branches */
  campuses: z.array(z.object({ name: requiredText(120), code: codeText() })).max(50).default([]),
});
