// The public site's API (no sign-in; mounted under /api/public): plans for the pricing page,
// self-serve sign-up (a trial with an invited administrator), demo requests, the branding and
// app manifest of an institution's own domain, and signed downloads of scheduled reports.
import { Router } from 'express';
import { z } from 'zod';
import { demoRequestBody, signupBody } from '@acadex/shared';
import { inviteUser } from '../auth/invites';
import { db, runAsSystem, withTransaction } from '../db/context';
import { audit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { locationFor } from '../lib/country';
import { sendEmail } from '../lib/mailer';
import { verifyDownload } from '../lib/reports';
import { grantSystemRole } from '../rbac';
import { storage } from '../storage';

const router = Router();

/** Public plans with prices, limits and features. */
router.get('/plans', async (_req, res) => {
  const { rows } = await runAsSystem(() => db.query(`SELECT key, name, description, prices, limits, features, trial_days FROM plans WHERE public ORDER BY position, key`));
  res.json(rows);
});

/** Start a free trial: the institution is created and its administrator gets an invitation email. */
router.post('/signup', async (req, res) => {
  const b = signupBody.parse(req.body);
  const out = await runAsSystem(async () => {
    const { rows: plan } = await db.query<{ key: string; trial_days: number }>(`SELECT key, trial_days FROM plans WHERE key = $1 AND public`, [b.plan]);
    const p = plan[0] ?? { key: 'free', trial_days: 0 };
    const { rows: taken } = await db.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [b.email]);
    if (taken[0]) throw conflict('That email already has an Acadex account — sign in, or use another email', 'EMAIL_TAKEN');
    const base = b.institution.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'school';
    let slug = base;
    for (let i = 2; (await db.query(`SELECT 1 FROM institutions WHERE slug = $1`, [slug])).rows[0]; i++) slug = `${base}-${i}`;
    // currency, timezone, formats and week start follow the chosen country
    const d = locationFor(b.country);
    return withTransaction(async (client) => {
      const { rows: inst } = await client.query<{ id: number; name: string }>(
        `INSERT INTO institutions (name, slug, plan, contact_email, phone, currency, timezone, locale, type, country, trial_ends_at, settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11::int > 0 THEN CURRENT_DATE + $11::int END, $12) RETURNING id, name`,
        [b.institution, slug, p.key, b.email, b.phone, d.currency, d.timezone, d.locale, b.type, d.country, p.trial_days, JSON.stringify({ week_start: d.weekStart })]
      );
      const { rows: admin } = await client.query<{ id: number }>(`INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES ($1,'institution_admin',$2,NULL,$3) RETURNING id`, [inst[0]!.id, b.email, b.name]);
      await grantSystemRole(client, admin[0]!.id, 'institution_admin', inst[0]!.id, null);
      await client.query(`INSERT INTO consents (institution_id, user_id, kind, granted, ip) VALUES ($1,$2,'tenant_dpa',true,$3)`, [inst[0]!.id, admin[0]!.id, req.ip ?? null]);
      await audit({ institutionId: inst[0]!.id, userId: admin[0]!.id, actor: b.name, action: 'self_signup', entity: 'Institution', detail: `${b.institution} (${p.key} trial)` }, client);
      return { institution: inst[0]!, adminId: admin[0]!.id, slug, trialDays: p.trial_days };
    });
  });
  await runAsSystem(() => inviteUser(out.adminId, { id: null, name: 'Acadex' }));
  res.status(201).json({ slug: out.slug, trial_days: out.trialDays, message: 'Check your email for the link to set your password.' });
});

/** Book a demo: the platform team is told by email. */
router.post('/demo', async (req, res) => {
  const b = demoRequestBody.parse(req.body);
  await runAsSystem(async () => {
    await db.query(`INSERT INTO demo_requests (name, email, phone, institution, type, size, message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [b.name, b.email, b.phone, b.institution, b.type, b.size, b.message]);
    const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE role = 'super_admin' AND is_active`);
    for (const r of rows) await sendEmail({ to: r.email, subject: `Demo request: ${b.institution}`, text: `${b.name} <${b.email}> ${b.phone}\n${b.type}, ${b.size}\n\n${b.message}`, template: 'demo_request' });
  });
  res.status(201).json({ ok: true });
});

async function brandFor(host: string) {
  const { rows } = await runAsSystem(() =>
    db.query<{ slug: string; name: string; logo_url: string; primary_color: string; app_name: string | null; white_label: boolean }>(
      `SELECT i.slug, i.name, i.logo_url, i.primary_color, i.settings->'branding'->>'app_name' AS app_name, true AS white_label
         FROM custom_domains d JOIN institutions i ON i.id = d.institution_id WHERE d.domain = $1 AND d.verified_at IS NOT NULL AND i.status = 'active'`,
      [host.toLowerCase().replace(/:\d+$/, '')]
    )
  );
  return rows[0] ?? null;
}

/** Branding for an institution's own domain (the sign-in page shows it). */
router.get('/brand', async (req, res) => {
  const host = z.string().max(253).parse(req.query.host ?? '');
  const b = await brandFor(host);
  if (!b) throw notFound();
  res.json({ slug: b.slug, name: b.name, app_name: b.app_name || b.name, logo_url: b.logo_url, primary_color: b.primary_color });
});

/** The installable app's manifest with the institution's name and colour on its own domain. */
router.get('/manifest.webmanifest', async (req, res) => {
  const host = z.string().max(253).catch('').parse(req.query.host ?? '');
  const b = host ? await brandFor(host) : null;
  const name = b ? b.app_name || b.name : 'Acadex';
  res.type('application/manifest+json').json({
    name,
    short_name: name.slice(0, 12),
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: b?.primary_color ?? '#4f46e5',
    icons: [
      { src: b?.logo_url || '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

/** Video tutorial links per help article (set by the platform under Settings). */
router.get('/tutorials', async (_req, res) => {
  const { rows } = await runAsSystem(() => db.query<{ value: Record<string, string> }>(`SELECT value FROM platform_settings WHERE key = 'tutorial_videos'`));
  res.json(rows[0]?.value ?? {});
});

/** A scheduled report's file, through the signed link in its email. */
router.get('/reports/download', async (req, res) => {
  const q = z.object({ key: z.string().regex(/^reports\/\d+\/[A-Za-z0-9._-]+$/), exp: z.coerce.number(), sig: z.string().max(100) }).parse(req.query);
  if (!verifyDownload(q.key, q.exp, q.sig)) throw notFound('This link has expired');
  const ext = q.key.split('.').pop();
  const type = ext === 'pdf' ? 'application/pdf' : ext === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="report.${ext}"` });
  res.send(await storage().get(q.key));
});

export default router;
