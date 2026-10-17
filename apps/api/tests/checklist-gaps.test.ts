// Gaps closed in the Section 4 walk-through: room / resource bookings (no double booking, no
// clash with the timetable), geofenced QR check-in, the student's streak and the teacher's
// at-risk list on the dashboards, guardians' "may message" permission, and the audit of
// medical notes shown in a student profile.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';

let f;
const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;

beforeAll(async () => {
  f = await fixture.resetDb();
});

describe('room bookings', () => {
  it('books a room; refuses overlaps and timetabled classes; only staff', async () => {
    const A = f.institutions.A.id;
    const room = (await q(`INSERT INTO rooms (institution_id, name, code, kind) VALUES ($1,'Main hall','HALL','hall') RETURNING id`, [A]))[0];
    const t1 = as(f.tokens.t1);
    const day = '2030-03-12'; // a Tuesday
    const at = (h: string) => new Date(`${day}T${h}:00+05:00`).toISOString();
    const b = await t1.post('/api/room-bookings', { room_id: room.id, title: 'Science fair', starts_at: at('14:00'), ends_at: at('16:00') });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect((await as(f.tokens.t2).post('/api/room-bookings', { room_id: room.id, title: 'Debate', starts_at: at('15:00'), ends_at: at('17:00') })).body.code).toBe('BOOKED');
    // a timetabled class in the hall on Tuesdays 08:00–08:45
    const period = (await q(`INSERT INTO periods (institution_id, name, starts_at, ends_at, position) VALUES ($1,'P1','08:00','08:45',1) RETURNING id`, [A]))[0];
    await q(`INSERT INTO timetable_slots (institution_id, section_id, weekday, period_id, room_id) VALUES ($1,$2,2,$3,$4)`, [A, f.sections.A1.id, period.id, room.id]);
    expect((await t1.post('/api/room-bookings', { room_id: room.id, title: 'Assembly', starts_at: at('08:30'), ends_at: at('09:00') })).body.code).toBe('TIMETABLED');
    expect((await t1.post('/api/room-bookings', { room_id: room.id, title: 'Backwards', starts_at: at('10:00'), ends_at: at('09:00') })).status).toBe(400);
    expect((await as(f.tokens.s1).post('/api/room-bookings', { room_id: room.id, title: 'x', starts_at: at('18:00'), ends_at: at('19:00') })).status).toBe(403);
    expect((await as(f.tokens.tb).post('/api/room-bookings', { room_id: room.id, title: 'x', starts_at: at('18:00'), ends_at: at('19:00') })).status).toBe(400);
    const list = await t1.get(`/api/room-bookings?from=${day}&to=${day}`);
    expect(list.body.map((x) => x.title)).toEqual(['Science fair']);
    expect((await as(f.tokens.t2).delete(`/api/room-bookings/${b.body.id}`)).status).toBe(404);
    expect((await t1.delete(`/api/room-bookings/${b.body.id}`)).status).toBe(204);
  });
});

describe('geofenced QR check-in', () => {
  it('needs the location when a geofence is set, and refuses far away', async () => {
    const A = f.institutions.A.id;
    const t1 = as(f.tokens.t1);
    const today = (await q(`SELECT (now() AT TIME ZONE (SELECT timezone FROM institutions WHERE id = $1))::date::text AS d`, [A]))[0].d;
    const row = (await q(`INSERT INTO attendance_sessions (institution_id, section_id, offering_id, date, taken_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [A, f.sections.A1.id, f.subjects.A1math.id, today, f.users.t1.id]))[0];
    const sess = await t1.post(`/api/attendance/sessions/${row.id}/qr`);
    expect(sess.status, JSON.stringify(sess.body)).toBe(200);
    const code = sess.body.code;
    const sid = sess.body.session_id;
    await q(`UPDATE institutions SET settings = COALESCE(settings, '{}'::jsonb) || '{"attendance_geofence": {"lat": 31.5204, "lng": 74.3587, "radius_m": 300}}'::jsonb WHERE id = $1`, [A]);
    const s1 = as(f.tokens.s1);
    expect((await s1.post('/api/attendance/checkin', { session_id: sid, code })).status).toBe(400);
    expect((await s1.post('/api/attendance/checkin', { session_id: sid, code, lat: 24.8607, lng: 67.0011 })).body.code).toBe('OUTSIDE_GEOFENCE');
    const ok = await s1.post('/api/attendance/checkin', { session_id: sid, code, lat: 31.5210, lng: 74.3590 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await q(`UPDATE institutions SET settings = settings - 'attendance_geofence' WHERE id = $1`, [A]);
  });
});

describe('dashboards', () => {
  it("shows the student's streak and the teacher's students at risk", async () => {
    const A = f.institutions.A.id;
    const s = await as(f.tokens.s1).get('/api/me/dashboard');
    expect(s.body.streak).toBe(0);
    await q(`INSERT INTO risk_scores (institution_id, student_id, computed_on, score, level, factors) VALUES ($1,$2,CURRENT_DATE,72,'high','[]'),($1,$3,CURRENT_DATE,80,'high','[]')`, [A, f.students.S1.id, f.students.S3.id]);
    const t = await as(f.tokens.t1).get('/api/me/dashboard');
    expect(t.body.at_risk.map((r) => r.student_id)).toEqual([f.students.S1.id]); // S3 is not in Tina's class
  });
});

describe('guardian messaging permission and medical audit', () => {
  it("a guardian whose link doesn't allow messages can't message the child's teacher", async () => {
    await q(`UPDATE guardianships SET can_message = false WHERE guardian_id = $1`, [f.guardians.G1.id]);
    expect((await as(f.tokens.p1).post('/api/conversations', { user_ids: [f.users.t1.id], body: 'Hello' })).status).toBe(403);
    await q(`UPDATE guardianships SET can_message = true WHERE guardian_id = $1`, [f.guardians.G1.id]);
    expect((await as(f.tokens.p1).post('/api/conversations', { user_ids: [f.users.t1.id], body: 'Hello' })).status).toBe(201);
  });

  it('opening a profile with medical notes is audited', async () => {
    await q(`INSERT INTO student_medical (student_id, institution_id, conditions) VALUES ($1,$2,'Asthma') ON CONFLICT DO NOTHING`, [f.students.S1.id, f.institutions.A.id]);
    const r = await as(f.tokens.adminA).get(`/api/institution/students/${f.students.S1.id}`);
    expect(r.status).toBe(200);
    const audit = await q(`SELECT detail FROM audit_log WHERE action = 'medical_viewed'`);
    expect(audit.map((a) => a.detail)).toContain(String(f.students.S1.id));
  });
});
