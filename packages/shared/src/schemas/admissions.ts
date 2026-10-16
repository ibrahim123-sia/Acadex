import { z } from 'zod';
import { email, id, isoDate, optionalDate, optionalId, requiredText, text } from './common';

export const APPLICATION_STATUSES = ['submitted', 'under_review', 'test_scheduled', 'tested', 'offered', 'accepted', 'declined', 'rejected', 'waitlisted', 'enrolled', 'withdrawn'] as const;
export const ENQUIRY_SOURCES = ['walk_in', 'phone', 'website', 'social', 'referral', 'event', 'other'] as const;
export const ENQUIRY_STATUSES = ['new', 'contacted', 'visited', 'applied', 'enrolled', 'lost'] as const;
export const FOLLOWUP_CHANNELS = ['phone', 'email', 'whatsapp', 'sms', 'visit', 'other'] as const;

const dateTime = z
  .union([z.iso.datetime({ offset: true }), z.literal(''), z.null()])
  .optional()
  .transform((v) => v || null);
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes').max(60);

export const admissionFormBody = z
  .object({
    slug,
    title: requiredText(150),
    description: text(4000).default(''),
    academic_year_id: optionalId,
    campus_id: optionalId,
    program_id: optionalId,
    program_level_id: optionalId,
    fields: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
          label: requiredText(120),
          type: z.enum(['text', 'textarea', 'number', 'date', 'select']).default('text'),
          options: z.array(requiredText(80)).max(50).optional(),
          required: z.boolean().default(false),
        })
      )
      .max(30)
      .default([]),
    documents: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: requiredText(120), required: z.boolean().default(false) })).max(15).default([]),
    application_fee: z.coerce.number().min(0).max(10_000_000).default(0),
    /** an online entrance test drawn from a question bank (auto-marked questions only) */
    entrance_test: z
      .object({ bank_id: id, count: z.coerce.number().int().min(1).max(100), minutes: z.coerce.number().int().min(5).max(300) })
      .nullable()
      .default(null),
    seats: z.coerce.number().int().min(1).max(100000).nullable().default(null),
    opens_at: dateTime,
    closes_at: dateTime,
    status: z.enum(['draft', 'open', 'closed']).default('draft'),
  })
  .refine((b) => b.fields.every((f) => f.type !== 'select' || (f.options && f.options.length)), { message: 'A list question needs options', path: ['fields'] })
  .refine((b) => !b.opens_at || !b.closes_at || b.opens_at < b.closes_at, { message: 'Closes before it opens', path: ['closes_at'] });

export const applicationSubmitBody = z.object({
  first_name: requiredText(80),
  last_name: text(80).default(''),
  dob: optionalDate,
  gender: z.enum(['Male', 'Female', 'Other']).nullable().optional(),
  email,
  phone: text(30).default(''),
  guardian_name: text(120).default(''),
  guardian_phone: text(30).default(''),
  guardian_email: z.union([email, z.literal('')]).default(''),
  guardian_relationship: z.enum(['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other']).default('guardian'),
  previous_school: text(200).default(''),
  data: z.record(z.string().max(40), z.union([z.string().max(2000), z.number()])).default({}),
  /** must stay empty: a field people can't see, which bots fill in */
  website: z.string().max(0, 'Leave this empty').optional(),
});

export const applicationUpdateBody = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  test_at: dateTime,
  test_venue: text(200).optional(),
  test_score: z.coerce.number().min(0).max(10000).nullable().optional(),
  test_max: z.coerce.number().min(0).max(10000).nullable().optional(),
  interview_score: z.coerce.number().min(0).max(100).nullable().optional(),
  offer_expires_at: dateTime,
  decision_note: text(1000).optional(),
});

export const meritBody = z.object({
  /** weights of test (as a percentage) and interview (0–100) */
  test_weight: z.coerce.number().min(0).max(1).default(0.7),
  interview_weight: z.coerce.number().min(0).max(1).default(0.3),
  offer: z.coerce.number().int().min(0).max(100000).default(0),
  waitlist: z.coerce.number().int().min(0).max(100000).default(0),
  offer_expires_at: dateTime,
  commit: z.boolean().default(false),
});

export const convertApplicationBody = z.object({ section_id: id, roll_no: text(30).nullable().optional(), admission_date: isoDate.optional() });

export const enquiryBody = z.object({
  name: requiredText(120),
  phone: text(30).default(''),
  email: z.union([email, z.literal('')]).default(''),
  student_name: text(120).default(''),
  source: z.enum(ENQUIRY_SOURCES).default('walk_in'),
  campus_id: optionalId,
  program_id: optionalId,
  program_level_id: optionalId,
  status: z.enum(ENQUIRY_STATUSES).default('new'),
  assigned_to: optionalId,
  next_follow_up_at: dateTime,
  notes: text(2000).default(''),
  lost_reason: text(300).default(''),
});

export const followupBody = z.object({
  channel: z.enum(FOLLOWUP_CHANNELS).default('phone'),
  note: requiredText(1000),
  outcome: text(200).default(''),
  next_at: dateTime,
  status: z.enum(ENQUIRY_STATUSES).optional(),
});
