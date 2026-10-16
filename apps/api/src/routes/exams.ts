// The exams office under /api/exams: exam series and their date sheet (with a generator and
// clash checks), seating plans, invigilation duties, admit cards with eligibility (attendance,
// fees), marks entry by the paper's teacher, the approval chain teacher → head of department
// → exam controller with moderation, publishing into the gradebook, results, merit lists,
// result cards and transcripts.
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  DEFAULT_ATTENDANCE_THRESHOLD,
  attendancePercent,
  autoDutiesBody,
  dutyBody,
  examSeriesBody,
  examSessionBody,
  examTimetableBody,
  gpa,
  id,
  marksEntryBody,
  meritQuery,
  moderationBody,
  overrideAdmitBody,
  patchSchema,
  returnMarksBody,
  seatingBody,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertCanViewStudent, assertInInstitution } from '../lib/access';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { sendTable } from '../lib/export';
import { sendAdmitCard, sendResultCard, sendSeatingChart, sendTranscript, type TranscriptTerm } from '../lib/exams/pdf';
import { computeResults, loadSeries, rank, seriesRoster, verifyCode, type StudentResult } from '../lib/exams/results';
import { courseResults, schemeForStudent } from '../lib/grading';
import { institutionTimeZone } from '../lib/institution';
import { courseAccess, guardianUserIds, rosterSql } from '../lib/lms/access';
import { todayIn } from '../lib/locale';
import { notify } from '../lib/notify';
import { calendarSettings } from '../lib/structure';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';

const router = Router();
const office = requirePermission('exams.manage');
const readOffice = requireAny('exams.manage', 'exams.moderate', 'exams.publish', 'academics.read');

const auditAs = (req: Request, action: string, entity: string, detail: string) =>
  audit({ institutionId: institutionId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity, detail });

interface SessionRow {
  id: number;
  institution_id: number;
  series_id: number;
  offering_id: number;
  assessment_id: number | null;
  date: string;
  starts_at: string;
  ends_at: string;
  total_marks: string;
  pass_marks: string;
  status: string;
  course: string;
  department_id: number | null;
  head_teacher_id: number | null;
  series_status: string;
  series_name: string;
}

async function loadSession(sessionId: number, inst: number, lock = false): Promise<SessionRow> {
  const { rows } = await db.query<SessionRow>(
    `SELECT s.*, co.name AS course, co.department_id, d.head_teacher_id, x.status AS series_status, x.name AS series_name
       FROM exam_sessions s JOIN exam_series x ON x.id = s.series_id JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
       LEFT JOIN departments d ON d.id = co.department_id
      WHERE s.id = $1 AND s.institution_id = $2 ${lock ? 'FOR UPDATE OF s' : ''}`,
    [sessionId, inst]
  );
  if (!rows[0]) throw notFound('Paper not found');
  return rows[0];
}

/** The paper's own teacher (who can edit the course), or the exams office. */
async function canEnterMarks(req: Request, s: SessionRow) {
  if (userCan(req, 'exams.manage')) return true;
  const a = await courseAccess(currentUser(req), s.offering_id);
  return a.role === 'staff' && a.canEdit;
}
const isHod = (req: Request, s: SessionRow) => (currentUser(req).role === 'teacher' && s.head_teacher_id != null && currentUser(req).ref_id === s.head_teacher_id) || userCan(req, 'exams.moderate');

async function log(s: SessionRow, req: Request, action: string, to: string, note = '', change: unknown = null) {
  await db.query(`INSERT INTO exam_moderations (institution_id, session_id, action, from_status, to_status, change, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    s.institution_id, s.id, action, s.status, to, change ? JSON.stringify(change) : null, note, currentUser(req).id,
  ]);
  await db.query(`UPDATE exam_sessions SET status = $2 WHERE id = $1`, [s.id, to]);
}

// ---------------------------------------------------------------- series

router.get('/exams/series', readOffice, async (req, res) => {
  const { rows } = await db.query(
    `SELECT x.*, t.name AS term, (SELECT count(*)::int FROM exam_sessions s WHERE s.series_id = x.id) AS papers,
            (SELECT count(*)::int FROM exam_sessions s WHERE s.series_id = x.id AND s.status = 'approved') AS approved,
            (SELECT min(date) FROM exam_sessions s WHERE s.series_id = x.id) AS starts_on, (SELECT max(date) FROM exam_sessions s WHERE s.series_id = x.id) AS ends_on
       FROM exam_series x LEFT JOIN terms t ON t.id = x.term_id WHERE x.institution_id = $1 ORDER BY x.created_at DESC`,
    [institutionId(req)]
  );
  res.json(rows);
});

router.post('/exams/series', office, async (req, res) => {
  const b = examSeriesBody.parse(req.body);
  if (b.term_id) await assertInInstitution('terms', b.term_id, institutionId(req));
  const { rows } = await db.query(
    `INSERT INTO exam_series (institution_id, term_id, name, kind, result_style, eligibility, instructions, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [institutionId(req), b.term_id, b.name, b.kind, b.result_style, JSON.stringify(b.eligibility), b.instructions, currentUser(req).id]
  );
  await auditAs(req, 'create', 'ExamSeries', b.name);
  res.status(201).json(rows[0]);
});

router.patch('/exams/series/:id', office, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const b = patchSchema(examSeriesBody.shape).extend({ status: z.enum(['planning', 'scheduled', 'in_progress', 'marking']).optional() }).parse(req.body);
  if (series.status === 'published' && Object.keys(b).some((k) => k !== 'instructions')) throw conflict('Results are published; withdraw them first', 'PUBLISHED');
  if (b.term_id) await assertInInstitution('terms', b.term_id, institutionId(req));
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to change');
  const params: unknown[] = [series.id];
  const sets = entries.map(([k, v]) => {
    params.push(k === 'eligibility' ? JSON.stringify(v) : v);
    return `${k} = $${params.length}`;
  });
  const { rows } = await db.query(`UPDATE exam_series SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  res.json(rows[0]);
});

router.delete('/exams/series/:id', office, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const { rows } = await db.query(`SELECT count(*)::int n FROM exam_marks m JOIN exam_sessions s ON s.id = m.session_id WHERE s.series_id = $1`, [series.id]);
  if (rows[0].n || series.status === 'published') throw conflict('Marks have been entered for this series', 'IN_USE');
  await db.query(`DELETE FROM exam_series WHERE id = $1`, [series.id]);
  await auditAs(req, 'delete', 'ExamSeries', series.name);
  res.status(204).end();
});

router.get('/exams/series/:id', readOffice, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const { rows } = await db.query(
    `SELECT s.*, co.name AS course, co.code, sec.name AS section_name, o.section_id,
            (SELECT count(*)::int FROM exam_marks m WHERE m.session_id = s.id) AS marks_entered,
            (SELECT count(*)::int FROM (${rosterSql('s.offering_id')}) r) AS candidates,
            (SELECT count(*)::int FROM exam_seats e WHERE e.session_id = s.id) AS seated,
            (SELECT count(*)::int FROM invigilator_duties d WHERE d.session_id = s.id) AS invigilators
       FROM exam_sessions s JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
      WHERE s.series_id = $1 ORDER BY s.date, s.starts_at, sec.name, co.name`,
    [series.id]
  );
  res.json({ ...series, sessions: rows });
});

// ---------------------------------------------------------------- papers (date sheet)

/** Papers of the same section, or with a shared student, may not overlap. */
async function assertNoClash(inst: number, offeringId: number, date: string, startsAt: string, endsAt: string, exceptId: number | null) {
  const { rows } = await db.query<{ course: string; date: string }>(
    `SELECT co.name AS course, s.date FROM exam_sessions s JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
      WHERE s.institution_id = $1 AND s.date = $3 AND s.starts_at < $5::time AND s.ends_at > $4::time AND ($6::int IS NULL OR s.id <> $6) AND s.offering_id <> $2
        AND EXISTS (SELECT 1 FROM (${rosterSql('s.offering_id')}) a JOIN (${rosterSql('$2')}) b ON a.id = b.id)
      LIMIT 1`,
    [inst, offeringId, date, startsAt, endsAt, exceptId]
  );
  if (rows[0]) throw conflict(`Clashes with ${rows[0].course} on ${date} for some students`, 'CLASH');
}

router.post('/exams/series/:id/sessions', office, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  if (series.status === 'published') throw conflict('Results are published', 'PUBLISHED');
  const b = examSessionBody.parse(req.body);
  await assertInInstitution('course_offerings', b.offering_id, institutionId(req));
  await assertNoClash(institutionId(req), b.offering_id, b.date, b.starts_at, b.ends_at, null);
  try {
    const { rows } = await db.query(
      `INSERT INTO exam_sessions (institution_id, series_id, offering_id, date, starts_at, ends_at, total_marks, pass_marks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [institutionId(req), series.id, b.offering_id, b.date, b.starts_at, b.ends_at, b.total_marks, b.pass_marks]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('This course already has a paper in this series', 'DUPLICATE');
    throw e;
  }
});

router.patch('/exams/sessions/:id', office, async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req));
  if (s.series_status === 'published') throw conflict('Results are published', 'PUBLISHED');
  const b = z.object({ date: z.string().optional(), starts_at: z.string().optional(), ends_at: z.string().optional(), total_marks: z.coerce.number().optional(), pass_marks: z.coerce.number().optional() }).parse(req.body);
  const next = examSessionBody.parse({
    offering_id: s.offering_id,
    date: b.date ?? s.date,
    starts_at: b.starts_at ?? s.starts_at.slice(0, 5),
    ends_at: b.ends_at ?? s.ends_at.slice(0, 5),
    total_marks: b.total_marks ?? Number(s.total_marks),
    pass_marks: b.pass_marks ?? Number(s.pass_marks),
  });
  if (b.total_marks !== undefined && s.status !== 'scheduled') {
    const { rows } = await db.query(`SELECT max(marks) AS m FROM exam_marks WHERE session_id = $1`, [s.id]);
    if (rows[0].m != null && Number(rows[0].m) > next.total_marks) throw badRequest('Some marks are above the new total');
  }
  await assertNoClash(institutionId(req), s.offering_id, next.date, next.starts_at, next.ends_at, s.id);
  const { rows } = await db.query(`UPDATE exam_sessions SET date = $2, starts_at = $3, ends_at = $4, total_marks = $5, pass_marks = $6 WHERE id = $1 RETURNING *`, [
    s.id, next.date, next.starts_at, next.ends_at, next.total_marks, next.pass_marks,
  ]);
  res.json(rows[0]);
});

router.delete('/exams/sessions/:id', office, async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req));
  const { rows } = await db.query(`SELECT count(*)::int n FROM exam_marks WHERE session_id = $1`, [s.id]);
  if (rows[0].n) throw conflict('Marks have been entered for this paper', 'IN_USE');
  await db.query(`DELETE FROM exam_sessions WHERE id = $1`, [s.id]);
  res.status(204).end();
});

/**
 * Lay out a date sheet for whole classes: one paper a day per class, a course shared by
 * several classes on the same day and time, skipping days off and holidays.
 */
router.post('/exams/series/:id/timetable', office, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const b = examTimetableBody.parse(req.body);
  const inst = institutionId(req);
  if (b.slots.some((s) => s.ends_at <= s.starts_at)) throw badRequest('Each slot must end after it starts');
  const { rows: offerings } = await db.query<{ id: number; section_id: number; course_id: number; course: string; code: string | null; campus_id: number | null }>(
    `SELECT o.id, o.section_id, o.course_id, co.name AS course, co.code, sec.campus_id FROM course_offerings o JOIN courses co ON co.id = o.course_id JOIN sections sec ON sec.id = o.section_id
      WHERE o.institution_id = $1 AND o.section_id = ANY($2::int[]) AND ($3::int IS NULL OR o.term_id = $3)
        AND NOT EXISTS (SELECT 1 FROM exam_sessions s WHERE s.series_id = $4 AND s.offering_id = o.id)
      ORDER BY co.code NULLS LAST, co.name`,
    [inst, b.section_ids, series.term_id, series.id]
  );
  if (!offerings.length) throw badRequest('No courses left to schedule for these classes');
  const { workingDays } = await calendarSettings(inst);
  const { rows: holidays } = await db.query<{ starts_on: string; ends_on: string }>(
    `SELECT starts_on::text, ends_on::text FROM holidays WHERE institution_id = $1 AND ends_on >= $2::date AND kind IN ('holiday', 'break') AND campus_id IS NULL`,
    [inst, b.from]
  );
  const open = (d: string) => {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    return workingDays.includes(wd) && !b.days_off.includes(wd) && !holidays.some((h) => d >= h.starts_on && d <= h.ends_on);
  };
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let d = b.from; days.length < 120; d = addDays(d, 1)) if (open(d)) days.push(d);
  const courses = [...new Map(offerings.map((o) => [o.course_id, o])).values()];
  const busy = new Map<number, number[]>(); // section → day indexes taken
  const plan: { offering_id: number; section_id: number; course: string; date: string; starts_at: string; ends_at: string }[] = [];
  const slotUse = new Map<string, number>();
  for (const c of courses) {
    const group = offerings.filter((o) => o.course_id === c.course_id);
    let placed = false;
    for (let di = 0; di < days.length && !placed; di++) {
      const ok = group.every((o) => (busy.get(o.section_id) ?? []).every((x) => Math.abs(x - di) > b.gap_days));
      if (!ok) continue;
      // spread across the day's slots
      const slot = b.slots[(slotUse.get(days[di]!) ?? 0) % b.slots.length]!;
      slotUse.set(days[di]!, (slotUse.get(days[di]!) ?? 0) + 1);
      for (const o of group) {
        busy.set(o.section_id, [...(busy.get(o.section_id) ?? []), di]);
        plan.push({ offering_id: o.id, section_id: o.section_id, course: o.course, date: days[di]!, starts_at: slot.starts_at, ends_at: slot.ends_at });
      }
      placed = true;
    }
    if (!placed) throw badRequest('Not enough days to fit every paper; start earlier or allow more slots');
  }
  if (!b.commit) return void res.json({ papers: plan.length, plan });
  await withTransaction(async () => {
    for (const p of plan) {
      await db.query(`INSERT INTO exam_sessions (institution_id, series_id, offering_id, date, starts_at, ends_at, total_marks, pass_marks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        inst, series.id, p.offering_id, p.date, p.starts_at, p.ends_at, b.total_marks, b.pass_marks,
      ]);
    }
    if (series.status === 'planning') await db.query(`UPDATE exam_series SET status = 'scheduled' WHERE id = $1`, [series.id]);
  });
  await auditAs(req, 'date_sheet', 'ExamSeries', `${series.name}: ${plan.length} papers`);
  res.status(201).json({ papers: plan.length, plan });
});

// ---------------------------------------------------------------- seating and invigilation

/** Seat everyone sitting papers on a date, interleaving papers so neighbours write different ones. */
router.post('/exams/series/:id/seating', office, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const b = seatingBody.parse(req.body);
  const inst = institutionId(req);
  const { rows: rooms } = await db.query<{ id: number; code: string; capacity: number | null }>(`SELECT id, code, capacity FROM rooms WHERE institution_id = $1 AND id = ANY($2::int[])`, [inst, b.room_ids]);
  if (rooms.length !== new Set(b.room_ids).size) throw badRequest('Some rooms are not in this institution');
  const ordered = b.room_ids.map((rid) => rooms.find((r) => r.id === rid)!);
  const { rows: sessions } = await db.query<{ id: number; starts_at: string }>(`SELECT id, starts_at FROM exam_sessions WHERE series_id = $1 AND date = $2 ORDER BY starts_at, id`, [series.id, b.date]);
  if (!sessions.length) throw badRequest('No papers on that date');
  const roster = (await seriesRoster(series.id)).filter((r) => sessions.some((s) => s.id === r.session_id));
  // one seating per sitting time (papers at the same time share the rooms)
  const sittings = [...new Set(sessions.map((s) => s.starts_at))];
  const seats: [number, number, number, number, number][] = [];
  for (const time of sittings) {
    const queues = sessions.filter((s) => s.starts_at === time).map((s) => roster.filter((r) => r.session_id === s.id).map((r) => r.student_id));
    const mixed: { session: number; student: number }[] = [];
    const sids = sessions.filter((s) => s.starts_at === time).map((s) => s.id);
    for (let i = 0; queues.some((q) => q.length); i = (i + 1) % queues.length) {
      const s = queues[i]!.shift();
      if (s !== undefined) mixed.push({ session: sids[i]!, student: s });
    }
    const capacity = ordered.reduce((n, r) => n + (r.capacity ?? 30), 0);
    if (mixed.length > capacity) throw badRequest(`${mixed.length} candidates at ${time.slice(0, 5)} but the rooms seat ${capacity}`);
    let k = 0;
    for (const room of ordered) {
      for (let seat = 1; seat <= (room.capacity ?? 30) && k < mixed.length; seat++, k++) seats.push([inst, mixed[k]!.session, mixed[k]!.student, room.id, seat]);
    }
  }
  await withTransaction(async () => {
    await db.query(`DELETE FROM exam_seats WHERE session_id = ANY($1::int[])`, [sessions.map((s) => s.id)]);
    for (let i = 0; i < seats.length; i += 500) {
      const chunk = seats.slice(i, i + 500);
      const params: unknown[] = [];
      const values = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(',')})`).join(',');
      await db.query(`INSERT INTO exam_seats (institution_id, session_id, student_id, room_id, seat_no) VALUES ${values}`, params);
    }
  });
  res.status(201).json({ seated: seats.length, rooms: ordered.length });
});

async function seatingFor(seriesId: number, date: string) {
  const { rows } = await db.query<{ room: string; room_id: number; seat_no: number; name: string; roll_no: string | null; course: string; starts_at: string }>(
    `SELECT r.code AS room, r.id AS room_id, e.seat_no, st.first_name || ' ' || st.last_name AS name, st.roll_no, co.name AS course, s.starts_at
       FROM exam_seats e JOIN exam_sessions s ON s.id = e.session_id JOIN rooms r ON r.id = e.room_id JOIN students st ON st.id = e.student_id
       JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
      WHERE s.series_id = $1 AND s.date = $2 ORDER BY s.starts_at, r.code, e.seat_no`,
    [seriesId, date]
  );
  return rows;
}

router.get('/exams/series/:id/seating', readOffice, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
  res.json(await seatingFor(series.id, date));
});

router.get('/exams/series/:id/seating.pdf', readOffice, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
  const rows = await seatingFor(series.id, date);
  const rooms = [...new Set(rows.map((r) => `${r.starts_at}|${r.room}`))].map((k) => ({
    room: `${k.split('|')[1]} (${k.split('|')[0]!.slice(0, 5)})`,
    seats: rows.filter((r) => `${r.starts_at}|${r.room}` === k),
  }));
  await sendSeatingChart(res, institutionId(req), `Seating plan — ${series.name} — ${date}`, rooms);
});

async function assertFreeForDuty(inst: number, teacherId: number, sessionId: number) {
  const { rows } = await db.query(
    `SELECT co.name FROM invigilator_duties d JOIN exam_sessions s ON s.id = d.session_id JOIN exam_sessions me ON me.id = $3
       JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
      WHERE d.institution_id = $1 AND d.teacher_id = $2 AND s.date = me.date AND s.starts_at < me.ends_at AND s.ends_at > me.starts_at AND s.id <> me.id LIMIT 1`,
    [inst, teacherId, sessionId]
  );
  if (rows[0]) throw conflict(`Already invigilating ${rows[0].name} at that time`, 'CLASH');
}

router.get('/exams/series/:id/duties', readOffice, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const { rows } = await db.query(
    `SELECT d.id, d.session_id, d.role, r.code AS room, r.id AS room_id, t.id AS teacher_id, t.first_name || ' ' || t.last_name AS teacher, s.date, s.starts_at, s.ends_at, co.name AS course
       FROM invigilator_duties d JOIN exam_sessions s ON s.id = d.session_id JOIN rooms r ON r.id = d.room_id JOIN teachers t ON t.id = d.teacher_id
       JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
      WHERE s.series_id = $1 ORDER BY s.date, s.starts_at, r.code`,
    [series.id]
  );
  res.json(rows);
});

router.post('/exams/sessions/:id/duties', office, async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req));
  const b = dutyBody.parse(req.body);
  await assertInInstitution('rooms', b.room_id, institutionId(req));
  await assertInInstitution('teachers', b.teacher_id, institutionId(req));
  await assertFreeForDuty(institutionId(req), b.teacher_id, s.id);
  try {
    const { rows } = await db.query(`INSERT INTO invigilator_duties (institution_id, session_id, room_id, teacher_id, role) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [
      institutionId(req), s.id, b.room_id, b.teacher_id, b.role,
    ]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('Already on duty for this paper', 'DUPLICATE');
    throw e;
  }
});

router.delete('/exams/duties/:id', office, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM invigilator_duties WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

/** Fill every seated room on a date with invigilators: fewest duties first, never their own subject. */
router.post('/exams/series/:id/duties/auto', office, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const b = autoDutiesBody.parse(req.body);
  const inst = institutionId(req);
  const { rows: rooms } = await db.query<{ room_id: number; starts_at: string; ends_at: string; n: number; session_id: number; have: number }>(
    `SELECT e.room_id, s.starts_at, s.ends_at, count(*)::int n, min(s.id) AS session_id,
            (SELECT count(*)::int FROM invigilator_duties d JOIN exam_sessions s2 ON s2.id = d.session_id WHERE d.room_id = e.room_id AND s2.date = s.date AND s2.starts_at = s.starts_at) AS have
       FROM exam_seats e JOIN exam_sessions s ON s.id = e.session_id WHERE s.series_id = $1 AND s.date = $2 GROUP BY e.room_id, s.starts_at, s.ends_at, s.date ORDER BY s.starts_at, e.room_id`,
    [series.id, b.date]
  );
  if (!rooms.length) throw badRequest('Make the seating plan for that date first');
  const { rows: teachers } = await db.query<{ id: number; duties: number }>(
    `SELECT t.id, (SELECT count(*)::int FROM invigilator_duties d JOIN exam_sessions s ON s.id = d.session_id WHERE d.teacher_id = t.id AND s.series_id = $2) AS duties
       FROM teachers t WHERE t.institution_id = $1 AND t.status = 'active' AND COALESCE(t.staff_type, 'teaching') = 'teaching' ORDER BY duties, t.id`,
    [inst, series.id]
  );
  let made = 0;
  const short: string[] = [];
  for (const r of rooms) {
    const need = Math.max(1, Math.ceil(r.n / b.per_students)) - r.have;
    for (let k = 0; k < need; k++) {
      // not teaching a paper being written at this time, not already on duty then
      const { rows: excluded } = await db.query<{ teacher_id: number }>(
        `SELECT ss.teacher_id FROM section_staff ss JOIN exam_sessions s ON s.offering_id = ss.offering_id WHERE s.series_id = $1 AND s.date = $2 AND s.starts_at < $4::time AND s.ends_at > $3::time
         UNION SELECT d.teacher_id FROM invigilator_duties d JOIN exam_sessions s ON s.id = d.session_id WHERE s.date = $2 AND s.starts_at < $4::time AND s.ends_at > $3::time AND s.institution_id = $5`,
        [series.id, b.date, r.starts_at, r.ends_at, inst]
      );
      const t = teachers.sort((x, y) => x.duties - y.duties).find((x) => !excluded.some((e) => e.teacher_id === x.id));
      if (!t) {
        short.push(`room ${r.room_id} at ${r.starts_at.slice(0, 5)}`);
        break;
      }
      await db.query(`INSERT INTO invigilator_duties (institution_id, session_id, room_id, teacher_id, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [
        inst, r.session_id, r.room_id, t.id, r.have + k === 0 ? 'chief' : 'invigilator',
      ]);
      t.duties++;
      made++;
    }
  }
  res.status(201).json({ assigned: made, short });
});

// ---------------------------------------------------------------- admit cards

/** Work out who may sit (attendance threshold, overdue fees) and issue the cards. */
router.post('/exams/series/:id/admit-cards', office, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const inst = institutionId(req);
  const students = [...new Set((await seriesRoster(series.id)).map((r) => r.student_id))];
  if (!students.length) throw badRequest('Add papers first');
  const { rows: settings } = await db.query<{ t: string | null }>(`SELECT settings->>'attendance_threshold' AS t FROM institutions WHERE id = $1`, [inst]);
  const threshold = settings[0]?.t ? Number(settings[0].t) : DEFAULT_ATTENDANCE_THRESHOLD;
  const { rows: att } = await db.query<{ student_id: number; status: string; c: number }>(
    `SELECT r.student_id, r.status, count(*)::int c FROM attendance_records r WHERE r.student_id = ANY($1::int[]) GROUP BY 1, 2`,
    [students]
  );
  const { rows: dues } = await db.query<{ student_id: number; due: string }>(
    `SELECT student_id, sum(total - paid) AS due FROM invoices WHERE student_id = ANY($1::int[]) AND status IN ('issued', 'partially_paid') AND due_date < CURRENT_DATE GROUP BY 1`,
    [students]
  );
  let blocked = 0;
  for (const sid of students) {
    const counts = Object.fromEntries(att.filter((a) => a.student_id === sid).map((a) => [a.status, a.c]));
    const pct = attendancePercent(counts);
    const reasons: string[] = [];
    if (series.eligibility.attendance && pct != null && pct < threshold) reasons.push(`attendance ${pct}% (below ${threshold}%)`);
    const due = dues.find((d) => d.student_id === sid);
    if (series.eligibility.fees && due && Number(due.due) > 0) reasons.push('overdue fees');
    if (reasons.length) blocked++;
    await db.query(
      `INSERT INTO admit_cards (institution_id, series_id, student_id, verify_code, eligible, blocked_reason) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ON CONSTRAINT admit_cards_series_id_student_id_key DO UPDATE
         SET eligible = CASE WHEN admit_cards.overridden_by IS NOT NULL THEN true ELSE EXCLUDED.eligible END,
             blocked_reason = CASE WHEN admit_cards.overridden_by IS NOT NULL THEN admit_cards.blocked_reason ELSE EXCLUDED.blocked_reason END, issued_at = now()`,
      [inst, series.id, sid, verifyCode(), !reasons.length, reasons.join('; ') || null]
    );
  }
  const { rows: ok } = await db.query<{ ref: number }>(`SELECT student_id AS ref FROM admit_cards WHERE series_id = $1 AND eligible`, [series.id]);
  const { rows: users } = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'student' AND is_active AND ref_id = ANY($1::int[]) AND institution_id = $2`, [ok.map((o) => o.ref), inst]);
  await notify({ institutionId: inst, userIds: [...users.map((u) => u.id), ...(await guardianUserIds(ok.map((o) => o.ref)))], type: 'exam_update', title: `Admit card ready: ${series.name}`, message: 'Download it from Exams.', link: '/exams', dedupeKey: `admit:${series.id}` });
  await auditAs(req, 'admit_cards', 'ExamSeries', `${series.name}: ${students.length} (${blocked} blocked)`);
  res.status(201).json({ issued: students.length, blocked });
});

router.get('/exams/series/:id/admit-cards', readOffice, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const { rows } = await db.query(
    `SELECT a.id, a.student_id, st.first_name || ' ' || st.last_name AS name, st.roll_no, sec.name AS section_name, a.eligible, a.blocked_reason, a.overridden_by IS NOT NULL AS overridden, a.issued_at
       FROM admit_cards a JOIN students st ON st.id = a.student_id LEFT JOIN sections sec ON sec.id = st.section_id WHERE a.series_id = $1 ORDER BY a.eligible, sec.name, st.roll_no`,
    [series.id]
  );
  res.json(rows);
});

router.post('/exams/admit-cards/:id/override', office, async (req, res) => {
  const b = overrideAdmitBody.parse(req.body);
  const { rows } = await db.query(
    `UPDATE admit_cards SET eligible = true, overridden_by = $3, blocked_reason = COALESCE(blocked_reason, '') || ' — allowed: ' || $4 WHERE id = $1 AND institution_id = $2 RETURNING *`,
    [id.parse(req.params.id), institutionId(req), currentUser(req).id, b.reason]
  );
  if (!rows[0]) throw notFound();
  await auditAs(req, 'override_admit_card', 'AdmitCard', `${rows[0].student_id}: ${b.reason}`);
  res.json(rows[0]);
});

router.get('/exams/series/:id/admit-cards/:studentId.pdf', async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const sid = id.parse(req.params.studentId);
  const staff = userCan(req, 'exams.manage');
  if (!staff) await assertCanViewStudent(currentUser(req), sid, { allowTeachers: false });
  const { rows: card } = await db.query(`SELECT * FROM admit_cards WHERE series_id = $1 AND student_id = $2`, [series.id, sid]);
  if (!card[0]) throw notFound('No admit card has been issued yet');
  if (!card[0].eligible && !staff) throw forbidden(`Admit card withheld: ${card[0].blocked_reason}. Please see the exams office.`, 'NOT_ELIGIBLE');
  const { rows: st } = await db.query(`SELECT st.first_name || ' ' || st.last_name AS name, st.roll_no, sec.name AS section_name FROM students st LEFT JOIN sections sec ON sec.id = st.section_id WHERE st.id = $1`, [sid]);
  const roster = (await seriesRoster(series.id)).filter((r) => r.student_id === sid).map((r) => r.session_id);
  const { rows: papers } = await db.query(
    `SELECT co.name AS course, s.date::text AS date, s.starts_at::text, s.ends_at::text, r.code AS room, e.seat_no
       FROM exam_sessions s JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
       LEFT JOIN exam_seats e ON e.session_id = s.id AND e.student_id = $2 LEFT JOIN rooms r ON r.id = e.room_id
      WHERE s.id = ANY($1::int[]) ORDER BY s.date, s.starts_at`,
    [roster, sid]
  );
  const { rows: ins } = await db.query(`SELECT instructions FROM exam_series WHERE id = $1`, [series.id]);
  await sendAdmitCard(res, institutionId(req), { series: series.name, instructions: ins[0].instructions, student: st[0], papers, verify_code: card[0].verify_code });
});

// ---------------------------------------------------------------- marks and approvals

router.get('/exams/my-papers', async (req, res) => {
  const u = currentUser(req);
  if (u.role !== 'teacher' && !userCan(req, 'exams.manage')) throw forbidden();
  const { rows } = await db.query(
    `SELECT s.id, s.date, s.starts_at, s.ends_at, s.status, s.total_marks, x.name AS series, x.id AS series_id, co.name AS course, sec.name AS section_name,
            (SELECT count(*)::int FROM exam_marks m WHERE m.session_id = s.id) AS marks_entered, (SELECT count(*)::int FROM (${rosterSql('s.offering_id')}) r) AS candidates,
            (d.head_teacher_id = $2) AS i_am_hod
       FROM exam_sessions s JOIN exam_series x ON x.id = s.series_id JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
       LEFT JOIN sections sec ON sec.id = o.section_id LEFT JOIN departments d ON d.id = co.department_id
      WHERE s.institution_id = $1 AND x.status <> 'published'
        AND (EXISTS (SELECT 1 FROM section_staff ss WHERE ss.offering_id = s.offering_id AND ss.teacher_id = $2) OR d.head_teacher_id = $2)
      ORDER BY s.date DESC, s.starts_at`,
    [institutionId(req), u.ref_id ?? 0]
  );
  res.json(rows);
});

router.get('/exams/sessions/:id/marks', async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req));
  if (!(await canEnterMarks(req, s)) && !isHod(req, s) && !userCan(req, 'exams.publish')) throw forbidden();
  const { rows } = await db.query(
    `SELECT r.id AS student_id, st.first_name || ' ' || st.last_name AS name, st.roll_no, m.marks, m.absent, m.adjustment, m.remarks
       FROM (${rosterSql('$1')}) r JOIN students st ON st.id = r.id LEFT JOIN exam_marks m ON m.session_id = $2 AND m.student_id = r.id
      ORDER BY st.roll_no NULLS LAST, st.first_name`,
    [s.offering_id, s.id]
  );
  const { rows: history } = await db.query(
    `SELECT m.action, m.from_status, m.to_status, m.change, m.note, m.created_at, u.full_name AS by FROM exam_moderations m LEFT JOIN users u ON u.id = m.user_id WHERE m.session_id = $1 ORDER BY m.created_at`,
    [s.id]
  );
  res.json({ session: { id: s.id, course: s.course, series: s.series_name, date: s.date, total_marks: s.total_marks, pass_marks: s.pass_marks, status: s.status }, students: rows, history, can_enter: await canEnterMarks(req, s), can_approve: isHod(req, s) || userCan(req, 'exams.publish') });
});

router.put('/exams/sessions/:id/marks', async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req), true);
  if (!(await canEnterMarks(req, s))) throw forbidden();
  if (!['scheduled', 'marks_entry'].includes(s.status)) throw conflict('Marks have been submitted; ask for them to be returned to change them', 'SUBMITTED');
  const b = marksEntryBody.parse(req.body);
  const total = Number(s.total_marks);
  const { rows: roster } = await db.query<{ id: number }>(rosterSql('$1'), [s.offering_id]);
  const bad = b.marks.filter((m) => !roster.some((r) => r.id === m.student_id));
  if (bad.length) throw badRequest('Some students do not sit this paper', { student_ids: bad.map((x) => x.student_id) });
  const over = b.marks.filter((m) => m.marks != null && m.marks > total);
  if (over.length) throw badRequest(`Marks above the total of ${total}`, { student_ids: over.map((x) => x.student_id) });
  // the whole grid in one statement
  const latest = new Map(b.marks.map((m) => [m.student_id, m]));
  const rows = [...latest.values()];
  await db.query(
    `INSERT INTO exam_marks (institution_id, session_id, student_id, marks, absent, remarks, entered_by, updated_at)
     SELECT $1, $2, x.student_id, CASE WHEN x.absent THEN NULL ELSE x.marks END, x.absent, x.remarks, $3, now()
       FROM unnest($4::int[], $5::numeric[], $6::boolean[], $7::text[]) AS x(student_id, marks, absent, remarks)
     ON CONFLICT ON CONSTRAINT exam_marks_session_id_student_id_key DO UPDATE SET marks = EXCLUDED.marks, absent = EXCLUDED.absent, remarks = EXCLUDED.remarks, entered_by = EXCLUDED.entered_by, updated_at = now()`,
    [s.institution_id, s.id, currentUser(req).id, rows.map((m) => m.student_id), rows.map((m) => m.marks ?? null), rows.map((m) => m.absent), rows.map((m) => m.remarks)]
  );
  if (s.status === 'scheduled') await log(s, req, 'open', 'marks_entry');
  res.json({ saved: b.marks.length });
});

router.post('/exams/sessions/:id/submit', async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req), true);
  if (!(await canEnterMarks(req, s))) throw forbidden();
  if (s.status !== 'marks_entry') throw conflict('Enter the marks first', 'NOT_READY');
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM (${rosterSql('$1')}) r WHERE NOT EXISTS (SELECT 1 FROM exam_marks m WHERE m.session_id = $2 AND m.student_id = r.id AND (m.absent OR m.marks IS NOT NULL))`,
    [s.offering_id, s.id]
  );
  if (rows[0]!.n) throw conflict(`${rows[0]!.n} students have no marks (mark them absent if they did not sit)`, 'INCOMPLETE');
  await log(s, req, 'submit', 'submitted');
  res.json({ status: 'submitted' });
});

/** Head of department, then exam controller. Without a head of department the controller approves directly. */
router.post('/exams/sessions/:id/approve', async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req), true);
  const controller = userCan(req, 'exams.publish');
  let to: string;
  if (s.status === 'submitted' && isHod(req, s)) to = s.head_teacher_id == null && controller ? 'approved' : 'hod_approved';
  else if (s.status === 'submitted' && controller && s.head_teacher_id == null) to = 'approved';
  else if (s.status === 'hod_approved' && controller) to = 'approved';
  else if (s.status === 'submitted' && controller) throw conflict('The head of department approves first', 'NEEDS_HOD');
  else throw forbidden(s.status === 'submitted' || s.status === 'hod_approved' ? 'You cannot approve this step' : 'There is nothing to approve');
  await log(s, req, 'approve', to);
  res.json({ status: to });
});

router.post('/exams/sessions/:id/return', async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req), true);
  const b = returnMarksBody.parse(req.body);
  if (!['submitted', 'hod_approved', 'approved'].includes(s.status)) throw conflict('Nothing to return', 'NOT_SUBMITTED');
  if (s.series_status === 'published') throw conflict('Results are published; withdraw them first', 'PUBLISHED');
  if (!isHod(req, s) && !userCan(req, 'exams.publish')) throw forbidden();
  await log(s, req, 'return', 'marks_entry', b.note);
  res.json({ status: 'marks_entry' });
});

/** Apply grace marks or scale everyone's marks (logged with the reason). */
router.post('/exams/sessions/:id/moderate', async (req, res) => {
  const s = await loadSession(id.parse(req.params.id), institutionId(req), true);
  const b = moderationBody.parse(req.body);
  if (!['submitted', 'hod_approved'].includes(s.status)) throw conflict('Moderation happens after the marks are submitted and before final approval', 'NOT_SUBMITTED');
  if (!isHod(req, s) && !userCan(req, 'exams.publish')) throw forbidden();
  const total = Number(s.total_marks);
  if (b.add !== undefined) {
    await db.query(`UPDATE exam_marks SET adjustment = GREATEST(-marks, LEAST($2::numeric - marks, adjustment + $3)), updated_at = now() WHERE session_id = $1 AND NOT absent AND marks IS NOT NULL`, [s.id, total, b.add]);
  } else {
    if (b.scale_to! > total) throw badRequest('The top mark cannot be above the total');
    const { rows } = await db.query<{ top: string | null }>(`SELECT max(marks + adjustment) AS top FROM exam_marks WHERE session_id = $1 AND NOT absent`, [s.id]);
    const top = Number(rows[0]?.top ?? 0);
    if (top <= 0) throw badRequest('No marks to scale');
    await db.query(`UPDATE exam_marks SET adjustment = round((marks + adjustment) * $2::numeric / $3::numeric, 2) - marks, updated_at = now() WHERE session_id = $1 AND NOT absent AND marks IS NOT NULL`, [s.id, b.scale_to, top]);
  }
  await log(s, req, 'moderate', s.status, b.note, b.add !== undefined ? { add: b.add } : { scale_to: b.scale_to });
  await auditAs(req, 'moderate', 'ExamPaper', `${s.course}: ${JSON.stringify(b)}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- results

router.post('/exams/series/:id/publish', requirePermission('exams.publish'), async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const inst = institutionId(req);
  const { rows: sessions } = await db.query<{ id: number; offering_id: number; assessment_id: number | null; total_marks: string; status: string; course: string }>(
    `SELECT s.id, s.offering_id, s.assessment_id, s.total_marks, s.status, co.name AS course FROM exam_sessions s JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id WHERE s.series_id = $1`,
    [series.id]
  );
  if (!sessions.length) throw badRequest('This series has no papers');
  const pending = sessions.filter((s) => s.status !== 'approved');
  if (pending.length) throw conflict(`Not all papers are approved: ${pending.map((p) => p.course).join(', ')}`, 'NOT_APPROVED');
  const students = new Set<number>();
  await withTransaction(async () => {
    for (const s of sessions) {
      let aid = s.assessment_id;
      if (!aid) {
        const { rows: cat } = await db.query<{ id: number }>(`SELECT id FROM grade_categories WHERE offering_id = $1 AND name ILIKE 'exam%' ORDER BY id LIMIT 1`, [s.offering_id]);
        const { rows } = await db.query<{ id: number }>(
          `INSERT INTO assessments (institution_id, offering_id, category_id, kind, title, points, status, submission_types, release_mode, created_by) VALUES ($1,$2,$3,'exam',$4,$5,'published',ARRAY['none'],'manual',$6) RETURNING id`,
          [inst, s.offering_id, cat[0]?.id ?? null, series.name, s.total_marks, currentUser(req).id]
        );
        aid = rows[0]!.id;
        await db.query(`UPDATE exam_sessions SET assessment_id = $2 WHERE id = $1`, [s.id, aid]);
      }
      // every candidate's grade in one statement (a remote database makes row-by-row slow)
      const { rows: graded } = await db.query<{ student_id: number }>(
        `INSERT INTO grades (institution_id, assessment_id, student_id, points, missing, status, graded_at, released_at, updated_at)
         SELECT $1, $2, m.student_id, CASE WHEN m.absent OR m.marks IS NULL THEN 0 ELSE LEAST($4::numeric, m.marks + m.adjustment) END, m.absent, 'released', now(), now(), now()
           FROM exam_marks m WHERE m.session_id = $3
         ON CONFLICT ON CONSTRAINT grades_assessment_id_student_id_key DO UPDATE SET points = EXCLUDED.points, missing = EXCLUDED.missing, status = 'released', released_at = COALESCE(grades.released_at, now()), updated_at = now()
         RETURNING student_id`,
        [inst, aid, s.id, s.total_marks]
      );
      for (const g of graded) students.add(g.student_id);
    }
    await db.query(`UPDATE exam_series SET status = 'published', published_at = now(), published_by = $2 WHERE id = $1`, [series.id, currentUser(req).id]);
  });
  const ids = [...students];
  const { rows: users } = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'student' AND is_active AND ref_id = ANY($1::int[]) AND institution_id = $2`, [ids, inst]);
  await notify({ institutionId: inst, userIds: [...users.map((u) => u.id), ...(await guardianUserIds(ids))], type: 'exam_update', title: `Results published: ${series.name}`, message: 'See the result card in Exams.', link: '/exams', dedupeKey: `results:${series.id}` });
  await auditAs(req, 'publish_results', 'ExamSeries', `${series.name}: ${ids.length} students`);
  res.json({ published: true, students: ids.length });
});

/** Take results back (to correct them); the gradebook entries are hidden again. */
router.post('/exams/series/:id/withdraw', requirePermission('exams.publish'), async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  if (series.status !== 'published') throw conflict('Results are not published', 'NOT_PUBLISHED');
  const b = returnMarksBody.parse(req.body);
  await db.query(`UPDATE grades SET status = 'draft', released_at = NULL WHERE assessment_id IN (SELECT assessment_id FROM exam_sessions WHERE series_id = $1 AND assessment_id IS NOT NULL)`, [series.id]);
  await db.query(`UPDATE exam_series SET status = 'marking', published_at = NULL WHERE id = $1`, [series.id]);
  await auditAs(req, 'withdraw_results', 'ExamSeries', `${series.name}: ${b.note}`);
  res.json({ status: 'marking' });
});

router.get('/exams/series/:id/results', readOffice, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const results = await computeResults(series.id, institutionId(req));
  const format = req.query.format;
  if (format !== 'csv' && format !== 'xlsx') return void res.json({ series, results });
  const papers = [...new Map(results.flatMap((r) => r.papers).map((p) => [p.session_id, p])).values()];
  await sendTable(
    res,
    `results-${series.name}`,
    ['Roll no', 'Student', 'Class', ...papers.map((p) => `${p.course} (/${p.total})`), 'Total', '%', 'Grade', series.result_style === 'university' ? 'SGPA' : 'Position', 'Result'],
    results.map((r) => [
      r.roll_no, r.name, r.section_name,
      ...papers.map((p) => {
        const mine = r.papers.find((x) => x.session_id === p.session_id);
        return mine ? (mine.absent ? 'ABS' : mine.obtained) : '';
      }),
      r.obtained, r.percent, r.grade, series.result_style === 'university' ? r.gpa : r.position, r.passed ? 'Pass' : 'Fail',
    ]),
    format
  );
});

router.get('/exams/series/:id/merit', readOffice, async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const q = meritQuery.parse(req.query);
  const results = await computeResults(series.id, institutionId(req));
  const groups = new Map<string, StudentResult[]>();
  for (const r of results) {
    const key = q.scope === 'section' ? `s${r.section_id}` : q.scope === 'level' ? `l${r.program_level_id}` : 'all';
    groups.set(key, [...(groups.get(key) ?? []), { ...r }]);
  }
  const out = [...groups.entries()].map(([key, list]) => ({
    group: q.scope === 'all' ? 'All' : q.scope === 'section' ? (list[0]!.section_name ?? '—') : key,
    list: rank(list).filter((r) => r.passed).slice(0, q.top).map((r) => ({ position: r.position, student_id: r.student_id, name: r.name, roll_no: r.roll_no, section_name: r.section_name, percent: r.percent, grade: r.grade, gpa: r.gpa })),
  }));
  res.json(out);
});

async function assertResultsVisible(req: Request, seriesId: number, sid: number, status: string) {
  if (userCan(req, 'exams.manage') || userCan(req, 'exams.publish')) return;
  await assertCanViewStudent(currentUser(req), sid, { allowTeachers: true, guardian: 'grades' });
  if (status !== 'published') throw forbidden('Results have not been published yet', 'NOT_PUBLISHED');
}

router.get('/exams/series/:id/result-card/:studentId.pdf', async (req, res) => {
  const series = await loadSeries(id.parse(req.params.id), institutionId(req));
  const sid = id.parse(req.params.studentId);
  await assertResultsVisible(req, series.id, sid, series.status);
  const all = await computeResults(series.id, institutionId(req));
  const mine = all.find((r) => r.student_id === sid);
  if (!mine) throw notFound('This student did not sit this series');
  await sendResultCard(res, institutionId(req), series, mine);
});

/** Published results and upcoming papers for a student, or for each linked child. */
router.get('/exams/my', async (req, res) => {
  const u = currentUser(req);
  const inst = institutionId(req);
  let kids: { id: number; name: string }[] = [];
  if (u.role === 'student' && u.ref_id) kids = (await db.query(`SELECT id, first_name || ' ' || last_name AS name FROM students WHERE id = $1`, [u.ref_id])).rows;
  else if (u.role === 'parent')
    kids = (
      await db.query(
        `SELECT st.id, st.first_name || ' ' || st.last_name AS name FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id WHERE g.user_id = $1 AND gs.institution_id = $2 AND gs.can_view_grades`,
        [u.id, inst]
      )
    ).rows;
  const today = todayIn(await institutionTimeZone(inst));
  const out = [];
  for (const k of kids) {
    const { rows: upcoming } = await db.query(
      `SELECT x.id AS series_id, x.name AS series, co.name AS course, s.date, s.starts_at, s.ends_at, r.code AS room, e.seat_no
         FROM exam_sessions s JOIN exam_series x ON x.id = s.series_id JOIN course_offerings o ON o.id = s.offering_id JOIN courses co ON co.id = o.course_id
         LEFT JOIN exam_seats e ON e.session_id = s.id AND e.student_id = $1 LEFT JOIN rooms r ON r.id = e.room_id
        WHERE x.status IN ('scheduled', 'in_progress') AND s.date >= $2 AND $1 IN (${rosterSql('s.offering_id')}) ORDER BY s.date, s.starts_at`,
      [k.id, today]
    );
    const { rows: cards } = await db.query(`SELECT a.series_id, x.name AS series, a.eligible, a.blocked_reason FROM admit_cards a JOIN exam_series x ON x.id = a.series_id WHERE a.student_id = $1 AND x.status <> 'published'`, [k.id]);
    const { rows: published } = await db.query<{ id: number; name: string; result_style: string; published_at: Date }>(
      `SELECT DISTINCT x.id, x.name, x.result_style, x.published_at FROM exam_series x JOIN exam_sessions s ON s.series_id = x.id JOIN exam_marks m ON m.session_id = s.id AND m.student_id = $1 WHERE x.status = 'published' ORDER BY x.published_at DESC LIMIT 10`,
      [k.id]
    );
    const results = [];
    for (const p of published) {
      const r = (await computeResults(p.id, inst, { studentIds: [k.id] }))[0];
      if (r) results.push({ series_id: p.id, series: p.name, result_style: p.result_style, percent: r.percent, grade: r.grade, passed: r.passed, gpa: r.gpa, papers: r.papers.map((x) => ({ course: x.course, obtained: x.obtained, total: x.total, grade: x.grade, passed: x.passed })) });
    }
    out.push({ student_id: k.id, name: k.name, upcoming, admit_cards: cards.map((c) => ({ ...c, blocked_reason: c.eligible ? null : c.blocked_reason })), results });
  }
  res.json(out);
});

// ---------------------------------------------------------------- transcript

/** Every term with released grades: courses, credits, grades, SGPA, and the CGPA; verifiable. */
router.get('/exams/transcript/:studentId.pdf', async (req, res) => {
  const sid = id.parse(req.params.studentId);
  const inst = institutionId(req);
  if (!userCan(req, 'exams.manage') && !userCan(req, 'records.read_any')) await assertCanViewStudent(currentUser(req), sid, { allowTeachers: true, guardian: 'grades' });
  const { rows: st } = await db.query(
    `SELECT st.first_name || ' ' || st.last_name AS name, st.roll_no, p.name AS program FROM students st LEFT JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN program_levels pl ON pl.id = sec.program_level_id LEFT JOIN programs p ON p.id = pl.program_id WHERE st.id = $1 AND st.institution_id = $2`,
    [sid, inst]
  );
  if (!st[0]) throw notFound('Student not found');
  const scheme = await schemeForStudent(sid, inst);
  const { rows: terms } = await db.query<{ id: number; name: string }>(
    `SELECT DISTINCT t.id, t.name, t.starts_on FROM terms t JOIN course_offerings o ON o.term_id = t.id JOIN assessments a ON a.offering_id = o.id JOIN grades g ON g.assessment_id = a.id
      WHERE g.student_id = $1 AND g.status = 'released' ORDER BY t.starts_on`,
    [sid]
  );
  const out: TranscriptTerm[] = [];
  const all: { percent: number; credits: number | null }[] = [];
  for (const t of terms) {
    const { results } = await courseResults(sid, inst, undefined, { termId: t.id });
    if (!results.length) continue;
    all.push(...results.map((r) => ({ percent: r.percent, credits: r.credits })));
    out.push({
      term: t.name,
      courses: results.map((r) => ({ code: r.code, course: r.course, credits: r.credits, grade: r.grade, points: r.points, percent: r.percent })),
      sgpa: gpa({ ...scheme, kind: 'gpa' }, results.map((r) => ({ percent: r.percent, credits: r.credits }))),
      credits: results.filter((r) => r.passed).reduce((n, r) => n + (r.credits ?? 0), 0),
    });
  }
  const cgpa = gpa({ ...scheme, kind: 'gpa' }, all);
  const credits = out.reduce((n, t) => n + t.credits, 0);
  const data = { terms: out, cgpa, credits };
  // the same facts reuse the last transcript's serial and code; changes issue a new one
  const fingerprint = JSON.stringify(data);
  const { rows: prev } = await db.query(`SELECT serial_no, verify_code, body FROM issued_documents WHERE student_id = $1 AND kind = 'transcript' AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1`, [sid]);
  let doc = prev[0] && prev[0].body === fingerprint ? prev[0] : null;
  if (!doc) {
    const { rows: n } = await db.query<{ n: number }>(`SELECT count(*)::int + 1 AS n FROM issued_documents WHERE institution_id = $1 AND kind = 'transcript'`, [inst]);
    const { rows } = await db.query(
      `INSERT INTO issued_documents (institution_id, kind, serial_no, student_id, verify_code, title, body, data, issued_by) VALUES ($1,'transcript',$2,$3,$4,$5,$6,$7,$8) RETURNING serial_no, verify_code`,
      [inst, `TR-${String(n[0]!.n).padStart(5, '0')}`, sid, verifyCode(), `Transcript — ${st[0].name}`, fingerprint, JSON.stringify({ cgpa, credits }), currentUser(req).id]
    );
    doc = rows[0];
  }
  await sendTranscript(res, inst, { ...st[0], ...data, verify_code: doc.verify_code, serial_no: doc.serial_no });
});

export default router;
