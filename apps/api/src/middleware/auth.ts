import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MFA_REQUIRED_ROLES, type Permission, type Role, type SessionUser } from '@acadex/shared';
import { getConfig } from '../config';
import { db, setTenant } from '../db/context';
import { can, type AccessContext, type Grant } from '../rbac';
import { verifyAccessToken } from '../auth/tokens';

export interface AuthUser {
  id: number;
  role: Role;
  school_id: number | null;
  ref_id: number | null;
  name: string;
  email: string;
  token_version: number;
  session_id: string;
  must_change_password: boolean;
  mfa_enabled: boolean;
  email_verified: boolean;
  /** an administrator who still has to set up 2FA (ADMIN_MFA=required) */
  mfa_enrollment_required: boolean;
  /** Effective permission grants from all of the user's role assignments. */
  grants: Grant[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const deny = (res: Response, status: number, error: string, code: string) => res.status(status).json({ error, code });

export interface UserRow {
  id: number;
  role: Role;
  school_id: number | null;
  ref_id: number | null;
  full_name: string;
  email: string;
  is_active: boolean;
  token_version: number;
  must_change_password: boolean;
  mfa_enabled: boolean;
  email_verified_at: Date | null;
  school_status: string | null;
  session_found: boolean;
  session_revoked: boolean;
  session_expired: boolean;
  session_mfa_verified: boolean;
  grants: Grant[];
}

/** The account, its school status, the given session's state and all role grants. */
export async function loadUserRow(userId: number, sessionId: string): Promise<UserRow | undefined> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.id, u.role, u.school_id, u.ref_id, u.full_name, u.email, u.is_active, u.token_version,
            u.must_change_password, u.mfa_enabled, u.email_verified_at, s.status AS school_status,
            ss.id IS NOT NULL AS session_found,
            ss.revoked_at IS NOT NULL AS session_revoked,
            COALESCE(ss.expires_at < now(), true) AS session_expired,
            COALESCE(ss.mfa_verified, false) AS session_mfa_verified,
            COALESCE((SELECT json_agg(DISTINCT jsonb_build_object('permission', rp.permission,
                               'scopeType', ur.scope_type, 'scopeId', ur.scope_id))
                        FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                       WHERE ur.user_id = u.id), '[]') AS grants
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       LEFT JOIN sessions ss ON ss.id = $2::uuid AND ss.user_id = u.id
      WHERE u.id = $1`,
    [userId, sessionId]
  );
  return rows[0];
}

/** Whether this account must enrol in 2FA before using the app. */
export const mfaEnrollmentRequired = (role: Role, mfaEnabled: boolean) =>
  getConfig().adminMfaRequired && MFA_REQUIRED_ROLES.includes(role) && !mfaEnabled;

// allowIncomplete: for the few routes an account must reach while it still has to change its
// password or set up 2FA (auth/me, logout, change-password, 2FA setup).
const makeAuth = ({ allowIncomplete = false } = {}): RequestHandler =>
  async function auth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return void deny(res, 401, 'No token provided', 'UNAUTHENTICATED');
    const claims = verifyAccessToken(header.slice(7));
    if (!claims) return void deny(res, 401, 'Invalid or expired session', 'TOKEN_INVALID');

    // The lookup runs in the context the (signed) token claims — its own user row, school row,
    // session and role assignments are visible there without bypassing RLS — and every claim is
    // verified against the database below. Every later query in the request stays in it.
    setTenant(claims.school_id, claims.id);
    const u = await loadUserRow(claims.id, claims.sid);
    // token_version is bumped on password change / logout-everywhere; a token issued for
    // another school than the account's current one is stale; the session must be live
    if (!u || !u.is_active || u.token_version !== claims.tv || u.school_id !== claims.school_id) {
      return void deny(res, 401, 'Invalid or expired session', 'SESSION_INVALID');
    }
    if (!u.session_found || u.session_revoked || u.session_expired) {
      return void deny(res, 401, 'You have been signed out. Please sign in again.', 'SESSION_REVOKED');
    }
    if (u.mfa_enabled && !u.session_mfa_verified) {
      return void deny(res, 401, 'Two-factor verification is required. Please sign in again.', 'MFA_REQUIRED');
    }
    if (u.school_id && u.school_status !== 'active') {
      return void deny(res, 403, 'This school account is currently suspended.', 'SCHOOL_SUSPENDED');
    }
    const enrollmentRequired = mfaEnrollmentRequired(u.role, u.mfa_enabled);
    if (!allowIncomplete) {
      if (u.must_change_password) {
        return void deny(res, 403, 'Please set a new password first.', 'PASSWORD_CHANGE_REQUIRED');
      }
      if (enrollmentRequired) {
        return void deny(res, 403, 'Administrators must set up two-factor authentication first.', 'MFA_ENROLLMENT_REQUIRED');
      }
    }
    req.user = toAuthUser(u, claims.sid);
    next();
  };

export function toAuthUser(u: UserRow, sessionId: string): AuthUser {
  return {
    id: u.id,
    role: u.role,
    school_id: u.school_id,
    ref_id: u.ref_id,
    name: u.full_name,
    email: u.email,
    token_version: u.token_version,
    session_id: sessionId,
    must_change_password: u.must_change_password,
    mfa_enabled: u.mfa_enabled,
    email_verified: !!u.email_verified_at,
    mfa_enrollment_required: mfaEnrollmentRequired(u.role, u.mfa_enabled),
    grants: u.grants,
  };
}

export const auth = makeAuth();
export const authAllowingIncomplete = makeAuth({ allowIncomplete: true });

/**
 * Allow the request only if the user holds `permission` for their school (or platform-wide).
 * Relationship rules (own classes, own children) are checked separately in lib/access.
 */
export function requirePermission(permission: Permission, ctx?: (req: Request) => AccessContext): RequestHandler {
  return (req, res, next) => {
    if (!req.user || !can(req.user, permission, ctx?.(req))) {
      res.status(403).json({ error: 'You do not have permission to do this', code: 'FORBIDDEN', permission });
      return;
    }
    next();
  };
}

/** For routes that only make sense inside a school (platform staff have none). */
export const requireSchoolUser: RequestHandler = (req, res, next) => {
  if (!req.user?.school_id) {
    res.status(403).json({ error: 'This is only available inside a school', code: 'FORBIDDEN' });
    return;
  }
  next();
};

/** True when the signed-in user holds `permission` (for their school by default). */
export const userCan = (req: Request, permission: Permission, ctx?: AccessContext) => !!req.user && can(req.user, permission, ctx);

/** Permissions that apply to the user's own school (or platform-wide), for the UI. */
export function effectivePermissions(user: Pick<AuthUser, 'school_id' | 'grants'>): Permission[] {
  const set = new Set<Permission>();
  for (const g of user.grants) {
    if (g.scopeType === 'platform' || (g.scopeType === 'school' && g.scopeId === user.school_id)) set.add(g.permission);
  }
  return [...set].sort();
}

/** The signed-in user as the web app sees it. */
export function toSessionUser(user: AuthUser): SessionUser {
  return {
    id: user.id,
    role: user.role,
    school_id: user.school_id,
    full_name: user.name,
    email: user.email,
    ref_id: user.ref_id,
    must_change_password: user.must_change_password,
    mfa_enabled: user.mfa_enabled,
    mfa_enrollment_required: user.mfa_enrollment_required,
    permissions: effectivePermissions(user),
  };
}

/** req.user after auth(); throws if a route forgot the middleware. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new Error('auth middleware missing on this route');
  return req.user;
}

/** The caller's school id; every school-scoped route has one. */
export function schoolId(req: Request): number {
  const sid = currentUser(req).school_id;
  if (!sid) throw new Error('school-scoped route reached without a school');
  return sid;
}
