// Public endpoints (no sign-in). Verification of ID cards and issued documents by the code in
// their QR: only what a verifier needs (valid or not, the institution, a masked name, the
// document type) — never contact details, dates of birth or photos. Mounted at /api/public.
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { asSystem, db } from '../db/context';
import { maskName } from '../lib/documents';
import { notFound } from '../lib/errors';
import { icsFor } from './engage';

const router = Router();
// slow down anyone trying to enumerate codes
router.use(
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => ipKeyGenerator(req.ip ?? '') })
);

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,20}$/, 'Not a verification code');

router.get('/verify/:code', async (req, res) => {
  const c = code.parse(req.params.code);
  const result = await asSystem(async () => {
    const card = await db.query(
      `SELECT ic.holder_type, ic.valid_until, ic.revoked_at, ic.issued_at, i.name AS institution, i.status AS institution_status,
              COALESCE(st.first_name, t.first_name) AS first_name, COALESCE(st.last_name, t.last_name) AS last_name,
              COALESCE(st.status, t.status) AS holder_status, (now() AT TIME ZONE i.timezone)::date AS today
         FROM id_cards ic JOIN institutions i ON i.id = ic.institution_id
         LEFT JOIN students st ON ic.holder_type = 'student' AND st.id = ic.holder_id
         LEFT JOIN teachers t ON ic.holder_type = 'staff' AND t.id = ic.holder_id
        WHERE ic.verify_code = $1`,
      [c]
    );
    if (card.rows[0]) {
      const r = card.rows[0];
      const status = r.revoked_at ? 'revoked' : r.valid_until < r.today ? 'expired' : r.holder_status !== 'active' ? 'inactive' : 'valid';
      return {
        kind: 'id_card',
        holder_type: r.holder_type,
        status,
        valid: status === 'valid' && r.institution_status === 'active',
        institution: r.institution,
        name: maskName(r.first_name ?? '', r.last_name ?? ''),
        valid_until: r.valid_until,
      };
    }
    const doc = await db.query(
      `SELECT d.title, d.serial_no, d.issued_at, d.revoked_at, i.name AS institution, st.first_name, st.last_name
         FROM issued_documents d JOIN institutions i ON i.id = d.institution_id LEFT JOIN students st ON st.id = d.student_id
        WHERE d.verify_code = $1`,
      [c]
    );
    const d = doc.rows[0];
    if (!d) {
      const cert = await db.query(
        `SELECT c.title, c.issued_at, c.revoked_at, i.name AS institution, st.first_name, st.last_name, co.name AS course
           FROM certificates c JOIN institutions i ON i.id = c.institution_id JOIN students st ON st.id = c.student_id
           LEFT JOIN course_offerings o ON o.id = c.offering_id LEFT JOIN courses co ON co.id = o.course_id
          WHERE c.verify_code = $1`,
        [c]
      );
      const x = cert.rows[0];
      if (!x) return null;
      return {
        kind: 'course_certificate',
        title: x.title,
        course: x.course,
        status: x.revoked_at ? 'revoked' : 'valid',
        valid: !x.revoked_at,
        institution: x.institution,
        name: maskName(x.first_name ?? '', x.last_name ?? ''),
        issued_at: x.issued_at,
      };
    }
    return {
      kind: 'document',
      title: d.title,
      serial_no: d.serial_no,
      status: d.revoked_at ? 'revoked' : 'valid',
      valid: !d.revoked_at,
      institution: d.institution,
      name: maskName(d.first_name ?? '', d.last_name ?? ''),
      issued_at: d.issued_at,
    };
  });
  if (!result) throw notFound('No document or card has this code');
  res.set('Cache-Control', 'no-store');
  res.json(result);
});

/** A person's calendar for calendar apps; the secret link is the only key. */
router.get('/calendar/:token.ics', async (req, res) => {
  const token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/).parse(req.params.token);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const ics = await asSystem(async () => {
    const { rows } = await db.query<{ user_id: number }>(`SELECT user_id FROM calendar_feeds WHERE token_hash = $1`, [hash]);
    return rows[0] ? icsFor(rows[0].user_id) : null;
  });
  if (!ics) throw notFound('This calendar link is no longer valid');
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900' });
  res.send(ics);
});

export default router;
