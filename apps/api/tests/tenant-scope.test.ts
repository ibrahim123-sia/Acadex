// Bug #8: queries must be scoped by institution_id, not just by ref_id. Simulates inconsistent
// data (e.g. a bad import) where an institution-B account's ref_id points at an institution-A record.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

import { grantSystemRole } from '../src/rbac';

let f;
let crossStudent;
let crossTeacher;
let crossParent;

beforeAll(async () => {
  f = await fixture.resetDb();
  const q = (sql: string, p?: unknown[]) => fixture.pool.query(sql, p);
  const { A, B } = f.institutions;
  const { S1 } = f.students;
  await q(`INSERT INTO grades (institution_id, assessment_id, student_id, points, status, released_at) VALUES ($1,$2,$3,9,'released',now())`, [A.id, f.assignments.ASG1.id, S1.id]);
  const sess = (await q(`INSERT INTO attendance_sessions (institution_id, section_id, date) VALUES ($1,$2,'2026-09-01') RETURNING id`, [A.id, f.sections.A1.id])).rows[0];
  await q(`INSERT INTO attendance_records (session_id, student_id, institution_id, status) VALUES ($1,$2,$3,'present')`, [sess.id, S1.id, A.id]);

  const mk = async (role, email, ref) => {
    const u = (await q(`INSERT INTO users (institution_id, role, email, password_hash, full_name, ref_id) VALUES ($1,$2,$3,'x','Cross',$4) RETURNING *`,
      [B.id, role, email, ref])).rows[0];
    await grantSystemRole(fixture.pool, u.id, role, B.id); // a normal member of institution B
    return u;
  };
  crossStudent = await fixture.tokenFor(await mk('student', 'cross.s@beta.test', S1.id));
  crossTeacher = await fixture.tokenFor(await mk('teacher', 'cross.t@beta.test', f.teachers.T1.id));
  const pB = await mk('parent', 'cross.p@beta.test', null);
  // an inconsistent row: a guardian in B linked to a student of A
  const gB = (await q(`INSERT INTO guardians (institution_id, user_id, first_name) VALUES ($1,$2,'Cross') RETURNING id`, [B.id, pB.id])).rows[0];
  await q(`INSERT INTO guardianships (institution_id, guardian_id, student_id) VALUES ($1,$2,$3)`, [B.id, gB.id, S1.id]);
  crossParent = await fixture.tokenFor(pB);
});

describe('tenant scoping on self-service endpoints', () => {
  it('student overview returns nothing from another institution', async () => {
    const res = await as(crossStudent).get('/api/me/student/overview');
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
    expect(res.body.grades).toEqual([]);
    expect(res.body.attendance).toEqual([]);
    expect(res.body.fee).toBeNull();
  });

  it('courses return nothing from another institution', async () => {
    const res = await as(crossStudent).get('/api/courses');
    expect(res.body).toEqual([]);
    expect((await as(crossStudent).get(`/api/courses/${f.subjects.A1math.id}`)).status).toBe(404);
  });

  it('teacher overview / sections / students / assignments return nothing from another institution', async () => {
    const t = as(crossTeacher);
    const overview = (await t.get('/api/me/teacher/overview')).body;
    expect(overview.profile).toBeNull();
    expect(overview.sections).toEqual([]);
    expect(overview.subjects).toEqual([]);
    expect(overview.studentCount).toBe(0);
    expect((await t.get('/api/me/teacher/sections')).body).toEqual([]);
    expect((await t.get('/api/courses')).body).toEqual([]);
  });

  it('parent sees no child from another institution', async () => {
    const p = as(crossParent);
    expect((await p.get('/api/parent/children')).body).toEqual([]);
    expect((await p.get(`/api/parent/child/${f.students.S1.id}/overview`)).status).toBe(404);
  });

  it('the legitimate users still see their data', async () => {
    const s1 = (await as(f.tokens.s1).get('/api/me/student/overview')).body;
    expect(s1.grades).toHaveLength(1);
    expect(s1.fee).not.toBeNull();
    const t1 = (await as(f.tokens.t1).get('/api/me/teacher/overview')).body;
    expect(t1.sections).toHaveLength(1);
    expect(t1.studentCount).toBe(2);
    expect((await as(f.tokens.p1).get('/api/parent/children')).body).toHaveLength(1);
    expect((await as(f.tokens.p1).get(`/api/parent/child/${f.students.S1.id}/overview`)).status).toBe(200);
  });

  it('a parent cannot open the overview of a child that is not theirs', async () => {
    const res = await as(f.tokens.p1).get(`/api/parent/child/${f.students.S2.id}/overview`);
    expect(res.status).toBe(403);
  });
});
