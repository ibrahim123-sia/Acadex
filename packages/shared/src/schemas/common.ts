import { z } from 'zod';
import { MAX_PAGE_SIZE } from '../constants';

export const id = z.coerce.number().int().positive().max(2147483647);

/** '' / null / undefined → null (HTML forms send '' for "none"). */
export const optionalId = z
  .union([id, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v == null ? null : v));

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Invalid date');

export const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => v || null);

export const text = (max = 200) => z.string().trim().max(max);
export const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const money = z.coerce.number().min(0).max(100_000_000);
export const email = z.string().trim().toLowerCase().pipe(z.email());

export const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => {
    try {
      return ['http:', 'https:'].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, 'Must be an http(s) link');

export const pageQuery = (defaultSize = 50) =>
  z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(defaultSize),
  });

export const idParam = <K extends string>(name: K) => z.object({ [name]: id } as Record<K, typeof id>);

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

export const currency = z.string().trim().toUpperCase().refine(isValidCurrency, 'Unknown ISO 4217 currency code');
export const timeZone = z.string().trim().refine(isValidTimeZone, 'Unknown IANA timezone (e.g. Asia/Karachi)');
export const locale = z.string().trim().max(35).refine(isValidLocale, 'Invalid locale tag (e.g. en-PK)');
