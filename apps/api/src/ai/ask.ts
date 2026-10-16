// Ask Acadex: a question in plain words → one read-only SELECT over the allow-listed ask_*
// views → the answer, with the query shown. The query runs in its own read-only transaction
// with the asker's row-level security, a time limit, and — for teachers — only their classes.
import { db, runAsTenant } from '../db/context';
import { badRequest } from '../lib/errors';
import { aiJson } from './client';
import { checkSql } from './guard';
import { askPrompt, data } from './prompts';

export const VIEW_DOCS = `- ask_students(student_id, roll_no, name, gender, status, admission_date, section_id, section, campus, program, level)
- ask_attendance(student_id, date, status [present|absent|late|excused|leave], section_id, course)
- ask_grades(student_id, section_id, course, assessment, kind, points, max_points, percent, released, graded_at)
- ask_fees(invoice, student_id, section_id, title, due_date, status, total, paid, balance, overdue)
- ask_payments(receipt_no, student_id, section_id, amount, method, received_at)
- ask_courses(offering_id, code, course, section_id, section, teachers)
- ask_staff(staff_id, name, designation, staff_type, status, department, campus)
- ask_risk(student_id, section_id, computed_on, score, level [low|medium|high])`;

export interface AskResult {
  sql: string;
  explanation: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/** sectionScope: null for the whole institution, or the section ids a teacher may see. */
export async function ask(ctx: { institutionId: number; userId: number }, question: string, sectionScope: number[] | null): Promise<AskResult> {
  const gen = await aiJson({ ...ctx, feature: 'ask' }, askPrompt(VIEW_DOCS), data('QUESTION', question));
  const checked = checkSql(gen.data.sql);
  if (!checked.ok) throw badRequest(`That question can't be answered safely: ${checked.reason}`, { sql: gen.data.sql });
  const rows = await runAsTenant(ctx.institutionId, async () => {
    await db.query(`SET TRANSACTION READ ONLY`);
    await db.query(`SELECT set_config('statement_timeout', '5000', true), set_config('app.ask_scope', $1, true)`, [sectionScope ? sectionScope.join(',') || '0' : '']);
    return (await db.query(checked.sql)).rows as Record<string, unknown>[];
  }).catch((e: Error) => {
    throw badRequest(`The query did not run: ${e.message.slice(0, 200)}`, { sql: checked.sql });
  });
  return { sql: checked.sql, explanation: gen.data.explanation, columns: rows[0] ? Object.keys(rows[0]) : [], rows: rows.slice(0, 200), truncated: rows.length > 200 };
}
