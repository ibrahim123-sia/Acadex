// Admissions office under /api/admissions: application forms, the applications pipeline
// (review, entrance test scheduling and marking, decisions), merit lists with offers and a
// waiting list, one-click enrolment, and the enquiry (lead) tracker with follow-ups.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { admissionFormBody, applicationUpdateBody, convertApplicationBody, enquiryBody, followupBody, id, meritBody, optionalId, patchSchema } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { convertToStudent, emailApplicant, type ApplicationRow } from '../lib/admissions';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { sendTable } from '../lib/export';
import { parsePage, sendPage } from '../lib/pagination';
import { assertSectionWritable, isUniqueViolation } from '../lib/structure';
import { currentUser, institutionId, requirePermission } from '../middleware/auth';
import { sendFile } from '../storage/files';

const router = Router();
const manage = requirePermission('admissions.manage');
const leads = requirePermission('enquiries.manage');

const auditAs = (req: Request, action: string, entity: string, detail: string) =>
  audit({ institutionId: institutionId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity, detail });

// ---------------------------------------------------------------- forms

router.get('/admissions/forms', manage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT f.*, i.slug AS institution_slug, p.name AS program, pl.name AS level, ay.name AS academic_year,
            (SELECT count(*)::int FROM applications a WHERE a.form_id = f.id) AS applications,
            (SELECT count(*)::int FROM applications a WHERE a.form_id = f.id AND a.status = 'enrolled') AS enrolled
       FROM admission_forms f JOIN institutions i ON i.id = f.institution_id LEFT JOIN programs p ON p.id = f.program_id
       LEFT JOIN program_levels pl ON pl.id = f.program_level_id LEFT JOIN academic_years ay ON ay.id = f.academic_year_id
      WHERE f.institution_id = $1 ORDER BY f.created_at DESC`,
    [institutionId(req)]
  );
  res.json(rows);
});

async function checkFormRefs(req: Request, b: { academic_year_id?: number | null; campus_id?: number | null; program_id?: number | null; program_level_id?: number | null; entrance_test?: { bank_id: number } | null }) {
  const s = institutionId(req);
  if (b.academic_year_id) await assertInInstitution('academic_years', b.academic_year_id, s);
  if (b.campus_id) await assertInInstitution('campuses', b.campus_id, s);
  if (b.program_id) await assertInInstitution('programs', b.program_id, s);
  if (b.program_level_id) await assertInInstitution('program_levels', b.program_level_id, s);
  if (b.entrance_test) await assertInInstitution('question_banks', b.entrance_test.bank_id, s);
}

const FORM_COLS = ['slug', 'title', 'description', 'academic_year_id', 'campus_id', 'program_id', 'program_level_id', 'fields', 'documents', 'application_fee', 'entrance_test', 'seats', 'opens_at', 'closes_at', 'status'] as const;
const JSON_COLS = new Set(['fields', 'documents', 'entrance_test']);

router.post('/admissions/forms', manage, async (req, res) => {
  const b = admissionFormBody.parse(req.body);
  await checkFormRefs(req, b);
  try {
    const vals = FORM_COLS.map((c) => (JSON_COLS.has(c) ? (b[c] == null ? null : JSON.stringify(b[c])) : b[c]));
    const { rows } = await db.query(
      `INSERT INTO admission_forms (institution_id, ${FORM_COLS.join(', ')}, created_by) VALUES ($1, ${FORM_COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${FORM_COLS.length + 2}) RETURNING *`,
      [institutionId(req), ...vals, currentUser(req).id]
    );
    await auditAs(req, 'create', 'AdmissionForm', b.title);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Another form uses this web address', 'DUPLICATE');
    throw e;
  }
});

router.patch('/admissions/forms/:id', manage, async (req, res) => {
  const b = patchSchema(admissionFormBody.shape).parse(req.body);
  await checkFormRefs(req, b);
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to change');
  const params: unknown[] = [id.parse(req.params.id), institutionId(req)];
  const sets = entries.map(([k, v]) => (params.push(JSON_COLS.has(k) && v != null ? JSON.stringify(v) : v), `${k} = $${params.length}`));
  try {
    const { rows } = await db.query(`UPDATE admission_forms SET ${sets.join(', ')} WHERE id = $1 AND institution_id = $2 RETURNING *`, params);
    if (!rows[0]) throw notFound();
    res.json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Another form uses this web address', 'DUPLICATE');
    throw e;
  }
});

router.delete('/admissions/forms/:id', manage, async (req, res) => {
  const fid = id.parse(req.params.id);
  const { rows } = await db.query(`SELECT count(*)::int n FROM applications WHERE form_id = $1 AND institution_id = $2`, [fid, institutionId(req)]);
  if (rows[0].n) throw conflict('This form has applications; close it instead', 'IN_USE');
  const { rowCount } = await db.query(`DELETE FROM admission_forms WHERE id = $1 AND institution_id = $2`, [fid, institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- applications

router.get('/admissions/applications', manage, async (req, res) => {
  const q = z.object({ form_id: optionalId, status: z.string().max(20).optional(), q: z.string().max(100).optional(), format: z.enum(['json', 'csv', 'xlsx']).default('json') }).parse(req.query);
  const pg = q.format === 'json' ? parsePage(req.query) : { page: 1, pageSize: 5000, limit: 5000, offset: 0 };
  const { rows } = await db.query(
    `SELECT a.id, a.number, a.first_name, a.last_name, a.email, a.phone, a.guardian_name, a.guardian_phone, a.status, a.test_at, a.test_score, a.test_max, a.interview_score,
            a.merit_rank, a.offer_expires_at, a.created_at, f.title AS form, a.student_id,
            (SELECT i.status FROM invoices i WHERE i.application_id = a.id ORDER BY i.id DESC LIMIT 1) AS fee_status,
            (SELECT count(*)::int FROM application_documents d WHERE d.application_id = a.id) AS documents, count(*) OVER() _total
       FROM applications a JOIN admission_forms f ON f.id = a.form_id
      WHERE a.institution_id = $1 AND ($2::int IS NULL OR a.form_id = $2) AND ($3::text IS NULL OR a.status = $3)
        AND ($4::text IS NULL OR a.number ILIKE '%' || $4 || '%' OR a.first_name || ' ' || a.last_name ILIKE '%' || $4 || '%' OR a.email ILIKE '%' || $4 || '%' OR a.phone ILIKE '%' || $4 || '%')
      ORDER BY a.merit_rank NULLS LAST, a.created_at DESC LIMIT $5 OFFSET $6`,
    [institutionId(req), q.form_id, q.status ?? null, q.q || null, pg.limit, pg.offset]
  );
  if (q.format === 'json') return void sendPage(res, rows, pg);
  await sendTable(
    res,
    'applications',
    ['Number', 'First name', 'Last name', 'Email', 'Phone', 'Guardian', 'Guardian phone', 'Status', 'Test', 'Interview', 'Merit rank', 'Fee', 'Form'],
    rows.map((r) => [r.number, r.first_name, r.last_name, r.email, r.phone, r.guardian_name, r.guardian_phone, r.status, r.test_score == null ? '' : `${r.test_score}/${r.test_max}`, r.interview_score, r.merit_rank, r.fee_status, r.form]),
    q.format
  );
});

async function loadApplication(req: Request, appId: number, lock = false) {
  const { rows } = await db.query<ApplicationRow>(`SELECT * FROM applications WHERE id = $1 AND institution_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [appId, institutionId(req)]);
  if (!rows[0]) throw notFound('Application not found');
  return rows[0];
}

router.get('/admissions/applications/:id', manage, async (req, res) => {
  const app = await loadApplication(req, id.parse(req.params.id));
  const [docs, invoices, form] = await Promise.all([
    db.query(`SELECT d.id, d.key, d.created_at, f.original_name, f.content_type, f.size_bytes FROM application_documents d JOIN files f ON f.id = d.file_id WHERE d.application_id = $1`, [app.id]),
    db.query(`SELECT id, number, title, total, paid, status FROM invoices WHERE application_id = $1 ORDER BY id`, [app.id]),
    db.query(`SELECT id, title, fields, documents, entrance_test FROM admission_forms WHERE id = $1`, [app.form_id]),
  ]);
  const { test_layout: _l, test_answers: _a, ...rest } = app;
  res.json({ ...rest, form: form.rows[0], documents: docs.rows, invoices: invoices.rows, test_taken_online: !!app.test_layout });
});

router.get('/admissions/applications/:id/documents/:docId', manage, async (req, res) => {
  const app = await loadApplication(req, id.parse(req.params.id));
  const { rows } = await db.query(`SELECT f.* FROM application_documents d JOIN files f ON f.id = d.file_id WHERE d.id = $1 AND d.application_id = $2`, [id.parse(req.params.docId), app.id]);
  if (!rows[0]) throw notFound();
  await sendFile(res, rows[0]);
});

/** Which status may follow which (the office can always reject or withdraw). */
const NEXT: Record<string, string[]> = {
  submitted: ['under_review', 'test_scheduled', 'offered', 'rejected', 'waitlisted', 'withdrawn'],
  under_review: ['test_scheduled', 'tested', 'offered', 'rejected', 'waitlisted', 'withdrawn'],
  test_scheduled: ['tested', 'under_review', 'rejected', 'withdrawn'],
  tested: ['offered', 'rejected', 'waitlisted', 'withdrawn'],
  waitlisted: ['offered', 'rejected', 'withdrawn'],
  offered: ['accepted', 'declined', 'waitlisted', 'withdrawn'],
  accepted: ['withdrawn'],
  declined: ['offered'],
  rejected: ['under_review'],
  withdrawn: ['under_review'],
  enrolled: [],
};

router.patch('/admissions/applications/:id', manage, async (req, res) => {
  const app = await loadApplication(req, id.parse(req.params.id), true);
  const b = applicationUpdateBody.parse(req.body);
  if (b.status && b.status !== app.status && !NEXT[app.status]!.includes(b.status)) throw conflict(`An application that is ${app.status.replace('_', ' ')} can't become ${b.status.replace('_', ' ')}`, 'BAD_STATUS');
  if (b.status === 'test_scheduled' && !b.test_at && !app.test_at) {
    const { rows } = await db.query(`SELECT entrance_test FROM admission_forms WHERE id = $1`, [app.form_id]);
    if (!rows[0].entrance_test) throw badRequest('Set the date and time of the test', { test_at: 'required' });
  }
  if (b.test_score != null && (b.test_max ?? Number(app.test_max ?? 0)) && b.test_score > (b.test_max ?? Number(app.test_max))) throw badRequest('The score is above the maximum');
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to change');
  const params: unknown[] = [app.id];
  const sets = entries.map(([k, v]) => (params.push(v), `${k} = $${params.length}`));
  if (b.status && b.status !== app.status) sets.push(`decided_by = ${Number(currentUser(req).id)}`);
  const { rows } = await db.query(`UPDATE applications SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id, status, test_at, test_score, interview_score, offer_expires_at`, params);
  if (b.status && b.status !== app.status) {
    const extra =
      b.status === 'test_scheduled' && (b.test_at || app.test_at)
        ? `Test: ${new Date(b.test_at ?? app.test_at!).toUTCString()}${b.test_venue || app.test_venue ? ` at ${b.test_venue ?? app.test_venue}` : ''}.`
        : b.status === 'offered' && (b.offer_expires_at || app.offer_expires_at)
          ? `Please respond by ${new Date(b.offer_expires_at ?? app.offer_expires_at!).toUTCString()}.`
          : (b.decision_note ?? '');
    await emailApplicant(app, b.status, extra);
    await auditAs(req, 'application_status', 'Application', `${app.number}: ${app.status} → ${b.status}`);
  }
  res.json(rows[0]);
});

/** Rank applicants by a weighted score; with commit, offer the top places and waitlist the next. */
router.post('/admissions/forms/:id/merit', manage, async (req, res) => {
  const formId = id.parse(req.params.id);
  await assertInInstitution('admission_forms', formId, institutionId(req));
  const b = meritBody.parse(req.body);
  const { rows } = await db.query<ApplicationRow>(`SELECT * FROM applications WHERE form_id = $1 AND status IN ('under_review', 'tested', 'waitlisted') ORDER BY created_at`, [formId]);
  const scored = rows
    .map((a) => {
      const test = a.test_score != null && Number(a.test_max) > 0 ? (Number(a.test_score) / Number(a.test_max)) * 100 : null;
      const interview = a.interview_score == null ? null : Number(a.interview_score);
      const w = (test == null ? 0 : b.test_weight) + (interview == null ? 0 : b.interview_weight);
      const score = w ? ((test ?? 0) * (test == null ? 0 : b.test_weight) + (interview ?? 0) * (interview == null ? 0 : b.interview_weight)) / w : 0;
      return { app: a, score: Math.round(score * 100) / 100, test, interview };
    })
    .sort((x, y) => y.score - x.score || x.app.id - y.app.id);
  const list = scored.map((s, i) => ({
    rank: i + 1,
    id: s.app.id,
    number: s.app.number,
    name: `${s.app.first_name} ${s.app.last_name}`.trim(),
    test_percent: s.test == null ? null : Math.round(s.test * 100) / 100,
    interview: s.interview,
    score: s.score,
    outcome: i < b.offer ? 'offered' : i < b.offer + b.waitlist ? 'waitlisted' : null,
  }));
  if (!b.commit) return void res.json(list);
  await withTransaction(async () => {
    for (const l of list) {
      await db.query(`UPDATE applications SET merit_rank = $2, status = COALESCE($3, status), offer_expires_at = CASE WHEN $3 = 'offered' THEN $4::timestamptz ELSE offer_expires_at END, decided_by = $5, updated_at = now() WHERE id = $1`, [
        l.id, l.rank, l.outcome, b.offer_expires_at, currentUser(req).id,
      ]);
      const app = scored.find((s) => s.app.id === l.id)!.app;
      if (l.outcome && l.outcome !== app.status) await emailApplicant(app, l.outcome, l.outcome === 'offered' && b.offer_expires_at ? `Please respond by ${new Date(b.offer_expires_at).toUTCString()}.` : '');
    }
  });
  await auditAs(req, 'merit_list', 'AdmissionForm', `${formId}: ${b.offer} offered, ${b.waitlist} waitlisted`);
  res.json(list);
});

/** Enrol an applicant who has a place: student, guardian and portal invitations in one go. */
router.post('/admissions/applications/:id/convert', manage, requirePermission('students.manage'), async (req, res) => {
  const app = await loadApplication(req, id.parse(req.params.id), true);
  const b = convertApplicationBody.parse(req.body);
  await assertInInstitution('sections', b.section_id, institutionId(req));
  await assertSectionWritable(b.section_id);
  const out = await withTransaction(() => convertToStudent(app, { sectionId: b.section_id, rollNo: b.roll_no, admissionDate: b.admission_date, byUser: { id: currentUser(req).id, name: currentUser(req).name } }));
  await emailApplicant(app, 'enrolled');
  await auditAs(req, 'enrol_applicant', 'Application', `${app.number} → student ${out.student_id}`);
  res.status(201).json(out);
});

router.get('/admissions/summary', manage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT json_build_object(
       'applications', (SELECT COALESCE(json_object_agg(status, n), '{}') FROM (SELECT status, count(*)::int n FROM applications WHERE institution_id = $1 GROUP BY 1) x),
       'enquiries', (SELECT COALESCE(json_object_agg(status, n), '{}') FROM (SELECT status, count(*)::int n FROM enquiries WHERE institution_id = $1 GROUP BY 1) x),
       'by_source', (SELECT COALESCE(json_agg(x), '[]') FROM (SELECT source, count(*)::int n, count(*) FILTER (WHERE status IN ('applied', 'enrolled'))::int converted FROM enquiries WHERE institution_id = $1 GROUP BY 1 ORDER BY 2 DESC) x),
       'follow_ups_due', (SELECT count(*)::int FROM enquiries WHERE institution_id = $1 AND status NOT IN ('enrolled', 'lost') AND next_follow_up_at <= now())
     ) AS d`,
    [institutionId(req)]
  );
  res.json(rows[0].d);
});

// ---------------------------------------------------------------- enquiries

router.get('/admissions/enquiries', leads, async (req, res) => {
  const q = z.object({ status: z.string().max(20).optional(), source: z.string().max(20).optional(), assigned_to: optionalId, due: z.coerce.boolean().optional(), q: z.string().max(100).optional() }).parse(req.query);
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT e.*, u.full_name AS assigned_name, (SELECT count(*)::int FROM enquiry_followups f WHERE f.enquiry_id = e.id) AS followups, count(*) OVER() _total
       FROM enquiries e LEFT JOIN users u ON u.id = e.assigned_to
      WHERE e.institution_id = $1 AND ($2::text IS NULL OR e.status = $2) AND ($3::text IS NULL OR e.source = $3) AND ($4::int IS NULL OR e.assigned_to = $4)
        AND (NOT $5::boolean OR (e.next_follow_up_at <= now() AND e.status NOT IN ('enrolled', 'lost')))
        AND ($6::text IS NULL OR e.name ILIKE '%' || $6 || '%' OR e.phone ILIKE '%' || $6 || '%' OR e.student_name ILIKE '%' || $6 || '%')
      ORDER BY e.next_follow_up_at NULLS LAST, e.created_at DESC LIMIT $7 OFFSET $8`,
    [institutionId(req), q.status ?? null, q.source ?? null, q.assigned_to, q.due ?? false, q.q || null, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

async function checkEnquiryRefs(req: Request, b: { campus_id?: number | null; program_id?: number | null; program_level_id?: number | null; assigned_to?: number | null }) {
  const s = institutionId(req);
  if (b.campus_id) await assertInInstitution('campuses', b.campus_id, s);
  if (b.program_id) await assertInInstitution('programs', b.program_id, s);
  if (b.program_level_id) await assertInInstitution('program_levels', b.program_level_id, s);
  if (b.assigned_to) {
    const { rows } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND institution_id = $2 AND role NOT IN ('student', 'parent')`, [b.assigned_to, s]);
    if (!rows[0]) throw badRequest('Assign it to a member of staff');
  }
}

const ENQ_COLS = ['name', 'phone', 'email', 'student_name', 'source', 'campus_id', 'program_id', 'program_level_id', 'status', 'assigned_to', 'next_follow_up_at', 'notes', 'lost_reason'] as const;

router.post('/admissions/enquiries', leads, async (req, res) => {
  const b = enquiryBody.parse(req.body);
  if (!b.phone && !b.email) throw badRequest('Add a phone number or an email', { phone: 'required' });
  await checkEnquiryRefs(req, b);
  const { rows } = await db.query(
    `INSERT INTO enquiries (institution_id, ${ENQ_COLS.join(', ')}, created_by) VALUES ($1, ${ENQ_COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${ENQ_COLS.length + 2}) RETURNING *`,
    [institutionId(req), ...ENQ_COLS.map((c) => b[c]), currentUser(req).id]
  );
  res.status(201).json(rows[0]);
});

router.get('/admissions/enquiries/:id', leads, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM enquiries WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rows[0]) throw notFound();
  const { rows: f } = await db.query(`SELECT f.*, u.full_name AS by FROM enquiry_followups f LEFT JOIN users u ON u.id = f.user_id WHERE f.enquiry_id = $1 ORDER BY f.created_at DESC`, [rows[0].id]);
  const { rows: apps } = await db.query(`SELECT id, number, status FROM applications WHERE enquiry_id = $1`, [rows[0].id]);
  res.json({ ...rows[0], followups: f, applications: apps });
});

router.patch('/admissions/enquiries/:id', leads, async (req, res) => {
  const b = patchSchema(enquiryBody.shape).parse(req.body);
  await checkEnquiryRefs(req, b);
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to change');
  const params: unknown[] = [id.parse(req.params.id), institutionId(req)];
  const sets = entries.map(([k, v]) => (params.push(v), `${k} = $${params.length}`));
  const { rows } = await db.query(`UPDATE enquiries SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND institution_id = $2 RETURNING *`, params);
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

router.delete('/admissions/enquiries/:id', leads, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM enquiries WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

router.post('/admissions/enquiries/:id/followups', leads, async (req, res) => {
  const b = followupBody.parse(req.body);
  const { rows: e } = await db.query(`SELECT id, status FROM enquiries WHERE id = $1 AND institution_id = $2 FOR UPDATE`, [id.parse(req.params.id), institutionId(req)]);
  if (!e[0]) throw notFound();
  const { rows } = await db.query(`INSERT INTO enquiry_followups (institution_id, enquiry_id, channel, note, outcome, next_at, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
    institutionId(req), e[0].id, b.channel, b.note, b.outcome, b.next_at, currentUser(req).id,
  ]);
  // a first contact moves a new lead along; the next follow-up date is kept on the lead
  const status = b.status ?? (e[0].status === 'new' ? 'contacted' : e[0].status);
  await db.query(`UPDATE enquiries SET status = $2, next_follow_up_at = $3, updated_at = now() WHERE id = $1`, [e[0].id, status, b.next_at]);
  res.status(201).json(rows[0]);
});

export default router;
