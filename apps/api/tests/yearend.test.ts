// Year end: preview, next year's classes, promotion / graduation in one go, archiving (and the
// archived year becoming read-only). Also the sign-in audit entries.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';

let f: fixture.Fixture;
let A: ReturnType<typeof as>;
let nextYear: number;
let level2: number;
const q = (sql: string, p: unknown[] = []) => fixture.pool.query(sql, p);

beforeAll(async () => {
  f = await fixture.resetDb();
  A = as(f.tokens.adminA);
  const inst = f.institutions.A;
  level2 = (await q(`INSERT INTO program_levels (institution_id, program_id, name, sequence) VALUES ($1,$2,'Level 2',2) RETURNING id`, [inst.id, inst.program.id])).rows[0].id;
  // A2 is the final level: its students graduate
  await q(`UPDATE sections SET program_level_id = $1, label = 'A' WHERE id = $2`, [level2, f.sections.A2.id]);
  await q(`UPDATE sections SET label = 'A' WHERE id = $1`, [f.sections.A1.id]);
  nextYear = (await A.post('/api/institution/academic-years', { name: '2027–28', starts_on: '2027-08-01', ends_on: '2028-07-31' })).body.id;
});

describe('year end', () => {
  it('previews moves: up a level, graduation at the top — and changes nothing', async () => {
    const p = await A.get(`/api/institution/year-end/preview?from_year_id=${f.institutions.A.year.id}&to_year_id=${nextYear}`);
    expect(p.status).toBe(200);
    const a1 = p.body.sections.find((s: { id: number }) => s.id === f.sections.A1.id);
    expect(a1).toMatchObject({ default_action: 'promoted', missing_target: true });
    const a2 = p.body.sections.find((s: { id: number }) => s.id === f.sections.A2.id);
    expect(a2.default_action).toBe('graduated');
  });

  it('creates next year’s classes for every level and the one above', async () => {
    const res = await A.post('/api/institution/year-end/prepare-sections', { from_year_id: f.institutions.A.year.id, to_year_id: nextYear });
    expect(res.status).toBe(201);
    expect(res.body.created.map((s: { code: string }) => s.code).sort()).toEqual(['A1-2027', 'A2-2027']);
    const again = await A.post('/api/institution/year-end/prepare-sections', { from_year_id: f.institutions.A.year.id, to_year_id: nextYear });
    expect(again.body.created).toEqual([]);
    const p = await A.get(`/api/institution/year-end/preview?from_year_id=${f.institutions.A.year.id}&to_year_id=${nextYear}`);
    const a1 = p.body.sections.find((s: { id: number }) => s.id === f.sections.A1.id);
    expect(a1.promote_to.name).toBe('Level 2');
    expect(p.body.moves.find((m: { student_id: number }) => m.student_id === f.students.S1.id).to_section_id).toBe(a1.promote_to.id);
  });

  it('applies all moves or none', async () => {
    const p = await A.get(`/api/institution/year-end/preview?from_year_id=${f.institutions.A.year.id}&to_year_id=${nextYear}`);
    const bad = [...p.body.moves.map((m: { student_id: number; action: string; to_section_id: number | null }) => ({ student_id: m.student_id, action: m.action, to_section_id: m.to_section_id })), { student_id: f.students.SB.id, action: 'promoted', to_section_id: p.body.moves[0].to_section_id }];
    expect((await A.post('/api/institution/year-end/promote', { moves: bad })).status).toBe(400);
    expect((await q(`SELECT count(*)::int n FROM student_promotions`)).rows[0].n).toBe(0);
    const moves = p.body.moves.map((m: { student_id: number; action: string; to_section_id: number | null }) => ({ student_id: m.student_id, action: m.action, to_section_id: m.to_section_id }));
    const ok = await A.post('/api/institution/year-end/promote', { moves });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ promoted: 2, repeated: 0, graduated: 1, left: 0 });
    const { rows } = await q(`SELECT st.status, u.is_active FROM students st JOIN users u ON u.ref_id = st.id AND u.role = 'student' WHERE st.id = $1`, [f.students.S3.id]);
    expect(rows[0]).toEqual({ status: 'graduated', is_active: false });
    const profile = await A.get(`/api/institution/students/${f.students.S1.id}`);
    expect(profile.body.promotions[0]).toMatchObject({ action: 'promoted', to_name: 'Level 2' });
  });

  it('archives the old year, which then refuses writes', async () => {
    expect((await A.post(`/api/institution/academic-years/${f.institutions.A.year.id}/archive`, {})).status).toBe(400); // current: name the next
    const res = await A.post(`/api/institution/academic-years/${f.institutions.A.year.id}/archive`, { next_current_year_id: nextYear });
    expect(res.status).toBe(200);
    const s = await A.get('/api/institution/structure');
    expect(s.body.academic_years.find((y: { id: number }) => y.id === nextYear).is_current).toBe(true);
    // the old class is read-only now
    expect((await A.patch(`/api/institution/sections/${f.sections.A1.id}`, { name: 'Renamed' })).status).toBe(409);
    const grades = await as(f.tokens.t1).put(`/api/assessments/${f.assignments.ASG1.id}/grades`, { grades: [{ student_id: f.students.S1.id, points: 5 }] });
    expect([400, 403, 409]).toContain(grades.status);
    const register = await as(f.tokens.t1).put('/api/attendance/register', { section_id: f.sections.A1.id, date: '2026-09-01', records: [] });
    expect(register.status).toBe(409);
    expect((await A.post('/api/institution/sections', { code: 'OLD', name: 'Old', academic_year_id: f.institutions.A.year.id })).status).toBe(409);
  });

  it('is only for year-end managers', async () => {
    expect((await as(f.tokens.t1).post('/api/institution/year-end/promote', { moves: [{ student_id: f.students.S1.id, action: 'left' }] })).status).toBe(403);
  });
});

describe('sign-in audit', () => {
  it('records sign-ins and failed attempts (even though the failed request rolls back)', async () => {
    await request(app).post('/api/auth/login').send({ email: 'admin@alpha.test', password: 'wrong-password' });
    await request(app).post('/api/auth/login').send({ email: 'admin@alpha.test', password: fixture.PASSWORD });
    const { rows } = await q(`SELECT action, detail FROM audit_log WHERE user_id = $1 AND entity = 'Auth' ORDER BY id`, [f.users.adminA.id]);
    expect(rows.map((r) => r.action)).toEqual(['sign_in_failed', 'sign_in']);
    expect(rows[0].detail).toBe('wrong password');
  });
});
