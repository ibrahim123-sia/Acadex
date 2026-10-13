import type { Queryable } from '../db/pool';
import { db } from '../db/context';

const defaultDb: Queryable = db;

export interface InstitutionSettings {
  id: number;
  name: string;
  primary_color: string;
  currency: string;
  timezone: string;
  locale: string;
}

/** Display and locale settings of an institution. */
export async function institutionSettings(institutionId: number, db: Queryable = defaultDb): Promise<InstitutionSettings | null> {
  const { rows } = await db.query<InstitutionSettings>(
    'SELECT id, name, primary_color, currency, timezone, locale FROM institutions WHERE id=$1',
    [institutionId]
  );
  return rows[0] ?? null;
}

/** The institution's IANA timezone (falls back to the platform default). */
export async function institutionTimeZone(institutionId: number, db: Queryable = defaultDb): Promise<string> {
  return (await institutionSettings(institutionId, db))?.timezone ?? 'Asia/Karachi';
}
