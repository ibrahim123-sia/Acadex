// Request bodies for people: student and staff profiles, guardians and their permissions,
// medical notes, custom fields, documents, year-end moves, ID cards and certificates.
import { z } from 'zod';
import { GUARDIAN_RELATIONSHIPS, STUDENT_STATUSES } from '../academics';
import { email, id, isoDate, optionalDate, optionalId, requiredText, text, patchSchema } from './common';

const nullableText = (max: number) =>
  text(max)
    .optional()
    .transform((v) => v || null);

const patchOf = <T extends z.ZodRawShape>(shape: T) =>
  patchSchema(shape).refine((o) => Object.keys(o).length > 0, 'Nothing to change');

/** Values for the institution's custom fields; checked against their definitions by the API. */
export const customData = z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]));

export const updateStudentBody = patchOf({
  first_name: requiredText(80),
  last_name: requiredText(80),
  email,
  gender: nullableText(20),
  dob: optionalDate,
  phone: nullableText(30),
  roll_no: nullableText(40),
  section_id: optionalId,
  city: text(80),
  address: text(300),
  national_id: text(30),
  nationality: text(60),
  religion: text(60),
  admission_date: optionalDate,
  status: z.enum(STUDENT_STATUSES),
  custom_data: customData,
});

export const studentListQuery = z.object({
  search: z.string().trim().max(100).default(''),
  section_id: optionalId,
  campus_id: optionalId,
  status: z.enum([...STUDENT_STATUSES, 'all']).default('active'),
});

export const updateStaffBody = patchOf({
  first_name: requiredText(80),
  last_name: requiredText(80),
  email,
  gender: nullableText(20),
  dob: optionalDate,
  phone: text(30),
  cnic: text(30),
  qualification: text(120),
  designation: text(80),
  employee_no: nullableText(40),
  staff_type: z.enum(['teaching', 'non_teaching']),
  employment_type: z.enum(['full_time', 'part_time', 'visiting', 'contract']),
  campus_id: optionalId,
  department_id: optionalId,
  joining_date: optionalDate,
  address: text(300),
  emergency_contact_name: text(120),
  emergency_contact_phone: text(30),
  status: z.enum(['active', 'on_leave', 'left']),
  custom_data: customData,
});
export const staffListQuery = z.object({
  search: z.string().trim().max(100).default(''),
  campus_id: optionalId,
  department_id: optionalId,
  staff_type: z.enum(['teaching', 'non_teaching', 'all']).default('all'),
});

export const guardianBody = z.object({
  first_name: requiredText(80),
  last_name: text(80).default(''),
  email: z
    .union([email, z.literal('')])
    .optional()
    .transform((v) => v || ''),
  phone: text(30).default(''),
  national_id: text(30).default(''),
  occupation: text(80).default(''),
  address: text(300).default(''),
  custom_data: customData.default({}),
});
export const updateGuardianBody = patchOf(guardianBody.shape);

export const guardianPermissions = z.object({
  relationship: z.enum(GUARDIAN_RELATIONSHIPS).default('guardian'),
  is_primary: z.boolean().default(false),
  can_view_grades: z.boolean().default(true),
  can_view_fees: z.boolean().default(true),
  can_message: z.boolean().default(true),
  is_emergency_contact: z.boolean().default(false),
});
/** Link an existing guardian, or create one, to a student. */
export const linkGuardianBody = z.union([
  guardianPermissions.extend({ guardian_id: id }),
  guardianPermissions.extend({ guardian: guardianBody }),
]);
export const updateGuardianshipBody = patchOf(guardianPermissions.shape);

export const medicalBody = z.object({
  blood_group: text(10).default(''),
  conditions: text(2000).default(''),
  allergies: text(2000).default(''),
  medications: text(2000).default(''),
  emergency_contact_name: text(120).default(''),
  emergency_contact_phone: text(30).default(''),
  notes: text(4000).default(''),
});

export const customFieldBody = z
  .object({
    entity: z.enum(['student', 'staff', 'guardian']),
    key: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, digits and underscores, starting with a letter'),
    label: requiredText(80),
    field_type: z.enum(['text', 'number', 'date', 'select', 'checkbox']),
    options: z.array(requiredText(80)).max(50).default([]),
    required: z.boolean().default(false),
    sort: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .refine((f) => f.field_type !== 'select' || f.options.length > 0, { message: 'A choice field needs options', path: ['options'] });
export const updateCustomFieldBody = patchOf({
  label: requiredText(80),
  options: z.array(requiredText(80)).max(50),
  required: z.boolean(),
  sort: z.coerce.number().int().min(0).max(1000),
});

export const DOCUMENT_CATEGORIES = ['birth_certificate', 'national_id', 'previous_result', 'transfer_certificate', 'medical', 'photo', 'cv', 'contract', 'other'] as const;
export const documentMeta = z.object({
  title: requiredText(150),
  category: z.enum(DOCUMENT_CATEGORIES).default('other'),
});

// ---------- year end ----------

export const promotionMove = z.object({
  student_id: id,
  action: z.enum(['promoted', 'repeated', 'graduated', 'left']),
  /** the section for promoted / repeated students */
  to_section_id: optionalId,
});
export const promotionBody = z
  .object({ moves: z.array(promotionMove).min(1).max(2000) })
  .refine((b) => b.moves.every((m) => ['graduated', 'left'].includes(m.action) || m.to_section_id), {
    message: 'Promoted and repeating students need a section',
    path: ['moves'],
  })
  .refine((b) => new Set(b.moves.map((m) => m.student_id)).size === b.moves.length, { message: 'A student appears twice', path: ['moves'] });
export const promotionPreviewQuery = z.object({ from_year_id: id, to_year_id: id });

// ---------- ID cards & certificates ----------

export const issueIdCardsBody = z
  .object({
    holder_type: z.enum(['student', 'staff']),
    holder_ids: z.array(id).max(500).default([]),
    /** all students of a section */
    section_id: optionalId,
    valid_until: optionalDate,
  })
  .refine((b) => b.holder_ids.length > 0 || b.section_id, { message: 'Choose people or a section', path: ['holder_ids'] });

export const DOCUMENT_KINDS = ['leaving_certificate', 'character_certificate', 'bonafide_letter'] as const;
export const issueDocumentBody = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  student_id: id,
  /** leaving certificates: the last day and the reason */
  left_on: optionalDate,
  reason: text(300).default(''),
  conduct: text(100).default('Good'),
  purpose: text(200).default(''),
  /** also mark the student as having left (leaving certificate) */
  mark_left: z.boolean().default(false),
});
export const documentTemplateBody = z.object({
  title: requiredText(150),
  body: requiredText(10000),
  serial_prefix: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9-]+$/, 'Capital letters, digits and dashes'),
});
export const revokeDocumentBody = z.object({ reason: requiredText(300) });

// ---------- recycle bin & audit ----------

export const RECYCLABLE = ['students', 'teachers', 'guardians', 'sections', 'courses', 'programs', 'departments', 'campuses', 'person_documents'] as const;
export const auditQuery = z.object({
  entity: z.string().trim().max(60).optional(),
  entity_id: z.string().trim().max(40).optional(),
  user_id: optionalId,
  action: z.string().trim().max(40).optional(),
  from: z.union([isoDate, z.literal('')]).optional(),
  to: z.union([isoDate, z.literal('')]).optional(),
});
