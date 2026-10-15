// Discussions (Q&A mode, moderation), scoped announcements, polls, anonymous surveys, live
// classes (join → attendance), the calendar feed, badges and the leaderboard.
import { describe, it, expect, beforeAll } from 'vitest';
import { app, as, fixture, request } from './helpers/http';

let f;
let t1;
let s1;
let s2;
let course: number;

beforeAll(async () => {
  f = await fixture.resetDb();
  t1 = as(f.tokens.t1);
  s1 = as(f.tokens.s1);
  s2 = as(f.tokens.s2);
  course = f.subjects.A1math.id;
});

describe('discussions', () => {
  it('Q&A: students see others’ answers only after posting', async () => {
    const d = await t1.post(`/api/courses/${course}/discussions`, { title: 'What is a fraction?', mode: 'qa' });
    expect(d.status).toBe(201);
    expect((await s1.post(`/api/courses/${course}/discussions`, { title: 'Mine', mode: 'qa' })).status).toBe(403);
    await s1.post(`/api/discussions/${d.body.id}/posts`, { body_html: '<p>A part of a whole</p>' });
    const before = await s2.get(`/api/discussions/${d.body.id}`);
    expect(before.body.hidden_until_post).toBe(true);
    expect(before.body.posts).toHaveLength(0);
    await s2.post(`/api/discussions/${d.body.id}/posts`, { body_html: '<p>A ratio</p>' });
    const after = await s2.get(`/api/discussions/${d.body.id}`);
    expect(after.body.posts).toHaveLength(2);
    // outsiders can't read it
    expect((await as(f.tokens.s3).get(`/api/discussions/${d.body.id}`)).status).toBe(403);
  });

  it('staff hide posts and lock discussions', async () => {
    const d = await s1.post(`/api/courses/${course}/discussions`, { title: 'Open chat' });
    const p = await s2.post(`/api/discussions/${d.body.id}/posts`, { body_html: '<p>rude</p>' });
    expect((await s1.post(`/api/posts/${p.body.id}/moderate`, { hidden: true })).status).toBe(403);
    expect((await t1.post(`/api/posts/${p.body.id}/moderate`, { hidden: true })).status).toBe(200);
    expect((await s1.get(`/api/discussions/${d.body.id}`)).body.posts).toHaveLength(0);
    expect((await t1.get(`/api/discussions/${d.body.id}`)).body.posts).toHaveLength(1);
    await t1.patch(`/api/discussions/${d.body.id}`, { locked: true });
    expect((await s1.post(`/api/discussions/${d.body.id}/posts`, { body_html: '<p>hi</p>' })).status).toBe(409);
    expect((await s2.patch(`/api/posts/${p.body.id}`, { body_html: '<p>sorry</p>' })).status).toBe(200);
    expect((await s1.patch(`/api/posts/${p.body.id}`, { body_html: '<p>x</p>' })).status).toBe(403);
  });
});

describe('announcements by scope', () => {
  it('a course announcement reaches that course only; teachers post only to their courses', async () => {
    expect((await t1.post('/api/announcements', { title: 'Everyone!', description: 'x' })).status).toBe(403);
    expect((await t1.post('/api/announcements', { title: 'Hack', offering_id: f.subjects.A2math.id })).status).toBe(403);
    const ok = await t1.post('/api/announcements', { title: 'Test on Friday', description: 'Chapters 1–3', offering_id: course, target_audience: 'Students' });
    expect(ok.status).toBe(201);
    expect((await s1.get('/api/announcements')).body.map((a) => a.title)).toContain('Test on Friday');
    expect((await as(f.tokens.s3).get('/api/announcements')).body.map((a) => a.title)).not.toContain('Test on Friday');
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM notifications WHERE type = 'announcement'`);
    expect(rows[0].n).toBe(2);
  });

  it('a section announcement from the office reaches its students and parents', async () => {
    const res = await as(f.tokens.adminA).post('/api/announcements', { title: 'A1 trip', description: 'Bring lunch', section_id: f.sections.A1.id });
    expect(res.status).toBe(201);
    const { rows } = await fixture.pool.query(`SELECT user_id FROM notifications WHERE title = 'A1 trip' ORDER BY user_id`);
    expect(rows.map((r) => r.user_id).sort()).toEqual([f.users.s1.id, f.users.s2.id, f.users.p1.id].sort());
    expect((await as(f.tokens.p1).get('/api/announcements')).body.map((a) => a.title)).toContain('A1 trip');
  });
});

describe('polls and surveys', () => {
  it('a poll counts one vote per person', async () => {
    const p = await t1.post('/api/polls', { offering_id: course, question: 'Harder?', options: ['Yes', 'No'] });
    await s1.post(`/api/polls/${p.body.id}/vote`, { choices: [0] });
    await s1.post(`/api/polls/${p.body.id}/vote`, { choices: [1] });
    await s2.post(`/api/polls/${p.body.id}/vote`, { choices: [1] });
    expect((await s2.post(`/api/polls/${p.body.id}/vote`, { choices: [0, 1] })).status).toBe(400);
    const r = await t1.get(`/api/polls/${p.body.id}/results`);
    expect(r.body.options).toEqual([{ label: 'Yes', votes: 0 }, { label: 'No', votes: 2 }]);
    expect(r.body.voters).toBeUndefined(); // anonymous
  });

  it('an anonymous course evaluation: one answer each, no names, no breakdown under 3', async () => {
    const sv = await t1.post('/api/surveys', {
      offering_id: course, title: 'How is the course?', status: 'open',
      questions: [{ id: 'q1', kind: 'rating', label: 'Overall', required: true }, { id: 'q2', kind: 'text', label: 'Comments' }],
    });
    expect(sv.status).toBe(201);
    expect((await as(f.tokens.s3).post(`/api/surveys/${sv.body.id}/responses`, { answers: { q1: 4 } })).status).toBe(403);
    expect((await s1.post(`/api/surveys/${sv.body.id}/responses`, { answers: {} })).status).toBe(400);
    expect((await s1.post(`/api/surveys/${sv.body.id}/responses`, { answers: { q1: 9 } })).status).toBe(400);
    expect((await s1.post(`/api/surveys/${sv.body.id}/responses`, { answers: { q1: 4, q2: 'Good' } })).status).toBe(201);
    expect((await s1.post(`/api/surveys/${sv.body.id}/responses`, { answers: { q1: 5 } })).status).toBe(409);
    const { rows } = await fixture.pool.query(`SELECT respondent_id FROM survey_responses`);
    expect(rows).toEqual([{ respondent_id: null }]);
    const res = await t1.get(`/api/surveys/${sv.body.id}/results`);
    expect(res.body.questions[0].hidden).toBe(true);
    expect((await s1.get(`/api/surveys/${sv.body.id}/results`)).status).toBe(403);
  });
});

describe('live classes', () => {
  it('joining through Acadex logs it and marks the student present', async () => {
    const bad = await t1.post(`/api/courses/${course}/live`, { title: 'Zoom', provider: 'zoom', join_url: 'https://evil.example/zoom', starts_at: new Date().toISOString() });
    expect(bad.status).toBe(400);
    const live = await t1.post(`/api/courses/${course}/live`, { title: 'Revision', provider: 'jitsi', starts_at: new Date(Date.now() - 5 * 60000).toISOString() });
    expect(live.status).toBe(201);
    expect(live.body.join_url).toMatch(/^https:\/\/meet\.jit\.si\/acadex-/);
    const list = await s1.get(`/api/courses/${course}/live`);
    expect(list.body[0].join_url).toBeUndefined(); // only through the join link
    const join = await s1.post(`/api/live/${live.body.id}/join`, {});
    expect(join.body.join_url).toBe(live.body.join_url);
    const { rows } = await fixture.pool.query(`SELECT r.status, r.method FROM attendance_records r WHERE r.student_id = $1`, [f.students.S1.id]);
    expect(rows).toEqual([{ status: 'present', method: 'live' }]);
    expect((await as(f.tokens.s3).post(`/api/live/${live.body.id}/join`, {})).status).toBe(403);
  });
});

describe('calendar', () => {
  it('my calendar and a private ICS feed', async () => {
    const due = new Date(Date.now() + 2 * 86400000).toISOString();
    await t1.post(`/api/courses/${course}/assessments`, { title: 'Calendar HW', due_at: due, status: 'published' }).then((r) => {
      if (r.status === 409) return t1.post(`/api/courses/${course}/assessments`, { title: 'Calendar HW', due_at: new Date(Date.now() + 3 * 86400000).toISOString(), status: 'published' });
      return r;
    });
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const cal = await s1.get(`/api/calendar/me?from=${from}&to=${to}`);
    expect(cal.body.some((e) => e.kind === 'due' && e.title === 'Calendar HW')).toBe(true);
    const feed = await s1.post('/api/calendar/feed', {});
    const path = new URL(feed.body.url).pathname;
    const ics = await request(app).get(path);
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VCALENDAR');
    expect(ics.text).toContain('Due: Calendar HW');
    // a new link cancels the old one
    await s1.post('/api/calendar/feed', {});
    expect((await request(app).get(path)).status).toBe(404);
  });
});

describe('badges and the leaderboard', () => {
  it('the leaderboard is off unless the institution turns it on', async () => {
    expect((await s1.get(`/api/courses/${course}/leaderboard`)).status).toBe(404);
    await fixture.pool.query(`UPDATE institutions SET settings = settings || '{"gamification":{"enabled":true,"leaderboard":true}}' WHERE id = $1`, [f.institutions.A.id]);
    expect((await as(f.tokens.adminA).post('/api/badges', { name: 'Starter', criteria: { kind: 'items_completed', threshold: 1 } })).status).toBe(201);
    expect((await t1.post('/api/badges', { name: 'Nope', criteria: { kind: 'manual' } })).status).toBe(403);
    const m = await t1.post(`/api/courses/${course}/modules`, { title: 'M', published: true });
    const it = await t1.post('/api/content-items', { module_id: m.body.id, kind: 'page', title: 'P', completion: 'mark_done' });
    await s1.put(`/api/content-items/${it.body.id}/progress`, { status: 'done' });
    const ach = await s1.get('/api/me/achievements');
    expect(ach.body.points).toBe(10);
    expect(ach.body.badges.map((b) => b.name)).toEqual(['Starter']);
    const lb = await s1.get(`/api/courses/${course}/leaderboard`);
    expect(lb.body[0]).toEqual({ student_id: f.students.S1.id, name: 'Sara', points: 10 });
  });
});
