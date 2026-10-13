// Bug #7: a student can only submit to assignments of their own class, with a safe link.
import { describe, it, expect, beforeEach } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const count = async () => Number((await fixture.pool.query('SELECT count(*) FROM submissions')).rows[0].count);
const submit = (who, assignment_id, file_link = 'https://drive.example.com/my-work.pdf') =>
  as(f.tokens[who]).post('/api/me/student/submissions', { assignment_id, title: 'Mine', file_link });

describe('student submissions', () => {
  it('a student submits to their own class assignment', async () => {
    const res = await submit('s1', f.assignments.ASG1.id);
    expect(res.status).toBe(201);
    expect(res.body.student_id).toBe(f.students.S1.id);
    expect(res.body.school_id).toBe(f.schools.A.id);
  });

  it('cannot submit to another class assignment in the same school', async () => {
    const res = await submit('s3', f.assignments.ASG1.id);
    expect(res.status).toBe(403);
    expect(await count()).toBe(0);
  });

  it('cannot submit to an assignment of another school', async () => {
    const res = await submit('s1', f.assignments.ASGB.id);
    expect(res.status).toBe(404);
    expect(await count()).toBe(0);
  });

  it('cannot submit to an assignment that does not exist', async () => {
    const res = await submit('s1', 99999999);
    expect(res.status).toBe(404);
  });

  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'not a url', '']) {
    it(`rejects the link ${JSON.stringify(bad)}`, async () => {
      const res = await submit('s1', f.assignments.ASG1.id, bad);
      expect(res.status).toBe(400);
      expect(await count()).toBe(0);
    });
  }

  it('lists only assignments of the student’s own class', async () => {
    const res = await as(f.tokens.s1).get('/api/me/student/assignments');
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.id)).toEqual([f.assignments.ASG1.id]);
  });
});
