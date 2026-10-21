// The LMS journey through the API: a teacher builds a course (modules, a page,
// an assignment, a quiz), a student works through it, hands in, takes the quiz, the teacher
// grades and releases, the gradebook and the certificate follow, and notifications go out.
import { describe, it, expect, beforeAll } from 'vitest';
import { app, as, fixture, request } from './helpers/http';
import { drainJobs } from '../src/jobs';

let f;
let t1;
let s1;
let s2;
let course: number;
const ids: Record<string, number> = {};

beforeAll(async () => {
  f = await fixture.resetDb();
  t1 = as(f.tokens.t1);
  s1 = as(f.tokens.s1);
  s2 = as(f.tokens.s2);
  course = f.subjects.A1math.id;
});

describe('a teacher builds a course', () => {
  it('modules with drip release and a prerequisite', async () => {
    const m1 = await t1.post(`/api/courses/${course}/modules`, { title: 'Week 1', published: true });
    expect(m1.status, JSON.stringify(m1.body)).toBe(201);
    const m2 = await t1.post(`/api/courses/${course}/modules`, { title: 'Week 2', published: true, prerequisite_module_id: m1.body.id });
    expect(m2.status).toBe(201);
    ids.m1 = m1.body.id;
    ids.m2 = m2.body.id;
    // a module cannot need a module of another course
    const bad = await t1.post(`/api/courses/${course}/modules`, { title: 'X', prerequisite_module_id: 99999 });
    expect(bad.status).toBe(400);
  });

  it('a rich page is sanitised; videos must come from allowed hosts', async () => {
    const page = await t1.post('/api/content-items', {
      module_id: ids.m1, kind: 'page', title: 'Fractions',
      body_html: '<p onclick="steal()">Hi <script>alert(1)</script><span class="katex">x</span><iframe src="https://evil.example/x"></iframe></p>',
    });
    expect(page.status).toBe(201);
    expect(page.body.body_html).toBe('<p>Hi <span class="katex">x</span></p>');
    ids.page = page.body.id;
    expect((await t1.post('/api/content-items', { module_id: ids.m1, kind: 'video', title: 'V', url: 'https://evil.example/v.mp4' })).status).toBe(400);
    const yt = await t1.post('/api/content-items', { module_id: ids.m1, kind: 'video', title: 'Intro', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(yt.body).toMatchObject({ video_provider: 'youtube', video_ref: 'dQw4w9WgXcQ' });
    const w2 = await t1.post('/api/content-items', { module_id: ids.m2, kind: 'page', title: 'Decimals', body_html: '<p>Next</p>' });
    ids.page2 = w2.body.id;
  });

  it('an assignment with a rubric, linked into the module (students are told)', async () => {
    const rubric = await t1.post('/api/rubrics', {
      title: 'Homework rubric', offering_id: course,
      criteria: [
        { title: 'Working', levels: [{ points: 6, label: 'Clear' }, { points: 3, label: 'Partial' }, { points: 0, label: 'Missing' }] },
        { title: 'Answer', levels: [{ points: 4, label: 'Right' }, { points: 0, label: 'Wrong' }] },
      ],
    });
    expect(rubric.status).toBe(201);
    ids.rubric = rubric.body.id;
    const due = new Date(Date.now() + 3 * 86400000);
    while (due.getUTCDay() === 0) due.setUTCDate(due.getUTCDate() + 1); // not a Sunday
    const a = await t1.post(`/api/courses/${course}/assessments`, {
      title: 'Fractions homework', points: 10, due_at: due.toISOString(), status: 'published', rubric_id: ids.rubric, module_id: ids.m1, submission_types: ['text', 'file'],
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    ids.hw = a.body.id;
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM notifications WHERE type = 'assignment_posted'`);
    expect(rows[0].n).toBe(2); // both students of A1
  });

  it('a quiz from the question bank', async () => {
    const bank = await t1.post('/api/question-banks', { name: 'Fractions', course_id: f.courses['A1-MATH'].id });
    expect(bank.status).toBe(201);
    const qs = [
      { type: 'mcq', prompt_html: '<p>1/2 + 1/4?</p>', data: { options: [{ id: 'a', text: '3/4' }, { id: 'b', text: '2/6' }], correct: 'a' }, points: 2 },
      { type: 'numeric', prompt_html: '<p>0.5 × 4?</p>', data: { answer: 2, tolerance: 0 }, points: 2 },
      { type: 'essay', prompt_html: '<p>Explain.</p>', data: {}, points: 6 },
    ];
    const made: number[] = [];
    for (const q of qs) made.push((await t1.post('/api/questions', { bank_id: bank.body.id, ...q })).body.id);
    expect((await t1.post('/api/questions', { bank_id: bank.body.id, type: 'mcq', prompt_html: '<p>x</p>', data: { options: [{ id: 'a', text: 'x' }], correct: 'z' } })).status).toBe(400);
    const quiz = await t1.post(`/api/courses/${course}/assessments`, { kind: 'quiz', title: 'Fractions quiz', points: 10, status: 'published', allowed_attempts: 2,
      quiz: { time_limit_minutes: 15, shuffle_questions: true, show_results: 'after_submit' } });
    expect(quiz.status).toBe(201);
    ids.quiz = quiz.body.id;
    expect((await t1.put(`/api/assessments/${ids.quiz}/questions`, { items: made.map((question_id) => ({ question_id })) })).status).toBe(200);
    ids.q_mcq = made[0]!;
    ids.q_num = made[1]!;
    ids.q_essay = made[2]!;
  });
});

describe('a student works through it', () => {
  it('sees only published work, locked modules explain why', async () => {
    const home = await s1.get(`/api/courses/${course}`);
    expect(home.status).toBe(200);
    expect(home.body.role).toBe('student');
    const [w1, w2] = home.body.modules;
    expect(w1.locked).toBe(false);
    expect(w2.locked).toBe(true);
    expect(w2.lock_reason).toContain('Week 1');
    expect((await s1.get(`/api/content-items/${ids.page2}`)).status).toBe(403);
    expect(home.body.resume_item_id).toBe(ids.page);
  });

  it('opening a page counts as viewing it; progress is kept', async () => {
    expect((await s1.get(`/api/content-items/${ids.page}`)).status).toBe(200);
    expect((await s1.put(`/api/content-items/${ids.page}/progress`, { status: 'started', percent: 50, resume: { scroll: 300 } })).status).toBe(200);
    const home = await s1.get(`/api/courses/${course}`);
    expect(home.body.modules[0].items.find((i) => i.id === ids.page).done).toBe(true);
  });

  it('hands in the assignment (a draft first)', async () => {
    expect((await s1.post(`/api/assessments/${ids.hw}/submission`, { text_html: '<p>3/4</p>', submit: false })).status).toBe(200);
    const done = await s1.post(`/api/assessments/${ids.hw}/submission`, { text_html: '<p>The answer is 3/4</p>' });
    expect(done.status).toBe(201);
    expect(done.body.late).toBe(false);
    // the teacher is told
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM notifications WHERE type = 'submission_received' AND user_id = $1`, [f.users.t1.id]);
    expect(rows[0].n).toBe(1);
  });

  it('takes the timed quiz; objective questions mark themselves', async () => {
    const start = await s1.post(`/api/assessments/${ids.quiz}/attempts`, {});
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect(new Date(start.body.deadline_at).getTime()).toBeGreaterThan(Date.now() + 14 * 60000);
    const view = await s1.get(`/api/attempts/${start.body.id}`);
    expect(view.body.questions).toHaveLength(3);
    // no answers leak while answering
    expect(JSON.stringify(view.body)).not.toContain('"correct"');
    await s1.put(`/api/attempts/${start.body.id}/answers`, { question_id: ids.q_mcq, response: 'a' });
    await s1.put(`/api/attempts/${start.body.id}/answers`, { question_id: ids.q_num, response: 2 });
    await s1.put(`/api/attempts/${start.body.id}/answers`, { question_id: ids.q_essay, response: 'Add quarters.' });
    expect((await s1.put(`/api/attempts/${start.body.id}/answers`, { question_id: 999999, response: 1 })).status).toBe(400);
    await s1.post(`/api/attempts/${start.body.id}/events`, { kind: 'blur' });
    const sub = await s1.post(`/api/attempts/${start.body.id}/submit`, {});
    expect(sub.body).toMatchObject({ status: 'submitted', score: '4.00' }); // the essay waits for the teacher
    ids.attempt = start.body.id;
    expect((await s1.put(`/api/attempts/${start.body.id}/answers`, { question_id: ids.q_mcq, response: 'b' })).status).toBe(409);
  });

  it('another student cannot read someone else’s attempt or hand-in', async () => {
    expect((await s2.get(`/api/attempts/${ids.attempt}`)).status).toBe(403);
    const sub = (await fixture.pool.query(`SELECT id FROM submissions WHERE assessment_id = $1`, [ids.hw])).rows[0];
    expect((await s2.get(`/api/submissions/${sub.id}`)).status).toBe(403);
  });
});

describe('the teacher grades and releases', () => {
  it('grades with the rubric as a draft; students see nothing until released', async () => {
    const res = await t1.put(`/api/assessments/${ids.hw}/grades`, {
      grades: [{ student_id: f.students.S1.id, rubric_scores: { [String((await fixture.pool.query(`SELECT id FROM rubric_criteria WHERE rubric_id = $1 ORDER BY position`, [ids.rubric])).rows[0].id)]: { points: 6 } }, feedback_html: '<p>Well done</p>' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = await s1.get(`/api/assessments/${ids.hw}`);
    expect(mine.body.grade).toBeNull();
    const rel = await t1.post(`/api/assessments/${ids.hw}/release`, {});
    expect(rel.body.released).toBe(1);
    const after = await s1.get(`/api/assessments/${ids.hw}`);
    expect(after.body.grade).toMatchObject({ points: '6.00', feedback_html: '<p>Well done</p>' });
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM notifications WHERE type = 'grade_released'`);
    expect(rows[0].n).toBeGreaterThanOrEqual(2); // the student and the parent
  });

  it('changing a released grade needs a reason and is kept in the history', async () => {
    expect((await t1.put(`/api/assessments/${ids.hw}/grades`, { grades: [{ student_id: f.students.S1.id, points: 8 }] })).status).toBe(400);
    expect((await t1.put(`/api/assessments/${ids.hw}/grades`, { grades: [{ student_id: f.students.S1.id, points: 8, reason: 'Remarked' }] })).status).toBe(200);
    const h = await t1.get(`/api/assessments/${ids.hw}/grades/${f.students.S1.id}/history`);
    expect(h.body[0]).toMatchObject({ points: '6.00', reason: 'Remarked' });
  });

  it('marks the essay; the quiz grade follows', async () => {
    const r = await t1.put(`/api/attempts/${ids.attempt}/grades`, { answers: [{ question_id: ids.q_essay, points: 5, feedback: 'Good' }] });
    expect(r.body).toMatchObject({ status: 'graded', score: '9.00' });
    await t1.post(`/api/assessments/${ids.quiz}/release`, {});
    const analysis = await t1.get(`/api/assessments/${ids.quiz}/item-analysis`);
    expect(analysis.body.attempts).toBe(1);
    expect(analysis.body.items).toHaveLength(3);
    const events = await t1.get(`/api/attempts/${ids.attempt}/events`);
    expect(events.body.map((e) => e.kind)).toEqual(['blur']);
  });

  it('the gradebook weighs categories, drops nothing it shouldn’t, and exports', async () => {
    const hw = await t1.post(`/api/courses/${course}/grade-categories`, { name: 'Homework', weight: 40 });
    const qz = await t1.post(`/api/courses/${course}/grade-categories`, { name: 'Quizzes', weight: 60 });
    await t1.patch(`/api/assessments/${ids.hw}`, { category_id: hw.body.id });
    await t1.patch(`/api/assessments/${ids.quiz}`, { category_id: qz.body.id });
    const gb = await t1.get(`/api/courses/${course}/gradebook`);
    const row = gb.body.rows.find((r) => r.student_id === f.students.S1.id);
    // homework 8/10 = 80% × 40 + quiz 9/10 = 90% × 60 → 86
    expect(row.percent).toBe(86);
    expect(row.grade.label).toBe('A');
    const mine = await s1.get(`/api/courses/${course}/gradebook`);
    expect(mine.body.row.percent).toBe(86);
    expect(mine.body.rows).toBeUndefined();
    const csv = await t1.get(`/api/courses/${course}/gradebook/export?format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Sara S');
    const xlsx = await t1.get(`/api/courses/${course}/gradebook/export?format=xlsx`);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('an override sets the course grade by hand, with a reason', async () => {
    expect((await t1.put(`/api/courses/${course}/final-overrides`, { student_id: f.students.S1.id, percent: 90 })).status).toBe(400);
    expect((await t1.put(`/api/courses/${course}/final-overrides`, { student_id: f.students.S1.id, percent: 90, reason: 'Viva' })).status).toBe(200);
    expect((await t1.get(`/api/courses/${course}/gradebook`)).body.rows.find((r) => r.student_id === f.students.S1.id).percent).toBe(90);
    await t1.put(`/api/courses/${course}/final-overrides`, { student_id: f.students.S1.id, percent: null });
  });

  it('a locked gradebook refuses changes; only an administrator unlocks it', async () => {
    await t1.post(`/api/courses/${course}/gradebook/lock`, {});
    const r = await t1.put(`/api/assessments/${ids.hw}/grades`, { grades: [{ student_id: f.students.S2.id, points: 5 }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('GRADEBOOK_LOCKED');
    expect((await t1.post(`/api/courses/${course}/gradebook/unlock`, {})).status).toBe(403);
    expect((await as(f.tokens.adminA).post(`/api/courses/${course}/gradebook/unlock`, {})).status).toBe(200);
  });
});

describe('finishing the course', () => {
  it('a certificate is issued automatically and can be verified publicly', async () => {
    await t1.put(`/api/courses/${course}/certificate-template`, { title: '{{course}} completed', body: '{{student}} completed {{course}} at {{institution}}.', min_progress_percent: 50 });
    // finishing the rest of week 1 (marking items done) issues it
    const home = await s1.get(`/api/courses/${course}`);
    for (const m of home.body.modules) for (const i of m.items) if (!i.done && !i.locked && ['view', 'mark_done'].includes(i.completion)) await s1.put(`/api/content-items/${i.id}/progress`, { status: 'done' });
    const ach = await s1.get('/api/me/achievements');
    expect(ach.body.certificates).toHaveLength(1);
    const code = ach.body.certificates[0].verify_code;
    const pub = await request(app).get(`/api/public/verify/${code}`);
    expect(pub.body).toMatchObject({ kind: 'course_certificate', valid: true, name: 'Sara S.' });
  });

  it('notifications are delivered by email per preferences (jobs)', async () => {
    await drainJobs();
    const { rows } = await fixture.pool.query(`SELECT channel, status FROM delivery_logs WHERE user_id = $1 ORDER BY id`, [f.users.s1.id]);
    expect(rows.some((r) => r.channel === 'email' && r.status === 'sent')).toBe(true);
  });
});
