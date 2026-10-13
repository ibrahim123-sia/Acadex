import { z } from 'zod';
import { AUDIENCES } from '../constants';
import { email, id, money, optionalDate, optionalId, requiredText, text } from './common';

const person = {
  first_name: requiredText(80),
  last_name: requiredText(80),
  email,
  gender: text(20)
    .optional()
    .transform((v) => v || null),
  dob: optionalDate,
};

export const createStudentBody = z.object({
  ...person,
  age: z
    .union([z.coerce.number().int().min(1).max(120), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : v)),
  class_id: optionalId,
  guardian_name: text(120).default(''),
  guardian_phone: text(30).default(''),
  city: text(80).default(''),
  roll_no: text(40)
    .optional()
    .transform((v) => v || null),
});

export const createTeacherBody = z.object({
  ...person,
  phone: text(30).default(''),
  cnic: text(30).default(''),
  qualification: text(120).default(''),
});

export const createClassBody = z.object({
  code: requiredText(20),
  name: requiredText(80),
  section: text(20)
    .optional()
    .transform((v) => v || 'A'),
});

export const collectFeeBody = z
  .object({ student_id: id, total_fee: money, paid_amount: money.default(0) })
  .refine((b) => b.paid_amount <= b.total_fee, {
    message: 'Paid amount cannot exceed the total fee',
    path: ['paid_amount'],
  });

export const announcementBody = z.object({
  title: requiredText(200),
  target_audience: z.enum(AUDIENCES).default('All'),
  description: requiredText(5000),
  end_date: optionalDate,
});

export const studentSearchQuery = z.object({ search: z.string().trim().max(100).default('') });

export type CreateStudentBody = z.input<typeof createStudentBody>;
export type CreateTeacherBody = z.input<typeof createTeacherBody>;
