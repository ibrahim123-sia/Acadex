// The platform owner's SaaS tools (mounted under /api/platform after the platform routes):
// plans, tenant invoices and payments, usage with cost and margin, tenant health,
// announcements to institutions, per-tenant overrides, support sign-in (only where the
// institution allows it, recorded on both sides), tenant deletion, demo requests and product
// feedback, and platform settings (unit costs, tax rates).
import { Router } from 'express';
import { z } from 'zod';
import { id, markInvoicePaidBody, planBody, platformAnnouncementBody, tenantOverridesBody } from '@acadex/shared';
import { db, systemContext } from '../db/context';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parsePage, sendPage } from '../lib/pagination';
import { costReport, invoiceInstitution, markInvoicePaid } from '../lib/platform';
import { startSession } from '../auth/service';
import { auth, currentUser, requirePermission } from '../middleware/auth';

const router = Router();
router.use(auth, systemContext);
const read = requirePermission('platform.institutions.read');
const manage = requirePermission('platform.institutions.manage');

// ---------------------------------------------------------------- plans

router.get('/plans', read, async (_req, res) => {
  const { rows } = await db.query(`SELECT p.*, (SELECT count(*) FROM institutions i WHERE i.plan = p.key)::int AS institutions FROM plans p ORDER BY p.position, p.key`);
  res.json(rows);
});

router.put('/plans', manage, async (req, res) => {
  const b = planBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO plans (key, name, description, prices, limits, features, overage, trial_days, public, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, prices = EXCLUDED.prices, limits = EXCLUDED.limits, features = EXCLUDED.features,
       overage = EXCLUDED.overage, trial_days = EXCLUDED.trial_days, public = EXCLUDED.public, position = EXCLUDED.position RETURNING *`,
    [b.key, b.name, b.description, JSON.stringify(b.prices), JSON.stringify(b.limits), JSON.stringify(b.features), JSON.stringify(b.overage), b.trial_days, b.public, b.position]
  );
  const u = currentUser(req);
  await audit({ institutionId: null, userId: u.id, actor: u.name, action: 'plan_saved', entity: 'Plan', detail: b.key });
  res.json(rows[0]);
});

// ---------------------------------------------------------------- billing

router.get('/billing/invoices', read, async (req, res) => {
  const pg = parsePage(req.query);
  const status = z.enum(['open', 'paid', 'void', 'overdue']).optional().catch(undefined).parse(req.query.status);
  const { rows } = await db.query(
    `SELECT pi.id, pi.number, pi.plan, pi.period_start, pi.currency, pi.total::float AS total, pi.status, pi.due_date, pi.paid_at, pi.method, i.name AS institution, i.id AS institution_id,
            count(*) OVER () AS _total
       FROM platform_invoices pi JOIN institutions i ON i.id = pi.institution_id WHERE ($1::text IS NULL OR pi.status = $1)
      ORDER BY pi.period_start DESC, pi.id DESC LIMIT $2 OFFSET $3`,
    [status ?? null, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

/** A bank transfer or a manual arrangement was received. */
router.post('/billing/invoices/:id/paid', manage, async (req, res) => {
  const b = markInvoicePaidBody.parse(req.body);
  const invoiceId = id.parse(req.params.id);
  if (!(await markInvoicePaid(invoiceId, b.method, b.reference))) throw conflict('This invoice is not open', 'NOT_OPEN');
  const u = currentUser(req);
  await audit({ institutionId: null, userId: u.id, actor: u.name, action: 'platform_invoice_paid', entity: 'PlatformInvoice', detail: `${invoiceId} ${b.method} ${b.reference}` });
  res.json({ ok: true });
});

router.post('/billing/invoices/:id/void', manage, async (req, res) => {
  const { rowCount } = await db.query(`UPDATE platform_invoices SET status = 'void' WHERE id = $1 AND status IN ('open', 'overdue')`, [id.parse(req.params.id)]);
  if (!rowCount) throw conflict('This invoice is not open', 'NOT_OPEN');
  res.json({ ok: true });
});

/** Issue this month's invoices now (otherwise the 1st of each month). */
router.post('/billing/run', manage, async (req, res) => {
  const b = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), institution_id: id.optional() }).parse(req.body);
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM institutions WHERE status = 'active' AND deletion_due_at IS NULL AND ($1::int IS NULL OR id = $1)`, [b.institution_id ?? null]);
  let n = 0;
  for (const r of rows) if (await invoiceInstitution(r.id, b.month)) n++;
  res.json({ invoices: n });
});

/** Usage, cost to the platform and revenue per institution for a month. */
router.get('/usage', read, async (req, res) => {
  const month = z.string().regex(/^\d{4}-\d{2}$/).catch(new Date().toISOString().slice(0, 7)).parse(req.query.month);
  res.json(await costReport(month));
});

/** Tenant health: activity, size and billing at a glance. */
router.get('/health', read, async (_req, res) => {
  const { rows } = await db.query(
    `SELECT i.id, i.name, i.plan, i.status, i.trial_ends_at, i.deletion_due_at, i.created_at,
            (SELECT max(u.last_login_at) FROM users u WHERE u.institution_id = i.id) AS last_activity,
            (SELECT count(*) FROM users u WHERE u.institution_id = i.id AND u.last_login_at > now() - interval '7 days')::int AS active_7d,
            (SELECT count(*) FROM users u WHERE u.institution_id = i.id AND u.is_active)::int AS accounts,
            (SELECT count(*) FROM students s WHERE s.institution_id = i.id AND s.deleted_at IS NULL)::int AS students,
            (SELECT COALESCE(sum(f.size_bytes), 0) FROM files f WHERE f.institution_id = i.id AND f.deleted_at IS NULL)::float AS storage_bytes,
            (SELECT count(*) FROM platform_invoices pi WHERE pi.institution_id = i.id AND pi.status = 'overdue')::int AS overdue_invoices,
            (SELECT count(*) FROM delivery_logs d WHERE d.institution_id = i.id AND d.status = 'failed' AND d.created_at > now() - interval '7 days')::int AS failed_deliveries_7d,
            i.onboarded_at IS NOT NULL AS onboarded
       FROM institutions i ORDER BY i.name`
  );
  const now = Date.now();
  res.json(
    rows.map((r) => {
      const idleDays = r.last_activity ? (now - new Date(r.last_activity).getTime()) / 86_400_000 : 999;
      const usage = r.accounts ? r.active_7d / r.accounts : 0;
      let score = 100;
      if (idleDays > 14) score -= 40;
      else if (idleDays > 3) score -= 15;
      if (usage < 0.1) score -= 20;
      if (r.overdue_invoices) score -= 25;
      if (!r.onboarded) score -= 10;
      if (r.failed_deliveries_7d > 20) score -= 5;
      return { ...r, health: Math.max(0, score), level: score >= 75 ? 'good' : score >= 45 ? 'watch' : 'at_risk' };
    })
  );
});

// ---------------------------------------------------------------- announcements, overrides, support

router.get('/announcements', read, async (_req, res) => {
  const { rows } = await db.query(`SELECT * FROM platform_announcements ORDER BY created_at DESC LIMIT 100`);
  res.json(rows);
});
router.post('/announcements', manage, async (req, res) => {
  const b = platformAnnouncementBody.parse(req.body);
  const { rows } = await db.query(`INSERT INTO platform_announcements (title, body, level, plans, ends_at, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [
    b.title,
    b.body,
    b.level,
    b.plans,
    b.ends_at,
    currentUser(req).id,
  ]);
  res.status(201).json(rows[0]);
});
router.delete('/announcements/:id', manage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM platform_announcements WHERE id = $1`, [id.parse(req.params.id)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

/** Extra (or removed) features and modules for one institution, and its trial end. */
router.patch('/institutions/:id/overrides', manage, async (req, res) => {
  const b = tenantOverridesBody.parse(req.body);
  const target = id.parse(req.params.id);
  const { rows } = await db.query(
    `UPDATE institutions SET feature_overrides = $2, trial_ends_at = CASE WHEN $3::boolean THEN $4::date ELSE trial_ends_at END WHERE id = $1 RETURNING id, feature_overrides, trial_ends_at`,
    [target, JSON.stringify(b.features), b.trial_ends_at !== undefined, b.trial_ends_at ?? null]
  );
  if (!rows[0]) throw notFound();
  const u = currentUser(req);
  await audit({ institutionId: target, userId: u.id, actor: u.name, action: 'platform_overrides', entity: 'Institution', detail: JSON.stringify(b) });
  res.json(rows[0]);
});

/**
 * Support sign-in: the platform administrator opens a one-hour session as one of the
 * institution's administrators — only when the institution allows support access. Both the
 * platform and the institution's audit logs record it.
 */
router.post('/institutions/:id/impersonate', manage, async (req, res) => {
  const target = id.parse(req.params.id);
  const b = z.object({ user_id: id.optional(), reason: z.string().trim().min(3).max(300) }).parse(req.body);
  const { rows: inst } = await db.query<{ allowed: boolean | null; status: string }>(`SELECT (settings->'retention'->>'support_access')::boolean AS allowed, status FROM institutions WHERE id = $1`, [target]);
  if (!inst[0]) throw notFound();
  if (!inst[0].allowed) throw forbidden('This institution has not allowed support access (Settings → Privacy)', 'NO_CONSENT');
  const { rows: u } = await db.query<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM users WHERE institution_id = $1 AND is_active AND ($2::int IS NULL AND role = 'institution_admin' OR id = $2) ORDER BY id LIMIT 1`,
    [target, b.user_id ?? null]
  );
  if (!u[0]) throw badRequest('No active administrator to sign in as');
  const me = currentUser(req);
  const session = await startSession(req, res, u[0].id, { mfaVerified: true, impersonatedBy: me.id, ttlMinutes: 60 });
  for (const instId of [null, target]) {
    await audit({ institutionId: instId, userId: me.id, actor: me.name, action: 'support_sign_in', entity: 'User', detail: `as ${u[0].full_name} (#${u[0].id}): ${b.reason}` });
  }
  res.json(session);
});

/** Schedule (30 days of grace) or cancel an institution's deletion. */
router.post('/institutions/:id/deletion', manage, async (req, res) => {
  const target = id.parse(req.params.id);
  const b = z.object({ action: z.enum(['schedule', 'cancel']), days: z.number().int().min(0).max(90).default(30) }).parse(req.body);
  const { rows } = await db.query(
    `UPDATE institutions SET deletion_due_at = CASE WHEN $2 = 'schedule' THEN now() + make_interval(days => $3) ELSE NULL END WHERE id = $1 RETURNING id, deletion_due_at`,
    [target, b.action, b.days]
  );
  if (!rows[0]) throw notFound();
  const u = currentUser(req);
  await audit({ institutionId: target, userId: u.id, actor: u.name, action: b.action === 'schedule' ? 'deletion_scheduled' : 'deletion_cancelled', entity: 'Institution', detail: String(rows[0].deletion_due_at ?? '') });
  res.json(rows[0]);
});

// ---------------------------------------------------------------- the public site

router.get('/demo-requests', read, async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(`SELECT *, count(*) OVER () AS _total FROM demo_requests ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [pg.limit, pg.offset]);
  sendPage(res, rows, pg);
});
router.patch('/demo-requests/:id', manage, async (req, res) => {
  const b = z.object({ status: z.enum(['new', 'contacted', 'won', 'lost']) }).parse(req.body);
  const { rowCount } = await db.query(`UPDATE demo_requests SET status = $2 WHERE id = $1`, [id.parse(req.params.id), b.status]);
  if (!rowCount) throw notFound();
  res.json({ ok: true });
});
router.get('/feedback', read, async (req, res) => {
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT f.*, i.name AS institution, u.full_name AS person, u.role, count(*) OVER () AS _total FROM product_feedback f
       LEFT JOIN institutions i ON i.id = f.institution_id LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT $1 OFFSET $2`,
    [pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

// ---------------------------------------------------------------- settings

const SETTING_KEYS = ['unit_costs', 'tax_rates', 'ai_markup', 'suspend_after_days', 'tutorial_videos', 'bank_details'] as const;
router.get('/settings', read, async (_req, res) => {
  const { rows } = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM platform_settings WHERE key = ANY($1::text[])`, [SETTING_KEYS]);
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});
router.put('/settings/:key', manage, async (req, res) => {
  const key = z.enum(SETTING_KEYS).parse(req.params.key);
  const value = z.unknown().parse(req.body?.value);
  if (value === undefined) throw badRequest('Send { value }');
  await db.query(`INSERT INTO platform_settings (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
  res.json({ key, value });
});

export default router;
