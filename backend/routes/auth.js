const { Router } = require('../lib/router');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken, auth } = require('../middleware/auth');
const { z } = require('../lib/validate');

const router = Router();

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function loadSchool(school_id) {
  if (!school_id) return null;
  const { rows } = await pool.query('SELECT id, name, slug, logo_url, primary_color, plan, status FROM schools WHERE id=$1', [school_id]);
  return rows[0] || null;
}

const publicUser = (u) => ({
  id: u.id,
  role: u.role,
  school_id: u.school_id,
  full_name: u.full_name,
  email: u.email,
  ref_id: u.ref_id,
});

// POST /api/auth/login
const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});
router.post('/login', async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Email and password are required' });
  const { email, password } = parsed.data;
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.is_active) return res.status(401).json({ error: 'Invalid email or password' });

  // suspended tenant guard
  const school = await loadSchool(user.school_id);
  if (school && school.status !== 'active') {
    return res.status(403).json({ error: 'This school account is currently suspended.' });
  }
  await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  res.json({ token: signToken(user), user: publicUser(user), school });
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, role, school_id, full_name, email, ref_id FROM users WHERE id=$1', [req.user.id]);
  res.json({ user: publicUser(rows[0]), school: await loadSchool(rows[0].school_id) });
});

// POST /api/auth/logout — revokes every token issued to this user so far.
// (Per-device sessions arrive with refresh tokens in Phase 0B.)
router.post('/logout', auth, async (req, res) => {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
