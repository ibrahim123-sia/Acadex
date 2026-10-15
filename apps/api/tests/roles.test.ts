// Bug #3 + the unguarded /institution/* reads: every endpoint must reject roles it isn't for.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
beforeAll(async () => {
  f = await fixture.resetDb();
});

const ALL_ROLES = ['super', 'adminA', 't1', 's1', 'p1'];

// [method, path ({A1} = class A1 id), allowed fixture users, body(f)?]
type Endpoint = [method: 'get' | 'post' | 'put', path: string, allowed: string[], body?: () => unknown];
const ENDPOINTS: Endpoint[] = [
  ['get', '/api/institution/dashboard', ['adminA']],
  ['get', '/api/institution/students', ['adminA']],
  ['get', '/api/institution/teachers', ['adminA']],
  ['get', '/api/institution/sections', ['adminA']],
  ['get', '/api/institution/fees', ['adminA']],
  ['get', '/api/institution/grades', ['adminA']],
  ['get', '/api/institution/attendance', ['adminA']],
  ['get', '/api/institution/timetable', ['adminA']],
  ['get', '/api/institution/exams', ['adminA']],
  ['get', '/api/institution/announcements', ['adminA']],
  ['post', '/api/announcements', ['adminA'], () => ({ title: 'x', description: 'y', notify: false })],
  ['post', '/api/institution/sections', ['adminA'], () => ({ code: 'ZZ', name: 'Z' })],

  ['get', '/api/me/teacher/overview', ['t1']],
  ['get', '/api/me/teacher/sections', ['t1']],
  ['get', '/api/attendance/register?section_id={A1}&date=2026-09-01', ['adminA', 't1']],
  ['put', '/api/attendance/register', ['adminA', 't1'], () => ({ section_id: f.sections.A1.id, date: '2026-09-01', records: [] })],
  ['put', '/api/assessments/{ASG1}/grades', ['adminA', 't1'], () => ({ grades: [{ student_id: f.students.S1.id, points: 5 }] })],
  ['post', '/api/courses/{A1math}/assessments', ['adminA', 't1'], () => ({ title: 'role test' })],
  ['get', '/api/courses/{A1math}/gradebook', ['adminA', 't1', 's1', 'p1']],
  ['get', '/api/attendance/staff', ['adminA']],
  ['get', '/api/leave?scope=approve', ['adminA', 't1']],

  ['get', '/api/me/student/overview', ['s1']],
  ['post', '/api/assessments/{ASG1}/submission', ['s1'], () => ({ text_html: '<p>mine</p>', submit: false })],

  ['get', '/api/announcements', ['adminA', 't1', 's1', 'p1']],
  ['get', '/api/notifications', ALL_ROLES],
  ['get', '/api/me/dashboard', ['adminA', 't1', 's1', 'p1']],
  ['get', '/api/timetable/me', ['t1', 's1', 'p1']],

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
        const url = path.replace('{A1}', f.sections.A1.id).replace('{A1math}', f.subjects.A1math.id).replace('{ASG1}', f.assignments.ASG1.id);
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
