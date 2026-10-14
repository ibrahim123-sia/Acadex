// Reading import files: CSV or Excel (first sheet), first row = headers. Headers are matched
// loosely (case, spaces and punctuation ignored) against each entity's aliases, which include
// the OneRoster 1.1 CSV column names (givenName, familyName, identifier, courseCode, …).
import { parse as parseCsv } from 'csv-parse/sync';
import { readSheet } from 'read-excel-file/node';
import { badRequest } from './errors';

export const MAX_IMPORT_ROWS = 2000;

export type RawRow = Record<string, string>;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function readRows(body: Buffer, contentType: string): Promise<{ headers: string[]; rows: string[][] }> {
  let table: string[][];
  if (contentType === 'text/csv') {
    try {
      table = parseCsv(body, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][];
    } catch (e) {
      throw badRequest(`The CSV file could not be read: ${(e as Error).message}`);
    }
  } else {
    try {
      const sheet = await readSheet(body);
      table = sheet.map((r) =>
        r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim()))
      );
    } catch {
      throw badRequest('The spreadsheet could not be read (use .xlsx or .csv)');
    }
  }
  const [headers = [], ...rows] = table.filter((r) => r.some((c) => c !== ''));
  if (!headers.length) throw badRequest('The file has no header row');
  if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`At most ${MAX_IMPORT_ROWS} rows per import (this file has ${rows.length})`);
  return { headers, rows };
}

/**
 * Map file headers onto an entity's fields. Returns field → column index, plus custom-field
 * columns (by key or label) and the headers nothing matched.
 */
export function mapHeaders(
  headers: string[],
  aliases: Record<string, string[]>,
  customKeys: { key: string; label: string }[] = []
): { map: Record<string, number>; custom: Record<string, number>; unmatched: string[] } {
  const map: Record<string, number> = {};
  const custom: Record<string, number> = {};
  const unmatched: string[] = [];
  headers.forEach((h, i) => {
    const n = norm(h);
    const field = Object.entries(aliases).find(([f, list]) => norm(f) === n || list.some((a) => norm(a) === n))?.[0];
    if (field && map[field] === undefined) return void (map[field] = i);
    const cf = customKeys.find((c) => norm(c.key) === n || norm(c.label) === n || `custom${norm(c.key)}` === n);
    if (cf) return void (custom[cf.key] = i);
    unmatched.push(h);
  });
  return { map, custom, unmatched };
}

export function rowObject(row: string[], map: Record<string, number>): RawRow {
  const out: RawRow = {};
  for (const [field, i] of Object.entries(map)) {
    const v = row[i];
    if (v !== undefined && v !== '') out[field] = v;
  }
  return out;
}

/** "yes", "true", "1", "y" → true; "no", "false", "0", "n" → false; anything else → undefined. */
export function parseBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return true;
  if (['no', 'false', '0', 'n'].includes(s)) return false;
  return undefined;
}

/** Dates as YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (the common forms in Pakistan / the UK). */
export function parseDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return s; // left for the schema to reject
}
