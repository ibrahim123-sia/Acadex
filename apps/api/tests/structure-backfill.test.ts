// Migration 0008 moves existing data into the new academic structure. Build a database in the
// shape it had before (classes with subjects, guardian names on students, parent links),
// apply 0008, and check every row landed where it should.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/db/migrate';

const base = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
const urlFor = (db: string) => Object.assign(new URL(base.toString()), { pathname: `/${db}` }).toString();
const admin = new pg.Pool({ connectionString: urlFor('postgres') });
const DB = 'acadex_mig_backfill';
let pool: pg.Pool;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

beforeAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  pool = new pg.Pool({ connectionString: urlFor(DB) });
  await migrate(pool, { log: () => {}, until: 'drizzle:0007_structure_tables' });

  const [inst] = await q<{ id: number }>(
    `INSERT INTO institutions (name, slug, address, phone) VALUES ('Old School', 'old', '1 Mall Road', '042-111') RETURNING id`
  );
  const i = inst!.id;
  const [c1] = await q<{ id: number }>(`INSERT INTO sections (institution_id, code, name, label) VALUES ($1, 'C1', 'Class I', 'A') RETURNING id`, [i]);
  const [c2] = await q<{ id: number }>(`INSERT INTO sections (institution_id, code, name, label) VALUES ($1, 'C2', 'Class II', 'A') RETURNING id`, [i]);
  const [c1b] = await q<{ id: number }>(`INSERT INTO sections (institution_id, code, name, label) VALUES ($1, 'C1B', 'Class I', 'B') RETURNING id`, [i]);
  const [m1] = await q<{ id: number }>(`INSERT INTO course_offerings (institution_id, section_id, code, name) VALUES ($1, $2, 'MATC1', 'Mathematics') RETURNING id`, [i, c1!.id]);
  await q(`INSERT INTO course_offerings (institution_id, section_id, code, name) VALUES ($1, $2, 'MATC2', 'Mathematics')`, [i, c2!.id]);
  await q(`INSERT INTO course_offerings (institution_id, section_id, code, name) VALUES ($1, $2, 'URDC1', 'اردو')`, [i, c1!.id]);
  const [t] = await q<{ id: number }>(`INSERT INTO teachers (institution_id, first_name, last_name, email) VALUES ($1, 'Sana', 'Riaz', 'sana@old.test') RETURNING id`, [i]);
  await q(`INSERT INTO section_staff (institution_id, teacher_id, offering_id) VALUES ($1, $2, $3)`, [i, t!.id, m1!.id]);
  const [parent] = await q<{ id: number }>(
    `INSERT INTO users (institution_id, role, email, full_name) VALUES ($1, 'parent', 'p@old.test', 'Imran Ahmed Khan') RETURNING id`, [i]
  );
  const [s1] = await q<{ id: number }>(
    `INSERT INTO students (institution_id, first_name, last_name, email, section_id, guardian_name, guardian_phone)
     VALUES ($1, 'Ali', 'Khan', 'ali@old.test', $2, 'Imran Khan', '0300-1') RETURNING id`, [i, c1!.id]
  );
  await q(
    `INSERT INTO students (institution_id, first_name, last_name, email, section_id, guardian_name, guardian_phone)
     VALUES ($1, 'Sara', 'Malik', 'sara@old.test', $2, 'Nadia Malik', '0300-2')`, [i, c2!.id]
  );
  await q(`INSERT INTO students (institution_id, first_name, last_name, email, section_id) VALUES ($1, 'Omar', 'Ali', 'omar@old.test', $2)`, [i, c1b!.id]);
  await q(`INSERT INTO guardianships (institution_id, parent_user_id, student_id) VALUES ($1, $2, $3)`, [i, parent!.id, s1!.id]);
  const [role] = await q<{ id: number }>(`SELECT id FROM roles WHERE key = 'parent' AND institution_id IS NULL`);
  await q(`INSERT INTO user_roles (user_id, role_id, scope_type, scope_id) VALUES ($1, $2, 'institution', $3)`, [parent!.id, role!.id, i]);

  await migrate(pool, { log: () => {} });
}, 180000);

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.end();
});

describe('structure backfill (0008)', () => {
  it('creates a main campus, the current year with a term, and a default grading scheme', async () => {
    const campuses = await q(`SELECT name, code, address, phone, is_main FROM campuses`);
    expect(campuses).toEqual([{ name: 'Main campus', code: 'MAIN', address: '1 Mall Road', phone: '042-111', is_main: true }]);
    const [year] = await q<{ is_current: boolean; terms: number }>(
      `SELECT ay.is_current, (SELECT count(*)::int FROM terms t WHERE t.academic_year_id = ay.id) AS terms FROM academic_years ay`
    );
    expect(year).toEqual({ is_current: true, terms: 1 });
    expect(await q(`SELECT kind, is_default FROM grading_schemes`)).toEqual([{ kind: 'letter', is_default: true }]);
  });

  it('turns class names into program levels and links every section', async () => {
    const levels = await q(`SELECT name, sequence FROM program_levels ORDER BY sequence`);
    expect(levels).toEqual([
      { name: 'Class I', sequence: 1 },
      { name: 'Class II', sequence: 2 },
    ]);
    const unlinked = await q(`SELECT code FROM sections WHERE campus_id IS NULL OR program_level_id IS NULL OR academic_year_id IS NULL`);
    expect(unlinked).toEqual([]);
    const [{ n }] = (await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM sections s JOIN program_levels l ON l.id = s.program_level_id WHERE l.name = 'Class I'`
    )) as [{ n: number }];
    expect(n).toBe(2); // sections A and B of Class I share a level
  });

  it('builds a course catalog with one course per subject name', async () => {
    const courses = await q(`SELECT code, name FROM courses ORDER BY name`);
    expect(courses).toEqual([
      { code: 'MATHEM', name: 'Mathematics' },
      { code: 'COURSE', name: 'اردو' },
    ]);
    const offerings = await q(
      `SELECT c.name, s.code AS section, (o.term_id IS NOT NULL) AS has_term
         FROM course_offerings o JOIN courses c ON c.id = o.course_id JOIN sections s ON s.id = o.section_id ORDER BY s.code, c.name`
    );
    expect(offerings).toEqual([
      { name: 'Mathematics', section: 'C1', has_term: true },
      { name: 'اردو', section: 'C1', has_term: true },
      { name: 'Mathematics', section: 'C2', has_term: true },
    ]);
    const staff = await q(`SELECT s.code FROM section_staff ss JOIN sections s ON s.id = ss.section_id`);
    expect(staff).toEqual([{ code: 'C1' }]);
  });

  it('keeps every guardian: parent accounts and the names on student records', async () => {
    const rows = await q(
      `SELECT st.first_name AS student, g.first_name, g.last_name, g.phone, (g.user_id IS NOT NULL) AS has_account, gs.is_primary, g.custom_data
         FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id
        ORDER BY st.first_name`
    );
    expect(rows).toEqual([
      { student: 'Ali', first_name: 'Imran', last_name: 'Ahmed Khan', phone: '0300-1', has_account: true, is_primary: true, custom_data: {} },
      { student: 'Sara', first_name: 'Nadia', last_name: 'Malik', phone: '0300-2', has_account: false, is_primary: true, custom_data: {} },
    ]);
  });

  it('records the institution on role grants', async () => {
    const grants = await q(`SELECT scope_type, (institution_id = scope_id) AS same FROM user_roles`);
    expect(grants).toEqual([{ scope_type: 'institution', same: true }]);
  });

  it('audits changes with who and what', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', (SELECT id::text FROM users LIMIT 1), true), set_config('app.request_id', 'req-1', true)`);
      await client.query(`UPDATE students SET last_name = 'Khan-Niazi' WHERE first_name = 'Ali'`);
      await client.query(`UPDATE students SET last_name = last_name WHERE first_name = 'Ali'`); // no change → no entry
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const log = await q(`SELECT action, entity, changes, request_id, (user_id IS NOT NULL) AS has_user FROM audit_log WHERE entity = 'students'`);
    expect(log).toEqual([
      { action: 'update', entity: 'students', changes: { last_name: ['Khan', 'Khan-Niazi'] }, request_id: 'req-1', has_user: true },
    ]);
  });
});
