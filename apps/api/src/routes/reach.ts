// Reach: help-desk tickets (complaints, feedback — optionally anonymous — with status, SLA and
// satisfaction), parent–teacher meetings (slots generated per teacher, booked by guardians),
// emergency broadcasts on every channel (also to guardians without an account, by
// WhatsApp), delivery logs with retry, and the institution's Zoom / Teams / Meet accounts.
// Mounted under /api.
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  TICKET_SLA_HOURS,
  broadcastBody,
  id,
  liveIntegrationBody,
  ptmBookBody,
  ptmEventBody,
  ptmSlotPatch,
  ticketBody,
  ticketCommentBody,
  ticketPatch,
  ticketRatingBody,
} from '@acadex/shared';
import { getConfig } from '../config';
import { asSystem, db, runAsSystem } from '../db/context';
import { guardianLink } from '../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { defineJob, enqueue } from '../jobs/queue';
import { jitsiRoom, loadAccount, saveAccount } from '../lib/live';
import { channelEnabled, resend, sendAndLog, type Channel } from '../lib/messaging';
import { notify, type DeliveryChannel } from '../lib/notify';
import { parsePage, sendPage } from '../lib/pagination';
import { currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';
import { holders } from './messages';

const router = Router();

// ---------------------------------------------------------------- tickets

interface TicketRow {
  id: number;
  raised_by: number | null;
  assigned_to: number | null;
  anonymous: boolean;
  status: string;
  subject: string;
  student_id: number | null;
}

async function loadTicket(req: Request, ticketId: number) {
  const u = currentUser(req);
  const { rows } = await db.query<TicketRow>(`SELECT id, raised_by, assigned_to, anonymous, status, subject, student_id FROM tickets WHERE id = $1 AND institution_id = $2`, [
    ticketId,
    institutionId(req),
  ]);
  const t = rows[0];
  if (!t) throw notFound();
  const manager = userCan(req, 'tickets.manage');
  const raiser = t.raised_by === u.id;
  const assignee = t.assigned_to === u.id;
  if (!manager && !raiser && !assignee) throw notFound();
  return { t, manager, raiser, assignee, staff: manager || assignee };
}

const TICKET_LIST = `
  SELECT t.id, t.category, t.subject, t.status, t.priority, t.anonymous, t.created_at, t.updated_at, t.due_at, t.resolved_at, t.satisfaction,
         CASE WHEN t.anonymous AND t.raised_by IS DISTINCT FROM $2 THEN NULL ELSE ru.full_name END AS raised_by_name,
         au.full_name AS assigned_to_name, t.assigned_to, st.first_name || ' ' || st.last_name AS student,
         (t.due_at < now() AND t.status NOT IN ('resolved', 'closed')) AS overdue,
         (SELECT count(*)::int FROM ticket_comments c WHERE c.ticket_id = t.id) AS comments,
         count(*) OVER () AS _total
    FROM tickets t LEFT JOIN users ru ON ru.id = t.raised_by LEFT JOIN users au ON au.id = t.assigned_to LEFT JOIN students st ON st.id = t.student_id`;

/** Tickets: everything for the help desk, otherwise the ones I raised or am handling. */
router.get('/tickets', async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 30 });
  const f = z.object({ status: z.string().max(20).optional(), category: z.string().max(20).optional(), assigned: z.enum(['me', 'none']).optional() }).parse(req.query);
  const u = currentUser(req);
  const all = userCan(req, 'tickets.manage');
  const { rows } = await db.query(
    `${TICKET_LIST}
      WHERE t.institution_id = $1 AND ($3::boolean OR t.raised_by = $2 OR t.assigned_to = $2)
        AND ($4::text IS NULL OR t.status = $4 OR ($4 = 'active' AND t.status NOT IN ('resolved', 'closed')))
        AND ($5::text IS NULL OR t.category = $5)
        AND ($6::text IS NULL OR ($6 = 'me' AND t.assigned_to = $2) OR ($6 = 'none' AND t.assigned_to IS NULL))
      ORDER BY (t.status IN ('resolved', 'closed')), CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC
      LIMIT $7 OFFSET $8`,
    [institutionId(req), u.id, all, f.status ?? null, f.category ?? null, f.assigned ?? null, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

/** Raise a ticket (a complaint, feedback, a request). */
router.post('/tickets', async (req, res) => {
  const b = ticketBody.parse(req.body);
  const u = currentUser(req);
  const inst = institutionId(req);
  let studentId: number | null = null;
  if (u.role === 'student') studentId = u.ref_id;
  else if (b.student_id) {
    if (u.role !== 'parent' || !(await guardianLink(u.id, b.student_id, inst))) throw badRequest('Choose one of your children');
    studentId = b.student_id;
  }
  // only the help desk sets urgent / high priority on its own
  const priority = userCan(req, 'tickets.manage') ? b.priority : b.priority === 'urgent' ? 'high' : b.priority;
  const { rows } = await db.query(
    `INSERT INTO tickets (institution_id, raised_by, student_id, category, subject, body, priority, anonymous, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(hours => $9)) RETURNING id, status, priority, due_at, created_at`,
    [inst, u.id, studentId, b.category, b.subject, b.body, priority, b.anonymous, TICKET_SLA_HOURS[priority]]
  );
  await notify({ institutionId: inst, userIds: (await holders(inst, 'tickets.manage')).filter((x) => x !== u.id), type: 'ticket_update', title: `New ${b.category}: ${b.subject}`, link: `/tickets/${rows[0].id}` });
  res.status(201).json(rows[0]);
});

router.get('/tickets/:id', async (req, res) => {
  const { t, staff } = await loadTicket(req, id.parse(req.params.id));
  const u = currentUser(req);
  const { rows } = await db.query(`${TICKET_LIST} WHERE t.id = $1`, [t.id, u.id]);
  const { rows: detail } = await db.query(`SELECT body FROM tickets WHERE id = $1`, [t.id]);
  const { rows: comments } = await db.query(
    `SELECT c.id, c.body, c.internal, c.created_at, c.author_id = $2 AS mine,
            CASE WHEN c.author_id = $3::int AND $4::boolean AND c.author_id IS DISTINCT FROM $2 THEN 'Raised by' ELSE u.full_name END AS author
       FROM ticket_comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id = $1 AND ($5::boolean OR NOT c.internal) ORDER BY c.created_at`,
    [t.id, u.id, t.raised_by, t.anonymous, staff]
  );
  const { _total, ...row } = rows[0] as Record<string, unknown>;
  void _total;
  res.json({ ...row, body: detail[0]?.body, comments, can_manage: userCan(req, 'tickets.manage'), can_handle: staff, mine: t.raised_by === u.id });
});

router.patch('/tickets/:id', async (req, res) => {
  const b = ticketPatch.parse(req.body);
  const { t, manager, assignee } = await loadTicket(req, id.parse(req.params.id));
  const inst = institutionId(req);
  if (!manager && !(assignee && b.priority === undefined && b.assigned_to === undefined)) throw forbidden();
  if (b.assigned_to) {
    const { rows } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND institution_id = $2 AND role IN ('teacher', 'institution_admin') AND is_active`, [b.assigned_to, inst]);
    if (!rows[0]) throw badRequest('Assign the ticket to a member of staff');
  }
  const { rows } = await db.query(
    `UPDATE tickets SET status = COALESCE($2, status), priority = COALESCE($3, priority),
            assigned_to = CASE WHEN $4::boolean THEN $5 ELSE assigned_to END,
            due_at = CASE WHEN $3::text IS NOT NULL THEN created_at + make_interval(hours => $6) ELSE due_at END,
            resolved_at = CASE WHEN COALESCE($2, status) IN ('resolved', 'closed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
            updated_at = now()
      WHERE id = $1 RETURNING id, status, priority, assigned_to, due_at, resolved_at`,
    [t.id, b.status ?? null, b.priority ?? null, b.assigned_to !== undefined, b.assigned_to ?? null, b.priority ? TICKET_SLA_HOURS[b.priority] : 0]
  );
  const u = currentUser(req);
  if (b.status && b.status !== t.status && t.raised_by && t.raised_by !== u.id) {
    await notify({ institutionId: inst, userIds: [t.raised_by], type: 'ticket_update', title: `Your ticket "${t.subject}" is now ${b.status.replace('_', ' ')}`, link: `/tickets/${t.id}` });
  }
  if (b.assigned_to && b.assigned_to !== u.id) {
    await notify({ institutionId: inst, userIds: [b.assigned_to], type: 'ticket_update', title: `Ticket assigned to you: ${t.subject}`, link: `/tickets/${t.id}` });
  }
  res.json(rows[0]);
});

router.post('/tickets/:id/comments', async (req, res) => {
  const b = ticketCommentBody.parse(req.body);
  const { t, staff, raiser } = await loadTicket(req, id.parse(req.params.id));
  const u = currentUser(req);
  const inst = institutionId(req);
  const internal = staff && b.internal;
  const { rows } = await db.query(`INSERT INTO ticket_comments (institution_id, ticket_id, author_id, body, internal) VALUES ($1,$2,$3,$4,$5) RETURNING id, body, internal, created_at`, [
    inst,
    t.id,
    u.id,
    b.body,
    internal,
  ]);
  // a reply from the person who raised it reopens a ticket that was waiting or resolved
  const reopen = raiser && !staff && ['waiting', 'resolved'].includes(t.status);
  await db.query(`UPDATE tickets SET updated_at = now(), status = CASE WHEN $2::boolean THEN 'open' ELSE status END, resolved_at = CASE WHEN $2::boolean THEN NULL ELSE resolved_at END WHERE id = $1`, [
    t.id,
    reopen,
  ]);
  const others = internal
    ? [t.assigned_to, ...(await holders(inst, 'tickets.manage'))]
    : raiser
      ? [t.assigned_to ?? 0].filter(Boolean).concat(t.assigned_to ? [] : await holders(inst, 'tickets.manage'))
      : [t.raised_by, t.assigned_to];
  await notify({ institutionId: inst, userIds: others.filter((x): x is number => !!x && x !== u.id), type: 'ticket_update', title: `New reply: ${t.subject}`, message: internal ? 'Internal note' : b.body.slice(0, 200), link: `/tickets/${t.id}` });
  res.status(201).json(rows[0]);
});

/** How satisfied the person who raised it was, once it is resolved. */
router.post('/tickets/:id/rating', async (req, res) => {
  const b = ticketRatingBody.parse(req.body);
  const { t, raiser } = await loadTicket(req, id.parse(req.params.id));
  if (!raiser) throw forbidden();
  if (!['resolved', 'closed'].includes(t.status)) throw conflict('You can rate a ticket once it is resolved', 'NOT_RESOLVED');
  await db.query(`UPDATE tickets SET satisfaction = $2 WHERE id = $1`, [t.id, b.satisfaction]);
  res.json({ ok: true });
});

/** Help-desk numbers: open by category, overdue, average resolution hours and satisfaction. */
router.get('/tickets-summary', requirePermission('tickets.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
            count(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND due_at < now())::int AS overdue,
            count(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND assigned_to IS NULL)::int AS unassigned,
            round(avg(extract(epoch FROM resolved_at - created_at) / 3600) FILTER (WHERE resolved_at > now() - interval '90 days'))::int AS avg_hours,
            round(avg(satisfaction)::numeric, 1)::float AS satisfaction
       FROM tickets WHERE institution_id = $1`,
    [institutionId(req)]
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------------- parent–teacher meetings

interface PtmEvent {
  id: number;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  mode: string;
  location: string;
  section_ids: number[];
  allow_students: boolean;
  status: string;
}

async function loadEvent(req: Request, eventId: number): Promise<PtmEvent> {
  const { rows } = await db.query<PtmEvent>(
    `SELECT id, title, to_char(date, 'YYYY-MM-DD') AS date, start_time, end_time, slot_minutes, mode, location, section_ids, allow_students, status
       FROM ptm_events WHERE id = $1 AND institution_id = $2`,
    [eventId, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** Students the caller books for in this event: their children (guardians) or themselves. */
async function bookableStudents(req: Request, e: PtmEvent): Promise<{ id: number; name: string; section_id: number }[]> {
  const u = currentUser(req);
  if (u.role === 'parent') {
    const { rows } = await db.query<{ id: number; name: string; section_id: number }>(
      `SELECT st.id, st.first_name || ' ' || st.last_name AS name, st.section_id FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id JOIN students st ON st.id = gs.student_id
        WHERE g.user_id = $1 AND g.deleted_at IS NULL AND st.section_id = ANY($2::int[]) AND COALESCE(st.status, 'active') = 'active' ORDER BY st.first_name`,
      [u.id, e.section_ids]
    );
    return rows;
  }
  if (u.role === 'student' && e.allow_students) {
    const { rows } = await db.query<{ id: number; name: string; section_id: number }>(
      `SELECT id, first_name || ' ' || last_name AS name, section_id FROM students WHERE id = $1 AND section_id = ANY($2::int[])`,
      [u.ref_id ?? 0, e.section_ids]
    );
    return rows;
  }
  return [];
}

/** Teachers (accounts) of a section. */
const SECTION_TEACHERS = `SELECT DISTINCT u.id FROM section_staff ss JOIN users u ON u.ref_id = ss.teacher_id AND u.role = 'teacher' AND u.institution_id = ss.institution_id AND u.is_active
                           WHERE ss.institution_id = $1 AND ss.section_id = ANY($2::int[])`;

router.get('/ptm', async (req, res) => {
  const u = currentUser(req);
  const inst = institutionId(req);
  const { rows } = await db.query(
    `SELECT e.id, e.title, to_char(e.date, 'YYYY-MM-DD') AS date, e.start_time, e.end_time, e.mode, e.location, e.status, e.allow_students,
            (SELECT count(*)::int FROM ptm_slots s WHERE s.event_id = e.id) AS slots,
            (SELECT count(*)::int FROM ptm_slots s WHERE s.event_id = e.id AND s.status IN ('booked', 'done', 'no_show')) AS booked,
            (SELECT count(*)::int FROM ptm_slots s WHERE s.event_id = e.id AND (s.booked_by = $2 OR s.teacher_user_id = $2) AND s.status IN ('booked', 'done')) AS mine
       FROM ptm_events e
      WHERE e.institution_id = $1 AND (
            $3::boolean
         OR EXISTS (SELECT 1 FROM ptm_slots s WHERE s.event_id = e.id AND s.teacher_user_id = $2)
         OR ($4 = 'parent' AND EXISTS (SELECT 1 FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id JOIN students st ON st.id = gs.student_id
                                        WHERE g.user_id = $2 AND st.section_id = ANY(e.section_ids)))
         OR ($4 = 'student' AND e.allow_students AND EXISTS (SELECT 1 FROM students st WHERE st.id = $5 AND st.section_id = ANY(e.section_ids))))
      ORDER BY e.date DESC LIMIT 50`,
    [inst, u.id, userCan(req, 'ptm.manage'), u.role, u.ref_id ?? 0]
  );
  res.json(rows);
});

/** Plan a meeting day: slots are created for every teacher of the chosen sections. */
router.post('/ptm', requirePermission('ptm.manage'), async (req, res) => {
  const b = ptmEventBody.parse(req.body);
  const inst = institutionId(req);
  const u = currentUser(req);
  const { rows: secs } = await db.query<{ id: number }>(`SELECT id FROM sections WHERE institution_id = $1 AND id = ANY($2::int[])`, [inst, b.section_ids]);
  if (secs.length !== new Set(b.section_ids).size) throw badRequest('Some of these sections are not part of this institution');
  const teachers = (await db.query<{ id: number }>(SECTION_TEACHERS, [inst, b.section_ids])).rows.map((r) => r.id);
  if (!teachers.length) throw badRequest('Nobody teaches these sections yet');
  const tz = await institutionTimeZone(inst);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO ptm_events (institution_id, title, date, start_time, end_time, slot_minutes, mode, location, section_ids, allow_students, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [inst, b.title, b.date, b.start_time, b.end_time, b.slot_minutes, b.mode, b.location, b.section_ids, b.allow_students, u.id]
  );
  const eventId = rows[0]!.id;
  const { rowCount } = await db.query(
    `INSERT INTO ptm_slots (institution_id, event_id, teacher_user_id, starts_at, ends_at)
     SELECT $1, $2, t.uid, gs, gs + make_interval(mins => $6)
       FROM unnest($3::int[]) AS t(uid),
            generate_series(($4::date + $5::time) AT TIME ZONE $8, (($4::date + $7::time) AT TIME ZONE $8) - make_interval(mins => $6), make_interval(mins => $6)) AS gs`,
    [inst, eventId, teachers, b.date, b.start_time, b.slot_minutes, b.end_time, tz]
  );
  if (!rowCount) throw badRequest('The time window is shorter than one slot');
  const { rows: families } = await db.query<{ id: number }>(
    `SELECT DISTINCT g.user_id AS id FROM students st JOIN guardianships gs ON gs.student_id = st.id JOIN guardians g ON g.id = gs.guardian_id
      WHERE st.institution_id = $1 AND st.section_id = ANY($2::int[]) AND g.user_id IS NOT NULL
     UNION SELECT u.id FROM users u JOIN students st ON st.id = u.ref_id AND u.role = 'student' WHERE $3::boolean AND st.section_id = ANY($2::int[]) AND st.institution_id = $1`,
    [inst, b.section_ids, b.allow_students]
  );
  await notify({ institutionId: inst, userIds: [...families.map((f) => f.id), ...teachers], type: 'ptm', title: `${b.title}: book a meeting with the teachers`, message: `${b.date}, ${b.start_time}–${b.end_time}`, link: `/meetings/${eventId}` });
  res.status(201).json({ id: eventId, slots: rowCount, teachers: teachers.length });
});

router.get('/ptm/:id', async (req, res) => {
  const e = await loadEvent(req, id.parse(req.params.id));
  const u = currentUser(req);
  const inst = institutionId(req);
  const manager = userCan(req, 'ptm.manage');
  const { rows: mySlots } = await db.query(`SELECT 1 FROM ptm_slots WHERE event_id = $1 AND teacher_user_id = $2 LIMIT 1`, [e.id, u.id]);
  if (manager || mySlots[0]) {
    const { rows: slots } = await db.query(
      `SELECT s.id, s.teacher_user_id, tu.full_name AS teacher, s.starts_at, s.ends_at, s.status, s.note, s.join_url,
              st.first_name || ' ' || st.last_name AS student, bu.full_name AS booked_by
         FROM ptm_slots s JOIN users tu ON tu.id = s.teacher_user_id LEFT JOIN students st ON st.id = s.student_id LEFT JOIN users bu ON bu.id = s.booked_by
        WHERE s.event_id = $1 AND ($2::boolean OR s.teacher_user_id = $3) ORDER BY tu.full_name, s.starts_at`,
      [e.id, manager, u.id]
    );
    return res.json({ ...e, view: manager ? 'office' : 'teacher', slots });
  }
  const kids = await bookableStudents(req, e);
  if (!kids.length) throw notFound();
  const children: Record<string, unknown>[] = [];
  for (const k of kids) {
    const { rows: teachers } = await db.query<{ id: number; name: string }>(
      `SELECT u.id, u.full_name AS name FROM users u WHERE u.id IN (${SECTION_TEACHERS}) ORDER BY u.full_name`,
      [inst, [k.section_id]]
    );
    const { rows: slots } = await db.query<{ id: number; teacher_user_id: number; starts_at: Date; ends_at: Date; state: string; join_url: string; note: string }>(
      `SELECT s.id, s.teacher_user_id, s.starts_at, s.ends_at,
              CASE WHEN s.student_id = $2 THEN 'mine' WHEN s.status = 'open' THEN 'open' ELSE 'taken' END AS state,
              CASE WHEN s.student_id = $2 THEN s.join_url ELSE '' END AS join_url, CASE WHEN s.student_id = $2 THEN s.note ELSE '' END AS note
         FROM ptm_slots s WHERE s.event_id = $1 AND s.teacher_user_id = ANY($3::int[]) ORDER BY s.starts_at`,
      [e.id, k.id, teachers.map((t) => t.id)]
    );
    children.push({ student_id: k.id, name: k.name, teachers: teachers.map((t) => ({ ...t, slots: slots.filter((s) => s.teacher_user_id === t.id) })) });
  }
  res.json({ ...e, view: 'family', children });
});

router.patch('/ptm/:id', requirePermission('ptm.manage'), async (req, res) => {
  const b = z.object({ status: z.enum(['open', 'closed', 'cancelled']) }).parse(req.body);
  const e = await loadEvent(req, id.parse(req.params.id));
  await db.query(`UPDATE ptm_events SET status = $2 WHERE id = $1`, [e.id, b.status]);
  if (b.status === 'cancelled') {
    const { rows } = await db.query<{ booked_by: number }>(`SELECT DISTINCT booked_by FROM ptm_slots WHERE event_id = $1 AND booked_by IS NOT NULL`, [e.id]);
    await notify({ institutionId: institutionId(req), userIds: rows.map((r) => r.booked_by), type: 'ptm', title: `${e.title} was cancelled`, link: `/meetings/${e.id}` });
  }
  res.json({ ok: true });
});

async function loadSlot(req: Request, slotId: number) {
  const { rows } = await db.query<{ id: number; event_id: number; teacher_user_id: number; status: string; booked_by: number | null; student_id: number | null; starts_at: Date }>(
    `SELECT id, event_id, teacher_user_id, status, booked_by, student_id, starts_at FROM ptm_slots WHERE id = $1 AND institution_id = $2`,
    [slotId, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** Book a slot for one of my children (or myself, where students book). */
router.post('/ptm-slots/:id/book', async (req, res) => {
  const b = ptmBookBody.parse(req.body);
  const s = await loadSlot(req, id.parse(req.params.id));
  const e = await loadEvent(req, s.event_id);
  const u = currentUser(req);
  const inst = institutionId(req);
  const kid = (await bookableStudents(req, e)).find((k) => k.id === b.student_id);
  if (!kid) throw notFound();
  if (e.status !== 'open') throw conflict('Booking for this meeting day is closed', 'CLOSED');
  if (s.starts_at.getTime() < Date.now()) throw conflict('That slot has already passed', 'PAST');
  const { rows: teaches } = await db.query(`SELECT 1 FROM (${SECTION_TEACHERS}) t WHERE t.id = $3`, [inst, [kid.section_id], s.teacher_user_id]);
  if (!teaches[0]) throw badRequest("This teacher doesn't teach your child");
  let rows;
  try {
    ({ rows } = await db.query(
      `UPDATE ptm_slots SET status = 'booked', booked_by = $2, student_id = $3, note = $4, booked_at = now(), join_url = $5
        WHERE id = $1 AND status = 'open' RETURNING id, starts_at, ends_at, join_url`,
      [s.id, u.id, kid.id, b.note, e.mode === 'online' ? jitsiRoom() : '']
    ));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('You already have a meeting with this teacher for this child', 'ALREADY_BOOKED');
    throw err;
  }
  if (!rows[0]) throw conflict('Someone else just booked that slot — pick another', 'TAKEN');
  await notify({ institutionId: inst, userIds: [s.teacher_user_id], type: 'ptm', title: `Meeting booked: ${kid.name}`, message: new Date(rows[0].starts_at).toISOString(), link: `/meetings/${e.id}` });
  res.json(rows[0]);
});

/** Cancel a booking: the person who booked it, the teacher or the office. */
router.post('/ptm-slots/:id/cancel', async (req, res) => {
  const s = await loadSlot(req, id.parse(req.params.id));
  const u = currentUser(req);
  const isTeacher = s.teacher_user_id === u.id;
  if (s.booked_by !== u.id && !isTeacher && !userCan(req, 'ptm.manage')) throw notFound();
  if (s.status !== 'booked') throw conflict('This slot is not booked', 'NOT_BOOKED');
  await db.query(`UPDATE ptm_slots SET status = 'open', booked_by = NULL, student_id = NULL, note = '', join_url = '', booked_at = NULL WHERE id = $1`, [s.id]);
  const other = s.booked_by === u.id ? s.teacher_user_id : s.booked_by;
  if (other) await notify({ institutionId: institutionId(req), userIds: [other], type: 'ptm', title: 'A parent–teacher meeting was cancelled', message: s.starts_at.toISOString(), link: `/meetings/${s.event_id}` });
  res.json({ ok: true });
});

/** The teacher (or the office) blocks / reopens a slot, or records how a meeting went. */
router.patch('/ptm-slots/:id', async (req, res) => {
  const b = ptmSlotPatch.parse(req.body);
  const s = await loadSlot(req, id.parse(req.params.id));
  if (s.teacher_user_id !== currentUser(req).id && !userCan(req, 'ptm.manage')) throw notFound();
  const booked = ['booked', 'done', 'no_show'].includes(s.status);
  if ((b.status === 'open' || b.status === 'blocked') && booked) throw conflict('Cancel the booking first', 'BOOKED');
  if ((b.status === 'done' || b.status === 'no_show') && !booked) throw conflict('Only a booked meeting can be marked done', 'NOT_BOOKED');
  const { rows } = await db.query(`UPDATE ptm_slots SET status = $2, note = COALESCE($3, note) WHERE id = $1 RETURNING id, status, note`, [s.id, b.status, b.note ?? null]);
  res.json(rows[0]);
});

// ---------------------------------------------------------------- emergency broadcasts

interface BroadcastRow {
  id: number;
  institution_id: number;
  title: string;
  message: string;
  audience: string;
  campus_id: number | null;
  section_ids: number[];
  channels: string[];
}

/** Everyone a broadcast reaches: accounts, and phone numbers of guardians without one. */
async function broadcastAudience(b: BroadcastRow): Promise<{ userIds: number[]; phones: string[] }> {
  const students = `SELECT st.id FROM students st LEFT JOIN sections sec ON sec.id = st.section_id
                     WHERE st.institution_id = $1 AND COALESCE(st.status, 'active') = 'active' AND st.deleted_at IS NULL
                       AND ($2::int IS NULL OR sec.campus_id = $2) AND (cardinality($3::int[]) = 0 OR st.section_id = ANY($3::int[]))`;
  const parts: string[] = [];
  if (b.audience === 'everyone' || b.audience === 'students') parts.push(`SELECT u.id FROM users u WHERE u.role = 'student' AND u.is_active AND u.ref_id IN (${students})`);
  if (b.audience === 'everyone' || b.audience === 'guardians') {
    parts.push(`SELECT g.user_id AS id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN users u ON u.id = g.user_id AND u.is_active WHERE gs.student_id IN (${students}) AND g.deleted_at IS NULL`);
  }
  if (b.audience === 'everyone' || b.audience === 'staff') {
    parts.push(`SELECT u.id FROM users u LEFT JOIN teachers t ON u.role = 'teacher' AND t.id = u.ref_id
                 WHERE u.institution_id = $1 AND u.is_active AND u.role IN ('teacher', 'institution_admin')
                   AND ($2::int IS NULL OR u.role = 'institution_admin' OR t.campus_id = $2 OR t.campus_id IS NULL)
                   AND (cardinality($3::int[]) = 0 OR u.role = 'institution_admin' OR EXISTS (SELECT 1 FROM section_staff ss WHERE ss.teacher_id = t.id AND ss.section_id = ANY($3::int[])))`);
  }
  const params = [b.institution_id, b.campus_id, b.section_ids];
  const userIds = (await db.query<{ id: number }>(`SELECT DISTINCT id FROM (${parts.join(' UNION ')}) x WHERE id IS NOT NULL`, params)).rows.map((r) => r.id);
  let phones: string[] = [];
  if (b.audience === 'everyone' || b.audience === 'guardians') {
    phones = (
      await db.query<{ phone: string }>(
        `SELECT DISTINCT g.phone FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE gs.student_id IN (${students}) AND g.user_id IS NULL AND g.phone <> '' AND g.deleted_at IS NULL`,
        params
      )
    ).rows.map((r) => r.phone);
  }
  return { userIds, phones };
}

export const broadcastJob = defineJob<{ id: number }>({
  name: 'broadcast.deliver',
  retryLimit: 1,
  async run({ id: broadcastId }) {
    await runAsSystem(async () => {
      const { rows } = await db.query<BroadcastRow>(`SELECT id, institution_id, title, message, audience, campus_id, section_ids, channels FROM broadcasts WHERE id = $1`, [broadcastId]);
      const b = rows[0];
      if (!b) return;
      const { userIds, phones } = await broadcastAudience(b);
      const delivery = b.channels.filter((c): c is DeliveryChannel => c !== 'app');
      const people = await notify({ institutionId: b.institution_id, userIds, type: 'emergency', title: b.title, message: b.message, link: '/notifications', channels: delivery, dedupeKey: `broadcast:${b.id}` });
      let texted = 0;
      for (const ch of ['whatsapp'] as Channel[]) {
        if (!b.channels.includes(ch) || !channelEnabled(ch)) continue;
        for (const phone of phones) if (await sendAndLog(b.institution_id, { channel: ch, to: phone, text: `${b.title}: ${b.message}`.slice(0, 640) })) texted++;
      }
      await db.query(`UPDATE broadcasts SET counts = $2 WHERE id = $1`, [b.id, JSON.stringify({ people, phones_without_account: phones.length, texts_sent: texted })]);
    });
  },
});

router.get('/broadcasts', requirePermission('broadcast.send'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.id, b.title, b.message, b.audience, b.channels, b.counts, b.created_at, u.full_name AS sent_by FROM broadcasts b LEFT JOIN users u ON u.id = b.sent_by
      WHERE b.institution_id = $1 ORDER BY b.created_at DESC LIMIT 50`,
    [institutionId(req)]
  );
  res.json(rows);
});

/** Send an emergency broadcast now (in the app, by email, push and WhatsApp). */
router.post('/broadcasts', requirePermission('broadcast.send'), async (req, res) => {
  const b = broadcastBody.parse(req.body);
  const inst = institutionId(req);
  if (b.campus_id) {
    const { rows } = await db.query(`SELECT 1 FROM campuses WHERE id = $1 AND institution_id = $2`, [b.campus_id, inst]);
    if (!rows[0]) throw badRequest('That campus is not part of this institution');
  }
  if (b.section_ids.length) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM sections WHERE institution_id = $1 AND id = ANY($2::int[])`, [inst, b.section_ids]);
    if (rows[0].n !== new Set(b.section_ids).size) throw badRequest('Some of these sections are not part of this institution');
  }
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO broadcasts (institution_id, title, message, audience, campus_id, section_ids, channels, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [inst, b.title, b.message, b.audience, b.campus_id ?? null, b.section_ids, [...new Set(['app', ...b.channels])], currentUser(req).id]
  );
  await enqueue('broadcast.deliver', { id: rows[0]!.id });
  res.status(202).json({ id: rows[0]!.id });
});

// ---------------------------------------------------------------- delivery logs

/** What went out by email, push and WhatsApp (and SMS, before it was removed), and what failed. */
router.get('/delivery-logs', requirePermission('delivery.read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 50 });
  const f = z.object({ status: z.enum(['sent', 'failed', 'skipped']).optional(), channel: z.enum(['email', 'push', 'sms', 'whatsapp']).optional() }).parse(req.query);
  // delivery logs are private to their person under row-level security; the office reads its own institution's here
  const { rows } = await asSystem(() => db.query(
    `SELECT l.id, l.channel, l.status, l.error, l.attempts, l.created_at, l.to_address, u.full_name AS person, n.title,
            (l.status = 'failed' AND l.channel <> 'sms' AND (l.channel = 'whatsapp' AND l.body IS NOT NULL OR l.notification_id IS NOT NULL)) AS retryable,
            count(*) OVER () AS _total
       FROM delivery_logs l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN notifications n ON n.id = l.notification_id
      WHERE l.institution_id = $1 AND ($2::text IS NULL OR l.status = $2) AND ($3::text IS NULL OR l.channel = $3)
      ORDER BY l.id DESC LIMIT $4 OFFSET $5`,
    [institutionId(req), f.status ?? null, f.channel ?? null, pg.limit, pg.offset]
  ));
  sendPage(res, rows, pg);
});

router.post('/delivery-logs/:id/retry', requirePermission('delivery.read'), async (req, res) => {
  const { rows } = await asSystem(() => db.query<{ id: number; channel: string; status: string; notification_id: number | null }>(
    `SELECT id, channel, status, notification_id FROM delivery_logs WHERE id = $1 AND institution_id = $2`,
    [id.parse(req.params.id), institutionId(req)]
  ));
  const l = rows[0];
  if (!l) throw notFound();
  if (l.status !== 'failed') throw conflict('Only failed deliveries can be retried', 'NOT_FAILED');
  if (l.channel === 'sms') throw conflict('SMS is no longer sent', 'NOT_RETRYABLE');
  if (l.channel === 'whatsapp') {
    const r = await resend(l.id);
    if (r.error === 'nothing to resend' && l.notification_id) {
      await enqueue('notify.deliver', { ids: [l.notification_id], channels: [l.channel] });
      return res.json({ ok: true, queued: true });
    }
    return res.json(r);
  }
  if (!l.notification_id) throw conflict('This delivery cannot be retried', 'NOT_RETRYABLE');
  await asSystem(() => db.query(`UPDATE delivery_logs SET attempts = attempts + 1 WHERE id = $1`, [l.id]));
  await enqueue('notify.deliver', { ids: [l.notification_id], channels: [l.channel as DeliveryChannel] });
  res.json({ ok: true, queued: true });
});

// ---------------------------------------------------------------- live-class accounts

/** Zoom, Teams and Meet: whether each is connected (secrets are never returned). */
router.get('/integrations/live', requirePermission('integrations.manage'), async (req, res) => {
  const inst = institutionId(req);
  const out: Record<string, unknown>[] = [];
  for (const provider of ['zoom', 'teams', 'meet'] as const) {
    const a = await loadAccount(inst, provider);
    out.push({
      provider,
      connected: !!a,
      enabled: a?.enabled ?? false,
      config: a?.config ?? {},
      has_secret: !!a && Object.values(a.secret).some(Boolean),
      webhook_url: provider === 'zoom' ? `${getConfig().apiPublicUrl}/integrations/zoom/webhook/${inst}` : null,
    });
  }
  res.json(out);
});

router.put('/integrations/live', requirePermission('integrations.manage'), async (req, res) => {
  const b = liveIntegrationBody.parse(req.body);
  await saveAccount(institutionId(req), currentUser(req).id, b);
  res.json({ ok: true });
});

router.delete('/integrations/live/:provider', requirePermission('integrations.manage'), async (req, res) => {
  const provider = z.enum(['zoom', 'teams', 'meet']).parse(req.params.provider);
  await db.query(`DELETE FROM integration_accounts WHERE institution_id = $1 AND provider = $2`, [institutionId(req), provider]);
  res.status(204).end();
});

export default router;
