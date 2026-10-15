// Bug #7: a student can only hand in work of their own courses, with a safe link.
import { describe, it, expect, beforeEach } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
  // links are accepted on these assignments
  await fixture.pool.query(`UPDATE assessments SET submission_types = ARRAY['text','file','link']`);
});

const count = async () => Number((await fixture.pool.query(`SELECT count(*) FROM submissions WHERE status <> 'draft'`)).rows[0].count);
const submit = (who, id, link_url = 'https://drive.example.com/my-work.pdf') => as(f.tokens[who]).post(`/api/assessments/${id}/submission`, { link_url });

describe('student submissions', () => {
  it('a student hands in work of their own course', async () => {
    const res = await submit('s1', f.assignments.ASG1.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { rows } = await fixture.pool.query(`SELECT student_id, institution_id, status FROM submissions`);
    expect(rows).toEqual([{ student_id: f.students.S1.id, institution_id: f.institutions.A.id, status: 'submitted' }]);
  });

  it('cannot hand in work of another class in the same institution', async () => {
    const res = await submit('s3', f.assignments.ASG1.id);
    expect(res.status).toBe(403);
    expect(await count()).toBe(0);
  });

  it('cannot hand in work of another institution', async () => {
    const res = await submit('s1', f.assignments.ASGB.id);
    expect(res.status).toBe(404);
    expect(await count()).toBe(0);
  });

  it('cannot hand in work that does not exist', async () => {
    expect((await submit('s1', 99999999)).status).toBe(404);
  });

  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'not a url']) {
    it(`rejects the link ${JSON.stringify(bad)}`, async () => {
      const res = await submit('s1', f.assignments.ASG1.id, bad);
      expect(res.status).toBe(400);
      expect(await count()).toBe(0);
    });
  }

  it('lists only work of the student’s own courses', async () => {
    const mine = await as(f.tokens.s1).get(`/api/courses/${f.subjects.A1math.id}/assessments`);
    expect(mine.status).toBe(200);
    expect(mine.body.map((a) => a.id)).toEqual([f.assignments.ASG1.id]);
    expect((await as(f.tokens.s1).get(`/api/courses/${f.subjects.A2math.id}/assessments`)).status).toBe(403);
  });

  it('a draft can be saved and handed in later; versions are kept', async () => {
    const s1 = as(f.tokens.s1);
    const id = f.assignments.ASG1.id;
    expect((await s1.post(`/api/assessments/${id}/submission`, { text_html: '<p>first</p>', submit: false })).status).toBe(200);
    expect(await count()).toBe(0);
    const done = await s1.post(`/api/assessments/${id}/submission`, { text_html: '<p>final <script>x</script></p>' });
    expect(done.status).toBe(201);
    expect(done.body.version).toBe(2);
    const mine = await s1.get(`/api/assessments/${id}/submission`);
    expect(mine.body.submissions[0].versions.map((v) => v.text_html)).toEqual(['<p>first</p>', '<p>final </p>']);
    // one attempt only
    expect((await s1.post(`/api/assessments/${id}/submission`, { text_html: '<p>again</p>' })).status).toBe(409);
  });
});
