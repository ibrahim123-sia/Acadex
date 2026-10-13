// Bug #5 (+ admin writes): ids in request bodies must belong to the class / institution,
// values must be sane, and a rejected batch must write nothing.
import { describe, it, expect, beforeEach } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const count = async (table) => Number((await fixture.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
const attendance = (records, extra = {}) => ({ class_id: f.classes.A1.id, date: '2026-03-02', records, ...extra });
const grades = (records, extra = {}) => ({
  class_id: f.classes.A1.id,
  subject_id: f.subjects.A1math.id,
  assignment_name: 'Quiz',
  total_marks: 10,
  records,
  ...extra,
});

describe('teacher attendance input', () => {
  it('rejects a student from another class of the same institution, writing nothing', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/attendance', attendance([
      { student_id: f.students.S1.id, status: 'Present' },
      { student_id: f.students.S3.id, status: 'Absent' },
    ]));
    expect(res.status).toBe(400);
    expect(await count('student_attendance')).toBe(0);
  });

  it('rejects a student from another institution', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/attendance', attendance([{ student_id: f.students.SB.id, status: 'Absent' }]));
    expect(res.status).toBe(400);
    expect(await count('student_attendance')).toBe(0);
  });

  it('rejects an unknown status', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/attendance', attendance([{ student_id: f.students.S1.id, status: 'Banana' }]));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid date', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/attendance', attendance([{ student_id: f.students.S1.id, status: 'Present' }], { date: '2026-02-30' }));
    expect(res.status).toBe(400);
  });

  it('rejects the same student twice in one batch', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/attendance', attendance([
      { student_id: f.students.S1.id, status: 'Present' },
      { student_id: f.students.S1.id, status: 'Absent' },
    ]));
    expect(res.status).toBe(400);
  });

  it('re-saving a day replaces only that day for that class', async () => {
    const t1 = as(f.tokens.t1);
    await t1.post('/api/me/teacher/attendance', attendance([{ student_id: f.students.S1.id, status: 'Present' }]));
    const res = await t1.post('/api/me/teacher/attendance', attendance([{ student_id: f.students.S1.id, status: 'Absent' }]));
    expect(res.status).toBe(200);
    const { rows } = await fixture.pool.query('SELECT status FROM student_attendance');
    expect(rows).toEqual([{ status: 'Absent' }]);
  });
});

describe('teacher grade input', () => {
  it('rejects a student from another institution, writing nothing', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/grades', grades([
      { student_id: f.students.S1.id, obtained_marks: 5 },
      { student_id: f.students.SB.id, obtained_marks: 5 },
    ]));
    expect(res.status).toBe(400);
    expect(await count('grades')).toBe(0);
  });

  it('rejects a student from another class', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/grades', grades([{ student_id: f.students.S3.id, obtained_marks: 5 }]));
    expect(res.status).toBe(400);
    expect(await count('grades')).toBe(0);
  });

  it('rejects marks above the total', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/grades', grades([{ student_id: f.students.S1.id, obtained_marks: 11 }]));
    expect(res.status).toBe(400);
  });

  it('rejects negative marks', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/grades', grades([{ student_id: f.students.S1.id, obtained_marks: -1 }]));
    expect(res.status).toBe(400);
  });

  it('saves a whole valid batch', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/grades', grades([
      { student_id: f.students.S1.id, obtained_marks: 7 },
      { student_id: f.students.S2.id, obtained_marks: 9.5 },
    ]));
    expect(res.status).toBe(200);
    expect(await count('grades')).toBe(2);
  });
});

describe('admin writes', () => {
  it('cannot record a fee for a student of another institution', async () => {
    const before = await count('tuition_fee');
    const res = await as(f.tokens.adminA).post('/api/institution/fees', { student_id: f.students.SB.id, total_fee: 100, paid_amount: 0 });
    expect(res.status).toBe(400);
    expect(await count('tuition_fee')).toBe(before);
  });

  it('cannot record a payment larger than the fee or a negative amount', async () => {
    const a = as(f.tokens.adminA);
    expect((await a.post('/api/institution/fees', { student_id: f.students.S1.id, total_fee: 100, paid_amount: 150 })).status).toBe(400);
    expect((await a.post('/api/institution/fees', { student_id: f.students.S1.id, total_fee: -5 })).status).toBe(400);
  });

  it('cannot admit a student into a class of another institution', async () => {
    const res = await as(f.tokens.adminA).post('/api/institution/students', {
      first_name: 'New',
      last_name: 'Kid',
      email: 'new.kid@alpha.test',
      class_id: f.classes.B1.id,
    });
    expect(res.status).toBe(400);
    expect(await count('students')).toBe(4);
  });

  it('rejects an invalid email', async () => {
    const res = await as(f.tokens.adminA).post('/api/institution/teachers', { first_name: 'A', last_name: 'B', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown announcement audience', async () => {
    const res = await as(f.tokens.adminA).post('/api/institution/announcements', { title: 'x', description: 'y', target_audience: 'Aliens' });
    expect(res.status).toBe(400);
  });
});

describe('platform writes', () => {
  it('rejects an invalid institution status or plan', async () => {
    const s = as(f.tokens.super);
    expect((await s.patch(`/api/platform/institutions/${f.institutions.A.id}`, { status: 'deleted' })).status).toBe(400);
    expect((await s.patch(`/api/platform/institutions/${f.institutions.A.id}`, { plan: 'gold' })).status).toBe(400);
  });

  it('rejects an invalid slug', async () => {
    const res = await as(f.tokens.super).post('/api/platform/institutions', { name: 'X', slug: 'Bad Slug!', adminEmail: 'x@x.test' });
    expect(res.status).toBe(400);
  });
});
