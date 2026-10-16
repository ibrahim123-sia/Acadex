// A full admission cycle: enquiry and follow-up → public form (custom questions, honeypot,
// required document) → application fee paid online → online entrance test marked by the quiz
// engine → merit list with offer and waiting list → the applicant accepts → one-click
// enrolment as student with guardian and portal invitations.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';
import { pool } from './helpers/fixture';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
let admin: ReturnType<typeof as>;
let formId = 0;
let enquiryId = 0;
const tokens: Record<string, string> = {};
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const form = '/api/apply/alpha/class-one-2027';
const answers: Record<number, unknown> = {};

beforeAll(async () => {
  f = await fixture.resetDb();
  admin = as(f.tokens.adminA);
  const A = f.institutions.A.id;
  const bank = (await q(`INSERT INTO question_banks (institution_id, name) VALUES ($1, 'Entrance test') RETURNING id`, [A]))[0].id;
  for (const n of [2, 3, 4]) {
    const qq = (await q(`INSERT INTO questions (institution_id, bank_id, type, prompt_html, data, points) VALUES ($1,$2,'numeric',$3,$4,1) RETURNING id`, [A, bank, `<p>${n} + ${n}?</p>`, JSON.stringify({ answer: n * 2, tolerance: 0 })]))[0];
    answers[qq.id] = n * 2;
  }
  await q(`INSERT INTO questions (institution_id, bank_id, type, prompt_html, data, points) VALUES ($1,$2,'essay','<p>Write about yourself</p>','{}',5)`, [A, bank]); // never drawn: needs a person to mark
  const res = await admin.post('/api/admissions/forms', {
    slug: 'class-one-2027',
    title: 'Class One admissions 2027',
    fields: [{ key: 'religion', label: 'Religion', type: 'select', options: ['Islam', 'Christianity', 'Hinduism', 'Other'], required: true }],
    documents: [{ key: 'birth_certificate', label: 'Birth certificate (B-form)', required: true }],
    application_fee: 500,
    entrance_test: { bank_id: bank, count: 3, minutes: 30 },
    status: 'open',
  });
  formId = res.body.id;
  await admin.put('/api/finance/accounts/fake', { secrets: { webhook_secret: 'adm-secret' } });
});

describe('enquiries', () => {
  it('records a lead and its follow-ups', async () => {
    expect((await as(f.tokens.t1).post('/api/admissions/enquiries', { name: 'x', phone: '1' })).status).toBe(403);
    expect((await admin.post('/api/admissions/enquiries', { name: 'No contact' })).status).toBe(400);
    const e = await admin.post('/api/admissions/enquiries', { name: 'Imran Qureshi', phone: '0300-1112223', student_name: 'Ayesha', source: 'website' });
    expect(e.status).toBe(201);
    enquiryId = e.body.id;
    const fu = await admin.post(`/api/admissions/enquiries/${enquiryId}/followups`, { channel: 'phone', note: 'Sent the form link', next_at: '2026-11-20T10:00:00Z' });
    expect(fu.status).toBe(201);
    const detail = await admin.get(`/api/admissions/enquiries/${enquiryId}`);
    expect(detail.body).toMatchObject({ status: 'contacted', followups: [{ note: 'Sent the form link' }] });
  });
});

describe('applying', () => {
  it('shows the branded form to anyone; drafts stay hidden', async () => {
    const res = await request(app).get(form);
    expect(res.body).toMatchObject({ institution: 'Alpha School', title: 'Class One admissions 2027', application_fee: 500, open: true, entrance_test: { questions: 3, minutes: 30 } });
    await admin.post('/api/admissions/forms', { slug: 'secret-draft', title: 'Draft' });
    expect((await request(app).get('/api/apply/alpha/secret-draft')).status).toBe(404);
  });

  it('rejects bots and missing answers, then accepts an application once', async () => {
    const base = { first_name: 'Ayesha', last_name: 'Qureshi', email: 'ayesha@family.test', guardian_name: 'Imran Qureshi', guardian_phone: '0300 1112223', guardian_email: 'imran@family.test', guardian_relationship: 'father' };
    expect((await request(app).post(form).send({ ...base, data: { religion: 'Islam' }, website: 'http://spam' })).status).toBe(400);
    expect((await request(app).post(form).send(base)).status).toBe(400);
    expect((await request(app).post(form).send({ ...base, data: { religion: 'Pastafarian' } })).status).toBe(400);
    const ok = await request(app).post(form).send({ ...base, data: { religion: 'Islam' } });
    expect(ok.status).toBe(201);
    expect(ok.body.number).toMatch(/^APP-\d{4}-00001$/);
    tokens.ayesha = ok.body.token;
    expect((await request(app).post(form).send({ ...base, data: { religion: 'Islam' } })).status).toBe(409);
    // the matching enquiry is linked
    expect((await q(`SELECT status FROM enquiries WHERE id = $1`, [enquiryId]))[0].status).toBe('applied');
    expect((await q(`SELECT enquiry_id FROM applications WHERE number = $1`, [ok.body.number]))[0].enquiry_id).toBe(enquiryId);
    // the applicant and guardian were emailed the private link
    const mail = await q(`SELECT to_email, text_body FROM email_outbox WHERE template = 'admission_submitted' ORDER BY id`);
    expect(mail.map((m) => m.to_email).sort()).toEqual(['ayesha@family.test', 'imran@family.test']);
    expect(mail[0].text_body).toContain(`/apply/status#${tokens.ayesha}`);
    const second = await request(app).post(form).send({ first_name: 'Bilal', email: 'bilal@family.test', data: { religion: 'Other' } });
    tokens.bilal = second.body.token;
  });

  it('the applicant uploads documents and pays the application fee online', async () => {
    const s = `/api/apply/status/${tokens.ayesha}`;
    expect((await request(app).get('/api/apply/status/not-a-valid-token-not-a-valid-token')).status).toBe(404);
    let status = await request(app).get(s);
    expect(status.body).toMatchObject({ status: 'submitted', fee: { balance: 500 }, documents: [{ key: 'birth_certificate', uploaded: false }] });
    expect((await request(app).post(`${s}/documents`).field('key', 'passport').attach('file', PDF, 'p.pdf')).status).toBe(400);
    expect((await request(app).post(`${s}/documents`).field('key', 'birth_certificate').attach('file', PDF, 'bform.pdf')).status).toBe(201);
    const pay = await request(app).post(`/api/payments/pay/${status.body.fee.pay_token}/checkout`).send({ provider: 'fake' });
    await request(app).post('/api/payments/fake/complete').type('form').send({ reference: pay.body.reference, outcome: 'succeeded' });
    status = await request(app).get(s);
    expect(status.body.fee).toMatchObject({ status: 'paid', balance: 0 });
    expect(status.body.documents[0].uploaded).toBe(true);
  });
});

describe('the entrance test', () => {
  it('opens once the office schedules it, and is marked automatically', async () => {
    const s = `/api/apply/status/${tokens.ayesha}`;
    expect((await request(app).post(`${s}/test/start`)).body.code).toBe('NO_TEST');
    const list = await admin.get(`/api/admissions/applications?form_id=${formId}`);
    const ayesha = list.body.find((a: { email: string }) => a.email === 'ayesha@family.test');
    expect((await admin.patch(`/api/admissions/applications/${ayesha.id}`, { status: 'enrolled' })).status).toBe(409);
    expect((await admin.patch(`/api/admissions/applications/${ayesha.id}`, { status: 'test_scheduled' })).status).toBe(200);
    expect((await request(app).get(s)).body.test).toMatchObject({ online: true, available: true });
    expect((await request(app).post(`${s}/test/start`)).status).toBe(201);
    const test = await request(app).get(`${s}/test`);
    expect(test.body.questions).toHaveLength(3);
    expect(test.body.questions.every((x: { type: string }) => x.type === 'numeric')).toBe(true);
    for (const x of test.body.questions) await request(app).put(`${s}/test/answers`).send({ question_id: x.question_id, response: answers[x.question_id] });
    expect((await request(app).post(`${s}/test/submit`)).status).toBe(200);
    expect((await request(app).get(s)).body).toMatchObject({ status: 'tested', test: { score: { score: 3, max: 3 } } });
    expect((await request(app).put(`${s}/test/answers`).send({ question_id: test.body.questions[0].question_id, response: 1 })).status).toBe(400);
  });

  it('a test taken in the hall is entered by the office', async () => {
    const bilal = (await admin.get(`/api/admissions/applications?q=bilal`)).body[0];
    await admin.patch(`/api/admissions/applications/${bilal.id}`, { status: 'test_scheduled', test_at: '2026-11-25T09:00:00Z', test_venue: 'Main hall' });
    expect((await admin.patch(`/api/admissions/applications/${bilal.id}`, { status: 'tested', test_score: 25, test_max: 20 })).status).toBe(400);
    expect((await admin.patch(`/api/admissions/applications/${bilal.id}`, { status: 'tested', test_score: 12, test_max: 20, interview_score: 70 })).status).toBe(200);
  });
});

describe('decisions and enrolment', () => {
  it('ranks applicants, offers the top place and waitlists the next', async () => {
    const preview = await admin.post(`/api/admissions/forms/${formId}/merit`, { offer: 1, waitlist: 1 });
    expect(preview.body.map((r: { name: string; outcome: string }) => [r.name, r.outcome])).toEqual([['Ayesha Qureshi', 'offered'], ['Bilal', 'waitlisted']]);
    expect(preview.body[1].score).toBe(63); // 60% × 0.7 + 70 × 0.3
    await admin.post(`/api/admissions/forms/${formId}/merit`, { offer: 1, waitlist: 1, offer_expires_at: '2027-01-31T23:59:00Z', commit: true });
    expect((await request(app).get(`/api/apply/status/${tokens.ayesha}`)).body).toMatchObject({ status: 'offered', offer: { expired: false } });
    expect((await request(app).get(`/api/apply/status/${tokens.bilal}`)).body.status).toBe('waitlisted');
    expect((await request(app).post(`/api/apply/status/${tokens.bilal}/accept`)).status).toBe(409);
  });

  it('the applicant accepts and is enrolled with one click', async () => {
    expect((await request(app).post(`/api/apply/status/${tokens.ayesha}/accept`)).body.status).toBe('accepted');
    const ayesha = (await admin.get(`/api/admissions/applications?q=ayesha`)).body[0];
    expect((await as(f.tokens.t1).post(`/api/admissions/applications/${ayesha.id}/convert`, { section_id: f.sections.A1.id })).status).toBe(403);
    expect((await as(f.tokens.adminB).post(`/api/admissions/applications/${ayesha.id}/convert`, { section_id: f.sections.B1.id })).status).toBe(404);
    const res = await admin.post(`/api/admissions/applications/${ayesha.id}/convert`, { section_id: f.sections.A1.id, roll_no: 'A1-099' });
    expect(res.status).toBe(201);
    expect(res.body.invites).toBe(2); // student and parent portals
    const st = (await q(`SELECT first_name, section_id, roll_no FROM students WHERE id = $1`, [res.body.student_id]))[0];
    expect(st).toEqual({ first_name: 'Ayesha', section_id: f.sections.A1.id, roll_no: 'A1-099' });
    const guardian = (await q(`SELECT g.email, g.user_id, gs.relationship FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE gs.student_id = $1`, [res.body.student_id]))[0];
    expect(guardian).toMatchObject({ email: 'imran@family.test', relationship: 'father', user_id: expect.any(Number) });
    expect((await q(`SELECT status FROM enquiries WHERE id = $1`, [enquiryId]))[0].status).toBe('enrolled');
    expect((await q(`SELECT p.student_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.application_id = $1`, [ayesha.id]))[0].student_id).toBe(res.body.student_id);
    expect((await admin.post(`/api/admissions/applications/${ayesha.id}/convert`, { section_id: f.sections.A1.id })).status).toBe(409);
    expect((await request(app).get(`/api/apply/status/${tokens.ayesha}`)).body.status).toBe('enrolled');
  });

  it('the office sees the funnel; others see nothing', async () => {
    const s = await admin.get('/api/admissions/summary');
    expect(s.body.applications).toMatchObject({ enrolled: 1, waitlisted: 1 });
    expect(s.body.by_source[0]).toMatchObject({ source: 'website', n: 1, converted: 1 });
    expect((await as(f.tokens.t1).get('/api/admissions/applications')).status).toBe(403);
    expect((await as(f.tokens.adminB).get('/api/admissions/applications')).body).toEqual([]);
  });
});
