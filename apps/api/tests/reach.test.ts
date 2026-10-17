// Phase 5 — reach and communication: messaging with safeguarding rules (who may message whom,
// guardians copied for students under 18, profanity, reports, review, locking), help-desk
// tickets, parent–teacher meetings, emergency broadcasts, digests, SMS / WhatsApp delivery and
// retry, live-class provider accounts with Zoom webhooks, and account preferences.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app, as, fixture, request } from './helpers/http';
import { clearJobs, drainJobs, runJob } from '../src/jobs';
import { sentMessages } from '../src/lib/messaging';
import { fakeMeetings, zoomSignature } from '../src/lib/live';

let f;
const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;
const setSettings = (patch: Record<string, unknown>) => q(`UPDATE institutions SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [f.institutions.A.id, JSON.stringify(patch)]);

beforeAll(async () => {
  f = await fixture.resetDb();
  clearJobs();
  // Sara's guardian (p1) has an account; Sam's guardian only a phone number
  const g2 = (await q(`INSERT INTO guardians (institution_id, first_name, phone) VALUES ($1,'Guardian','0300 1112223') RETURNING id`, [f.institutions.A.id]))[0];
  await q(`INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship) VALUES ($1,$2,$3,'father')`, [f.institutions.A.id, g2.id, f.students.S2.id]);
  await q(`UPDATE guardians SET phone = '03001234567' WHERE id = $1`, [f.guardians.G1.id]);
});
beforeEach(() => clearJobs());

describe('messaging and safeguarding', () => {
  it('a teacher writing to a student under 18 copies the guardians in (default policy)', async () => {
    const r = await as(f.tokens.t1).post('/api/conversations', { user_ids: [f.users.s1.id], body: 'Please bring your notebook tomorrow' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.safeguarded).toBe(true);
    expect(r.body.cc).toBe(1);
    const c = await as(f.tokens.p1).get(`/api/conversations/${r.body.id}`);
    expect(c.status).toBe(200);
    expect(c.body.my_role).toBe('cc');
    expect(c.body.messages.map((m) => m.body)).toEqual(['Please bring your notebook tomorrow']);
    // writing again continues the same conversation
    const again = await as(f.tokens.t1).post('/api/conversations', { user_ids: [f.users.s1.id], body: 'And your calculator' });
    expect(again.body.id).toBe(r.body.id);
    expect((await as(f.tokens.s1).get('/api/conversations/unread')).body.unread).toBe(2);
  });

  it('blocks what the rules do not allow', async () => {
    expect((await as(f.tokens.t1).post('/api/conversations', { user_ids: [f.users.s3.id], body: 'hi' })).status).toBe(403); // not their student
    expect((await as(f.tokens.s1).post('/api/conversations', { user_ids: [f.users.s2.id], body: 'hi' })).status).toBe(403); // classmates: off by default
    expect((await as(f.tokens.s1).post('/api/conversations', { user_ids: [f.users.t2.id], body: 'hi' })).status).toBe(403); // not their teacher
    expect((await as(f.tokens.p1).post('/api/conversations', { user_ids: [f.users.t2.id], body: 'hi' })).status).toBe(403); // not the child's teacher
    expect((await as(f.tokens.p1).post('/api/conversations', { user_ids: [f.users.s2.id], body: 'hi' })).status).toBe(403); // someone else's child
    expect((await as(f.tokens.tb).post('/api/conversations', { user_ids: [f.users.s1.id], body: 'hi' })).status).toBe(400); // another institution
    expect((await as(f.tokens.p1).post('/api/conversations', { user_ids: [f.users.t1.id], body: 'About Sara' })).status).toBe(201);
  });

  it('follows the institution policy: blocked, allowed, classmates', async () => {
    await setSettings({ messaging: { minor_dm: 'blocked', student_to_student: true } });
    const blocked = await as(f.tokens.t2).post('/api/conversations', { user_ids: [f.users.s3.id], body: 'hi' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/class group/);
    expect((await as(f.tokens.s1).post('/api/conversations', { user_ids: [f.users.s2.id], body: 'homework?' })).status).toBe(201);
    await setSettings({ messaging: { minor_dm: 'allowed' } });
    const open = await as(f.tokens.t2).post('/api/conversations', { user_ids: [f.users.s3.id], body: 'hi' });
    expect(open.status).toBe(201);
    expect(open.body.safeguarded).toBe(false);
    await setSettings({ messaging: { enabled: false } });
    expect((await as(f.tokens.t1).post(`/api/conversations/${open.body.id}/messages`, { body: 'x' })).status).toBe(403);
    await setSettings({ messaging: {} });
  });

  it('masks profanity, keeps withdrawn messages for review, takes reports and locks', async () => {
    const c = await as(f.tokens.t1).post('/api/conversations', { user_ids: [f.users.t2.id], body: 'Staff meeting at 2' });
    const m = await as(f.tokens.t2).post(`/api/conversations/${c.body.id}/messages`, { body: 'this is bullshit' });
    expect(m.body.body).not.toMatch(/bullshit/);
    expect(m.body.flagged).toBe(true);
    // not a member: invisible; the safeguarding lead (admin) can read it, audited
    expect((await as(f.tokens.s1).get(`/api/conversations/${c.body.id}`)).status).toBe(404);
    const review = await as(f.tokens.adminA).get(`/api/conversations/${c.body.id}`);
    expect(review.status).toBe(200);
    expect(review.body.reviewer).toBe(true);
    expect((await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'safeguarding_view'`))[0].n).toBeGreaterThan(0);
    const queue = await as(f.tokens.adminA).get('/api/safeguarding/queue');
    expect(queue.body.flagged.some((x) => x.message_id === m.body.id)).toBe(true);
    // report, then hide the message and lock the conversation
    const rep = await as(f.tokens.t1).post(`/api/messages/${m.body.id}/report`, { reason: 'Rude' });
    expect(rep.status).toBe(201);
    expect((await as(f.tokens.s1).post(`/api/messages/${m.body.id}/report`, { reason: 'x' })).status).toBe(404); // not a member
    const done = await as(f.tokens.adminA).patch(`/api/safeguarding/reports/${rep.body.id}`, { status: 'actioned', hide_message: true, lock_conversation: true });
    expect(done.status).toBe(200);
    const member = await as(f.tokens.t1).get(`/api/conversations/${c.body.id}`);
    expect(member.body.messages.map((x) => x.id)).not.toContain(m.body.id);
    expect((await as(f.tokens.adminA).get(`/api/conversations/${c.body.id}`)).body.messages.map((x) => x.id)).toContain(m.body.id);
    expect((await as(f.tokens.t1).post(`/api/conversations/${c.body.id}/messages`, { body: 'hello?' })).status).toBe(403);
    expect((await as(f.tokens.t1).get('/api/safeguarding/queue')).status).toBe(403);
  });

  it('tells the safeguarding lead when a student may be in distress', async () => {
    const c = await as(f.tokens.s1).post('/api/conversations', { user_ids: [f.users.t1.id], body: 'I want to die' });
    expect(c.status).toBe(201);
    const n = await q(`SELECT title FROM notifications WHERE user_id = $1 AND title LIKE 'Safeguarding%'`, [f.users.adminA.id]);
    expect(n.length).toBe(1);
  });

  it('class groups include the roster; contacts follow the rules', async () => {
    const r = await as(f.tokens.t1).post('/api/conversations/class', { offering_id: f.subjects.A1math.id, body: 'Test on Friday', include_guardians: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const c = await as(f.tokens.s2).get(`/api/conversations/${r.body.id}`);
    expect(c.body.members.map((x) => x.id)).toEqual(expect.arrayContaining([f.users.t1.id, f.users.s1.id, f.users.s2.id, f.users.p1.id]));
    expect((await as(f.tokens.t2).post('/api/conversations/class', { offering_id: f.subjects.A1math.id, body: 'x' })).status).toBe(403);
    const contacts = await as(f.tokens.t1).get('/api/messages/contacts');
    const ids = contacts.body.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([f.users.s1.id, f.users.p1.id, f.users.t2.id]));
    expect(ids).not.toContain(f.users.s3.id);
    const list = await as(f.tokens.s2).get('/api/conversations');
    expect(list.headers['x-total-count']).toBeDefined();
  });
});

describe('tickets', () => {
  it('raise → assign → reply → resolve → rate, with internal notes and anonymity', async () => {
    const s1 = as(f.tokens.s1);
    const t = await s1.post('/api/tickets', { category: 'facilities', subject: 'Broken fan in A1', body: 'The fan does not work', anonymous: true });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.due_at).toBeTruthy();
    const admin = as(f.tokens.adminA);
    const list = await admin.get('/api/tickets');
    const row = list.body.find((x) => x.id === t.body.id);
    expect(row.raised_by_name).toBeNull(); // anonymous
    expect((await as(f.tokens.t1).get(`/api/tickets/${t.body.id}`)).status).toBe(404);
    expect((await admin.patch(`/api/tickets/${t.body.id}`, { assigned_to: f.users.s2.id })).status).toBe(400); // not staff
    expect((await admin.patch(`/api/tickets/${t.body.id}`, { assigned_to: f.users.t1.id, status: 'in_progress' })).status).toBe(200);
    const t1 = as(f.tokens.t1);
    expect((await t1.get(`/api/tickets/${t.body.id}`)).status).toBe(200);
    expect((await t1.patch(`/api/tickets/${t.body.id}`, { priority: 'urgent' })).status).toBe(403); // assignee: status only
    await t1.post(`/api/tickets/${t.body.id}/comments`, { body: 'Electrician called', internal: true });
    await t1.post(`/api/tickets/${t.body.id}/comments`, { body: 'Fixed by Friday' });
    const mine = await s1.get(`/api/tickets/${t.body.id}`);
    expect(mine.body.comments.map((c) => c.body)).toEqual(['Fixed by Friday']);
    expect((await s1.post(`/api/tickets/${t.body.id}/rating`, { satisfaction: 5 })).status).toBe(409);
    await t1.patch(`/api/tickets/${t.body.id}`, { status: 'resolved' });
    expect((await q(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'ticket_update' AND title LIKE '%resolved%'`, [f.users.s1.id])).length).toBe(1);
    expect((await s1.post(`/api/tickets/${t.body.id}/rating`, { satisfaction: 4 })).status).toBe(200);
    // the raiser replying reopens it
    await s1.post(`/api/tickets/${t.body.id}/comments`, { body: 'Still broken' });
    expect((await admin.get(`/api/tickets/${t.body.id}`)).body.status).toBe('open');
    expect((await admin.get('/api/tickets-summary')).body.open).toBeGreaterThan(0);
  });

  it('guardians raise tickets only about their own children', async () => {
    expect((await as(f.tokens.p1).post('/api/tickets', { category: 'fees', subject: 'Fee', body: 'x', student_id: f.students.S3.id })).status).toBe(400);
    const ok = await as(f.tokens.p1).post('/api/tickets', { category: 'fees', subject: 'Fee query', body: 'x', student_id: f.students.S1.id, priority: 'urgent' });
    expect(ok.body.priority).toBe('high');
  });
});

describe('parent–teacher meetings', () => {
  let eventId: number;
  it('creates slots for every teacher of the sections and lets guardians book one per teacher', async () => {
    const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const r = await as(f.tokens.adminA).post('/api/ptm', { title: 'Term 1 PTM', date: day, start_time: '09:00', end_time: '10:00', slot_minutes: 10, section_ids: [f.sections.A1.id], mode: 'online' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ slots: 6, teachers: 1 });
    eventId = r.body.id;
    expect((await as(f.tokens.t1).post('/api/ptm', { title: 'x', date: day, start_time: '09:00', end_time: '10:00', section_ids: [f.sections.A1.id] })).status).toBe(403);
    const fam = await as(f.tokens.p1).get(`/api/ptm/${eventId}`);
    expect(fam.body.view).toBe('family');
    const slots = fam.body.children[0].teachers[0].slots;
    expect(slots).toHaveLength(6);
    const book = await as(f.tokens.p1).post(`/api/ptm-slots/${slots[0].id}/book`, { student_id: f.students.S1.id, note: 'Maths progress' });
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    expect(book.body.join_url).toMatch(/^https:\/\/meet\.jit\.si\//);
    expect((await as(f.tokens.p1).post(`/api/ptm-slots/${slots[1].id}/book`, { student_id: f.students.S1.id })).status).toBe(409); // one per teacher
    expect((await as(f.tokens.p1).post(`/api/ptm-slots/${slots[1].id}/book`, { student_id: f.students.S3.id })).status).toBe(404); // not their child
    expect((await as(f.tokens.s1).get(`/api/ptm/${eventId}`)).status).toBe(404); // students book only when allowed
    expect((await as(f.tokens.t2).get(`/api/ptm/${eventId}`)).status).toBe(404);
    const teacher = await as(f.tokens.t1).get(`/api/ptm/${eventId}`);
    expect(teacher.body.view).toBe('teacher');
    expect(teacher.body.slots.find((s) => s.id === slots[0].id).student).toBe('Sara S');
    expect((await as(f.tokens.t1).patch(`/api/ptm-slots/${slots[0].id}`, { status: 'blocked' })).status).toBe(409);
    expect((await as(f.tokens.t1).patch(`/api/ptm-slots/${slots[2].id}`, { status: 'blocked' })).status).toBe(200);
    expect((await as(f.tokens.t1).patch(`/api/ptm-slots/${slots[0].id}`, { status: 'done', note: 'Went well' })).status).toBe(200);
    expect((await as(f.tokens.p1).get('/api/ptm')).body.map((e) => e.id)).toContain(eventId);
  });

  it('cancelling reopens the slot', async () => {
    const fam = await as(f.tokens.p1).get(`/api/ptm/${eventId}`);
    const open = fam.body.children[0].teachers[0].slots.filter((s) => s.state === 'open');
    await q(`UPDATE ptm_slots SET status = 'open', student_id = NULL, booked_by = NULL WHERE event_id = $1 AND status = 'done'`, [eventId]);
    const b = await as(f.tokens.p1).post(`/api/ptm-slots/${open[0].id}/book`, { student_id: f.students.S1.id });
    expect(b.status).toBe(200);
    expect((await as(f.tokens.p1).post(`/api/ptm-slots/${open[0].id}/cancel`, {})).status).toBe(200);
    expect((await q(`SELECT status FROM ptm_slots WHERE id = $1`, [open[0].id]))[0].status).toBe('open');
  });
});

describe('emergency broadcasts and delivery', () => {
  it('reaches accounts on every channel and guardians without an account by SMS, ignoring quiet hours', async () => {
    sentMessages.length = 0;
    await as(f.tokens.p1).put('/api/notifications/preferences', { channels: {}, quiet_hours: { start: '00:00', end: '23:59' } });
    const r = await as(f.tokens.adminA).post('/api/broadcasts', { title: 'School closed tomorrow', message: 'Heavy rain: the school is closed on Monday.', audience: 'guardians', channels: ['app', 'email', 'sms'] });
    expect(r.status).toBe(202);
    await drainJobs();
    expect((await q(`SELECT type FROM notifications WHERE user_id = $1 AND title = 'School closed tomorrow'`, [f.users.p1.id]))[0].type).toBe('emergency');
    const to = sentMessages.map((m) => m.to);
    expect(to).toContain('+923001234567'); // p1's phone (account)
    expect(to).toContain('+923001112223'); // a guardian without an account
    expect((await fixture.outbox('p1@alpha.test')).some((m) => m.subject === 'School closed tomorrow')).toBe(true);
    const list = await as(f.tokens.adminA).get('/api/broadcasts');
    expect(list.body[0].counts.phones_without_account).toBe(1);
    expect((await as(f.tokens.t1).post('/api/broadcasts', { title: 'x', message: 'y' })).status).toBe(403);
    await as(f.tokens.p1).put('/api/notifications/preferences', { channels: {}, quiet_hours: null });
  });

  it('sends notifications by SMS when the person and the institution choose it', async () => {
    sentMessages.length = 0;
    await as(f.tokens.p1).put('/api/notifications/preferences', { channels: { fee_due: { email: false, push: false, sms: true, whatsapp: false } } });
    const { notify } = await import('../src/lib/notify');
    const { runAsSystem } = await import('../src/db/context');
    await runAsSystem(() => notify({ institutionId: f.institutions.A.id, userIds: [f.users.p1.id], type: 'fee_due', title: 'Fee due', message: 'Tuition' }));
    await drainJobs();
    expect(sentMessages).toEqual([]); // the institution has not turned on notifications by phone
    await setSettings({ notify_by_phone: true });
    const prefs = await as(f.tokens.p1).get('/api/notifications/preferences');
    expect(prefs.body.phone.sms).toBe(true);
    await runAsSystem(() => notify({ institutionId: f.institutions.A.id, userIds: [f.users.p1.id], type: 'fee_due', title: 'Fee due again', message: 'Tuition' }));
    await drainJobs();
    expect(sentMessages.map((m) => m.text)).toEqual([expect.stringContaining('Fee due again')]);
  });

  it('logs deliveries and retries failures', async () => {
    const log = (await q(`INSERT INTO delivery_logs (institution_id, channel, status, error, to_address, body) VALUES ($1,'sms','failed','timeout','+923009998887','Retry me') RETURNING id`, [f.institutions.A.id]))[0];
    const admin = as(f.tokens.adminA);
    const list = await admin.get('/api/delivery-logs?status=failed');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.find((l) => l.id === log.id).retryable).toBe(true);
    const r = await admin.post(`/api/delivery-logs/${log.id}/retry`, {});
    expect(r.body.ok).toBe(true);
    expect((await q(`SELECT status, attempts FROM delivery_logs WHERE id = $1`, [log.id]))[0]).toEqual({ status: 'sent', attempts: 2 });
    expect((await admin.post(`/api/delivery-logs/${log.id}/retry`, {})).status).toBe(409);
    expect((await as(f.tokens.t1).get('/api/delivery-logs')).status).toBe(403);
  });

  it('a daily digest replaces single emails and goes out at 18:00 local time', async () => {
    await as(f.tokens.s2).put('/api/notifications/preferences', { channels: {}, digest: 'daily' });
    const { notify } = await import('../src/lib/notify');
    const { runAsSystem } = await import('../src/db/context');
    await runAsSystem(() => notify({ institutionId: f.institutions.A.id, userIds: [f.users.s2.id], type: 'grade_released', title: 'Your essay was graded', message: 'B+' }));
    await drainJobs();
    expect((await fixture.outbox('s2@alpha.test')).some((m) => m.subject === 'Your essay was graded')).toBe(false);
    const tz = (await q(`SELECT timezone FROM institutions WHERE id = $1`, [f.institutions.A.id]))[0].timezone;
    // 18:10 local time, some minutes after the notification
    const now = new Date(Date.now() + 60_000);
    const offsetMin = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').reduce((h, m) => String(Number(h) * 60 + Number(m))));
    const at = new Date(now.getTime() + (((18 * 60 + 10 - offsetMin) % 1440) + 1440) % 1440 * 60_000);
    await runJob('notify.digest', { now: at.toISOString() });
    const mail = (await fixture.outbox('s2@alpha.test')).filter((m) => /update/.test(m.subject));
    expect(mail.length).toBe(1);
    // not twice
    await runJob('notify.digest', { now: new Date(at.getTime() + 5 * 60_000).toISOString() });
    expect((await fixture.outbox('s2@alpha.test')).filter((m) => /update/.test(m.subject)).length).toBe(1);
  });
});

describe('live-class providers', () => {
  it('creates meetings on a connected account; secrets are never returned', async () => {
    const admin = as(f.tokens.adminA);
    const t1 = as(f.tokens.t1);
    const course = f.subjects.A1math.id;
    const starts = new Date(Date.now() + 3600_000).toISOString();
    expect((await t1.post(`/api/courses/${course}/live`, { title: 'Algebra', provider: 'zoom', starts_at: starts })).status).toBe(400);
    expect((await t1.put('/api/integrations/live', { provider: 'zoom', account_id: 'a', client_id: 'c', client_secret: 's' })).status).toBe(403);
    expect((await admin.put('/api/integrations/live', { provider: 'zoom', account_id: 'acc', client_id: 'cid', client_secret: 'zoom-secret', webhook_secret: 'hook-secret' })).status).toBe(200);
    expect((await admin.put('/api/integrations/live', { provider: 'meet', client_email: 'sa@x.iam', private_key: 'nope', organizer: 'o@x.com' })).status).toBe(400);
    const list = await admin.get('/api/integrations/live');
    expect(JSON.stringify(list.body)).not.toMatch(/zoom-secret|hook-secret/);
    expect(list.body.find((p) => p.provider === 'zoom')).toMatchObject({ connected: true, has_secret: true });
    const r = await t1.post(`/api/courses/${course}/live`, { title: 'Algebra', provider: 'zoom', starts_at: starts });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.join_url).toMatch(/zoom\.us\/j\//);
    expect(r.body.external_id).toMatch(/^fake-zoom-/);
    expect(fakeMeetings.at(-1)).toMatchObject({ provider: 'zoom' });
    const staff = await t1.get(`/api/courses/${course}/live`);
    expect(staff.body[0].host_url).toBeTruthy();
    const student = await as(f.tokens.s1).get(`/api/courses/${course}/live`);
    expect(student.body[0].host_url).toBeUndefined();
  });

  it('Zoom webhooks: URL validation, signature check, joins mark attendance, recordings are saved', async () => {
    const inst = f.institutions.A.id;
    const live = (await q(`SELECT id, external_id FROM live_sessions WHERE provider = 'zoom' ORDER BY id DESC LIMIT 1`))[0];
    const post = (body: unknown, secret = 'hook-secret') => {
      const raw = JSON.stringify(body);
      const ts = String(Math.floor(Date.now() / 1000));
      return request(app).post(`/api/integrations/zoom/webhook/${inst}`).set('Content-Type', 'application/json').set('x-zm-request-timestamp', ts).set('x-zm-signature', zoomSignature(secret, ts, raw)).send(raw);
    };
    const v = await post({ event: 'endpoint.url_validation', payload: { plainToken: 'abc' } });
    expect(v.status).toBe(200);
    expect(v.body.plainToken).toBe('abc');
    expect(v.body.encryptedToken).toMatch(/^[0-9a-f]{64}$/);
    expect((await post({ event: 'endpoint.url_validation', payload: { plainToken: 'abc' } }, 'wrong')).status).toBe(401);
    await q(`UPDATE live_sessions SET starts_at = now() WHERE id = $1`, [live.id]);
    const j = await post({ event: 'meeting.participant_joined', payload: { object: { id: live.external_id, participant: { email: 's1@alpha.test', join_time: new Date().toISOString() } } } });
    expect(j.status).toBe(200);
    const att = await q(`SELECT r.status, r.method FROM attendance_records r WHERE r.student_id = $1 AND r.method = 'live'`, [f.students.S1.id]);
    expect(att[0]).toEqual({ status: 'present', method: 'live' });
    await post({ event: 'recording.completed', payload: { object: { id: live.external_id, share_url: 'https://zoom.us/rec/share/abc' } } });
    expect((await q(`SELECT recording_url FROM live_sessions WHERE id = $1`, [live.id]))[0].recording_url).toBe('https://zoom.us/rec/share/abc');
  });
});

describe('account preferences', () => {
  it('keeps the language and low-bandwidth mode on the account', async () => {
    const r = await as(f.tokens.s1).put('/api/notifications/account-preferences', { locale: 'ur', low_bandwidth: true });
    expect(r.body).toEqual({ locale: 'ur', low_bandwidth: true });
    const me = await as(f.tokens.s1).get('/api/auth/me');
    expect(me.body.user ?? me.body).toMatchObject({ locale: 'ur', low_bandwidth: true });
    expect((await as(f.tokens.s1).put('/api/notifications/account-preferences', { locale: 'fr' })).status).toBe(400);
  });
});
