// Bug #4 (+ roster read leak): a teacher may only read/write sections they are assigned to.
import { describe, it, expect, beforeEach } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const count = async (table) => Number((await fixture.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

describe('teacher class scope', () => {
  it('own class: roster, attendance, grades and assignments work', async () => {
    const t1 = as(f.tokens.t1);
    const A1 = f.sections.A1.id;
    expect((await t1.get(`/api/me/teacher/class/${A1}/roster`)).status).toBe(200);
    const att = await t1.post('/api/me/teacher/attendance', {
      section_id: A1,
      date: '2026-03-02',
      records: [{ student_id: f.students.S1.id, status: 'Present' }],
    });
    expect(att.status, JSON.stringify(att.body)).toBe(200);
    const gr = await t1.post('/api/me/teacher/grades', {
      section_id: A1,
      offering_id: f.subjects.A1math.id,
      assignment_name: 'Quiz 1',
      total_marks: 10,
      records: [{ student_id: f.students.S1.id, obtained_marks: 8 }],
    });
    expect(gr.status, JSON.stringify(gr.body)).toBe(200);
    const asg = await t1.post('/api/me/teacher/assignments', { section_id: A1, offering_id: f.subjects.A1math.id, title: 'HW' });
    expect(asg.status, JSON.stringify(asg.body)).toBe(201);
  });

  for (const who of ['t2', 'tb']) {
    const label = who === 't2' ? 'another teacher in the same institution' : 'a teacher from another institution';

    it(`${label} cannot read the roster`, async () => {
      const res = await as(f.tokens[who]).get(`/api/me/teacher/class/${f.sections.A1.id}/roster`);
      expect(res.status).toBe(403);
    });

    it(`${label} cannot mark attendance`, async () => {
      const res = await as(f.tokens[who]).post('/api/me/teacher/attendance', {
        section_id: f.sections.A1.id,
        date: '2026-03-02',
        records: [{ student_id: f.students.S1.id, status: 'Absent' }],
      });
      expect(res.status).toBe(403);
      expect(await count('student_attendance')).toBe(0);
    });

    it(`${label} cannot enter grades`, async () => {
      const res = await as(f.tokens[who]).post('/api/me/teacher/grades', {
        section_id: f.sections.A1.id,
        assignment_name: 'Hack',
        total_marks: 10,
        records: [{ student_id: f.students.S1.id, obtained_marks: 0 }],
      });
      expect(res.status).toBe(403);
      expect(await count('grades')).toBe(0);
    });

    it(`${label} cannot post an assignment`, async () => {
      const before = await count('assignments');
      const res = await as(f.tokens[who]).post('/api/me/teacher/assignments', { section_id: f.sections.A1.id, title: 'Hack' });
      expect(res.status).toBe(403);
      expect(await count('assignments')).toBe(before);
    });
  }

  it('a teacher cannot grade a subject they do not teach in that class', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/grades', {
      section_id: f.sections.A1.id,
      offering_id: f.subjects.A2math.id,
      assignment_name: 'Wrong subject',
      total_marks: 10,
      records: [{ student_id: f.students.S1.id, obtained_marks: 5 }],
    });
    expect(res.status).toBe(403);
    expect(await count('grades')).toBe(0);
  });

  it('a teacher cannot post an assignment for a subject they do not teach', async () => {
    const before = await count('assignments');
    const res = await as(f.tokens.t1).post('/api/me/teacher/assignments', {
      section_id: f.sections.A1.id,
      offering_id: f.subjects.B1math.id,
      title: 'Wrong subject',
    });
    expect(res.status).toBe(403);
    expect(await count('assignments')).toBe(before);
  });
});
