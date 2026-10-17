// What an institution manages of the platform (mounted under /api): its plan, invoices and
// billing profile; white-label branding and custom domains; full data exports and deletion;
// public API keys, webhooks and LTI tools; consents, privacy requests and retention; reports
// with exports and schedules; product feedback, guided tours, sample data and OneRoster export.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { Router } from 'express';
import { z } from 'zod';
import {
  API_SCOPES,
  apiKeyBody,
  billingProfileBody,
  brandingBody,
  changePlanBody,
  consentBody,
  customDomainBody,
  feedbackBody,
  id,
  ltiToolBody,
  privacyDecisionBody,
  privacyRequestBody,
  reportFilters,
  reportScheduleBody,
  retentionBody,
  webhookBody,
  REPORTS,
} from '@acadex/shared';
import { encryptSecret, randomToken, sha256 } from '../auth/crypto';
import { getConfig } from '../config';
import { db, withTransaction } from '../db/context';
import { guardianLink } from '../lib/access';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { courseAccess } from '../lib/lms/access';
import { issuer } from '../lib/lti';
import { parsePage, sendPage } from '../lib/pagination';
import { assertFeature, entitlements, messagesLeft, stripeCheckout } from '../lib/platform';
import { REPORT_TITLES, buildReport, isReport, renderReport, sendSchedule } from '../lib/reports';
import { deliver } from '../lib/webhooks';
import { enqueue } from '../jobs/queue';
import { storage } from '../storage';
import { toCsv } from '../lib/export';
import { ZipWriter } from '../lib/zip';
import { currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';

const router = Router();
const settingsManage = requirePermission('settings.manage');
const integrations = requirePermission('integrations.manage');

// ---------------------------------------------------------------- billing

/** The plan, what it allows, this month's use against it, and the invoices. */
router.get('/billing', requirePermission('billing.manage'), async (req, res) => {
  const inst = institutionId(req);
  const e = await entitlements(inst);
  const { rows: use } = await db.query<{ students: number; staff: number; storage_bytes: number; ai_usd: number; messages: number }>(
    `SELECT (SELECT count(*) FROM students WHERE institution_id = $1 AND COALESCE(status, 'active') = 'active' AND deleted_at IS NULL)::int AS students,
            (SELECT count(*) FROM teachers WHERE institution_id = $1 AND deleted_at IS NULL)::int AS staff,
            (SELECT COALESCE(sum(size_bytes), 0) FROM files WHERE institution_id = $1 AND deleted_at IS NULL)::float AS storage_bytes,
            (SELECT COALESCE(sum(cost_usd), 0) FROM ai_usage WHERE institution_id = $1 AND created_at >= date_trunc('month', now()))::float AS ai_usd,
            (SELECT count(*) FROM delivery_logs WHERE institution_id = $1 AND channel IN ('sms', 'whatsapp') AND status = 'sent' AND created_at >= date_trunc('month', now()))::int AS messages`,
    [inst]
  );
  const { rows: invoices } = await db.query(
    `SELECT id, number, plan, period_start, period_end, currency, lines, subtotal::float, tax_label, tax_rate::float, tax::float, total::float, status, due_date, paid_at, method
       FROM platform_invoices WHERE institution_id = $1 ORDER BY period_start DESC LIMIT 36`,
    [inst]
  );
  const { rows: prof } = await db.query<{ billing: unknown; plan: string; currency: string }>(`SELECT billing, plan, currency FROM institutions WHERE id = $1`, [inst]);
  const { rows: plans } = await db.query(`SELECT key, name, description, prices, limits, features, trial_days FROM plans WHERE public ORDER BY position`);
  const bank = (await db.query<{ value: unknown }>(`SELECT value FROM platform_settings WHERE key = 'bank_details'`)).rows[0]?.value ?? null;
  res.json({
    plan: e.plan,
    trial_ends_at: e.trialEndsAt,
    features: e.features,
    modules: { allowed: e.allowedModules, enabled: e.modules },
    usage: use[0],
    messages_left: await messagesLeft(inst),
    invoices,
    profile: prof[0]?.billing ?? {},
    plans,
    card_payments: !!getConfig().billing.stripeSecretKey,
    bank_details: bank,
  });
});

router.put('/billing/profile', requirePermission('billing.manage'), async (req, res) => {
  const b = billingProfileBody.parse(req.body);
  await db.query(`UPDATE institutions SET billing = $2 WHERE id = $1`, [institutionId(req), JSON.stringify(b)]);
  res.json(b);
});

/** Upgrade now; downgrade only when what is used fits the smaller plan. */
router.post('/billing/plan', requirePermission('billing.manage'), async (req, res) => {
  const b = changePlanBody.parse(req.body);
  const inst = institutionId(req);
  const { rows: p } = await db.query<{ key: string; limits: { students?: number | null }; trial_days: number }>(`SELECT key, limits, trial_days FROM plans WHERE key = $1 AND public`, [b.plan]);
  if (!p[0]) throw badRequest('Choose one of the plans');
  const limit = p[0].limits.students;
  if (limit != null) {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM students WHERE institution_id = $1 AND COALESCE(status, 'active') = 'active' AND deleted_at IS NULL`, [inst]);
    if ((rows[0]?.n ?? 0) > limit) throw conflict(`That plan allows ${limit} active students; you have ${rows[0]!.n}`, 'OVER_LIMIT');
  }
  const { rows } = await db.query(`UPDATE institutions SET plan = $2 WHERE id = $1 RETURNING plan, trial_ends_at`, [inst, b.plan]);
  const u = currentUser(req);
  await audit({ institutionId: inst, userId: u.id, actor: u.name, action: 'plan_changed', entity: 'Institution', detail: b.plan });
  res.json(rows[0]);
});

router.post('/billing/invoices/:id/checkout', requirePermission('billing.manage'), async (req, res) => {
  const invoiceId = id.parse(req.params.id);
  const { rows } = await db.query(`SELECT 1 FROM platform_invoices WHERE id = $1 AND institution_id = $2`, [invoiceId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  res.json({ url: await stripeCheckout(invoiceId) });
});

/** Platform notices for this institution (banners for administrators). */
router.get('/platform-announcements', async (req, res) => {
  if (!userCan(req, 'settings.manage') && !userCan(req, 'billing.manage')) return res.json([]);
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.body, a.level, a.starts_at FROM platform_announcements a, institutions i
      WHERE i.id = $1 AND a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now()) AND (a.plans IS NULL OR i.plan = ANY(a.plans)) ORDER BY a.starts_at DESC LIMIT 5`,
    [institutionId(req)]
  );
  res.json(rows);
});

// ---------------------------------------------------------------- white-label

router.get('/institution/branding', settingsManage, async (req, res) => {
  const inst = institutionId(req);
  const { rows } = await db.query<{ logo_url: string; primary_color: string; branding: Record<string, string> | null }>(`SELECT logo_url, primary_color, settings->'branding' AS branding FROM institutions WHERE id = $1`, [inst]);
  const { rows: domains } = await db.query(`SELECT id, domain, token, verified_at FROM custom_domains WHERE institution_id = $1 ORDER BY id`, [inst]);
  const e = await entitlements(inst);
  res.json({ logo_url: rows[0]?.logo_url ?? '', primary_color: rows[0]?.primary_color ?? '#2563EB', app_name: rows[0]?.branding?.app_name ?? '', email_footer: rows[0]?.branding?.email_footer ?? '', domains, white_label: e.features.white_label, custom_domain: e.features.custom_domain });
});

router.put('/institution/branding', settingsManage, async (req, res) => {
  const b = brandingBody.parse(req.body);
  const inst = institutionId(req);
  const e = await entitlements(inst);
  if ((b.app_name || b.email_footer) && !e.features.white_label) throw forbidden('Your own app name and email footer need a plan with white-label — upgrade under Billing', 'PLAN_FEATURE');
  await db.query(
    `UPDATE institutions SET logo_url = $2, primary_color = $3, settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{branding}', $4::jsonb) WHERE id = $1`,
    [inst, b.logo_url, b.primary_color, JSON.stringify({ app_name: b.app_name, email_footer: b.email_footer })]
  );
  res.json(b);
});

router.post('/institution/domains', settingsManage, async (req, res) => {
  const b = customDomainBody.parse(req.body);
  await assertFeature(institutionId(req), 'custom_domain');
  const appHost = new URL(getConfig().appUrl).hostname;
  if (b.domain === appHost || b.domain.endsWith(`.${appHost}`)) throw badRequest('Use a domain your institution owns');
  try {
    const { rows } = await db.query(`INSERT INTO custom_domains (institution_id, domain, token) VALUES ($1,$2,$3) RETURNING id, domain, token, verified_at`, [institutionId(req), b.domain, `acadex-verify=${randomToken(16)}`]);
    res.status(201).json({ ...rows[0], txt_record: `_acadex.${b.domain}`, cname_target: appHost });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('That domain is already connected', 'TAKEN');
    throw e;
  }
});

/** Checks the TXT record _acadex.<domain> for the verification token. */
export const dnsLookup: { txt: (name: string) => Promise<string[][]> } = { txt: (name) => dns.resolveTxt(name) };

router.post('/institution/domains/:id/verify', settingsManage, async (req, res) => {
  const { rows } = await db.query<{ id: number; domain: string; token: string }>(`SELECT id, domain, token FROM custom_domains WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  const d = rows[0];
  if (!d) throw notFound();
  let found = false;
  try {
    found = (await dnsLookup.txt(`_acadex.${d.domain}`)).some((r) => r.join('').trim() === d.token);
  } catch {
    found = false;
  }
  if (!found) throw conflict(`TXT record not found yet — add _acadex.${d.domain} with the value ${d.token} (DNS can take a while)`, 'NOT_VERIFIED');
  await db.query(`UPDATE custom_domains SET verified_at = now() WHERE id = $1`, [d.id]);
  res.json({ ok: true });
});

router.delete('/institution/domains/:id', settingsManage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM custom_domains WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- exports and deletion

router.get('/institution/exports', settingsManage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.id, e.scope, e.status, e.size_bytes, e.error, e.created_at, e.completed_at, e.expires_at, u.full_name AS requested_by, su.full_name AS subject
       FROM data_exports e LEFT JOIN users u ON u.id = e.requested_by LEFT JOIN users su ON su.id = e.subject_user_id WHERE e.institution_id = $1 ORDER BY e.id DESC LIMIT 50`,
    [institutionId(req)]
  );
  res.json(rows);
});

/** A full export of the institution (every table as CSV, every file), as a ZIP. */
router.post('/institution/exports', settingsManage, async (req, res) => {
  const inst = institutionId(req);
  const { rows: running } = await db.query(`SELECT 1 FROM data_exports WHERE institution_id = $1 AND scope = 'institution' AND status IN ('queued', 'running') LIMIT 1`, [inst]);
  if (running[0]) throw conflict('An export is already being prepared', 'RUNNING');
  const { rows } = await db.query<{ id: number }>(`INSERT INTO data_exports (institution_id, requested_by, scope) VALUES ($1,$2,'institution') RETURNING id`, [inst, currentUser(req).id]);
  await enqueue('export.build', { id: rows[0]!.id });
  const u = currentUser(req);
  await audit({ institutionId: inst, userId: u.id, actor: u.name, action: 'data_export', entity: 'Institution', detail: `export ${rows[0]!.id}` });
  res.status(202).json({ id: rows[0]!.id });
});

router.get('/institution/exports/:id/download', async (req, res) => {
  const { rows } = await db.query<{ storage_key: string | null; status: string; scope: string; subject_user_id: number | null }>(
    `SELECT storage_key, status, scope, subject_user_id FROM data_exports WHERE id = $1 AND institution_id = $2`,
    [id.parse(req.params.id), institutionId(req)]
  );
  const e = rows[0];
  const u = currentUser(req);
  const mine = e?.scope === 'person' && e.subject_user_id === u.id;
  if (!e || (!userCan(req, 'settings.manage') && !userCan(req, 'privacy.manage') && !mine)) throw notFound();
  if (e.status !== 'done' || !e.storage_key) throw conflict('This export is not ready', 'NOT_READY');
  await audit({ institutionId: institutionId(req), userId: u.id, actor: u.name, action: 'data_export_download', entity: 'DataExport', detail: String(req.params.id) });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="acadex-export-${req.params.id}.zip"` });
  res.send(await storage().get(e.storage_key));
});

/** Close the account: everything is erased after 30 days unless cancelled. */
router.post('/institution/deletion', settingsManage, async (req, res) => {
  const b = z.object({ confirm: z.string().trim() }).parse(req.body);
  const inst = institutionId(req);
  const { rows } = await db.query<{ slug: string }>(`SELECT slug FROM institutions WHERE id = $1`, [inst]);
  if (b.confirm !== rows[0]?.slug) throw badRequest(`Type the institution's short name (${rows[0]?.slug}) to confirm`);
  const { rows: out } = await db.query(`UPDATE institutions SET deletion_due_at = now() + interval '30 days' WHERE id = $1 RETURNING deletion_due_at`, [inst]);
  const u = currentUser(req);
  await audit({ institutionId: inst, userId: u.id, actor: u.name, action: 'deletion_scheduled', entity: 'Institution', detail: String(out[0]!.deletion_due_at) });
  res.json(out[0]);
});

router.delete('/institution/deletion', settingsManage, async (req, res) => {
  await db.query(`UPDATE institutions SET deletion_due_at = NULL WHERE id = $1`, [institutionId(req)]);
  const u = currentUser(req);
  await audit({ institutionId: institutionId(req), userId: u.id, actor: u.name, action: 'deletion_cancelled', entity: 'Institution' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- public API keys, webhooks, LTI

router.get('/institution/api-keys', integrations, async (req, res) => {
  const { rows } = await db.query(
    `SELECT k.id, k.name, k.prefix, k.scopes, k.last_used_at, k.revoked_at, k.expires_at, k.created_at, u.full_name AS created_by FROM api_keys k LEFT JOIN users u ON u.id = k.created_by
      WHERE k.institution_id = $1 ORDER BY k.id DESC`,
    [institutionId(req)]
  );
  res.json({ keys: rows, scopes: API_SCOPES, docs: `${getConfig().apiPublicUrl}/docs` });
});

/** A new key — shown once. */
router.post('/institution/api-keys', integrations, async (req, res) => {
  const b = apiKeyBody.parse(req.body);
  const inst = institutionId(req);
  await assertFeature(inst, 'api');
  const key = `acx_${randomToken(30)}`;
  const { rows } = await db.query(
    `INSERT INTO api_keys (institution_id, name, prefix, key_hash, scopes, created_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, prefix, scopes, expires_at`,
    [inst, b.name, key.slice(0, 12), sha256(key), b.scopes, currentUser(req).id, b.expires_on]
  );
  const u = currentUser(req);
  await audit({ institutionId: inst, userId: u.id, actor: u.name, action: 'api_key_created', entity: 'ApiKey', detail: `${b.name}: ${b.scopes.join(' ')}` });
  res.status(201).json({ ...rows[0], key });
});

router.delete('/institution/api-keys/:id', integrations, async (req, res) => {
  const { rowCount } = await db.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND institution_id = $2 AND revoked_at IS NULL`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

router.get('/institution/webhooks', integrations, async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.id, e.url, e.events, e.enabled, e.failures, e.created_at,
            (SELECT count(*) FROM webhook_deliveries d WHERE d.endpoint_id = e.id AND d.status = 'failed')::int AS failed
       FROM webhook_endpoints e WHERE e.institution_id = $1 ORDER BY e.id`,
    [institutionId(req)]
  );
  res.json(rows);
});

/** A new endpoint; its signing secret is shown once. */
router.post('/institution/webhooks', integrations, async (req, res) => {
  const b = webhookBody.parse(req.body);
  const inst = institutionId(req);
  await assertFeature(inst, 'api');
  const secret = `whsec_${randomToken(24)}`;
  const { rows } = await db.query(`INSERT INTO webhook_endpoints (institution_id, url, events, secret_sealed, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, url, events, enabled`, [
    inst,
    b.url,
    b.events,
    encryptSecret(secret),
    b.enabled,
    currentUser(req).id,
  ]);
  res.status(201).json({ ...rows[0], secret });
});

router.put('/institution/webhooks/:id', integrations, async (req, res) => {
  const b = webhookBody.parse(req.body);
  const { rows } = await db.query(`UPDATE webhook_endpoints SET url = $3, events = $4, enabled = $5, failures = CASE WHEN $5 THEN 0 ELSE failures END WHERE id = $1 AND institution_id = $2 RETURNING id, url, events, enabled`, [
    id.parse(req.params.id),
    institutionId(req),
    b.url,
    b.events,
    b.enabled,
  ]);
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

router.delete('/institution/webhooks/:id', integrations, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM webhook_endpoints WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

router.get('/institution/webhooks/:id/deliveries', integrations, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.id, d.event, d.status, d.attempts, d.response_code, d.error, d.created_at, d.delivered_at FROM webhook_deliveries d
      WHERE d.endpoint_id = $1 AND d.institution_id = $2 ORDER BY d.id DESC LIMIT 100`,
    [id.parse(req.params.id), institutionId(req)]
  );
  res.json(rows);
});

/** Sends a "ping" event to the endpoint now. */
router.post('/institution/webhooks/:id/test', integrations, async (req, res) => {
  const inst = institutionId(req);
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM webhook_endpoints WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), inst]);
  if (!rows[0]) throw notFound();
  const payload = { id: crypto.randomUUID(), event: 'ping', created_at: new Date().toISOString(), institution_id: inst, data: {} };
  const { rows: d } = await db.query<{ id: number }>(`INSERT INTO webhook_deliveries (institution_id, endpoint_id, event, payload) VALUES ($1,$2,'ping',$3) RETURNING id`, [inst, rows[0].id, JSON.stringify(payload)]);
  res.json({ result: await deliver(d[0]!.id) });
});

router.get('/lti/tools', integrations, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM lti_tools WHERE institution_id = $1 ORDER BY name`, [institutionId(req)]);
  res.json({ tools: rows, platform: { issuer: issuer(), jwks_url: `${getConfig().apiPublicUrl}/lti/jwks`, auth_url: `${getConfig().apiPublicUrl}/lti/authorize`, token_url: null } });
});
router.post('/lti/tools', integrations, async (req, res) => {
  const b = ltiToolBody.parse(req.body);
  await assertFeature(institutionId(req), 'lti');
  const { rows } = await db.query(
    `INSERT INTO lti_tools (institution_id, name, client_id, login_url, launch_url, jwks_url, deployment_id, send_pii, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [institutionId(req), b.name, b.client_id, b.login_url, b.launch_url, b.jwks_url, b.deployment_id, b.send_pii, b.enabled]
  );
  res.status(201).json(rows[0]);
});
router.put('/lti/tools/:id', integrations, async (req, res) => {
  const b = ltiToolBody.parse(req.body);
  const { rows } = await db.query(
    `UPDATE lti_tools SET name = $3, client_id = $4, login_url = $5, launch_url = $6, jwks_url = $7, deployment_id = $8, send_pii = $9, enabled = $10 WHERE id = $1 AND institution_id = $2 RETURNING *`,
    [id.parse(req.params.id), institutionId(req), b.name, b.client_id, b.login_url, b.launch_url, b.jwks_url, b.deployment_id, b.send_pii, b.enabled]
  );
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});
router.delete('/lti/tools/:id', integrations, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM lti_tools WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

/** Tools anyone in a course can open. */
router.get('/courses/:id/lti-tools', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await courseAccess(currentUser(req), offeringId);
  const { rows } = await db.query(`SELECT id, name FROM lti_tools WHERE institution_id = $1 AND enabled ORDER BY name`, [institutionId(req)]);
  res.json(rows);
});

/** Starts a launch: the browser goes to the returned URL (the tool's login initiation). */
router.post('/courses/:id/lti-tools/:toolId/launch', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await courseAccess(currentUser(req), offeringId);
  if (a.role === 'guardian') throw forbidden();
  const { rows } = await db.query<{ id: number; client_id: string; login_url: string; launch_url: string; deployment_id: string }>(
    `SELECT id, client_id, login_url, launch_url, deployment_id FROM lti_tools WHERE id = $1 AND institution_id = $2 AND enabled`,
    [id.parse(req.params.toolId), institutionId(req)]
  );
  const t = rows[0];
  if (!t) throw notFound();
  const state = randomToken(24);
  await db.query(`INSERT INTO lti_launches (state, institution_id, tool_id, user_id, offering_id, nonce) VALUES ($1,$2,$3,$4,$5,$6)`, [state, institutionId(req), t.id, currentUser(req).id, offeringId, randomToken(16)]);
  const q = new URLSearchParams({ iss: issuer(), login_hint: state, target_link_uri: t.launch_url, lti_message_hint: String(offeringId), client_id: t.client_id, lti_deployment_id: t.deployment_id });
  res.json({ url: `${t.login_url}${t.login_url.includes('?') ? '&' : '?'}${q}` });
});

// ---------------------------------------------------------------- privacy

router.get('/privacy/consents', async (req, res) => {
  const u = currentUser(req);
  const { rows } = await db.query(
    `SELECT DISTINCT ON (c.kind, c.student_id) c.kind, c.student_id, c.granted, c.created_at, st.first_name || ' ' || st.last_name AS student
       FROM consents c LEFT JOIN students st ON st.id = c.student_id WHERE c.institution_id = $1 AND c.user_id = $2 ORDER BY c.kind, c.student_id, c.created_at DESC`,
    [institutionId(req), u.id]
  );
  res.json(rows);
});

/** Give or withdraw a consent (for yourself, or for your child). */
router.post('/privacy/consents', async (req, res) => {
  const b = consentBody.parse(req.body);
  const u = currentUser(req);
  if (b.student_id && !(u.role === 'parent' && (await guardianLink(u.id, b.student_id, institutionId(req))))) throw badRequest('Choose one of your children');
  const { rows } = await db.query(`INSERT INTO consents (institution_id, user_id, student_id, kind, granted, ip) VALUES ($1,$2,$3,$4,$5,$6) RETURNING kind, student_id, granted, created_at`, [
    institutionId(req),
    u.id,
    b.student_id ?? null,
    b.kind,
    b.granted,
    req.ip ?? null,
  ]);
  res.status(201).json(rows[0]);
});

/** Who has (and has not) consented, per kind, for students under 18. */
router.get('/privacy/consents/report', requirePermission('privacy.manage'), async (req, res) => {
  const { rows } = await db.query(
    `WITH latest AS (SELECT DISTINCT ON (kind, student_id) kind, student_id, granted FROM consents WHERE institution_id = $1 AND student_id IS NOT NULL ORDER BY kind, student_id, created_at DESC)
     SELECT k.kind, count(*) FILTER (WHERE l.granted)::int AS granted, count(*) FILTER (WHERE l.granted = false)::int AS refused,
            ((SELECT count(*) FROM students WHERE institution_id = $1 AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active') - count(l.student_id))::int AS no_answer
       FROM unnest(ARRAY['data_processing', 'photos', 'ai_features', 'messaging', 'marketing']) k(kind) LEFT JOIN latest l ON l.kind = k.kind GROUP BY k.kind ORDER BY k.kind`,
    [institutionId(req)]
  );
  res.json(rows);
});

router.get('/privacy/requests', async (req, res) => {
  const all = userCan(req, 'privacy.manage');
  const { rows } = await db.query(
    `SELECT r.*, u.full_name AS person, u.email, h.full_name AS handled_by_name FROM privacy_requests r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users h ON h.id = r.handled_by
      WHERE r.institution_id = $1 AND ($2::boolean OR r.user_id = $3) ORDER BY r.created_at DESC LIMIT 200`,
    [institutionId(req), all, currentUser(req).id]
  );
  res.json(rows);
});

/** Ask for a copy of my data, a correction, or deletion (answered within 30 days). */
router.post('/privacy/requests', async (req, res) => {
  const b = privacyRequestBody.parse(req.body);
  const u = currentUser(req);
  const { rows } = await db.query(`INSERT INTO privacy_requests (institution_id, user_id, kind, details, due_at) VALUES ($1,$2,$3,$4, now() + interval '30 days') RETURNING *`, [institutionId(req), u.id, b.kind, b.details]);
  res.status(201).json(rows[0]);
});

/**
 * Answer a request. Access: a ZIP of the person's data is prepared for them. Deletion: the
 * account is closed and its personal details removed (academic and financial records the
 * institution must keep stay, without contact details).
 */
router.patch('/privacy/requests/:id', requirePermission('privacy.manage'), async (req, res) => {
  const b = privacyDecisionBody.parse(req.body);
  const inst = institutionId(req);
  const { rows } = await db.query<{ id: number; kind: string; user_id: number | null; status: string }>(`SELECT id, kind, user_id, status FROM privacy_requests WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), inst]);
  const r = rows[0];
  if (!r) throw notFound();
  if (r.status !== 'open') throw conflict('This request was already answered', 'DECIDED');
  const me = currentUser(req);
  let exportId: number | null = null;
  await withTransaction(async () => {
    if (b.status === 'done' && r.kind === 'access' && r.user_id) {
      const { rows: ex } = await db.query<{ id: number }>(`INSERT INTO data_exports (institution_id, requested_by, scope, subject_user_id) VALUES ($1,$2,'person',$3) RETURNING id`, [inst, me.id, r.user_id]);
      exportId = ex[0]!.id;
      await enqueue('export.build', { id: exportId });
    }
    if (b.status === 'done' && r.kind === 'deletion' && r.user_id) {
      await db.query(
        `UPDATE users SET full_name = 'Deleted user', email = 'deleted-' || id || '@deleted.invalid', password_hash = NULL, is_active = false, token_version = token_version + 1, locale = NULL WHERE id = $1 AND institution_id = $2`,
        [r.user_id, inst]
      );
      await db.query(`UPDATE guardians SET phone = '', email = '', national_id = '', address = '' WHERE user_id = $1`, [r.user_id]);
      await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [r.user_id]);
    }
    await db.query(`UPDATE privacy_requests SET status = $2, response = $3, handled_by = $4, closed_at = now(), export_id = $5 WHERE id = $1`, [r.id, b.status, b.response, me.id, exportId]);
  });
  await audit({ institutionId: inst, userId: me.id, actor: me.name, action: `privacy_${r.kind}_${b.status}`, entity: 'PrivacyRequest', detail: String(r.id) });
  res.json({ ok: true, export_id: exportId });
});

router.get('/privacy/retention', settingsManage, async (req, res) => {
  const { rows } = await db.query<{ r: unknown }>(`SELECT settings->'retention' AS r FROM institutions WHERE id = $1`, [institutionId(req)]);
  res.json(retentionBody.parse(rows[0]?.r ?? {}));
});
router.put('/privacy/retention', settingsManage, async (req, res) => {
  const b = retentionBody.parse(req.body);
  await db.query(`UPDATE institutions SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{retention}', $2::jsonb) WHERE id = $1`, [institutionId(req), JSON.stringify(b)]);
  const u = currentUser(req);
  await audit({ institutionId: institutionId(req), userId: u.id, actor: u.name, action: 'retention_changed', entity: 'Institution', detail: JSON.stringify(b) });
  res.json(b);
});

// ---------------------------------------------------------------- reports

const reportsView = requirePermission('reports.view');

router.get('/reports', reportsView, async (_req, res) => {
  res.json(REPORTS.map((k) => ({ key: k, title: REPORT_TITLES[k] })));
});

/** One report: JSON for the screen, or ?format=csv|xlsx|pdf to download. */
router.get('/reports/:key', reportsView, async (req, res) => {
  const key = String(req.params.key);
  if (!isReport(key)) throw notFound();
  const f = reportFilters.parse(req.query);
  const t = await buildReport(institutionId(req), key, f);
  const format = z.enum(['json', 'csv', 'xlsx', 'pdf']).catch('json').parse(req.query.format);
  if (format === 'json') return res.json(t);
  const { rows } = await db.query<{ name: string }>(`SELECT name FROM institutions WHERE id = $1`, [institutionId(req)]);
  const file = await renderReport(t, format, rows[0]?.name);
  res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${key}.${file.ext}"` });
  res.send(file.body);
});

router.get('/report-schedules', reportsView, async (req, res) => {
  const { rows } = await db.query(`SELECT s.*, u.full_name AS created_by_name FROM report_schedules s LEFT JOIN users u ON u.id = s.created_by WHERE s.institution_id = $1 ORDER BY s.id`, [institutionId(req)]);
  res.json(rows);
});
router.post('/report-schedules', reportsView, async (req, res) => {
  const b = reportScheduleBody.parse(req.body);
  const { rows } = await db.query(`INSERT INTO report_schedules (institution_id, report, filters, format, frequency, recipients, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
    institutionId(req),
    b.report,
    JSON.stringify(b.filters),
    b.format,
    b.frequency,
    b.recipients,
    b.enabled,
    currentUser(req).id,
  ]);
  res.status(201).json(rows[0]);
});
router.delete('/report-schedules/:id', reportsView, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM report_schedules WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});
router.post('/report-schedules/:id/send', reportsView, async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.institution_id, s.report, s.filters, s.format, s.frequency, s.recipients, s.last_sent_at, i.timezone, i.name FROM report_schedules s JOIN institutions i ON i.id = s.institution_id WHERE s.id = $1 AND s.institution_id = $2`,
    [id.parse(req.params.id), institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  await sendSchedule(rows[0]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- feedback, tours, sample data

router.post('/feedback', async (req, res) => {
  const b = feedbackBody.parse(req.body);
  const u = currentUser(req);
  await db.query(`INSERT INTO product_feedback (institution_id, user_id, page, rating, message) VALUES ($1,$2,$3,$4,$5)`, [institutionId(req), u.id, b.page, b.rating, b.message]);
  res.status(201).json({ ok: true });
});

router.put('/me/tours', async (req, res) => {
  const b = z.object({ done: z.array(z.string().max(40)).max(50) }).parse(req.body);
  await db.query(`UPDATE users SET tours_done = $2 WHERE id = $1`, [currentUser(req).id, b.done]);
  res.json(b);
});
router.get('/me/tours', async (req, res) => {
  const { rows } = await db.query<{ tours_done: string[] }>(`SELECT tours_done FROM users WHERE id = $1`, [currentUser(req).id]);
  res.json({ done: rows[0]?.tours_done ?? [] });
});

/** Try Acadex with a sample class (marked, so it can be removed in one step). */
router.post('/institution/sample-data', settingsManage, async (req, res) => {
  const b = z.object({ action: z.enum(['load', 'remove']) }).parse(req.body);
  const inst = institutionId(req);
  if (b.action === 'remove') {
    const out = await withTransaction(async () => {
      const { rows: s } = await db.query<{ id: number }>(`SELECT id FROM sections WHERE institution_id = $1 AND code LIKE 'SAMPLE-%'`, [inst]);
      const ids = s.map((r) => r.id);
      await db.query(`DELETE FROM users WHERE institution_id = $1 AND email LIKE '%@sample.acadex.invalid'`, [inst]);
      const st = await db.query(`DELETE FROM students WHERE institution_id = $1 AND custom_data->>'sample' = 'true'`, [inst]);
      await db.query(`DELETE FROM teachers WHERE institution_id = $1 AND custom_data->>'sample' = 'true'`, [inst]);
      await db.query(`DELETE FROM course_offerings WHERE institution_id = $1 AND section_id = ANY($2::int[])`, [inst, ids]);
      await db.query(`DELETE FROM courses WHERE institution_id = $1 AND code LIKE 'SAMPLE-%'`, [inst]);
      await db.query(`DELETE FROM sections WHERE institution_id = $1 AND id = ANY($2::int[])`, [inst, ids]);
      return { students: st.rowCount ?? 0, sections: ids.length };
    });
    return res.json(out);
  }
  const { rows: exists } = await db.query(`SELECT 1 FROM sections WHERE institution_id = $1 AND code LIKE 'SAMPLE-%' LIMIT 1`, [inst]);
  if (exists[0]) throw conflict('The sample class is already loaded', 'EXISTS');
  const out = await withTransaction(async () => {
    const { rows: sec } = await db.query<{ id: number }>(`INSERT INTO sections (institution_id, code, name) VALUES ($1, 'SAMPLE-7A', 'Sample class 7A') RETURNING id`, [inst]);
    const { rows: t } = await db.query<{ id: number }>(`INSERT INTO teachers (institution_id, first_name, last_name, email, custom_data) VALUES ($1, 'Sample', 'Teacher', 'teacher@sample.acadex.invalid', '{"sample":true}') RETURNING id`, [inst]);
    const names = ['Ayesha Khan', 'Bilal Ahmed', 'Fatima Noor', 'Hamza Ali', 'Maryam Iqbal', 'Omar Farooq', 'Sana Tariq', 'Usman Raza', 'Zainab Malik', 'Hassan Javed'];
    for (const [i, n] of names.entries()) {
      const [first, last] = n.split(' ');
      await db.query(`INSERT INTO students (institution_id, section_id, roll_no, first_name, last_name, email, custom_data) VALUES ($1,$2,$3,$4,$5,$6,'{"sample":true}')`, [inst, sec[0]!.id, `S${String(i + 1).padStart(2, '0')}`, first, last, `student${i + 1}.${inst}@sample.acadex.invalid`]);
    }
    for (const [code, name] of [['SAMPLE-MATH', 'Mathematics (sample)'], ['SAMPLE-ENG', 'English (sample)']] as const) {
      const { rows: c } = await db.query<{ id: number }>(`INSERT INTO courses (institution_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [inst, code, name]);
      const { rows: o } = await db.query<{ id: number }>(`INSERT INTO course_offerings (institution_id, section_id, course_id) VALUES ($1,$2,$3) RETURNING id`, [inst, sec[0]!.id, c[0]!.id]);
      await db.query(`INSERT INTO section_staff (institution_id, teacher_id, offering_id, section_id) VALUES ($1,$2,$3,$4)`, [inst, t[0]!.id, o[0]!.id, sec[0]!.id]);
    }
    return { students: names.length, sections: 1, courses: 2 };
  });
  res.status(201).json(out);
});

/** OneRoster 1.1 CSV export (orgs, academic sessions, courses, classes, users, enrollments) as a ZIP. */
router.get('/institution/oneroster/export', requirePermission('imports.run'), async (req, res) => {
  const inst = institutionId(req);
  const q = async (sql: string) => (await db.query(sql, [inst])).rows;
  const zip = new ZipWriter();
  const orgs = await q(`SELECT id, name, slug FROM institutions WHERE id = $1`);
  zip.add('orgs.csv', toCsv(['sourcedId', 'status', 'dateLastModified', 'name', 'type', 'identifier', 'parentSourcedId'], orgs.map((o) => [`org-${o.id}`, 'active', '', o.name, 'school', o.slug, ''])));
  const terms = await q(`SELECT t.id, t.name, t.starts_on, t.ends_on, y.name AS year FROM terms t LEFT JOIN academic_years y ON y.id = t.academic_year_id WHERE t.institution_id = $1`);
  const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));
  zip.add('academicSessions.csv', toCsv(['sourcedId', 'status', 'dateLastModified', 'title', 'type', 'startDate', 'endDate', 'parentSourcedId', 'schoolYear'], terms.map((t) => [`term-${t.id}`, 'active', '', t.name, 'term', d(t.starts_on), d(t.ends_on), '', String(t.year ?? '')])));
  const courses = await q(`SELECT id, code, name FROM courses WHERE institution_id = $1 AND deleted_at IS NULL`);
  zip.add('courses.csv', toCsv(['sourcedId', 'status', 'dateLastModified', 'schoolYearSourcedId', 'title', 'courseCode', 'grades', 'orgSourcedId', 'subjects'], courses.map((c) => [`course-${c.id}`, 'active', '', '', c.name, c.code, '', `org-${inst}`, ''])));
  const classes = await q(`SELECT o.id, o.course_id, o.term_id, c.name, s.name AS section FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections s ON s.id = o.section_id WHERE o.institution_id = $1`);
  zip.add('classes.csv', toCsv(['sourcedId', 'status', 'dateLastModified', 'title', 'grades', 'courseSourcedId', 'classCode', 'classType', 'location', 'schoolSourcedId', 'termSourcedIds', 'subjects'], classes.map((c) => [`class-${c.id}`, 'active', '', `${c.name}${c.section ? ` ${c.section}` : ''}`, '', `course-${c.course_id}`, String(c.id), 'scheduled', '', `org-${inst}`, c.term_id ? `term-${c.term_id}` : '', ''])));
  const people = await q(
    `SELECT 's-' || id AS sid, first_name, last_name, email, roll_no AS identifier, 'student' AS role FROM students WHERE institution_id = $1 AND deleted_at IS NULL
     UNION ALL SELECT 't-' || id, first_name, last_name, email, '' , 'teacher' FROM teachers WHERE institution_id = $1 AND deleted_at IS NULL`
  );
  zip.add('users.csv', toCsv(['sourcedId', 'status', 'dateLastModified', 'enabledUser', 'orgSourcedIds', 'role', 'username', 'userIds', 'givenName', 'familyName', 'middleName', 'identifier', 'email', 'sms', 'phone', 'agentSourcedIds', 'grades', 'password'], people.map((p) => [p.sid, 'active', '', 'true', `org-${inst}`, p.role, p.email ?? '', '', p.first_name, p.last_name ?? '', '', p.identifier ?? '', p.email ?? '', '', '', '', '', ''])));
  const enr = await q(
    `SELECT o.id AS class_id, 's-' || st.id AS uid, 'student' AS role FROM course_offerings o JOIN students st ON st.institution_id = o.institution_id AND st.deleted_at IS NULL
        AND ((o.enrollment_mode = 'section' AND st.section_id = o.section_id) OR EXISTS (SELECT 1 FROM enrollments e WHERE e.offering_id = o.id AND e.student_id = st.id AND e.status = 'active'))
      WHERE o.institution_id = $1
     UNION ALL SELECT ss.offering_id, 't-' || ss.teacher_id, 'teacher' FROM section_staff ss WHERE ss.institution_id = $1 AND ss.offering_id IS NOT NULL`
  );
  zip.add('enrollments.csv', toCsv(['sourcedId', 'status', 'dateLastModified', 'classSourcedId', 'schoolSourcedId', 'userSourcedId', 'role', 'primary', 'beginDate', 'endDate'], enr.map((e, i) => [`enr-${i + 1}`, 'active', '', `class-${e.class_id}`, `org-${inst}`, e.uid, e.role, e.role === 'teacher' ? 'true' : 'false', '', ''])));
  zip.add('manifest.csv', toCsv(['propertyName', 'value'], [['manifest.version', '1.0'], ['oneroster.version', '1.1'], ['file.orgs', 'bulk'], ['file.academicSessions', 'bulk'], ['file.courses', 'bulk'], ['file.classes', 'bulk'], ['file.users', 'bulk'], ['file.enrollments', 'bulk']]));
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="oneroster.zip"' });
  res.send(zip.finish());
});

export default router;
