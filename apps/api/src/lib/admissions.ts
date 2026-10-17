// Admissions: application numbers and private status links, emails to applicants, the online
// entrance test (questions drawn from a bank, auto-marked by the quiz engine), and turning an
// accepted applicant into a student with guardian and portal accounts.
import crypto from 'node:crypto';
import { autoScore, MANUAL_TYPES, studentView, type QuestionType } from '@acadex/shared';
import { inviteUser } from '../auth/invites';
import { getConfig } from '../config';
import { db } from '../db/context';
import { grantSystemRole } from '../rbac';
import { badRequest, conflict, notFound } from './errors';
import { assertStudentCapacity } from './platform';
import { sendEmail } from './mailer';

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
export const statusLink = (token: string) => `${getConfig().appUrl}/apply/status#${token}`;

export interface ApplicationRow {
  id: number;
  institution_id: number;
  form_id: number;
  number: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  gender: string | null;
  email: string;
  phone: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  guardian_relationship: string;
  status: string;
  test_at: Date | null;
  test_venue: string;
  test_score: string | null;
  test_max: string | null;
  test_layout: { question_id: number; points: number; view: unknown }[] | null;
  test_answers: Record<string, unknown> | null;
  test_started_at: Date | null;
  test_deadline: Date | null;
  interview_score: string | null;
  merit_rank: number | null;
  offer_expires_at: Date | null;
  decision_note: string;
  student_id: number | null;
  data: Record<string, unknown>;
}

export async function nextApplicationNumber(institutionId: number) {
  const year = new Date().getUTCFullYear();
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${institutionId}:applications:${year}`]);
  const { rows } = await db.query<{ n: number }>(
    `SELECT COALESCE(max(NULLIF(regexp_replace(number, '^.*-', ''), '')::int), 0) + 1 AS n FROM applications WHERE institution_id = $1 AND number LIKE $2`,
    [institutionId, `APP-${year}-%`]
  );
  return `APP-${year}-${String(rows[0]!.n).padStart(5, '0')}`;
}

const STATUS_TEXT: Record<string, string> = {
  submitted: 'We have received your application.',
  under_review: 'Your application is being reviewed.',
  test_scheduled: 'Your entrance test has been scheduled.',
  tested: 'Your entrance test has been marked.',
  offered: 'Congratulations — you have been offered a place. Please accept or decline the offer.',
  accepted: 'You have accepted the offer. The admissions office will complete your enrolment.',
  declined: 'You have declined the offer.',
  rejected: 'We are unable to offer you a place this time.',
  waitlisted: 'You are on the waiting list. We will contact you if a place becomes available.',
  enrolled: 'Welcome! You are now enrolled. Look out for an email to set up your account.',
  withdrawn: 'Your application has been withdrawn.',
};

/** Tell the applicant (and guardian) about a change. The private link is only sent at submission. */
export async function emailApplicant(app: Pick<ApplicationRow, 'institution_id' | 'number' | 'email' | 'guardian_email' | 'first_name'>, status: string, extra = '', token?: string) {
  const { rows } = await db.query<{ name: string }>(`SELECT name FROM institutions WHERE id = $1`, [app.institution_id]);
  const inst = rows[0]?.name ?? 'Admissions';
  const text = [
    `Dear ${app.first_name},`,
    '',
    STATUS_TEXT[status] ?? `Your application status is now: ${status}.`,
    extra,
    '',
    `Application number: ${app.number}`,
    token ? `Check your application at any time: ${statusLink(token)}` : 'Use the link from your first email to see your application.',
    '',
    inst,
  ]
    .filter((l) => l !== undefined)
    .join('\n');
  for (const to of new Set([app.email, app.guardian_email].filter(Boolean))) {
    await sendEmail({ to, subject: `${inst}: application ${app.number}`, text, template: `admission_${status}`, institutionId: app.institution_id });
  }
}

// ---------------------------------------------------------------- online entrance test

const shuffled = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** Draw the questions (auto-marked types only) and start the clock. */
export async function startEntranceTest(app: ApplicationRow, test: { bank_id: number; count: number; minutes: number }) {
  if (app.test_layout) return;
  const { rows: qs } = await db.query<{ id: number; type: QuestionType; data: Record<string, unknown>; points: string }>(
    `SELECT id, type, data, points FROM questions WHERE bank_id = $1 AND deleted_at IS NULL AND NOT (type = ANY($2::text[])) AND type <> 'formula'`,
    [test.bank_id, [...MANUAL_TYPES]]
  );
  if (qs.length < 1) throw conflict('The entrance test is not ready yet; please contact the admissions office', 'NO_TEST');
  const picked = shuffled(qs).slice(0, test.count);
  const layout = picked.map((q) => ({ question_id: q.id, points: Number(q.points) || 1, view: studentView(q.type, q.data, shuffled) }));
  await db.query(`UPDATE applications SET test_layout = $2, test_answers = '{}'::jsonb, test_started_at = now(), test_deadline = now() + make_interval(mins => $3), updated_at = now() WHERE id = $1`, [
    app.id, JSON.stringify(layout), test.minutes,
  ]);
}

/** Mark the test and record the score (auto-marked; the applicant is then "tested"). */
export async function finishEntranceTest(app: ApplicationRow) {
  if (!app.test_layout || app.status !== 'test_scheduled') return;
  const { rows: qs } = await db.query<{ id: number; type: QuestionType; data: Record<string, unknown> }>(`SELECT id, type, data FROM questions WHERE id = ANY($1::int[])`, [app.test_layout.map((l) => l.question_id)]);
  let score = 0;
  let max = 0;
  for (const l of app.test_layout) {
    const q = qs.find((x) => x.id === l.question_id);
    max += l.points;
    if (!q) continue;
    const frac = autoScore(q.type, q.data, (app.test_answers ?? {})[String(l.question_id)]);
    score += (frac ?? 0) * l.points;
  }
  await db.query(`UPDATE applications SET test_score = $2, test_max = $3, status = 'tested', updated_at = now() WHERE id = $1`, [app.id, Math.round(score * 100) / 100, max]);
}

export const testExpired = (app: ApplicationRow) => !!app.test_deadline && app.test_deadline.getTime() + 30_000 < Date.now();

// ---------------------------------------------------------------- enrolment

/**
 * An accepted applicant becomes a student in the chosen class, with their guardian (an
 * existing guardian with the same email or phone is reused, so siblings are linked) and
 * invitations to the student and parent portals.
 */
export async function convertToStudent(app: ApplicationRow, o: { sectionId: number; rollNo?: string | null; admissionDate?: string; byUser: { id: number; name: string } }) {
  if (app.status !== 'accepted' && app.status !== 'offered') throw conflict('Only applicants who have been offered a place can be enrolled', 'NOT_ACCEPTED');
  if (app.student_id) throw conflict('This applicant is already enrolled', 'ENROLLED');
  const inst = app.institution_id;
  await assertStudentCapacity(inst);
  const { rows: clash } = await db.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [app.email]);
  if (clash[0]) throw conflict('Someone already has an account with the applicant\'s email', 'EMAIL_TAKEN');
  const { rows: st } = await db.query<{ id: number }>(
    `INSERT INTO students (institution_id, roll_no, first_name, last_name, gender, email, dob, section_id, phone, admission_date, custom_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, CURRENT_DATE),'{}'::jsonb) RETURNING id`,
    [inst, o.rollNo ?? null, app.first_name, app.last_name || '-', app.gender, app.email, app.dob, o.sectionId, app.phone || null, o.admissionDate ?? null]
  );
  const studentId = st[0]!.id;
  const { rows: su } = await db.query<{ id: number }>(`INSERT INTO users (institution_id, role, email, password_hash, full_name, ref_id) VALUES ($1,'student',$2,NULL,$3,$4) RETURNING id`, [
    inst, app.email, `${app.first_name} ${app.last_name}`.trim(), studentId,
  ]);
  await grantSystemRole(db, su[0]!.id, 'student', inst, o.byUser.id);
  const invites = [await inviteUser(su[0]!.id, o.byUser)];
  let guardianId: number | null = null;
  if (app.guardian_name || app.guardian_phone || app.guardian_email) {
    const { rows: existing } = await db.query<{ id: number; user_id: number | null }>(
      `SELECT id, user_id FROM guardians WHERE institution_id = $1 AND deleted_at IS NULL AND ((email <> '' AND lower(email) = lower($2)) OR (phone <> '' AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace($3, '\\D', '', 'g'))) ORDER BY id LIMIT 1`,
      [inst, app.guardian_email, app.guardian_phone || '-']
    );
    let g = existing[0];
    if (!g) {
      const [first = '', ...rest] = (app.guardian_name || 'Guardian').trim().split(/\s+/);
      const { rows } = await db.query<{ id: number; user_id: number | null }>(`INSERT INTO guardians (institution_id, first_name, last_name, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id, user_id`, [
        inst, first, rest.join(' '), app.guardian_phone, app.guardian_email,
      ]);
      g = rows[0]!;
    }
    guardianId = g.id;
    await db.query(`INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship, is_primary, is_emergency_contact) VALUES ($1,$2,$3,$4,true,true) ON CONFLICT DO NOTHING`, [
      inst, g.id, studentId, app.guardian_relationship,
    ]);
    if (!g.user_id && app.guardian_email) {
      const { rows: taken } = await db.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [app.guardian_email]);
      if (!taken[0]) {
        const { rows: pu } = await db.query<{ id: number }>(`INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES ($1,'parent',$2,NULL,$3) RETURNING id`, [inst, app.guardian_email, app.guardian_name || 'Parent']);
        await grantSystemRole(db, pu[0]!.id, 'parent', inst, o.byUser.id);
        await db.query(`UPDATE guardians SET user_id = $2 WHERE id = $1`, [g.id, pu[0]!.id]);
        invites.push(await inviteUser(pu[0]!.id, o.byUser));
      }
    }
  }
  // the application fee and its payment now belong to the student's account
  await db.query(`UPDATE payments SET student_id = $2 WHERE invoice_id IN (SELECT id FROM invoices WHERE application_id = $1)`, [app.id, studentId]);
  await db.query(`UPDATE applications SET status = 'enrolled', student_id = $2, updated_at = now() WHERE id = $1`, [app.id, studentId]);
  await db.query(`UPDATE enquiries SET status = 'enrolled', updated_at = now() WHERE id = (SELECT enquiry_id FROM applications WHERE id = $1)`, [app.id]);
  return { student_id: studentId, guardian_id: guardianId, invites: invites.length };
}

export async function loadApplicationByToken(token: string) {
  const { rows } = await db.query<ApplicationRow>(`SELECT * FROM applications WHERE token_hash = $1`, [hashToken(token)]);
  if (!rows[0]) throw notFound('This link is not valid');
  return rows[0];
}

export function assertAnswerable(app: ApplicationRow) {
  if (app.status !== 'test_scheduled' || !app.test_layout) throw badRequest('There is no test in progress');
}
