// Every LMS endpoint refuses anonymous callers, and a signed-in person from another institution
// can't read or change anything of institution A through it (ids of A's records are used).
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';
import { lmsRoutes } from '../src/openapi-lms';
import type { RouteDoc } from '../src/openapi';

let f;
const ids: Record<string, number> = {};

beforeAll(async () => {
  f = await fixture.resetDb();
  const q = async (sql: string, p: unknown[]) => (await fixture.pool.query(sql, p)).rows[0];
  const A = f.institutions.A.id;
  const course = f.subjects.A1math.id;
  ids.course = course;
  ids.assessment = f.assignments.ASG1.id;
  ids.module = (await q(`INSERT INTO modules (institution_id, offering_id, title, published) VALUES ($1,$2,'M',true) RETURNING id`, [A, course])).id;
  ids.item = (await q(`INSERT INTO content_items (institution_id, module_id, kind, title) VALUES ($1,$2,'page','P') RETURNING id`, [A, ids.module])).id;
  ids.discussion = (await q(`INSERT INTO discussions (institution_id, offering_id, title) VALUES ($1,$2,'D') RETURNING id`, [A, course])).id;
  ids.post = (await q(`INSERT INTO discussion_posts (institution_id, discussion_id, author_id, body_html) VALUES ($1,$2,$3,'<p>x</p>') RETURNING id`, [A, ids.discussion, f.users.s1.id])).id;
  ids.bank = (await q(`INSERT INTO question_banks (institution_id, name) VALUES ($1,'B') RETURNING id`, [A])).id;
  ids.question = (await q(`INSERT INTO questions (institution_id, bank_id, type, prompt_html, data) VALUES ($1,$2,'true_false','<p>?</p>','{"correct":true}') RETURNING id`, [A, ids.bank])).id;
  ids.submission = (await q(`INSERT INTO submissions (institution_id, assessment_id, student_id, status) VALUES ($1,$2,$3,'submitted') RETURNING id`, [A, ids.assessment, f.students.S1.id])).id;
  ids.version = (await q(`INSERT INTO submission_versions (institution_id, submission_id, version) VALUES ($1,$2,1) RETURNING id`, [A, ids.submission])).id;
  ids.rubric = (await q(`INSERT INTO rubrics (institution_id, offering_id, title) VALUES ($1,$2,'R') RETURNING id`, [A, course])).id;
  ids.groupSet = (await q(`INSERT INTO group_sets (institution_id, offering_id, name) VALUES ($1,$2,'G') RETURNING id`, [A, course])).id;
  ids.group = (await q(`INSERT INTO student_groups (institution_id, group_set_id, name) VALUES ($1,$2,'g') RETURNING id`, [A, ids.groupSet])).id;
  ids.category = (await q(`INSERT INTO grade_categories (institution_id, offering_id, name) VALUES ($1,$2,'C') RETURNING id`, [A, course])).id;
  ids.poll = (await q(`INSERT INTO polls (institution_id, offering_id, question, options) VALUES ($1,$2,'Q','["a","b"]') RETURNING id`, [A, course])).id;
  ids.survey = (await q(`INSERT INTO surveys (institution_id, offering_id, title, questions, status) VALUES ($1,$2,'S','[]','open') RETURNING id`, [A, course])).id;
  ids.live = (await q(`INSERT INTO live_sessions (institution_id, offering_id, title, provider, join_url, starts_at) VALUES ($1,$2,'L','jitsi','https://meet.jit.si/x',now()) RETURNING id`, [A, course])).id;
  ids.room = (await q(`INSERT INTO rooms (institution_id, name, code) VALUES ($1,'R','R1') RETURNING id`, [A])).id;
  ids.period = (await q(`INSERT INTO periods (institution_id, name, starts_at, ends_at, position) VALUES ($1,'P','08:00','08:45',1) RETURNING id`, [A])).id;
  ids.slot = (await q(`INSERT INTO timetable_slots (institution_id, section_id, weekday, period_id) VALUES ($1,$2,1,$3) RETURNING id`, [A, f.sections.A1.id, ids.period])).id;
  ids.session = (await q(`INSERT INTO attendance_sessions (institution_id, section_id, date) VALUES ($1,$2,'2026-09-01') RETURNING id`, [A, f.sections.A1.id])).id;
  ids.leave = (await q(`INSERT INTO leave_requests (institution_id, student_id, from_date, to_date, requested_by) VALUES ($1,$2,'2026-09-01','2026-09-01',$3) RETURNING id`, [A, f.students.S1.id, f.users.p1.id])).id;
  ids.attempt = (await q(`INSERT INTO quiz_attempts (institution_id, assessment_id, student_id, attempt_no, layout) VALUES ($1,$2,$3,1,'[]') RETURNING id`, [A, ids.assessment, f.students.S1.id])).id;
  ids.blueprint = (await q(`INSERT INTO course_blueprints (institution_id, title) VALUES ($1,'BP') RETURNING id`, [A])).id;
  ids.badge = (await q(`INSERT INTO badges (institution_id, name, criteria) VALUES ($1,'B','{"kind":"manual"}') RETURNING id`, [A])).id;
  ids.cert = (await q(`INSERT INTO certificates (institution_id, student_id, offering_id, verify_code, title, body) VALUES ($1,$2,$3,'CERTCODE01','T','B') RETURNING id`, [A, f.students.S1.id, course])).id;
  ids.annotation = (await q(`INSERT INTO submission_annotations (institution_id, version_id, shape) VALUES ($1,$2,'{"kind":"pin","x":0,"y":0}') RETURNING id`, [A, ids.version])).id;
  ids.peerReview = (await q(`INSERT INTO peer_reviews (institution_id, assessment_id, submission_id, reviewer_student_id) VALUES ($1,$2,$3,$4) RETURNING id`, [A, ids.assessment, ids.submission, f.students.S2.id])).id;
  ids.extension = (await q(`INSERT INTO assessment_extensions (institution_id, assessment_id, student_id) VALUES ($1,$2,$3) RETURNING id`, [A, ids.assessment, f.students.S1.id])).id;
  ids.scormItem = ids.item!;
});

/** Fill a route's parameters with institution A's records. */
function fill(path: string) {
  const seg = (name: string) => {
    const before = path.split(`:${name}`)[0]!.split('/').filter(Boolean).pop() ?? '';
    const map: Record<string, string> = {
      courses: 'course', assessments: 'assessment', modules: 'module', 'content-items': 'item', discussions: 'discussion', posts: 'post',
      'question-banks': 'bank', questions: 'question', submissions: 'submission', versions: 'version', rubrics: 'rubric', 'group-sets': 'groupSet',
      groups: 'group', 'grade-categories': 'category', polls: 'poll', surveys: 'survey', live: 'live', rooms: 'room', slots: 'slot',
      sessions: 'session', leave: 'leave', attempts: 'attempt', blueprints: 'blueprint', badges: 'badge', certificates: 'cert',
      annotations: 'annotation', 'peer-reviews': 'peerReview', extensions: 'extension', items: 'scormItem', teachers: 'teacher', students: 'student',
      substitutions: 'slot', grades: 'student',
    };
    const key = map[before];
    if (key === 'teacher') return f.teachers.T1.id;
    if (key === 'student') return f.students.S1.id;
    return key ? ids[key] : 1;
  };
  return path
    .replace('/api', '/api')
    .replace(/:(\w+)/g, (_m, name: string) => String(seg(name) ?? 1));
}

const routes = lmsRoutes((method, path, tag, summary, auth, extra = {}) => ({ method, path, tag, summary, auth, ...extra }) as RouteDoc).filter((r) => r.auth !== 'public');

describe('LMS endpoints', () => {
  for (const r of routes) {
    it(`${r.method.toUpperCase()} ${r.path}: anonymous → 401`, async () => {
      const res = await as(null)[r.method](fill(r.path), {});
      expect(res.status).toBe(401);
    });
    it(`${r.method.toUpperCase()} ${r.path}: another institution → refused`, async () => {
      // the teacher of institution B, with B's own permissions
      const res = await as(f.tokens.tb)[r.method](fill(r.path), {});
      // personal endpoints (my notifications, my calendar, banks of B…) may answer; they must not expose A
      if (res.status < 300) {
        expect(JSON.stringify(res.body)).not.toMatch(/Alpha|Sara|Tina|A1-MATH|s1@alpha/);
      } else expect([400, 403, 404, 409]).toContain(res.status);
    });
  }
});
