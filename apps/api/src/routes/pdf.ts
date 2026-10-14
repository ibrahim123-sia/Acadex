import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { idParam, resolveTerminology, type InstitutionType } from '@acadex/shared';
import { courseResults } from '../lib/grading';
import { db } from '../db/context';
import { assertCanViewStudent } from '../lib/access';
import { notFound } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/locale';
import { institutionSettings } from '../lib/institution';
import { auth, currentUser, requireInstitutionUser, institutionId } from '../middleware/auth';

const router = Router();
// Institution-scoped documents; access is decided per student by assertCanViewStudent.
router.use(auth, requireInstitutionUser);

// built-in PDF fonts lack U+202F/U+00A0, which some locales put between amount and symbol
const pdfSafe = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ');

// Report card PDF: per-course results graded with the student's scheme (program override or
// the institution default), GPA for GPA schemes, attendance, in the institution's own words.
router.get('/report-card/:studentId', async (req, res) => {
  const s = institutionId(req);
  const { studentId } = idParam('studentId').parse(req.params);
  await assertCanViewStudent(currentUser(req), studentId, { allowTeachers: true, guardian: 'grades' });
  const stu = (
    await db.query(
      `SELECT st.first_name, st.last_name, st.roll_no, st.gender, st.id, c.name section_name, c.label section_label, ay.name academic_year
         FROM students st LEFT JOIN sections c ON c.id=st.section_id LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
        WHERE st.id=$1 AND st.institution_id=$2`,
      [studentId, s]
    )
  ).rows[0];
  const institution = await institutionSettings(s);
  if (!stu || !institution) throw notFound('Student not found');
  const { rows: instRow } = await db.query<{ type: InstitutionType; settings: { terminology?: object } }>(`SELECT type, settings FROM institutions WHERE id = $1`, [s]);
  const terms = resolveTerminology(instRow[0]!.type, instRow[0]!.settings?.terminology as never);
  const { scheme, results, overall } = await courseResults(studentId, s);
  const att = (
    await db.query<{ status: string; c: number }>(
      `SELECT status, count(*)::int c FROM student_attendance WHERE student_id=$1 AND institution_id=$2 GROUP BY status`,
      [studentId, s]
    )
  ).rows;
  const present = att.find((a) => a.status === 'Present')?.c || 0;
  const totalAtt = att.reduce((x, a) => x + a.c, 0);
  const isGpa = scheme.kind === 'gpa';
  const hasCredits = results.some((r) => r.credits != null);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="report-card-${stu.roll_no || stu.id}.pdf"`);
  doc.pipe(res);
  const accent = institution.primary_color || '#4F46E5';

  doc.rect(0, 0, doc.page.width, 90).fill(accent);
  doc.fillColor('#fff').fontSize(22).text(pdfSafe(institution.name), 50, 30);
  doc.fontSize(12).fillColor('#e5e7eb').text(`${terms.student.one} report card${stu.academic_year ? ` · ${stu.academic_year}` : ''}`, 50, 60);

  doc.fontSize(11).fillColor('#374151');
  const y0 = 120;
  doc.text(pdfSafe(`Name: ${stu.first_name} ${stu.last_name}`), 50, y0);
  doc.text(`Roll no.: ${stu.roll_no || '—'}`, 320, y0);
  doc.text(pdfSafe(`${terms.section.one}: ${stu.section_name ? `${stu.section_name}${stu.section_label ? ` ${stu.section_label}` : ''}` : '—'}`), 50, y0 + 18);
  doc.text(pdfSafe(`Grading: ${scheme.name}`), 320, y0 + 18);
  doc.moveTo(50, y0 + 48).lineTo(545, y0 + 48).strokeColor('#e5e7eb').stroke();

  let y = y0 + 65;
  doc.fontSize(13).fillColor(accent).text('Results', 50, y);
  y += 22;
  const cols = { course: 50, credits: 280, marks: 330, pct: 410, grade: 470, points: 515 };
  doc.fontSize(9.5).fillColor('#6b7280');
  doc.text(terms.course.one, cols.course, y);
  if (hasCredits) doc.text('Credits', cols.credits, y);
  doc.text('Marks', cols.marks, y);
  doc.text('%', cols.pct, y);
  doc.text('Grade', cols.grade, y);
  if (isGpa) doc.text('Points', cols.points, y);
  doc.moveTo(50, y + 14).lineTo(545, y + 14).strokeColor('#e5e7eb').stroke();
  y += 22;
  doc.fontSize(10);
  if (!results.length) {
    doc.fillColor('#6b7280').text('No results recorded yet.', 50, y);
    y += 18;
  }
  for (const r of results) {
    if (y > 700) {
      doc.addPage();
      y = 60;
    }
    doc.fillColor('#111827').text(pdfSafe(r.code ? `${r.code} ${r.course}` : r.course), cols.course, y, { width: 225 });
    if (hasCredits) doc.text(r.credits == null ? '—' : String(r.credits), cols.credits, y);
    doc.text(`${r.obtained}/${r.total}`, cols.marks, y);
    doc.text(r.percent.toFixed(1), cols.pct, y);
    doc.fillColor(r.passed ? '#111827' : '#B91C1C').text(r.grade, cols.grade, y);
    if (isGpa) doc.fillColor('#111827').text(r.points == null ? '—' : r.points.toFixed(2), cols.points, y);
    y += 18;
  }
  y += 10;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
  y += 14;
  doc.fontSize(11).fillColor('#374151');
  if (overall) {
    doc.text(
      isGpa && overall.gpa != null ? `GPA: ${overall.gpa.toFixed(2)} / ${scheme.gpa_scale ?? 4}` : `Overall: ${overall.percent.toFixed(1)}% (${overall.label})`,
      50,
      y
    );
    doc.text(overall.passed ? 'Result: Pass' : 'Result: Needs improvement', 50, y + 18);
  }
  doc.text(totalAtt ? `Attendance: ${Math.round((present / totalAtt) * 100)}%  (${present}/${totalAtt} days present)` : 'Attendance: no records', 320, y);

  const generated = pdfSafe(formatDate(new Date(), { timeZone: institution.timezone, locale: institution.locale }));
  doc.fontSize(9).fillColor('#9ca3af').text(`Generated by Acadex · ${generated}`, 50, 760, { align: 'center', width: 495 });
  doc.end();
});

// Fee voucher/receipt PDF
router.get('/fee-voucher/:feeId', async (req, res) => {
  const s = institutionId(req);
  const { feeId } = idParam('feeId').parse(req.params);
  const f = (
    await db.query(
      `SELECT f.*, st.first_name||' '||st.last_name student, st.roll_no, c.name section_name
         FROM tuition_fee f JOIN students st ON st.id=f.student_id LEFT JOIN sections c ON c.id=st.section_id
        WHERE f.id=$1 AND f.institution_id=$2`,
      [feeId, s]
    )
  ).rows[0];
  if (!f) throw notFound('Fee record not found');
  await assertCanViewStudent(currentUser(req), f.student_id, { allowTeachers: false, guardian: 'fees' });
  const institution = await institutionSettings(s);
  if (!institution) throw notFound('Fee record not found');
  const accent = institution.primary_color || '#4F46E5';
  const money = (n: string | number) => pdfSafe(formatMoney(n, institution.currency, institution.locale));

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="fee-voucher-${f.receipt_id}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 90).fill(accent);
  doc.fillColor('#fff').fontSize(22).text(institution.name, 50, 30);
  doc.fontSize(12).fillColor('#e5e7eb').text('Fee Voucher / Receipt', 50, 60);

  doc.fillColor('#374151').fontSize(11);
  let y = 120;
  // payment_date is a calendar date ('YYYY-MM-DD'), shown as-is
  const paidOn = f.payment_date ? pdfSafe(formatDate(`${f.payment_date}T00:00:00Z`, { locale: institution.locale })) : '—';
  doc.text(`Receipt #: ${f.receipt_id}`, 50, y);
  doc.text(`Date: ${paidOn}`, 350, y);
  y += 20;
  doc.text(`Student: ${f.student}`, 50, y);
  doc.text(`Roll No: ${f.roll_no || '—'}`, 350, y);
  y += 20;
  doc.text(`Class: ${f.section_name || '—'}`, 50, y);
  y += 30;

  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
  y += 20;
  const row = (label: string, val: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(12).fillColor('#111827');
    doc.text(label, 60, y);
    doc.text(val, 400, y);
    y += 26;
  };
  row('Total Fee', money(f.total_fee));
  row('Paid Amount', money(f.paid_amount));
  row('Remaining Balance', money(f.remaining_balance));
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
  y += 16;
  row('Status', f.payment_status, true);

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#9ca3af')
    .text('This is a computer-generated voucher from Acadex.', 50, 760, { align: 'center', width: 495 });
  doc.end();
});

export default router;
