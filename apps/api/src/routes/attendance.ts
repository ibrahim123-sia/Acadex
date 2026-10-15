// Attendance: registers per day (schools) or per class (colleges), "all present" and offline
// saving, rotating QR self check-in, live-class joins, leave requests with approval that mark
// the register, staff attendance, and summaries with the threshold / exam eligibility.
// Mounted under /api.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  DEFAULT_ATTENDANCE_THRESHOLD,
  attendancePercent,
  id,
  institutionSettings,
  isoDate,
  leaveBody,
  leaveDecisionBody,
  qrCheckinBody,
  registerBody,
  registerQuery,
  staffAttendanceBody,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertCanViewStudent, guardianLink } from '../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { rosterSql } from '../lib/lms/access';
import { todayIn } from '../lib/locale';
import { notify } from '../lib/notify';
import { assertCampusAllowed, assertOpenDay, assertSectionWritable, calendarSettings, campusOfSection, campusesFor, holidayOn } from '../lib/structure';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';

const router = Router();

/** Who may take a section's register: its class teacher, its course teachers, or attendance managers. */
async function assertRegisterAccess(req: Request, sectionId: number, offeringId: number | null) {
  const s = institutionId(req);
  const { rows } = await db.query<{ campus_id: number | null; homeroom_teacher_id: number | null }>(
    `SELECT campus_id, homeroom_teacher_id FROM sections WHERE id = $1 AND institution_id = $2`,
    [sectionId, s]
  );
  const sec = rows[0];
  if (!sec) throw notFound('Section not found');
  if (offeringId) {
    const { rows: o } = await db.query(`SELECT 1 FROM course_offerings WHERE id = $1 AND institution_id = $2 AND section_id = $3`, [offeringId, s, sectionId]);
    if (!o[0]) throw badRequest('That course is not taught to this section', { offering_id: 'invalid' });
  }
  if (userCan(req, 'attendance.manage', { institutionId: s, campusId: sec.campus_id })) return sec;
  const u = currentUser(req);
  if (u.role !== 'teacher' || !userCan(req, 'attendance.mark')) throw forbidden();
  if (!offeringId && sec.homeroom_teacher_id === u.ref_id) return sec;
  const { rows: t } = await db.query(
    `SELECT 1 FROM section_staff WHERE teacher_id = $1 AND (offering_id = $2 OR ($2::int IS NULL AND section_id = $3)) LIMIT 1`,
    [u.ref_id, offeringId, sectionId]
  );
  if (!t[0]) throw forbidden('You do not teach this class');
  return sec;
}

/** Students a register covers: the section, or those taking the course. */
const registerRoster = (offeringId: number | null) =>
  offeringId
    ? `SELECT id FROM (${rosterSql('$2::int')}) r WHERE $1::int IS NOT NULL`
    : `SELECT id FROM students WHERE section_id = $1::int AND COALESCE(status, 'active') = 'active' AND $2::int IS NULL`;

router.get('/attendance/register', async (req, res) => {
  const q = registerQuery.parse(req.query);
  const s = institutionId(req);
  const sec = await assertRegisterAccess(req, q.section_id, q.offering_id);
  const date = q.date ?? todayIn(await institutionTimeZone(s));
  const { rows: session } = await db.query<{ id: number; qr_issued_at: Date | null; updated_at: Date; taken_by: number | null }>(
    `SELECT id, qr_issued_at, updated_at, taken_by FROM attendance_sessions
      WHERE section_id = $1 AND offering_id IS NOT DISTINCT FROM $2 AND date = $3 AND period_id IS NOT DISTINCT FROM $4`,
    [q.section_id, q.offering_id, date, q.period_id]
  );
  const { rows: students } = await db.query(
    `SELECT st.id, st.roll_no, st.first_name || ' ' || st.last_name AS name, st.photo_file_id,
            r.status, r.minutes_late, r.note, r.method,
            (SELECT lr.kind FROM leave_requests lr WHERE lr.student_id = st.id AND lr.status = 'approved' AND $3::date BETWEEN lr.from_date AND lr.to_date LIMIT 1) AS on_leave
       FROM students st LEFT JOIN attendance_records r ON r.session_id = $4 AND r.student_id = st.id
      WHERE st.id IN (${registerRoster(q.offering_id)}) ORDER BY st.roll_no NULLS LAST, st.first_name`,
    [q.section_id, q.offering_id, date, session[0]?.id ?? 0]
  );
  const holiday = await holidayOn(s, sec.campus_id, date);
  const { workingDays } = await calendarSettings(s);
  res.json({
    date,
    section_id: q.section_id,
    offering_id: q.offering_id,
    period_id: q.period_id,
    session: session[0] ?? null,
    holiday: holiday?.name ?? null,
    working_day: workingDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
    students,
  });
});

/** Save a whole register at once (works for "all present" and for a queue saved offline). */
router.put('/attendance/register', requireAny('attendance.mark', 'attendance.manage'), async (req, res) => {
  const b = registerBody.parse(req.body);
  const s = institutionId(req);
  const sec = await assertRegisterAccess(req, b.section_id, b.offering_id);
  await assertSectionWritable(b.section_id);
  await assertOpenDay(s, sec.campus_id, b.date, 'taking attendance');
  const tz = await institutionTimeZone(s);
  if (b.date > todayIn(tz)) throw badRequest('Attendance cannot be taken for a future day');
  if (b.period_id) {
    const { rows } = await db.query(`SELECT 1 FROM periods WHERE id = $1 AND institution_id = $2`, [b.period_id, s]);
    if (!rows[0]) throw badRequest('Unknown period', { period_id: 'invalid' });
  }
  const ids = b.records.map((r) => r.student_id);
  if (new Set(ids).size !== ids.length) throw badRequest('The same student appears more than once');
  const { rows: ok } = await db.query<{ id: number }>(`SELECT id FROM (${registerRoster(b.offering_id)}) x WHERE x.id = ANY($3::int[])`, [b.section_id, b.offering_id, ids]);
  const stray = ids.filter((x) => !ok.some((o) => o.id === x));
  if (stray.length) throw badRequest('Some students are not in this class', { student_ids: stray });
  const u = currentUser(req);
  const newlyAbsent = await withTransaction(async () => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO attendance_sessions (institution_id, section_id, offering_id, date, period_id, kind, taken_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT ON CONSTRAINT attendance_sessions_section_id_offering_id_date_period_id_key DO UPDATE SET taken_by = EXCLUDED.taken_by, updated_at = now()
       RETURNING id`,
      [s, b.section_id, b.offering_id, b.date, b.period_id, b.offering_id ? 'class' : 'day', u.id]
    );
    const sessionId = rows[0]!.id;
    const { rows: before } = await db.query<{ student_id: number; status: string }>(`SELECT student_id, status FROM attendance_records WHERE session_id = $1`, [sessionId]);
    await db.query(
      `INSERT INTO attendance_records (session_id, student_id, institution_id, status, minutes_late, note, method, marked_by, marked_at)
       SELECT $1, r.sid, $2, r.status, r.late, r.note, $3, $4, now() FROM unnest($5::int[], $6::text[], $7::int[], $8::text[]) AS r(sid, status, late, note)
       ON CONFLICT ON CONSTRAINT attendance_records_pkey DO UPDATE SET status = EXCLUDED.status, minutes_late = EXCLUDED.minutes_late, note = EXCLUDED.note,
         method = EXCLUDED.method, marked_by = EXCLUDED.marked_by, marked_at = now()`,
      [sessionId, s, b.offline ? 'offline' : 'manual', u.id, ids, b.records.map((r) => r.status), b.records.map((r) => (r.status === 'late' ? r.minutes_late : null)), b.records.map((r) => r.note)]
    );
    return b.records.filter((r) => r.status === 'absent' && before.find((x) => x.student_id === r.student_id)?.status !== 'absent').map((r) => r.student_id);
  });
  // tell guardians the same day (once per student and day)
  if (newlyAbsent.length && !b.offering_id) {
    const { rows } = await db.query<{ user_id: number; student_id: number; name: string }>(
      `SELECT DISTINCT g.user_id, st.id AS student_id, st.first_name AS name FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id
        WHERE gs.student_id = ANY($1::int[]) AND g.user_id IS NOT NULL`,
      [newlyAbsent]
    );
    for (const r of rows) {
      await notify({ institutionId: s, userIds: [r.user_id], type: 'attendance_alert', title: `${r.name} was marked absent today`, message: `Date: ${b.date}`, link: `/attendance/students/${r.student_id}`, dedupeKey: `absent:${r.student_id}:${b.date}` });
    }
  }
  res.json({ saved: b.records.length });
});

// ---------------------------------------------------------------- QR self check-in

const QR_WINDOW_S = 20;
const qrCode = (secret: string, window: number) => crypto.createHmac('sha256', secret).update(String(window)).digest('base64url').slice(0, 10);

/** Staff: show a QR code that changes every 20 seconds (a photo of it soon stops working). */
router.post('/attendance/sessions/:id/qr', requireAny('attendance.mark', 'attendance.manage'), async (req, res) => {
  const sessionId = id.parse(req.params.id);
  const { rows } = await db.query<{ section_id: number; offering_id: number | null; date: string; qr_secret: string | null }>(
    `SELECT section_id, offering_id, date, qr_secret FROM attendance_sessions WHERE id = $1 AND institution_id = $2`,
    [sessionId, institutionId(req)]
  );
  const sess = rows[0];
  if (!sess) throw notFound();
  await assertRegisterAccess(req, sess.section_id, sess.offering_id);
  if (sess.date !== todayIn(await institutionTimeZone(institutionId(req)))) throw conflict('QR check-in works only on the day of the class', 'NOT_TODAY');
  let secret = sess.qr_secret;
  if (!secret || req.query.reset === 'true') {
    secret = crypto.randomBytes(24).toString('base64url');
    await db.query(`UPDATE attendance_sessions SET qr_secret = $2, qr_issued_at = now() WHERE id = $1`, [sessionId, secret]);
  }
  const now = Math.floor(Date.now() / 1000);
  const w = Math.floor(now / QR_WINDOW_S);
  res.json({ session_id: sessionId, code: qrCode(secret, w), expires_in: (w + 1) * QR_WINDOW_S - now });
});

/** Students: check in by scanning the code on the board. */
router.post('/attendance/checkin', requirePermission('learner.access'), async (req, res) => {
  const b = qrCheckinBody.parse(req.body);
  const u = currentUser(req);
  const s = institutionId(req);
  const { rows } = await db.query<{ id: number; section_id: number; offering_id: number | null; date: string; qr_secret: string | null }>(
    `SELECT id, section_id, offering_id, date, qr_secret FROM attendance_sessions WHERE id = $1 AND institution_id = $2`,
    [b.session_id, s]
  );
  const sess = rows[0];
  const w = Math.floor(Date.now() / 1000 / QR_WINDOW_S);
  const valid = !!sess?.qr_secret && [w, w - 1].some((x) => crypto.timingSafeEqual(Buffer.from(qrCode(sess.qr_secret!, x)), Buffer.from(b.code.padEnd(10).slice(0, 10))));
  if (!sess || !valid || sess.date !== todayIn(await institutionTimeZone(s))) throw badRequest('This code has expired. Scan the code on the screen again.', { code: 'expired' });
  const { rows: mine } = await db.query(`SELECT 1 FROM (${registerRoster(sess.offering_id)}) x WHERE x.id = $3`, [sess.section_id, sess.offering_id, u.ref_id]);
  if (!mine[0]) throw forbidden('You are not in this class');
  await db.query(
    `INSERT INTO attendance_records (session_id, student_id, institution_id, status, method, marked_by) VALUES ($1,$2,$3,'present','qr',$4)
     ON CONFLICT ON CONSTRAINT attendance_records_pkey DO UPDATE SET status = 'present', method = 'qr', marked_at = now() WHERE attendance_records.status IN ('absent')`,
    [sess.id, u.ref_id, s, u.id]
  );
  res.json({ ok: true, status: 'present' });
});

// ---------------------------------------------------------------- summaries

async function thresholdOf(s: number) {
  const { rows } = await db.query<{ settings: unknown }>(`SELECT settings FROM institutions WHERE id = $1`, [s]);
  const p = institutionSettings.safeParse(rows[0]?.settings ?? {});
  return (p.success && p.data.attendance_threshold) || DEFAULT_ATTENDANCE_THRESHOLD;
}

router.get('/attendance/students/:id/summary', async (req, res) => {
  const sid = id.parse(req.params.id);
  await assertCanViewStudent(currentUser(req), sid, { allowTeachers: true });
  const s = institutionId(req);
  const q = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
  const { rows: yr } = await db.query<{ starts_on: string; ends_on: string }>(`SELECT starts_on, ends_on FROM academic_years WHERE institution_id = $1 AND is_current LIMIT 1`, [s]);
  const from = q.from ?? yr[0]?.starts_on ?? '1900-01-01';
  const to = q.to ?? yr[0]?.ends_on ?? '2999-12-31';
  const { rows: byCourse } = await db.query<{ offering_id: number | null; course: string | null; status: string; n: number }>(
    `SELECT s.offering_id, c.name AS course, r.status, count(*)::int n
       FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id
       LEFT JOIN course_offerings o ON o.id = s.offering_id LEFT JOIN courses c ON c.id = o.course_id
      WHERE r.student_id = $1 AND s.date BETWEEN $2 AND $3 GROUP BY s.offering_id, c.name, r.status`,
    [sid, from, to]
  );
  const threshold = await thresholdOf(s);
  const tally = (rows: typeof byCourse) => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + r.n }), {});
  const overall = tally(byCourse);
  const pct = attendancePercent(overall);
  const courses = [...new Set(byCourse.filter((r) => r.offering_id).map((r) => r.offering_id))].map((oid) => {
    const t = tally(byCourse.filter((r) => r.offering_id === oid));
    const p = attendancePercent(t);
    return { offering_id: oid, course: byCourse.find((r) => r.offering_id === oid)!.course, counts: t, percent: p, eligible: p == null || p >= threshold };
  });
  const { rows: recent } = await db.query(
    `SELECT s.date, s.kind, c.name AS course, r.status, r.minutes_late, r.method FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id
       LEFT JOIN course_offerings o ON o.id = s.offering_id LEFT JOIN courses c ON c.id = o.course_id
      WHERE r.student_id = $1 ORDER BY s.date DESC, s.id DESC LIMIT 30`,
    [sid]
  );
  res.json({ student_id: sid, from, to, threshold, counts: overall, percent: pct, eligible: pct == null || pct >= threshold, courses, recent });
});

/** A section's register over a period: students × dates, with each student's percentage. */
router.get('/attendance/report', async (req, res) => {
  const q = z.object({ section_id: id, offering_id: z.coerce.number().int().positive().optional(), from: isoDate, to: isoDate }).parse(req.query);
  await assertRegisterAccess(req, q.section_id, q.offering_id ?? null);
  const { rows: sessions } = await db.query<{ id: number; date: string; period_id: number | null }>(
    `SELECT id, date, period_id FROM attendance_sessions WHERE section_id = $1 AND offering_id IS NOT DISTINCT FROM $2 AND date BETWEEN $3 AND $4 ORDER BY date, period_id NULLS FIRST`,
    [q.section_id, q.offering_id ?? null, q.from, q.to]
  );
  const { rows: records } = await db.query<{ session_id: number; student_id: number; status: string }>(
    `SELECT session_id, student_id, status FROM attendance_records WHERE session_id = ANY($1::int[])`,
    [sessions.map((x) => x.id)]
  );
  const { rows: students } = await db.query<{ id: number; name: string; roll_no: string | null }>(
    `SELECT st.id, st.first_name || ' ' || st.last_name AS name, st.roll_no FROM students st WHERE st.id IN (${registerRoster(q.offering_id ?? null)}) ORDER BY st.roll_no NULLS LAST, st.first_name`,
    [q.section_id, q.offering_id ?? null]
  );
  const threshold = await thresholdOf(institutionId(req));
  res.json({
    threshold,
    sessions,
    students: students.map((st) => {
      const mine = records.filter((r) => r.student_id === st.id);
      const counts = mine.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
      const pct = attendancePercent(counts);
      return { ...st, marks: Object.fromEntries(mine.map((r) => [r.session_id, r.status])), counts, percent: pct, below: pct != null && pct < threshold };
    }),
  });
});

// ---------------------------------------------------------------- leave

const datesBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

router.get('/leave', async (req, res) => {
  const u = currentUser(req);
  const s = institutionId(req);
  const status = z.enum(['pending', 'approved', 'rejected', 'cancelled', 'all']).default('all').parse(req.query.status ?? 'all');
  const toApprove = req.query.scope === 'approve';
  const params: unknown[] = [s, status];
  let who: string;
  if (toApprove) {
    if (userCan(req, 'leave.approve')) who = 'TRUE';
    else if (u.role === 'teacher') {
      params.push(u.ref_id);
      who = `lr.student_id IN (SELECT st.id FROM students st JOIN sections sec ON sec.id = st.section_id WHERE sec.homeroom_teacher_id = $3)`;
    } else throw forbidden();
  } else {
    params.push(u.id);
    who = `lr.requested_by = $3 OR lr.student_id = ${u.role === 'student' ? Number(u.ref_id) : 0} OR lr.teacher_id = ${u.role === 'teacher' ? Number(u.ref_id) : 0}`;
  }
  const { rows } = await db.query(
    `SELECT lr.*, COALESCE(st.first_name || ' ' || st.last_name, t.first_name || ' ' || t.last_name) AS person, ru.full_name AS requested_by_name, du.full_name AS decided_by_name
       FROM leave_requests lr LEFT JOIN students st ON st.id = lr.student_id LEFT JOIN teachers t ON t.id = lr.teacher_id
       LEFT JOIN users ru ON ru.id = lr.requested_by LEFT JOIN users du ON du.id = lr.decided_by
      WHERE lr.institution_id = $1 AND ($2 = 'all' OR lr.status = $2) AND (${who}) ORDER BY lr.created_at DESC LIMIT 200`,
    params
  );
  res.json(rows);
});

router.post('/leave', requirePermission('leave.request'), async (req, res) => {
  const b = leaveBody.parse(req.body);
  const u = currentUser(req);
  const s = institutionId(req);
  let studentId: number | null = null;
  let teacherId: number | null = null;
  if (u.role === 'student') studentId = u.ref_id;
  else if (u.role === 'parent') {
    if (!b.student_id) throw badRequest('Choose your child', { student_id: 'required' });
    if (!(await guardianLink(u.id, b.student_id, s))) throw forbidden('This student is not linked to you');
    studentId = b.student_id;
  } else if (u.role === 'teacher') teacherId = u.ref_id;
  else throw forbidden();
  const { rows: overlap } = await db.query(
    `SELECT 1 FROM leave_requests WHERE institution_id = $1 AND status IN ('pending', 'approved') AND student_id IS NOT DISTINCT FROM $2 AND teacher_id IS NOT DISTINCT FROM $3
        AND from_date <= $5 AND to_date >= $4`,
    [s, studentId, teacherId, b.from_date, b.to_date]
  );
  if (overlap[0]) throw conflict('There is already a leave request for some of these days', 'OVERLAP');
  const { rows } = await db.query(
    `INSERT INTO leave_requests (institution_id, student_id, teacher_id, from_date, to_date, kind, reason, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [s, studentId, teacherId, b.from_date, b.to_date, b.kind, b.reason, u.id]
  );
  // the approvers hear about it
  const { rows: approvers } = await db.query<{ id: number }>(
    studentId
      ? `SELECT u.id FROM users u JOIN sections sec ON sec.homeroom_teacher_id = u.ref_id AND u.role = 'teacher' JOIN students st ON st.section_id = sec.id WHERE st.id = $1 AND u.is_active`
      : `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE rp.permission = 'leave.approve' AND u.institution_id = $2 AND u.is_active AND $1::int IS NULL`,
    studentId ? [studentId] : [null, s]
  );
  await notify({ institutionId: s, userIds: approvers.map((a) => a.id), type: 'leave_decision', title: `Leave request from ${u.name}`, message: `${b.from_date} to ${b.to_date}: ${b.reason}`.slice(0, 300), link: '/attendance/leave?scope=approve' });
  res.status(201).json(rows[0]);
});

router.post('/leave/:id/decision', async (req, res) => {
  const leaveId = id.parse(req.params.id);
  const s = institutionId(req);
  const u = currentUser(req);
  const b = leaveDecisionBody.parse(req.body);
  const { rows } = await db.query<{ id: number; student_id: number | null; teacher_id: number | null; from_date: string; to_date: string; status: string; requested_by: number | null; kind: string }>(
    `SELECT id, student_id, teacher_id, from_date, to_date, status, requested_by, kind FROM leave_requests WHERE id = $1 AND institution_id = $2`,
    [leaveId, s]
  );
  const lr = rows[0];
  if (!lr) throw notFound();
  if (!userCan(req, 'leave.approve')) {
    const { rows: hr } = lr.student_id
      ? await db.query(`SELECT 1 FROM students st JOIN sections sec ON sec.id = st.section_id WHERE st.id = $1 AND sec.homeroom_teacher_id = $2 AND $3 = 'teacher'`, [lr.student_id, u.ref_id, u.role])
      : { rows: [] };
    if (!hr[0]) throw forbidden('You cannot decide this request');
  }
  if (lr.status !== 'pending') throw conflict('This request has already been decided', 'DECIDED');
  await withTransaction(async () => {
    await db.query(`UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [leaveId, b.status, u.id, b.note]);
    if (b.status !== 'approved') return;
    if (lr.student_id) {
      // registers already taken for those days show the leave instead of an absence
      await db.query(
        `UPDATE attendance_records r SET status = 'leave', method = 'leave', marked_at = now() FROM attendance_sessions sn
          WHERE sn.id = r.session_id AND r.student_id = $1 AND sn.date BETWEEN $2 AND $3 AND r.status = 'absent'`,
        [lr.student_id, lr.from_date, lr.to_date]
      );
    } else if (lr.teacher_id) {
      const { workingDays } = await calendarSettings(s);
      const days = datesBetween(lr.from_date, lr.to_date).filter((d) => workingDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
      await db.query(
        `INSERT INTO teacher_attendance (institution_id, teacher_id, att_date, status) SELECT $1, $2, d::date, 'Leave' FROM unnest($3::text[]) d
         ON CONFLICT ON CONSTRAINT teacher_attendance_teacher_id_att_date_key DO UPDATE SET status = 'Leave'`,
        [s, lr.teacher_id, days]
      );
    }
  });
  if (lr.requested_by) await notify({ institutionId: s, userIds: [lr.requested_by], type: 'leave_decision', title: `Leave ${b.status}`, message: `${lr.from_date} to ${lr.to_date}${b.note ? ` — ${b.note}` : ''}`, link: '/attendance/leave' });
  res.json({ ok: true, status: b.status });
});

router.post('/leave/:id/cancel', async (req, res) => {
  const leaveId = id.parse(req.params.id);
  const { rowCount } = await db.query(
    `UPDATE leave_requests SET status = 'cancelled' WHERE id = $1 AND institution_id = $2 AND requested_by = $3 AND status = 'pending'`,
    [leaveId, institutionId(req), currentUser(req).id]
  );
  if (!rowCount) throw notFound('No pending request of yours with this id');
  res.json({ ok: true });
});

/** Approved leave marks registers taken later too (the register prefill shows it). */

// ---------------------------------------------------------------- staff attendance

router.get('/attendance/staff', requirePermission('attendance.manage'), async (req, res) => {
  const s = institutionId(req);
  const date = req.query.date ? isoDate.parse(req.query.date) : todayIn(await institutionTimeZone(s));
  const scope = campusesFor(req, 'attendance.manage');
  const { rows } = await db.query(
    `SELECT t.id, t.first_name || ' ' || t.last_name AS name, t.designation, t.campus_id, a.status
       FROM teachers t LEFT JOIN teacher_attendance a ON a.teacher_id = t.id AND a.att_date = $2
      WHERE t.institution_id = $1 AND COALESCE(t.status, 'active') <> 'left' AND ($3::int[] IS NULL OR t.campus_id = ANY($3::int[]))
      ORDER BY t.first_name, t.last_name`,
    [s, date, scope]
  );
  res.json({ date, staff: rows });
});

router.put('/attendance/staff', requirePermission('attendance.manage'), async (req, res) => {
  const b = staffAttendanceBody.parse(req.body);
  const s = institutionId(req);
  const ids = b.records.map((r) => r.teacher_id);
  const { rows } = await db.query<{ id: number; campus_id: number | null }>(`SELECT id, campus_id FROM teachers WHERE id = ANY($1::int[]) AND institution_id = $2`, [ids, s]);
  if (rows.length !== new Set(ids).size) throw badRequest('Some staff members are not in this institution');
  const scope = campusesFor(req, 'attendance.manage');
  for (const r of rows) assertCampusAllowed(scope, r.campus_id);
  await db.query(
    `INSERT INTO teacher_attendance (institution_id, teacher_id, att_date, status) SELECT $1, t, $2, st FROM unnest($3::int[], $4::text[]) AS x(t, st)
     ON CONFLICT ON CONSTRAINT teacher_attendance_teacher_id_att_date_key DO UPDATE SET status = EXCLUDED.status`,
    [s, b.date, ids, b.records.map((r) => r.status)]
  );
  res.json({ saved: ids.length });
});

export { campusOfSection };
export default router;
