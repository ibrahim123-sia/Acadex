import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Permission, Role } from '@acadex/shared';
import { pool } from '../db/pool';
import { can, type AccessContext, type Grant } from '../rbac';

export interface AuthUser {
  id: number;
  role: Role;
  school_id: number | null;
  ref_id: number | null;
  name: string;
  email: string;
  token_version: number;
  must_change_password: boolean;
  /** Effective permission grants from all of the user's role assignments. */
  grants: Grant[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

interface TokenUser {
  id: number;
  token_version?: number | null;
  role: string;
  school_id: number | null;
}

const expiresIn = () => process.env.JWT_EXPIRES_IN || '12h';

// The token only identifies the user and the session version; role, school and status are
// re-read from the database on every request (see makeAuth()).
export function signToken(user: TokenUser): string {
  return jwt.sign(
    { id: user.id, tv: user.token_version ?? 0, role: user.role, school_id: user.school_id },
    process.env.JWT_SECRET!,
    { expiresIn: expiresIn() as jwt.SignOptions['expiresIn'], algorithm: 'HS256' }
  );
}

const unauthorized = (res: Response, error = 'Invalid or expired session') => res.status(401).json({ error });

interface UserRow {
  id: number;
  role: Role;
  school_id: number | null;
  ref_id: number | null;
  full_name: string;
  email: string;
  is_active: boolean;
  token_version: number;
  must_change_password: boolean;
  school_status: string | null;
  grants: Grant[];
}

// allowPendingPasswordChange: only for /auth/me, /auth/change-password and /auth/logout,
// which an account with a one-time password must still be able to reach.
const makeAuth = ({ allowPendingPasswordChange = false } = {}): RequestHandler =>
  async function auth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return void unauthorized(res, 'No token provided');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      return void unauthorized(res);
    }
    if (!Number.isInteger(payload.id) || !Number.isInteger(payload.tv)) return void unauthorized(res);

    const { rows } = await pool.query<UserRow>(
      `SELECT u.id, u.role, u.school_id, u.ref_id, u.full_name, u.email, u.is_active, u.token_version,
              u.must_change_password, s.status AS school_status,
              COALESCE((SELECT json_agg(DISTINCT jsonb_build_object('permission', rp.permission,
                                 'scopeType', ur.scope_type, 'scopeId', ur.scope_id))
                          FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                         WHERE ur.user_id = u.id), '[]') AS grants
         FROM users u LEFT JOIN schools s ON s.id = u.school_id
        WHERE u.id = $1`,
      [payload.id]
    );
    const u = rows[0];
    // token_version is bumped on logout / password change, which revokes older tokens
    if (!u || !u.is_active || u.token_version !== payload.tv) return void unauthorized(res);
    if (u.school_id && u.school_status !== 'active') {
      return void res.status(403).json({ error: 'This school account is currently suspended.' });
    }
    if (u.must_change_password && !allowPendingPasswordChange) {
      return void res.status(403).json({ error: 'Please set a new password first.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    req.user = {
      id: u.id,
      role: u.role,
      school_id: u.school_id,
      ref_id: u.ref_id,
      name: u.full_name,
      email: u.email,
      token_version: u.token_version,
      must_change_password: u.must_change_password,
      grants: u.grants,
    };
    next();
  };

export const auth = makeAuth();
export const authAllowingPasswordChange = makeAuth({ allowPendingPasswordChange: true });


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
