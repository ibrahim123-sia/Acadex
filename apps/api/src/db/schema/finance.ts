// Fees and finance: fee structures with items and instalments, discounts and scholarships,
// invoices with their lines, payments (cash, bank, online), refunds, online checkout sessions
// and provider webhook events (idempotent), reconciliation, and expenses.
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { files, institutions, users } from './core';
import { academicYears, campuses, programLevels, programs, students } from './academics';
import { applications } from './admissions';

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

/** What a group of students pays in a year: items and when they are due. */
export const feeStructures = pgTable(
  'fee_structures',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    academicYearId: integer('academic_year_id'),
    /** who it applies to: any of these may be empty (= all) */
    campusId: integer('campus_id'),
    programId: integer('program_id'),
    programLevelId: integer('program_level_id'),
    /** late fine: { kind: none | per_day | flat, amount, grace_days, max } */
    lateFine: jsonb('late_fine').notNull().default(sql`'{"kind":"none"}'::jsonb`),
    active: boolean('active').notNull().default(true),
    ...created,
  },
  (t) => [
    tenant('fee_structures', t as never),
    foreignKey({ columns: [t.academicYearId], foreignColumns: [academicYears.id], name: 'fee_structures_academic_year_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'fee_structures_campus_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.programId], foreignColumns: [programs.id], name: 'fee_structures_program_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.programLevelId], foreignColumns: [programLevels.id], name: 'fee_structures_program_level_id_fkey' }).onDelete('cascade'),
  ]
);

export const feeStructureItems = pgTable(
  'fee_structure_items',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    structureId: integer('structure_id').notNull(),
    /** e.g. Tuition, Admission, Exam, Transport */
    head: text('head').notNull(),
    amount: money('amount').notNull(),
    /** once (first instalment only) or spread over every instalment */
    frequency: text('frequency').notNull().default('per_installment'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    tenant('fee_structure_items', t as never),
    foreignKey({ columns: [t.structureId], foreignColumns: [feeStructures.id], name: 'fee_structure_items_structure_id_fkey' }).onDelete('cascade'),
    check('fee_structure_items_frequency_check', sql`${t.frequency} IN ('once', 'per_installment')`),
    check('fee_structure_items_amount_check', sql`${t.amount} >= 0`),
  ]
);

export const feeInstallments = pgTable(
  'fee_installments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    structureId: integer('structure_id').notNull(),
    label: text('label').notNull(),
    dueDate: date('due_date').notNull(),
    issueDate: date('issue_date'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    tenant('fee_installments', t as never),
    foreignKey({ columns: [t.structureId], foreignColumns: [feeStructures.id], name: 'fee_installments_structure_id_fkey' }).onDelete('cascade'),
  ]
);

/** A discount or scholarship definition (percent or fixed amount). */
export const discounts = pgTable(
  'discounts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('discount'),
    /** percent of the heads it applies to, or a fixed amount per invoice */
    method: text('method').notNull().default('percent'),
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    /** empty = every head */
    heads: text('heads').array().notNull().default(sql`ARRAY[]::text[]`),
    /** sibling discount: applies to the n-th and later enrolled child of the same guardian */
    siblingFrom: integer('sibling_from'),
    active: boolean('active').notNull().default(true),
    ...created,
  },
  (t) => [
    tenant('discounts', t as never),
    check('discounts_kind_check', sql`${t.kind} IN ('discount', 'scholarship', 'sibling', 'waiver')`),
    check('discounts_method_check', sql`${t.method} IN ('percent', 'amount')`),
    check('discounts_value_check', sql`${t.value} >= 0`),
  ]
);

export const studentDiscounts = pgTable(
  'student_discounts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    discountId: integer('discount_id').notNull(),
    reason: text('reason').notNull().default(''),
    validFrom: date('valid_from'),
    validUntil: date('valid_until'),
    approvedBy: integer('approved_by'),
    ...created,
  },
  (t) => [
    tenant('student_discounts', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'student_discounts_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.discountId], foreignColumns: [discounts.id], name: 'student_discounts_discount_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.approvedBy], foreignColumns: [users.id], name: 'student_discounts_approved_by_fkey' }).onDelete('set null'),
    unique('student_discounts_student_id_discount_id_key').on(t.studentId, t.discountId),
  ]
);

/** A bill: for a student, or for an applicant (application fee). */
export const invoices = pgTable(
  'invoices',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    number: text('number').notNull(),
    studentId: integer('student_id'),
    applicationId: integer('application_id'),
    structureId: integer('structure_id'),
    installmentId: integer('installment_id'),
    title: text('title').notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    status: text('status').notNull().default('issued'),
    currency: text('currency').notNull(),
    total: money('total').notNull().default('0'),
    paid: money('paid').notNull().default('0'),
    /** a secret for the payer's own pay link (applicants have no account) */
    payToken: text('pay_token'),
    notes: text('notes').notNull().default(''),
    createdBy: integer('created_by'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_invoices_student').on(t.studentId),
    index('idx_invoices_due').on(t.institutionId, t.status, t.dueDate),
    tenant('invoices', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'invoices_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.applicationId], foreignColumns: [applications.id], name: 'invoices_application_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.structureId], foreignColumns: [feeStructures.id], name: 'invoices_structure_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.installmentId], foreignColumns: [feeInstallments.id], name: 'invoices_installment_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'invoices_created_by_fkey' }).onDelete('set null'),
    unique('invoices_institution_id_number_key').on(t.institutionId, t.number),
    unique('invoices_pay_token_key').on(t.payToken),
    // one invoice per student and instalment
    unique('invoices_student_id_installment_id_key').on(t.studentId, t.installmentId),
    check('invoices_owner_check', sql`(${t.studentId} IS NULL) <> (${t.applicationId} IS NULL)`),
    check('invoices_status_check', sql`${t.status} IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled')`),
  ]
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    kind: text('kind').notNull().default('fee'),
    head: text('head').notNull(),
    label: text('label').notNull(),
    /** negative for discounts, scholarships and waivers */
    amount: money('amount').notNull(),
    discountId: integer('discount_id'),
    /** late fines: the day it was charged for, so a fine is never charged twice */
    fineDate: date('fine_date'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    index('idx_invoice_items_invoice').on(t.invoiceId),
    tenant('invoice_items', t as never),
    foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], name: 'invoice_items_invoice_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.discountId], foreignColumns: [discounts.id], name: 'invoice_items_discount_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'invoice_items_created_by_fkey' }).onDelete('set null'),
    unique('invoice_items_invoice_id_fine_date_key').on(t.invoiceId, t.fineDate),
    check('invoice_items_kind_check', sql`${t.kind} IN ('fee', 'discount', 'scholarship', 'waiver', 'fine', 'adjustment')`),
  ]
);

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    studentId: integer('student_id'),
    receiptNo: text('receipt_no').notNull(),
    amount: money('amount').notNull(),
    method: text('method').notNull(),
    provider: text('provider'),
    /** the provider's (or bank's) reference — matched in reconciliation */
    providerRef: text('provider_ref'),
    status: text('status').notNull().default('succeeded'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    receivedBy: integer('received_by'),
    notes: text('notes').notNull().default(''),
    /** settled by the provider and matched in a reconciliation */
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    index('idx_payments_invoice').on(t.invoiceId),
    index('idx_payments_received').on(t.institutionId, t.receivedAt),
    tenant('payments', t as never),
    foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], name: 'payments_invoice_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'payments_student_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.receivedBy], foreignColumns: [users.id], name: 'payments_received_by_fkey' }).onDelete('set null'),
    unique('payments_institution_id_receipt_no_key').on(t.institutionId, t.receiptNo),
    unique('payments_provider_provider_ref_key').on(t.provider, t.providerRef),
    check('payments_method_check', sql`${t.method} IN ('cash', 'bank', 'cheque', 'online', 'adjustment')`),
    check('payments_status_check', sql`${t.status} IN ('succeeded', 'refunded', 'partially_refunded')`),
    check('payments_amount_check', sql`${t.amount} > 0`),
  ]
);

export const refunds = pgTable(
  'refunds',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    paymentId: integer('payment_id').notNull(),
    amount: money('amount').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('completed'),
    providerRef: text('provider_ref'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('refunds', t as never),
    foreignKey({ columns: [t.paymentId], foreignColumns: [payments.id], name: 'refunds_payment_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'refunds_created_by_fkey' }).onDelete('set null'),
    check('refunds_status_check', sql`${t.status} IN ('pending', 'completed', 'failed')`),
    check('refunds_amount_check', sql`${t.amount} > 0`),
  ]
);

/** An online payment in progress: created when the payer clicks Pay. */
export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    provider: text('provider').notNull(),
    /** our reference sent to the provider (order id) */
    reference: text('reference').notNull(),
    providerSessionId: text('provider_session_id'),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('pending'),
    returnUrl: text('return_url').notNull().default(''),
    paymentId: integer('payment_id'),
    ...created,
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    tenant('checkout_sessions', t as never),
    foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], name: 'checkout_sessions_invoice_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.paymentId], foreignColumns: [payments.id], name: 'checkout_sessions_payment_id_fkey' }).onDelete('set null'),
    unique('checkout_sessions_reference_key').on(t.reference),
    check('checkout_sessions_status_check', sql`${t.status} IN ('pending', 'succeeded', 'failed', 'expired')`),
  ]
);

/** Every webhook / callback a provider sent, once per provider event id (idempotency). */
export const paymentProviderEvents = pgTable(
  'payment_provider_events',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id'),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    result: text('result').notNull().default('received'),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'payment_provider_events_institution_id_fkey' }).onDelete('cascade'),
    unique('payment_provider_events_provider_event_id_key').on(t.provider, t.eventId),
  ]
);

/** A reconciliation run: what the provider (or bank statement) settled vs what we recorded. */
export const reconciliations = pgTable(
  'reconciliations',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    provider: text('provider').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    /** { matched, missing_in_acadex, missing_at_provider, amount_mismatch } with the rows */
    summary: jsonb('summary').notNull(),
    statementFileId: integer('statement_file_id'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    tenant('reconciliations', t as never),
    foreignKey({ columns: [t.statementFileId], foreignColumns: [files.id], name: 'reconciliations_statement_file_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'reconciliations_created_by_fkey' }).onDelete('set null'),
  ]
);

export const expenses = pgTable(
  'expenses',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    campusId: integer('campus_id'),
    date: date('date').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull().default(''),
    vendor: text('vendor').notNull().default(''),
    amount: money('amount').notNull(),
    method: text('method').notNull().default('cash'),
    reference: text('reference').notNull().default(''),
    receiptFileId: integer('receipt_file_id'),
    createdBy: integer('created_by'),
    ...created,
  },
  (t) => [
    index('idx_expenses_date').on(t.institutionId, t.date),
    tenant('expenses', t as never),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'expenses_campus_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.receiptFileId], foreignColumns: [files.id], name: 'expenses_receipt_file_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'expenses_created_by_fkey' }).onDelete('set null'),
    check('expenses_amount_check', sql`${t.amount} > 0`),
    check('expenses_method_check', sql`${t.method} IN ('cash', 'bank', 'cheque', 'card', 'online')`),
  ]
);

/**
 * An institution's account with a payment provider (its own merchant account): public
 * settings (bank details shown on vouchers, sandbox or live) and the secrets, encrypted.
 */
export const paymentAccounts = pgTable(
  'payment_accounts',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    provider: text('provider').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    mode: text('mode').notNull().default('sandbox'),
    /** shown to payers (bank name, account title, IBAN, branch; merchant name) */
    publicConfig: jsonb('public_config').notNull().default(sql`'{}'::jsonb`),
    /** AES-256-GCM sealed JSON of the provider's keys; never returned by the API */
    secretSealed: text('secret_sealed'),
    updatedBy: integer('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('payment_accounts', t as never),
    foreignKey({ columns: [t.updatedBy], foreignColumns: [users.id], name: 'payment_accounts_updated_by_fkey' }).onDelete('set null'),
    unique('payment_accounts_institution_id_provider_key').on(t.institutionId, t.provider),
    check('payment_accounts_provider_check', sql`${t.provider} IN ('stripe', 'jazzcash', 'easypaisa', 'bank', 'fake')`),
    check('payment_accounts_mode_check', sql`${t.mode} IN ('sandbox', 'live')`),
  ]
);

/** Reminders already sent for an invoice (once per step and channel: "before:3:sms"). */
export const invoiceReminders = pgTable(
  'invoice_reminders',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    key: text('key').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    tenant('invoice_reminders', t as never),
    foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], name: 'invoice_reminders_invoice_id_fkey' }).onDelete('cascade'),
    unique('invoice_reminders_invoice_id_key_key').on(t.invoiceId, t.key),
  ]
);
