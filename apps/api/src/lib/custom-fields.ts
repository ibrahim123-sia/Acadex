// Values for an institution's custom fields, checked against their definitions.
import type { Queryable } from '../db/pool';
import { db } from '../db/context';
import { badRequest } from './errors';

const defaultDb: Queryable = db;

type Value = string | number | boolean | null;

interface FieldDef {
  key: string;
  label: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  options: string[];
  required: boolean;
}

export async function fieldDefs(institutionId: number, entity: 'student' | 'staff' | 'guardian', db: Queryable = defaultDb) {
  const { rows } = await db.query<FieldDef>(
    `SELECT key, label, field_type, options, required FROM custom_fields WHERE institution_id = $1 AND entity = $2 ORDER BY sort, label`,
    [institutionId, entity]
  );
  return rows;
}

/**
 * Validate and normalise custom values. `existing` is merged underneath (PATCH); keys that are
 * not defined are refused, so nobody can stash arbitrary data on a record.
 */
export async function checkCustomData(
  institutionId: number,
  entity: 'student' | 'staff' | 'guardian',
  input: Record<string, Value> | undefined,
  existing: Record<string, Value> = {},
  db: Queryable = defaultDb
): Promise<Record<string, Value>> {
  const defs = await fieldDefs(institutionId, entity, db);
  const out: Record<string, Value> = { ...existing };
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input ?? {})) {
    const def = defs.find((d) => d.key === key);
    if (!def) {
      errors[key] = 'Unknown field';
      continue;
    }
    if (raw === null || raw === '') {
      out[key] = null;
      continue;
    }
    switch (def.field_type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) errors[key] = `${def.label} must be a number`;
        else out[key] = n;
        break;
      }
      case 'checkbox':
        if (typeof raw === 'boolean') out[key] = raw;
        else if (raw === 'true' || raw === 'false') out[key] = raw === 'true';
        else errors[key] = `${def.label} must be yes or no`;
        break;
      case 'date':
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) errors[key] = `${def.label} must be a date`;
        else out[key] = raw;
        break;
      case 'select':
        if (!def.options.includes(String(raw))) errors[key] = `${def.label} must be one of: ${def.options.join(', ')}`;
        else out[key] = String(raw);
        break;
      default:
        out[key] = String(raw).slice(0, 500);
    }
  }
  for (const d of defs) {
    if (d.required && (out[d.key] === undefined || out[d.key] === null || out[d.key] === '')) errors[d.key] ??= `${d.label} is required`;
  }
  if (Object.keys(errors).length) {
    throw badRequest(
      'Some custom fields are not valid',
      Object.entries(errors).map(([path, message]) => ({ path: `custom_data.${path}`, message }))
    );
  }
  return out;
}
