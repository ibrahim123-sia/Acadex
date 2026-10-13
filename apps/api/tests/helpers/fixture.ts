// Deterministic two-tenant fixture used by the API tests.
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { signAccessToken } from '../../src/auth/tokens';
import { grantSystemRole, syncRbacCatalogue } from '../../src/rbac';

/** Superuser connection (bypasses RLS): resets, setup inserts and assertions in tests. */
export const pool = new pg.Pool({ connectionString: process.env.TEST_ADMIN_DATABASE_URL });

export const PASSWORD = 'Test@Pass123';

function assertTestDb() {
  const url = process.env.DATABASE_URL || '';
  const admin = process.env.TEST_ADMIN_DATABASE_URL || '';
  const isTestUrl = (url.includes('acadex_test') || url === process.env.TEST_DATABASE_URL) && admin.includes('acadex_test');
  if (process.env.NODE_ENV !== 'test' || !isTestUrl) {
    throw new Error(`Refusing to reset a non-test database (${url.replace(/\/\/.*@/, '//***@')})`);
  }
}

async function one(sql: string, params: unknown[]): Promise<any> {
  return (await pool.query(sql, params)).rows[0];
}

/** An access token backed by a real (2FA-verified) session, like after a login. */
export async function tokenFor(u: { id: number; token_version?: number; institution_id: number | null }): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id, expires_at, mfa_verified) VALUES ($1, now() + interval '1 day', true) RETURNING id`,
    [u.id]
  );
  return signAccessToken({ id: u.id, tv: u.token_version ?? 0, sid: rows[0].id, institution_id: u.institution_id });
}

/** Emails recorded by the development mail driver. */
export async function outbox(to?: string) {
  const { rows } = await pool.query(
    `SELECT * FROM email_outbox WHERE ($1::text IS NULL OR to_email = $1) ORDER BY id`,
    [to ?? null]
  );
  return rows;
}

/** The token from the newest emailed link of a kind ("accept-invite", "reset-password", ...). */
export async function tokenFromEmail(to: string, path: string): Promise<string> {
  const mails = await outbox(to);
  for (const m of mails.reverse()) {
    const match = new RegExp(`/${path}#token=([A-Za-z0-9_-]+)`).exec(m.text_body);
    if (match) return match[1]!;
  }
  throw new Error(`no ${path} email for ${to}`);
}

export async function resetDb() {
  assertTestDb();
  // DELETE with FK triggers disabled (needs a superuser, which the test server has) instead
  // of TRUNCATE: TRUNCATE creates new data files per table, which is very slow on Windows.
  await pool.query(`DO $$
    DECLARE r record;
    BEGIN
      SET LOCAL session_replication_role = replica;
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' LOOP
        EXECUTE format('DELETE FROM %I', r.tablename);
      END LOOP;
      FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER SEQUENCE %I RESTART', r.sequencename);
      END LOOP;
    END $$`);
  await syncRbacCatalogue(pool); // reference data: permission catalogue + built-in roles

  const hash = await bcrypt.hash(PASSWORD, 4);
    const users: Record<string, any> = {};
  const user = async (key: string, institution_id: number | null, role: string, email: string, name: string, ref_id: number | null = null) => {
    users[key] = await one(
      `INSERT INTO users (institution_id, role, email, password_hash, full_name, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [institution_id, role, email, hash, name, ref_id]
    );
    await grantSystemRole(pool, users[key].id, role, institution_id);
  };

  const institution = (name: string, slug: string) =>
    one(`INSERT INTO institutions (name, slug) VALUES ($1,$2) RETURNING *`, [name, slug]);
  const klass = (sid: number, code: string) =>
    one(`INSERT INTO classes (institution_id, code, name) VALUES ($1,$2,$3) RETURNING *`, [sid, code, `Class ${code}`]);
  const subject = (sid: number, cid: number, code: string) =>
    one(`INSERT INTO subjects (institution_id, class_id, code, name) VALUES ($1,$2,$3,$3) RETURNING *`, [sid, cid, code]);
  const teacher = (sid: number, fn: string, email: string) =>
    one(`INSERT INTO teachers (institution_id, first_name, last_name, email) VALUES ($1,$2,'T',$3) RETURNING *`, [sid, fn, email]);
  const student = (sid: number, cid: number, fn: string, email: string) =>
    one(
      `INSERT INTO students (institution_id, class_id, roll_no, first_name, last_name, email)
       VALUES ($1,$2,$3,$3,'S',$4) RETURNING *`,
      [sid, cid, fn, email]
    );
  const teaches = (sid: number, tid: number, subid: number, cid: number) =>
    pool.query(`INSERT INTO teacher_subjects (institution_id, teacher_id, subject_id, class_id) VALUES ($1,$2,$3,$4)`, [sid, tid, subid, cid]);
  const fee = (sid: number, stid: number, receipt: string) =>
    one(
      `INSERT INTO tuition_fee (institution_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status)
       VALUES ($1,$2,$3,1000,500,500,'Partial') RETURNING *`,
      [sid, receipt, stid]
    );
  const assignment = (sid: number, cid: number, subid: number, tid: number, title: string) =>
    one(
      `INSERT INTO assignments (institution_id, class_id, subject_id, teacher_id, title) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [sid, cid, subid, tid, title]
    );

  // ----- Institution A: two classes, each teacher on their own class -----
  const A = await institution('Alpha School', 'alpha');
  const A1 = await klass(A.id, 'A1');
  const A2 = await klass(A.id, 'A2');
  const A1math = await subject(A.id, A1.id, 'A1-MATH');
  const A2math = await subject(A.id, A2.id, 'A2-MATH');
  const T1 = await teacher(A.id, 'Tina', 't1@alpha.test');
  const T2 = await teacher(A.id, 'Tom', 't2@alpha.test');
  await teaches(A.id, T1.id, A1math.id, A1.id);
  await teaches(A.id, T2.id, A2math.id, A2.id);
  const S1 = await student(A.id, A1.id, 'Sara', 's1@alpha.test');
  const S2 = await student(A.id, A1.id, 'Sam', 's2@alpha.test');
  const S3 = await student(A.id, A2.id, 'Saad', 's3@alpha.test');
  const F1 = await fee(A.id, S1.id, 'RCP-A1');
  const F3 = await fee(A.id, S3.id, 'RCP-A3');
  const ASG1 = await assignment(A.id, A1.id, A1math.id, T1.id, 'A1 homework');
  const ASG2 = await assignment(A.id, A2.id, A2math.id, T2.id, 'A2 homework');

  // ----- Institution B: the other tenant -----
  const B = await institution('Beta School', 'beta');
  const B1 = await klass(B.id, 'B1');
  const B1math = await subject(B.id, B1.id, 'B1-MATH');
  const TB = await teacher(B.id, 'Bob', 'tb@beta.test');
  await teaches(B.id, TB.id, B1math.id, B1.id);
  const SB = await student(B.id, B1.id, 'Bina', 'sb@beta.test');
  const FB = await fee(B.id, SB.id, 'RCP-B1');
  const ASGB = await assignment(B.id, B1.id, B1math.id, TB.id, 'B1 homework');

  await user('super', null, 'super_admin', 'super@acadex.test', 'Super');
  await user('adminA', A.id, 'institution_admin', 'admin@alpha.test', 'Admin A');
  await user('adminB', B.id, 'institution_admin', 'admin@beta.test', 'Admin B');
  await user('t1', A.id, 'teacher', 't1@alpha.test', 'Tina T', T1.id);
  await user('t2', A.id, 'teacher', 't2@alpha.test', 'Tom T', T2.id);
  await user('tb', B.id, 'teacher', 'tb@beta.test', 'Bob T', TB.id);
  await user('s1', A.id, 'student', 's1@alpha.test', 'Sara S', S1.id);
  await user('s2', A.id, 'student', 's2@alpha.test', 'Sam S', S2.id);
  await user('s3', A.id, 'student', 's3@alpha.test', 'Saad S', S3.id);
  await user('sb', B.id, 'student', 'sb@beta.test', 'Bina S', SB.id);
  await user('p1', A.id, 'parent', 'p1@alpha.test', 'Parent of Sara');
  await pool.query(`INSERT INTO parent_children (institution_id, parent_user_id, student_id) VALUES ($1,$2,$3)`, [
    A.id,
    users.p1.id,
    S1.id,
  ]);

  const tokens: Record<string, string> = {};
  for (const [k, u] of Object.entries(users)) tokens[k] = await tokenFor(u);
  return {
    PASSWORD,
    users,
    tokens,
    institutions: { A, B },
    classes: { A1, A2, B1 },
    subjects: { A1math, A2math, B1math },
    teachers: { T1, T2, TB },
    students: { S1, S2, S3, SB },
    fees: { F1, F3, FB },
    assignments: { ASG1, ASG2, ASGB },
  };
}

export type Fixture = Awaited<ReturnType<typeof resetDb>>;
