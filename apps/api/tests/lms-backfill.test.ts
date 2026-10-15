// Migration 0011 moves the old assignments, submissions, marks, day attendance and timetable into
// the LMS model. Build a database with legacy rows, apply 0011, and check each landed correctly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/db/migrate';

const base = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
const urlFor = (db: string) => Object.assign(new URL(base.toString()), { pathname: `/${db}` }).toString();
const admin = new pg.Pool({ connectionString: urlFor('postgres') });
const DB = 'acadex_mig_lms_backfill';
let pool: pg.Pool;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
const one = async (sql: string, params: unknown[] = []) => (await q<{ id: number }>(sql, params))[0]!.id;

let mathOffering = 0;
let ali = 0;
let sara = 0;

beforeAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  pool = new pg.Pool({ connectionString: urlFor(DB) });
  await migrate(pool, { log: () => {}, until: 'drizzle:0010_lms_tables' });

  const i = await one(`INSERT INTO institutions (name, slug) VALUES ('Old School', 'old') RETURNING id`);
  const year = await one(`INSERT INTO academic_years (institution_id, name, starts_on, ends_on, is_current) VALUES ($1, '2026', '2026-04-01', '2027-03-31', true) RETURNING id`, [i]);
  await q(`INSERT INTO terms (institution_id, academic_year_id, name, starts_on, ends_on) VALUES ($1, $2, 'Term 1', '2026-04-01', '2026-09-30')`, [i, year]);
  const sec = await one(`INSERT INTO sections (institution_id, code, name, label, academic_year_id) VALUES ($1, 'C1', 'Class I', 'A', $2) RETURNING id`, [i, year]);
  const math = await one(`INSERT INTO courses (institution_id, code, name) VALUES ($1, 'MAT', 'Mathematics') RETURNING id`, [i]);
  const eng = await one(`INSERT INTO courses (institution_id, code, name) VALUES ($1, 'ENG', 'English') RETURNING id`, [i]);
  mathOffering = await one(`INSERT INTO course_offerings (institution_id, section_id, course_id) VALUES ($1, $2, $3) RETURNING id`, [i, sec, math]);
  await q(`INSERT INTO course_offerings (institution_id, section_id, course_id) VALUES ($1, $2, $3)`, [i, sec, eng]);
  const t = await one(`INSERT INTO teachers (institution_id, first_name, last_name, email) VALUES ($1, 'Sana', 'Riaz', 'sana@old.test') RETURNING id`, [i]);
  await q(`INSERT INTO users (institution_id, role, email, full_name, ref_id) VALUES ($1, 'teacher', 'sana@old.test', 'Sana Riaz', $2)`, [i, t]);
  ali = await one(`INSERT INTO students (institution_id, first_name, last_name, email, section_id) VALUES ($1, 'Ali', 'Khan', 'ali@old.test', $2) RETURNING id`, [i, sec]);
  sara = await one(`INSERT INTO students (institution_id, first_name, last_name, email, section_id) VALUES ($1, 'Sara', 'Malik', 'sara@old.test', $2) RETURNING id`, [i, sec]);

  const a = await one(
    `INSERT INTO legacy_assignments (institution_id, section_id, offering_id, teacher_id, title, description, due_date)
     VALUES ($1, $2, $3, $4, 'Fractions', 'Do 1 < 2 & more', '2026-05-10') RETURNING id`, [i, sec, mathOffering, t]
  );
  await q(`INSERT INTO legacy_submissions (institution_id, assignment_id, student_id, title, file_link, grade) VALUES ($1, $2, $3, 'my work', 'https://x.test/f', 'A')`, [i, a, ali]);
  await q(`INSERT INTO legacy_submissions (institution_id, assignment_id, student_id, title) VALUES ($1, $2, $3, 'late work')`, [i, a, sara]);
  for (const [s, marks] of [[ali, 18], [sara, 12]] as const)
    await q(
      `INSERT INTO legacy_grades (institution_id, student_id, section_id, offering_id, assignment_type, assignment_name, obtained_marks, total_marks)
       VALUES ($1, $2, $3, $4, 'quiz', 'Quiz 1', $5, 20)`, [i, s, sec, mathOffering, marks]
    );
  await q(
    `INSERT INTO legacy_student_attendance (institution_id, student_id, section_id, att_date, status)
     VALUES ($1, $2, $4, '2026-05-04', 'Present'), ($1, $3, $4, '2026-05-04', 'Absent'), ($1, $2, $4, '2026-05-05', 'Leave')`, [i, ali, sara, sec]
  );
  await q(
    `INSERT INTO legacy_timetable (institution_id, section_id, day_of_week, time_slot, subject, teacher_id)
     VALUES ($1, $2, 'Monday', '08:00-08:45', 'Mathematics', $3), ($1, $2, 'Monday', '08:45-09:30', 'English', NULL),
            ($1, $2, 'tuesday', '08:00-08:45', 'Art', NULL), ($1, $2, 'Friday', 'after lunch', 'Games', NULL)`, [i, sec, t]
  );

  await migrate(pool, { log: () => {} });
}, 180000);

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.end();
});

describe('LMS backfill (0011)', () => {
  it('turns old assignments into published assessments with escaped instructions', async () => {
    const rows = await q<Record<string, unknown>>(`SELECT offering_id, kind, title, instructions_html, status, due_at, created_by FROM assessments WHERE title = 'Fractions'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ offering_id: mathOffering, kind: 'assignment', status: 'published', instructions_html: '<p>Do 1 &lt; 2 &amp; more</p>' });
    expect(rows[0]!.created_by).not.toBeNull();
    // 23:59 in Asia/Karachi (UTC+5)
    expect((rows[0]!.due_at as Date).toISOString()).toBe('2026-05-10T18:59:00.000Z');
  });

  it('moves submissions with a version each, and letter grades become released feedback', async () => {
    const subs = await q(`SELECT s.student_id, s.status, v.link_url, v.text_html FROM submissions s JOIN submission_versions v ON v.submission_id = s.id ORDER BY s.student_id`);
    expect(subs).toEqual([
      { student_id: ali, status: 'submitted', link_url: 'https://x.test/f', text_html: '<p>my work</p>' },
      { student_id: sara, status: 'submitted', link_url: '', text_html: '<p>late work</p>' },
    ]);
    const g = await q(`SELECT g.student_id, g.feedback_html, g.status FROM grades g JOIN assessments a ON a.id = g.assessment_id WHERE a.title = 'Fractions'`);
    expect(g).toEqual([{ student_id: ali, feedback_html: '<p>Grade: A</p>', status: 'released' }]);
  });

  it('turns marks into a category, one assessment per test, and released grades', async () => {
    const cats = await q(`SELECT name FROM grade_categories WHERE offering_id = $1`, [mathOffering]);
    expect(cats).toEqual([{ name: 'Quiz' }]);
    const a = await q(`SELECT kind, title, points FROM assessments WHERE title = 'Quiz 1'`);
    expect(a).toEqual([{ kind: 'quiz', title: 'Quiz 1', points: '20.00' }]);
    const g = await q(`SELECT g.student_id, g.points, g.status FROM grades g JOIN assessments a ON a.id = g.assessment_id WHERE a.title = 'Quiz 1' ORDER BY g.student_id`);
    expect(g).toEqual([
      { student_id: ali, points: '18.00', status: 'released' },
      { student_id: sara, points: '12.00', status: 'released' },
    ]);
  });

  it('turns day attendance into day sessions with lowercase statuses', async () => {
    const rows = await q(
      `SELECT s.date, s.kind, r.student_id, r.status FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id ORDER BY s.date, r.student_id`
    );
    expect(rows).toEqual([
      { date: '2026-05-04', kind: 'day', student_id: ali, status: 'present' },
      { date: '2026-05-04', kind: 'day', student_id: sara, status: 'absent' },
      { date: '2026-05-05', kind: 'day', student_id: ali, status: 'leave' },
    ]);
  });

  it('builds a bell schedule and timetable slots from the free-text timetable', async () => {
    const periods = await q(`SELECT name, starts_at, ends_at, position FROM periods ORDER BY position`);
    expect(periods).toEqual([
      { name: 'Period 1', starts_at: '08:00:00', ends_at: '08:45:00', position: 1 },
      { name: 'Period 2', starts_at: '08:45:00', ends_at: '09:30:00', position: 2 },
    ]);
    const slots = await q<{ weekday: number; course: string | null; term_id: number | null }>(
      `SELECT s.weekday, c.name AS course, s.term_id FROM timetable_slots s
         LEFT JOIN course_offerings o ON o.id = s.offering_id LEFT JOIN courses c ON c.id = o.course_id
        ORDER BY s.weekday, s.period_id`
    );
    // the unparseable "after lunch" row is skipped; Art has no offering
    expect(slots.map((s) => [s.weekday, s.course])).toEqual([[1, 'Mathematics'], [1, 'English'], [2, null]]);
    expect(slots.every((s) => s.term_id !== null)).toBe(true);
  });

  it('drops the legacy tables and leaves no helper columns', async () => {
    const legacy = await q(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'legacy_%'`);
    expect(legacy).toEqual([]);
    const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'assessments' AND column_name LIKE '\\_legacy%'`);
    expect(cols).toEqual([]);
  });

  it('enables tenant isolation on the new tables', async () => {
    const rows = await q<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname IN ('assessments', 'grades', 'attendance_records', 'push_subscriptions') AND relrowsecurity AND relforcerowsecurity ORDER BY relname`
    );
    expect(rows.map((r) => r.relname)).toEqual(['assessments', 'attendance_records', 'grades', 'push_subscriptions']);
  });
});
