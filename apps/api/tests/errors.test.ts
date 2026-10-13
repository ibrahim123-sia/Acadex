// Async handler errors must become clean 4xx/5xx responses — never an unhandled
// rejection (which kills the Node process) and never leaked database internals.
import { describe, it, expect, beforeAll } from 'vitest';
import { app, as, fixture, request } from './helpers/http';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
});

const leaksInternals = (body) => /violates|constraint|relation|syntax|column|pg_|SQL/i.test(JSON.stringify(body));

describe('error handling', () => {
  it('a bad foreign key in a write returns 400, not a crash', async () => {
    const res = await as(f.tokens.t1).post('/api/me/teacher/grades', {
      class_id: f.classes.A1.id,
      assignment_name: 'Quiz',
      total_marks: 10,
      records: [{ student_id: 99999999, obtained_marks: 5 }],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(leaksInternals(res.body)).toBe(false);
  });

  it('a non-numeric id in a URL returns 4xx, not a crash', async () => {
    const res = await as(f.tokens.adminA).get('/api/pdf/report-card/not-a-number');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(leaksInternals(res.body)).toBe(false);
  });

  it('malformed JSON returns 400 with a generic message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(leaksInternals(res.body)).toBe(false);
  });

  it('a duplicate email when admitting a student returns 409 without internals', async () => {
    const res = await as(f.tokens.adminA).post('/api/institution/students', {
      first_name: 'Dup',
      last_name: 'Licate',
      email: 's1@alpha.test',
    });
    expect(res.status).toBe(409);
    expect(leaksInternals(res.body)).toBe(false);
  });

  it('the API still answers after those errors', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
