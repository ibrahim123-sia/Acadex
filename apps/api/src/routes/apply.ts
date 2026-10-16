// Public admissions under /api/apply (no sign-in):
//   GET  /:institution/:form          the branded application form
//   POST /:institution/:form          apply (rate limited, with a honeypot field)
//   /status/:token …                  the applicant's private link: status, documents, the
//                                     application fee, the online entrance test, the offer
// Lookups go through the form's public address or the applicant's secret token, so these run
// with RLS bypassed.
import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { answerBody, applicationSubmitBody } from '@acadex/shared';
import { getConfig } from '../config';
import { db, systemContext, withTransaction } from '../db/context';
import {
  assertAnswerable,
  emailApplicant,
  finishEntranceTest,
  hashToken,
  loadApplicationByToken,
  nextApplicationNumber,
  startEntranceTest,
  testExpired,
  type ApplicationRow,
} from '../lib/admissions';
import { badRequest, conflict, notFound } from '../lib/errors';
import { createAdhocInvoice } from '../lib/finance/ledger';
import { todayIn } from '../lib/locale';
import { oneFile, requireFile } from '../lib/upload';
import { storeUpload } from '../storage/files';

const router = Router();
router.use(systemContext);
const submitLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: () => (getConfig().env === 'test' ? 1000 : 10), standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => ipKeyGenerator(req.ip ?? '') });

interface FormRow {
  id: number;
  institution_id: number;
  title: string;
  description: string;
  fields: { key: string; label: string; type: string; options?: string[]; required: boolean }[];
  documents: { key: string; label: string; required: boolean }[];
  application_fee: string;
  entrance_test: { bank_id: number; count: number; minutes: number } | null;
  opens_at: Date | null;
  closes_at: Date | null;
  status: string;
  institution: string;
  primary_color: string | null;
  logo_url: string | null;
  currency: string;
  timezone: string;
}

const slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

async function loadForm(req: Request): Promise<FormRow> {
  const { rows } = await db.query<FormRow>(
    `SELECT f.*, i.name AS institution, i.primary_color, i.logo_url, i.currency, i.timezone FROM admission_forms f JOIN institutions i ON i.id = f.institution_id
      WHERE i.slug = $1 AND f.slug = $2 AND f.status <> 'draft' AND i.status = 'active'`,
    [slug.parse(req.params.institution), slug.parse(req.params.form)]
  );
  if (!rows[0]) throw notFound('This application form does not exist');
  return rows[0];
}

const isOpen = (f: FormRow, now = new Date()) => f.status === 'open' && (!f.opens_at || f.opens_at <= now) && (!f.closes_at || f.closes_at > now);

// ---------------------------------------------------------------- the applicant's own link

const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{30,40}$/);
async function byToken(req: Request) {
  return loadApplicationByToken(tokenParam.parse(req.params.token));
}

async function formOf(app: ApplicationRow) {
  const { rows } = await db.query<FormRow>(`SELECT f.*, i.name AS institution, i.primary_color, i.logo_url, i.currency, i.timezone FROM admission_forms f JOIN institutions i ON i.id = f.institution_id WHERE f.id = $1`, [app.form_id]);
  return rows[0]!;
}

router.get('/status/:token', async (req, res) => {
  let app = await byToken(req);
  if (app.status === 'test_scheduled' && app.test_layout && testExpired(app)) {
    await finishEntranceTest(app);
    app = await byToken(req);
  }
  const f = await formOf(app);
  const [docs, invoice] = await Promise.all([
    db.query<{ key: string; created_at: Date }>(`SELECT key, created_at FROM application_documents WHERE application_id = $1`, [app.id]),
    db.query(`SELECT number, title, total, paid, status, pay_token, currency FROM invoices WHERE application_id = $1 AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`, [app.id]),
  ]);
  const testOpen = !!f.entrance_test && app.status === 'test_scheduled' && (!app.test_at || app.test_at <= new Date());
  res.json({
    number: app.number,
    name: `${app.first_name} ${app.last_name}`.trim(),
    institution: f.institution,
    primary_color: f.primary_color,
    form: f.title,
    status: app.status,
    documents: f.documents.map((d) => ({ ...d, uploaded: docs.rows.some((x) => x.key === d.key) })),
    can_upload: ['submitted', 'under_review', 'test_scheduled'].includes(app.status),
    fee: invoice.rows[0] ? { ...invoice.rows[0], balance: Number(invoice.rows[0].total) - Number(invoice.rows[0].paid) } : null,
    test: {
      at: app.test_at,
      venue: app.test_venue,
      online: !!f.entrance_test,
      available: testOpen && !app.test_layout,
      in_progress: app.status === 'test_scheduled' && !!app.test_layout,
      minutes: f.entrance_test?.minutes ?? null,
      score: app.test_score == null ? null : { score: Number(app.test_score), max: Number(app.test_max) },
    },
    offer: app.status === 'offered' ? { expires_at: app.offer_expires_at, expired: !!app.offer_expires_at && app.offer_expires_at < new Date() } : null,
    decision_note: ['rejected', 'waitlisted', 'offered'].includes(app.status) ? app.decision_note : '',
  });
});

router.post('/status/:token/documents', oneFile(10), async (req: Request, res: Response, _next: NextFunction) => {
  const app = await byToken(req);
  if (!['submitted', 'under_review', 'test_scheduled'].includes(app.status)) throw conflict('Documents can no longer be changed', 'LOCKED');
  const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).parse(req.body?.key);
  const f = await formOf(app);
  if (!f.documents.some((d) => d.key === key)) throw badRequest('This form does not ask for that document');
  const file = requireFile(req);
  const stored = await storeUpload({ institutionId: app.institution_id, userId: null, purpose: 'document', body: file.buffer, originalName: file.originalname });
  await db.query(
    `INSERT INTO application_documents (institution_id, application_id, key, file_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT ON CONSTRAINT application_documents_application_id_key_key DO UPDATE SET file_id = EXCLUDED.file_id, created_at = now()`,
    [app.institution_id, app.id, key, stored.id]
  );
  res.status(201).json({ key, uploaded: true });
});

router.post('/status/:token/test/start', async (req, res) => {
  const app = await byToken(req);
  const f = await formOf(app);
  if (!f.entrance_test || app.status !== 'test_scheduled') throw conflict('There is no online test to take', 'NO_TEST');
  if (app.test_at && app.test_at > new Date()) throw conflict(`The test opens at ${app.test_at.toISOString()}`, 'NOT_OPEN');
  if (app.test_layout && testExpired(app)) throw conflict('The time for the test is over', 'TIME_UP');
  await startEntranceTest(app, f.entrance_test);
  res.status(201).json({ started: true });
});

router.get('/status/:token/test', async (req, res) => {
  const app = await byToken(req);
  assertAnswerable(app);
  if (testExpired(app)) {
    await finishEntranceTest(app);
    throw conflict('The time is up — your answers were handed in', 'TIME_UP');
  }
  const { rows: qs } = await db.query<{ id: number; type: string; prompt_html: string }>(`SELECT id, type, prompt_html FROM questions WHERE id = ANY($1::int[])`, [app.test_layout!.map((l) => l.question_id)]);
  res.json({
    deadline: app.test_deadline,
    questions: app.test_layout!.map((l, i) => {
      const q = qs.find((x) => x.id === l.question_id);
      return { n: i + 1, question_id: l.question_id, type: q?.type, prompt_html: q?.prompt_html ?? '', points: l.points, view: l.view, response: (app.test_answers ?? {})[String(l.question_id)] ?? null };
    }),
  });
});

router.put('/status/:token/test/answers', async (req, res) => {
  const app = await byToken(req);
  assertAnswerable(app);
  if (testExpired(app)) {
    await finishEntranceTest(app);
    throw conflict('The time is up — your answers were handed in', 'TIME_UP');
  }
  const b = answerBody.parse(req.body);
  if (!app.test_layout!.some((l) => l.question_id === b.question_id)) throw badRequest('That question is not in your test');
  if (JSON.stringify(b.response ?? null).length > 10_000) throw badRequest('The answer is too long');
  await db.query(`UPDATE applications SET test_answers = jsonb_set(COALESCE(test_answers, '{}'::jsonb), ARRAY[$2::text], $3::jsonb), updated_at = now() WHERE id = $1`, [
    app.id, String(b.question_id), JSON.stringify(b.response ?? null),
  ]);
  res.json({ saved: true });
});

router.post('/status/:token/test/submit', async (req, res) => {
  const app = await byToken(req);
  assertAnswerable(app);
  await finishEntranceTest(app);
  res.json({ submitted: true });
});

/** Accept or decline an offer. */
async function answerOffer(req: Request, res: Response, to: 'accepted' | 'declined') {
  const app = await byToken(req);
  if (app.status !== 'offered') throw conflict('There is no offer to answer', 'NO_OFFER');
  if (app.offer_expires_at && app.offer_expires_at < new Date()) throw conflict('This offer has expired; please contact the admissions office', 'EXPIRED');
  await db.query(`UPDATE applications SET status = $2, updated_at = now() WHERE id = $1`, [app.id, to]);
  await emailApplicant(app, to);
  res.json({ status: to });
}
router.post('/status/:token/accept', (req, res) => answerOffer(req, res, 'accepted'));
router.post('/status/:token/decline', (req, res) => answerOffer(req, res, 'declined'));

// ---------------------------------------------------------------- the form (after /status, which it would otherwise match)

router.get('/:institution/:form', async (req, res) => {
  const f = await loadForm(req);
  res.json({
    institution: f.institution,
    primary_color: f.primary_color,
    logo_url: f.logo_url,
    title: f.title,
    description: f.description,
    fields: f.fields,
    documents: f.documents,
    application_fee: Number(f.application_fee),
    currency: f.currency,
    entrance_test: f.entrance_test ? { questions: f.entrance_test.count, minutes: f.entrance_test.minutes } : null,
    opens_at: f.opens_at,
    closes_at: f.closes_at,
    open: isOpen(f),
  });
});

router.post('/:institution/:form', submitLimit, async (req, res) => {
  const f = await loadForm(req);
  if (!isOpen(f)) throw conflict('Applications are closed', 'CLOSED');
  const b = applicationSubmitBody.parse(req.body);
  // the form's own questions
  const data: Record<string, string | number> = {};
  for (const q of f.fields) {
    const v = b.data[q.key];
    if (v === undefined || v === '') {
      if (q.required) throw badRequest(`${q.label} is required`, { [`data.${q.key}`]: 'required' });
      continue;
    }
    if (q.type === 'number' && Number.isNaN(Number(v))) throw badRequest(`${q.label} must be a number`);
    if (q.type === 'select' && !q.options?.includes(String(v))) throw badRequest(`Choose one of the options for ${q.label}`);
    data[q.key] = q.type === 'number' ? Number(v) : String(v);
  }
  const { rows: dup } = await db.query(`SELECT 1 FROM applications WHERE form_id = $1 AND lower(email) = lower($2) AND status NOT IN ('withdrawn', 'declined', 'rejected')`, [f.id, b.email]);
  if (dup[0]) throw conflict('An application with this email is already in progress — use the link in your email to follow it', 'DUPLICATE');
  const token = crypto.randomBytes(24).toString('base64url');
  const out = await withTransaction(async () => {
    const number = await nextApplicationNumber(f.institution_id);
    // a matching enquiry (same phone or email) is linked and moves to "applied"
    const { rows: enq } = await db.query<{ id: number }>(
      `SELECT id FROM enquiries WHERE institution_id = $1 AND status NOT IN ('enrolled', 'lost') AND ((email <> '' AND lower(email) IN (lower($2), lower($3))) OR (phone <> '' AND regexp_replace(phone, '\\D', '', 'g') IN (regexp_replace($4, '\\D', '', 'g'), regexp_replace($5, '\\D', '', 'g'))))
        ORDER BY created_at DESC LIMIT 1`,
      [f.institution_id, b.email, b.guardian_email || '-', b.phone || '-', b.guardian_phone || '-']
    );
    const { rows } = await db.query<ApplicationRow>(
      `INSERT INTO applications (institution_id, form_id, number, token_hash, first_name, last_name, dob, gender, email, phone, guardian_name, guardian_phone, guardian_email, guardian_relationship, previous_school, data, enquiry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [f.institution_id, f.id, number, hashToken(token), b.first_name, b.last_name, b.dob, b.gender ?? null, b.email, b.phone, b.guardian_name, b.guardian_phone, b.guardian_email, b.guardian_relationship, b.previous_school, JSON.stringify(data), enq[0]?.id ?? null]
    );
    if (enq[0]) await db.query(`UPDATE enquiries SET status = 'applied', updated_at = now() WHERE id = $1`, [enq[0].id]);
    let invoice: { id: number } | null = null;
    if (Number(f.application_fee) > 0) {
      const today = todayIn(f.timezone);
      invoice = await createAdhocInvoice(f.institution_id, {
        applicationId: rows[0]!.id,
        title: `Application fee — ${f.title}`,
        lines: [{ head: 'Application fee', label: 'Application fee', amount: Number(f.application_fee) }],
        issueDate: today,
        dueDate: today,
        userId: null,
      });
    }
    await emailApplicant(rows[0]!, 'submitted', Number(f.application_fee) > 0 ? 'Please pay the application fee from your application page.' : '', token);
    return { app: rows[0]!, invoice };
  });
  res.status(201).json({ number: out.app.number, token, status_url: `/apply/status#${token}` });
});

export default router;
