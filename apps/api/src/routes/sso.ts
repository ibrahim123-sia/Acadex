// Sign in with Google or Microsoft (only existing accounts; plan must include SSO).
// Mounted under /api/auth/sso.
import { Router } from 'express';
import { z } from 'zod';
import { db, runAsSystem } from '../db/context';
import { getConfig } from '../config';
import { entitlements } from '../lib/platform';
import { emailFromCode, openState, providers, sealState, startUrl, type SsoProvider } from '../lib/sso';
import { signMfaChallenge } from '../auth/tokens';
import { startSession } from '../auth/service';

// ---------------------------------------------------------------- Google / Microsoft sign-in

const router = Router();
const COOKIE = 'acadex_sso';
const app = () => getConfig().appUrl.replace(/\/+$/, '');

router.get('/providers', (_req, res) => {
  res.json(Object.keys(providers()));
});

router.get('/:provider/start', (req, res) => {
  const p = z.enum(['google', 'microsoft']).safeParse(req.params.provider);
  if (!p.success || !providers()[p.data]) return res.redirect(`${app()}/login?sso=unavailable`);
  const { url, state } = startUrl(p.data);
  res.cookie(COOKIE, sealState(state), { httpOnly: true, secure: getConfig().env === 'production', sameSite: 'lax', maxAge: 10 * 60_000, path: '/api/auth/sso' });
  res.redirect(url);
});

router.get('/:provider/callback', async (req, res) => {
  const fail = (why: string) => res.redirect(`${app()}/login?sso=${why}`);
  const p = z.enum(['google', 'microsoft']).safeParse(req.params.provider);
  const st = openState(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { path: '/api/auth/sso' });
  if (!p.success || !st || st.p !== p.data || st.s !== req.query.state || typeof req.query.code !== 'string') return fail('expired');
  const email = await emailFromCode(p.data as SsoProvider, req.query.code, st.v).catch(() => null);
  if (!email) return fail('failed');
  const user = await runAsSystem(async () => {
    const { rows } = await db.query<{ id: number; institution_id: number | null; mfa_enabled: boolean; token_version: number; status: string | null; full_name: string }>(
      `SELECT u.id, u.institution_id, u.mfa_enabled, u.token_version, i.status, u.full_name FROM users u LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE lower(u.email) = $1 AND u.is_active AND u.password_hash IS NOT NULL`,
      [email]
    );
    return rows[0] ?? null;
  });
  if (!user) return fail('no_account');
  if (user.institution_id) {
    if (user.status !== 'active') return fail('suspended');
    const e = await entitlements(user.institution_id);
    if (!e.features.sso) return fail('not_in_plan');
  }
  if (user.mfa_enabled) return res.redirect(`${app()}/login#mfa=${encodeURIComponent(signMfaChallenge(user.id, user.token_version))}`);
  await runAsSystem(() => startSession(req, res, user.id));
  await runAsSystem(() => db.query(`INSERT INTO audit_log (institution_id, user_id, actor, action, entity, detail) VALUES ($1,$2,$3,'sign_in','Auth',$4)`, [user.institution_id, user.id, user.full_name, p.data]));
  res.redirect(`${app()}/login?sso=ok`);
});


export default router;
