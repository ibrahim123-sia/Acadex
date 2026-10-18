// What follows from an institution's country: its currency, timezone, number/date format and
// week start (defaults the institution can still edit), and the online payment gateways it may
// connect — JazzCash and Easypaisa in Pakistan, Stripe everywhere else (packages/shared countries.ts).
import { countryDefaults, onlineGatewaysFor, type CountryDefaults } from '@acadex/shared';
import { getConfig } from '../config';
import { db } from '../db/context';
import { conflict } from './errors';
import type { ProviderName } from './finance/providers';

export interface Location {
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  weekStart: number;
}

/** A new institution's location: the country's defaults, with anything given explicitly kept. */
export function locationFor(country: string, given: { currency?: string; timezone?: string; locale?: string } = {}): Location {
  const d: CountryDefaults = countryDefaults(country);
  return { country: d.country, currency: given.currency ?? d.currency, timezone: given.timezone ?? d.timezone, locale: given.locale ?? d.locale, weekStart: d.weekStart };
}

/**
 * A change of country brings the new country's currency, timezone and format unless they are
 * given too. Returns the columns to update (only those that change).
 */
export function countryChange(
  current: { country: string; currency: string; timezone: string; locale: string },
  patch: { country?: string; currency?: string; timezone?: string; locale?: string }
): Partial<Pick<Location, 'country' | 'currency' | 'timezone' | 'locale'>> {
  const out: Partial<Pick<Location, 'country' | 'currency' | 'timezone' | 'locale'>> = {};
  if (patch.country && patch.country !== current.country) {
    const d = countryDefaults(patch.country);
    out.country = d.country;
    out.currency = patch.currency ?? d.currency;
    out.timezone = patch.timezone ?? d.timezone;
    out.locale = patch.locale ?? d.locale;
  } else {
    if (patch.currency) out.currency = patch.currency;
    if (patch.timezone) out.timezone = patch.timezone;
    if (patch.locale) out.locale = patch.locale;
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (out[k] === current[k]) delete out[k];
  return out;
}

/** Fee amounts are stored in the institution's currency: once invoices exist it can't change. */
export async function assertCurrencyMayChange(institutionId: number, from: string, to: string | undefined): Promise<void> {
  if (!to || to === from) return;
  const { rows } = await db.query(`SELECT 1 FROM invoices WHERE institution_id = $1 LIMIT 1`, [institutionId]);
  if (rows[0]) throw conflict(`Fee invoices already exist in ${from}, so the currency can't change to ${to}`, 'CURRENCY_LOCKED');
}

/** Payment providers this institution may connect and offer: the country's gateway(s), bank transfer, and the test provider outside production. */
export async function allowedProviders(institutionId: number): Promise<Set<ProviderName>> {
  const { rows } = await db.query<{ country: string }>(`SELECT country FROM institutions WHERE id = $1`, [institutionId]);
  const out = new Set<ProviderName>([...onlineGatewaysFor(rows[0]?.country), 'bank']);
  if (getConfig().env !== 'production') out.add('fake');
  return out;
}
