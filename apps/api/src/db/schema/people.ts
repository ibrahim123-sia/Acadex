// People records around students and staff: guardians, medical notes (restricted), custom
// fields, documents, ID cards, issued certificates and bulk imports.
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { files, institutions, users } from './core';
import { students, teachers } from './academics';

export const guardians = pgTable(
  'guardians',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    /** set once the guardian has an account (parent portal) */
    userId: integer('user_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull().default(''),
    email: text('email').notNull().default(''),
    phone: text('phone').notNull().default(''),
    nationalId: text('national_id').notNull().default(''),
    occupation: text('occupation').notNull().default(''),
    address: text('address').notNull().default(''),
    customData: jsonb('custom_data').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
  },
  (t) => [
    index('idx_guardians_institution').on(t.institutionId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'guardians_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'guardians_user_id_fkey' }).onDelete('set null'),
    unique('guardians_user_id_key').on(t.userId),
  ]
);

/** Medical and emergency information — only visible with students.medical.read. */
export const studentMedical = pgTable(
  'student_medical',
  {
    studentId: integer('student_id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    bloodGroup: text('blood_group').notNull().default(''),
    conditions: text('conditions').notNull().default(''),
    allergies: text('allergies').notNull().default(''),
    medications: text('medications').notNull().default(''),
    emergencyContactName: text('emergency_contact_name').notNull().default(''),
    emergencyContactPhone: text('emergency_contact_phone').notNull().default(''),
    notes: text('notes').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedBy: integer('updated_by'),
  },
  (t) => [
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'student_medical_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'student_medical_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.updatedBy], foreignColumns: [users.id], name: 'student_medical_updated_by_fkey' }).onDelete('set null'),
  ]
);

/** Institution-defined extra fields; values live in <entity>.custom_data. */
export const customFields = pgTable(
  'custom_fields',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull().default('text'),
    options: jsonb('options').notNull().default(sql`'[]'::jsonb`),
    required: boolean('required').notNull().default(false),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'custom_fields_institution_id_fkey' }).onDelete('cascade'),
    unique('custom_fields_institution_id_entity_key_key').on(t.institutionId, t.entity, t.key),
    check('custom_fields_entity_check', sql`${t.entity} IN ('student', 'staff', 'guardian')`),
    check('custom_fields_field_type_check', sql`${t.fieldType} IN ('text', 'number', 'date', 'select', 'checkbox')`),
  ]
);

/** Documents kept on a person's file (birth certificate, previous results, CV, …). */
export const personDocuments = pgTable(
  'person_documents',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: integer('owner_id').notNull(),
    fileId: integer('file_id').notNull(),
    category: text('category').notNull().default('other'),
    title: text('title').notNull(),
    uploadedBy: integer('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
  },
  (t) => [
    index('idx_person_documents_owner').on(t.ownerType, t.ownerId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'person_documents_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.fileId], foreignColumns: [files.id], name: 'person_documents_file_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.uploadedBy], foreignColumns: [users.id], name: 'person_documents_uploaded_by_fkey' }).onDelete('set null'),
    check('person_documents_owner_type_check', sql`${t.ownerType} IN ('student', 'staff', 'guardian')`),
  ]
);

export const idCards = pgTable(
  'id_cards',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    holderType: text('holder_type').notNull(),
    holderId: integer('holder_id').notNull(),
    /** printed in the QR code; looked up by the public verification page */
    verifyCode: text('verify_code').notNull(),
    validUntil: date('valid_until').notNull(),
    issuedBy: integer('issued_by'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_id_cards_holder').on(t.holderType, t.holderId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'id_cards_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.issuedBy], foreignColumns: [users.id], name: 'id_cards_issued_by_fkey' }).onDelete('set null'),
    unique('id_cards_verify_code_key').on(t.verifyCode),
    check('id_cards_holder_type_check', sql`${t.holderType} IN ('student', 'staff')`),
  ]
);

export const documentTemplates = pgTable(
  'document_templates',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** text with {{placeholders}}; see packages/shared document templates */
    body: text('body').notNull(),
    serialPrefix: text('serial_prefix').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'document_templates_institution_id_fkey' }).onDelete('cascade'),
    unique('document_templates_institution_id_kind_key').on(t.institutionId, t.kind),
    check(
      'document_templates_kind_check',
      sql`${t.kind} IN ('leaving_certificate', 'character_certificate', 'bonafide_letter')`
    ),
  ]
);

export const issuedDocuments = pgTable(
  'issued_documents',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    kind: text('kind').notNull(),
    serialNo: text('serial_no').notNull(),
    studentId: integer('student_id'),
    teacherId: integer('teacher_id'),
    verifyCode: text('verify_code').notNull(),
    title: text('title').notNull(),
    /** the rendered text and the facts it states, frozen at issue time */
    body: text('body').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    issuedBy: integer('issued_by'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    index('idx_issued_documents_student').on(t.studentId),
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'issued_documents_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.studentId], foreignColumns: [students.id], name: 'issued_documents_student_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id], name: 'issued_documents_teacher_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.issuedBy], foreignColumns: [users.id], name: 'issued_documents_issued_by_fkey' }).onDelete('set null'),
    unique('issued_documents_institution_id_serial_no_key').on(t.institutionId, t.serialNo),
    unique('issued_documents_verify_code_key').on(t.verifyCode),
  ]
);

export const importJobs = pgTable(
  'import_jobs',
  {
    id: serial('id').primaryKey(),
    institutionId: integer('institution_id').notNull(),
    entity: text('entity').notNull(),
    mode: text('mode').notNull().default('create'),
    status: text('status').notNull(),
    fileName: text('file_name').notNull().default(''),
    totalRows: integer('total_rows').notNull().default(0),
    okRows: integer('ok_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    errors: jsonb('errors').notNull().default(sql`'[]'::jsonb`),
    createdBy: integer('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.institutionId], foreignColumns: [institutions.id], name: 'import_jobs_institution_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'import_jobs_created_by_fkey' }).onDelete('set null'),
    check('import_jobs_status_check', sql`${t.status} IN ('completed', 'failed')`),
    check('import_jobs_mode_check', sql`${t.mode} IN ('create', 'upsert')`),
  ]
);
