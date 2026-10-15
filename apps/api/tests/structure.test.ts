// The academic structure API: campuses, programs and levels, years and terms, the calendar,
// sections, courses, offerings, staff assignment and enrolment with a waitlist — plus the
// denials (other roles, other institutions).
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f: fixture.Fixture;
let A: ReturnType<typeof as>;
beforeAll(async () => {
  f = await fixture.resetDb();
  A = as(f.tokens.adminA);
});

describe('campuses', () => {
  it('adds, renames and refuses to delete the main campus or one with classes', async () => {
    const res = await A.post('/api/institution/campuses', { name: 'North branch', code: 'NTH', address: 'Ring Road' });
    expect(res.status).toBe(201);
    expect(res.body.is_main).toBe(false);
    expect((await A.post('/api/institution/campuses', { name: 'Dup', code: 'NTH' })).status).toBe(409);
    expect((await A.patch(`/api/institution/campuses/${res.body.id}`, { name: 'North' })).body.name).toBe('North');
    expect((await A.delete(`/api/institution/campuses/${f.institutions.A.campus.id}`)).status).toBe(409); // main
    expect((await A.delete(`/api/institution/campuses/${res.body.id}`)).status).toBe(204);
    const s = await A.get('/api/institution/structure');
    expect(s.body.campuses.map((c: { code: string }) => c.code)).toEqual(['MAIN']); // deleted one is gone
  });

  it('is invisible and untouchable for another institution', async () => {
    expect((await as(f.tokens.adminB).patch(`/api/institution/campuses/${f.institutions.A.campus.id}`, { name: 'x' })).status).toBe(404);
    const s = await as(f.tokens.adminB).get('/api/institution/structure');
    expect(s.body.campuses.some((c: { id: number }) => c.id === f.institutions.A.campus.id)).toBe(false);
  });

  it('teachers may read the structure but not change it; students may do neither', async () => {
    expect((await as(f.tokens.t1).get('/api/institution/structure')).status).toBe(200);
    expect((await as(f.tokens.t1).post('/api/institution/campuses', { name: 'X', code: 'X1' })).status).toBe(403);
    expect((await as(f.tokens.s1).get('/api/institution/structure')).status).toBe(403);
  });
});

describe('programs and levels', () => {
  let programId: number;
  it('creates a program with ordered levels', async () => {
    const res = await A.post('/api/institution/programs', { name: 'Primary', code: 'PRI', levels: ['Class 1', 'Class 2', 'Class 3'] });
    expect(res.status).toBe(201);
    programId = res.body.id;
    expect(res.body.levels.map((l: { name: string; sequence: number }) => [l.name, l.sequence])).toEqual([
      ['Class 1', 1],
      ['Class 2', 2],
      ['Class 3', 3],
    ]);
    expect((await A.post('/api/institution/programs', { name: 'Dup', code: 'P2', levels: ['A', 'a'] })).status).toBe(400);
  });

  it('reorders levels only with the complete set', async () => {
    const s = await A.get('/api/institution/structure');
    const levels = s.body.programs.find((p: { id: number }) => p.id === programId).levels.map((l: { id: number }) => l.id);
    expect((await A.put(`/api/institution/programs/${programId}/levels/order`, { level_ids: levels.slice(0, 2) })).status).toBe(400);
    expect((await A.put(`/api/institution/programs/${programId}/levels/order`, { level_ids: [...levels].reverse() })).status).toBe(200);
    const after = await A.get('/api/institution/structure');
    expect(after.body.programs.find((p: { id: number }) => p.id === programId).levels.map((l: { name: string }) => l.name)).toEqual(['Class 3', 'Class 2', 'Class 1']);
  });

  it('a level with classes cannot be deleted', async () => {
    expect((await A.delete(`/api/institution/levels/${f.institutions.A.level.id}`)).status).toBe(409);
  });
});

describe('academic years, terms and the calendar', () => {
  it('keeps exactly one current year', async () => {
    const res = await A.post('/api/institution/academic-years', {
      name: '2027–28',
      starts_on: '2027-08-01',
      ends_on: '2028-07-31',
      is_current: true,
      terms: [
        { name: 'Term 1', kind: 'semester', starts_on: '2027-08-01', ends_on: '2027-12-31' },
        { name: 'Term 2', kind: 'semester', starts_on: '2028-01-01', ends_on: '2028-07-31' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.terms).toHaveLength(2);
    const s = await A.get('/api/institution/structure');
    expect(s.body.academic_years.filter((y: { is_current: boolean }) => y.is_current).map((y: { name: string }) => y.name)).toEqual(['2027–28']);
    // back to the fixture's year
    expect((await A.patch(`/api/institution/academic-years/${f.institutions.A.year.id}`, { is_current: true })).status).toBe(200);
  });

  it('refuses terms outside their year and years that end before they start', async () => {
    expect((await A.post(`/api/institution/academic-years/${f.institutions.A.year.id}/terms`, { name: 'Late', starts_on: '2028-01-01' })).status).toBe(400);
    expect((await A.post('/api/institution/academic-years', { name: 'Bad', starts_on: '2027-08-01', ends_on: '2027-01-01' })).status).toBe(400);
  });

  it('lists holidays and terms in a range', async () => {
    expect((await A.post('/api/institution/holidays', { name: 'Iqbal Day', starts_on: '2026-11-09' })).status).toBe(201);
    expect((await A.post('/api/institution/holidays', { name: 'Back to front', starts_on: '2026-12-10', ends_on: '2026-12-01' })).status).toBe(400);
    const cal = await A.get('/api/institution/calendar?from=2026-11-01&to=2026-11-30');
    expect(cal.status).toBe(200);
    expect(cal.body.holidays.map((h: { name: string; ends_on: string }) => [h.name, h.ends_on])).toEqual([['Iqbal Day', '2026-11-09']]);
    expect(cal.body.terms.map((t: { name: string }) => t.name)).toContain('Annual');
    expect(cal.body.working_days).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('sections', () => {
  it('new sections default to the main campus and the current year', async () => {
    const res = await A.post('/api/institution/sections', { code: 'A3', name: 'Class 3', label: 'B', capacity: 30 });
    expect(res.status).toBe(201);
    expect(res.body.campus_id).toBe(f.institutions.A.campus.id);
    expect(res.body.academic_year_id).toBe(f.institutions.A.year.id);
  });

  it('filters and shows details with students and courses', async () => {
    const list = await A.get(`/api/institution/sections?search=a1`);
    expect(list.body.map((s: { code: string }) => s.code)).toEqual(['A1']);
    const d = await A.get(`/api/institution/sections/${f.sections.A1.id}`);
    expect(d.body.students.map((s: { first_name: string }) => s.first_name).sort()).toEqual(['Sam', 'Sara']);
    expect(d.body.offerings[0].staff[0].teacher_id).toBe(f.teachers.T1.id);
  });

  it('refuses another institution’s campus or teacher, and deleting a class that has students', async () => {
    expect((await A.post('/api/institution/sections', { code: 'Z1', name: 'Z', campus_id: f.institutions.B.campus.id })).status).toBe(400);
    expect((await A.patch(`/api/institution/sections/${f.sections.A2.id}`, { homeroom_teacher_id: f.teachers.TB.id })).status).toBe(400);
    expect((await A.delete(`/api/institution/sections/${f.sections.A1.id}`)).status).toBe(409);
    expect((await as(f.tokens.adminB).get(`/api/institution/sections/${f.sections.A1.id}`)).status).toBe(404);
  });
});

describe('courses, offerings and enrolment', () => {
  let course: number;
  let offering: number;
  it('keeps course codes unique', async () => {
    const res = await A.post('/api/institution/courses', { code: 'CS101', name: 'Programming', credit_hours: 4 });
    expect(res.status).toBe(201);
    course = res.body.id;
    expect((await A.post('/api/institution/courses', { code: 'CS101', name: 'Again' })).status).toBe(409);
    expect((await as(f.tokens.adminB).post('/api/institution/courses', { code: 'CS101', name: 'Theirs' })).status).toBe(201); // per institution
  });

  it('a whole-class course needs the class', async () => {
    expect((await A.post('/api/institution/offerings', { course_id: course, enrollment_mode: 'section' })).status).toBe(400);
    expect((await A.post('/api/institution/offerings', { course_id: f.courses['B1-MATH'].id, section_id: f.sections.A1.id })).status).toBe(400);
  });

  it('fills seats, then the waitlist, and moves the queue up when someone drops', async () => {
    const res = await A.post('/api/institution/offerings', { course_id: course, term_id: f.institutions.A.term.id, enrollment_mode: 'open', capacity: 2 });
    expect(res.status).toBe(201);
    offering = res.body.id;
    const { S1, S2, S3 } = f.students;
    const e = await A.post(`/api/institution/offerings/${offering}/enrollments`, { student_ids: [S1.id, S2.id, S3.id] });
    expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ enrolled: [S1.id, S2.id], waitlisted: [S3.id] });
    expect((await A.post(`/api/institution/offerings/${offering}/enrollments`, { student_ids: [S1.id] })).body.already).toEqual([S1.id]);
    expect((await A.delete(`/api/institution/offerings/${offering}/enrollments/${S1.id}`)).status).toBe(204);
    const roster = await A.get(`/api/institution/offerings/${offering}/enrollments`);
    expect(roster.body.students.filter((s: { status: string }) => s.status === 'active').map((s: { student_id: number }) => s.student_id).sort()).toEqual([S2.id, S3.id].sort());
    expect(roster.body.offering).toMatchObject({ enrolled: 2, waitlisted: 0 });
  });

  it('refuses students of another institution and is only for enrolment managers', async () => {
    expect((await A.post(`/api/institution/offerings/${offering}/enrollments`, { student_ids: [f.students.SB.id] })).status).toBe(400);
    expect((await as(f.tokens.t1).post(`/api/institution/offerings/${offering}/enrollments`, { student_ids: [f.students.S1.id] })).status).toBe(403);
  });

  it('assigns co-teachers and TAs', async () => {
    const res = await A.post(`/api/institution/offerings/${offering}/staff`, { teacher_id: f.teachers.T2.id, role: 'ta' });
    expect(res.status).toBe(201);
    expect(res.body.staff).toEqual([expect.objectContaining({ teacher_id: f.teachers.T2.id, role: 'ta' })]);
    expect((await A.post(`/api/institution/offerings/${offering}/staff`, { teacher_id: f.teachers.TB.id })).status).toBe(400);
  });

  it('a course with grades cannot be deleted', async () => {
    await fixture.pool.query(
      `WITH a AS (INSERT INTO assessments (institution_id, offering_id, kind, title, points, status) VALUES ($1,$4,'exam','Final',10,'published') RETURNING id)
       INSERT INTO grades (institution_id, assessment_id, student_id, points, status, released_at) SELECT $1, a.id, $2, 5, 'released', now() FROM a WHERE $3::int IS NOT NULL`,
      [f.institutions.A.id, f.students.S1.id, f.sections.A1.id, f.subjects.A1math.id]
    );
    expect((await A.delete(`/api/institution/offerings/${f.subjects.A1math.id}`)).status).toBe(409);
  });
});
