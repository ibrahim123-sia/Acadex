// Bug #3 + the unguarded /institution/* reads: every endpoint must reject roles it isn't for.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
});

const ALL_ROLES = ['super', 'adminA', 't1', 's1', 'p1'];

// [method, path ({A1} = class A1 id), allowed fixture users, body(f)?]
type Endpoint = [method: 'get' | 'post', path: string, allowed: string[], body?: () => unknown];
const ENDPOINTS: Endpoint[] = [
  ['get', '/api/institution/dashboard', ['adminA']],
  ['get', '/api/institution/students', ['adminA']],
  ['get', '/api/institution/teachers', ['adminA']],
  ['get', '/api/institution/classes', ['adminA']],
  ['get', '/api/institution/fees', ['adminA']],
  ['get', '/api/institution/grades', ['adminA']],
  ['get', '/api/institution/attendance', ['adminA']],
  ['get', '/api/institution/timetable', ['adminA']],
  ['get', '/api/institution/exams', ['adminA']],
  ['get', '/api/institution/announcements', ['adminA']],
  ['post', '/api/institution/announcements', ['adminA'], () => ({ title: 'x', description: 'y' })],
  ['post', '/api/institution/classes', ['adminA'], () => ({ code: 'ZZ', name: 'Z' })],

  ['get', '/api/me/teacher/overview', ['t1']],
  ['get', '/api/me/teacher/students', ['t1']],
  ['get', '/api/me/teacher/classes', ['t1']],
  ['get', '/api/me/teacher/class/{A1}/roster', ['t1']],
  ['get', '/api/me/teacher/assignments', ['t1']],
  ['post', '/api/me/teacher/attendance', ['t1'], () => ({ class_id: f.classes.A1.id, date: '2026-01-05', records: [] })],
  ['post', '/api/me/teacher/grades', ['t1'], () => ({ class_id: f.classes.A1.id, assignment_name: 'Q', records: [] })],
  ['post', '/api/me/teacher/assignments', ['t1'], () => ({ class_id: f.classes.A1.id, title: 'role test' })],

  ['get', '/api/me/student/overview', ['s1']],
  ['get', '/api/me/student/assignments', ['s1']],
  ['post', '/api/me/student/submissions', ['s1'], () => ({ assignment_id: f.assignments.ASG1.id, file_link: 'https://example.com/a' })],

  ['get', '/api/me/announcements', ['t1', 's1', 'p1']],
  ['get', '/api/me/notifications', ALL_ROLES],

  ['get', '/api/platform/stats', ['super']],
  ['get', '/api/platform/institutions', ['super']],
  ['get', '/api/platform/audit', ['super']],

  ['get', '/api/parent/children', ['p1']],
];

describe('role guards', () => {
  for (const [method, path, allowed, body] of ENDPOINTS) {
    for (const who of ALL_ROLES) {
      const expectAllowed = allowed.includes(who);
      it(`${method.toUpperCase()} ${path} as ${who} → ${expectAllowed ? 'allowed' : '403'}`, async () => {
        const url = path.replace('{A1}', f.classes.A1.id);
        const res = await as(f.tokens[who])[method](url, body?.());
        if (expectAllowed) expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);
        else expect(res.status, JSON.stringify(res.body)).toBe(403);
      });
    }
  }

  it('rejects requests without a token', async () => {
    const res = await as(null).get('/api/institution/students');
    expect(res.status).toBe(401);
  });
});
