// Institution settings: type and terminology, grading schemes, custom fields (checked on
// people), and onboarding with the type's smart defaults.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f: fixture.Fixture;
let A: ReturnType<typeof as>;
beforeAll(async () => {
  f = await fixture.resetDb();
  A = as(f.tokens.adminA);
});

describe('type and terminology', () => {
  it('speaks the institution type’s language, with overrides, to everyone signed in', async () => {
    expect((await as(f.tokens.s1).get('/api/institution/terminology')).body.terminology.section.one).toBe('Class');
    const res = await A.patch('/api/institution/settings', { type: 'university', settings: { terminology: { teacher: { one: 'Professor' } }, working_days: [1, 2, 3, 4, 5] } });
    expect(res.status).toBe(200);
    expect(res.body.terminology.section.one).toBe('Batch');
    expect(res.body.terminology.teacher).toEqual({ one: 'Professor', other: 'Professors' });
    expect((await as(f.tokens.t1).get('/api/institution/terminology')).body.terminology.teacher.one).toBe('Professor');
    const cal = await A.get('/api/institution/calendar?from=2026-11-01&to=2026-11-02');
    expect(cal.body.working_days).toEqual([1, 2, 3, 4, 5]);
  });

  it('validates settings and is only for settings managers', async () => {
    expect((await A.patch('/api/institution/settings', { primary_color: 'red' })).status).toBe(400);
    expect((await A.patch('/api/institution/settings', { timezone: 'Mars/Base' })).status).toBe(400);
    expect((await A.patch('/api/institution/settings', {})).status).toBe(400);
    expect((await as(f.tokens.t1).patch('/api/institution/settings', { name: 'Hacked' })).status).toBe(403);
    expect((await as(f.tokens.t1).get('/api/institution/settings')).status).toBe(403);
  });
});

describe('grading schemes', () => {
  it('keeps one default, validates bands, and protects the default', async () => {
    const gpa = await A.post('/api/institution/grading-schemes', {
      name: 'GPA', kind: 'gpa', gpa_scale: 4, is_default: true,
      bands: [{ min: 85, label: 'A', points: 4, passed: true }, { min: 50, label: 'D', points: 1, passed: true }, { min: 0, label: 'F', points: 0, passed: false }],
    });
    expect(gpa.status).toBe(201);
    const list = await A.get('/api/institution/grading-schemes');
    expect(list.body.schemes.filter((s: { is_default: boolean }) => s.is_default).map((s: { name: string }) => s.name)).toEqual(['GPA']);
    expect(list.body.presets.gpa_4.bands.length).toBeGreaterThan(5);
    expect((await A.delete(`/api/institution/grading-schemes/${gpa.body.id}`)).status).toBe(409);
    expect((await A.post('/api/institution/grading-schemes', { name: 'No zero', kind: 'letter', bands: [{ min: 50, label: 'P', passed: true }] })).status).toBe(400);
    expect((await A.post('/api/institution/grading-schemes', { name: 'GPA', kind: 'pass_fail', bands: [{ min: 0, label: 'F', passed: false }] })).status).toBe(409);
  });

  it('report cards use the scheme (GPA here)', async () => {
    await fixture.pool.query(
      `WITH a AS (INSERT INTO assessments (institution_id, offering_id, kind, title, points, status) VALUES ($1,$4,'exam','Final',100,'published') RETURNING id)
       INSERT INTO grades (institution_id, assessment_id, student_id, points, status, released_at) SELECT $1, a.id, $2, 90, 'released', now() FROM a WHERE $3::int IS NOT NULL`,
      [f.institutions.A.id, f.students.S1.id, f.sections.A1.id, f.subjects.A1math.id]
    );
    const res = await A.get(`/api/pdf/report-card/${f.students.S1.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });
});

describe('custom fields', () => {
  it('defines fields and checks values on students', async () => {
    expect((await A.post('/api/institution/custom-fields', { entity: 'student', key: 'house', label: 'House', field_type: 'select', options: ['Red', 'Blue'], required: false })).status).toBe(201);
    expect((await A.post('/api/institution/custom-fields', { entity: 'student', key: 'Bad Key', label: 'x', field_type: 'text' })).status).toBe(400);
    expect((await A.post('/api/institution/custom-fields', { entity: 'student', key: 'empty', label: 'x', field_type: 'select' })).status).toBe(400);
    const S1 = f.students.S1.id;
    expect((await A.patch(`/api/institution/students/${S1}`, { custom_data: { house: 'Red' } })).body.custom_data).toEqual({ house: 'Red' });
    const bad = await A.patch(`/api/institution/students/${S1}`, { custom_data: { house: 'Green' } });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].path).toBe('custom_data.house');
    expect((await A.patch(`/api/institution/students/${S1}`, { custom_data: { secret: 'x' } })).status).toBe(400); // undefined field
  });
});

describe('onboarding', () => {
  it('applies a type’s defaults once, creating only what is missing', async () => {
    const B = as(f.tokens.adminB);
    const before = await B.get('/api/institution/onboarding');
    expect(before.body.done).toBe(false);
    expect(before.body.defaults.university.terminology.teacher.one).toBe('Instructor');
    const first = await B.post('/api/institution/onboarding/apply', { type: 'training_center', campuses: [{ name: 'Lahore', code: 'LHR' }] });
    expect(first.status).toBe(200);
    expect(first.body.created).toMatchObject({ campuses: 1, grading_schemes: 0, programs: 1 });
    expect(first.body.institution.terminology.student.one).toBe('Trainee');
    const again = await B.post('/api/institution/onboarding/apply', { type: 'training_center', campuses: [{ name: 'Lahore', code: 'LHR' }] });
    expect(again.body.created).toMatchObject({ campuses: 0, academic_years: 0, programs: 0 });
    expect((await B.post('/api/institution/onboarding/complete')).status).toBe(200);
    expect((await B.get('/api/institution/onboarding')).body.done).toBe(true);
    expect((await as(f.tokens.tb).post('/api/institution/onboarding/apply', { type: 'school' })).status).toBe(403);
  });
});
