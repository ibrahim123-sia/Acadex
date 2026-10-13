import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { changePasswordBody, loginBody } from '@acadex/shared';
import { pool } from '../db/pool';
import { badRequest } from '../lib/errors';
import { hashPassword } from '../lib/passwords';
import { authAllowingPasswordChange, currentUser, signToken } from '../middleware/auth';

const router = Router();

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function loadSchool(schoolId: number | null) {
  if (!schoolId) return null;
  const { rows } = await pool.query(
    'SELECT id, name, slug, logo_url, primary_color, plan, status, currency, timezone, locale FROM schools WHERE id=$1',
    [schoolId]
  );
  return rows[0] || null;
}

interface UserRecord {
  id: number;
  role: string;
  school_id: number | null;
  full_name: string;
  email: string;
  ref_id: number | null;
  must_change_password: boolean;
  password_hash: string;
  is_active: boolean;
  token_version: number;
}

const publicUser = (u: UserRecord) => ({
  id: u.id,
  role: u.role,
  school_id: u.school_id,
  full_name: u.full_name,
  email: u.email,
  ref_id: u.ref_id,
  must_change_password: u.must_change_password,
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'Email and password are required' });
  const { email, password } = parsed.data;
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE email=$1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.is_active) return void res.status(401).json({ error: 'Invalid email or password' });

  // suspended tenant guard
  const school = await loadSchool(user.school_id);
  if (school && school.status !== 'active') {
    return void res.status(403).json({ error: 'This school account is currently suspended.' });
  }
  await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  res.json({ token: signToken(user), user: publicUser(user), school });
});

// GET /api/auth/me
router.get('/me', authAllowingPasswordChange, async (req, res) => {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE id=$1', [currentUser(req).id]);
  const user = rows[0]!;
  res.json({ user: publicUser(user), school: await loadSchool(user.school_id) });
});

// POST /api/auth/change-password — also clears a pending one-time password.
// Revokes all existing tokens and returns a fresh one for this session.
router.post('/change-password', authAllowingPasswordChange, async (req, res) => {
  const { current_password, new_password } = changePasswordBody.parse(req.body);
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE id=$1', [currentUser(req).id]);
  const user = rows[0]!;
  if (!(await bcrypt.compare(current_password, user.password_hash))) throw badRequest('Current password is incorrect');
  if (await bcrypt.compare(new_password, user.password_hash)) throw badRequest('Choose a password you have not used here');
  const updated = (
    await pool.query<UserRecord>(
      `UPDATE users SET password_hash=$2, must_change_password=FALSE, password_changed_at=now(), token_version=token_version+1
        WHERE id=$1 RETURNING *`,
      [user.id, await hashPassword(new_password)]
    )
  ).rows[0]!;
  res.json({ token: signToken(updated), user: publicUser(updated) });
});

// POST /api/auth/logout — revokes every token issued to this user so far.
router.post('/logout', authAllowingPasswordChange, async (req, res) => {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [currentUser(req).id]);
  res.json({ ok: true });
});

export default router;
