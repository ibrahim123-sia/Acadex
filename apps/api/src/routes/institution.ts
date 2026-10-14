import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { announcementBody, collectFeeBody, id, optionalId } from '@acadex/shared';
import { db } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { todayIn } from '../lib/locale';
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
          fee AS (SELECT f.paid_amount, f.remaining_balance, f.payment_status, stu.campus_id FROM tuition_fee f JOIN stu ON stu.id = f.student_id),
          att AS (SELECT a.status, stu.campus_id FROM student_attendance a JOIN stu ON stu.id = a.student_id
                   WHERE a.att_date >= (SELECT today FROM inst) - 7)
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
                  (SELECT round(100.0 * count(*) FILTER (WHERE status = 'Present') / NULLIF(count(*), 0), 1) FROM att WHERE campus_id = c.id) AS attendance_rate,
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
    `SELECT f.id, f.receipt_id, f.total_fee, f.paid_amount, f.remaining_balance, f.payment_status, f.payment_date,
            st.first_name||' '||st.last_name student, st.roll_no, count(*) OVER() _total
       FROM tuition_fee f JOIN students st ON st.id=f.student_id
      WHERE f.institution_id=$1 ORDER BY f.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// Fee totals for the whole institution (the fees list is paginated, so the UI can't add it up)
router.get('/fees/summary', requirePermission('fees.read'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(paid_amount),0)::float8 collected, COALESCE(SUM(remaining_balance),0)::float8 outstanding
       FROM tuition_fee WHERE institution_id=$1`,
    [institutionId(req)]
  );
  res.json(rows[0]);
});

// ---------- Grades ----------
router.get('/grades', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT g.id, st.first_name||' '||st.last_name student, st.roll_no, c.name section_name,
            co.name subject, g.assignment_type, g.assignment_name, g.obtained_marks, g.total_marks,
            ROUND(g.obtained_marks / NULLIF(g.total_marks,0) * 100, 1) percentage, count(*) OVER() _total
       FROM grades g JOIN students st ON st.id=g.student_id
       LEFT JOIN sections c ON c.id=g.section_id LEFT JOIN course_offerings su ON su.id=g.offering_id LEFT JOIN courses co ON co.id=su.course_id
      WHERE g.institution_id=$1 ORDER BY g.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Attendance (most recent first) ----------
router.get('/attendance', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT a.att_date, st.first_name||' '||st.last_name student, st.roll_no, c.name section_name, a.subject, a.status,
            count(*) OVER() _total
       FROM student_attendance a JOIN students st ON st.id=a.student_id LEFT JOIN sections c ON c.id=a.section_id
      WHERE a.institution_id=$1 ORDER BY a.att_date DESC, a.id DESC LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Timetable ----------
router.get('/timetable', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT tt.day_of_week, tt.time_slot, tt.subject, c.name section_name,
            t.first_name||' '||t.last_name teacher, count(*) OVER() _total
       FROM timetable tt JOIN sections c ON c.id=tt.section_id LEFT JOIN teachers t ON t.id=tt.teacher_id
      WHERE tt.institution_id=$1 ORDER BY c.id, tt.time_slot, tt.id LIMIT $2 OFFSET $3`,
    [institutionId(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------- Exams ----------
router.get('/exams', requirePermission('academics.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT e.exam_name, e.subject, e.exam_date, e.time_slot, e.total_marks, c.name section_name, count(*) OVER() _total
       FROM exam_schedule e LEFT JOIN sections c ON c.id=e.section_id
      WHERE e.institution_id=$1 ORDER BY e.exam_date, e.id LIMIT $2 OFFSET $3`,
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

router.post('/announcements', requirePermission('announcements.manage'), async (req, res) => {
  const { title, target_audience, description, end_date } = announcementBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO announcements (institution_id, title, target_audience, description, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [institutionId(req), title, target_audience, description, end_date]
  );
  res.status(201).json(rows[0]);
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
  const remaining = total - paid;
  const status = remaining <= 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Pending';
  const receipt = 'RCP-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const paidOn = todayIn(await institutionTimeZone(s));
  const { rows } = await db.query(
    `INSERT INTO tuition_fee (institution_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status, payment_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [s, receipt, student_id, total, paid, remaining, status, paidOn]
  );
  await auditAs(req, 'collect_fee', 'TuitionFee', receipt);
  res.status(201).json(rows[0]);
});

export default router;
