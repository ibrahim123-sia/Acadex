import { Router, type Request } from 'express';
import { collectFeeBody, id, optionalId } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { todayIn } from '../lib/locale';
import { createAdhocInvoice, loadInvoice, recordPayment } from '../lib/finance/ledger';
import { LIVE_INVOICE, invoiceLabel } from '../lib/finance/summary';
import { parsePage, sendPage } from '../lib/pagination';
import { assertCampusAllowed, campusesFor } from '../lib/structure';
import { inviteUser } from '../auth/invites';
import { auth, currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';

const router = Router();
// Institution administration: each route requires its own permission (institution admins hold all of
// them; custom roles such as "Accountant" or "Branch principal" can hold a subset, at one campus).
router.use(auth);

const auditAs = (req: Request, action: string, entity: string, detail: string) =>
  audit({ institutionId: institutionId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity, detail });

// ---------- Dashboard ----------
// One query (each round trip to the database counts): totals for the caller's campuses, or
// one campus with ?campus_id=, plus a side-by-side comparison of every campus in scope.
router.get('/dashboard', requirePermission('institution.dashboard.read'), async (req, res) => {
  const s = institutionId(req);
  const campus = optionalId.parse(req.query.campus_id);
  const scope = campusesFor(req, 'institution.dashboard.read');
  if (campus) assertCampusAllowed(scope, campus);
  const { rows } = await db.query(
    `WITH inst AS (SELECT (now() AT TIME ZONE timezone)::date AS today FROM institutions WHERE id = $1),
          scope AS (SELECT id FROM campuses WHERE institution_id = $1 AND ($2::int[] IS NULL OR id = ANY($2)) AND ($3::int IS NULL OR id = $3)),
          sec AS (SELECT id, name, label, campus_id FROM sections WHERE institution_id = $1 AND status = 'active' AND campus_id IN (SELECT id FROM scope)),
          stu AS (SELECT st.id, st.first_name, st.last_name, st.roll_no, st.created_at, st.section_id, sec.campus_id
                    FROM students st LEFT JOIN sec ON sec.id = st.section_id
                   WHERE st.institution_id = $1 AND st.status = 'active'
                     AND (sec.id IS NOT NULL OR ($2::int[] IS NULL AND $3::int IS NULL AND st.section_id IS NULL))),
          staff AS (SELECT id, campus_id FROM teachers WHERE institution_id = $1 AND status <> 'left'
                       AND (campus_id IN (SELECT id FROM scope) OR ($2::int[] IS NULL AND $3::int IS NULL AND campus_id IS NULL))),
          fee AS (SELECT f.paid AS paid_amount, f.total - f.paid AS remaining_balance, ${invoiceLabel('f')} AS payment_status, stu.campus_id
                    FROM invoices f JOIN stu ON stu.id = f.student_id WHERE f.${LIVE_INVOICE}),
          att AS (SELECT initcap(a.status) AS status, stu.campus_id FROM attendance_records a JOIN attendance_sessions sn ON sn.id = a.session_id JOIN stu ON stu.id = a.student_id
                   WHERE sn.date >= (SELECT today FROM inst) - 7)
     SELECT json_build_object(
       'students', (SELECT count(*) FROM stu),
       'teachers', (SELECT count(*) FROM staff),
       'sections', (SELECT count(*) FROM sec),
       'feeCollected', (SELECT COALESCE(sum(paid_amount), 0) FROM fee),
       'feeOutstanding', (SELECT COALESCE(sum(remaining_balance), 0) FROM fee),
       'feeStatus', (SELECT COALESCE(json_agg(x), '[]') FROM (SELECT payment_status, count(*)::int c FROM fee GROUP BY 1) x),
       'attendance', (SELECT COALESCE(json_agg(x), '[]') FROM (SELECT status, count(*)::int c FROM att GROUP BY 1) x),
       'classDistribution', (SELECT COALESCE(json_agg(x), '[]') FROM (
           SELECT sec.name || CASE WHEN sec.label IS NOT NULL AND sec.label <> '' THEN ' ' || sec.label ELSE '' END AS name, count(stu.id)::int students
             FROM sec LEFT JOIN stu ON stu.section_id = sec.id GROUP BY sec.id, sec.name, sec.label ORDER BY students DESC, sec.name LIMIT 12) x),
       'recentStudents', (SELECT COALESCE(json_agg(x), '[]') FROM (SELECT id, first_name, last_name, roll_no, created_at FROM stu ORDER BY created_at DESC, id DESC LIMIT 6) x),
       'campuses', (SELECT COALESCE(json_agg(x ORDER BY x.is_main DESC, x.name), '[]') FROM (
           SELECT c.id, c.name, c.code, c.is_main,
                  (SELECT count(*)::int FROM stu WHERE campus_id = c.id) AS students,
                  (SELECT count(*)::int FROM staff WHERE campus_id = c.id) AS staff,
                  (SELECT count(*)::int FROM sec WHERE campus_id = c.id) AS sections,
                  (SELECT round(100.0 * count(*) FILTER (WHERE status IN ('Present', 'Late')) / NULLIF(count(*), 0), 1) FROM att WHERE campus_id = c.id) AS attendance_rate,
                  (SELECT COALESCE(sum(paid_amount), 0) FROM fee WHERE campus_id = c.id) AS fee_collected,
                  (SELECT COALESCE(sum(remaining_balance), 0) FROM fee WHERE campus_id = c.id) AS fee_outstanding
             FROM campuses c WHERE c.id IN (SELECT id FROM scope)) x)
     ) AS d`,
    [s, scope, campus]
  );
  const d = rows[0].d;
  res.json({
    ...d,
    feeCollected: Number(d.feeCollected),
    feeOutstanding: Number(d.feeOutstanding),
    campuses: d.campuses.map((c: Record<string, unknown>) => ({ ...c, fee_collected: Number(c.fee_collected), fee_outstanding: Number(c.fee_outstanding) })),
    campus_id: campus,
  });
});

// ---------- Fees ----------
router.get('/fees', requirePermission('fees.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT f.id, f.number AS receipt_id, f.number, f.title, f.total AS total_fee, f.paid AS paid_amount, f.total - f.paid AS remaining_balance,
            ${invoiceLabel('f')} AS payment_status, f.status, f.due_date,
            (SELECT max(p.received_at)::date FROM payments p WHERE p.invoice_id = f.id) AS payment_date,
            st.first_name||' '||st.last_name student, st.roll_no, count(*) OVER() _total
       FROM invoices f JOIN students st ON st.id=f.student_id
      WHERE f.institution_id=$1 AND f.${LIVE_INVOICE} ORDER BY f.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// Fee totals for the whole institution (the fees list is paginated, so the UI can't add it up)
router.get('/fees/summary', requirePermission('fees.read'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(paid),0)::float8 collected, COALESCE(SUM(total - paid),0)::float8 outstanding
       FROM invoices WHERE institution_id=$1 AND ${LIVE_INVOICE}`,
    [institutionId(req)]
  );
  res.json(rows[0]);
});

// ---------- Grades ----------
router.get('/grades', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT g.id, st.first_name||' '||st.last_name student, st.roll_no, c.name section_name,
            co.name subject, initcap(a.kind) assignment_type, a.title assignment_name, g.points obtained_marks, a.points total_marks, g.status,
            ROUND(g.points / NULLIF(a.points,0) * 100, 1) percentage, count(*) OVER() _total
       FROM grades g JOIN assessments a ON a.id=g.assessment_id JOIN students st ON st.id=g.student_id
       JOIN course_offerings su ON su.id=a.offering_id LEFT JOIN courses co ON co.id=su.course_id LEFT JOIN sections c ON c.id=su.section_id
      WHERE g.institution_id=$1 AND g.points IS NOT NULL ORDER BY g.updated_at DESC, g.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Attendance (most recent first) ----------
router.get('/attendance', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT sn.date att_date, st.first_name||' '||st.last_name student, st.roll_no, c.name section_name, COALESCE(co.name, '') subject, initcap(a.status) status,
            count(*) OVER() _total
       FROM attendance_records a JOIN attendance_sessions sn ON sn.id=a.session_id JOIN students st ON st.id=a.student_id LEFT JOIN sections c ON c.id=sn.section_id
       LEFT JOIN course_offerings o ON o.id=sn.offering_id LEFT JOIN courses co ON co.id=o.course_id
      WHERE a.institution_id=$1 ORDER BY sn.date DESC, sn.id DESC, st.roll_no LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Timetable ----------
router.get('/timetable', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT (ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[tt.weekday + 1] day_of_week,
            to_char(p.starts_at, 'HH24:MI') || '-' || to_char(p.ends_at, 'HH24:MI') time_slot, COALESCE(co.name, '') subject, c.name section_name,
            t.first_name||' '||t.last_name teacher, count(*) OVER() _total
       FROM timetable_slots tt JOIN periods p ON p.id=tt.period_id JOIN sections c ON c.id=tt.section_id LEFT JOIN teachers t ON t.id=tt.teacher_id
       LEFT JOIN course_offerings o ON o.id=tt.offering_id LEFT JOIN courses co ON co.id=o.course_id
      WHERE tt.institution_id=$1 ORDER BY c.id, tt.weekday, p.position, tt.id LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Exams ----------
router.get('/exams', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT s.id, x.name exam_name, co.name subject, s.date exam_date, to_char(s.starts_at, 'HH24:MI') || '-' || to_char(s.ends_at, 'HH24:MI') time_slot,
            s.total_marks::float8 total_marks, c.name section_name, count(*) OVER() _total
       FROM exam_sessions s JOIN exam_series x ON x.id = s.series_id JOIN course_offerings o ON o.id = s.offering_id
       JOIN courses co ON co.id = o.course_id LEFT JOIN sections c ON c.id = o.section_id
      WHERE s.institution_id=$1 ORDER BY s.date, s.starts_at, s.id LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Announcements ----------
router.get('/announcements', requirePermission('announcements.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT id, title, target_audience, description, start_date, end_date, created_at, count(*) OVER() _total
       FROM announcements WHERE institution_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});


// ---------- WRITE: admissions / faculty / sections / fees ----------

// Send a new invitation (the previous link stops working). Only for accounts that haven't
// set a password yet; others can use "forgot password".
router.post('/users/:userId/invite', async (req, res) => {
  const userId = id.parse(req.params.userId);
  const { rows } = await db.query<{ id: number; role: string; password_hash: string | null }>(
    `SELECT id, role, password_hash FROM users WHERE id=$1 AND institution_id=$2`,
    [userId, institutionId(req)]
  );
  const u = rows[0];
  if (!u) throw notFound('User not found');
  const needed = u.role === 'student' ? 'students.manage' : u.role === 'parent' ? 'students.manage' : 'staff.manage';
  if (!userCan(req, needed)) throw forbidden('You do not have permission to do this');
  if (u.password_hash) throw badRequest('This person has already activated their account. They can use "Forgot password".');
  const invite = await inviteUser(u.id, { id: currentUser(req).id, name: currentUser(req).name });
  await auditAs(req, 'resend_invite', 'User', invite.email);
  res.json({ invite });
});

// Collect a fee
router.post('/fees', requirePermission('fees.manage'), async (req, res) => {
  const s = institutionId(req);
  const { student_id, total_fee: total, paid_amount: paid } = collectFeeBody.parse(req.body);
  await assertInInstitution('students', student_id, s);
  // a one-off invoice for the amount, with what was paid at the counter recorded against it
  const today = todayIn(await institutionTimeZone(s));
  const inv = await withTransaction(async () => {
    const created = await createAdhocInvoice(s, { studentId: student_id, title: 'Fee', lines: [{ head: 'Tuition', label: 'Fee', amount: total }], issueDate: today, dueDate: today, userId: currentUser(req).id });
    const receipt = paid > 0 ? await recordPayment(created, { amount: paid, method: 'cash', receivedBy: currentUser(req).id }) : null;
    return { ...(await loadInvoice(created.id, s)), receipt_id: receipt?.receipt_no ?? null };
  });
  await auditAs(req, 'collect_fee', 'Invoice', inv.number);
  res.status(201).json({ ...inv, total_fee: inv.total, paid_amount: inv.paid, remaining_balance: (Number(inv.total) - Number(inv.paid)).toFixed(2) });
});

export default router;
