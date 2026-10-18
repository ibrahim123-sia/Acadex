import { z } from 'zod';
import { PLANS, INSTITUTION_STATUSES } from '../constants';
import { currency, email, locale, requiredText, text, timeZone } from './common';
import { countryCode } from '../countries';

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'Use 1-40 lowercase letters, digits or hyphens');

export const createInstitutionBody = z.object({
  name: requiredText(120),
  slug,
  plan: z.enum(PLANS).default('free'),
  adminName: text(120).optional(),
  adminEmail: email,
  primary_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** the currency, timezone and formats follow the country unless given */
  country: countryCode.default('PK'),
  currency: currency.optional(),
  timezone: timeZone.optional(),
  locale: locale.optional(),
});

export const updateInstitutionBody = z.object({
  plan: z.enum(PLANS).optional(),
  status: z.enum(INSTITUTION_STATUSES).optional(),
  country: countryCode.optional(),
  currency: currency.optional(),
  timezone: timeZone.optional(),
  locale: locale.optional(),
});
