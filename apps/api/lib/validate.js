// Shared Zod building blocks. Handlers call schema.parse(...); a ZodError becomes a 400
// in the central error handler.
const { z } = require('zod');

const id = z.coerce.number().int().positive().max(2147483647);
const optionalId = z
  .union([id, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v == null ? null : v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Invalid date');
const text = (max = 200) => z.string().trim().max(max);
const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max);
const money = z.coerce.number().min(0).max(100000000);
const httpUrl = z
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

const idParam = (name) => z.object({ [name]: id });

module.exports = { z, id, optionalId, isoDate, text, requiredText, money, httpUrl, idParam };
