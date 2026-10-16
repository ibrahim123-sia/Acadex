// A full exam cycle: series → date sheet (generated, clash-checked) → rooms and seating
// (neighbours write different papers) → invigilation → admit cards with eligibility →
// marks entry by the paper's teacher → head of department → moderation → exam controller →
// publish into the gradebook → results, positions, merit list, result cards, transcript.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';
import { pool } from './helpers/fixture';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
let admin: ReturnType<typeof as>;
let series = 0;
const sessions: Record<string, number> = {};
const rooms: Record<string, number> = {};
let t3 = 0;
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

beforeAll(async () => {
  f = await fixture.resetDb();
  admin = as(f.tokens.adminA);
  const A = f.institutions.A.id;
  // Tom (t2) heads the department that owns Class A1's maths course
  const dept = (await q(`INSERT INTO departments (institution_id, name, code, head_teacher_id) VALUES ($1, 'Mathematics', 'MATH', $2) RETURNING id`, [A, f.teachers.T2.id]))[0];
  await q(`UPDATE courses SET department_id = $1 WHERE id = (SELECT course_id FROM course_offerings WHERE id = $2)`, [dept.id, f.courses['A1-MATH'].id]);
  t3 = (await q(`INSERT INTO teachers (institution_id, first_name, last_name, email) VALUES ($1, 'Iqra', 'Invigilator', 'iqra@alpha.test') RETURNING id`, [A]))[0].id;
  // Sam owes fees from last month
  await q(
    `INSERT INTO invoices (institution_id, number, student_id, title, issue_date, due_date, status, currency, total, paid) VALUES ($1, 'INV-OLD', $2, 'Old fee', '2026-08-01', '2026-08-10', 'issued', 'PKR', 900, 0)`,
    [A, f.students.S2.id]
  );
});

describe('planning', () => {
  it('creates a series; only the exams office may', async () => {
    expect((await as(f.tokens.t1).post('/api/exams/series', { name: 'x' })).status).toBe(403);
    const res = await admin.post('/api/exams/series', { name: 'Mid-term examinations', kind: 'midterm', eligibility: { attendance: true, fees: true }, instructions: 'Bring a pen.' });
    expect(res.status).toBe(201);
    series = res.body.id;
  });

  it('lays out the date sheet, skipping Sundays', async () => {
    const body = { section_ids: [f.sections.A1.id, f.sections.A2.id], from: '2026-11-01', slots: [{ starts_at: '09:00', ends_at: '12:00' }] };
    const preview = await admin.post(`/api/exams/series/${series}/timetable`, body);
    expect(preview.status).toBe(200);
    expect(preview.body.papers).toBe(2);
    expect(preview.body.plan.every((p: { date: string }) => p.date === '2026-11-02')).toBe(true); // 1 Nov 2026 is a Sunday
    expect((await admin.post(`/api/exams/series/${series}/timetable`, { ...body, commit: true })).status).toBe(201);
    const detail = await admin.get(`/api/exams/series/${series}`);
    expect(detail.body.status).toBe('scheduled');
    for (const s of detail.body.sessions) sessions[s.course] = s.id;
    expect(Object.keys(sessions).sort()).toEqual(['A1-MATH', 'A2-MATH']);
    // a course gets one paper per series
    expect((await admin.post(`/api/exams/series/${series}/sessions`, { offering_id: f.courses['A1-MATH'].id, date: '2026-11-03', starts_at: '09:00', ends_at: '10:00' })).status).toBe(409);
  });

  it('seats candidates so neighbours write different papers, within room capacity', async () => {
    rooms.R1 = (await admin.post('/api/timetable/rooms', { name: 'Room 1', code: 'R1', capacity: 2, kind: 'classroom' })).body.id;
    rooms.R2 = (await admin.post('/api/timetable/rooms', { name: 'Hall', code: 'HALL', capacity: 40, kind: 'hall' })).body.id;
    expect((await admin.post(`/api/exams/series/${series}/seating`, { date: '2026-11-02', room_ids: [rooms.R1] })).status).toBe(400); // 3 candidates, 2 seats
    const res = await admin.post(`/api/exams/series/${series}/seating`, { date: '2026-11-02', room_ids: [rooms.R1, rooms.R2] });
    expect(res.body).toEqual({ seated: 3, rooms: 2 });
    const plan = await admin.get(`/api/exams/series/${series}/seating?date=2026-11-02`);
    const r1 = plan.body.filter((s: { room: string }) => s.room === 'R1');
    expect(r1.map((s: { course: string }) => s.course).sort()).toEqual(['A1-MATH', 'A2-MATH']);
    const pdf = await admin.get(`/api/exams/series/${series}/seating.pdf?date=2026-11-02`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('assigns invigilators who are not teaching a paper at that time, without clashes', async () => {
    const auto = await admin.post(`/api/exams/series/${series}/duties/auto`, { date: '2026-11-02' });
    expect(auto.status).toBe(201);
    expect(auto.body.assigned).toBe(1); // only Iqra is free: Tina and Tom teach the papers
    expect(auto.body.short).toHaveLength(1);
    const duties = await admin.get(`/api/exams/series/${series}/duties`);
    expect(duties.body[0].teacher_id).toBe(t3);
    const clash = await admin.post(`/api/exams/sessions/${sessions['A2-MATH']}/duties`, { room_id: rooms.R2, teacher_id: t3 });
    expect(clash.status).toBe(409);
  });

  it('issues admit cards; a student with overdue fees is held back until the office allows them', async () => {
    const res = await admin.post(`/api/exams/series/${series}/admit-cards`, {});
    expect(res.body).toEqual({ issued: 3, blocked: 1 });
    const cards = await admin.get(`/api/exams/series/${series}/admit-cards`);
    const sam = cards.body.find((c: { student_id: number }) => c.student_id === f.students.S2.id);
    expect(sam).toMatchObject({ eligible: false, blocked_reason: 'overdue fees' });
    const held = await as(f.tokens.s2).get(`/api/exams/series/${series}/admit-cards/${f.students.S2.id}.pdf`);
    expect(held.status).toBe(403);
    expect((await as(f.tokens.s2).get(`/api/exams/series/${series}/admit-cards/${f.students.S1.id}.pdf`)).status).toBe(403); // someone else's
    expect((await admin.post(`/api/exams/admit-cards/${sam.id}/override`, { reason: 'Instalment plan agreed' })).status).toBe(200);
    expect((await as(f.tokens.s2).get(`/api/exams/series/${series}/admit-cards/${f.students.S2.id}.pdf`)).status).toBe(200);
    const parent = await as(f.tokens.p1).get(`/api/exams/series/${series}/admit-cards/${f.students.S1.id}.pdf`);
    expect(parent.headers['content-type']).toBe('application/pdf');
    const code = (await q(`SELECT verify_code FROM admit_cards WHERE series_id = $1 AND student_id = $2`, [series, f.students.S1.id]))[0].verify_code;
    const verify = await request(app).get(`/api/public/verify/${code}`);
    expect(verify.body).toMatchObject({ kind: 'admit_card', valid: true });
    const mine = await as(f.tokens.s1).get('/api/exams/my');
    expect(mine.body[0].upcoming[0]).toMatchObject({ course: 'A1-MATH', room: expect.any(String) });
  });
});

describe('marks and approvals', () => {
  it("only the paper's teacher enters marks, within the total, for its own candidates", async () => {
    const A1 = sessions['A1-MATH'];
    expect((await as(f.tokens.t2).put(`/api/exams/sessions/${A1}/marks`, { marks: [{ student_id: f.students.S1.id, marks: 50 }] })).status).toBe(403);
    const t1 = as(f.tokens.t1);
    expect((await t1.put(`/api/exams/sessions/${A1}/marks`, { marks: [{ student_id: f.students.S1.id, marks: 101 }] })).status).toBe(400);
    expect((await t1.put(`/api/exams/sessions/${A1}/marks`, { marks: [{ student_id: f.students.S3.id, marks: 50 }] })).status).toBe(400);
    expect((await t1.put(`/api/exams/sessions/${A1}/marks`, { marks: [{ student_id: f.students.S1.id, marks: 80 }] })).status).toBe(200);
    expect((await t1.post(`/api/exams/sessions/${A1}/submit`, {})).body.code).toBe('INCOMPLETE');
    await t1.put(`/api/exams/sessions/${A1}/marks`, { marks: [{ student_id: f.students.S2.id, absent: true }] });
    expect((await t1.post(`/api/exams/sessions/${A1}/submit`, {})).body.status).toBe('submitted');
    expect((await t1.put(`/api/exams/sessions/${A1}/marks`, { marks: [{ student_id: f.students.S1.id, marks: 90 }] })).status).toBe(409);
  });

  it('head of department approves and moderates; then the exam controller', async () => {
    const A1 = sessions['A1-MATH'];
    expect((await as(f.tokens.t1).post(`/api/exams/sessions/${A1}/approve`, {})).status).toBe(403);
    const hod = as(f.tokens.t2);
    expect((await hod.post(`/api/exams/sessions/${A1}/approve`, {})).body.status).toBe('hod_approved');
    expect((await hod.post(`/api/exams/sessions/${A1}/moderate`, { add: 5, scale_to: 90, note: 'x' })).status).toBe(400);
    expect((await hod.post(`/api/exams/sessions/${A1}/moderate`, { add: 5, note: 'Question 4 was ambiguous' })).status).toBe(200);
    expect((await q(`SELECT adjustment FROM exam_marks WHERE session_id = $1 AND student_id = $2`, [A1, f.students.S1.id]))[0].adjustment).toBe('5.00');
    expect((await admin.post(`/api/exams/sessions/${A1}/approve`, {})).body.status).toBe('approved');
    const history = await admin.get(`/api/exams/sessions/${A1}/marks`);
    expect(history.body.history.map((h: { action: string }) => h.action)).toEqual(['open', 'submit', 'approve', 'moderate', 'approve']);
  });

  it("can't publish until every paper is approved; the controller approves papers without a head of department", async () => {
    expect((await admin.post(`/api/exams/series/${series}/publish`, {})).body.code).toBe('NOT_APPROVED');
    const A2 = sessions['A2-MATH'];
    await admin.put(`/api/exams/sessions/${A2}/marks`, { marks: [{ student_id: f.students.S3.id, marks: 30 }] });
    await admin.post(`/api/exams/sessions/${A2}/submit`, {});
    expect((await admin.post(`/api/exams/sessions/${A2}/approve`, {})).body.status).toBe('approved');
  });
});

describe('results', () => {
  it('students see nothing before publishing', async () => {
    expect((await as(f.tokens.s1).get(`/api/exams/series/${series}/result-card/${f.students.S1.id}.pdf`)).status).toBe(403);
    expect((await as(f.tokens.t1).post(`/api/exams/series/${series}/publish`, {})).status).toBe(403);
  });

  it('publishes into the gradebook and tells students and guardians', async () => {
    const res = await admin.post(`/api/exams/series/${series}/publish`, {});
    expect(res.body).toEqual({ published: true, students: 3 });
    const g = await q(
      `SELECT g.points, g.status FROM grades g JOIN exam_sessions s ON s.assessment_id = g.assessment_id WHERE s.id = $1 AND g.student_id = $2`,
      [sessions['A1-MATH'], f.students.S1.id]
    );
    expect(g[0]).toEqual({ points: '85.00', status: 'released' });
    expect((await q(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'exam_update' AND title LIKE 'Results%'`, [f.users.p1.id])).length).toBe(1);
  });

  it('works out totals, pass/fail and positions, and a merit list of those who passed', async () => {
    const r = await admin.get(`/api/exams/series/${series}/results`);
    const by = (sid: number) => r.body.results.find((x: { student_id: number }) => x.student_id === sid);
    expect(by(f.students.S1.id)).toMatchObject({ obtained: 85, percent: 85, passed: true, position: 1 });
    expect(by(f.students.S2.id)).toMatchObject({ obtained: 0, passed: false, position: 2 });
    expect(by(f.students.S2.id).papers[0]).toMatchObject({ absent: true, grade: 'ABS' });
    expect(by(f.students.S3.id)).toMatchObject({ obtained: 30, passed: false }); // pass mark 33
    const merit = await admin.get(`/api/exams/series/${series}/merit?scope=all`);
    expect(merit.body[0].list.map((m: { student_id: number }) => m.student_id)).toEqual([f.students.S1.id]);
    const xlsx = await admin.get(`/api/exams/series/${series}/results?format=xlsx`);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('result cards for the student, their guardian and their teachers; not for others', async () => {
    const url = `/api/exams/series/${series}/result-card/${f.students.S1.id}.pdf`;
    for (const who of ['s1', 'p1', 't1', 'adminA'] as const) expect((await as(f.tokens[who]).get(url)).status, who).toBe(200);
    for (const who of ['s2', 't2'] as const) expect((await as(f.tokens[who]).get(url)).status, who).toBe(403);
    expect((await as(f.tokens.adminB).get(url)).status).toBe(404);
    const mine = await as(f.tokens.p1).get('/api/exams/my');
    expect(mine.body[0].results[0]).toMatchObject({ series: 'Mid-term examinations', percent: 85, passed: true });
  });

  it('a verifiable transcript; the same facts keep the same serial', async () => {
    const one = await as(f.tokens.s1).get(`/api/exams/transcript/${f.students.S1.id}.pdf`);
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toBe('application/pdf');
    await as(f.tokens.s1).get(`/api/exams/transcript/${f.students.S1.id}.pdf`);
    const docs = await q(`SELECT verify_code FROM issued_documents WHERE kind = 'transcript' AND student_id = $1`, [f.students.S1.id]);
    expect(docs).toHaveLength(1);
    expect((await request(app).get(`/api/public/verify/${docs[0].verify_code}`)).body).toMatchObject({ kind: 'document', valid: true });
    expect((await as(f.tokens.s2).get(`/api/exams/transcript/${f.students.S1.id}.pdf`)).status).toBe(403);
  });

  it('published marks are locked; withdrawing hides them again', async () => {
    expect((await admin.post(`/api/exams/sessions/${sessions['A1-MATH']}/return`, { note: 'typo' })).status).toBe(409);
    expect((await admin.post(`/api/exams/series/${series}/withdraw`, { note: 'Correcting a total' })).body.status).toBe('marking');
    expect((await as(f.tokens.s1).get(`/api/exams/series/${series}/result-card/${f.students.S1.id}.pdf`)).status).toBe(403);
    expect((await admin.post(`/api/exams/sessions/${sessions['A1-MATH']}/return`, { note: 'typo' })).body.status).toBe('marks_entry');
  });
});
