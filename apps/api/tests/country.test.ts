// An institution's country decides its starting currency, timezone, number format and week
// start, and which online payment gateways it can use: JazzCash and Easypaisa in Pakistan,
// Stripe everywhere else. The currency is locked once fee invoices exist.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';
import { countryChange, locationFor } from '../src/lib/country';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;

beforeAll(async () => {
  f = await fixture.resetDb();
});

describe('country defaults', () => {
  it('derives the location, keeping what is given', () => {
    expect(locationFor('AE')).toEqual({ country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE', weekStart: 1 });
    expect(locationFor('US', { timezone: 'America/Chicago' })).toMatchObject({ currency: 'USD', timezone: 'America/Chicago', weekStart: 0 });
    const cur = { country: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', locale: 'en-PK' };
    expect(countryChange(cur, { country: 'GB' })).toEqual({ country: 'GB', currency: 'GBP', timezone: 'Europe/London', locale: 'en-GB' });
    expect(countryChange(cur, { country: 'GB', currency: 'PKR' })).toEqual({ country: 'GB', timezone: 'Europe/London', locale: 'en-GB' });
    expect(countryChange(cur, { country: 'PK', timezone: 'Asia/Karachi' })).toEqual({});
  });

  it('the platform creates an institution from its country', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.post('/api/platform/institutions', { name: 'Gulf Academy', slug: 'gulf-academy', adminEmail: 'head@gulf.test', country: 'AE' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.institution).toMatchObject({ country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' });
    expect(r.body.institution.settings.week_start).toBe(1);
    expect((await sup.post('/api/platform/institutions', { name: 'X', slug: 'x-nowhere', adminEmail: 'x@nowhere.test', country: 'XX' })).status).toBe(400);
    // changing the country brings its currency (no invoices yet)
    const p = await sup.patch(`/api/platform/institutions/${r.body.institution.id}`, { country: 'SA' });
    expect(p.body).toMatchObject({ country: 'SA', currency: 'SAR', timezone: 'Asia/Riyadh', locale: 'en-SA' });
  });

  it('public sign-up takes the country from the list', async () => {
    const s = await request(app).post('/api/public/signup').send({ institution: 'Thames School', country: 'GB', name: 'Amy Lee', email: 'amy@thames.test', plan: 'pro', accept_terms: true });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect((await q(`SELECT country, currency, timezone, locale FROM institutions WHERE slug = $1`, [s.body.slug]))[0]).toEqual({ country: 'GB', currency: 'GBP', timezone: 'Europe/London', locale: 'en-GB' });
    expect((await request(app).post('/api/public/signup').send({ institution: 'Y', country: 'ZZ', name: 'Y', email: 'y@y.test', accept_terms: true })).status).toBe(400);
  });

  it('locks the currency once fee invoices exist', async () => {
    const admin = as(f.tokens.adminA); // A has fee invoices in PKR
    const r = await admin.patch('/api/institution/settings', { country: 'GB' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CURRENCY_LOCKED');
    // moving country while keeping the currency is fine
    const ok = await admin.patch('/api/institution/settings', { country: 'GB', currency: 'PKR' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ country: 'GB', currency: 'PKR', timezone: 'Europe/London' });
    await admin.patch('/api/institution/settings', { country: 'PK', currency: 'PKR' });
  });
});

describe('payment gateways follow the country', () => {
  it('Pakistan: JazzCash and Easypaisa; elsewhere: Stripe (bank transfer everywhere)', async () => {
    const admin = as(f.tokens.adminA);
    const pk = (await admin.get('/api/finance/accounts')).body.map((a: { provider: string }) => a.provider);
    expect(pk).toEqual(expect.arrayContaining(['jazzcash', 'easypaisa', 'bank']));
    expect(pk).not.toContain('stripe');
    expect((await admin.put('/api/finance/accounts/stripe', { secrets: { secret_key: 'sk_test_x' } })).status).toBe(400);

    await q(`UPDATE institutions SET country = 'AE' WHERE id = $1`, [f.institutions.B.id]);
    const adminB = as(f.tokens.adminB);
    const ae = (await adminB.get('/api/finance/accounts')).body.map((a: { provider: string }) => a.provider);
    expect(ae).toEqual(expect.arrayContaining(['stripe', 'bank']));
    expect(ae).not.toContain('jazzcash');
    expect((await adminB.put('/api/finance/accounts/jazzcash', { secrets: { merchant_id: 'M' } })).status).toBe(400);
    expect((await adminB.put('/api/finance/accounts/stripe', { secrets: { secret_key: 'sk_test_x' } })).status).toBe(200);
  });

  it('a gateway connected before a change of country is no longer offered or usable', async () => {
    const adminB = as(f.tokens.adminB);
    await q(`UPDATE institutions SET country = 'PK' WHERE id = $1`, [f.institutions.B.id]); // B's Stripe account stays saved
    const options = (await adminB.get('/api/finance/payment-options')).body.map((o: { provider: string }) => o.provider);
    expect(options).not.toContain('stripe');
    const r = await adminB.post(`/api/finance/invoices/${f.fees.FB.id}/checkout`, { provider: 'stripe' });
    expect(r.status).toBe(400);
  });
});
