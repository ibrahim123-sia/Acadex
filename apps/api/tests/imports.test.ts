// Bulk import: CSV with loose / OneRoster headers, a dry run that changes nothing, a commit
// that is all-or-nothing unless told to skip bad rows, upserts, and bulk invitations.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f: fixture.Fixture;
let A: ReturnType<typeof as>;
const csv = (s: string) => ({ buffer: Buffer.from(s.trim() + '\n'), name: 'people.csv' });
const count = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows[0].n as number;

beforeAll(async () => {
  f = await fixture.resetDb();
  A = as(f.tokens.adminA);
});

const STUDENTS = `
givenName,familyName,Email,Roll No,Class,Date of birth,Guardian name,Guardian phone
Hira,Shah,hira@alpha.test,A1-010,A1,05/03/2015,Kamran Shah,0300111
Bilal,Aziz,bilal@alpha.test,A1-011,a1,2015-07-01,,
Bad,Row,not-an-email,A1-012,ZZ,,,
`;

describe('student import', () => {
  it('previews row by row without changing anything', async () => {
    const before = await count(`SELECT count(*)::int n FROM students`);
    const res = await A.upload('post', '/api/institution/imports/students/preview', csv(STUDENTS));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, valid: 2, invalid: 1, creates: 2 });
    expect(res.body.columns.matched).toEqual(expect.arrayContaining(['first_name', 'last_name', 'email', 'roll_no', 'section', 'dob', 'guardian_name']));
    expect(res.body.rows[2]).toMatchObject({ row: 4 });
    expect(res.body.rows[2].errors.map((e: { field: string }) => e.field).sort()).toEqual(['email', 'section']);
    expect(await count(`SELECT count(*)::int n FROM students`)).toBe(before);
  });

  it('refuses to commit with bad rows, or imports only the good ones when asked', async () => {
    const refused = await A.upload('post', '/api/institution/imports/students/commit', csv(STUDENTS));
    expect(refused.status).toBe(422);
    expect(await count(`SELECT count(*)::int n FROM students WHERE email = 'hira@alpha.test'`)).toBe(0);
    const ok = await A.upload('post', '/api/institution/imports/students/commit', csv(STUDENTS), { skip_invalid: 'true' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ imported: 2, skipped: 1, accounts: 2, invites_sent: 0 });
    const { rows } = await fixture.pool.query(
      `SELECT st.dob, sec.code, g.first_name g FROM students st JOIN sections sec ON sec.id = st.section_id
         LEFT JOIN guardianships gs ON gs.student_id = st.id LEFT JOIN guardians g ON g.id = gs.guardian_id WHERE st.email = 'hira@alpha.test'`
    );
    expect(rows[0]).toEqual({ dob: '2015-03-05', code: 'A1', g: 'Kamran' }); // DD/MM/YYYY understood
    const jobs = await A.get('/api/institution/imports');
    expect(jobs.body[0]).toMatchObject({ entity: 'students', ok_rows: 2, error_rows: 1 });
  });

  it('upserts by email (or roll number) when asked, never duplicates', async () => {
    const again = await A.upload('post', '/api/institution/imports/students/preview', csv(STUDENTS));
    expect(again.body.rows[0].errors[0].message).toContain('already exists');
    const upd = await A.upload('post', '/api/institution/imports/students/commit', csv(`email,last_name,phone\nhira@alpha.test,Shah-Khan,0321`), { mode: 'upsert' });
    expect(upd.status).toBe(201);
    expect(upd.body.updates).toBe(1);
    const { rows } = await fixture.pool.query(`SELECT last_name, phone, first_name FROM students WHERE email = 'hira@alpha.test'`);
    expect(rows[0]).toEqual({ last_name: 'Shah-Khan', phone: '0321', first_name: 'Hira' });
  });

  it('spots duplicate emails inside the file and other institutions’ classes', async () => {
    const res = await A.upload('post', '/api/institution/imports/students/preview', csv(`first_name,last_name,email,section\nA,B,dup@alpha.test,A1\nC,D,dup@alpha.test,B1`));
    expect(res.body.rows[1].errors.map((e: { message: string }) => e.message)).toEqual(expect.arrayContaining(['Appears twice in this file', 'No class with code "B1"']));
  });

  it('needs both the import and the students permission', async () => {
    expect((await as(f.tokens.t1).upload('post', '/api/institution/imports/students/preview', csv(STUDENTS))).status).toBe(403);
    const role = await A.post('/api/institution/roles', { name: 'Importer', permissions: ['imports.run'] });
    await A.post(`/api/institution/users/${f.users.t2.id}/roles`, { role_id: role.body.id });
    const t2 = as(await fixture.tokenFor(f.users.t2));
    expect((await t2.upload('post', '/api/institution/imports/students/preview', csv(STUDENTS))).status).toBe(403);
  });

  it('rejects files that are not CSV or Excel', async () => {
    const res = await A.upload('post', '/api/institution/imports/students/preview', { buffer: Buffer.from('%PDF-1.4 nope'), name: 'x.pdf' });
    expect(res.status).toBe(415);
  });
});

describe('other imports', () => {
  it('courses, then enrolments into an open course with its waitlist', async () => {
    expect((await A.upload('post', '/api/institution/imports/courses/commit', csv(`courseCode,title,credits\nPHY101,Physics,3\nCHE101,Chemistry,3`))).body.imported).toBe(2);
    const { rows } = await fixture.pool.query(`SELECT id FROM courses WHERE code = 'PHY101'`);
    const o = await A.post('/api/institution/offerings', { course_id: rows[0].id, term_id: f.institutions.A.term.id, enrollment_mode: 'open', capacity: 1 });
    const res = await A.upload('post', '/api/institution/imports/enrollments/commit', csv(`userSourcedId,course,role\ns1@alpha.test,PHY101,student\ns2@alpha.test,PHY101,student\nt2@alpha.test,PHY101,teacher`));
    expect(res.status).toBe(201);
    const roster = await A.get(`/api/institution/offerings/${o.body.id}/enrollments`);
    expect(roster.body.offering).toMatchObject({ enrolled: 1, waitlisted: 1 });
    expect(roster.body.offering.staff.map((s: { teacher_id: number }) => s.teacher_id)).toEqual([f.teachers.T2.id]);
  });

  it('guardians are matched by email or phone and linked with their permissions', async () => {
    const res = await A.upload('post', '/api/institution/imports/guardians/commit', csv(`first_name,phone,relationship,student,fees\nKamran,0300111,father,A1-010,no\nKamran,0300111,father,s2@alpha.test,yes`));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ creates: 0, links: 2 }); // Kamran already exists (from the student import)
    const { rows } = await fixture.pool.query(
      `SELECT count(DISTINCT g.id)::int guardians, bool_and(gs.can_view_fees) all_fees FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id WHERE g.phone = '0300111' AND g.first_name = 'Kamran'`
    );
    expect(rows[0]).toEqual({ guardians: 1, all_fees: false });
  });

  it('a new guardian listed twice in one file is created once and linked twice', async () => {
    const res = await A.upload('post', '/api/institution/imports/guardians/commit', csv(`first_name,email,relationship,student\nNoor,noor@alpha.test,mother,s1@alpha.test\nNoor,noor@alpha.test,mother,s3@alpha.test`));
    expect(res.body).toMatchObject({ creates: 1, links: 1 });
    expect(await count(`SELECT count(*)::int n FROM guardians WHERE email = 'noor@alpha.test'`)).toBe(1);
    expect(await count(`SELECT count(*)::int n FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE g.email = 'noor@alpha.test'`)).toBe(2);
  });

  it('serves CSV templates with the custom fields', async () => {
    await A.post('/api/institution/custom-fields', { entity: 'student', key: 'house', label: 'House', field_type: 'text' });
    const res = await A.get('/api/institution/imports/templates/students');
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('first_name,last_name,email');
    expect(res.text.trim().endsWith(',house')).toBe(true);
  });
});

describe('bulk invite', () => {
  it('invites everyone who has not activated an account', async () => {
    const res = await A.post('/api/institution/bulk-invite', { kind: 'students' });
    expect(res.status).toBe(200);
    expect(res.body.invited).toBeGreaterThanOrEqual(2); // the imported students
    expect((await as(f.tokens.t1).post('/api/institution/bulk-invite', { kind: 'students' })).status).toBe(403);
  });
});
