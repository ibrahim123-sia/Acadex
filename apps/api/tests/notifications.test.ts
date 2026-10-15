// Notifications: in-app list and read state, email / push preferences with quiet hours, push
// subscriptions (fake driver), delivery logs, the live event stream, and the scheduled jobs
// (recycle-bin purge, due reminders).
import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inQuietHours } from '@acadex/shared';
import { app, as, fixture } from './helpers/http';
import { clearJobs, drainJobs, pendingJobs, runJob } from '../src/jobs';
import { notify } from '../src/lib/notify';
import { runAsSystem } from '../src/db/context';
import { sentPushes } from '../src/lib/push';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
  clearJobs();
});

const send = (userIds: number[], extra = {}) =>
  runAsSystem(() => notify({ institutionId: f.institutions.A.id, userIds, type: 'grade_released', title: 'Grade ready', message: 'Maths', link: '/x', ...extra }));

describe('in-app notifications', () => {
  it('lists, counts unread, and marks read', async () => {
    await send([f.users.s1.id]);
    await send([f.users.s1.id], { type: 'announcement', title: 'Trip' });
    const s1 = as(f.tokens.s1);
    const list = await s1.get('/api/notifications');
    expect(list.body.unread).toBe(2);
    expect((await s1.post(`/api/notifications/${list.body.items[0].id}/read`, {})).status).toBe(200);
    expect((await as(f.tokens.s2).post(`/api/notifications/${list.body.items[1].id}/read`, {})).status).toBe(404); // not theirs
    await s1.post('/api/notifications/read-all', {});
    expect((await s1.get('/api/notifications?unread=true')).body.items).toEqual([]);
  });

  it('a dedupe key sends a notification only once', async () => {
    expect(await send([f.users.s2.id], { dedupeKey: 'once' })).toBe(1);
    expect(await send([f.users.s2.id], { dedupeKey: 'once' })).toBe(0);
  });
});

describe('delivery by email and push', () => {
  it('follows preferences; push goes to every subscribed browser; dead subscriptions are dropped', async () => {
    clearJobs();
    sentPushes.length = 0;
    const t1 = as(f.tokens.t1);
    const prefs = await t1.get('/api/notifications/preferences');
    expect(prefs.body.push.available).toBe(true);
    expect(prefs.body.types.find((t) => t.key === 'grade_released').default).toEqual({ email: true, push: true });
    await t1.post('/api/notifications/push-subscriptions', { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } });
    await t1.post('/api/notifications/push-subscriptions', { endpoint: 'https://push.example/gone', keys: { p256dh: 'k', auth: 'a' } });
    await t1.put('/api/notifications/preferences', { channels: { announcement: { email: false, push: true } } });
    await send([f.users.t1.id], { type: 'announcement', title: 'Staff meeting' });
    expect(pendingJobs().map((j) => j.name)).toEqual(['notify.deliver']);
    await drainJobs();
    expect(sentPushes.map((p) => p.payload.title)).toEqual(['Staff meeting']);
    const { rows } = await fixture.pool.query(`SELECT channel, status FROM delivery_logs WHERE user_id = $1 ORDER BY id`, [f.users.t1.id]);
    expect(rows).toEqual([{ channel: 'push', status: 'sent' }, { channel: 'push', status: 'failed' }]);
    const subs = await fixture.pool.query(`SELECT endpoint FROM push_subscriptions WHERE user_id = $1`, [f.users.t1.id]);
    expect(subs.rows.map((r) => r.endpoint)).toEqual(['https://push.example/abc']);
    expect((await fixture.outbox('t1@alpha.test')).filter((m) => m.subject === 'Staff meeting')).toEqual([]);
  });

  it('quiet hours hold email and push for later (in-app still arrives)', async () => {
    clearJobs();
    expect(inQuietHours(22 * 60, { start: '21:00', end: '07:00' })).toBe(true);
    expect(inQuietHours(12 * 60, { start: '21:00', end: '07:00' })).toBe(false);
    // quiet all day except one minute: always quiet now
    await as(f.tokens.s2).put('/api/notifications/preferences', { channels: {}, quiet_hours: { start: '00:00', end: '23:59' } });
    await fixture.pool.query(`UPDATE institutions SET timezone = 'UTC' WHERE id = $1`, [f.institutions.A.id]);
    const now = new Date();
    if (now.getUTCHours() === 23 && now.getUTCMinutes() === 59) return; // the one loud minute
    await send([f.users.s2.id], { title: 'Late night grade' });
    await drainJobs();
    expect((await fixture.outbox('s2@alpha.test')).filter((m) => m.subject === 'Late night grade')).toEqual([]);
    expect(pendingJobs()).toHaveLength(1); // retried later
    expect(pendingJobs()[0]!.runAt.getTime()).toBeGreaterThan(Date.now());
    const list = await as(f.tokens.s2).get('/api/notifications');
    expect(list.body.items.some((n) => n.title === 'Late night grade')).toBe(true);
  });
});

describe('live events', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('needs a valid token', async () => {
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
  });

  it('streams a notification to the person it is for', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${f.tokens.s1}` }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const read = async (until: string) => {
      const deadline = Date.now() + 8000;
      while (!text.includes(until) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    await read('event: ready');
    await send([f.users.s2.id], { title: 'Not for s1' });
    await send([f.users.s1.id], { title: 'Live one' });
    await read('Live one');
    ctrl.abort();
    expect(text).toContain('event: notification');
    expect(text).toContain('Live one');
    expect(text).not.toContain('Not for s1');
  });
});

describe('scheduled jobs', () => {
  it('reminds students who haven’t handed in, once', async () => {
    const soon = new Date(Date.now() + 6 * 3600 * 1000);
    await fixture.pool.query(`UPDATE assessments SET due_at = $1 WHERE id = $2`, [soon, f.assignments.ASG1.id]);
    // S2 already handed in
    const sub = (await fixture.pool.query(`INSERT INTO submissions (institution_id, assessment_id, student_id, status, submitted_at) VALUES ($1,$2,$3,'submitted',now()) RETURNING id`, [f.institutions.A.id, f.assignments.ASG1.id, f.students.S2.id])).rows[0];
    expect(sub).toBeTruthy();
    await runJob('reminders.due', {});
    await runJob('reminders.due', {});
    const { rows } = await fixture.pool.query(`SELECT user_id FROM notifications WHERE type = 'due_soon'`);
    expect(rows.map((r) => r.user_id)).toEqual([f.users.s1.id]);
  });

  it('empties the recycle bin after the retention period', async () => {
    const A = as(f.tokens.adminA);
    const st = await A.post('/api/institution/students', { first_name: 'Old', last_name: 'Kid', email: 'old.kid@alpha.test', section_id: f.sections.A1.id });
    await A.delete(`/api/institution/students/${st.body.id}`);
    await runJob('recycle.purge', {});
    expect((await fixture.pool.query(`SELECT 1 FROM students WHERE id = $1`, [st.body.id])).rows).toHaveLength(1); // still within 30 days
    await fixture.pool.query(`UPDATE students SET deleted_at = now() - interval '31 days' WHERE id = $1`, [st.body.id]);
    await runJob('recycle.purge', {});
    expect((await fixture.pool.query(`SELECT 1 FROM students WHERE id = $1`, [st.body.id])).rows).toHaveLength(0);
    expect((await fixture.pool.query(`SELECT 1 FROM users WHERE email = 'old.kid@alpha.test'`)).rows).toHaveLength(0);
  });
});
