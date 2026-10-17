// The outside scheduler (Cloudflare cron trigger): the cron matcher, and POST /api/internal/cron
// — absent without CRON_SECRET, refuses a wrong secret, and queues each due job once per minute.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, fixture } from './helpers/http';
import { clearJobs, pendingJobs } from '../src/jobs';
import { dueMinutes, parseCron } from '../src/lib/cron';
import { loadConfig, resetConfigCache } from '../src/config';

const SECRET = 'test-cron-secret-0123456789abcdef0123456789';

describe('cron matcher', () => {
  it('matches minutes, hours, steps, ranges, lists and both day fields', () => {
    const at = (s: string) => new Date(`${s}Z`);
    expect(parseCron('30 2 * * *').matches(at('2030-03-12T02:30:00'))).toBe(true);
    expect(parseCron('30 2 * * *').matches(at('2030-03-12T02:31:00'))).toBe(false);
    expect(parseCron('*/15 * * * *').matches(at('2030-03-12T10:45:00'))).toBe(true);
    expect(parseCron('0 9-17/4 * * 1-5').matches(at('2030-03-12T13:00:00'))).toBe(true); // Tuesday
    expect(parseCron('0 9-17/4 * * 1-5').matches(at('2030-03-16T13:00:00'))).toBe(false); // Saturday
    expect(parseCron('0 4 1 * *').matches(at('2030-04-01T04:00:00'))).toBe(true);
    expect(parseCron('0 0 1,15 * 0').matches(at('2030-03-17T00:00:00'))).toBe(true); // a Sunday (either day field)
    expect(parseCron('0 0 * * 7').matches(at('2030-03-17T00:00:00'))).toBe(true);
    expect(() => parseCron('61 * * * *')).toThrow();
    expect(() => parseCron('* * *')).toThrow();
  });

  it('lists the minutes due in a window, excluding its start', () => {
    const from = new Date('2030-03-12T10:00:00Z');
    const to = new Date('2030-03-12T10:10:00Z');
    expect(dueMinutes('*/5 * * * *', from, to).map((d) => d.toISOString())).toEqual(['2030-03-12T10:05:00.000Z', '2030-03-12T10:10:00.000Z']);
    expect(dueMinutes('30 2 * * *', from, to)).toEqual([]);
  });
});

describe('configuration for Cloudflare', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(40) };
  it('reads the schedule mode, the cron secret and a proxy hop count', () => {
    expect(loadConfig(base).jobsSchedule).toBe('internal');
    expect(loadConfig(base).cronSecret).toBeUndefined();
    expect(loadConfig({ ...base, CRON_SECRET: '' }).cronSecret).toBeUndefined();
    expect(() => loadConfig({ ...base, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
    expect(loadConfig({ ...base, JOBS_SCHEDULE: 'external', CRON_SECRET: SECRET }).jobsSchedule).toBe('external');
    expect(() => loadConfig({ ...base, JOBS_SCHEDULE: 'external' })).toThrow(/CRON_SECRET/);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
  });
});

describe('POST /api/internal/cron', () => {
  beforeAll(async () => {
    await fixture.resetDb();
  });
  beforeEach(() => clearJobs());
  afterAll(() => {
    delete process.env.CRON_SECRET;
    resetConfigCache();
  });

  it('does not exist without CRON_SECRET', async () => {
    delete process.env.CRON_SECRET;
    resetConfigCache();
    expect((await request(app).post('/api/internal/cron').set('x-acadex-cron', SECRET).send({})).status).toBe(404);
  });

  it('refuses a wrong secret and queues the due jobs once', async () => {
    process.env.CRON_SECRET = SECRET;
    resetConfigCache();
    expect((await request(app).post('/api/internal/cron').set('x-acadex-cron', 'nope').send({})).status).toBe(404);
    expect((await request(app).post('/api/internal/cron').send({})).status).toBe(404);

    // any 60-minute window holds one hh:05, when reminders.due (5 * * * *) runs
    const at = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const r = await request(app).post('/api/internal/cron').set('x-acadex-cron', SECRET).send({ at: at.toISOString(), window_minutes: 60 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const names = r.body.queued.map((q: { job: string }) => q.job);
    expect(names).toContain('reminders.due');
    expect(pendingJobs().filter((j) => j.name === 'reminders.due')).toHaveLength(1);
    // the same tick again does not queue it twice
    await request(app).post('/api/internal/cron').set('x-acadex-cron', SECRET).send({ at: at.toISOString(), window_minutes: 60 });
    expect(pendingJobs().filter((j) => j.name === 'reminders.due')).toHaveLength(1);

    expect((await request(app).post('/api/internal/cron').set('x-acadex-cron', SECRET).send({ at: '2001-01-01T00:00:00Z' })).status).toBe(400);
  });
});
