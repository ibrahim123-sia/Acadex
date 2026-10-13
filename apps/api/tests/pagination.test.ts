// Bug #12: lists are paginated (page/pageSize, X-Total-Count) instead of silently
// truncated, and query parameters are validated.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
  const q = (sql: string, p?: unknown[]) => fixture.pool.query(sql, p);
  // 120 more students in institution A (3 already exist) and 40 unread notifications for t1
  await q(`INSERT INTO students (institution_id, class_id, roll_no, first_name, last_name, email)
           SELECT $1, $2, 'R' || g, 'Bulk', 'Student ' || g, 'bulk' || g || '@alpha.test' FROM generate_series(1, 120) g`,
    [f.institutions.A.id, f.classes.A1.id]);
  await q(`INSERT INTO notifications (institution_id, user_id, title) SELECT $1, $2, 'N' || g FROM generate_series(1, 40) g`,
    [f.institutions.A.id, f.users.t1.id]);
  await q(`INSERT INTO audit_log (institution_id, actor, action) SELECT $1, 'x', 'act' || g FROM generate_series(1, 75) g`, [f.institutions.A.id]);
});

describe('pagination', () => {
  it('returns the first page with the total in a header', async () => {
    const res = await as(f.tokens.adminA).get('/api/institution/students');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
    expect(res.headers['x-total-count']).toBe('123');
    expect(res.headers['x-page']).toBe('1');
    expect(res.headers['x-page-size']).toBe('50');
  });

  it('returns later pages without overlap', async () => {
    const a = as(f.tokens.adminA);
    const p1 = (await a.get('/api/institution/students?page=1&pageSize=60')).body.map((s) => s.id);
    const p2 = (await a.get('/api/institution/students?page=2&pageSize=60')).body.map((s) => s.id);
    const p3 = (await a.get('/api/institution/students?page=3&pageSize=60')).body.map((s) => s.id);
    expect(p1).toHaveLength(60);
    expect(p2).toHaveLength(60);
    expect(p3).toHaveLength(3);
    expect(new Set([...p1, ...p2, ...p3]).size).toBe(123);
  });

  it('search filters before paginating and the total reflects it', async () => {
    const res = await as(f.tokens.adminA).get('/api/institution/students?search=student 11');
    expect(res.headers['x-total-count']).toBe('11'); // 11, 110..119
  });

  it('rejects page sizes above 100 and non-positive pages', async () => {
    const a = as(f.tokens.adminA);
    expect((await a.get('/api/institution/students?pageSize=500')).status).toBe(400);
    expect((await a.get('/api/institution/students?page=0')).status).toBe(400);
    expect((await a.get('/api/institution/students?page=abc')).status).toBe(400);
  });

  it('rejects an over-long search string', async () => {
    const res = await as(f.tokens.adminA).get(`/api/institution/students?search=${'x'.repeat(101)}`);
    expect(res.status).toBe(400);
  });

  it('paginates the platform audit log', async () => {
    const res = await as(f.tokens.super).get('/api/platform/audit?pageSize=20&page=4');
    expect(res.body).toHaveLength(15);
    expect(res.headers['x-total-count']).toBe('75');
  });

  it('the unread notification count is not capped by the page size', async () => {
    const res = await as(f.tokens.t1).get('/api/me/notifications');
    expect(res.body.items).toHaveLength(20);
    expect(res.body.unread).toBe(40);
  });

  for (const path of ['/api/institution/teachers', '/api/institution/fees', '/api/institution/grades', '/api/institution/attendance',
    '/api/institution/classes', '/api/institution/announcements', '/api/institution/timetable', '/api/institution/exams']) {
    it(`${path} is paginated`, async () => {
      const res = await as(f.tokens.adminA).get(`${path}?pageSize=1`);
      expect(res.status).toBe(200);
      expect(res.headers['x-total-count']).toBeDefined();
      expect(res.body.length).toBeLessThanOrEqual(1);
    });
  }

  it('browsers can read the pagination headers', async () => {
    const res = await as(f.tokens.adminA).get('/api/institution/students').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Total-Count/i);
  });
});
