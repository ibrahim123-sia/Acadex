// Optional institute modules (Phase 6), each switched on per institution: Library (catalogue,
// copies with barcodes, loans, fines), HR & payroll (salary structures, payroll runs,
// payslips, staff leave and balances), Transport (vehicles, routes, stops, assignments),
// Hostel (rooms, allocations), Inventory & assets, and the visitor log / gate passes.
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { campuses, students, teachers } from './academics';
import { institutions, users } from './core';
import { invoices } from './finance';

const created = { createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() };
const tenant = (name: string, t: { institutionId: never }) =>
  foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: `${name}_institution_id_fkey` }).onDelete('cascade');

// ---------------------------------------------------------------- library

export const libraryBooks = pgTable(
  'library_books',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    title: text('title').notNull(),
    authors: text('authors').notNull().default(''),
    isbn: text('isbn').notNull().default(''),
    publisher: text('publisher').notNull().default(''),
    year: integer('year'),
    category: text('category').notNull().default(''),
    language: text('language').notNull().default(''),
    shelf: text('shelf').notNull().default(''),
    ...created,
  },
  (t) => [index('idx_library_books_institution').on(t.institutionId), tenant('library_books', t as never)]
);

export const libraryCopies = pgTable(
  'library_copies',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    bookId: integer('book_id').notNull(),
    barcode: text('barcode').notNull(),
    status: text('status').notNull().default('available'),
    acquiredOn: date('acquired_on'),
    price: numeric('price', { precision: 12, scale: 2 }),
    ...created,
  },
  (t) => [
    unique('library_copies_institution_id_barcode_key').on(t.institutionId, t.barcode),
    tenant('library_copies', t as never),
    foreignKey({ columns: [t.bookId], foreignColumns: [libraryBooks.id], name: 'library_copies_book_id_fkey' }).onDelete('cascade'),
    check('library_copies_status_check', sql`${t.status} IN ('available', 'issued', 'lost', 'withdrawn')`),
  ]
);

export const libraryLoans = pgTable(
  'library_loans',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    copyId: integer('copy_id').notNull(),
    borrowerId: integer('borrower_id').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    dueOn: date('due_on').notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    renewals: integer('renewals').notNull().default(0),
    fine: numeric('fine', { precision: 12, scale: 2 }).notNull().default('0'),
    finePaid: boolean('fine_paid').notNull().default(false),
    issuedBy: integer('issued_by'),
  },
  (t) => [
    index('idx_library_loans_borrower').on(t.borrowerId),
    // a copy is out to one person at a time
    uniqueIndex('library_loans_one_open_per_copy').on(t.copyId).where(sql`${t.returnedAt} IS NULL`),
    tenant('library_loans', t as never),
    foreignKey({ columns: [t.copyId], foreignColumns: [libraryCopies.id], name: 'library_loans_copy_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.borrowerId], foreignColumns: [users.id], name: 'library_loans_borrower_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.issuedBy], foreignColumns: [users.id], name: 'library_loans_issued_by_fkey' }).onDelete('set null'),
  ]
);

// ---------------------------------------------------------------- HR and payroll

/** Earnings and deductions on top of the basic salary: [{ name, kind, calc, value }]. */
export const salaryStructures = pgTable(
  'salary_structures',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    components: jsonb('components').notNull().default(sql`'[]'::jsonb`),
    ...created,
  },
  (t) => [tenant('salary_structures', t as never)]
);

export const staffSalaries = pgTable(
  'staff_salaries',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    structureId: integer('structure_id'),
    basic: numeric('basic', { precision: 12, scale: 2 }).notNull(),
    bankAccount: text('bank_account').notNull().default(''),
    effectiveFrom: date('effective_from').notNull(),
    ...created,
  },
  (t) => [
    unique('staff_salaries_teacher_id_effective_from_key').on(t.teacherId, t.effectiveFrom),
    tenant('staff_salaries', t as never),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'staff_salaries_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.structureId], foreignColumns: [salaryStructures.id], name: 'staff_salaries_structure_id_fkey' }).onDelete('set null'),
  ]
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** YYYY-MM */
    month: text('month').notNull(),
    status: text('status').notNull().default('draft'),
    totalGross: numeric('total_gross', { precision: 14, scale: 2 }).notNull().default('0'),
    totalNet: numeric('total_net', { precision: 14, scale: 2 }).notNull().default('0'),
    createdBy: integer('created_by'),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    unique('payroll_runs_institution_id_month_key').on(t.institutionId, t.month),
    tenant('payroll_runs', t as never),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'payroll_runs_created_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.approvedBy], foreignColumns: [users.id], name: 'payroll_runs_approved_by_fkey' }).onDelete('set null'),
    check('payroll_runs_status_check', sql`${t.status} IN ('draft', 'approved', 'paid')`),
    check('payroll_runs_month_check', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ]
);

export const payslips = pgTable(
  'payslips',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    runId: integer('run_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    basic: numeric('basic', { precision: 12, scale: 2 }).notNull(),
    /** [{ name, amount }] */
    earnings: jsonb('earnings').notNull().default(sql`'[]'::jsonb`),
    deductions: jsonb('deductions').notNull().default(sql`'[]'::jsonb`),
    unpaidDays: numeric('unpaid_days', { precision: 5, scale: 1 }).notNull().default('0'),
    gross: numeric('gross', { precision: 12, scale: 2 }).notNull(),
    net: numeric('net', { precision: 12, scale: 2 }).notNull(),
    ...created,
  },
  (t) => [
    unique('payslips_run_id_teacher_id_key').on(t.runId, t.teacherId),
    tenant('payslips', t as never),
    foreignKey({ columns: [t.runId], foreignColumns: [payrollRuns.id], name: 'payslips_run_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'payslips_teacher_id_fkey' }).onDelete('cascade'),
  ]
);

export const staffLeaves = pgTable(
  'staff_leaves',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    teacherId: integer('teacher_id').notNull(),
    kind: text('kind').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    days: numeric('days', { precision: 5, scale: 1 }).notNull(),
    reason: text('reason').notNull().default(''),
    status: text('status').notNull().default('pending'),
    decidedBy: integer('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...created,
  },
  (t) => [
    index('idx_staff_leaves_teacher').on(t.teacherId, t.fromDate),
    tenant('staff_leaves', t as never),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'staff_leaves_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.decidedBy], foreignColumns: [users.id], name: 'staff_leaves_decided_by_fkey' }).onDelete('set null'),
    check('staff_leaves_kind_check', sql`${t.kind} IN ('casual', 'sick', 'annual', 'maternity', 'unpaid', 'other')`),
    check('staff_leaves_status_check', sql`${t.status} IN ('pending', 'approved', 'rejected', 'cancelled')`),
    check('staff_leaves_dates_check', sql`${t.toDate} >= ${t.fromDate}`),
  ]
);

// ---------------------------------------------------------------- transport

export const vehicles = pgTable(
  'vehicles',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    registration: text('registration').notNull(),
    capacity: integer('capacity').notNull().default(30),
    driverName: text('driver_name').notNull().default(''),
    driverPhone: text('driver_phone').notNull().default(''),
    ...created,
  },
  (t) => [unique('vehicles_institution_id_registration_key').on(t.institutionId, t.registration), tenant('vehicles', t as never)]
);

export const transportRoutes = pgTable(
  'transport_routes',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    vehicleId: integer('vehicle_id'),
    /** monthly fee */
    fee: numeric('fee', { precision: 12, scale: 2 }).notNull().default('0'),
    /** [{ name, time }] in order */
    stops: jsonb('stops').notNull().default(sql`'[]'::jsonb`),
    ...created,
  },
  (t) => [
    tenant('transport_routes', t as never),
    foreignKey({ columns: [t.vehicleId], foreignColumns: [vehicles.id], name: 'transport_routes_vehicle_id_fkey' }).onDelete('set null'),
  ]
);

export const transportAssignments = pgTable(
  'transport_assignments',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    routeId: integer('route_id').notNull(),
    stop: text('stop').notNull().default(''),
    fromDate: date('from_date').notNull(),
    ...created,
  },
  (t) => [
    unique('transport_assignments_student_id_key').on(t.studentId),
    tenant('transport_assignments', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'transport_assignments_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.routeId], foreignColumns: [transportRoutes.id], name: 'transport_assignments_route_id_fkey' }).onDelete('cascade'),
  ]
);

// ---------------------------------------------------------------- hostel

export const hostelRooms = pgTable(
  'hostel_rooms',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    hostel: text('hostel').notNull(),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull().default(2),
    /** monthly fee per bed */
    fee: numeric('fee', { precision: 12, scale: 2 }).notNull().default('0'),
    ...created,
  },
  (t) => [unique('hostel_rooms_institution_id_hostel_name_key').on(t.institutionId, t.hostel, t.name), tenant('hostel_rooms', t as never)]
);

export const hostelAllocations = pgTable(
  'hostel_allocations',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    roomId: integer('room_id').notNull(),
    studentId: integer('student_id').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date'),
    ...created,
  },
  (t) => [
    uniqueIndex('hostel_allocations_one_current').on(t.studentId).where(sql`${t.toDate} IS NULL`),
    tenant('hostel_allocations', t as never),
    foreignKey({ columns: [t.roomId], foreignColumns: [hostelRooms.id], name: 'hostel_allocations_room_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'hostel_allocations_student_id_fkey' }).onDelete('cascade'),
  ]
);

/** Transport / hostel charges added to invoices, once per student, kind and month. */
export const moduleCharges = pgTable(
  'module_charges',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    studentId: integer('student_id').notNull(),
    kind: text('kind').notNull(),
    month: text('month').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    invoiceId: integer('invoice_id'),
    ...created,
  },
  (t) => [
    unique('module_charges_student_id_kind_month_key').on(t.studentId, t.kind, t.month),
    tenant('module_charges', t as never),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'module_charges_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], name: 'module_charges_invoice_id_fkey' }).onDelete('set null'),
    check('module_charges_kind_check', sql`${t.kind} IN ('transport', 'hostel')`),
  ]
);

// ---------------------------------------------------------------- inventory and assets

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    name: text('name').notNull(),
    sku: text('sku').notNull().default(''),
    category: text('category').notNull().default(''),
    unit: text('unit').notNull().default('pcs'),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull().default('0'),
    reorderLevel: numeric('reorder_level', { precision: 12, scale: 2 }).notNull().default('0'),
    location: text('location').notNull().default(''),
    /** an asset is tracked one by one (tag, who has it) instead of by quantity */
    isAsset: boolean('is_asset').notNull().default(false),
    assetTag: text('asset_tag'),
    assignedTo: integer('assigned_to'),
    condition: text('condition').notNull().default('good'),
    ...created,
  },
  (t) => [
    tenant('inventory_items', t as never),
    foreignKey({ columns: [t.assignedTo], foreignColumns: [users.id], name: 'inventory_items_assigned_to_fkey' }).onDelete('set null'),
    check('inventory_items_condition_check', sql`${t.condition} IN ('good', 'needs_repair', 'broken', 'disposed')`),
  ]
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    itemId: integer('item_id').notNull(),
    change: numeric('change', { precision: 12, scale: 2 }).notNull(),
    reason: text('reason').notNull().default(''),
    byUser: integer('by_user'),
    ...created,
  },
  (t) => [
    index('idx_stock_movements_item').on(t.itemId),
    tenant('stock_movements', t as never),
    foreignKey({ columns: [t.itemId], foreignColumns: [inventoryItems.id], name: 'stock_movements_item_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.byUser], foreignColumns: [users.id], name: 'stock_movements_by_user_fkey' }).onDelete('set null'),
  ]
);

// ---------------------------------------------------------------- visitors

export const visitorLogs = pgTable(
  'visitor_logs',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    campusId: integer('campus_id'),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    purpose: text('purpose').notNull(),
    hostUserId: integer('host_user_id'),
    /** collecting a student */
    studentId: integer('student_id'),
    passCode: text('pass_code').notNull(),
    checkIn: timestamp('check_in', { withTimezone: true }).defaultNow().notNull(),
    checkOut: timestamp('check_out', { withTimezone: true }),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_visitor_logs_day').on(t.institutionId, t.checkIn),
    tenant('visitor_logs', t as never),
    foreignKey({ columns: [t.campusId], foreignColumns: [campuses.id], name: 'visitor_logs_campus_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.hostUserId], foreignColumns: [users.id], name: 'visitor_logs_host_user_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'visitor_logs_student_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'visitor_logs_created_by_fkey' }).onDelete('set null'),
  ]
);
