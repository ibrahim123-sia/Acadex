// Turning a verified identity into a session: access token + refresh cookie + user profile.
import type { Request, Response } from 'express';
import type { AuthResponse, InstitutionSummary } from '@acadex/shared';
import { getConfig } from '../config';
import { asSystem, db } from '../db/context';
import { loadUserRow, toAuthUser, toSessionUser, type UserRow } from '../middleware/auth';
import { createSession } from './sessions';
import { accessTokenSeconds, signAccessToken } from './tokens';

export const REFRESH_COOKIE = 'acadex_rt';
const COOKIE_PATH = '/api/auth';

export function setRefreshCookie(res: Response, token: string): void {
  const cfg = getConfig();
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: cfg.cookieSameSite,
    path: COOKIE_PATH,
    maxAge: cfg.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  const cfg = getConfig();
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: cfg.cookieSecure, sameSite: cfg.cookieSameSite, path: COOKIE_PATH });
}

export const requestMeta = (req: Request) => ({ userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' });

export async function loadInstitutionSummary(institutionId: number | null): Promise<InstitutionSummary | null> {
  if (!institutionId) return null;
  const { rows } = await asSystem(() =>
    db.query<InstitutionSummary>(
      'SELECT id, name, slug, logo_url, primary_color, plan, status, currency, timezone, locale FROM institutions WHERE id=$1',
      [institutionId]
    )
  );
  return rows[0] ?? null;
}

/** The response body for a live session (new access token for it). */
export async function sessionResponse(row: UserRow, sessionId: string): Promise<AuthResponse> {
  const user = toAuthUser(row, sessionId);
  return {
    access_token: signAccessToken({ id: row.id, tv: row.token_version, sid: sessionId, institution_id: row.institution_id }),
    expires_in: accessTokenSeconds(),
    user: toSessionUser(user),
    institution: await loadInstitutionSummary(row.institution_id),
  };
}

/** Create a session for a user who just proved who they are, and answer with it. */
export async function startSession(
  req: Request,
  res: Response,
  userId: number,
  { mfaVerified = false, impersonatedBy = null as number | null, ttlMinutes = undefined as number | undefined } = {}
): Promise<AuthResponse> {
  const { sessionId, refreshToken } = await createSession(userId, { ...requestMeta(req), mfaVerified, impersonatedBy, ttlMinutes });
  // a support session is not the person's own sign-in
  if (!impersonatedBy) await asSystem(() => db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]));
  const row = (await asSystem(() => loadUserRow(userId, sessionId)))!;
  setRefreshCookie(res, refreshToken);
  return sessionResponse(row, sessionId);
}
