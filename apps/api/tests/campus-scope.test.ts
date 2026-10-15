// Multi-campus institutions: a role granted at one campus sees and changes only that campus;
// the dashboard compares campuses; a group administrator sees every institution of the group.
// Also the calendar: no attendance or due dates on holidays and non-working days.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';
import { grantSystemRole } from '../src/rbac';

let f: fixture.Fixture;
let principal: ReturnType<typeof as>;
let north: { id: number };
let northSection: { id: number };
let northStudent: { id: number };
const q = (sql: string, p: unknown[] = []) => fixture.pool.query(sql, p);

beforeAll(async () => {
  f = await fixture.resetDb();
  const A = f.institutions.A;
  north = (await q(`INSERT INTO campuses (institution_id, name, code) VALUES ($1,'North','NTH') RETURNING id`, [A.id])).rows[0];
  northSection = (
    await q(`INSERT INTO sections (institution_id, code, name, campus_id, academic_year_id, program_level_id) VALUES ($1,'N1','Class N1',$2,$3,$4) RETURNING id`, [
      A.id, north.id, A.year.id, A.level.id,
    ])
  ).rows[0];
  northStudent = (
    await q(`INSERT INTO students (institution_id, section_id, first_name, last_name, email) VALUES ($1,$2,'Nida','N','nida@alpha.test') RETURNING id`, [A.id, northSection.id])
  ).rows[0];
  await q(`INSERT INTO tuition_fee (institution_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status) VALUES ($1,'RCP-N1',$2,800,800,0,'Paid')`, [A.id, northStudent.id]);
  // a "Branch principal" role granted only at the North campus
  const role = (await q(`INSERT INTO roles (institution_id, key, name, scope_type) VALUES ($1,'principal','Branch principal','institution') RETURNING id`, [A.id])).rows[0];
  await q(`INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`, [
    role.id,
    ['institution.dashboard.read', 'students.read', 'students.manage', 'sections.read', 'sections.manage', 'staff.read'],
  ]);
  const u = (await q(`INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES ($1,'institution_admin','pr@alpha.test','x','Principal North') RETURNING *`, [A.id])).rows[0];
  await q(`INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, institution_id) VALUES ($1,$2,'campus',$3,$4)`, [u.id, role.id, north.id, A.id]);
  principal = as(await fixture.tokenFor(u));
});

describe('campus-scoped roles', () => {
  it('see only their campus in lists and the dashboard', async () => {
    const students = await principal.get('/api/institution/students');
    expect(students.status).toBe(200);
    expect(students.body.map((s: { id: number }) => s.id)).toEqual([northStudent.id]);
    const sections = await principal.get('/api/institution/sections');
    expect(sections.body.map((s: { id: number }) => s.id)).toEqual([northSection.id]);
    const d = await principal.get('/api/institution/dashboard');
    expect(d.body).toMatchObject({ students: 1, sections: 1, feeCollected: 800 });
    expect(d.body.campuses.map((c: { code: string }) => c.code)).toEqual(['NTH']);
  });

  it('cannot open, change or admit into another campus', async () => {
    expect((await principal.get(`/api/institution/students/${f.students.S1.id}`)).status).toBe(403);
    expect((await principal.patch(`/api/institution/students/${f.students.S1.id}`, { first_name: 'X' })).status).toBe(403);
    expect((await principal.post('/api/institution/students', { first_name: 'A', last_name: 'B', email: 'ab@alpha.test', section_id: f.sections.A1.id })).status).toBe(403);
    expect((await principal.post('/api/institution/students', { first_name: 'A', last_name: 'B', email: 'ab@alpha.test' })).status).toBe(400); // must pick a class
    expect((await principal.get(`/api/institution/dashboard?campus_id=${f.institutions.A.campus.id}`)).status).toBe(403);
    expect((await principal.patch(`/api/institution/sections/${northSection.id}`, { campus_id: f.institutions.A.campus.id })).status).toBe(403);
    expect((await principal.post('/api/institution/students', { first_name: 'Nimra', last_name: 'B', email: 'nimra@alpha.test', section_id: northSection.id })).status).toBe(201);
  });

  it('the institution admin compares every campus side by side', async () => {
    const d = await as(f.tokens.adminA).get('/api/institution/dashboard');
    expect(d.body.campuses.map((c: { code: string; students: number }) => [c.code, c.students])).toEqual([
      ['MAIN', 3],
      ['NTH', 2],
    ]);
    const one = await as(f.tokens.adminA).get(`/api/institution/dashboard?campus_id=${north.id}`);
    expect(one.body.students).toBe(2);
  });
});

describe('institution groups', () => {
  it('a group admin sees the group’s institutions, nobody else does', async () => {
    const g = (await q(`INSERT INTO institution_groups (name, slug) VALUES ('Demo group', 'demo') RETURNING id`)).rows[0];
    await q(`UPDATE institutions SET group_id = $1 WHERE id = $2`, [g.id, f.institutions.A.id]);
    const u = (await q(`INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES (NULL,'group_admin','g@acadex.test','x','Group') RETURNING *`)).rows[0];
    await grantSystemRole(fixture.pool, u.id, 'group_admin', g.id);
    const res = await as(await fixture.tokenFor(u)).get('/api/group/overview');
    expect(res.status).toBe(200);
    expect(res.body.institutions.map((i: { slug: string }) => i.slug)).toEqual(['alpha']);
    expect((await as(f.tokens.adminA).get('/api/group/overview')).status).toBe(403);
    expect((await as(f.tokens.super).get('/api/group/overview')).status).toBe(403);
  });
});

describe('the calendar is respected', () => {
  const att = (date: string) => ({ section_id: f.sections.A1.id, date, records: [{ student_id: f.students.S1.id, status: 'present' }] });
  it('no attendance on a holiday or a non-working day', async () => {
    await as(f.tokens.adminA).post('/api/institution/holidays', { name: 'Iqbal Day', starts_on: '2026-10-05' });
    const t1 = as(f.tokens.t1);
    const holiday = await t1.put('/api/attendance/register', att('2026-10-05'));
    expect(holiday.status).toBe(409);
    expect(holiday.body.code).toBe('HOLIDAY');
    const sunday = await t1.put('/api/attendance/register', att('2026-10-04'));
    expect(sunday.body.code).toBe('NON_WORKING_DAY');
    expect((await t1.put('/api/attendance/register', att('2026-10-06'))).status).toBe(200);
    const roster = await t1.get(`/api/attendance/register?section_id=${f.sections.A1.id}&date=2026-10-05`);
    expect(roster.body.holiday).toBe('Iqbal Day');
  });

  it('due dates move off holidays, with a suggestion', async () => {
    const res = await as(f.tokens.t1).post(`/api/courses/${f.subjects.A1math.id}/assessments`, { title: 'HW', due_at: '2026-10-04T12:00:00+05:00' });
    expect(res.status).toBe(409);
    expect(res.body.details.suggested_date).toBe('2026-10-06'); // Sunday → Monday is Iqbal Day → Tuesday
  });

  it('a campus holiday only closes that campus', async () => {
    await as(f.tokens.adminA).post('/api/institution/holidays', { name: 'North sports day', starts_on: '2026-10-07', campus_id: north.id });
    expect((await as(f.tokens.t1).put('/api/attendance/register', att('2026-10-07'))).status).toBe(200);
  });
});
