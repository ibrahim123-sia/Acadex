// Exam documents: admit cards (with seats and a verification QR), room seating charts,
// result cards (board style with position; university style with grade points and SGPA),
// and the transcript (every term, SGPA and CGPA) with a verification code.
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { getConfig } from '../../config';
import { institutionSettings } from '../institution';
import { formatDate } from '../locale';
import { notFound } from '../errors';
import type { StudentResult } from './results';

const pdfSafe = (s: string) => s.replace(new RegExp('[' + String.fromCharCode(0x202f, 0xa0) + ']', 'g'), ' ');
export const verifyUrl = (code: string) => `${getConfig().appUrl}/verify/${code}`;

async function start(res: Response, institutionId: number, filename: string, title: string, opts: { layout?: 'portrait' | 'landscape' } = {}) {
  const ins = await institutionSettings(institutionId);
  if (!ins) throw notFound();
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: opts.layout ?? 'portrait' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[^A-Za-z0-9_.-]+/g, '-')}"`);
  doc.pipe(res);
  const accent = ins.primary_color || '#4F46E5';
  doc.rect(0, 0, doc.page.width, 70).fill(accent);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text(ins.name, 40, 20, { width: doc.page.width - 80 });
  doc.font('Helvetica').fontSize(11).fillColor('#e5e7eb').text(title, 40, 44);
  doc.fillColor('#111827');
  return { doc, ins, date: (d: string) => pdfSafe(formatDate(`${String(d).slice(0, 10)}T00:00:00Z`, { locale: ins.locale })) };
}

/** A simple table; returns the y after it. Adds pages as needed. */
function table(doc: PDFKit.PDFDocument, y: number, cols: { label: string; width: number; align?: 'left' | 'right' | 'center' }[], rows: string[][]) {
  const x0 = 40;
  const head = () => {
    let x = x0;
    doc.rect(x0, y, cols.reduce((n, c) => n + c.width, 0), 20).fill('#f3f4f6');
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9);
    for (const c of cols) {
      doc.text(c.label, x + 4, y + 6, { width: c.width - 8, align: c.align ?? 'left' });
      x += c.width;
    }
    y += 22;
  };
  head();
  doc.font('Helvetica').fontSize(9.5).fillColor('#111827');
  for (const r of rows) {
    if (y > doc.page.height - 70) {
      doc.addPage();
      y = 40;
      head();
      doc.font('Helvetica').fontSize(9.5).fillColor('#111827');
    }
    let x = x0;
    r.forEach((v, i) => {
      doc.text(v, x + 4, y, { width: cols[i]!.width - 8, align: cols[i]!.align ?? 'left', lineBreak: false, ellipsis: true });
      x += cols[i]!.width;
    });
    y += 16;
  }
  return y + 6;
}

export interface AdmitCardData {
  series: string;
  instructions: string;
  student: { name: string; roll_no: string | null; section_name: string | null };
  papers: { course: string; date: string; starts_at: string; ends_at: string; room: string | null; seat_no: number | null }[];
  verify_code: string;
}

export async function sendAdmitCard(res: Response, institutionId: number, d: AdmitCardData) {
  const { doc, date } = await start(res, institutionId, `admit-card-${d.student.roll_no ?? d.student.name}.pdf`, `Admit card — ${d.series}`);
  let y = 90;
  doc.font('Helvetica-Bold').fontSize(13).text(d.student.name, 40, y);
  doc.font('Helvetica').fontSize(10).fillColor('#374151').text(`Roll no. ${d.student.roll_no ?? '—'}    Class ${d.student.section_name ?? '—'}`, 40, y + 18);
  const qr = await QRCode.toBuffer(verifyUrl(d.verify_code), { margin: 0, width: 200, errorCorrectionLevel: 'M' });
  doc.image(qr, doc.page.width - 130, 84, { width: 90 });
  doc.fontSize(8).fillColor('#6b7280').text(d.verify_code, doc.page.width - 130, 178, { width: 90, align: 'center' });
  y = 195;
  y = table(
    doc,
    y,
    [
      { label: 'Paper', width: 190 },
      { label: 'Date', width: 100 },
      { label: 'Time', width: 90 },
      { label: 'Room', width: 75 },
      { label: 'Seat', width: 60, align: 'right' },
    ],
    d.papers.map((p) => [p.course, date(p.date), `${p.starts_at.slice(0, 5)}–${p.ends_at.slice(0, 5)}`, p.room ?? '—', p.seat_no == null ? '—' : String(p.seat_no)])
  );
  if (d.instructions) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Instructions', 40, y + 8);
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(d.instructions, 40, y + 24, { width: doc.page.width - 80 });
  }
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text('Bring this card to every paper. Scan the code to check it is genuine.', 40, doc.page.height - 50, { align: 'center', width: doc.page.width - 80 });
  doc.end();
}

export async function sendSeatingChart(res: Response, institutionId: number, title: string, rooms: { room: string; seats: { seat_no: number; name: string; roll_no: string | null; course: string }[] }[]) {
  const { doc } = await start(res, institutionId, `seating.pdf`, title);
  let y = 90;
  rooms.forEach((r, i) => {
    if (i > 0) {
      doc.addPage();
      y = 40;
    }
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(`Room ${r.room} — ${r.seats.length} candidates`, 40, y);
    y = table(
      doc,
      y + 22,
      [
        { label: 'Seat', width: 50, align: 'right' },
        { label: 'Roll no.', width: 90 },
        { label: 'Name', width: 200 },
        { label: 'Paper', width: 175 },
      ],
      r.seats.map((s) => [String(s.seat_no), s.roll_no ?? '', s.name, s.course])
    );
  });
  doc.end();
}

export async function sendResultCard(res: Response, institutionId: number, series: { name: string; result_style: string }, r: StudentResult, verifyCodeText?: string) {
  const { doc } = await start(res, institutionId, `result-${r.roll_no ?? r.student_id}.pdf`, `${series.result_style === 'university' ? 'Grade sheet' : 'Result card'} — ${series.name}`);
  let y = 90;
  doc.font('Helvetica-Bold').fontSize(13).text(r.name, 40, y);
  doc.font('Helvetica').fontSize(10).fillColor('#374151').text(`Roll no. ${r.roll_no ?? '—'}    Class ${r.section_name ?? '—'}`, 40, y + 18);
  y += 44;
  const uni = series.result_style === 'university';
  y = table(
    doc,
    y,
    uni
      ? [
          { label: 'Course', width: 200 },
          { label: 'Credits', width: 60, align: 'right' },
          { label: 'Marks', width: 90, align: 'right' },
          { label: 'Grade', width: 60, align: 'center' },
          { label: 'Points', width: 105, align: 'right' },
        ]
      : [
          { label: 'Subject', width: 200 },
          { label: 'Total', width: 70, align: 'right' },
          { label: 'Pass', width: 60, align: 'right' },
          { label: 'Obtained', width: 85, align: 'right' },
          { label: 'Grade', width: 100, align: 'center' },
        ],
    r.papers.map((p) =>
      uni
        ? [`${p.code ? `${p.code} ` : ''}${p.course}`, p.credits == null ? '—' : String(p.credits), p.absent ? 'Absent' : `${p.obtained} / ${p.total}`, p.grade, p.points == null ? '—' : p.points.toFixed(2)]
        : [p.course, String(p.total), String(p.pass), p.absent ? 'Absent' : String(p.obtained), p.passed ? p.grade : `${p.grade} (fail)`]
    )
  );
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#e5e7eb').stroke();
  y += 10;
  const line = (l: string, v: string) => {
    doc.font('Helvetica').fontSize(11).fillColor('#374151').text(l, 300, y, { width: 120 });
    doc.font('Helvetica-Bold').fillColor('#111827').text(v, 420, y, { width: 135, align: 'right' });
    y += 18;
  };
  line('Total', `${r.obtained} / ${r.total}`);
  line('Percentage', `${r.percent.toFixed(2)}%`);
  line('Grade', r.grade);
  if (uni && r.gpa != null) line('SGPA', r.gpa.toFixed(2));
  if (!uni && r.position != null) line('Position in class', String(r.position));
  line('Result', r.passed ? 'Pass' : 'Fail');
  if (verifyCodeText) {
    const qr = await QRCode.toBuffer(verifyUrl(verifyCodeText), { margin: 0, width: 200 });
    doc.image(qr, 40, y - 80, { width: 75 });
  }
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text('Generated by Acadex from the published results.', 40, doc.page.height - 50, { align: 'center', width: doc.page.width - 80 });
  doc.end();
}

export interface TranscriptTerm {
  term: string;
  courses: { code: string | null; course: string; credits: number | null; grade: string; points: number | null; percent: number }[];
  sgpa: number | null;
  credits: number;
}

export async function sendTranscript(res: Response, institutionId: number, d: { name: string; roll_no: string | null; program: string | null; terms: TranscriptTerm[]; cgpa: number | null; credits: number; verify_code: string; serial_no: string }) {
  const { doc } = await start(res, institutionId, `transcript-${d.roll_no ?? d.name}.pdf`, 'Academic transcript');
  let y = 90;
  doc.font('Helvetica-Bold').fontSize(13).text(d.name, 40, y);
  doc.font('Helvetica').fontSize(10).fillColor('#374151').text(`Roll no. ${d.roll_no ?? '—'}    ${d.program ?? ''}    Serial ${d.serial_no}`, 40, y + 18);
  const qr = await QRCode.toBuffer(verifyUrl(d.verify_code), { margin: 0, width: 200 });
  doc.image(qr, doc.page.width - 120, 80, { width: 80 });
  y = 175;
  for (const t of d.terms) {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = 40;
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(t.term, 40, y);
    y = table(
      doc,
      y + 16,
      [
        { label: 'Code', width: 70 },
        { label: 'Course', width: 230 },
        { label: 'Credits', width: 60, align: 'right' },
        { label: 'Grade', width: 60, align: 'center' },
        { label: 'Points', width: 95, align: 'right' },
      ],
      t.courses.map((c) => [c.code ?? '', c.course, c.credits == null ? '—' : String(c.credits), c.grade, c.points == null ? '—' : c.points.toFixed(2)])
    );
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(`Credits ${t.credits}    SGPA ${t.sgpa == null ? '—' : t.sgpa.toFixed(2)}`, 40, y, { width: 515, align: 'right' });
    y += 22;
  }
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(`Credits earned ${d.credits}    CGPA ${d.cgpa == null ? '—' : d.cgpa.toFixed(2)}`, 40, y + 6, { width: 515, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text(`Verify at ${verifyUrl(d.verify_code)}`, 40, doc.page.height - 50, { align: 'center', width: doc.page.width - 80 });
  doc.end();
}
