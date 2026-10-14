// Certificates and letters: default templates, placeholder filling, serial numbers, and the
// short codes printed (as QR) on documents and ID cards for public verification.
import crypto from 'node:crypto';
import type { Queryable } from '../db/pool';
import { db } from '../db/context';

const defaultDb: Queryable = db;

export type DocumentKind = 'leaving_certificate' | 'character_certificate' | 'bonafide_letter';

export const DEFAULT_TEMPLATES: Record<DocumentKind, { title: string; serial_prefix: string; body: string }> = {
  leaving_certificate: {
    title: 'Leaving Certificate',
    serial_prefix: 'LC',
    body:
      'This is to certify that {{student.name}}, {{student.relation}} {{guardian.name}}, roll number {{student.roll_no}}, ' +
      'was a student of {{institution.name}} from {{student.admission_date}} to {{left_on}}.\n\n' +
      'At the time of leaving, the student was enrolled in {{section.name}} ({{academic_year}}). ' +
      'Date of birth as per our records: {{student.dob}}.\n\n' +
      'Reason for leaving: {{reason}}.\nConduct: {{conduct}}.\n\n' +
      'All dues have been cleared and we wish the student every success.',
  },
  character_certificate: {
    title: 'Character Certificate',
    serial_prefix: 'CC',
    body:
      'This is to certify that {{student.name}}, {{student.relation}} {{guardian.name}}, roll number {{student.roll_no}}, ' +
      'has been a student of {{institution.name}} since {{student.admission_date}}.\n\n' +
      'To the best of our knowledge, the student bears a {{conduct}} moral character and has not taken part in any activity against the rules of the institution.',
  },
  bonafide_letter: {
    title: 'Bonafide Certificate',
    serial_prefix: 'BF',
    body:
      'This is to certify that {{student.name}}, {{student.relation}} {{guardian.name}}, roll number {{student.roll_no}}, ' +
      'is a bonafide student of {{institution.name}}, currently enrolled in {{section.name}} for the {{academic_year}} session.\n\n' +
      'This certificate is issued on request{{purpose_clause}}.',
  },
};

/** Replace {{a.b}} placeholders; unknown placeholders become "—" so nothing technical leaks onto paper. */
export function fillTemplate(body: string, data: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_, key: string) => data[key] ?? '—');
}

export const PLACEHOLDERS = [
  'student.name', 'student.roll_no', 'student.dob', 'student.admission_date', 'student.relation', 'guardian.name',
  'section.name', 'campus.name', 'program.name', 'academic_year', 'institution.name', 'left_on', 'reason', 'conduct', 'purpose', 'purpose_clause', 'date', 'serial_no',
];

/** A code for QR verification: 12 characters from an alphabet without look-alikes. */
export function verifyCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Next serial for a kind, e.g. LC-2026-0007 (per institution, per calendar year). */
export async function nextSerial(institutionId: number, prefix: string, year: number, db: Queryable = defaultDb): Promise<string> {
  // serialise issuing per institution so two clerks never get the same number
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('acadex:serial'), $1)`, [institutionId]);
  const like = `${prefix}-${year}-%`;
  const { rows } = await db.query<{ n: number }>(
    `SELECT COALESCE(max(substring(serial_no FROM '[0-9]+$')::int), 0) + 1 AS n FROM issued_documents WHERE institution_id = $1 AND serial_no LIKE $2`,
    [institutionId, like]
  );
  return `${prefix}-${year}-${String(rows[0]!.n).padStart(4, '0')}`;
}

/** "Ali B." — enough for someone holding the document to match it, without publishing full names. */
export function maskName(first: string, last: string): string {
  return `${first.trim()} ${last.trim() ? `${last.trim()[0]!.toUpperCase()}.` : ''}`.trim();
}
