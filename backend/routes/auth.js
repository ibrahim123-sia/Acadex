const { Router } = require('../lib/router');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken, auth } = require('../middleware/auth');

const router = Router();

async function loadSchool(school_id) {
  if (!school_id) return null;
  const { rows } = await pool.query('SELECT id, name, slug, logo_url, primary_color, plan, status FROM schools WHERE id=$1', [school_id]);
  return rows[0] || null;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [String(email).toLowerCase().trim()]);
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  // suspended tenant guard
  const school = await loadSchool(user.school_id);
  if (school && school.status !== 'active') {
    return res.status(403).json({ error: 'This school account is currently suspended.' });
  }
  await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, role: user.role, school_id: user.school_id, full_name: user.full_name, email: user.email, ref_id: user.ref_id },
    school,
  });
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, role, school_id, full_name, email, ref_id FROM users WHERE id=$1', [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user, school: await loadSchool(user.school_id) });
});

module.exports = router;
