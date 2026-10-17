// Institution reports: attendance, results, fee collection, defaulters, teacher workload,
// course engagement, OBE attainment and the admissions funnel — each a table built from the
// caller's institution (row-level security applies), exportable as CSV, Excel or PDF, and
// emailable on a schedule (the email carries a signed download link that expires in 7 days).
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import writeXlsxFile from 'write-excel-file/node';
import { REPORTS, type ReportKey } from '@acadex/shared';
import { getConfig } from '../config';
import { db, runAsTenant, runAsSystem } from '../db/context';
import { defineJob } from '../jobs/queue';
import { storage } from '../storage';
import { toCsv, type Cell } from './export';
import { minutesIn, todayIn } from './locale';
import { logger } from './logger';
import { sendEmail } from './mailer';
import { offeringAttainment } from './outcomes';

export interface ReportFilters {
  from?: string;
  to?: string;
  campus_id?: number | null;
  section_id?: number | null;
  offering_id?: number | null;
  series_id?: number | null;
}
export interface ReportTable {
  title: string;
  columns: string[];
  rows: Cell[][];
  /** a chart of one numeric column against the first column */
  chart?: { label: number; value: number };
}

export const REPORT_TITLES: Record<ReportKey, string> = {
  attendance: 'Attendance',
  results: 'Results',
  fee_collection: 'Fee collection',
  defaulters: 'Fee defaulters',
  teacher_workload: 'Teacher workload',
  course_engagement: 'Course engagement',
  obe_attainment: 'Outcome attainment (OBE)',
  admissions_funnel: 'Admissions funnel',
};

const defaultRange = (f: ReportFilters) => {
  const to = f.to ?? new Date().toISOString().slice(0, 10);
  const from = f.from ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
};

export async function buildReport(institutionId: number, key: ReportKey, f: ReportFilters): Promise<ReportTable> {
  const { from, to } = defaultRange(f);
  const campus = f.campus_id ?? null;
  const section = f.section_id ?? null;
  const title = `${REPORT_TITLES[key]} — ${from} to ${to}`;
  switch (key) {
    case 'attendance': {
      const { rows } = await db.query(
        `SELECT st.roll_no, st.first_name || ' ' || st.last_name AS name, sec.name AS section,
                count(*) FILTER (WHERE r.status = 'present')::int AS present, count(*) FILTER (WHERE r.status = 'absent')::int AS absent,
                count(*) FILTER (WHERE r.status = 'late')::int AS late, count(*) FILTER (WHERE r.status = 'excused')::int AS excused,
                count(*) FILTER (WHERE r.status = 'leave')::int AS leave,
                round(100.0 * count(*) FILTER (WHERE r.status IN ('present', 'late')) / NULLIF(count(*) FILTER (WHERE r.status IN ('present', 'late', 'absent')), 0), 1)::float AS percent
           FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id JOIN students st ON st.id = r.student_id LEFT JOIN sections sec ON sec.id = st.section_id
          WHERE r.institution_id = $1 AND s.date BETWEEN $2 AND $3 AND ($4::int IS NULL OR sec.campus_id = $4) AND ($5::int IS NULL OR st.section_id = $5)
          GROUP BY st.id, sec.name ORDER BY sec.name, st.roll_no NULLS LAST, name`,
        [institutionId, from, to, campus, section]
      );
      return { title, columns: ['Roll no', 'Student', 'Section', 'Present', 'Absent', 'Late', 'Excused', 'Leave', 'Attendance %'], rows: rows.map((r) => [r.roll_no, r.name, r.section, r.present, r.absent, r.late, r.excused, r.leave, r.percent]), chart: { label: 1, value: 8 } };
    }
    case 'results': {
      if (f.series_id) {
        const { rows } = await db.query(
          `SELECT st.roll_no, st.first_name || ' ' || st.last_name AS name, sec.name AS section, c.name AS course,
                  CASE WHEN m.absent THEN NULL ELSE m.marks + COALESCE(m.adjustment, 0) END::float AS marks, es.total_marks::float AS total,
                  CASE WHEN m.absent THEN 'absent' WHEN m.marks + COALESCE(m.adjustment, 0) >= es.pass_marks THEN 'pass' ELSE 'fail' END AS result
             FROM exam_marks m JOIN exam_sessions es ON es.id = m.session_id JOIN course_offerings o ON o.id = es.offering_id JOIN courses c ON c.id = o.course_id
             JOIN students st ON st.id = m.student_id LEFT JOIN sections sec ON sec.id = st.section_id
            WHERE m.institution_id = $1 AND es.series_id = $2 AND ($3::int IS NULL OR sec.campus_id = $3) AND ($4::int IS NULL OR st.section_id = $4)
            ORDER BY sec.name, st.roll_no NULLS LAST, c.name`,
          [institutionId, f.series_id, campus, section]
        );
        return { title: REPORT_TITLES.results, columns: ['Roll no', 'Student', 'Section', 'Course', 'Marks', 'Out of', 'Result'], rows: rows.map((r) => [r.roll_no, r.name, r.section, r.course, r.marks, r.total, r.result]) };
      }
      const { rows } = await db.query(
        `SELECT st.roll_no, st.first_name || ' ' || st.last_name AS name, sec.name AS section, c.name AS course,
                round(100.0 * sum(g.points) / NULLIF(sum(a.points), 0), 1)::float AS percent, count(g.id)::int AS graded
           FROM grades g JOIN assessments a ON a.id = g.assessment_id JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
           JOIN students st ON st.id = g.student_id LEFT JOIN sections sec ON sec.id = st.section_id
          WHERE g.institution_id = $1 AND g.released_at IS NOT NULL AND NOT g.excused AND g.released_at::date BETWEEN $2 AND $3
            AND ($4::int IS NULL OR sec.campus_id = $4) AND ($5::int IS NULL OR st.section_id = $5) AND ($6::int IS NULL OR o.id = $6)
          GROUP BY st.id, sec.name, c.name ORDER BY sec.name, st.roll_no NULLS LAST, c.name`,
        [institutionId, from, to, campus, section, f.offering_id ?? null]
      );
      return { title, columns: ['Roll no', 'Student', 'Section', 'Course', 'Score %', 'Graded items'], rows: rows.map((r) => [r.roll_no, r.name, r.section, r.course, r.percent, r.graded]) };
    }
    case 'fee_collection': {
      const { rows } = await db.query(
        `SELECT p.received_at::date AS day, p.method, count(*)::int AS payments, sum(p.amount)::float AS amount, i.currency
           FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students st ON st.id = p.student_id LEFT JOIN sections sec ON sec.id = st.section_id
          WHERE p.institution_id = $1 AND p.status IN ('succeeded', 'partially_refunded') AND p.received_at::date BETWEEN $2 AND $3 AND ($4::int IS NULL OR sec.campus_id = $4)
          GROUP BY 1, 2, i.currency ORDER BY 1, 2`,
        [institutionId, from, to, campus]
      );
      return { title, columns: ['Date', 'Method', 'Payments', 'Amount', 'Currency'], rows: rows.map((r) => [String(r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day), r.method, r.payments, r.amount, r.currency]), chart: { label: 0, value: 3 } };
    }
    case 'defaulters': {
      const { rows } = await db.query(
        `SELECT st.roll_no, st.first_name || ' ' || st.last_name AS name, sec.name AS section, count(*)::int AS invoices,
                sum(i.total - i.paid)::float AS balance, min(i.due_date) AS oldest_due, (CURRENT_DATE - min(i.due_date))::int AS days_overdue, i.currency
           FROM invoices i JOIN students st ON st.id = i.student_id LEFT JOIN sections sec ON sec.id = st.section_id
          WHERE i.institution_id = $1 AND i.status IN ('issued', 'partially_paid') AND i.due_date < CURRENT_DATE AND i.total > i.paid
            AND ($2::int IS NULL OR sec.campus_id = $2) AND ($3::int IS NULL OR st.section_id = $3)
          GROUP BY st.id, sec.name, i.currency ORDER BY balance DESC`,
        [institutionId, campus, section]
      );
      return { title: `${REPORT_TITLES.defaulters} — ${todayIn('UTC')}`, columns: ['Roll no', 'Student', 'Section', 'Overdue invoices', 'Balance', 'Oldest due', 'Days overdue', 'Currency'], rows: rows.map((r) => [r.roll_no, r.name, r.section, r.invoices, r.balance, String(r.oldest_due instanceof Date ? r.oldest_due.toISOString().slice(0, 10) : r.oldest_due), r.days_overdue, r.currency]) };
    }
    case 'teacher_workload': {
      const { rows } = await db.query(
        `SELECT t.first_name || ' ' || t.last_name AS name,
                (SELECT count(DISTINCT ss.offering_id) FROM section_staff ss WHERE ss.teacher_id = t.id)::int AS courses,
                (SELECT count(DISTINCT ss.section_id) FROM section_staff ss WHERE ss.teacher_id = t.id)::int AS sections,
                (SELECT count(*) FROM timetable_slots ts WHERE ts.teacher_id = t.id)::int AS periods_per_week,
                (SELECT count(*) FROM submissions s JOIN assessments a ON a.id = s.assessment_id JOIN section_staff ss ON ss.offering_id = a.offering_id AND ss.teacher_id = t.id
                  WHERE s.status = 'submitted' AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.assessment_id = s.assessment_id AND g.student_id = s.student_id AND g.points IS NOT NULL))::int AS to_grade,
                (SELECT count(*) FROM assessments a JOIN section_staff ss ON ss.offering_id = a.offering_id AND ss.teacher_id = t.id WHERE a.created_at::date BETWEEN $2 AND $3)::int AS work_set
           FROM teachers t WHERE t.institution_id = $1 AND t.deleted_at IS NULL AND ($4::int IS NULL OR t.campus_id = $4) ORDER BY periods_per_week DESC, name`,
        [institutionId, from, to, campus]
      );
      return { title, columns: ['Teacher', 'Courses', 'Sections', 'Periods / week', 'To grade', 'Work set'], rows: rows.map((r) => [r.name, r.courses, r.sections, r.periods_per_week, r.to_grade, r.work_set]), chart: { label: 0, value: 3 } };
    }
    case 'course_engagement': {
      const { rows } = await db.query(
        `SELECT c.name AS course, sec.name AS section,
                (SELECT count(*) FROM content_progress cp JOIN content_items ci ON ci.id = cp.item_id JOIN modules m ON m.id = ci.module_id WHERE m.offering_id = o.id AND cp.updated_at::date BETWEEN $2 AND $3)::int AS views,
                (SELECT count(*) FROM content_progress cp JOIN content_items ci ON ci.id = cp.item_id JOIN modules m ON m.id = ci.module_id WHERE m.offering_id = o.id AND cp.status = 'done')::int AS completed_items,
                (SELECT count(*) FROM submissions s JOIN assessments a ON a.id = s.assessment_id WHERE a.offering_id = o.id AND s.submitted_at::date BETWEEN $2 AND $3)::int AS submissions,
                (SELECT count(*) FROM submissions s JOIN assessments a ON a.id = s.assessment_id WHERE a.offering_id = o.id AND s.late AND s.submitted_at::date BETWEEN $2 AND $3)::int AS late,
                (SELECT count(*) FROM discussion_posts p JOIN discussions d ON d.id = p.discussion_id WHERE d.offering_id = o.id AND p.created_at::date BETWEEN $2 AND $3)::int AS posts
           FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
          WHERE o.institution_id = $1 AND ($4::int IS NULL OR sec.campus_id = $4) AND ($5::int IS NULL OR o.section_id = $5)
          ORDER BY views DESC, c.name`,
        [institutionId, from, to, campus, section]
      );
      return { title, columns: ['Course', 'Section', 'Views', 'Items completed', 'Submissions', 'Late', 'Discussion posts'], rows: rows.map((r) => [r.course, r.section, r.views, r.completed_items, r.submissions, r.late, r.posts]), chart: { label: 0, value: 2 } };
    }
    case 'obe_attainment': {
      const { rows: offers } = await db.query<{ id: number; course: string; section: string | null }>(
        `SELECT o.id, c.name AS course, sec.name AS section FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
          WHERE o.institution_id = $1 AND ($2::int IS NULL OR o.id = $2) AND ($3::int IS NULL OR o.section_id = $3)
            AND EXISTS (SELECT 1 FROM learning_outcomes lo WHERE lo.course_id = o.course_id AND lo.level = 'course') ORDER BY c.name LIMIT 100`,
        [institutionId, f.offering_id ?? null, section]
      );
      const out: Cell[][] = [];
      for (const o of offers) for (const a of await offeringAttainment(o.id, true)) out.push([o.course, o.section, a.code, a.description, a.students, a.attainment_percent, a.target_percent, a.met == null ? '' : a.met ? 'met' : 'not met']);
      return { title: REPORT_TITLES.obe_attainment, columns: ['Course', 'Section', 'CLO', 'Outcome', 'Students', 'Attainment %', 'Target %', 'Target'], rows: out };
    }
    case 'admissions_funnel': {
      const { rows } = await db.query(
        `SELECT f.title AS form, count(*)::int AS applications,
                count(*) FILTER (WHERE a.status NOT IN ('submitted', 'withdrawn'))::int AS reviewed,
                count(*) FILTER (WHERE a.status IN ('tested', 'offered', 'accepted', 'enrolled', 'declined', 'waitlisted') OR a.test_score IS NOT NULL)::int AS tested,
                count(*) FILTER (WHERE a.status IN ('offered', 'accepted', 'enrolled', 'declined'))::int AS offered,
                count(*) FILTER (WHERE a.status IN ('accepted', 'enrolled'))::int AS accepted,
                count(*) FILTER (WHERE a.status = 'enrolled')::int AS enrolled
           FROM applications a JOIN admission_forms f ON f.id = a.form_id
          WHERE a.institution_id = $1 AND a.created_at::date BETWEEN $2 AND $3 GROUP BY f.id ORDER BY applications DESC`,
        [institutionId, from, to]
      );
      return { title, columns: ['Form', 'Applications', 'Reviewed', 'Tested', 'Offered', 'Accepted', 'Enrolled'], rows: rows.map((r) => [r.form, r.applications, r.reviewed, r.tested, r.offered, r.accepted, r.enrolled]), chart: { label: 0, value: 1 } };
    }
  }
}

export async function renderReport(t: ReportTable, format: 'csv' | 'xlsx' | 'pdf', institutionName = 'Acadex'): Promise<{ body: Buffer; contentType: string; ext: string }> {
  if (format === 'csv') return { body: Buffer.from(toCsv(t.columns, t.rows), 'utf8'), contentType: 'text/csv; charset=utf-8', ext: 'csv' };
  if (format === 'xlsx') {
    const data = [
      t.columns.map((h) => ({ value: h, fontWeight: 'bold' as const })),
      ...t.rows.map((r) => r.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: String(v ?? ''), type: String }))),
    ];
    const buf = (await writeXlsxFile(data as never, { buffer: true } as never)) as unknown as Buffer;
    return { body: Buffer.from(buf), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  }
  const doc = new PDFDocument({ size: 'A4', layout: t.columns.length > 6 ? 'landscape' : 'portrait', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((r) => doc.on('end', () => r()));
  doc.fontSize(14).text(institutionName, { continued: false }).fontSize(11).fillColor('#444').text(t.title).moveDown(0.6).fillColor('#000');
  const width = doc.page.width - 72;
  const colW = width / t.columns.length;
  const row = (cells: Cell[], bold = false) => {
    const y = doc.y;
    doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica');
    let h = 0;
    cells.forEach((c, i) => {
      const s = c == null ? '' : String(c);
      doc.text(s, 36 + i * colW, y, { width: colW - 4 });
      h = Math.max(h, doc.heightOfString(s, { width: colW - 4 }));
    });
    doc.y = y + h + 4;
    if (doc.y > doc.page.height - 50) doc.addPage();
  };
  row(t.columns, true);
  for (const r of t.rows.slice(0, 5000)) row(r);
  if (!t.rows.length) doc.fontSize(9).text('No rows.');
  doc.end();
  await done;
  return { body: Buffer.concat(chunks), contentType: 'application/pdf', ext: 'pdf' };
}

// ---------------------------------------------------------------- signed downloads and schedules

const sign = (key: string, exp: number) => crypto.createHmac('sha256', getConfig().jwtSecret).update(`report:${key}:${exp}`).digest('base64url');
export const downloadUrl = (key: string, exp: number) => `${getConfig().apiPublicUrl}/public/reports/download?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, exp)}`;
export function verifyDownload(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const want = sign(key, exp);
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

interface ScheduleRow {
  id: number;
  institution_id: number;
  report: ReportKey;
  filters: ReportFilters;
  format: 'csv' | 'xlsx' | 'pdf';
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  last_sent_at: Date | null;
  timezone: string;
  name: string;
}

/** Sends one schedule now. */
export async function sendSchedule(s: ScheduleRow): Promise<void> {
  const table = await runAsTenant(s.institution_id, () => buildReport(s.institution_id, s.report, s.filters));
  const file = await renderReport(table, s.format, s.name);
  const key = `reports/${s.institution_id}/${s.id}-${crypto.randomBytes(8).toString('hex')}.${file.ext}`;
  await storage().put(key, file.body, file.contentType);
  const exp = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const link = downloadUrl(key, exp);
  for (const to of s.recipients) {
    await sendEmail({ to, subject: `${s.name}: ${REPORT_TITLES[s.report]} (${s.frequency})`, text: `${table.title}\n${table.rows.length} rows.\n\nDownload (${file.ext.toUpperCase()}, link valid for 7 days): ${link}\n\nYou get this because a scheduled report was set up in Acadex.`, template: 'report', institutionId: s.institution_id });
  }
  await runAsSystem(() => db.query(`UPDATE report_schedules SET last_sent_at = now() WHERE id = $1`, [s.id]));
}

/** Hourly: schedules due at 07:00 local time (weekly on Mondays, monthly on the 1st). */
export const reportScheduleJob = defineJob<{ now?: string }>({
  name: 'reports.scheduled',
  cron: '5 * * * *',
  async run({ now }) {
    const at = now ? new Date(now) : new Date();
    const list = await runAsSystem(
      async () =>
        (
          await db.query<ScheduleRow>(
            `SELECT s.id, s.institution_id, s.report, s.filters, s.format, s.frequency, s.recipients, s.last_sent_at, i.timezone, i.name
               FROM report_schedules s JOIN institutions i ON i.id = s.institution_id WHERE s.enabled AND i.status = 'active'
                AND (s.last_sent_at IS NULL OR s.last_sent_at < $1::timestamptz - interval '20 hours')`,
            [at]
          )
        ).rows
    );
    for (const s of list) {
      if (Math.floor(minutesIn(s.timezone, at) / 60) !== 7) continue;
      const day = todayIn(s.timezone, at);
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, weekday: 'short' }).format(at);
      if (s.frequency === 'weekly' && weekday !== 'Mon') continue;
      if (s.frequency === 'monthly' && !day.endsWith('-01')) continue;
      try {
        await sendSchedule(s);
      } catch (e) {
        logger.error({ err: e, schedule: s.id }, 'scheduled report failed');
      }
    }
  },
});

export const isReport = (k: string): k is ReportKey => (REPORTS as readonly string[]).includes(k);
