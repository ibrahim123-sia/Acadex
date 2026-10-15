// Attendance by session (all present, late, offline), QR check-in, leave that marks the register,
// staff attendance, summaries with the threshold; the timetable with clash checks, the
// generator, substitutions and holiday-aware weeks.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';
import { runJob } from '../src/jobs';

let f;
let t1;
let A;
const DAY = '2026-09-01'; // a Tuesday in the past

beforeAll(async () => {
  f = await fixture.resetDb();
  t1 = as(f.tokens.t1);
  A = as(f.tokens.adminA);
});

describe('registers', () => {
  it('a whole class at once, with late minutes; re-saving updates it', async () => {
    const all = [f.students.S1.id, f.students.S2.id].map((student_id) => ({ student_id, status: 'present' }));
    expect((await t1.put('/api/attendance/register', { section_id: f.sections.A1.id, date: DAY, records: all })).status).toBe(200);
    const res = await t1.put('/api/attendance/register', {
      section_id: f.sections.A1.id, date: DAY, offline: true,
      records: [{ student_id: f.students.S1.id, status: 'late', minutes_late: 12 }, { student_id: f.students.S2.id, status: 'absent' }],
    });
    expect(res.status).toBe(200);
    const reg = await t1.get(`/api/attendance/register?section_id=${f.sections.A1.id}&date=${DAY}`);
    const byId = (id) => reg.body.students.find((s) => s.id === id);
    expect([byId(f.students.S1.id), byId(f.students.S2.id)].map((s) => [s.status, s.minutes_late, s.method])).toEqual([['late', 12, 'offline'], ['absent', null, 'offline']]);
    // the guardian of an absent child hears the same day (S2 has none; S1's parent wasn't notified)
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM notifications WHERE type = 'attendance_alert'`);
    expect(rows[0].n).toBe(0);
  });

  it('a course register (per class) is separate from the day register', async () => {
    const res = await t1.put('/api/attendance/register', { section_id: f.sections.A1.id, offering_id: f.subjects.A1math.id, date: DAY, records: [{ student_id: f.students.S1.id, status: 'present' }] });
    expect(res.status).toBe(200);
    const { rows } = await fixture.pool.query(`SELECT kind FROM attendance_sessions ORDER BY id`);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'class']);
  });

  it('no future registers', async () => {
    const res = await t1.put('/api/attendance/register', { section_id: f.sections.A1.id, date: '2099-01-05', records: [] });
    expect(res.status).toBe(400);
  });

  it('students and parents cannot take registers', async () => {
    for (const who of ['s1', 'p1']) {
      expect((await as(f.tokens[who]).put('/api/attendance/register', { section_id: f.sections.A1.id, date: DAY, records: [] })).status).toBe(403);
    }
  });

  it('the summary shows the percentage and eligibility', async () => {
    const res = await as(f.tokens.p1).get(`/api/attendance/students/${f.students.S1.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(75);
    expect(res.body.counts).toMatchObject({ late: 1, present: 1 });
    expect(res.body.percent).toBe(100);
    expect((await as(f.tokens.s2).get(`/api/attendance/students/${f.students.S1.id}/summary`)).status).toBe(403);
  });
});

describe('QR check-in', () => {
  it('works only with the current code, for students of the class, today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // today's register (whatever weekday it is, make the institution open every day)
    await fixture.pool.query(`UPDATE institutions SET settings = jsonb_set(settings, '{working_days}', '[0,1,2,3,4,5,6]') WHERE id = $1`, [f.institutions.A.id]);
    await fixture.pool.query(`UPDATE institutions SET timezone = 'UTC' WHERE id = $1`, [f.institutions.A.id]);
    const reg = await t1.put('/api/attendance/register', { section_id: f.sections.A1.id, date: today, records: [{ student_id: f.students.S1.id, status: 'absent' }] });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const sid = (await fixture.pool.query(`SELECT id FROM attendance_sessions WHERE date = $1 AND offering_id IS NULL`, [today])).rows[0].id;
    const qr = await t1.post(`/api/attendance/sessions/${sid}/qr`, {});
    expect(qr.body.code).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect((await as(f.tokens.s1).post('/api/attendance/checkin', { session_id: sid, code: 'WRONGCODE1' })).status).toBe(400);
    expect((await as(f.tokens.s3).post('/api/attendance/checkin', { session_id: sid, code: qr.body.code })).status).toBe(403);
    expect((await as(f.tokens.s1).post('/api/attendance/checkin', { session_id: sid, code: qr.body.code })).status).toBe(200);
    const { rows } = await fixture.pool.query(`SELECT status, method FROM attendance_records WHERE session_id = $1 AND student_id = $2`, [sid, f.students.S1.id]);
    expect(rows[0]).toEqual({ status: 'present', method: 'qr' });
  });
});

describe('leave', () => {
  it('a parent asks, the class teacher approves, the register shows leave', async () => {
    await fixture.pool.query(`UPDATE sections SET homeroom_teacher_id = $1 WHERE id = $2`, [f.teachers.T1.id, f.sections.A1.id]);
    await t1.put('/api/attendance/register', { section_id: f.sections.A1.id, date: '2026-09-02', records: [{ student_id: f.students.S1.id, status: 'absent' }] });
    const req = await as(f.tokens.p1).post('/api/leave', { student_id: f.students.S1.id, from_date: '2026-09-02', to_date: '2026-09-03', kind: 'sick', reason: 'Fever' });
    expect(req.status).toBe(201);
    // a parent can't ask for someone else's child
    expect((await as(f.tokens.p1).post('/api/leave', { student_id: f.students.S2.id, from_date: '2026-09-10', to_date: '2026-09-10' })).status).toBe(403);
    // overlapping requests are refused
    expect((await as(f.tokens.p1).post('/api/leave', { student_id: f.students.S1.id, from_date: '2026-09-03', to_date: '2026-09-04' })).status).toBe(409);
    expect((await as(f.tokens.t2).post(`/api/leave/${req.body.id}/decision`, { status: 'approved' })).status).toBe(403);
    const toDecide = await t1.get('/api/leave?scope=approve');
    expect(toDecide.body.map((l) => l.id)).toEqual([req.body.id]);
    expect((await t1.post(`/api/leave/${req.body.id}/decision`, { status: 'approved', note: 'Get well' })).status).toBe(200);
    const { rows } = await fixture.pool.query(`SELECT r.status, r.method FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id WHERE s.date = '2026-09-02' AND r.student_id = $1`, [f.students.S1.id]);
    expect(rows[0]).toEqual({ status: 'leave', method: 'leave' });
    const reg = await t1.get(`/api/attendance/register?section_id=${f.sections.A1.id}&date=2026-09-03`);
    expect(reg.body.students.find((s) => s.id === f.students.S1.id).on_leave).toBe('sick');
    const { rows: n } = await fixture.pool.query(`SELECT count(*)::int n FROM notifications WHERE type = 'leave_decision' AND user_id = $1`, [f.users.p1.id]);
    expect(n[0].n).toBe(1);
  });

  it('staff leave marks staff attendance; staff registers are for attendance managers', async () => {
    const req = await t1.post('/api/leave', { from_date: '2026-09-07', to_date: '2026-09-08', kind: 'personal' });
    expect(req.status).toBe(201);
    expect((await A.post(`/api/leave/${req.body.id}/decision`, { status: 'approved' })).status).toBe(200);
    const staff = await A.get('/api/attendance/staff?date=2026-09-07');
    expect(staff.body.staff.find((s) => s.id === f.teachers.T1.id).status).toBe('Leave');
    expect((await t1.get('/api/attendance/staff')).status).toBe(403);
    expect((await A.put('/api/attendance/staff', { date: '2026-09-09', records: [{ teacher_id: f.teachers.TB.id, status: 'Present' }] })).status).toBe(400);
  });

  it('low attendance alerts the student, guardians and class teacher (once a week)', async () => {
    // ten absences for S1
    for (let d = 10; d < 24; d++) {
      const date = `2026-08-${String(d).padStart(2, '0')}`;
      const s = (await fixture.pool.query(`INSERT INTO attendance_sessions (institution_id, section_id, date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [f.institutions.A.id, f.sections.A1.id, date])).rows[0];
      if (s) await fixture.pool.query(`INSERT INTO attendance_records (session_id, student_id, institution_id, status) VALUES ($1,$2,$3,'absent')`, [s.id, f.students.S1.id, f.institutions.A.id]);
    }
    await runJob('attendance.alerts', {});
    await runJob('attendance.alerts', {});
    const { rows } = await fixture.pool.query(`SELECT user_id FROM notifications WHERE type = 'attendance_alert' AND title LIKE '%attendance%' ORDER BY user_id`);
    expect(rows.map((r) => r.user_id).sort()).toEqual([f.users.t1.id, f.users.s1.id, f.users.p1.id].sort());
  });
});

describe('timetable', () => {
  let periods;
  it('the bell schedule cannot overlap', async () => {
    expect((await A.put('/api/timetable/periods', { periods: [{ name: 'P1', starts_at: '08:00', ends_at: '09:00' }, { name: 'P2', starts_at: '08:30', ends_at: '09:30' }] })).status).toBe(400);
    const ok = await A.put('/api/timetable/periods', { periods: [
      { name: 'P1', starts_at: '08:00', ends_at: '08:45' }, { name: 'P2', starts_at: '08:45', ends_at: '09:30' },
      { name: 'Break', starts_at: '09:30', ends_at: '10:00', is_break: true }, { name: 'P3', starts_at: '10:00', ends_at: '10:45' },
    ] });
    expect(ok.status).toBe(200);
    periods = (await A.get('/api/timetable/periods')).body;
    expect(periods.map((p) => p.name)).toEqual(['P1', 'P2', 'Break', 'P3']);
    expect((await t1.put('/api/timetable/periods', { periods: [] })).status).toBe(403);
  });

  it('slots refuse section, teacher and room clashes in plain words', async () => {
    const room = await A.post('/api/timetable/rooms', { name: 'Lab', code: 'LAB1', kind: 'lab' });
    const one = await A.post('/api/timetable/slots', { section_id: f.sections.A1.id, offering_id: f.subjects.A1math.id, weekday: 1, period_id: periods[0].id, room_id: room.body.id });
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(one.body.teacher_id).toBe(f.teachers.T1.id); // the course's teacher by default
    const sectionClash = await A.post('/api/timetable/slots', { section_id: f.sections.A1.id, weekday: 1, period_id: periods[0].id });
    expect(sectionClash.status).toBe(409);
    expect(sectionClash.body.error).toContain('section already has a class');
    const teacherClash = await A.post('/api/timetable/slots', { section_id: f.sections.A2.id, teacher_id: f.teachers.T1.id, weekday: 1, period_id: periods[0].id });
    expect(teacherClash.body.error).toContain('teacher is already teaching');
    const roomClash = await A.post('/api/timetable/slots', { section_id: f.sections.A2.id, room_id: room.body.id, weekday: 1, period_id: periods[0].id });
    expect(roomClash.body.error).toContain('room is already in use');
    expect((await A.post('/api/timetable/slots', { section_id: f.sections.A2.id, weekday: 1, period_id: periods[2].id })).status).toBe(400); // a break
  });

  it('teacher unavailability is respected', async () => {
    await A.put(`/api/timetable/teachers/${f.teachers.T2.id}/unavailability`, { entries: [{ weekday: 2, period_id: null }] });
    const res = await A.post('/api/timetable/slots', { section_id: f.sections.A2.id, teacher_id: f.teachers.T2.id, weekday: 2, period_id: periods[0].id });
    expect(res.body.code).toBe('TEACHER_UNAVAILABLE');
  });

  it('the generator fills periods per week without clashes', async () => {
    await fixture.pool.query(`UPDATE course_offerings SET periods_per_week = 4 WHERE id = $1`, [f.subjects.A2math.id]);
    const preview = await A.post('/api/timetable/generate', { section_ids: [f.sections.A2.id] });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.slots).toHaveLength(4);
    expect(new Set(preview.body.slots.map((s) => s.weekday)).size).toBe(4); // spread over different days
    expect(preview.body.slots.some((s) => s.weekday === 2)).toBe(false); // T2 is away on Tuesdays
    const applied = await A.post('/api/timetable/generate', { section_ids: [f.sections.A2.id], apply: true });
    expect(applied.body.applied).toBe(true);
    const { rows } = await fixture.pool.query(`SELECT count(*)::int n FROM timetable_slots WHERE section_id = $1`, [f.sections.A2.id]);
    expect(rows[0].n).toBe(4);
  });

  it('a substitute covers a class; the week view shows it and hides holidays', async () => {
    const slot = (await fixture.pool.query(`SELECT id FROM timetable_slots WHERE section_id = $1 AND weekday = 1`, [f.sections.A1.id])).rows[0];
    const monday = '2026-09-14';
    const t3 = (await fixture.pool.query(`INSERT INTO teachers (institution_id, first_name, last_name, email) VALUES ($1,'Tara','T','t3@alpha.test') RETURNING id`, [f.institutions.A.id])).rows[0];
    const free = await A.get(`/api/timetable/substitutes?slot_id=${slot.id}&date=${monday}`);
    expect(free.body.map((t) => t.id)).toContain(t3.id);
    expect(free.body.map((t) => t.id)).not.toContain(f.teachers.T1.id);
    expect((await A.post('/api/timetable/substitutions', { slot_id: slot.id, date: '2026-09-15', substitute_teacher_id: f.teachers.T2.id })).status).toBe(400); // not a Monday
    expect((await A.post('/api/timetable/substitutions', { slot_id: slot.id, date: monday, substitute_teacher_id: f.teachers.T2.id, reason: 'Training' })).status).toBe(201);
    const t2week = await as(f.tokens.t2).get(`/api/timetable/me?week_of=${monday}`);
    const mon = t2week.body.days.find((d) => d.date === monday);
    expect(mon.slots.some((s) => s.id === slot.id && s.substitute?.teacher_id === f.teachers.T2.id)).toBe(true);
    await A.post('/api/institution/holidays', { name: 'Founders day', starts_on: '2026-09-21' });
    const s1week = await as(f.tokens.s1).get('/api/timetable/me?week_of=2026-09-21');
    const hol = s1week.body.days.find((d) => d.date === '2026-09-21');
    expect(hol.holiday).toBe('Founders day');
    expect(hol.slots).toEqual([]);
  });
});
