// People: student and staff profiles, restricted medical notes, guardians and what each may
// see, soft delete with the recycle bin, uploads (checked by content) and who may download them.
import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { as, fixture } from './helpers/http';

let f: fixture.Fixture;
let A: ReturnType<typeof as>;
const png = () => sharp({ create: { width: 800, height: 600, channels: 3, background: '#3366cc' } }).png().toBuffer();
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  f = await fixture.resetDb();
  A = as(f.tokens.adminA);
});

describe('admission and profiles', () => {
  it('admits a student with guardians and returns the full profile', async () => {
    const res = await A.post('/api/institution/students', {
      first_name: 'Zara', last_name: 'Khan', email: 'zara@alpha.test', section_id: f.sections.A1.id,
      guardians: [{ first_name: 'Imran', last_name: 'Khan', phone: '0300', relationship: 'father' }, { first_name: 'Saima', relationship: 'mother' }],
    });
    expect(res.status).toBe(201);
    const p = await A.get(`/api/institution/students/${res.body.id}`);
    expect(p.status).toBe(200);
    expect(p.body.section.name).toBe('Class A1');
    expect(p.body.guardians.map((g: { relationship: string; is_primary: boolean }) => [g.relationship, g.is_primary])).toEqual([['father', true], ['mother', false]]);
    expect(p.body.account).toMatchObject({ invite_pending: true });
    expect(p.body.medical).toEqual({}); // admins may see (none yet)
  });

  it('filters the directory by class and status', async () => {
    const list = await A.get(`/api/institution/students?section_id=${f.sections.A2.id}`);
    expect(list.body.map((s: { first_name: string }) => s.first_name)).toEqual(['Saad']);
  });

  it('keeps the login in step with the record', async () => {
    expect((await A.patch(`/api/institution/students/${f.students.S2.id}`, { first_name: 'Samuel' })).status).toBe(200);
    const { rows } = await fixture.pool.query(`SELECT full_name FROM users WHERE id = $1`, [f.users.s2.id]);
    expect(rows[0].full_name).toBe('Samuel S');
    expect((await A.patch(`/api/institution/students/${f.students.S2.id}`, { email: 's1@alpha.test' })).status).toBe(409);
  });

  it('a student or another institution cannot read profiles', async () => {
    expect((await as(f.tokens.s1).get(`/api/institution/students/${f.students.S1.id}`)).status).toBe(403);
    expect((await as(f.tokens.adminB).get(`/api/institution/students/${f.students.S1.id}`)).status).toBe(404);
  });
});

describe('medical information (restricted)', () => {
  it('needs its own permission to read or write', async () => {
    const S1 = f.students.S1.id;
    expect((await A.put(`/api/institution/students/${S1}/medical`, { allergies: 'Peanuts', blood_group: 'B+' })).status).toBe(200);
    // a custom role that may read students but not medical notes
    const role = await A.post('/api/institution/roles', { name: 'Front desk', permissions: ['students.read'] });
    await A.post(`/api/institution/users/${f.users.t2.id}/roles`, { role_id: role.body.id });
    const desk = as(await fixture.tokenFor(f.users.t2));
    const p = await desk.get(`/api/institution/students/${S1}`);
    expect(p.status).toBe(200);
    expect(p.body.medical).toBeUndefined();
    expect((await desk.get(`/api/institution/students/${S1}/medical`)).status).toBe(403);
    expect((await A.get(`/api/institution/students/${S1}/medical`)).body.allergies).toBe('Peanuts');
  });

  it('is audited without the values', async () => {
    const { rows } = await fixture.pool.query(`SELECT action, changes FROM audit_log WHERE entity = 'student_medical' ORDER BY id`);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('Peanuts');
  });
});

describe('guardians', () => {
  it('per-guardian permissions decide what the parent portal shows', async () => {
    const p1 = as(f.tokens.p1);
    expect((await p1.get(`/api/parent/child/${f.students.S1.id}/overview`)).body.fee).not.toBeNull();
    const profile = await A.get(`/api/institution/students/${f.students.S1.id}`);
    const link = profile.body.guardians.find((g: { has_account: boolean }) => g.has_account);
    expect((await A.patch(`/api/institution/guardianships/${link.guardianship_id}`, { can_view_fees: false, can_view_grades: false })).status).toBe(200);
    const o = await p1.get(`/api/parent/child/${f.students.S1.id}/overview`);
    expect(o.body.fee).toBeNull();
    expect(o.body.grades).toBeNull();
    expect((await p1.get(`/api/pdf/report-card/${f.students.S1.id}`)).status).toBe(403);
    expect((await p1.get(`/api/pdf/fee-voucher/${f.fees.F1.id}`)).status).toBe(403);
    await A.patch(`/api/institution/guardianships/${link.guardianship_id}`, { can_view_fees: true, can_view_grades: true });
    expect((await p1.get(`/api/pdf/report-card/${f.students.S1.id}`)).status).toBe(200);
  });

  it('links an existing guardian to a sibling, once', async () => {
    const r = await A.post(`/api/institution/students/${f.students.S2.id}/guardians`, { guardian_id: f.guardians.G1.id, relationship: 'mother' });
    expect(r.status).toBe(201);
    expect((await A.post(`/api/institution/students/${f.students.S2.id}/guardians`, { guardian_id: f.guardians.G1.id })).status).toBe(409);
    const kids = await as(f.tokens.p1).get('/api/parent/children');
    expect(kids.body.map((k: { id: number }) => k.id).sort()).toEqual([f.students.S1.id, f.students.S2.id].sort());
  });

  it('invites a guardian to the parent portal', async () => {
    const g = await A.post('/api/institution/guardians', { first_name: 'Nadia', last_name: 'Malik', email: 'nadia@alpha.test' });
    expect(g.status).toBe(201);
    await A.post(`/api/institution/students/${f.students.S3.id}/guardians`, { guardian_id: g.body.id, relationship: 'mother' });
    const inv = await A.post(`/api/institution/guardians/${g.body.id}/invite`);
    expect(inv.status).toBe(200);
    expect(inv.body.invite.url).toContain('/accept-invite#token=');
    const { rows } = await fixture.pool.query(`SELECT role FROM users WHERE id = $1`, [inv.body.user_id]);
    expect(rows[0].role).toBe('parent');
    expect((await as(f.tokens.adminB).post(`/api/institution/guardians/${g.body.id}/invite`)).status).toBe(404);
  });
});

describe('soft delete and the recycle bin', () => {
  it('a deleted student disappears everywhere and cannot sign in; restoring brings both back', async () => {
    const S3 = f.students.S3.id;
    expect((await A.delete(`/api/institution/students/${S3}`)).status).toBe(204);
    expect((await A.get('/api/institution/students?status=all')).body.some((s: { id: number }) => s.id === S3)).toBe(false);
    expect((await A.get(`/api/institution/students/${S3}`)).status).toBe(404);
    expect((await as(f.tokens.s3).get('/api/auth/me')).status).toBe(401);
    const bin = await A.get('/api/institution/recycle-bin');
    expect(bin.body.find((r: { entity: string; id: number }) => r.entity === 'students' && r.id === S3)).toMatchObject({ kind: 'Student', days_left: 30 });
    expect((await as(f.tokens.t1).get('/api/institution/recycle-bin')).status).toBe(403);
    expect((await A.post(`/api/institution/recycle-bin/students/${S3}/restore`)).status).toBe(200);
    expect((await A.get(`/api/institution/students/${S3}`)).status).toBe(200);
    expect((await as(await fixture.tokenFor(f.users.s3)).get('/api/auth/me')).status).toBe(200);
  });

  it('permanent deletion needs an explicit confirmation and removes the login', async () => {
    const c = await A.post('/api/institution/students', { first_name: 'Temp', last_name: 'X', email: 'temp@alpha.test', section_id: f.sections.A2.id });
    await A.delete(`/api/institution/students/${c.body.id}`);
    expect((await A.delete(`/api/institution/recycle-bin/students/${c.body.id}`, {})).status).toBe(400);
    expect((await A.delete(`/api/institution/recycle-bin/students/${c.body.id}`, { confirm: `students/${c.body.id}` })).status).toBe(204);
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM students WHERE id = $1 UNION ALL SELECT count(*)::int FROM users WHERE email = 'temp@alpha.test'`, [c.body.id]);
    expect(rows.map((r) => r.n)).toEqual([0, 0]);
    expect((await A.delete(`/api/institution/recycle-bin/students/${f.students.S1.id}`, { confirm: `students/${f.students.S1.id}` })).status).toBe(404); // not deleted
  });

  it('every change is in the audit trail with who made it', async () => {
    const res = await A.get(`/api/institution/audit?entity=students&entity_id=${f.students.S3.id}`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['delete', 'restore']));
    expect(res.body[0].actor).toBe('Admin A');
    expect(res.body[0].request_id).toBeTruthy();
    expect((await as(f.tokens.t1).get('/api/institution/audit')).status).toBe(403);
    expect((await as(f.tokens.adminB).get(`/api/institution/audit?entity=students&entity_id=${f.students.S3.id}`)).body).toEqual([]);
  });
});

describe('uploads', () => {
  let photoFile: number;
  it('stores photos re-encoded as small WebP images', async () => {
    const res = await A.upload('put', `/api/institution/students/${f.students.S1.id}/photo`, { buffer: await png(), name: 'me.png' });
    expect(res.status).toBe(200);
    photoFile = res.body.file_id;
    const { rows } = await fixture.pool.query(`SELECT content_type, size_bytes FROM files WHERE id = $1`, [photoFile]);
    expect(rows[0].content_type).toBe('image/webp');
    const got = await A.get(`/api/files/${photoFile}`).buffer(true);
    expect(got.status).toBe(200);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(got.body as Buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(600);
  });

  it('checks what a file really is, not what it is called', async () => {
    const fake = await A.upload('post', `/api/institution/students/${f.students.S1.id}/documents`, { buffer: Buffer.from('just text'), name: 'result.pdf' }, { title: 'Result' });
    expect(fake.status).toBe(415);
    const real = await A.upload('post', `/api/institution/students/${f.students.S1.id}/documents`, { buffer: pdf, name: 'result.pdf' }, { title: 'Result card', category: 'previous_result' });
    expect(real.status).toBe(201);
    expect((await A.get(`/api/institution/students/${f.students.S1.id}`)).body.documents[0]).toMatchObject({ title: 'Result card', content_type: 'application/pdf' });
  });

  it('only people who may see the student can download their files', async () => {
    expect((await as(f.tokens.s1).get(`/api/files/${photoFile}`)).status).toBe(200); // themself
    expect((await as(f.tokens.p1).get(`/api/files/${photoFile}`)).status).toBe(200); // linked parent
    expect((await as(f.tokens.t1).get(`/api/files/${photoFile}`)).status).toBe(200); // teaches the class
    expect((await as(f.tokens.s2).get(`/api/files/${photoFile}`)).status).toBe(403); // classmate
    expect((await as(f.tokens.adminB).get(`/api/files/${photoFile}`)).status).toBe(404); // other institution
  });

  it('enforces the storage quota', async () => {
    await fixture.pool.query(`UPDATE institutions SET settings = jsonb_set(settings, '{storage_quota_mb}', '10') WHERE id = $1`, [f.institutions.A.id]);
    await fixture.pool.query(
      `INSERT INTO files (institution_id, storage_key, original_name, content_type, size_bytes, sha256, purpose) VALUES ($1, 'fake/huge', 'huge.pdf', 'application/pdf', 20000000, 'x', 'document')`,
      [f.institutions.A.id]
    );
    const res = await A.upload('post', `/api/institution/students/${f.students.S1.id}/documents`, { buffer: pdf, name: 'b.pdf' }, { title: 'B' });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
  });
});

describe('staff', () => {
  it('shows the teaching load', async () => {
    const res = await A.get(`/api/institution/teachers/${f.teachers.T1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.courses).toBe(1);
    expect(res.body.teaching[0]).toMatchObject({ code: 'A1-MATH', role: 'teacher' });
    const list = await A.get('/api/institution/teachers?search=tina');
    expect(list.body.map((t: { first_name: string }) => t.first_name)).toEqual(['Tina']);
  });

  it('adds non-teaching staff without an account', async () => {
    const res = await A.post('/api/institution/teachers', { first_name: 'Rashid', last_name: 'M', email: 'acc@alpha.test', staff_type: 'non_teaching', designation: 'Accountant', create_account: false });
    expect(res.status).toBe(201);
    expect(res.body.user_id).toBeNull();
    expect(res.body.campus_id).toBe(f.institutions.A.campus.id);
  });
});
