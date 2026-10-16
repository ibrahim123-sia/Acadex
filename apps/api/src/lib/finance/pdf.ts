// Fee voucher (challan) and payment receipt PDFs. The voucher carries the bank details payers
// deposit to, the invoice number as the payment reference, and a QR code that opens the
// online pay page (or, without online payment, carries the bank details as text).
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { db } from '../../db/context';
import { notFound } from '../errors';
import { institutionSettings } from '../institution';
import { formatDate, formatMoney } from '../locale';
import { payLink } from './reminders';

// built-in PDF fonts lack U+202F/U+00A0, which some locales put between amount and symbol
const pdfSafe = (s: string) => s.replace(new RegExp('[' + String.fromCharCode(0x202f, 0xa0) + ']', 'g'), ' ');

export async function invoiceForPdf(invoiceId: number, institutionId: number) {
  const { rows } = await db.query(
    `SELECT i.*, st.first_name || ' ' || st.last_name AS student, st.roll_no, sec.name AS section_name,
            a.first_name || ' ' || a.last_name AS applicant, a.number AS application_no
       FROM invoices i LEFT JOIN students st ON st.id = i.student_id LEFT JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN applications a ON a.id = i.application_id
      WHERE i.id = $1 AND i.institution_id = $2`,
    [invoiceId, institutionId]
  );
  if (!rows[0]) throw notFound('Invoice not found');
  const { rows: lines } = await db.query<{ kind: string; label: string; amount: string }>(`SELECT kind, label, amount FROM invoice_items WHERE invoice_id = $1 ORDER BY (kind = 'fee') DESC, id`, [invoiceId]);
  const { rows: pays } = await db.query<{ receipt_no: string; amount: string; method: string; received_at: Date }>(
    `SELECT receipt_no, amount, method, received_at FROM payments WHERE invoice_id = $1 ORDER BY received_at`,
    [invoiceId]
  );
  const { rows: accts } = await db.query<{ provider: string; public_config: Record<string, string> }>(
    `SELECT provider, public_config FROM payment_accounts WHERE institution_id = $1 AND enabled`,
    [institutionId]
  );
  return { inv: rows[0], lines, pays, accts };
}

function header(doc: PDFKit.PDFDocument, accent: string, name: string, title: string) {
  doc.rect(0, 0, doc.page.width, 80).fill(accent);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text(name, 50, 24, { width: 495 });
  doc.font('Helvetica').fontSize(11).fillColor('#e5e7eb').text(title, 50, 52);
}

export async function sendVoucherPdf(res: Response, invoiceId: number, institutionId: number) {
  const { inv, lines, pays, accts } = await invoiceForPdf(invoiceId, institutionId);
  const ins = await institutionSettings(institutionId);
  if (!ins) throw notFound();
  const money = (n: string | number) => pdfSafe(formatMoney(n, inv.currency, ins.locale));
  const date = (d: string) => pdfSafe(formatDate(`${d}T00:00:00Z`, { locale: ins.locale }));
  const bank = accts.find((a) => a.provider === 'bank')?.public_config ?? {};
  const online = accts.some((a) => a.provider !== 'bank');
  const balance = Number(inv.total) - Number(inv.paid);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="voucher-${inv.number}.pdf"`);
  doc.pipe(res);
  header(doc, ins.primary_color || '#4F46E5', ins.name, balance > 0 ? 'Fee voucher' : 'Fee voucher — paid');

  let y = 100;
  doc.fillColor('#374151').font('Helvetica').fontSize(10.5);
  const pair = (l: string, v: string, x: number) => {
    doc.font('Helvetica').fillColor('#6b7280').text(l, x, y);
    doc.font('Helvetica-Bold').fillColor('#111827').text(v, x + 95, y, { width: 150 });
  };
  pair('Invoice no.', inv.number, 50);
  pair('Issued', date(inv.issue_date), 300);
  y += 18;
  pair(inv.student ? 'Student' : 'Applicant', inv.student ?? inv.applicant ?? '—', 50);
  pair('Due date', date(inv.due_date), 300);
  y += 18;
  if (inv.student) pair('Class', [inv.section_name, inv.roll_no ? `Roll ${inv.roll_no}` : ''].filter(Boolean).join(' · ') || '—', 50);
  else pair('Application', inv.application_no ?? '—', 50);
  pair('For', inv.title, 300);
  y += 32;

  // lines
  doc.rect(50, y, 495, 22).fill('#f3f4f6');
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10).text('Description', 60, y + 6).text('Amount', 400, y + 6, { width: 135, align: 'right' });
  y += 28;
  doc.font('Helvetica').fontSize(10.5);
  for (const l of lines) {
    doc.fillColor(Number(l.amount) < 0 ? '#047857' : '#111827').text(l.label, 60, y, { width: 330 }).text(money(l.amount), 400, y, { width: 135, align: 'right' });
    y += 18;
  }
  doc.moveTo(50, y + 2).lineTo(545, y + 2).strokeColor('#e5e7eb').stroke();
  y += 10;
  const total = (l: string, v: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10.5).fillColor('#111827').text(l, 300, y, { width: 95 }).text(v, 400, y, { width: 135, align: 'right' });
    y += bold ? 22 : 18;
  };
  total('Total', money(inv.total));
  if (Number(inv.paid)) total('Paid', money(inv.paid));
  total('Balance due', money(balance), true);
  if (pays.length) {
    y += 4;
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`Payments: ${pays.map((p) => `${p.receipt_no} ${money(p.amount)} (${p.method})`).join('; ')}`, 50, y, { width: 495 });
    y += 24;
  }

  // how to pay
  y += 10;
  const qrText = inv.pay_token && online ? payLink(inv.pay_token) : [bank.bank_name, bank.account_title, bank.iban, `Ref ${inv.number}`, `Amount ${balance.toFixed(2)}`].filter(Boolean).join('\n');
  if (balance > 0) {
    doc.roundedRect(50, y, 495, 130, 6).strokeColor('#d1d5db').stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('How to pay', 64, y + 12);
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    let yy = y + 32;
    const line = (s: string) => {
      doc.text(s, 64, yy, { width: 330 });
      yy += 15;
    };
    if (bank.iban || bank.account_no) {
      line(`Bank: ${bank.bank_name ?? '—'}${bank.branch ? `, ${bank.branch}` : ''}`);
      line(`Account title: ${bank.account_title ?? ins.name}`);
      if (bank.iban) line(`IBAN: ${bank.iban}`);
      if (bank.account_no) line(`Account no.: ${bank.account_no}`);
      if (bank.raast_id) line(`Raast ID: ${bank.raast_id}`);
      line(`Reference: ${inv.number}`);
    } else line('Pay at the accounts office.');
    if (online && inv.pay_token) line('Or pay online: scan the code.');
    const { rows: note } = await db.query<{ note: string | null }>(`SELECT settings->'fees'->>'voucher_note' AS note FROM institutions WHERE id = $1`, [institutionId]);
    if (note[0]?.note) line(note[0].note);
    const qr = await QRCode.toBuffer(qrText || inv.number, { margin: 0, width: 220, errorCorrectionLevel: 'M' });
    doc.image(qr, 425, y + 12, { width: 105 });
  } else {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#047857').text('PAID — thank you', 50, y, { width: 495, align: 'center' });
  }

  doc.font('Helvetica').fontSize(8.5).fillColor('#9ca3af').text('Generated by Acadex. Please quote the invoice number with every payment.', 50, 770, { align: 'center', width: 495 });
  doc.end();
}

export async function sendReceiptPdf(res: Response, paymentId: number, institutionId: number) {
  const { rows } = await db.query(
    `SELECT p.*, i.number AS invoice_number, i.title, i.currency, i.total, i.paid, st.first_name || ' ' || st.last_name AS student, st.roll_no,
            a.first_name || ' ' || a.last_name AS applicant, u.full_name AS received_by_name,
            (SELECT COALESCE(sum(r.amount), 0) FROM refunds r WHERE r.payment_id = p.id AND r.status = 'completed') AS refunded
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN students st ON st.id = i.student_id
       LEFT JOIN applications a ON a.id = i.application_id LEFT JOIN users u ON u.id = p.received_by
      WHERE p.id = $1 AND p.institution_id = $2`,
    [paymentId, institutionId]
  );
  const p = rows[0];
  if (!p) throw notFound('Payment not found');
  const ins = await institutionSettings(institutionId);
  if (!ins) throw notFound();
  const money = (n: string | number) => pdfSafe(formatMoney(n, p.currency, ins.locale));
  const doc = new PDFDocument({ margin: 50, size: 'A5', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${p.receipt_no}.pdf"`);
  doc.pipe(res);
  header(doc, ins.primary_color || '#4F46E5', ins.name, 'Payment receipt');
  let y = 100;
  const row = (l: string, v: string, bold = false) => {
    doc.font('Helvetica').fontSize(10.5).fillColor('#6b7280').text(l, 50, y);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#111827').text(v, 180, y, { width: 300 });
    y += 19;
  };
  row('Receipt no.', p.receipt_no, true);
  row('Date', pdfSafe(formatDate(p.received_at, { locale: ins.locale, timeZone: ins.timezone })));
  row(p.student ? 'Student' : 'Applicant', `${p.student ?? p.applicant ?? '—'}${p.roll_no ? ` (Roll ${p.roll_no})` : ''}`);
  row('For', `${p.title} — invoice ${p.invoice_number}`);
  row('Amount received', money(p.amount), true);
  row('Method', `${p.method}${p.provider ? ` (${p.provider})` : ''}${p.provider_ref ? ` · ref ${p.provider_ref}` : ''}`);
  if (Number(p.refunded)) row('Refunded', money(p.refunded));
  row('Balance on invoice', money(Number(p.total) - Number(p.paid)));
  if (p.received_by_name) row('Received by', p.received_by_name);
  doc.font('Helvetica').fontSize(8.5).fillColor('#9ca3af').text('Generated by Acadex.', 50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 });
  doc.end();
}
