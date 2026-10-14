// ID cards (students and staff) and issued documents (leaving / character certificates,
// bonafide letters): templates, issuing with serial numbers, printable PDFs with a QR code
// for verification, and revocation. Mounted under /api/institution. The public
// verification lookup lives in routes/public.ts.
import { Router, type Request } from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { z } from 'zod';
import { DOCUMENT_KINDS, documentTemplateBody, id, issueDocumentBody, issueIdCardsBody, resolveTerminology, revokeDocumentBody, type InstitutionType } from '@acadex/shared';
import { getConfig } from '../config';
import { db, withTransaction } from '../db/context';
import { assertInInstitution } from '../lib/access';
import { DEFAULT_TEMPLATES, PLACEHOLDERS, fillTemplate, nextSerial, verifyCode, type DocumentKind } from '../lib/documents';
import { badRequest, conflict, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { formatDate, todayIn } from '../lib/locale';
import { assertCampusAllowed, campusOfSection, campusesFor } from '../lib/structure';
import { auth, currentUser, institutionId, requirePermission } from '../middleware/auth';
import { storage } from '../storage';

const router = Router();
router.use(auth);
const issue = requirePermission('documents.issue');

// built-in PDF fonts lack U+202F/U+00A0, which some locales put between parts of a date
const pdfSafe = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ');
const verifyUrl = (code: string) => `${getConfig().appUrl}/verify/${code}`;

async function institutionFor(req: Request) {
  const { rows } = await db.query<{ name: string; type: InstitutionType; settings: { terminology?: object }; primary_color: string; address: string; phone: string; locale: string; timezone: string }>(
    `SELECT name, type, settings, primary_color, address, phone, locale, timezone FROM institutions WHERE id = $1`,
    [institutionId(req)]
  );
  return rows[0]!;
}

/** A photo from storage as PNG for PDFKit (which doesn't read WebP). */
async function photoPng(fileId: number | null): Promise<Buffer | null> {
  if (!fileId) return null;
  const { rows } = await db.query<{ storage_key: string }>(`SELECT storage_key FROM files WHERE id = $1 AND deleted_at IS NULL`, [fileId]);
  if (!rows[0]) return null;
  try {
    return await sharp(await storage().get(rows[0].storage_key)).resize(240, 288, { fit: 'cover' }).png().toBuffer();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- ID cards

/** Issue cards (replacing any active card of the same person). */
router.post('/id-cards', issue, async (req, res) => {
  const b = issueIdCardsBody.parse(req.body);
  const s = institutionId(req);
  const scope = campusesFor(req, 'documents.issue');
  let ids = b.holder_ids;
  if (b.section_id) {
    if (b.holder_type !== 'student') throw badRequest('A class can only be used for student cards');
    await assertInInstitution('sections', b.section_id, s);
    assertCampusAllowed(scope, await campusOfSection(b.section_id));
    const { rows } = await db.query<{ id: number }>(`SELECT id FROM students WHERE section_id = $1 AND status = 'active'`, [b.section_id]);
    ids = [...new Set([...ids, ...rows.map((r) => r.id)])];
  }
  const table = b.holder_type === 'student' ? 'students' : 'teachers';
  const { rows: holders } = await db.query<{ id: number; campus_id: number | null }>(
    b.holder_type === 'student'
      ? `SELECT st.id, sec.campus_id FROM students st LEFT JOIN sections sec ON sec.id = st.section_id WHERE st.id = ANY($1::int[]) AND st.institution_id = $2`
      : `SELECT id, campus_id FROM ${table} WHERE id = ANY($1::int[]) AND institution_id = $2`,
    [ids, s]
  );
  if (holders.length !== ids.length) throw badRequest('Some of these people are not in this institution');
  for (const h of holders) assertCampusAllowed(scope, h.campus_id);
  const { rows: year } = await db.query<{ ends_on: string }>(`SELECT ends_on FROM academic_years WHERE institution_id = $1 AND is_current`, [s]);
  const validUntil = b.valid_until ?? year[0]?.ends_on ?? `${new Date().getUTCFullYear()}-12-31`;
  const cards = await withTransaction(async (client) => {
    await client.query(`UPDATE id_cards SET revoked_at = now() WHERE holder_type = $1 AND holder_id = ANY($2::int[]) AND revoked_at IS NULL`, [b.holder_type, ids]);
    const out: Record<string, unknown>[] = [];
    for (const hid of ids) {
      out.push(
        (
          await client.query(
            `INSERT INTO id_cards (institution_id, holder_type, holder_id, verify_code, valid_until, issued_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [s, b.holder_type, hid, verifyCode(), validUntil, currentUser(req).id]
          )
        ).rows[0]
      );
    }
    return out;
  });
  res.status(201).json({ cards, count: cards.length });
});

router.get('/id-cards', issue, async (req, res) => {
  const q = z.object({ holder_type: z.enum(['student', 'staff']).default('student'), section_id: z.coerce.number().int().positive().optional() }).parse(req.query);
  const { rows } = await db.query(
    q.holder_type === 'student'
      ? `SELECT c.id, c.verify_code, c.valid_until, c.issued_at, c.revoked_at, st.id holder_id, st.first_name || ' ' || st.last_name AS name, st.roll_no AS number, sec.name || ' ' || COALESCE(sec.label, '') AS detail
           FROM id_cards c JOIN students st ON st.id = c.holder_id LEFT JOIN sections sec ON sec.id = st.section_id
          WHERE c.institution_id = $1 AND c.holder_type = 'student' AND ($2::int IS NULL OR st.section_id = $2) ORDER BY c.issued_at DESC LIMIT 500`
      : `SELECT c.id, c.verify_code, c.valid_until, c.issued_at, c.revoked_at, t.id holder_id, t.first_name || ' ' || t.last_name AS name, t.employee_no AS number, t.designation AS detail
           FROM id_cards c JOIN teachers t ON t.id = c.holder_id WHERE c.institution_id = $1 AND c.holder_type = 'staff' ORDER BY c.issued_at DESC LIMIT 500`,
    [institutionId(req), q.section_id ?? null]
  );
  res.json(rows);
});

router.post('/id-cards/:id/revoke', issue, async (req, res) => {
  const { rowCount } = await db.query(`UPDATE id_cards SET revoked_at = now() WHERE id = $1 AND institution_id = $2 AND revoked_at IS NULL`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound('No active card with this id');
  res.json({ ok: true });
});

/** A printable sheet of cards (10 per A4 page, CR80 size), cut along the borders. */
router.get('/id-cards/pdf', issue, async (req, res) => {
  const q = z
    .object({
      ids: z.string().regex(/^\d+(,\d+)*$/).optional(),
      section_id: z.coerce.number().int().positive().optional(),
    })
    .refine((v) => v.ids || v.section_id, 'Pass ids=1,2,3 (card ids) or section_id')
    .parse(req.query);
  const s = institutionId(req);
  const params: unknown[] = [s];
  let where = 'c.institution_id = $1 AND c.revoked_at IS NULL';
  if (q.ids) {
    params.push(q.ids.split(',').map(Number));
    where += ` AND c.id = ANY($${params.length}::int[])`;
  }
  if (q.section_id) {
    params.push(q.section_id);
    where += ` AND c.holder_type = 'student' AND st.section_id = $${params.length}`;
  }
  const { rows: cards } = await db.query(
    `SELECT c.id, c.holder_type, c.verify_code, c.valid_until,
            COALESCE(st.first_name || ' ' || st.last_name, t.first_name || ' ' || t.last_name) AS name,
            COALESCE(st.roll_no, t.employee_no) AS number,
            COALESCE(sec.name || CASE WHEN sec.label <> '' THEN ' ' || sec.label ELSE '' END, t.designation) AS detail,
            COALESCE(cs.name, ct.name) AS campus, COALESCE(sec.campus_id, t.campus_id) AS campus_id,
            COALESCE(st.photo_file_id, t.photo_file_id) AS photo_file_id, st.dob, g.phone AS emergency_phone
       FROM id_cards c
       LEFT JOIN students st ON c.holder_type = 'student' AND st.id = c.holder_id
       LEFT JOIN sections sec ON sec.id = st.section_id LEFT JOIN campuses cs ON cs.id = sec.campus_id
       LEFT JOIN teachers t ON c.holder_type = 'staff' AND t.id = c.holder_id LEFT JOIN campuses ct ON ct.id = t.campus_id
       LEFT JOIN LATERAL (SELECT g.phone FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id
                           WHERE gs.student_id = st.id ORDER BY gs.is_primary DESC LIMIT 1) g ON true
      WHERE ${where} ORDER BY sec.name, st.roll_no, name LIMIT 500`,
    params
  );
  if (!cards.length) throw notFound('No active cards to print — issue them first');
  const scope = campusesFor(req, 'documents.issue');
  for (const c of cards) assertCampusAllowed(scope, c.campus_id);
  const inst = await institutionFor(req);
  const terms = resolveTerminology(inst.type, inst.settings?.terminology as never);
  const accent = inst.primary_color || '#2563EB';

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="id-cards.pdf"');
  doc.pipe(res);
  const W = 242.65; // 85.6 mm
  const H = 153; // 54 mm
  const gapX = 20;
  const gapY = 12;
  const x0 = (595.28 - 2 * W - gapX) / 2;
  const y0 = (841.89 - 5 * H - 4 * gapY) / 2;
  for (const [i, c] of cards.entries()) {
    if (i > 0 && i % 10 === 0) doc.addPage();
    const slot = i % 10;
    const x = x0 + (slot % 2) * (W + gapX);
    const y = y0 + Math.floor(slot / 2) * (H + gapY);
    doc.save().roundedRect(x, y, W, H, 8).lineWidth(0.6).strokeColor('#9CA3AF').stroke().restore();
    doc.save().roundedRect(x, y, W, 30, 8).clip().rect(x, y, W, 30).fill(accent).restore();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9.5).text(pdfSafe(inst.name), x + 10, y + 7, { width: W - 20, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(6.5).text(
      c.holder_type === 'student' ? `${terms.student.one.toUpperCase()} IDENTITY CARD` : 'STAFF IDENTITY CARD',
      x + 10, y + 19, { width: W - 20, characterSpacing: 0.6 }
    );
    const photo = await photoPng(c.photo_file_id);
    if (photo) doc.image(photo, x + 10, y + 38, { width: 54, height: 65 });
    else {
      doc.save().rect(x + 10, y + 38, 54, 65).fill('#E5E7EB').restore();
      const initials = String(c.name).split(/\s+/).map((p: string) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
      doc.fillColor('#6B7280').font('Helvetica-Bold').fontSize(18).text(initials, x + 10, y + 61, { width: 54, align: 'center' });
    }
    const tx = x + 72;
    const tw = W - 72 - 66;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(pdfSafe(c.name), tx, y + 38, { width: tw, lineBreak: false, ellipsis: true });
    const lines: [string, string][] = [
      [c.holder_type === 'student' ? terms.section.one : 'Role', c.detail ?? '—'],
      [c.holder_type === 'student' ? 'Roll no.' : 'Employee no.', c.number ?? '—'],
      [terms.campus.one, c.campus ?? '—'],
      ...(c.holder_type === 'student' && c.emergency_phone ? ([['Emergency', c.emergency_phone]] as [string, string][]) : []),
    ];
    let ly = y + 53;
    for (const [label, value] of lines) {
      doc.font('Helvetica').fontSize(6).fillColor('#6B7280').text(label.toUpperCase(), tx, ly, { width: tw });
      doc.font('Helvetica').fontSize(7.5).fillColor('#111827').text(pdfSafe(String(value)), tx, ly + 7, { width: tw, lineBreak: false, ellipsis: true });
      ly += 17;
    }
    doc.font('Helvetica').fontSize(6.5).fillColor('#374151').text(
      pdfSafe(`Valid until ${formatDate(c.valid_until, { locale: inst.locale, timeZone: 'UTC' })}`),
      x + 10, y + H - 16, { width: 140 }
    );
    const qr = await QRCode.toBuffer(verifyUrl(c.verify_code), { margin: 0, width: 160, errorCorrectionLevel: 'M' });
    doc.image(qr, x + W - 62, y + 40, { width: 52, height: 52 });
    doc.font('Courier').fontSize(5.5).fillColor('#6B7280').text(c.verify_code, x + W - 66, y + 95, { width: 60, align: 'center' });
  }
  doc.end();
});

// ---------------------------------------------------------------- templates

router.get('/document-templates', issue, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM document_templates WHERE institution_id = $1`, [institutionId(req)]);
  res.json({
    placeholders: PLACEHOLDERS,
    templates: DOCUMENT_KINDS.map((kind) => {
      const saved = rows.find((r) => r.kind === kind);
      return { kind, ...DEFAULT_TEMPLATES[kind], ...(saved && { title: saved.title, body: saved.body, serial_prefix: saved.serial_prefix }), customised: !!saved };
    }),
  });
});

router.put('/document-templates/:kind', requirePermission('settings.manage'), async (req, res) => {
  const kind = z.enum(DOCUMENT_KINDS).parse(req.params.kind);
  const b = documentTemplateBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO document_templates (institution_id, kind, title, body, serial_prefix) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT ON CONSTRAINT document_templates_institution_id_kind_key DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body,
       serial_prefix = EXCLUDED.serial_prefix, updated_at = now() RETURNING *`,
    [institutionId(req), kind, b.title, b.body, b.serial_prefix]
  );
  res.json(rows[0]);
});

router.delete('/document-templates/:kind', requirePermission('settings.manage'), async (req, res) => {
  const kind = z.enum(DOCUMENT_KINDS).parse(req.params.kind);
  await db.query(`DELETE FROM document_templates WHERE institution_id = $1 AND kind = $2`, [institutionId(req), kind]);
  res.status(204).end();
});

// ---------------------------------------------------------------- issued documents

const RELATION: Record<string, string> = { father: 'child of', mother: 'child of', guardian: 'ward of', grandparent: 'grandchild of', sibling: 'sibling of', other: 'ward of' };

router.post('/issued-documents', issue, async (req, res) => {
  const b = issueDocumentBody.parse(req.body);
  const s = institutionId(req);
  const { rows } = await db.query(
    `SELECT st.*, sec.name AS section_name, sec.label AS section_label, sec.campus_id, cm.name AS campus_name, p.name AS program_name, ay.name AS academic_year,
            g.first_name || ' ' || g.last_name AS guardian_name, gs.relationship
       FROM students st LEFT JOIN sections sec ON sec.id = st.section_id LEFT JOIN campuses cm ON cm.id = sec.campus_id
       LEFT JOIN program_levels l ON l.id = sec.program_level_id LEFT JOIN programs p ON p.id = l.program_id
       LEFT JOIN academic_years ay ON ay.id = sec.academic_year_id
       LEFT JOIN LATERAL (SELECT guardian_id, relationship FROM guardianships WHERE student_id = st.id ORDER BY is_primary DESC, id LIMIT 1) gs ON true
       LEFT JOIN guardians g ON g.id = gs.guardian_id
      WHERE st.id = $1 AND st.institution_id = $2`,
    [b.student_id, s]
  );
  const st = rows[0];
  if (!st) throw notFound('Student not found');
  assertCampusAllowed(campusesFor(req, 'documents.issue'), st.campus_id);
  if (b.kind === 'bonafide_letter' && st.status !== 'active') throw conflict('A bonafide letter is only for current students');
  const inst = await institutionFor(req);
  const tz = await institutionTimeZone(s);
  const today = todayIn(tz);
  // calendar dates: formatted in UTC so the day never shifts
  const fmt = (d: string | null) => (d ? pdfSafe(formatDate(d, { locale: inst.locale, timeZone: 'UTC' })) : '—');
  const leftOn = b.left_on ?? st.left_on ?? today;
  const { rows: tpl } = await db.query(`SELECT title, body, serial_prefix FROM document_templates WHERE institution_id = $1 AND kind = $2`, [s, b.kind]);
  const template = tpl[0] ?? DEFAULT_TEMPLATES[b.kind as DocumentKind];
  const record = await withTransaction(async (client) => {
    const serial = await nextSerial(s, template.serial_prefix, Number(today.slice(0, 4)), client);
    const data: Record<string, string> = {
      'student.name': `${st.first_name} ${st.last_name}`,
      'student.roll_no': st.roll_no ?? '—',
      'student.dob': fmt(st.dob),
      'student.admission_date': fmt(st.admission_date),
      'student.relation': RELATION[st.relationship ?? 'guardian'] ?? 'ward of',
      'guardian.name': st.guardian_name ?? '—',
      'section.name': st.section_name ? `${st.section_name}${st.section_label ? ` ${st.section_label}` : ''}` : '—',
      'campus.name': st.campus_name ?? '—',
      'program.name': st.program_name ?? '—',
      academic_year: st.academic_year ?? '—',
      'institution.name': inst.name,
      left_on: fmt(leftOn),
      reason: b.reason || '—',
      conduct: b.conduct || 'good',
      purpose: b.purpose || '—',
      purpose_clause: b.purpose ? ` for the purpose of ${b.purpose}` : '',
      date: fmt(today),
      serial_no: serial,
    };
    const body = fillTemplate(template.body, data);
    const doc = (
      await client.query(
        `INSERT INTO issued_documents (institution_id, kind, serial_no, student_id, verify_code, title, body, data, issued_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [s, b.kind, serial, st.id, verifyCode(), template.title, body, JSON.stringify(data), currentUser(req).id]
      )
    ).rows[0];
    if (b.kind === 'leaving_certificate' && b.mark_left) {
      await client.query(`UPDATE students SET status = 'left', left_on = $2 WHERE id = $1`, [st.id, leftOn]);
      await client.query(`UPDATE users SET is_active = false WHERE ref_id = $1 AND role = 'student' AND institution_id = $2`, [st.id, s]);
    }
    return doc;
  });
  res.status(201).json(record);
});

router.get('/issued-documents', issue, async (req, res) => {
  const studentId = z.coerce.number().int().positive().optional().parse(req.query.student_id);
  const { rows } = await db.query(
    `SELECT d.id, d.kind, d.serial_no, d.title, d.issued_at, d.revoked_at, d.revoke_reason, d.verify_code, d.student_id,
            st.first_name || ' ' || st.last_name AS student_name, st.roll_no, u.full_name AS issued_by_name
       FROM issued_documents d LEFT JOIN students st ON st.id = d.student_id LEFT JOIN users u ON u.id = d.issued_by
      WHERE d.institution_id = $1 AND ($2::int IS NULL OR d.student_id = $2) ORDER BY d.issued_at DESC LIMIT 200`,
    [institutionId(req), studentId ?? null]
  );
  res.json(rows);
});

router.post('/issued-documents/:id/revoke', issue, async (req, res) => {
  const { reason } = revokeDocumentBody.parse(req.body);
  const { rowCount } = await db.query(
    `UPDATE issued_documents SET revoked_at = now(), revoke_reason = $3 WHERE id = $1 AND institution_id = $2 AND revoked_at IS NULL`,
    [id.parse(req.params.id), institutionId(req), reason]
  );
  if (!rowCount) throw notFound('No valid document with this id');
  res.json({ ok: true });
});

router.get('/issued-documents/:id/pdf', issue, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*, u.full_name AS issued_by_name FROM issued_documents d LEFT JOIN users u ON u.id = d.issued_by WHERE d.id = $1 AND d.institution_id = $2`,
    [id.parse(req.params.id), institutionId(req)]
  );
  const d = rows[0];
  if (!d) throw notFound();
  const inst = await institutionFor(req);
  const accent = inst.primary_color || '#2563EB';
  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${d.serial_no}.pdf"`);
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, 8).fill(accent);
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(20).text(pdfSafe(inst.name), 60, 50, { align: 'center' });
  doc.font('Helvetica').fontSize(9.5).fillColor('#4B5563').text(pdfSafe([inst.address, inst.phone].filter(Boolean).join('  ·  ')), { align: 'center' });
  doc.moveDown(2.2);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(accent).text(pdfSafe(d.title.toUpperCase()), { align: 'center', characterSpacing: 1.5 });
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text(`No. ${d.serial_no}    ·    ${d.data.date ?? ''}`, { align: 'center' });
  doc.moveDown(2);
  doc.font('Times-Roman').fontSize(12.5).fillColor('#111827').text(pdfSafe(d.body), { align: 'justify', lineGap: 5, paragraphGap: 8 });
  if (d.revoked_at) {
    doc.save().rotate(-30, { origin: [300, 420] }).font('Helvetica-Bold').fontSize(64).fillColor('#DC2626').opacity(0.18).text('REVOKED', 90, 380).restore();
  }
  const bottom = doc.page.height - 190;
  doc.moveTo(380, bottom + 60).lineTo(535, bottom + 60).lineWidth(0.8).strokeColor('#111827').stroke();
  doc.font('Helvetica').fontSize(9.5).fillColor('#111827').text('Principal / Registrar', 380, bottom + 66, { width: 155, align: 'center' });
  doc.fontSize(8).fillColor('#6B7280').text(pdfSafe(`Prepared by ${d.issued_by_name ?? '—'}`), 380, bottom + 80, { width: 155, align: 'center' });
  const qr = await QRCode.toBuffer(verifyUrl(d.verify_code), { margin: 0, width: 220, errorCorrectionLevel: 'M' });
  doc.image(qr, 60, bottom + 10, { width: 78, height: 78 });
  doc.font('Helvetica').fontSize(7.5).fillColor('#6B7280').text(`Verify at ${verifyUrl(d.verify_code)}`, 60, bottom + 94, { width: 260 });
  doc.end();
});

export default router;
