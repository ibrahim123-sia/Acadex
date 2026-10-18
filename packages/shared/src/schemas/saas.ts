// The SaaS platform and the ecosystem (Phase 6): plans, billing, self-serve sign-up,
// white-label domains, data exports, the public API (keys, scopes, webhooks), LTI tools,
// consents and privacy requests, scheduled reports, the public site, and the optional
// institute modules.
import { z } from 'zod';
import { countryCode } from '../countries';
import { email, id, isoDate, optionalId, requiredText, text } from './common';

// ---------------------------------------------------------------- plans and billing

export const MODULES = ['library', 'hr', 'transport', 'hostel', 'inventory', 'visitors'] as const;
export type ModuleKey = (typeof MODULES)[number];
export const MODULE_LABELS: Record<ModuleKey, string> = {
  library: 'Library',
  hr: 'HR & payroll',
  transport: 'Transport',
  hostel: 'Hostel',
  inventory: 'Inventory & assets',
  visitors: 'Visitors & gate passes',
};

const amountByCurrency = z.record(z.string().regex(/^[A-Z]{3}$/), z.coerce.number().min(0).max(1_000_000));
export const planBody = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,30}$/, 'Lowercase letters, digits, - and _'),
  name: requiredText(60),
  description: text(400).default(''),
  prices: amountByCurrency.default({}),
  limits: z
    .object({
      students: z.number().int().min(0).nullable().default(null),
      staff: z.number().int().min(0).nullable().default(null),
      storage_mb: z.number().int().min(0).nullable().default(null),
      ai_usd: z.number().min(0).nullable().default(null),
      messages: z.number().int().min(0).nullable().default(null),
    })
    .default({ students: null, staff: null, storage_mb: null, ai_usd: null, messages: null }),
  features: z
    .object({
      modules: z.array(z.enum(MODULES)).default([]),
      api: z.boolean().default(false),
      sso: z.boolean().default(false),
      white_label: z.boolean().default(false),
      custom_domain: z.boolean().default(false),
      lti: z.boolean().default(false),
    })
    .default({ modules: [], api: false, sso: false, white_label: false, custom_domain: false, lti: false }),
  overage: amountByCurrency.default({}),
  trial_days: z.coerce.number().int().min(0).max(90).default(14),
  public: z.boolean().default(true),
  position: z.coerce.number().int().min(0).max(100).default(0),
});
export type PlanInput = z.infer<typeof planBody>;

export const markInvoicePaidBody = z.object({ method: z.enum(['bank', 'manual']), reference: text(200).default('') });
export const billingProfileBody = z.object({
  billing_email: email.or(z.literal('')).default(''),
  tax_id: text(60).default(''),
  billing_currency: z.string().regex(/^[A-Z]{3}$/).default('PKR'),
  address: text(400).default(''),
});
export const changePlanBody = z.object({ plan: z.string().trim().min(1).max(31) });

export const platformAnnouncementBody = z.object({
  title: requiredText(160),
  body: text(2000).default(''),
  level: z.enum(['info', 'warning', 'critical']).default('info'),
  plans: z.array(z.string().max(31)).nullable().default(null),
  ends_at: z.iso.datetime({ offset: true }).nullable().default(null),
});

export const tenantOverridesBody = z.object({
  /** extra features or modules beyond the plan, or switched off */
  features: z.record(z.string().max(40), z.boolean()).default({}),
  trial_ends_at: isoDate.nullable().optional(),
});

/** Self-serve sign-up from the public site (a trial of the chosen plan). */
export const signupBody = z.object({
  institution: requiredText(120),
  type: z.enum(['school', 'chain', 'college', 'university', 'academy', 'training_center']).default('school'),
  country: countryCode.default('PK'),
  name: requiredText(120),
  email,
  phone: text(30).default(''),
  plan: z.string().trim().max(31).default('pro'),
  accept_terms: z.literal(true, 'Please accept the terms'),
});

export const demoRequestBody = z.object({
  name: requiredText(120),
  email,
  phone: text(30).default(''),
  institution: requiredText(160),
  type: z.enum(['school', 'chain', 'college', 'university', 'academy', 'training_center']).default('school'),
  size: text(40).default(''),
  message: text(2000).default(''),
});

export const feedbackBody = z.object({ page: text(300).default(''), rating: z.coerce.number().int().min(1).max(5).nullable().default(null), message: requiredText(2000) });

// ---------------------------------------------------------------- white-label

export const brandingBody = z.object({
  logo_url: z.union([z.url().max(1000), z.literal('')]).default(''),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #2563EB'),
  /** the name shown on the installed app and in emails */
  app_name: text(40).default(''),
  email_footer: text(500).default(''),
});
export const customDomainBody = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'A domain like portal.school.edu.pk'),
});

// ---------------------------------------------------------------- public API

export const API_SCOPES = [
  'students:read',
  'staff:read',
  'courses:read',
  'enrollments:read',
  'attendance:read',
  'grades:read',
  'fees:read',
  'payments:read',
  'webhooks:manage',
] as const;
export const WEBHOOK_EVENTS = ['student.created', 'student.enrolled', 'grade.released', 'payment.received', 'attendance.marked', 'application.submitted', 'invoice.issued'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const apiKeyBody = z.object({
  name: requiredText(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  expires_on: isoDate.nullable().default(null),
});
export const webhookBody = z.object({
  url: z.url().max(1000).refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), 'Use an https:// address'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  enabled: z.boolean().default(true),
});

export const ltiToolBody = z.object({
  name: requiredText(120),
  client_id: requiredText(200),
  login_url: z.url().max(1000),
  launch_url: z.url().max(1000),
  jwks_url: z.union([z.url().max(1000), z.literal('')]).default(''),
  deployment_id: requiredText(200),
  send_pii: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

// ---------------------------------------------------------------- privacy

export const CONSENT_KINDS = ['data_processing', 'photos', 'ai_features', 'messaging', 'marketing'] as const;
export const consentBody = z.object({ kind: z.enum(CONSENT_KINDS), granted: z.boolean(), student_id: optionalId });
export const privacyRequestBody = z.object({ kind: z.enum(['access', 'correction', 'deletion']), details: text(2000).default('') });
export const privacyDecisionBody = z.object({ status: z.enum(['done', 'rejected']), response: text(2000).default('') });
export const retentionBody = z.object({
  /** months to keep: null keeps for ever */
  messages_months: z.number().int().min(1).max(240).nullable().default(null),
  ai_conversations_months: z.number().int().min(1).max(240).nullable().default(null),
  audit_months: z.number().int().min(12).max(240).nullable().default(null),
  visitor_logs_months: z.number().int().min(1).max(240).nullable().default(null),
  /** allow the Acadex support team to sign in as an administrator, to help */
  support_access: z.boolean().default(false),
});

// ---------------------------------------------------------------- reports

export const REPORTS = ['attendance', 'results', 'fee_collection', 'defaulters', 'teacher_workload', 'course_engagement', 'obe_attainment', 'admissions_funnel'] as const;
export type ReportKey = (typeof REPORTS)[number];
export const reportFilters = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  campus_id: optionalId,
  section_id: optionalId,
  offering_id: optionalId,
  series_id: optionalId,
});
export const reportScheduleBody = z.object({
  report: z.enum(REPORTS),
  filters: reportFilters.prefault({}),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  recipients: z.array(email).min(1).max(20),
  enabled: z.boolean().default(true),
});

// ---------------------------------------------------------------- modules

export const modulesBody = z.object({ modules: z.partialRecord(z.enum(MODULES), z.boolean()) });

export const bookBody = z.object({
  title: requiredText(300),
  authors: text(300).default(''),
  isbn: text(20).default(''),
  publisher: text(200).default(''),
  year: z.coerce.number().int().min(1000).max(2100).nullable().default(null),
  category: text(100).default(''),
  language: text(40).default(''),
  shelf: text(40).default(''),
  /** barcodes of the copies to add */
  copies: z.array(z.string().trim().min(1).max(60)).max(200).default([]),
});
export const issueBody = z.object({ barcode: requiredText(60), borrower_id: id, due_on: isoDate.optional() });
export const returnBody = z.object({ barcode: requiredText(60), lost: z.boolean().default(false) });
export const librarySettingsBody = z.object({
  loan_days: z.coerce.number().int().min(1).max(120).default(14),
  fine_per_day: z.coerce.number().min(0).max(10000).default(10),
  max_loans: z.coerce.number().int().min(1).max(50).default(3),
});

export const SALARY_CALC = ['fixed', 'percent_of_basic'] as const;
export const salaryStructureBody = z.object({
  name: requiredText(100),
  components: z
    .array(z.object({ name: requiredText(60), kind: z.enum(['earning', 'deduction']), calc: z.enum(SALARY_CALC), value: z.coerce.number().min(0).max(10_000_000) }))
    .max(30)
    .default([]),
});
export const staffSalaryBody = z.object({
  teacher_id: id,
  structure_id: optionalId,
  basic: z.coerce.number().min(0).max(100_000_000),
  bank_account: text(60).default(''),
  effective_from: isoDate,
});
export const payrollRunBody = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month like 2026-10') });
export const STAFF_LEAVE_KINDS = ['casual', 'sick', 'annual', 'maternity', 'unpaid', 'other'] as const;
export const staffLeaveBody = z
  .object({ kind: z.enum(STAFF_LEAVE_KINDS), from_date: isoDate, to_date: isoDate, reason: text(500).default(''), teacher_id: optionalId })
  .refine((v) => v.to_date >= v.from_date, { message: 'The end date is before the start date', path: ['to_date'] });
export const hrSettingsBody = z.object({
  /** days of each paid leave kind per year */
  leave_entitlements: z.partialRecord(z.enum(STAFF_LEAVE_KINDS), z.coerce.number().min(0).max(365)).default({ casual: 10, sick: 8, annual: 14 }),
  working_days_per_month: z.coerce.number().int().min(20).max(31).default(26),
});

export const vehicleBody = z.object({ registration: requiredText(30), capacity: z.coerce.number().int().min(1).max(200).default(30), driver_name: text(100).default(''), driver_phone: text(30).default('') });
export const routeBody = z.object({
  name: requiredText(100),
  vehicle_id: optionalId,
  fee: z.coerce.number().min(0).max(10_000_000).default(0),
  stops: z.array(z.object({ name: requiredText(100), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal('')).default('') })).max(60).default([]),
});
export const transportAssignBody = z.object({ student_id: id, route_id: id, stop: text(100).default(''), from_date: isoDate });
export const hostelRoomBody = z.object({ hostel: requiredText(100), name: requiredText(60), capacity: z.coerce.number().int().min(1).max(50).default(2), fee: z.coerce.number().min(0).max(10_000_000).default(0) });
export const allocationBody = z.object({ room_id: id, student_id: id, from_date: isoDate });
export const billModuleBody = z.object({ kind: z.enum(['transport', 'hostel']), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), due_date: isoDate });
export const inventoryItemBody = z.object({
  name: requiredText(200),
  sku: text(60).default(''),
  category: text(100).default(''),
  unit: text(20).default('pcs'),
  quantity: z.coerce.number().min(0).max(10_000_000).default(0),
  reorder_level: z.coerce.number().min(0).max(10_000_000).default(0),
  location: text(100).default(''),
  is_asset: z.boolean().default(false),
  asset_tag: text(60).nullable().default(null),
  assigned_to: optionalId,
  condition: z.enum(['good', 'needs_repair', 'broken', 'disposed']).default('good'),
});
export const stockMoveBody = z.object({ change: z.coerce.number().min(-10_000_000).max(10_000_000).refine((n) => n !== 0, 'Not zero'), reason: text(200).default('') });
export const roomBookingBody = z.object({
  room_id: id,
  title: requiredText(160),
  purpose: text(500).default(''),
  starts_at: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  ends_at: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

export const visitorBody = z.object({
  name: requiredText(120),
  phone: text(30).default(''),
  purpose: requiredText(200),
  host_user_id: optionalId,
  student_id: optionalId,
  campus_id: optionalId,
});
