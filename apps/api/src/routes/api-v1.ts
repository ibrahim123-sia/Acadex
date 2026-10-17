// The public REST API (mounted under /api/v1). Institutions create keys with scopes under
// Settings → Integrations; requests send `Authorization: Bearer acx_…`. Everything is read-only
// and paginated (?page, ?pageSize, totals in X-Total-Count), scoped to the key's institution
// by code and by row-level security; webhooks can be managed with the webhooks:manage scope.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { id, webhookBody, type API_SCOPES } from '@acadex/shared';
import { encryptSecret, randomToken, sha256 } from '../auth/crypto';
import { asSystem, db, setTenant } from '../db/context';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { parsePage, sendPage } from '../lib/pagination';
import { entitlements } from '../lib/platform';

type Scope = (typeof API_SCOPES)[number];
interface ApiKeyContext {
  keyId: number;
  institutionId: number;
  scopes: string[];
}
declare module 'express-serve-static-core' {
  interface Request {
    apiKey?: ApiKeyContext;
  }
}

const router = Router();

async function apiKeyAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const m = /^Bearer (acx_[A-Za-z0-9_-]{20,})$/.exec(String(req.headers.authorization ?? ''));
    if (!m) throw unauthorized('Send an API key: Authorization: Bearer acx_…', 'NO_API_KEY');
    const { rows } = await asSystem(() =>
      db.query<{ id: number; institution_id: number; scopes: string[]; status: string }>(
        `SELECT k.id, k.institution_id, k.scopes, i.status FROM api_keys k JOIN institutions i ON i.id = k.institution_id
          WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())`,
        [sha256(m[1]!)]
      )
    );
    const k = rows[0];
    if (!k) throw unauthorized('This API key is not valid', 'BAD_API_KEY');
    if (k.status !== 'active') throw forbidden('This institution is suspended', 'SUSPENDED');
    if (!(await entitlements(k.institution_id)).features.api) throw forbidden('The API is not part of this plan', 'PLAN_FEATURE');
    await asSystem(() => db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [k.id]));
    req.apiKey = { keyId: k.id, institutionId: k.institution_id, scopes: k.scopes };
    setTenant(k.institution_id, null);
    next();
  } catch (e) {
    next(e);
  }
}

const need = (scope: Scope) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.apiKey?.scopes.includes(scope)) return next(forbidden(`This key lacks the ${scope} scope`, 'SCOPE'));
  next();
};
const inst = (req: Request) => req.apiKey!.institutionId;
const since = (req: Request) => z.iso.datetime({ offset: true }).optional().catch(undefined).parse(req.query.updated_since);

router.use(apiKeyAuth);

/** Students (active and past), optionally changed since a time. */
router.get('/students', need('students:read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT s.id, s.roll_no, s.first_name, s.last_name, s.email, s.status, s.section_id, sec.name AS section, s.created_at, count(*) OVER () AS _total
       FROM students s LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.institution_id = $1 AND ($2::timestamptz IS NULL OR s.created_at >= $2)
      ORDER BY s.id LIMIT $3 OFFSET $4`,
    [inst(req), since(req) ?? null, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/staff', need('staff:read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT t.id, t.first_name, t.last_name, t.email, t.designation, t.status, t.campus_id, count(*) OVER () AS _total FROM teachers t WHERE t.institution_id = $1 ORDER BY t.id LIMIT $2 OFFSET $3`,
    [inst(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

/** Courses as taught: one row per class (offering). */
router.get('/courses', need('courses:read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT o.id, c.code, c.name, o.section_id, sec.name AS section, o.term_id, count(*) OVER () AS _total
       FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id WHERE o.institution_id = $1 ORDER BY o.id LIMIT $2 OFFSET $3`,
    [inst(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/courses/:id/enrollments', need('enrollments:read'), async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const { rows: o } = await db.query(`SELECT 1 FROM course_offerings WHERE id = $1 AND institution_id = $2`, [offeringId, inst(req)]);
  if (!o[0]) throw notFound();
  const { rows } = await db.query(
    `SELECT st.id AS student_id, st.roll_no, st.first_name, st.last_name FROM course_offerings ro JOIN students st ON st.institution_id = ro.institution_id AND COALESCE(st.status, 'active') = 'active'
      WHERE ro.id = $1 AND ((ro.enrollment_mode = 'section' AND st.section_id = ro.section_id) OR EXISTS (SELECT 1 FROM enrollments e WHERE e.offering_id = ro.id AND e.student_id = st.id AND e.status IN ('active', 'completed')))
      ORDER BY st.roll_no NULLS LAST, st.id`,
    [offeringId]
  );
  res.json(rows);
});

router.get('/attendance', need('attendance:read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 200 });
  const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const { rows } = await db.query(
    `SELECT s.date, s.section_id, s.offering_id, s.kind, r.student_id, r.status, r.minutes_late, count(*) OVER () AS _total
       FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id WHERE r.institution_id = $1 AND s.date BETWEEN $2 AND $3
      ORDER BY s.date, r.student_id LIMIT $4 OFFSET $5`,
    [inst(req), q.from, q.to, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

/** Released grades only. */
router.get('/grades', need('grades:read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 200 });
  const { rows } = await db.query(
    `SELECT g.id, g.assessment_id, a.title AS assessment, a.offering_id, a.points AS max_points, g.student_id, g.points, g.excused, g.missing, g.released_at, count(*) OVER () AS _total
       FROM grades g JOIN assessments a ON a.id = g.assessment_id WHERE g.institution_id = $1 AND g.released_at IS NOT NULL AND ($2::timestamptz IS NULL OR g.released_at >= $2)
      ORDER BY g.id LIMIT $3 OFFSET $4`,
    [inst(req), since(req) ?? null, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/invoices', need('fees:read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT id, number, student_id, title, issue_date, due_date, status, currency, total::float, paid::float, count(*) OVER () AS _total FROM invoices WHERE institution_id = $1 ORDER BY id LIMIT $2 OFFSET $3`,
    [inst(req), pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/payments', need('payments:read'), async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 100 });
  const { rows } = await db.query(
    `SELECT id, invoice_id, student_id, receipt_no, amount::float, method, provider, status, received_at, count(*) OVER () AS _total FROM payments WHERE institution_id = $1 AND ($2::timestamptz IS NULL OR received_at >= $2)
      ORDER BY id LIMIT $3 OFFSET $4`,
    [inst(req), since(req) ?? null, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/webhooks', need('webhooks:manage'), async (req, res) => {
  const { rows } = await db.query(`SELECT id, url, events, enabled, failures, created_at FROM webhook_endpoints WHERE institution_id = $1 ORDER BY id`, [inst(req)]);
  res.json(rows);
});
router.post('/webhooks', need('webhooks:manage'), async (req, res) => {
  const b = webhookBody.parse(req.body);
  const secret = `whsec_${randomToken(24)}`;
  const { rows } = await db.query(`INSERT INTO webhook_endpoints (institution_id, url, events, secret_sealed, enabled) VALUES ($1,$2,$3,$4,$5) RETURNING id, url, events, enabled`, [inst(req), b.url, b.events, encryptSecret(secret), b.enabled]);
  res.status(201).json({ ...rows[0], secret });
});
router.delete('/webhooks/:id', need('webhooks:manage'), async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM webhook_endpoints WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), inst(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

export default router;
