// Authentication: login (+ 2FA), refresh, logout, sessions, invites, password reset,
// email verification and 2FA management.
import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  acceptInviteBody,
  changePasswordBody,
  emailToken,
  loginBody,
  mfaCode,
  mfaDisableBody,
  mfaEnableBody,
  mfaVerifyBody,
  passwordResetBody,
  passwordResetRequestBody,
  verifyEmailBody,
} from '@acadex/shared';
import { asSystem, db, runAsSystem, systemContext } from '../db/context';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { hashPassword } from '../lib/passwords';
import { auth, authAllowingIncomplete, currentUser, loadUserRow, mfaEnrollmentRequired, toSessionUser } from '../middleware/auth';
import { createEmailToken, consumeEmailToken, peekEmailToken } from '../auth/email-tokens';
import { sendPasswordResetEmail, sendSecurityNotice, sendVerifyEmail } from '../auth/emails';
import { disableTotp, enableTotp, regenerateRecoveryCodes, remainingRecoveryCodes, setupTotp, verifySecondFactor } from '../auth/mfa';
import { clearRefreshCookie, loadInstitutionSummary, REFRESH_COOKIE, requestMeta, sessionResponse, setRefreshCookie, startSession } from '../auth/service';
import { markSessionMfaVerified, revokeSession, revokeUserSessions, rotateRefreshToken } from '../auth/sessions';
import { signMfaChallenge, verifyAccessToken, verifyMfaChallenge } from '../auth/tokens';

const router = Router();
// Login, refresh and email links work before any tenant is known. Authenticated auth routes
// switch to the caller's own context in auth(); users can always read and update their own row.
router.use(systemContext);

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

interface Account {
  id: number;
  email: string;
  full_name: string;
  role: string;
  institution_id: number | null;
  password_hash: string | null;
  is_active: boolean;
  token_version: number;
  mfa_enabled: boolean;
}

const accountByEmail = async (email: string) =>
  (await db.query<Account>('SELECT * FROM users WHERE email = $1', [email])).rows[0];
const accountById = async (id: number) => (await db.query<Account>('SELECT * FROM users WHERE id = $1', [id])).rows[0];

const auditSelf = (user: { id: number; institution_id: number | null; full_name?: string; name?: string }, action: string, detail = '') =>
  asSystem(() =>
    audit({ institutionId: user.institution_id, userId: user.id, actor: user.full_name ?? user.name ?? '', action, entity: 'Auth', detail })
  );

/** An audit entry that survives the request failing (failed sign-ins answer 401, which rolls back). */
const auditStandalone = (user: { id: number; institution_id: number | null; full_name?: string }, action: string, detail = '') =>
  runAsSystem(() => audit({ institutionId: user.institution_id, userId: user.id, actor: user.full_name ?? '', action, entity: 'Auth', detail })).catch(() => {});

/** Cookie-authenticated endpoints need a custom header: plain cross-site form posts can't send one. */
const requireClientHeader: RequestHandler = (req, res, next) => {
  if (req.get('x-acadex-client') !== 'web') {
    res.status(403).json({ error: 'Missing client header', code: 'CSRF' });
    return;
  }
  next();
};

async function assertInstitutionActive(institutionId: number | null) {
  if (!institutionId) return;
  const institution = await loadInstitutionSummary(institutionId);
  if (institution && institution.status !== 'active') throw forbidden('This institution account is currently suspended.', 'INSTITUTION_SUSPENDED');
}

// ---------- login ----------
router.post('/login', async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'Email and password are required' });
  const { email, password } = parsed.data;
  const user = await accountByEmail(email);
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.password_hash || !ok || !user.is_active) {
    if (user) await auditStandalone(user, 'sign_in_failed', !user.is_active ? 'account deactivated' : !user.password_hash ? 'invitation not accepted' : 'wrong password');
    return void res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
  }
  await assertInstitutionActive(user.institution_id);
  if (user.mfa_enabled) {
    // password was right; a second factor completes the sign-in
    return void res.json({ mfa_required: true, mfa_token: signMfaChallenge(user.id, user.token_version) });
  }
  const session = await startSession(req, res, user.id);
  await auditSelf(user, 'sign_in', 'password');
  res.json(session);
});

router.post('/mfa/verify', async (req, res) => {
  const { mfa_token, code } = mfaVerifyBody.parse(req.body);
  const challenge = verifyMfaChallenge(mfa_token);
  if (!challenge) throw unauthorized('This sign-in attempt expired. Please sign in again.', 'MFA_CHALLENGE_EXPIRED');
  const user = await accountById(challenge.id);
  if (!user || !user.is_active || user.token_version !== challenge.tv || !user.mfa_enabled) {
    throw unauthorized('This sign-in attempt expired. Please sign in again.', 'MFA_CHALLENGE_EXPIRED');
  }
  await assertInstitutionActive(user.institution_id);
  const method = await verifySecondFactor(user.id, code);
  if (!method) {
    await auditStandalone(user, 'sign_in_failed', 'wrong second-factor code');
    throw badRequest('That code is not valid. Try the latest code from your app.');
  }
  if (method === 'recovery') await auditSelf(user, 'mfa_recovery_code_used');
  const session = await startSession(req, res, user.id, { mfaVerified: true });
  await auditSelf(user, 'sign_in', method === 'recovery' ? 'password + recovery code' : 'password + authenticator');
  res.json(session);
});

// ---------- refresh ----------
router.post('/refresh', requireClientHeader, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string' || !token) throw unauthorized('Not signed in', 'NO_REFRESH_TOKEN');
  const rotated = await rotateRefreshToken(token, requestMeta(req));
  if (!rotated.ok) {
    clearRefreshCookie(res);
    if (rotated.reason === 'reused') {
      req.log.warn({ reason: rotated.reason }, 'refresh token reuse — session revoked');
      const owner = rotated.userId ? await asSystem(() => accountById(rotated.userId!)) : null;
      if (owner) await auditStandalone(owner, 'refresh_token_reused', 'a stolen or replayed sign-in token was used; the session was ended');
    }
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_ENDED');
  }
  const row = await loadUserRow(rotated.userId, rotated.sessionId);
  if (!row || !row.is_active || row.session_revoked || row.session_expired || (row.mfa_enabled && !row.session_mfa_verified)) {
    clearRefreshCookie(res);
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_ENDED');
  }
  await assertInstitutionActive(row.institution_id);
  setRefreshCookie(res, rotated.refreshToken);
  res.json(await sessionResponse(row, rotated.sessionId));
});

// ---------- logout ----------
router.post('/logout', requireClientHeader, async (req, res) => {
  const header = req.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
  if (bearer) await revokeSession(bearer.sid, 'logout');
  else {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (typeof token === 'string' && token) {
      const rotated = await rotateRefreshToken(token);
      if (rotated.ok) await revokeSession(rotated.sessionId, 'logout');
    }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

/** Sign out on every device (also invalidates all access tokens at once). */
router.post('/logout-all', auth, async (req, res) => {
  const user = currentUser(req);
  await asSystem(async () => {
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);
    await revokeUserSessions(user.id, 'logout everywhere');
  });
  await auditSelf(user, 'signed_out_everywhere');
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// ---------- the signed-in user ----------
router.get('/me', authAllowingIncomplete, async (req, res) => {
  const user = currentUser(req);
  res.json({ user: toSessionUser(user), institution: await loadInstitutionSummary(user.institution_id), email_verified: user.email_verified });
});

router.post('/change-password', authAllowingIncomplete, async (req, res) => {
  const { current_password, new_password } = changePasswordBody.parse(req.body);
  const me = currentUser(req);
  const user = (await asSystem(() => accountById(me.id)))!;
  if (!user.password_hash || !(await bcrypt.compare(current_password, user.password_hash))) {
    throw badRequest('Current password is incorrect');
  }
  if (await bcrypt.compare(new_password, user.password_hash)) throw badRequest('Choose a password you have not used here');
  await asSystem(async () => {
    await db.query(
      `UPDATE users SET password_hash=$2, must_change_password=FALSE, password_changed_at=now(), token_version=token_version+1 WHERE id=$1`,
      [me.id, await hashPassword(new_password)]
    );
    // other devices are signed out; this one continues with a fresh access token
    await revokeUserSessions(me.id, 'password changed', me.session_id);
  });
  await auditSelf(user, 'password_changed');
  await sendSecurityNotice({ to: user.email, name: user.full_name, userId: user.id, what: 'Your password was changed' });
  const row = (await asSystem(() => loadUserRow(me.id, me.session_id)))!;
  res.json(await sessionResponse(row, me.session_id));
});

// ---------- sessions (devices) ----------
router.get('/sessions', auth, async (req, res) => {
  const me = currentUser(req);
  const { rows } = await db.query(
    `SELECT id, created_at, last_used_at, user_agent, ip, id = $2::uuid AS current
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC`,
    [me.id, me.session_id]
  );
  res.json(rows);
});

router.delete('/sessions/:id', auth, async (req, res) => {
  const me = currentUser(req);
  const sid = z.uuid().parse(req.params.id);
  const { rowCount } = await db.query(
    `UPDATE sessions SET revoked_at = now(), revoke_reason = 'signed out from another device'
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sid, me.id]
  );
  if (!rowCount) throw notFound('Session not found');
  await auditSelf(me, 'session_revoked', 'one device');
  res.json({ ok: true });
});

router.post('/sessions/revoke-others', auth, async (req, res) => {
  const me = currentUser(req);
  const n = await revokeUserSessions(me.id, 'signed out from another device', me.session_id);
  await auditSelf(me, 'session_revoked', `all other devices (${n})`);
  res.json({ ok: true, revoked: n });
});

// ---------- invitations ----------
router.get('/invites/:token', async (req, res) => {
  const token = emailToken.parse(req.params.token);
  const userId = await peekEmailToken(token, 'invite');
  if (!userId) throw notFound('This invitation link is invalid or has expired. Ask your institution for a new one.');
  const { rows } = await db.query<{ email: string; full_name: string; institution_name: string | null }>(
    `SELECT u.email, u.full_name, s.name AS institution_name FROM users u LEFT JOIN institutions s ON s.id = u.institution_id WHERE u.id = $1`,
    [userId]
  );
  res.json(rows[0]);
});

router.post('/invites/accept', async (req, res) => {
  const { token, password } = acceptInviteBody.parse(req.body);
  const userId = await consumeEmailToken(token, 'invite');
  if (!userId) throw badRequest('This invitation link is invalid or has expired. Ask your institution for a new one.');
  const user = (await accountById(userId))!;
  if (!user.is_active) throw forbidden('This account has been deactivated.');
  await assertInstitutionActive(user.institution_id);
  await db.query(
    `UPDATE users SET password_hash=$2, must_change_password=FALSE, password_changed_at=now(),
            email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`,
    [userId, await hashPassword(password)]
  );
  await auditSelf(user, 'accept_invite');
  res.json(await startSession(req, res, userId));
});

// ---------- password reset ----------
router.post('/password-reset/request', async (req, res) => {
  const { email } = passwordResetRequestBody.parse(req.body);
  const user = await accountByEmail(email);
  // same answer whether or not the account exists
  if (user && user.is_active && user.password_hash) {
    const { token } = await createEmailToken(user.id, 'password_reset');
    await sendPasswordResetEmail({ to: user.email, name: user.full_name, token, userId: user.id });
  }
  res.status(202).json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
});

router.post('/password-reset/confirm', async (req, res) => {
  const { token, password } = passwordResetBody.parse(req.body);
  const userId = await consumeEmailToken(token, 'password_reset');
  if (!userId) throw badRequest('This reset link is invalid or has expired. Request a new one.');
  const user = (await accountById(userId))!;
  await db.query(
    `UPDATE users SET password_hash=$2, must_change_password=FALSE, password_changed_at=now(), token_version=token_version+1,
            email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`,
    [userId, await hashPassword(password)]
  );
  await revokeUserSessions(userId, 'password reset');
  await sendSecurityNotice({ to: user.email, name: user.full_name, userId, what: 'Your password was reset' });
  await auditSelf(user, 'password_reset');
  res.json({ ok: true });
});

// ---------- email verification ----------
router.post('/verify-email/request', auth, async (req, res) => {
  const me = currentUser(req);
  if (me.email_verified) return void res.json({ ok: true, already_verified: true });
  const { token } = await createEmailToken(me.id, 'verify_email');
  await sendVerifyEmail({ to: me.email, name: me.name, token, userId: me.id });
  res.status(202).json({ ok: true });
});

router.post('/verify-email/confirm', async (req, res) => {
  const { token } = verifyEmailBody.parse(req.body);
  const userId = await consumeEmailToken(token, 'verify_email');
  if (!userId) throw badRequest('This confirmation link is invalid or has expired.');
  await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [userId]);
  res.json({ ok: true });
});

// ---------- two-factor authentication ----------
router.get('/mfa', auth, async (req, res) => {
  const me = currentUser(req);
  res.json({
    enabled: me.mfa_enabled,
    required: mfaEnrollmentRequired(me.role, false),
    recovery_codes_remaining: me.mfa_enabled ? await remainingRecoveryCodes(me.id) : 0,
  });
});

router.post('/mfa/totp/setup', authAllowingIncomplete, async (req, res) => {
  const me = currentUser(req);
  if (me.mfa_enabled) throw conflict('Two-factor authentication is already on');
  const { secret, otpauthUrl } = await setupTotp(me.id, me.email);
  res.json({ secret, otpauth_url: otpauthUrl });
});

router.post('/mfa/totp/enable', authAllowingIncomplete, async (req, res) => {
  const me = currentUser(req);
  const { code } = mfaEnableBody.parse(req.body);
  const recoveryCodes = await enableTotp(me.id, code);
  if (!recoveryCodes) throw badRequest('That code is not valid. Check the time on your phone and try the newest code.');
  // this device has just proven the factor; every other session must sign in again with it
  await markSessionMfaVerified(me.session_id);
  await revokeUserSessions(me.id, '2FA enabled', me.session_id);
  await auditSelf(me, 'mfa_enabled');
  await sendSecurityNotice({ to: me.email, name: me.name, userId: me.id, what: 'Two-factor authentication was turned on' });
  const row = (await asSystem(() => loadUserRow(me.id, me.session_id)))!;
  res.json({ recovery_codes: recoveryCodes, ...(await sessionResponse(row, me.session_id)) });
});

router.post('/mfa/disable', auth, async (req, res) => {
  const me = currentUser(req);
  const { password, code } = mfaDisableBody.parse(req.body);
  if (mfaEnrollmentRequired(me.role, false)) {
    throw badRequest('Two-factor authentication is required for your role and cannot be turned off.');
  }
  const user = (await asSystem(() => accountById(me.id)))!;
  if (!user.password_hash || !(await bcrypt.compare(password, user.password_hash))) throw badRequest('Password is incorrect');
  if (!(await verifySecondFactor(me.id, code))) throw badRequest('That code is not valid');
  await disableTotp(me.id);
  await auditSelf(me, 'mfa_disabled');
  await sendSecurityNotice({ to: me.email, name: me.name, userId: me.id, what: 'Two-factor authentication was turned off' });
  res.json({ ok: true });
});

router.post('/mfa/recovery-codes', auth, async (req, res) => {
  const me = currentUser(req);
  const { code } = z.object({ code: mfaCode }).parse(req.body);
  if (!me.mfa_enabled) throw badRequest('Two-factor authentication is off');
  if (!(await verifySecondFactor(me.id, code))) throw badRequest('That code is not valid');
  const codes = await regenerateRecoveryCodes(me.id);
  await auditSelf(me, 'mfa_recovery_codes_regenerated');
  res.json({ recovery_codes: codes });
});

export default router;
