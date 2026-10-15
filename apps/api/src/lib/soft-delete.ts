// Soft delete, restore and purge. Deleted rows are hidden by RLS (see migration 0008), so these
// run with deleted rows visible; the audit trigger records each step as delete / restore / purge.
import type { RECYCLABLE } from '@acadex/shared';
import { db, withDeleted, withTransaction } from '../db/context';
import { storage } from '../storage';

/** Deleted records are kept this long, then the nightly job purges them. */
export const RETENTION_DAYS = 30;

export const SOFT_DELETABLE = [
  'students', 'teachers', 'guardians', 'sections', 'courses', 'programs', 'departments', 'campuses', 'person_documents', 'files',
  'assessments', 'content_items', 'course_blueprints', 'question_banks', 'questions', 'discussions',
] as const;
export type SoftDeletable = (typeof SOFT_DELETABLE)[number];

/** Mark a row deleted. Returns false when it doesn't exist (or is already deleted). */
export async function softDelete(table: SoftDeletable, id: number, institutionId: number, userId: number): Promise<boolean> {
  return withDeleted(async () => {
    const { rowCount } = await db.query(
      `UPDATE ${table} SET deleted_at = now(), deleted_by = $3 WHERE id = $1 AND institution_id = $2 AND deleted_at IS NULL`,
      [id, institutionId, userId]
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function restoreDeleted(table: SoftDeletable, id: number, institutionId: number): Promise<boolean> {
  return withDeleted(async () => {
    const { rowCount } = await db.query(
      `UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND institution_id = $2 AND deleted_at IS NOT NULL`,
      [id, institutionId]
    );
    return (rowCount ?? 0) > 0;
  });
}

/** Permanently delete a row that is already in the recycle bin. */
export async function purgeDeleted(table: SoftDeletable, id: number, institutionId: number): Promise<boolean> {
  return withDeleted(async () => {
    const { rowCount } = await db.query(`DELETE FROM ${table} WHERE id = $1 AND institution_id = $2 AND deleted_at IS NOT NULL`, [id, institutionId]);
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Permanently delete a record from the recycle bin with everything that goes with it (the
 * person's account, documents and files). Returns false when it isn't in the bin.
 */
export async function purgeRecord(t: (typeof RECYCLABLE)[number], rowId: number, s: number): Promise<boolean> {
  const files: string[] = [];
  const purged = await withTransaction(() =>
    withDeleted(async () => {
      // the person's account and files go with them
      if (t === 'students' || t === 'teachers') {
        await db.query(`DELETE FROM users WHERE ref_id = $1 AND role = $2 AND institution_id = $3`, [rowId, t === 'students' ? 'student' : 'teacher', s]);
        const { rows } = await db.query<{ storage_key: string; id: number }>(
          `SELECT f.id, f.storage_key FROM files f WHERE f.institution_id = $1 AND (f.id IN (SELECT file_id FROM person_documents WHERE owner_type = $2 AND owner_id = $3)
                                                                                 OR f.id = (SELECT photo_file_id FROM ${t} WHERE id = $3))`,
          [s, t === 'students' ? 'student' : 'staff', rowId]
        );
        files.push(...rows.map((r) => r.storage_key));
        await db.query(`DELETE FROM person_documents WHERE owner_type = $1 AND owner_id = $2 AND institution_id = $3`, [t === 'students' ? 'student' : 'staff', rowId, s]);
        if (rows.length) await db.query(`DELETE FROM files WHERE id = ANY($1::int[])`, [rows.map((r) => r.id)]);
      }
      if (t === 'guardians') await db.query(`DELETE FROM users WHERE id = (SELECT user_id FROM guardians WHERE id = $1) AND role = 'parent'`, [rowId]);
      if (t === 'person_documents') {
        const { rows } = await db.query<{ storage_key: string; id: number }>(`SELECT f.id, f.storage_key FROM files f JOIN person_documents d ON d.file_id = f.id WHERE d.id = $1`, [rowId]);
        files.push(...rows.map((r) => r.storage_key));
      }
      return purgeDeleted(t, rowId, s);
    })
  );
  if (purged) for (const key of files) await storage().delete(key).catch(() => {});
  return purged;
}
