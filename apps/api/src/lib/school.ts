import { pool, type Queryable } from '../db/pool';

export interface SchoolSettings {
  id: number;
  name: string;
  primary_color: string;
  currency: string;
  timezone: string;
  locale: string;
}

/** Display and locale settings of a school. */
export async function schoolSettings(schoolId: number, db: Queryable = pool): Promise<SchoolSettings | null> {
  const { rows } = await db.query<SchoolSettings>(
    'SELECT id, name, primary_color, currency, timezone, locale FROM schools WHERE id=$1',
    [schoolId]
  );
  return rows[0] ?? null;
}

/** The school's IANA timezone (falls back to the platform default). */
export async function schoolTimeZone(schoolId: number, db: Queryable = pool): Promise<string> {
  return (await schoolSettings(schoolId, db))?.timezone ?? 'Asia/Karachi';
}
