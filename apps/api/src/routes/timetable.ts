// The timetable: rooms, the bell schedule (periods), weekly slots with clash checks (a section,
// a teacher and a room are each in one place per period), teacher unavailability, an automatic
// generator, substitutions, and week views that know about holidays. Mounted under /api.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { generateTimetableBody, id, isoDate, periodsBody, roomBody, slotBody, substitutionBody, timetableQuery, unavailabilityBody } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { todayIn } from '../lib/locale';
import { notify } from '../lib/notify';
import { calendarSettings, isUniqueViolation } from '../lib/structure';
import { currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';

const router = Router();
const manage = requirePermission('timetable.manage');

// ---------------------------------------------------------------- rooms

router.get('/timetable/rooms', async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, c.name AS campus_name FROM rooms r LEFT JOIN campuses c ON c.id = r.campus_id WHERE r.institution_id = $1 ORDER BY r.code`,
    [institutionId(req)]
  );
  res.json(rows);
});

router.post('/timetable/rooms', manage, async (req, res) => {
  const b = roomBody.parse(req.body);
  if (b.campus_id) await assertInInstitution('campuses', b.campus_id, institutionId(req));
  try {
    const { rows } = await db.query(`INSERT INTO rooms (institution_id, campus_id, name, code, capacity, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [
      institutionId(req), b.campus_id, b.name, b.code, b.capacity, b.kind,
    ]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A room with this code already exists', 'DUPLICATE');
    throw e;
  }
});

router.patch('/timetable/rooms/:id', manage, async (req, res) => {
  const b = roomBody.parse(req.body);
  const { rows } = await db.query(`UPDATE rooms SET name = $3, code = $4, capacity = $5, kind = $6, campus_id = $7 WHERE id = $1 AND institution_id = $2 RETURNING *`, [
    id.parse(req.params.id), institutionId(req), b.name, b.code, b.capacity, b.kind, b.campus_id,
  ]);
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

router.delete('/timetable/rooms/:id', manage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM rooms WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- bell schedule

router.get('/timetable/periods', async (req, res) => {
  const campusId = req.query.campus_id ? id.parse(req.query.campus_id) : null;
  const { rows } = await db.query(
    `SELECT id, campus_id, name, to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at, position, is_break
       FROM periods WHERE institution_id = $1 AND (campus_id IS NOT DISTINCT FROM $2 OR ($2::int IS NOT NULL AND campus_id IS NULL AND NOT EXISTS (SELECT 1 FROM periods p2 WHERE p2.campus_id = $2)))
      ORDER BY position`,
    [institutionId(req), campusId]
  );
  res.json(rows);
});

/** Replace a bell schedule. Periods with slots keep their ids (matched by position). */
router.put('/timetable/periods', manage, async (req, res) => {
  const b = periodsBody.parse(req.body);
  const s = institutionId(req);
  if (b.campus_id) await assertInInstitution('campuses', b.campus_id, s);
  const sorted = [...b.periods].sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.starts_at < sorted[i - 1]!.ends_at) throw badRequest(`“${sorted[i]!.name}” overlaps “${sorted[i - 1]!.name}”`);
  await withTransaction(async () => {
    const { rows: existing } = await db.query<{ id: number; position: number }>(`SELECT id, position FROM periods WHERE institution_id = $1 AND campus_id IS NOT DISTINCT FROM $2`, [s, b.campus_id]);
    // move every row out of the way of the unique position first
    await db.query(`UPDATE periods SET position = position + 1000 WHERE institution_id = $1 AND campus_id IS NOT DISTINCT FROM $2`, [s, b.campus_id]);
    for (const [i, p] of sorted.entries()) {
      const ex = existing.find((e) => e.position === i + 1);
      if (ex) await db.query(`UPDATE periods SET name = $2, starts_at = $3, ends_at = $4, position = $5, is_break = $6 WHERE id = $1`, [ex.id, p.name, p.starts_at, p.ends_at, i + 1, p.is_break]);
      else await db.query(`INSERT INTO periods (institution_id, campus_id, name, starts_at, ends_at, position, is_break) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [s, b.campus_id, p.name, p.starts_at, p.ends_at, i + 1, p.is_break]);
    }
    const { rows: gone } = await db.query<{ id: number }>(`SELECT id FROM periods WHERE institution_id = $1 AND campus_id IS NOT DISTINCT FROM $2 AND position > 1000`, [s, b.campus_id]);
    if (gone.length) {
      const { rows: used } = await db.query(`SELECT 1 FROM timetable_slots WHERE period_id = ANY($1::int[]) LIMIT 1`, [gone.map((g) => g.id)]);
      if (used[0]) throw conflict('Some removed periods still have classes in the timetable; move them first', 'IN_USE');
      await db.query(`DELETE FROM periods WHERE id = ANY($1::int[])`, [gone.map((g) => g.id)]);
    }
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- slots

const SLOT_SELECT = `SELECT ts.id, ts.term_id, ts.section_id, ts.offering_id, ts.teacher_id, ts.room_id, ts.weekday, ts.period_id,
    p.name AS period_name, to_char(p.starts_at, 'HH24:MI') AS starts_at, to_char(p.ends_at, 'HH24:MI') AS ends_at, p.position,
    c.name AS course, c.code AS course_code, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name, sec.campus_id,
    t.first_name || ' ' || t.last_name AS teacher, r.code AS room
  FROM timetable_slots ts JOIN periods p ON p.id = ts.period_id JOIN sections sec ON sec.id = ts.section_id
  LEFT JOIN course_offerings o ON o.id = ts.offering_id LEFT JOIN courses c ON c.id = o.course_id
  LEFT JOIN teachers t ON t.id = ts.teacher_id LEFT JOIN rooms r ON r.id = ts.room_id`;

const mondayOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A week of the timetable for a section, a teacher or a room: holidays and substitutions applied. */
async function weekView(req: Request, filter: { section_id?: number | null; teacher_id?: number | null; room_id?: number | null; term_id?: number | null }, weekOf: string) {
  const s = institutionId(req);
  const params: unknown[] = [s];
  const where: string[] = ['ts.institution_id = $1'];
  for (const [k, v] of Object.entries(filter)) {
    if (!v) continue;
    params.push(v);
    // a teacher's week includes the classes they cover
    where.push(k === 'teacher_id' ? `(ts.teacher_id = $${params.length} OR ts.id IN (SELECT slot_id FROM substitutions WHERE substitute_teacher_id = $${params.length}))` : `ts.${k} = $${params.length}`);
  }
  const { rows: slots } = await db.query(`${SLOT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ts.weekday, p.position`, params);
  const monday = mondayOf(weekOf);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const { rows: holidays } = await db.query<{ name: string; starts_on: string; ends_on: string; campus_id: number | null }>(
    `SELECT name, starts_on, ends_on, campus_id FROM holidays WHERE institution_id = $1 AND kind IN ('holiday', 'break') AND ends_on >= $2 AND starts_on <= $3`,
    [s, days[0], days[6]]
  );
  const { rows: subs } = await db.query<{ slot_id: number; date: string; substitute_teacher_id: number; substitute: string; reason: string }>(
    `SELECT su.slot_id, su.date, su.substitute_teacher_id, t.first_name || ' ' || t.last_name AS substitute, su.reason
       FROM substitutions su JOIN teachers t ON t.id = su.substitute_teacher_id WHERE su.institution_id = $1 AND su.date BETWEEN $2 AND $3`,
    [s, days[0], days[6]]
  );
  const { workingDays } = await calendarSettings(s);
  return {
    week_of: monday,
    days: days.map((date) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const daySlots = slots.filter((x) => x.weekday === weekday);
      const holiday = holidays.find((h) => date >= h.starts_on && date <= h.ends_on && (h.campus_id == null || daySlots.some((x) => x.campus_id === h.campus_id)));
      return {
        date,
        weekday,
        working: workingDays.includes(weekday),
        holiday: holiday?.name ?? null,
        slots: holiday || !workingDays.includes(weekday)
          ? []
          : daySlots.map((x) => {
              const sub = subs.find((y) => y.slot_id === x.id && y.date === date);
              return { ...x, substitute: sub ? { teacher_id: sub.substitute_teacher_id, name: sub.substitute, reason: sub.reason } : null };
            }),
      };
    }),
  };
}

router.get('/timetable', async (req, res) => {
  const q = timetableQuery.parse(req.query);
  const s = institutionId(req);
  if (!q.section_id && !q.teacher_id && !q.room_id) throw badRequest('Choose a section, a teacher or a room');
  if (!userCan(req, 'timetable.manage') && !userCan(req, 'academics.read') && !userCan(req, 'teaching.access')) throw forbidden();
  const weekOf = q.week_of ?? todayIn(await institutionTimeZone(s));
  res.json(await weekView(req, q, weekOf));
});

/** My week: a student's section, a teacher's classes, a guardian's children. */
router.get('/timetable/me', async (req, res) => {
  const u = currentUser(req);
  const s = institutionId(req);
  const weekOf = req.query.week_of ? isoDate.parse(req.query.week_of) : todayIn(await institutionTimeZone(s));
  if (u.role === 'teacher') return void res.json(await weekView(req, { teacher_id: u.ref_id }, weekOf));
  if (u.role === 'student') {
    const { rows } = await db.query<{ section_id: number | null }>(`SELECT section_id FROM students WHERE id = $1`, [u.ref_id]);
    if (!rows[0]?.section_id) return void res.json({ week_of: mondayOf(weekOf), days: [] });
    return void res.json(await weekView(req, { section_id: rows[0].section_id }, weekOf));
  }
  if (u.role === 'parent') {
    const { rows } = await db.query<{ id: number; name: string; section_id: number | null }>(
      `SELECT st.id, st.first_name AS name, st.section_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id WHERE g.user_id = $1`,
      [u.id]
    );
    const children: Record<string, unknown>[] = [];
    for (const c of rows) if (c.section_id) children.push({ student_id: c.id, name: c.name, ...(await weekView(req, { section_id: c.section_id }, weekOf)) });
    return void res.json({ children });
  }
  throw forbidden();
});

/** Explain a clash in words instead of a constraint name. */
async function describeClash(b: z.infer<typeof slotBody>, exceptId: number | null) {
  const { rows } = await db.query<{ what: string; course: string | null; section_name: string | null }>(
    `SELECT CASE WHEN ts.section_id = $1 THEN 'section' WHEN ts.teacher_id = $2 THEN 'teacher' ELSE 'room' END AS what, c.name AS course,
            NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name
       FROM timetable_slots ts JOIN sections sec ON sec.id = ts.section_id LEFT JOIN course_offerings o ON o.id = ts.offering_id LEFT JOIN courses c ON c.id = o.course_id
      WHERE ts.term_id IS NOT DISTINCT FROM $4 AND ts.weekday = $5 AND ts.period_id = $6 AND ts.id <> $7
        AND (ts.section_id = $1 OR (ts.teacher_id = $2 AND $2 IS NOT NULL) OR (ts.room_id = $3 AND $3 IS NOT NULL)) LIMIT 1`,
    [b.section_id, b.teacher_id, b.room_id, b.term_id, b.weekday, b.period_id, exceptId ?? 0]
  );
  const c = rows[0];
  if (!c) return null;
  const msg = { section: 'This section already has a class then', teacher: 'This teacher is already teaching then', room: 'This room is already in use then' }[c.what as 'section'];
  return conflict(`${msg} (${c.course ?? 'class'}${c.section_name ? `, ${c.section_name}` : ''})`, 'TIMETABLE_CLASH', { clash: c.what });
}

async function checkSlot(req: Request, b: z.infer<typeof slotBody>) {
  const s = institutionId(req);
  await assertInInstitution('sections', b.section_id, s);
  const { rows: p } = await db.query(`SELECT 1 FROM periods WHERE id = $1 AND institution_id = $2 AND NOT is_break`, [b.period_id, s]);
  if (!p[0]) throw badRequest('Choose a teaching period (not a break)', { period_id: 'invalid' });
  if (b.offering_id) {
    const { rows } = await db.query(`SELECT 1 FROM course_offerings WHERE id = $1 AND institution_id = $2 AND section_id = $3`, [b.offering_id, s, b.section_id]);
    if (!rows[0]) throw badRequest('That course is not taught to this section', { offering_id: 'invalid' });
  }
  if (b.teacher_id) {
    await assertInInstitution('teachers', b.teacher_id, s);
    const { rows } = await db.query(`SELECT 1 FROM teacher_unavailability WHERE teacher_id = $1 AND weekday = $2 AND (period_id IS NULL OR period_id = $3)`, [b.teacher_id, b.weekday, b.period_id]);
    if (rows[0]) throw conflict('This teacher is not available then', 'TEACHER_UNAVAILABLE');
  }
  if (b.room_id) {
    const { rows } = await db.query(`SELECT 1 FROM rooms WHERE id = $1 AND institution_id = $2`, [b.room_id, s]);
    if (!rows[0]) throw badRequest('Unknown room', { room_id: 'invalid' });
  }
  if (b.term_id) await assertInInstitution('terms', b.term_id, s);
}

router.post('/timetable/slots', manage, async (req, res) => {
  const b = slotBody.parse(req.body);
  await checkSlot(req, b);
  // the course's teacher by default
  if (b.offering_id && !b.teacher_id) {
    const { rows } = await db.query<{ teacher_id: number }>(`SELECT teacher_id FROM section_staff WHERE offering_id = $1 ORDER BY (role = 'teacher') DESC, id LIMIT 1`, [b.offering_id]);
    b.teacher_id = rows[0]?.teacher_id ?? null;
  }
  const clash = await describeClash(b, null);
  if (clash) throw clash;
  const { rows } = await db.query(
    `INSERT INTO timetable_slots (institution_id, term_id, section_id, offering_id, teacher_id, room_id, weekday, period_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [institutionId(req), b.term_id, b.section_id, b.offering_id, b.teacher_id, b.room_id, b.weekday, b.period_id]
  );
  res.status(201).json(rows[0]);
});

router.patch('/timetable/slots/:id', manage, async (req, res) => {
  const slotId = id.parse(req.params.id);
  const b = slotBody.parse(req.body);
  await checkSlot(req, b);
  const clash = await describeClash(b, slotId);
  if (clash) throw clash;
  const { rows } = await db.query(
    `UPDATE timetable_slots SET term_id = $3, section_id = $4, offering_id = $5, teacher_id = $6, room_id = $7, weekday = $8, period_id = $9 WHERE id = $1 AND institution_id = $2 RETURNING *`,
    [slotId, institutionId(req), b.term_id, b.section_id, b.offering_id, b.teacher_id, b.room_id, b.weekday, b.period_id]
  );
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

router.delete('/timetable/slots/:id', manage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM timetable_slots WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- availability

router.get('/timetable/teachers/:id/unavailability', async (req, res) => {
  const tid = id.parse(req.params.id);
  if (!userCan(req, 'timetable.manage') && currentUser(req).ref_id !== tid) throw forbidden();
  await assertInInstitution('teachers', tid, institutionId(req));
  const { rows } = await db.query(`SELECT weekday, period_id FROM teacher_unavailability WHERE teacher_id = $1 ORDER BY weekday, period_id NULLS FIRST`, [tid]);
  res.json(rows);
});

router.put('/timetable/teachers/:id/unavailability', manage, async (req, res) => {
  const tid = id.parse(req.params.id);
  const s = institutionId(req);
  await assertInInstitution('teachers', tid, s);
  const { entries } = unavailabilityBody.parse(req.body);
  await withTransaction(async () => {
    await db.query(`DELETE FROM teacher_unavailability WHERE teacher_id = $1`, [tid]);
    for (const e of entries) {
      await db.query(`INSERT INTO teacher_unavailability (institution_id, teacher_id, weekday, period_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [s, tid, e.weekday, e.period_id]);
    }
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- generator

/**
 * Fill the timetable of some sections from each course's periods per week. Greedy with the
 * most constrained courses first: no section, teacher or room clashes, teacher availability
 * respected, a course spread over different days where possible. apply=false only proposes.
 */
router.post('/timetable/generate', manage, async (req, res) => {
  const b = generateTimetableBody.parse(req.body);
  const s = institutionId(req);
  const { rows: sections } = await db.query<{ id: number; campus_id: number | null }>(`SELECT id, campus_id FROM sections WHERE id = ANY($1::int[]) AND institution_id = $2`, [b.section_ids, s]);
  if (sections.length !== new Set(b.section_ids).size) throw badRequest('Some sections are not in this institution');
  const { workingDays } = await calendarSettings(s);
  const { rows: periods } = await db.query<{ id: number; campus_id: number | null; position: number }>(`SELECT id, campus_id, position FROM periods WHERE institution_id = $1 AND NOT is_break ORDER BY position`, [s]);
  if (!periods.length) throw conflict('Set up the bell schedule (periods) first', 'NO_PERIODS');
  const { rows: offerings } = await db.query<{ id: number; section_id: number; periods_per_week: number; teacher_id: number | null; course: string }>(
    `SELECT o.id, o.section_id, o.periods_per_week, c.name AS course,
            (SELECT teacher_id FROM section_staff ss WHERE ss.offering_id = o.id ORDER BY (role = 'teacher') DESC, id LIMIT 1) AS teacher_id
       FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.section_id = ANY($1::int[]) AND o.periods_per_week > 0`,
    [b.section_ids]
  );
  if (!offerings.length) throw conflict('Set how many periods a week each course needs (periods per week) first', 'NO_DEMAND');
  // what is already booked outside the sections being generated
  const { rows: booked } = await db.query<{ section_id: number; teacher_id: number | null; room_id: number | null; weekday: number; period_id: number }>(
    `SELECT section_id, teacher_id, room_id, weekday, period_id FROM timetable_slots WHERE institution_id = $1 AND term_id IS NOT DISTINCT FROM $2 AND NOT (section_id = ANY($3::int[]))`,
    [s, b.term_id, b.section_ids]
  );
  const { rows: unavailable } = await db.query<{ teacher_id: number; weekday: number; period_id: number | null }>(`SELECT teacher_id, weekday, period_id FROM teacher_unavailability WHERE institution_id = $1`, [s]);
  const busy = new Set<string>();
  for (const x of booked) {
    if (x.teacher_id) busy.add(`t${x.teacher_id}:${x.weekday}:${x.period_id}`);
  }
  const proposal: { section_id: number; offering_id: number; teacher_id: number | null; weekday: number; period_id: number; course: string }[] = [];
  const unplaced: { offering_id: number; course: string; missing: number }[] = [];
  const teacherLoad = (t: number | null) => offerings.filter((o) => o.teacher_id === t).reduce((n, o) => n + o.periods_per_week, 0);
  const order = [...offerings].sort((x, y) => teacherLoad(y.teacher_id) - teacherLoad(x.teacher_id) || y.periods_per_week - x.periods_per_week);
  for (const o of order) {
    const campus = sections.find((x) => x.id === o.section_id)?.campus_id ?? null;
    const ps = periods.filter((p) => p.campus_id === campus).length ? periods.filter((p) => p.campus_id === campus) : periods.filter((p) => p.campus_id == null);
    let placed = 0;
    for (let n = 0; n < o.periods_per_week; n++) {
      const daysUsed = proposal.filter((x) => x.offering_id === o.id).map((x) => x.weekday);
      const candidates: { weekday: number; period_id: number; score: number }[] = [];
      for (const d of workingDays) {
        for (const p of ps) {
          if (busy.has(`s${o.section_id}:${d}:${p.id}`)) continue;
          if (o.teacher_id && busy.has(`t${o.teacher_id}:${d}:${p.id}`)) continue;
          if (o.teacher_id && unavailable.some((u) => u.teacher_id === o.teacher_id && u.weekday === d && (u.period_id == null || u.period_id === p.id))) continue;
          // prefer days the course isn't on yet, and lightly loaded days for the section
          const sameDay = daysUsed.filter((x) => x === d).length;
          const sectionDay = proposal.filter((x) => x.section_id === o.section_id && x.weekday === d).length;
          candidates.push({ weekday: d, period_id: p.id, score: sameDay * 100 + sectionDay * 3 + p.position * 0.1 });
        }
      }
      candidates.sort((x, y) => x.score - y.score);
      const pick = candidates[0];
      if (!pick) break;
      busy.add(`s${o.section_id}:${pick.weekday}:${pick.period_id}`);
      if (o.teacher_id) busy.add(`t${o.teacher_id}:${pick.weekday}:${pick.period_id}`);
      proposal.push({ section_id: o.section_id, offering_id: o.id, teacher_id: o.teacher_id, weekday: pick.weekday, period_id: pick.period_id, course: o.course });
      placed++;
    }
    if (placed < o.periods_per_week) unplaced.push({ offering_id: o.id, course: o.course, missing: o.periods_per_week - placed });
  }
  if (b.apply) {
    await withTransaction(async () => {
      await db.query(`DELETE FROM timetable_slots WHERE section_id = ANY($1::int[]) AND term_id IS NOT DISTINCT FROM $2`, [b.section_ids, b.term_id]);
      for (const x of proposal) {
        await db.query(`INSERT INTO timetable_slots (institution_id, term_id, section_id, offering_id, teacher_id, weekday, period_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
          s, b.term_id, x.section_id, x.offering_id, x.teacher_id, x.weekday, x.period_id,
        ]);
      }
    });
  }
  res.json({ applied: b.apply, slots: proposal, unplaced });
});

// ---------------------------------------------------------------- substitutions

/** Teachers free in that slot's period on that day (for choosing a substitute). */
router.get('/timetable/substitutes', manage, async (req, res) => {
  const q = z.object({ slot_id: id, date: isoDate }).parse(req.query);
  const s = institutionId(req);
  const { rows: slot } = await db.query<{ weekday: number; period_id: number; teacher_id: number | null; term_id: number | null }>(
    `SELECT weekday, period_id, teacher_id, term_id FROM timetable_slots WHERE id = $1 AND institution_id = $2`,
    [q.slot_id, s]
  );
  if (!slot[0]) throw notFound();
  const { rows } = await db.query(
    `SELECT t.id, t.first_name || ' ' || t.last_name AS name, t.designation,
            (SELECT count(*)::int FROM timetable_slots x WHERE x.teacher_id = t.id AND x.weekday = $2) AS periods_that_day
       FROM teachers t
      WHERE t.institution_id = $1 AND COALESCE(t.status, 'active') = 'active' AND t.id IS DISTINCT FROM $4
        AND NOT EXISTS (SELECT 1 FROM timetable_slots x WHERE x.teacher_id = t.id AND x.weekday = $2 AND x.period_id = $3 AND x.term_id IS NOT DISTINCT FROM $6)
        AND NOT EXISTS (SELECT 1 FROM substitutions su JOIN timetable_slots x ON x.id = su.slot_id WHERE su.substitute_teacher_id = t.id AND su.date = $5 AND x.period_id = $3)
        AND NOT EXISTS (SELECT 1 FROM teacher_attendance a WHERE a.teacher_id = t.id AND a.att_date = $5 AND a.status <> 'Present')
        AND NOT EXISTS (SELECT 1 FROM teacher_unavailability u WHERE u.teacher_id = t.id AND u.weekday = $2 AND (u.period_id IS NULL OR u.period_id = $3))
      ORDER BY periods_that_day, t.first_name`,
    [s, slot[0].weekday, slot[0].period_id, slot[0].teacher_id, q.date, slot[0].term_id]
  );
  res.json(rows);
});

router.get('/timetable/substitutions', async (req, res) => {
  const s = institutionId(req);
  const date = req.query.date ? isoDate.parse(req.query.date) : todayIn(await institutionTimeZone(s));
  if (!userCan(req, 'timetable.manage') && !userCan(req, 'teaching.access')) throw forbidden();
  const { rows } = await db.query(
    `SELECT su.id, su.date, su.reason, su.slot_id, t.first_name || ' ' || t.last_name AS substitute, x.*
       FROM substitutions su JOIN teachers t ON t.id = su.substitute_teacher_id
       JOIN LATERAL (${SLOT_SELECT} WHERE ts.id = su.slot_id) x ON true
      WHERE su.institution_id = $1 AND su.date = $2 ORDER BY x.position`,
    [s, date]
  );
  res.json(rows);
});

router.post('/timetable/substitutions', manage, async (req, res) => {
  const b = substitutionBody.parse(req.body);
  const s = institutionId(req);
  const { rows: slot } = await db.query<{ weekday: number; course: string | null; section_name: string | null; starts_at: string }>(
    `${SLOT_SELECT} WHERE ts.id = $1 AND ts.institution_id = $2`,
    [b.slot_id, s]
  );
  if (!slot[0]) throw notFound('Timetable slot not found');
  if (new Date(`${b.date}T00:00:00Z`).getUTCDay() !== slot[0].weekday) throw badRequest('That class is not on that day of the week');
  await assertInInstitution('teachers', b.substitute_teacher_id, s);
  const { rows } = await db.query(
    `INSERT INTO substitutions (institution_id, slot_id, date, substitute_teacher_id, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT ON CONSTRAINT substitutions_slot_id_date_key DO UPDATE SET substitute_teacher_id = EXCLUDED.substitute_teacher_id, reason = EXCLUDED.reason
     RETURNING *`,
    [s, b.slot_id, b.date, b.substitute_teacher_id, b.reason, currentUser(req).id]
  );
  const { rows: u } = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'teacher' AND ref_id = $1 AND institution_id = $2`, [b.substitute_teacher_id, s]);
  await notify({ institutionId: s, userIds: u.map((x) => x.id), type: 'system', title: `You are covering ${slot[0].course ?? 'a class'} on ${b.date}`, message: `${slot[0].section_name ?? ''} at ${slot[0].starts_at}`, link: '/timetable' });
  res.status(201).json(rows[0]);
});

router.delete('/timetable/substitutions/:id', manage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM substitutions WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

export default router;
