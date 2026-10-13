const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const expiresIn = () => process.env.JWT_EXPIRES_IN || '12h';

// The token only identifies the user and the session version; role, school and status are
// re-read from the database on every request (see makeAuth()).
function signToken(user) {
  return jwt.sign(
    { id: user.id, tv: user.token_version ?? 0, role: user.role, school_id: user.school_id },
    process.env.JWT_SECRET,
    { expiresIn: expiresIn(), algorithm: 'HS256' }
  );
}

const unauthorized = (res, error = 'Invalid or expired session') => res.status(401).json({ error });

// allowPendingPasswordChange: only for /auth/me, /auth/change-password and /auth/logout,
// which an account with a one-time password must still be able to reach.
const makeAuth = ({ allowPendingPasswordChange = false } = {}) =>
  async function auth(req, res, next) {
    try {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) return unauthorized(res, 'No token provided');
      let payload;
      try {
        payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
      } catch {
        return unauthorized(res);
      }
      if (!Number.isInteger(payload.id) || !Number.isInteger(payload.tv)) return unauthorized(res);

      const { rows } = await pool.query(
        `SELECT u.id, u.role, u.school_id, u.ref_id, u.full_name, u.email, u.is_active, u.token_version,
                u.must_change_password, s.status AS school_status
           FROM users u LEFT JOIN schools s ON s.id = u.school_id
          WHERE u.id = $1`,
        [payload.id]
      );
      const u = rows[0];
      // token_version is bumped on logout / password change, which revokes older tokens
      if (!u || !u.is_active || u.token_version !== payload.tv) return unauthorized(res);
      if (u.school_id && u.school_status !== 'active') {
        return res.status(403).json({ error: 'This school account is currently suspended.' });
      }
      if (u.must_change_password && !allowPendingPasswordChange) {
        return res.status(403).json({ error: 'Please set a new password first.', code: 'PASSWORD_CHANGE_REQUIRED' });
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
      };
      next();
    } catch (err) {
      next(err);
    }
  };

const auth = makeAuth();
const authAllowingPasswordChange = makeAuth({ allowPendingPasswordChange: true });

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden — insufficient role' });
    }
    next();
  };
}

module.exports = { signToken, auth, authAllowingPasswordChange, requireRole };
