// Bug #4 (+ roster read leak): a teacher may only read/write the sections and courses they teach.
import { describe, it, expect, beforeEach } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const count = async (table) => Number((await fixture.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
const register = (sectionId, studentId, status = 'present') => ({ section_id: sectionId, date: '2026-09-01', records: [{ student_id: studentId, status }] });

describe('teacher class scope', () => {
  it('own class: register, grades and assignments work', async () => {
    const t1 = as(f.tokens.t1);
    const A1 = f.sections.A1.id;
    expect((await t1.get(`/api/attendance/register?section_id=${A1}&date=2026-09-01`)).status).toBe(200);
    const att = await t1.put('/api/attendance/register', register(A1, f.students.S1.id));
    expect(att.status, JSON.stringify(att.body)).toBe(200);
    const gr = await t1.put(`/api/assessments/${f.assignments.ASG1.id}/grades`, { grades: [{ student_id: f.students.S1.id, points: 80 }] });
    expect(gr.status, JSON.stringify(gr.body)).toBe(200);
    const asg = await t1.post(`/api/courses/${f.subjects.A1math.id}/assessments`, { title: 'HW', status: 'published' });
    expect(asg.status, JSON.stringify(asg.body)).toBe(201);
  });

  for (const who of ['t2', 'tb']) {
    const label = who === 't2' ? 'another teacher in the same institution' : 'a teacher from another institution';

    it(`${label} cannot read the register`, async () => {
      const res = await as(f.tokens[who]).get(`/api/attendance/register?section_id=${f.sections.A1.id}`);
      expect([403, 404]).toContain(res.status);
    });

    it(`${label} cannot mark attendance`, async () => {
      const res = await as(f.tokens[who]).put('/api/attendance/register', register(f.sections.A1.id, f.students.S1.id, 'absent'));
      expect([403, 404]).toContain(res.status);
      expect(await count('attendance_records')).toBe(0);
    });

    it(`${label} cannot enter grades`, async () => {
      const res = await as(f.tokens[who]).put(`/api/assessments/${f.assignments.ASG1.id}/grades`, { grades: [{ student_id: f.students.S1.id, points: 0 }] });
      expect([403, 404]).toContain(res.status);
      expect(await count('grades')).toBe(0);
    });

    it(`${label} cannot post an assignment`, async () => {
      const before = await count('assessments');
      const res = await as(f.tokens[who]).post(`/api/courses/${f.subjects.A1math.id}/assessments`, { title: 'Hack' });
      expect([403, 404]).toContain(res.status);
      expect(await count('assessments')).toBe(before);
    });

    it(`${label} cannot see the course`, async () => {
      expect([403, 404]).toContain((await as(f.tokens[who]).get(`/api/courses/${f.subjects.A1math.id}`)).status);
      expect([403, 404]).toContain((await as(f.tokens[who]).get(`/api/courses/${f.subjects.A1math.id}/gradebook`)).status);
    });
  }

  it('a teacher cannot grade a course they do not teach', async () => {
    const res = await as(f.tokens.t1).put(`/api/assessments/${f.assignments.ASG2.id}/grades`, { grades: [{ student_id: f.students.S3.id, points: 5 }] });
    expect(res.status).toBe(403);
    expect(await count('grades')).toBe(0);
  });

  it('a teacher cannot take a register for a course of another section', async () => {
    const res = await as(f.tokens.t1).put('/api/attendance/register', { ...register(f.sections.A1.id, f.students.S1.id), offering_id: f.subjects.A2math.id });
    expect(res.status).toBe(400);
  });
});
