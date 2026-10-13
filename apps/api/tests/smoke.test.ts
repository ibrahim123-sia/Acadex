import { describe, it, expect, beforeAll } from 'vitest';
import { app, as, fixture, request } from './helpers/http';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
});

describe('smoke', () => {
  it('health check reports the database as connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('connected');
  });

  it('readiness reports all migrations applied', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('READY');
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@alpha.test', password: f.PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('school_admin');
  });

  it('admin sees only their own school students', async () => {
    const res = await as(f.tokens.adminA).get('/api/school/students');
    expect(res.status).toBe(200);
    const ids = res.body.map((s) => s.id).sort();
    expect(ids).toEqual([f.students.S1.id, f.students.S2.id, f.students.S3.id].sort());
  });
});
