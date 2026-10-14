// Helpers for the academic structure: campus scoping, the calendar (holidays, working days)
// and archived (read-only) years.
import type { Request } from 'express';
import { INSTITUTION_DEFAULTS, institutionSettings as settingsSchema, type InstitutionType, type Permission } from '@acadex/shared';
import type { Queryable } from '../db/pool';
import { db } from '../db/context';
import { campusScope } from '../rbac';
import { currentUser, institutionId } from '../middleware/auth';
import { conflict, forbidden } from './errors';

const defaultDb: Queryable = db;

/** Campuses the caller may act on with `permission` (null = all of them). */
export const campusesFor = (req: Request, permission: Permission) => campusScope(currentUser(req), permission, institutionId(req));

/**
 * SQL fragment limiting `column` to the caller's campuses, appending the parameter.
 * Rows with no campus are only visible to institution-wide holders.
 */
export function campusClause(scope: number[] | null, column: string, params: unknown[]): string {
  if (scope === null) return '';
  params.push(scope);
  return ` AND ${column} = ANY($${params.length}::int[])`;
}

/** Refuse when a campus-limited user touches another campus (or something with no campus). */
export function assertCampusAllowed(scope: number[] | null, campusId: number | null | undefined): void {
  if (scope === null) return;
  if (campusId == null || !scope.includes(campusId)) throw forbidden('This belongs to a campus you do not manage');
}

export async function campusOfSection(sectionId: number, db: Queryable = defaultDb): Promise<number | null> {
  const { rows } = await db.query<{ campus_id: number | null }>(`SELECT campus_id FROM sections WHERE id = $1`, [sectionId]);
  return rows[0]?.campus_id ?? null;
}

// ---------------------------------------------------------------- calendar

interface CalendarSettings {
  type: InstitutionType;
  workingDays: number[];
}

export async function calendarSettings(institution: number, db: Queryable = defaultDb): Promise<CalendarSettings> {
  const { rows } = await db.query<{ type: InstitutionType; settings: unknown }>(`SELECT type, settings FROM institutions WHERE id = $1`, [institution]);
  const type = rows[0]?.type ?? 'school';
  const parsed = settingsSchema.safeParse(rows[0]?.settings ?? {});
  const workingDays = (parsed.success && parsed.data.working_days) || INSTITUTION_DEFAULTS[type].workingDays;
  return { type, workingDays };
}

/** The holiday covering `date` for a campus (institution-wide holidays apply everywhere). */
export async function holidayOn(institution: number, campusId: number | null, date: string, db: Queryable = defaultDb) {
  const { rows } = await db.query<{ name: string; kind: string }>(
    `SELECT name, kind FROM holidays
      WHERE institution_id = $1 AND $2::date BETWEEN starts_on AND ends_on
        AND (campus_id IS NULL OR campus_id = $3) AND kind IN ('holiday', 'break')
      ORDER BY campus_id NULLS LAST LIMIT 1`,
    [institution, date, campusId]
  );
  return rows[0] ?? null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Refuse a date the institution is closed on (a holiday, a break, or a non-working day),
 * e.g. for attendance or a due date. `what` names the action for the message.
 */
export async function assertOpenDay(institution: number, campusId: number | null, date: string, what: string, db: Queryable = defaultDb) {
  const holiday = await holidayOn(institution, campusId, date, db);
  if (holiday) throw conflict(`${date} is a holiday (${holiday.name}) — ${what} is not possible on that day`, 'HOLIDAY', { date, holiday: holiday.name });
  const { workingDays } = await calendarSettings(institution, db);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!workingDays.includes(weekday)) {
    throw conflict(`${DAY_NAMES[weekday]} is not a working day — ${what} is not possible on that day`, 'NON_WORKING_DAY', { date });
  }
}

/** The next open day on or after `date` (for "move to the next working day" suggestions). */
export async function nextOpenDay(institution: number, campusId: number | null, date: string, db: Queryable = defaultDb): Promise<string> {
  const { workingDays } = await calendarSettings(institution, db);
  const { rows } = await db.query<{ starts_on: string; ends_on: string }>(
    `SELECT starts_on, ends_on FROM holidays
      WHERE institution_id = $1 AND ends_on >= $2::date AND (campus_id IS NULL OR campus_id = $3) AND kind IN ('holiday', 'break')`,
    [institution, date, campusId]
  );
  let d = date;
  for (let i = 0; i < 400; i++) {
    const closed = !workingDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) || rows.some((h) => d >= h.starts_on && d <= h.ends_on);
    if (!closed) return d;
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return date;
}

// ---------------------------------------------------------------- archived years

/** Archived sections (or sections of an archived year) are read-only. */
export async function assertSectionWritable(sectionId: number, db: Queryable = defaultDb): Promise<void> {
  const { rows } = await db.query<{ status: string; year_status: string | null }>(
    `SELECT s.status, ay.status AS year_status FROM sections s LEFT JOIN academic_years ay ON ay.id = s.academic_year_id WHERE s.id = $1`,
    [sectionId]
  );
  const r = rows[0];
  if (r && (r.status === 'archived' || r.year_status === 'archived')) {
    throw conflict('This class belongs to an archived year and is read-only', 'ARCHIVED');
  }
}

/** Offerings in an archived term (or of an archived section) are read-only. */
export async function assertOfferingWritable(offeringId: number, db: Queryable = defaultDb): Promise<void> {
  const { rows } = await db.query<{ term_status: string | null; section_id: number | null }>(
    `SELECT t.status AS term_status, o.section_id FROM course_offerings o LEFT JOIN terms t ON t.id = o.term_id WHERE o.id = $1`,
    [offeringId]
  );
  const r = rows[0];
  if (!r) return;
  if (r.term_status === 'archived') throw conflict('This course belongs to an archived term and is read-only', 'ARCHIVED');
  if (r.section_id) await assertSectionWritable(r.section_id, db);
}

export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';
export const isForeignKeyViolation = (e: unknown) => (e as { code?: string })?.code === '23503';
