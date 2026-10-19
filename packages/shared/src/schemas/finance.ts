import { z } from 'zod';
import { id, isoDate, money, optionalDate, optionalId, requiredText, text } from './common';

export const FEE_HEAD_FREQUENCIES = ['once', 'per_installment'] as const;
export const DISCOUNT_KINDS = ['discount', 'scholarship', 'sibling', 'waiver'] as const;
export const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'online', 'adjustment'] as const;
export const PAYMENT_PROVIDERS = ['stripe', 'jazzcash', 'easypaisa', 'bank', 'fake'] as const;
export const EXPENSE_METHODS = ['cash', 'bank', 'cheque', 'card', 'online'] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'] as const;

export const lateFineRule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('flat'), amount: money, grace_days: z.coerce.number().int().min(0).max(365).default(0) }),
  z.object({ kind: z.literal('per_day'), amount: money, grace_days: z.coerce.number().int().min(0).max(365).default(0), max: money.optional() }),
]);

export const feeStructureBody = z
  .object({
    name: requiredText(120),
    academic_year_id: optionalId,
    campus_id: optionalId,
    program_id: optionalId,
    program_level_id: optionalId,
    late_fine: lateFineRule.default({ kind: 'none' }),
    active: z.boolean().default(true),
    items: z
      .array(z.object({ head: requiredText(60), amount: money, frequency: z.enum(FEE_HEAD_FREQUENCIES).default('per_installment') }))
      .min(1, 'Add at least one fee head')
      .max(30),
    installments: z
      .array(z.object({ id: id.optional(), label: requiredText(60), due_date: isoDate, issue_date: optionalDate }))
      .min(1, 'Add at least one instalment')
      .max(24),
  })
  .refine((b) => new Set(b.items.map((i) => i.head.toLowerCase())).size === b.items.length, { message: 'Each fee head once', path: ['items'] });

export const generateInvoicesBody = z.object({
  installment_ids: z.array(id).max(24).optional(),
  student_ids: z.array(id).max(5000).optional(),
  issue_date: isoDate.optional(),
  /** false: only show what would be created */
  commit: z.boolean().default(false),
});

export const discountBody = z
  .object({
    name: requiredText(80),
    kind: z.enum(DISCOUNT_KINDS).default('discount'),
    method: z.enum(['percent', 'amount']).default('percent'),
    value: money,
    heads: z.array(requiredText(60)).max(30).default([]),
    sibling_from: z.coerce.number().int().min(2).max(10).nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine((b) => b.method !== 'percent' || b.value <= 100, { message: 'At most 100%', path: ['value'] })
  .refine((b) => b.kind !== 'sibling' || b.sibling_from, { message: 'Which child it starts from (2 = second child)', path: ['sibling_from'] });

export const studentDiscountBody = z.object({
  student_id: id,
  discount_id: id,
  reason: text(300).default(''),
  valid_from: optionalDate,
  valid_until: optionalDate,
});

export const invoiceLineBody = z.object({
  head: requiredText(60),
  label: requiredText(120),
  amount: z.coerce.number().min(-100_000_000).max(100_000_000),
  kind: z.enum(['fee', 'discount', 'scholarship', 'waiver', 'fine', 'adjustment']).default('fee'),
});

export const adhocInvoiceBody = z.object({
  student_ids: z.array(id).min(1).max(5000),
  title: requiredText(120),
  due_date: isoDate,
  lines: z.array(invoiceLineBody).min(1).max(30),
  notes: text(500).default(''),
});

export const invoiceQuery = z.object({
  status: z.enum([...INVOICE_STATUSES, 'unpaid', 'overdue']).optional(),
  student_id: optionalId,
  section_id: optionalId,
  campus_id: optionalId,
  structure_id: optionalId,
  q: text(100).optional(),
  from: optionalDate,
  to: optionalDate,
});

export const paymentBody = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  method: z.enum(['cash', 'bank', 'cheque', 'adjustment']).default('cash'),
  reference: text(120).default(''),
  received_at: optionalDate,
  notes: text(300).default(''),
});

export const refundBody = z.object({ amount: z.coerce.number().positive().max(100_000_000), reason: requiredText(300) });
export const waiverBody = z.object({ amount: z.coerce.number().positive().max(100_000_000), reason: requiredText(300) });
export const cancelInvoiceBody = z.object({ reason: requiredText(300) });

export const checkoutBody = z.object({ provider: z.enum(['stripe', 'jazzcash', 'easypaisa', 'fake']), amount: z.coerce.number().positive().max(100_000_000).optional() });

export const paymentAccountBody = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['sandbox', 'live']).default('sandbox'),
  public_config: z.record(z.string().max(40), text(200)).default({}),
  /** only the keys sent are changed; an empty string removes one */
  secrets: z.record(z.string().max(40), z.string().max(500)).default({}),
});

export const expenseBody = z.object({
  date: isoDate,
  category: requiredText(60),
  description: text(300).default(''),
  vendor: text(120).default(''),
  amount: z.coerce.number().positive().max(100_000_000),
  method: z.enum(EXPENSE_METHODS).default('cash'),
  reference: text(120).default(''),
  campus_id: optionalId,
  receipt_file_id: optionalId,
});

export const periodQuery = z.object({ from: isoDate, to: isoDate, campus_id: optionalId }).refine((q) => q.from <= q.to, { message: 'From must be before to', path: ['to'] });

export const reconcileBody = z.object({ provider: z.enum(PAYMENT_PROVIDERS), from: isoDate, to: isoDate });

/** Reminder channels (SMS was removed; a saved 'sms' is dropped rather than refused). */
const dropSms = (v: unknown) => (Array.isArray(v) ? v.filter((c) => c !== 'sms') : v);
const REMINDER_CHANNELS = z.enum(['in_app', 'email', 'whatsapp']);

export const reminderBody = z.object({
  invoice_ids: z.array(id).max(5000).optional(),
  channels: z.preprocess(dropSms, z.array(REMINDER_CHANNELS).min(1)).default(['in_app', 'email']),
});

export const feeSettingsBody = z.object({
  show_to_students: z.boolean().default(true),
  /** days before the due date to remind, and days after it (overdue) */
  remind_before_days: z.array(z.coerce.number().int().min(0).max(60)).max(5).default([3]),
  remind_after_days: z.array(z.coerce.number().int().min(1).max(120)).max(5).default([1, 7]),
  reminder_channels: z.preprocess(dropSms, z.array(REMINDER_CHANNELS)).default(['in_app', 'email']),
  voucher_note: text(500).default(''),
});
export type FeeSettings = z.infer<typeof feeSettingsBody>;
