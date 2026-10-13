// Server-side sessions with rotating refresh tokens.
//
// Login creates a session and a refresh token (an opaque random string, stored hashed, sent
// as an httpOnly cookie). /auth/refresh exchanges it for a new access token AND a new refresh
// token; the old one is marked used. Presenting a used refresh token again means it was
// copied — the whole session is revoked (reuse detection).
import { getConfig } from '../config';
import { asSystem, db, runAsSystem } from '../db/context';
import { randomToken, sha256 } from './crypto';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
  mfaVerified?: boolean;
}

const days = (n: number) => n * 24 * 60 * 60 * 1000;

async function issueRefreshToken(sessionId: string): Promise<string> {
  const token = randomToken(32);
  await db.query(`INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    sessionId,
    sha256(token),
    new Date(Date.now() + days(getConfig().refreshTokenTtlDays)),
  ]);
  return token;
}

export async function createSession(userId: number, meta: SessionMeta = {}): Promise<{ sessionId: string; refreshToken: string }> {
  return asSystem(async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO sessions (user_id, expires_at, user_agent, ip, mfa_verified) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, new Date(Date.now() + days(getConfig().sessionMaxAgeDays)), (meta.userAgent ?? '').slice(0, 300), meta.ip ?? '', !!meta.mfaVerified]
    );
    const sessionId = rows[0]!.id;
    return { sessionId, refreshToken: await issueRefreshToken(sessionId) };
  });
}

export type RotateResult =
  | { ok: true; sessionId: string; userId: number; refreshToken: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' };

/** Exchange a refresh token for a new one (single use). */
export async function rotateRefreshToken(token: string, meta: SessionMeta = {}): Promise<RotateResult> {
  return asSystem(async () => {
    const { rows } = await db.query<{
      id: number;
      session_id: string;
      used_at: Date | null;
      expires_at: Date;
      user_id: number;
      revoked_at: Date | null;
      session_expires_at: Date;
    }>(
      `SELECT rt.id, rt.session_id, rt.used_at, rt.expires_at, s.user_id, s.revoked_at, s.expires_at AS session_expires_at
         FROM refresh_tokens rt JOIN sessions s ON s.id = rt.session_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt`,
      [sha256(token)]
    );
    const rt = rows[0];
    if (!rt) return { ok: false, reason: 'unknown' };
    if (rt.revoked_at) return { ok: false, reason: 'revoked' };
    if (rt.used_at) {
      // committed on its own: the request answers 401, which rolls back the request transaction
      await runAsSystem(() =>
        db.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'refresh token reused' WHERE id = $1 AND revoked_at IS NULL`, [rt.session_id])
      );
      return { ok: false, reason: 'reused' };
    }
    if (rt.expires_at.getTime() < Date.now() || rt.session_expires_at.getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    await db.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [rt.id]);
    await db.query(`UPDATE sessions SET last_used_at = now(), user_agent = COALESCE(NULLIF($2, ''), user_agent), ip = COALESCE(NULLIF($3, ''), ip) WHERE id = $1`, [
      rt.session_id,
      (meta.userAgent ?? '').slice(0, 300),
      meta.ip ?? '',
    ]);
    return { ok: true, sessionId: rt.session_id, userId: rt.user_id, refreshToken: await issueRefreshToken(rt.session_id) };
  });
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await asSystem(() =>
    db.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, reason])
  );
}

/** Sign a user out everywhere (optionally keeping the current session). */
export async function revokeUserSessions(userId: number, reason: string, exceptSessionId: string | null = null): Promise<number> {
  const { rowCount } = await asSystem(() =>
    db.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = $2
        WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [userId, reason, exceptSessionId]
    )
  );
  return rowCount ?? 0;
}

export async function markSessionMfaVerified(sessionId: string): Promise<void> {
  await asSystem(() => db.query(`UPDATE sessions SET mfa_verified = true WHERE id = $1`, [sessionId]));
}
