// Signed JWTs: short-lived access tokens (one per session) and the brief "second factor
// pending" token issued between password and 2FA code.
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';

export interface AccessClaims {
  id: number;
  /** users.token_version at issue time: bumping it revokes every token */
  tv: number;
  /** sessions.id */
  sid: string;
  institution_id: number | null;
  /** expiry (seconds since the epoch), set on verified tokens */
  exp?: number;
}

const ACCESS_AUDIENCE = 'acadex:access';
const MFA_AUDIENCE = 'acadex:mfa';

/** Lifetime of the access token in seconds (for the client's refresh timer). */
export function accessTokenSeconds(): number {
  const ttl = getConfig().accessTokenTtl;
  const m = /^(\d+)\s*(s|m|h|d)?$/.exec(ttl);
  if (!m) return 900;
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[(m[2] ?? 's') as 's' | 'm' | 'h' | 'd']);
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, getConfig().jwtSecret, {
    algorithm: 'HS256',
    audience: ACCESS_AUDIENCE,
    expiresIn: accessTokenSeconds(),
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const p = jwt.verify(token, getConfig().jwtSecret, { algorithms: ['HS256'], audience: ACCESS_AUDIENCE }) as jwt.JwtPayload;
    if (!Number.isInteger(p.id) || !Number.isInteger(p.tv) || typeof p.sid !== 'string') return null;
    return { id: p.id, tv: p.tv, sid: p.sid, institution_id: Number.isInteger(p.institution_id) ? p.institution_id : null, exp: p.exp };
  } catch {
    return null;
  }
}

/** After a correct password when the account has 2FA: proves step one for 5 minutes. */
export function signMfaChallenge(userId: number, tokenVersion: number): string {
  return jwt.sign({ id: userId, tv: tokenVersion }, getConfig().jwtSecret, {
    algorithm: 'HS256',
    audience: MFA_AUDIENCE,
    expiresIn: 300,
  });
}

export function verifyMfaChallenge(token: string): { id: number; tv: number } | null {
  try {
    const p = jwt.verify(token, getConfig().jwtSecret, { algorithms: ['HS256'], audience: MFA_AUDIENCE }) as jwt.JwtPayload;
    return Number.isInteger(p.id) && Number.isInteger(p.tv) ? { id: p.id, tv: p.tv } : null;
  } catch {
    return null;
  }
}
