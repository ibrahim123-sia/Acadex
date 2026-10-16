// Migration 0014 turns the old fee records into invoices with payments, and the old exam
// schedule into exam series with papers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/db/migrate';

const base = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
const urlFor = (db: string) => Object.assign(new URL(base.toString()), { pathname: `/${db}` }).toString();
const admin = new pg.Pool({ connectionString: urlFor('postgres') });
const DB = 'acadex_mig_finance_backfill';
let pool: pg.Pool;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
const one = async (sql: string, params: unknown[] = []) => (await q<{ id: number }>(sql, params))[0]!.id;
let ali = 0;
let sara = 0;
let math = 0;

beforeAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  pool = new pg.Pool({ connectionString: urlFor(DB) });
  await migrate(pool, { log: () => {}, until: 'drizzle:0013_exams_finance_admissions' });
  const i = await one(`INSERT INTO institutions (name, slug, currency) VALUES ('Old School', 'old', 'PKR') RETURNING id`);
  const sec = await one(`INSERT INTO sections (institution_id, code, name) VALUES ($1, 'C1', 'Class I') RETURNING id`, [i]);
  const course = await one(`INSERT INTO courses (institution_id, code, name) VALUES ($1, 'MAT', 'Mathematics') RETURNING id`, [i]);
  math = await one(`INSERT INTO course_offerings (institution_id, section_id, course_id) VALUES ($1, $2, $3) RETURNING id`, [i, sec, course]);
  ali = await one(`INSERT INTO students (institution_id, first_name, last_name, email, section_id) VALUES ($1, 'Ali', 'Khan', 'a@o.test', $2) RETURNING id`, [i, sec]);
  sara = await one(`INSERT INTO students (institution_id, first_name, last_name, email, section_id) VALUES ($1, 'Sara', 'Malik', 's@o.test', $2) RETURNING id`, [i, sec]);
  await q(
    `INSERT INTO tuition_fee (institution_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status, payment_date)
     VALUES ($1, 'RCP-1', $2, 1000, 400, 600, 'Partial', '2026-05-01'), ($1, 'RCP-2', $3, 1000, 0, 1000, 'Pending', NULL)`,
    [i, ali, sara]
  );
  await q(
    `INSERT INTO exam_schedule (institution_id, section_id, exam_name, subject, exam_date, time_slot, total_marks)
     VALUES ($1, $2, 'Mid-term', 'Mathematics', '2026-06-01', '09:00-11:00', 50), ($1, $2, 'Mid-term', 'Unknown subject', '2026-06-02', '', 50)`,
    [i, sec]
  );
  await migrate(pool, { log: () => {} });
}, 180000);

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.end();
});

describe('fees and exams backfill (0014)', () => {
  it('old fee records become invoices with a fee line and a payment for what was paid', async () => {
    const inv = await q(`SELECT student_id, status, total, paid, currency FROM invoices ORDER BY student_id`);
    expect(inv).toEqual([
      { student_id: ali, status: 'partially_paid', total: '1000.00', paid: '400.00', currency: 'PKR' },
      { student_id: sara, status: 'issued', total: '1000.00', paid: '0.00', currency: 'PKR' },
    ]);
    expect(await q(`SELECT head, amount FROM invoice_items ORDER BY id`)).toEqual([
      { head: 'Tuition', amount: '1000.00' },
      { head: 'Tuition', amount: '1000.00' },
    ]);
    expect(await q(`SELECT student_id, receipt_no, amount, method FROM payments`)).toEqual([{ student_id: ali, receipt_no: 'RCP-1', amount: '400.00', method: 'cash' }]);
  });

  it('the old exam schedule becomes a series with papers for the courses it names', async () => {
    expect(await q(`SELECT name, status FROM exam_series`)).toEqual([{ name: 'Mid-term', status: 'scheduled' }]);
    expect(await q(`SELECT offering_id, date, starts_at, ends_at, total_marks FROM exam_sessions`)).toEqual([
      { offering_id: math, date: '2026-06-01', starts_at: '09:00:00', ends_at: '11:00:00', total_marks: '50.00' },
    ]);
  });

  it('drops the legacy tables and protects the new ones', async () => {
    expect(await q(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('tuition_fee', 'exam_schedule')`)).toEqual([]);
    const rls = await q<{ relname: string }>(`SELECT relname FROM pg_class WHERE relname IN ('invoices', 'payments', 'exam_marks', 'applications', 'payment_provider_events') AND relrowsecurity ORDER BY relname`);
    expect(rls.map((r) => r.relname)).toEqual(['applications', 'exam_marks', 'invoices', 'payment_provider_events', 'payments']);
  });
});
