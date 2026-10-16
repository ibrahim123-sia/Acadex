// Secure exam mode: settings kept from students (the access code only as a keyed hash), the
// campus-network allowlist, the access code, one question at a time with no going back, and
// the automatic hand-in after leaving the exam too often.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';
import { pool } from './helpers/fixture';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
let t1: ReturnType<typeof as>;
let s1: ReturnType<typeof as>;
let quiz = 0;
const qids: number[] = [];

beforeAll(async () => {
  f = await fixture.resetDb();
  t1 = as(f.tokens.t1);
  s1 = as(f.tokens.s1);
  const course = f.courses['A1-MATH'].id;
  const bank = await t1.post('/api/question-banks', { name: 'Exam bank', course_id: course });
  for (const n of [1, 2, 3]) {
    const q = await t1.post('/api/questions', { bank_id: bank.body.id, type: 'numeric', prompt_html: `<p>${n} + ${n}?</p>`, data: { answer: n * 2, tolerance: 0 }, points: 1 });
    qids.push(q.body.id);
  }
  const a = await t1.post(`/api/courses/${course}/assessments`, { kind: 'quiz', title: 'Final (online)', points: 3, status: 'published', allowed_attempts: 2, quiz: { time_limit_minutes: 30, show_results: 'after_submit' } });
  quiz = a.body.id;
  await t1.put(`/api/assessments/${quiz}/questions`, { items: qids.map((question_id) => ({ question_id })) });
});

describe('secure exam mode', () => {
  it('only course staff set it; bad networks are refused; the code is never shown back', async () => {
    expect((await s1.put(`/api/assessments/${quiz}/secure`, { enabled: true })).status).toBe(403);
    expect((await t1.put(`/api/assessments/${quiz}/secure`, { ip_allowlist: ['999.1.1.1/8'] })).status).toBe(400);
    const res = await t1.put(`/api/assessments/${quiz}/secure`, { access_code: 'ROOM12', ip_allowlist: ['10.0.0.0/8'], lock_navigation: true, max_violations: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, has_access_code: true, lock_navigation: true });
    expect(JSON.stringify(res.body)).not.toMatch(/ROOM12|access_code_hash/);
    const { rows } = await pool.query(`SELECT secure FROM assessments WHERE id = $1`, [quiz]);
    expect(rows[0].secure.access_code_hash).toMatch(/^[0-9a-f]{64}$/);
    // students see what to expect, not the settings
    const view = await s1.get(`/api/assessments/${quiz}`);
    expect(view.body.secure).toEqual({ requires_code: true, network_restricted: true, require_fullscreen: true, lock_navigation: true, block_copy_paste: true, max_violations: 3 });
  });

  it('refuses a start off the campus network, then without the right code', async () => {
    const off = await s1.post(`/api/assessments/${quiz}/attempts`, { access_code: 'ROOM12' });
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('NETWORK');
    // the test client connects from 127.0.0.1
    await t1.put(`/api/assessments/${quiz}/secure`, { ip_allowlist: ['127.0.0.0/8', '::1/128'], lock_navigation: true, max_violations: 3 });
    expect((await s1.post(`/api/assessments/${quiz}/attempts`, {})).body.code).toBe('ACCESS_CODE');
    expect((await s1.post(`/api/assessments/${quiz}/attempts`, { access_code: 'WRONG1' })).body.code).toBe('ACCESS_CODE');
    expect((await s1.post(`/api/assessments/${quiz}/attempts`, { access_code: 'room12' })).status).toBe(201); // not case-sensitive
  });

  it('one question at a time, no going back', async () => {
    const start = await s1.post(`/api/assessments/${quiz}/attempts`, {}); // resuming needs no code
    expect(start.status).toBe(201);
    const id = start.body.id;
    let view = await s1.get(`/api/attempts/${id}`);
    expect(view.body.questions).toHaveLength(1);
    expect(view.body).toMatchObject({ position: 0, total_questions: 3, one_at_a_time: true });
    const first = view.body.questions[0].question_id;
    expect((await s1.put(`/api/attempts/${id}/answers`, { question_id: first, response: 99 })).status).toBe(200);
    const other = qids.find((q) => q !== first)!;
    expect((await s1.put(`/api/attempts/${id}/answers`, { question_id: other, response: 1 })).body.code).toBe('LOCKED');
    expect((await s1.post(`/api/attempts/${id}/next`, {})).body).toEqual({ position: 1, last: false });
    view = await s1.get(`/api/attempts/${id}`);
    expect(view.body.questions[0].question_id).not.toBe(first);
    // back to the first question: refused
    expect((await s1.put(`/api/attempts/${id}/answers`, { question_id: first, response: 2 })).body.code).toBe('LOCKED');
    // staff see every question
    expect((await t1.get(`/api/attempts/${id}`)).body.questions).toHaveLength(3);
  });

  it('hands the attempt in after too many times leaving the exam, and logs them for staff', async () => {
    const id = (await s1.post(`/api/assessments/${quiz}/attempts`, {})).body.id;
    expect((await s1.post(`/api/attempts/${id}/events`, { kind: 'paste' })).status).toBe(204); // logged, not a violation
    expect((await s1.post(`/api/attempts/${id}/events`, { kind: 'blur' })).body).toEqual({ violations: 1, max: 3, auto_submitted: false });
    await s1.post(`/api/attempts/${id}/events`, { kind: 'fullscreen_exit' });
    expect((await s1.post(`/api/attempts/${id}/events`, { kind: 'visibility_hidden' })).body.auto_submitted).toBe(true);
    const { rows } = await pool.query(`SELECT status FROM quiz_attempts WHERE id = $1`, [id]);
    expect(rows[0].status).not.toBe('in_progress');
    const log = await t1.get(`/api/attempts/${id}/events`);
    expect(log.body.map((e: { kind: string }) => e.kind)).toEqual(['paste', 'blur', 'fullscreen_exit', 'visibility_hidden']);
  });
});
