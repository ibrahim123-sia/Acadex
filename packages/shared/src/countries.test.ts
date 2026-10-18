import { describe, it, expect } from 'vitest';
import { COUNTRIES, countryCode, countryDefaults, onlineGatewaysFor } from './countries';
import { isValidCurrency, isValidTimeZone } from './schemas/common';

describe('countries', () => {
  it('has a known currency and timezone for every country, once each', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of COUNTRIES) {
      expect(c.code, c.name).toMatch(/^[A-Z]{2}$/);
      expect(isValidCurrency(c.currency), `${c.name}: ${c.currency}`).toBe(true);
      expect(isValidTimeZone(c.timezone), `${c.name}: ${c.timezone}`).toBe(true);
    }
    expect(COUNTRIES.length).toBeGreaterThan(180);
  });

  it('derives the defaults from the country', () => {
    expect(countryDefaults('PK')).toEqual({ country: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', locale: 'en-PK', weekStart: 1 });
    expect(countryDefaults('ae')).toMatchObject({ currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' });
    expect(countryDefaults('US').weekStart).toBe(0);
    expect(countryDefaults('QA').weekStart).toBe(6);
    expect(() => countryDefaults('XX')).toThrow();
  });

  it('picks JazzCash and Easypaisa in Pakistan, Stripe everywhere else', () => {
    expect(onlineGatewaysFor('PK')).toEqual(['jazzcash', 'easypaisa']);
    expect(onlineGatewaysFor('GB')).toEqual(['stripe']);
    expect(onlineGatewaysFor('AE')).toEqual(['stripe']);
    expect(onlineGatewaysFor(null)).toEqual(['stripe']);
  });

  it('validates a country code', () => {
    expect(countryCode.parse(' pk ')).toBe('PK');
    expect(countryCode.safeParse('XX').success).toBe(false);
  });
});
