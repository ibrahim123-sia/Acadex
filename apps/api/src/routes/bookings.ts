// Room and resource bookings (halls, labs, grounds, rooms outside the timetable): staff book a
// room for a time; a booking may not overlap another booking or the room's timetabled classes
// that weekday. Mounted under /api.
import { Router } from 'express';
import { z } from 'zod';
import { id, roomBookingBody } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { currentUser, institutionId, requireAny, userCan } from '../middleware/auth';

const router = Router();
const staff = requireAny('teaching.access', 'timetable.manage');

/** Bookings of every room in a date range (and each room's timetabled periods for that day of the week). */
router.get('/room-bookings', staff, async (req, res) => {
  const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), room_id: id.optional() }).parse(req.query);
  const { rows } = await db.query(
    `SELECT b.id, b.room_id, r.name AS room, r.kind, b.title, b.purpose, b.starts_at, b.ends_at, u.full_name AS booked_by, b.booked_by = $4 AS mine
       FROM room_bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN users u ON u.id = b.booked_by
      WHERE b.institution_id = $1 AND b.starts_at < ($3::date + 1) AND b.ends_at > $2::date AND ($5::int IS NULL OR b.room_id = $5)
      ORDER BY b.starts_at`,
    [institutionId(req), q.from, q.to, currentUser(req).id, q.room_id ?? null]
  );
  res.json(rows);
});

/** Book a room (refused when it is already booked or timetabled then). */
router.post('/room-bookings', staff, async (req, res) => {
  const b = roomBookingBody.parse(req.body);
  const inst = institutionId(req);
  if (b.ends_at <= b.starts_at) throw badRequest('The end is before the start', { ends_at: 'invalid' });
  if (b.ends_at.getTime() - b.starts_at.getTime() > 14 * 3600_000) throw badRequest('A booking can last at most 14 hours');
  const tz = await institutionTimeZone(inst);
  const out = await withTransaction(async () => {
    // lock the room so two people can't book the same time at once
    const { rows: room } = await db.query<{ id: number; name: string }>(`SELECT id, name FROM rooms WHERE id = $1 AND institution_id = $2 FOR UPDATE`, [b.room_id, inst]);
    if (!room[0]) throw badRequest('Choose one of your rooms');
    const { rows: clash } = await db.query<{ title: string }>(
      `SELECT title FROM room_bookings WHERE room_id = $1 AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
      [b.room_id, b.starts_at, b.ends_at]
    );
    if (clash[0]) throw conflict(`${room[0].name} is already booked then (${clash[0].title})`, 'BOOKED');
    // timetabled classes in that room on that day of the week
    const { rows: lesson } = await db.query<{ name: string }>(
      `SELECT p.name FROM timetable_slots s JOIN periods p ON p.id = s.period_id
        WHERE s.room_id = $1 AND s.weekday = extract(dow FROM ($2::timestamptz AT TIME ZONE $4))::int
          AND (($2::timestamptz AT TIME ZONE $4)::date + p.starts_at) < ($3::timestamptz AT TIME ZONE $4)
          AND (($2::timestamptz AT TIME ZONE $4)::date + p.ends_at) > ($2::timestamptz AT TIME ZONE $4)
        LIMIT 1`,
      [b.room_id, b.starts_at, b.ends_at, tz]
    );
    if (lesson[0]) throw conflict(`${room[0].name} has a timetabled class then (${lesson[0].name})`, 'TIMETABLED');
    const { rows } = await db.query(
      `INSERT INTO room_bookings (institution_id, room_id, title, purpose, starts_at, ends_at, booked_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [inst, b.room_id, b.title, b.purpose, b.starts_at, b.ends_at, currentUser(req).id]
    );
    return rows[0];
  });
  res.status(201).json(out);
});

/** Cancel a booking (the person who made it, or the timetable office). */
router.delete('/room-bookings/:id', staff, async (req, res) => {
  const { rows } = await db.query<{ booked_by: number | null }>(`SELECT booked_by FROM room_bookings WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rows[0] || (rows[0].booked_by !== currentUser(req).id && !userCan(req, 'timetable.manage'))) throw notFound();
  await db.query(`DELETE FROM room_bookings WHERE id = $1`, [id.parse(req.params.id)]);
  res.status(204).end();
});

export default router;
