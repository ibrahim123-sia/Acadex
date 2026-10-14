// Soft delete, restore and purge. Deleted rows are hidden by RLS (see migration 0008), so these
// run with deleted rows visible; the audit trigger records each step as delete / restore / purge.
import { db, withDeleted } from '../db/context';

export const SOFT_DELETABLE = ['students', 'teachers', 'guardians', 'sections', 'courses', 'programs', 'departments', 'campuses', 'person_documents', 'files'] as const;
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
