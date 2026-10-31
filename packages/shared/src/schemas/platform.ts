import { z } from 'zod';
import { PLANS, INSTITUTION_STATUSES } from '../constants';
import { currency, email, locale, requiredText, text, timeZone } from './common';
import { countryCode } from '../countries';
import { INSTITUTION_TYPES } from '../academics';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2563EB');

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'Use 1-40 lowercase letters, digits or hyphens');

export const createInstitutionBody = z.object({
  name: requiredText(120),
  slug,
  /** school, college, university … — drives the setup defaults */
  type: z.enum(INSTITUTION_TYPES).default('school'),
  plan: z.enum(PLANS).default('free'),
  adminName: text(120).optional(),
  adminEmail: email,
  primary_color: hexColor.optional(),
  /** the currency, timezone and formats follow the country unless given */
  country: countryCode.default('PK'),
  currency: currency.optional(),
  timezone: timeZone.optional(),
  locale: locale.optional(),
});

export const updateInstitutionBody = z.object({
  name: requiredText(120).optional(),
  slug: slug.optional(),
  type: z.enum(INSTITUTION_TYPES).optional(),
  contact_email: z.union([email, z.literal('')]).optional(),
  primary_color: hexColor.optional(),
  /** the group of institutions it belongs to (null takes it out) */
  group_id: z.number().int().positive().nullable().optional(),
  plan: z.enum(PLANS).optional(),
  status: z.enum(INSTITUTION_STATUSES).optional(),
  country: countryCode.optional(),
  currency: currency.optional(),
  timezone: timeZone.optional(),
  locale: locale.optional(),
});

/** A group of institutions (a school network, a university system). */
export const institutionGroupBody = z.object({
  name: requiredText(120),
  slug,
});

export const updateInstitutionGroupBody = z.object({
  name: requiredText(120),
});

/** An administrator of an institution, added or corrected by the platform owner. */
export const institutionAdminBody = z.object({
  name: requiredText(120),
  email,
});
