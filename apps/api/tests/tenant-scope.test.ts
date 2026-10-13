// Bug #8: queries must be scoped by school_id, not just by ref_id. Simulates inconsistent
// data (e.g. a bad import) where a school-B account's ref_id points at a school-A record.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

import { signToken } from '../src/middleware/auth';
import { grantSystemRole } from '../src/rbac';

let f;
let crossStudent;
let crossTeacher;
let crossParent;

beforeAll(async () => {
  f = await fixture.resetDb();
  const q = (sql: string, p?: unknown[]) => fixture.pool.query(sql, p);
  const { A, B } = f.schools;
  const { S1 } = f.students;
  await q(`INSERT INTO grades (school_id, student_id, class_id, subject_id, assignment_type, assignment_name, obtained_marks, total_marks)
           VALUES ($1,$2,$3,$4,'Quiz','A-only quiz',9,10)`, [A.id, S1.id, f.classes.A1.id, f.subjects.A1math.id]);
  await q(`INSERT INTO student_attendance (school_id, student_id, class_id, att_date, status) VALUES ($1,$2,$3,'2026-03-02','Present')`,
    [A.id, S1.id, f.classes.A1.id]);

  const mk = async (role, email, ref) => {
    const u = (await q(`INSERT INTO users (school_id, role, email, password_hash, full_name, ref_id) VALUES ($1,$2,$3,'x','Cross',$4) RETURNING *`,
      [B.id, role, email, ref])).rows[0];
    await grantSystemRole(fixture.pool, u.id, role, B.id); // a normal member of school B
    return u;
  };
  crossStudent = signToken(await mk('student', 'cross.s@beta.test', S1.id));
  crossTeacher = signToken(await mk('teacher', 'cross.t@beta.test', f.teachers.T1.id));
  const pB = await mk('parent', 'cross.p@beta.test', null);
  await q(`INSERT INTO parent_children (school_id, parent_user_id, student_id) VALUES ($1,$2,$3)`, [B.id, pB.id, S1.id]);
  crossParent = signToken(pB);
});

describe('tenant scoping on self-service endpoints', () => {
  it('student overview returns nothing from another school', async () => {
    const res = await as(crossStudent).get('/api/me/student/overview');
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
    expect(res.body.grades).toEqual([]);
    expect(res.body.attendance).toEqual([]);
    expect(res.body.fee).toBeNull();
  });

  it('student assignments return nothing from another school', async () => {
    const res = await as(crossStudent).get('/api/me/student/assignments');
    expect(res.body).toEqual([]);
  });

  it('teacher overview / classes / students / assignments return nothing from another school', async () => {
    const t = as(crossTeacher);
    const overview = (await t.get('/api/me/teacher/overview')).body;
    expect(overview.profile).toBeNull();
    expect(overview.classes).toEqual([]);
    expect(overview.subjects).toEqual([]);
    expect(overview.studentCount).toBe(0);
    expect((await t.get('/api/me/teacher/classes')).body).toEqual([]);
    expect((await t.get('/api/me/teacher/students')).body).toEqual([]);
    expect((await t.get('/api/me/teacher/assignments')).body).toEqual([]);
  });

  it('parent sees no child from another school', async () => {
    const p = as(crossParent);
    expect((await p.get('/api/parent/children')).body).toEqual([]);
    expect((await p.get(`/api/parent/child/${f.students.S1.id}/overview`)).status).toBe(404);
  });

  it('the legitimate users still see their data', async () => {
    const s1 = (await as(f.tokens.s1).get('/api/me/student/overview')).body;
    expect(s1.grades).toHaveLength(1);
    expect(s1.fee).not.toBeNull();
    const t1 = (await as(f.tokens.t1).get('/api/me/teacher/overview')).body;
    expect(t1.classes).toHaveLength(1);
    expect(t1.studentCount).toBe(2);
    expect((await as(f.tokens.p1).get('/api/parent/children')).body).toHaveLength(1);
    expect((await as(f.tokens.p1).get(`/api/parent/child/${f.students.S1.id}/overview`)).status).toBe(200);
  });

  it('a parent cannot open the overview of a child that is not theirs', async () => {
    const res = await as(f.tokens.p1).get(`/api/parent/child/${f.students.S2.id}/overview`);
    expect(res.status).toBe(403);
  });
});
