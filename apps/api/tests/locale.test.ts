// Bug #11 (+ I): currency and "today" come from the school's settings, not from
// hard-coded PKR or the server's UTC clock.
import { describe, it, expect, beforeEach } from 'vitest';
import { as, fixture } from './helpers/http';

import { formatMoney, isValidTimeZone, todayIn } from '../src/lib/locale';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});
const q = (sql: string, p?: unknown[]) => fixture.pool.query(sql, p);

describe('locale helpers', () => {
  it('computes the calendar date in a timezone', () => {
    const at = new Date('2026-03-01T20:30:00Z');
    expect(todayIn('UTC', at)).toBe('2026-03-01');
    expect(todayIn('Asia/Karachi', at)).toBe('2026-03-02'); // UTC+5
    expect(todayIn('America/New_York', at)).toBe('2026-03-01');
  });

  it('formats money in the school currency', () => {
    expect(formatMoney(25000, 'PKR', 'en-PK')).toMatch(/25,000/);
    expect(formatMoney(25000, 'PKR', 'en-PK')).toMatch(/Rs|PKR/);
    expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(99, 'EUR', 'de-DE')).toMatch(/99,00\s?€/);
  });

  it('validates IANA timezones', () => {
    expect(isValidTimeZone('Asia/Karachi')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('school settings', () => {
  it('schools default to PKR / Asia/Karachi and expose it to signed-in users', async () => {
    const res = await as(f.tokens.t1).get('/api/auth/me');
    expect(res.body.school).toMatchObject({ currency: 'PKR', timezone: 'Asia/Karachi', locale: 'en-PK' });
  });

  it('the roster defaults to today in the school timezone', async () => {
    // UTC+14 and UTC-11 are always on different calendar dates
    await q(`UPDATE schools SET timezone='Pacific/Kiritimati' WHERE id=$1`, [f.schools.A.id]);
    const res = await as(f.tokens.t1).get(`/api/me/teacher/class/${f.classes.A1.id}/roster`);
    expect(res.body.date).toBe(todayIn('Pacific/Kiritimati'));
    await q(`UPDATE schools SET timezone='Pacific/Pago_Pago' WHERE id=$1`, [f.schools.A.id]);
    const res2 = await as(f.tokens.t1).get(`/api/me/teacher/class/${f.classes.A1.id}/roster`);
    expect(res2.body.date).toBe(todayIn('Pacific/Pago_Pago'));
  });

  it('a school can be created with its own currency and timezone', async () => {
    const res = await as(f.tokens.super).post('/api/platform/schools', {
      name: 'Global Academy',
      slug: 'global',
      adminEmail: 'admin@global.test',
      currency: 'usd',
      timezone: 'America/New_York',
      locale: 'en-US',
    });
    expect(res.status).toBe(201);
    expect(res.body.school).toMatchObject({ currency: 'USD', timezone: 'America/New_York', locale: 'en-US' });
  });

  it('rejects an unknown timezone, currency or locale', async () => {
    const s = as(f.tokens.super);
    const base = { name: 'X', slug: 'x', adminEmail: 'a@x.test' };
    expect((await s.post('/api/platform/schools', { ...base, timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await s.post('/api/platform/schools', { ...base, currency: 'US1' })).status).toBe(400);
    expect((await s.patch(`/api/platform/schools/${f.schools.A.id}`, { timezone: 'Nowhere/Land' })).status).toBe(400);
    expect((await s.patch(`/api/platform/schools/${f.schools.A.id}`, { locale: 'not a locale!' })).status).toBe(400);
  });

  it('platform revenue is reported per currency, never summed across currencies', async () => {
    await q(`UPDATE schools SET currency='USD' WHERE id=$1`, [f.schools.B.id]);
    const res = await as(f.tokens.super).get('/api/platform/stats');
    expect(res.status).toBe(200);
    const byCur = Object.fromEntries(res.body.revenueByCurrency.map((r) => [r.currency, r.amount]));
    expect(byCur).toEqual({ PKR: 1000, USD: 500 }); // A: two fees with 500 paid each; B: one
  });
});
