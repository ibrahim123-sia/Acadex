// LTI 1.3 (Acadex launches external tools): the public keys and the OIDC authentication
// endpoint the tool sends the browser to. Mounted under /api/lti.
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, runAsSystem } from '../db/context';
import { formPost, jwks, launchClaims, signJwt } from '../lib/lti';

// ---------------------------------------------------------------- LTI 1.3

const router = Router();

router.get('/jwks', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').json(await jwks());
});

/** The tool's authentication request (OIDC, form_post): answered with the signed launch. */
const authorize = async (req: Request, res: Response) => {
  const p = z
    .object({ client_id: z.string().max(200), redirect_uri: z.string().url().max(1000), login_hint: z.string().max(100), nonce: z.string().max(200), state: z.string().max(1000).default(''), response_type: z.literal('id_token').optional() })
    .safeParse({ ...req.query, ...(typeof req.body === 'object' ? req.body : {}) });
  if (!p.success) return res.status(400).send('Invalid LTI authentication request');
  const q = p.data;
  const launch = await runAsSystem(async () => {
    // the login hint is the one-time launch Acadex created for the signed-in person (5 minutes)
    const { rows } = await db.query<{ institution_id: number; tool_id: number; user_id: number; offering_id: number | null }>(
      `UPDATE lti_launches SET used_at = now() WHERE state = $1 AND used_at IS NULL AND created_at > now() - interval '5 minutes' RETURNING institution_id, tool_id, user_id, offering_id`,
      [q.login_hint]
    );
    const l = rows[0];
    if (!l) return null;
    const { rows: t } = await db.query<{ id: number; name: string; client_id: string; launch_url: string; deployment_id: string; send_pii: boolean }>(
      `SELECT id, name, client_id, launch_url, deployment_id, send_pii FROM lti_tools WHERE id = $1 AND enabled`,
      [l.tool_id]
    );
    const { rows: u } = await db.query<{ id: number; full_name: string; email: string; role: string }>(`SELECT id, full_name, email, role FROM users WHERE id = $1 AND is_active`, [l.user_id]);
    const { rows: c } = l.offering_id
      ? await db.query<{ id: number; code: string; name: string }>(`SELECT o.id, c.code, c.name FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = $1`, [l.offering_id])
      : { rows: [] };
    return t[0] && u[0] ? { tool: t[0], user: u[0], course: c[0] ?? null } : null;
  });
  if (!launch) return res.status(400).send('This launch has expired — open the tool again from Acadex');
  if (launch.tool.client_id !== q.client_id || launch.tool.launch_url !== q.redirect_uri) return res.status(400).send('The tool sent an unexpected client id or redirect URI');
  const token = await signJwt(
    launchClaims({
      tool: launch.tool,
      user: { id: launch.user.id, name: launch.user.full_name, email: launch.user.email, role: launch.user.role },
      course: launch.course,
      nonce: q.nonce,
    })
  );
  const nonce = crypto.randomBytes(16).toString('base64');
  res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${new URL(q.redirect_uri).origin}; base-uri 'none'; frame-ancestors 'none'`);
  res.type('html').send(formPost(q.redirect_uri, { id_token: token, state: q.state }, nonce));
};

router.get('/authorize', authorize);
/** The same, when the tool posts the form (response_mode=form_post). */
router.post('/authorize', authorize);

export default router;
