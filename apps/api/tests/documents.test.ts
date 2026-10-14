// ID cards and certificates: issuing, printing, serial numbers, public verification with a
// masked name, revocation, and leaving certificates that end the student's enrolment.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';

let f: fixture.Fixture;
let A: ReturnType<typeof as>;
beforeAll(async () => {
  f = await fixture.resetDb();
  A = as(f.tokens.adminA);
});

describe('ID cards', () => {
  let code: string;
  let cardId: number;
  it('issues cards for a whole class and prints them', async () => {
    const res = await A.post('/api/institution/id-cards', { holder_type: 'student', section_id: f.sections.A1.id });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
    code = res.body.cards[0].verify_code;
    cardId = res.body.cards[0].id;
    expect(code).toMatch(/^[A-Z2-9]{12}$/);
    expect(res.body.cards[0].valid_until).toBe('2027-07-31'); // end of the current year
    const pdf = await A.get(`/api/institution/id-cards/pdf?section_id=${f.sections.A1.id}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('anyone can verify a card, and sees only a masked name', async () => {
    const res = await request(app).get(`/api/public/verify/${code}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'id_card', status: 'valid', valid: true, institution: 'Alpha School' });
    expect(res.body.name).toMatch(/^(Sara|Sam) S\.$/);
    expect(JSON.stringify(res.body)).not.toMatch(/@|dob|phone/);
    expect((await request(app).get('/api/public/verify/NOSUCHCODE12')).status).toBe(404);
    expect((await request(app).get('/api/public/verify/<script>')).status).toBe(400);
  });

  it('reissuing replaces the old card; revoked cards verify as revoked', async () => {
    const again = await A.post('/api/institution/id-cards', { holder_type: 'student', holder_ids: [f.students.S1.id] });
    expect(again.status).toBe(201);
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM id_cards WHERE holder_id = $1 AND revoked_at IS NULL`, [f.students.S1.id]);
    expect(rows[0].n).toBe(1);
    expect((await A.post(`/api/institution/id-cards/${cardId}/revoke`)).status).toBeLessThan(500);
    const v = await request(app).get(`/api/public/verify/${code}`);
    expect(v.body.status).toBe('revoked');
  });

  it('is only for document issuers of the same institution', async () => {
    expect((await as(f.tokens.t1).post('/api/institution/id-cards', { holder_type: 'student', section_id: f.sections.A1.id })).status).toBe(403);
    expect((await as(f.tokens.adminB).post('/api/institution/id-cards', { holder_type: 'student', holder_ids: [f.students.S1.id] })).status).toBe(400);
    expect((await as(f.tokens.adminB).post('/api/institution/id-cards', { holder_type: 'student', section_id: f.sections.A1.id })).status).toBe(400);
  });
});

describe('certificates', () => {
  it('issues numbered letters from the template with the student’s details', async () => {
    const a = await A.post('/api/institution/issued-documents', { kind: 'bonafide_letter', student_id: f.students.S1.id, purpose: 'a visa application' });
    expect(a.status).toBe(201);
    expect(a.body.serial_no).toMatch(/^BF-\d{4}-0001$/);
    expect(a.body.body).toContain('Sara S');
    expect(a.body.body).toContain('Class A1');
    expect(a.body.body).toContain('for the purpose of a visa application');
    expect(a.body.body).not.toContain('{{');
    const b = await A.post('/api/institution/issued-documents', { kind: 'bonafide_letter', student_id: f.students.S2.id });
    expect(b.body.serial_no).toMatch(/-0002$/);
    expect((await A.get(`/api/institution/issued-documents/${a.body.id}/pdf`)).headers['content-type']).toContain('application/pdf');
    const v = await request(app).get(`/api/public/verify/${a.body.verify_code}`);
    expect(v.body).toMatchObject({ kind: 'document', title: 'Bonafide Certificate', serial_no: a.body.serial_no, valid: true, name: 'Sara S.' });
  });

  it('uses the institution’s own template', async () => {
    expect((await A.put('/api/institution/document-templates/character_certificate', { title: 'Good Conduct Letter', serial_prefix: 'GC', body: '{{student.name}} is of {{conduct}} character. {{unknown.thing}}' })).status).toBe(200);
    const res = await A.post('/api/institution/issued-documents', { kind: 'character_certificate', student_id: f.students.S2.id, conduct: 'excellent' });
    expect(res.body).toMatchObject({ title: 'Good Conduct Letter' });
    expect(res.body.serial_no).toMatch(/^GC-/);
    expect(res.body.body).toBe('Sam S is of excellent character. —');
  });

  it('a leaving certificate can end the enrolment and the sign-in', async () => {
    const res = await A.post('/api/institution/issued-documents', { kind: 'leaving_certificate', student_id: f.students.S3.id, left_on: '2026-10-01', reason: 'Family moved', mark_left: true });
    expect(res.status).toBe(201);
    const { rows } = await fixture.pool.query(`SELECT st.status, st.left_on, u.is_active FROM students st JOIN users u ON u.ref_id = st.id AND u.role = 'student' WHERE st.id = $1`, [f.students.S3.id]);
    expect(rows[0]).toEqual({ status: 'left', left_on: '2026-10-01', is_active: false });
    expect((await A.post('/api/institution/issued-documents', { kind: 'bonafide_letter', student_id: f.students.S3.id })).status).toBe(409);
  });

  it('revoked documents verify as revoked', async () => {
    const list = await A.get('/api/institution/issued-documents');
    const doc = list.body[0];
    expect((await A.post(`/api/institution/issued-documents/${doc.id}/revoke`, { reason: 'Issued in error' })).status).toBe(200);
    expect((await request(app).get(`/api/public/verify/${doc.verify_code}`)).body.status).toBe('revoked');
    expect((await as(f.tokens.adminB).post(`/api/institution/issued-documents/${doc.id}/revoke`, { reason: 'x' })).status).toBe(404);
  });
});
