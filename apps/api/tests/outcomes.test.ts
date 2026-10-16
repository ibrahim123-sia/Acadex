// Outcome-based education: PLOs and CLOs, the mapping matrix, aligning work to CLOs, CLO
// attainment per class, PLO attainment for the program, reports, and the student's mastery
// view / skills transcript.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';
import { pool } from './helpers/fixture';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
let admin: ReturnType<typeof as>;
let t1: ReturnType<typeof as>;
let program = 0;
let course = 0;
let otherCourse = 0;
let quiz2 = 0;
const o: Record<string, number> = {};
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

beforeAll(async () => {
  f = await fixture.resetDb();
  admin = as(f.tokens.adminA);
  t1 = as(f.tokens.t1);
  program = (await q(`SELECT pl.program_id FROM sections s JOIN program_levels pl ON pl.id = s.program_level_id WHERE s.id = $1`, [f.sections.A1.id]))[0].program_id;
  course = (await q(`SELECT course_id FROM course_offerings WHERE id = $1`, [f.courses['A1-MATH'].id]))[0].course_id;
  otherCourse = (await q(`SELECT course_id FROM course_offerings WHERE id = $1`, [f.courses['A2-MATH'].id]))[0].course_id;
  // released grades: homework (100) and a test (50)
  const A = f.institutions.A.id;
  quiz2 = (await q(`INSERT INTO assessments (institution_id, offering_id, kind, title, status, points) VALUES ($1,$2,'exam','Unit test','published',50) RETURNING id`, [A, f.courses['A1-MATH'].id]))[0].id;
  await q(
    `INSERT INTO grades (institution_id, assessment_id, student_id, points, status, released_at) VALUES
       ($1,$2,$4,80,'released',now()), ($1,$2,$5,40,'released',now()), ($1,$3,$4,45,'released',now()), ($1,$3,$5,20,'released',now())`,
    [A, f.assignments.ASG1.id, quiz2, f.students.S1.id, f.students.S2.id]
  );
});

describe('outcomes', () => {
  it('the academic office sets PLOs; a course teacher sets its CLOs', async () => {
    o.PLO1 = (await admin.post('/api/outcomes', { level: 'program', program_id: program, code: 'PLO1', description: 'Problem solving', target_percent: 60 })).body.id;
    o.PLO2 = (await admin.post('/api/outcomes', { level: 'program', program_id: program, code: 'PLO2', description: 'Communication' })).body.id;
    expect((await t1.post('/api/outcomes', { level: 'program', program_id: program, code: 'PLO9', description: 'x' })).status).toBe(403);
    expect((await admin.post('/api/outcomes', { level: 'course', program_id: program, code: 'X', description: 'x' })).status).toBe(400);
    const c1 = await t1.post('/api/outcomes', { level: 'course', course_id: course, code: 'CLO1', description: 'Add fractions', bloom_level: 'apply' });
    expect(c1.status).toBe(201);
    o.CLO1 = c1.body.id;
    o.CLO2 = (await t1.post('/api/outcomes', { level: 'course', course_id: course, code: 'CLO2', description: 'Explain methods', bloom_level: 'understand' })).body.id;
    expect((await t1.post('/api/outcomes', { level: 'course', course_id: course, code: 'CLO1', description: 'dup' })).status).toBe(409);
    expect((await as(f.tokens.t2).post('/api/outcomes', { level: 'course', course_id: course, code: 'CLO3', description: 'x' })).status).toBe(403);
    expect((await as(f.tokens.s1).post('/api/outcomes', { level: 'course', course_id: course, code: 'CLO3', description: 'x' })).status).toBe(403);
    o.OTHER = (await as(f.tokens.t2).post('/api/outcomes', { level: 'course', course_id: otherCourse, code: 'CLO1', description: 'Other course' })).body.id;
  });

  it('maps CLOs to PLOs', async () => {
    const body = { mappings: [{ clo_id: o.CLO1, plo_id: o.PLO1, strength: 3 }, { clo_id: o.CLO2, plo_id: o.PLO1, strength: 1 }, { clo_id: o.CLO2, plo_id: o.PLO2, strength: 2 }] };
    expect((await t1.put(`/api/outcomes/matrix?program_id=${program}`, body)).status).toBe(403);
    expect((await admin.put(`/api/outcomes/matrix?program_id=${program}`, body)).body.mappings).toBe(3);
    const m = await t1.get(`/api/outcomes/matrix?program_id=${program}`);
    expect(m.body.plos).toHaveLength(2);
    expect(m.body.clos.map((c: { code: string }) => c.code)).toContain('CLO1');
    expect(m.body.mappings).toHaveLength(3);
  });

  it('aligns work to the course\'s own CLOs only', async () => {
    expect((await t1.put('/api/outcomes/alignments', { target_type: 'assessment', target_id: f.assignments.ASG1.id, clo_ids: [o.CLO1] })).body.aligned).toBe(1);
    expect((await t1.put('/api/outcomes/alignments', { target_type: 'assessment', target_id: quiz2, clo_ids: [o.CLO2] })).body.aligned).toBe(1);
    expect((await t1.put('/api/outcomes/alignments', { target_type: 'assessment', target_id: quiz2, clo_ids: [o.OTHER] })).status).toBe(400);
    expect((await as(f.tokens.t2).put('/api/outcomes/alignments', { target_type: 'assessment', target_id: quiz2, clo_ids: [o.CLO2] })).status).toBe(403);
    const list = await t1.get(`/api/outcomes/alignments?offering_id=${f.courses['A1-MATH'].id}`);
    expect(list.body.map((a: { code: string; label: string }) => `${a.code}:${a.label}`).sort()).toEqual(['CLO1:A1 homework', 'CLO2:Unit test']);
  });

  it('works out CLO attainment for the class', async () => {
    const res = await t1.get(`/api/outcomes/attainment/offering/${f.courses['A1-MATH'].id}`);
    expect(res.status).toBe(200);
    const clo1 = res.body.clos.find((c: { code: string }) => c.code === 'CLO1');
    expect(clo1).toMatchObject({ students: 2, attained: 1, attainment_percent: 50, average_percent: 60, met: false });
    expect(clo1.per_student.find((p: { student_id: number }) => p.student_id === f.students.S2.id)).toEqual({ student_id: f.students.S2.id, percent: 40, attained: false });
    expect((await as(f.tokens.t2).get(`/api/outcomes/attainment/offering/${f.courses['A1-MATH'].id}`)).status).toBe(403);
    const xlsx = await t1.get(`/api/outcomes/attainment/offering/${f.courses['A1-MATH'].id}?format=xlsx`);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('rolls CLOs up to PLOs by mapping strength, with an accreditation report', async () => {
    const res = await admin.get(`/api/outcomes/attainment/program/${program}`);
    const plo1 = res.body.plos.find((p: { code: string }) => p.code === 'PLO1');
    // Sara: (80×3 + 90×1) / 4 = 82.5; Sam: 40 → one of two attains, against a 60% target
    expect(plo1).toMatchObject({ students: 2, attained: 1, attainment_percent: 50, average_percent: 61.25, target_percent: 60, met: false });
    expect((await as(f.tokens.t1).get(`/api/outcomes/attainment/program/${program}`)).status).toBe(403);
    const xlsx = await admin.get(`/api/outcomes/report/${program}`);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await admin.get(`/api/outcomes/report/${program}?format=pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it("shows a student's mastery and a skills transcript to them and their family", async () => {
    const m = await as(f.tokens.s1).get(`/api/outcomes/students/${f.students.S1.id}`);
    expect(m.body.courses[0].clos.map((c: { code: string; percent: number }) => [c.code, c.percent])).toEqual([['CLO1', 80], ['CLO2', 90]]);
    expect(m.body.programs.find((p: { code: string }) => p.code === 'PLO1')).toMatchObject({ percent: 82.5, attained: true });
    expect((await as(f.tokens.p1).get(`/api/outcomes/students/${f.students.S1.id}/skills.pdf`)).headers['content-type']).toBe('application/pdf');
    expect((await as(f.tokens.s2).get(`/api/outcomes/students/${f.students.S1.id}`)).status).toBe(403);
  });
});
