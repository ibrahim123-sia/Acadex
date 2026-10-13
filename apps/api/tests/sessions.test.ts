// Sessions: refresh-token rotation with reuse detection, logout, device list, logout
// everywhere, password change and reset revoking other sessions, email verification.
import { describe, it, expect, beforeEach } from 'vitest';
import { app, as, fixture, request } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const cookieFrom = (res) => {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('acadex_rt='));
  return raw ? raw.split(';')[0]! : null;
};

async function signIn(email = 'admin@alpha.test', password = f.PASSWORD, ua = 'TestBrowser/1.0') {
  const res = await request(app).post('/api/auth/login').set('User-Agent', ua).send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { access: res.body.access_token as string, cookie: cookieFrom(res)! };
}
const refresh = (cookie: string | null, header = true) => {
  const r = request(app).post('/api/auth/refresh');
  if (header) r.set('X-Acadex-Client', 'web');
  if (cookie) r.set('Cookie', cookie);
  return r;
};

describe('refresh tokens', () => {
  it('exchange a refresh cookie for a new access token and a new cookie', async () => {
    const s = await signIn();
    const res = await refresh(s.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.user.email).toBe('admin@alpha.test');
    const next = cookieFrom(res);
    expect(next).toBeTruthy();
    expect(next).not.toBe(s.cookie);
    expect((await as(res.body.access_token).get('/api/school/students')).status).toBe(200);
  });

  it('reusing a spent refresh token revokes the whole session (theft detection)', async () => {
    const s = await signIn();
    const first = await refresh(s.cookie);
    const stolenReplay = await refresh(s.cookie);
    expect(stolenReplay.status).toBe(401);
    // the legitimate holder's newer token and access token stop working too
    expect((await refresh(cookieFrom(first))).status).toBe(401);
    expect((await as(first.body.access_token).get('/api/school/students')).status).toBe(401);
  });

  it('require the client header (no cross-site form posts)', async () => {
    const s = await signIn();
    const res = await refresh(s.cookie, false);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
  });

  it('fail without a cookie, with a junk cookie, or after expiry', async () => {
    expect((await refresh(null)).status).toBe(401);
    expect((await refresh('acadex_rt=junk')).status).toBe(401);
    const s = await signIn();
    await fixture.pool.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 second'`);
    expect((await refresh(s.cookie)).status).toBe(401);
  });

  it('stop working when the school is suspended or the user deactivated', async () => {
    const s = await signIn();
    await fixture.pool.query(`UPDATE schools SET status='suspended' WHERE id=$1`, [f.schools.A.id]);
    expect((await refresh(s.cookie)).status).toBe(403);
    await fixture.pool.query(`UPDATE schools SET status='active' WHERE id=$1`, [f.schools.A.id]);
    const s2 = await signIn();
    await fixture.pool.query(`UPDATE users SET is_active=false WHERE id=$1`, [f.users.adminA.id]);
    expect((await refresh(s2.cookie)).status).toBe(401);
  });

  it('are stored hashed, never in plain text', async () => {
    const s = await signIn();
    const raw = s.cookie.split('=')[1]!;
    const { rows } = await fixture.pool.query(`SELECT token_hash FROM refresh_tokens`);
    expect(rows.some((r) => r.token_hash === raw)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });
});

describe('logout and devices', () => {
  it('logout ends this session: its access token and refresh cookie stop working', async () => {
    const s = await signIn();
    const out = await request(app).post('/api/auth/logout').set('X-Acadex-Client', 'web').set('Authorization', `Bearer ${s.access}`).set('Cookie', s.cookie);
    expect(out.status).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/acadex_rt=;/);
    expect((await as(s.access).get('/api/school/students')).status).toBe(401);
    expect((await refresh(s.cookie)).status).toBe(401);
  });

  it('lists signed-in devices and signs out another one', async () => {
    const laptop = await signIn('admin@alpha.test', f.PASSWORD, 'Laptop');
    const phone = await signIn('admin@alpha.test', f.PASSWORD, 'Phone');
    const list = await as(laptop.access).get('/api/auth/sessions');
    expect(list.status).toBe(200);
    const mine = list.body.filter((x) => ['Laptop', 'Phone'].includes(x.user_agent));
    expect(mine).toHaveLength(2);
    expect(mine.find((x) => x.user_agent === 'Laptop').current).toBe(true);

    const phoneId = mine.find((x) => x.user_agent === 'Phone').id;
    expect((await as(laptop.access).delete(`/api/auth/sessions/${phoneId}`)).status).toBe(200);
    expect((await as(phone.access).get('/api/school/students')).status).toBe(401);
    expect((await refresh(phone.cookie)).status).toBe(401);
    expect((await as(laptop.access).get('/api/school/students')).status).toBe(200);
  });

  it("cannot sign out someone else's session", async () => {
    const other = await signIn('admin@beta.test');
    const { rows } = await fixture.pool.query(`SELECT id FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [f.users.adminB.id]);
    expect((await as(f.tokens.adminA).delete(`/api/auth/sessions/${rows[0].id}`)).status).toBe(404);
    expect((await as(other.access).get('/api/school/students')).status).toBe(200);
  });

  it('"sign out other devices" keeps only the current one', async () => {
    const a = await signIn('admin@alpha.test', f.PASSWORD, 'A');
    const b = await signIn('admin@alpha.test', f.PASSWORD, 'B');
    const res = await as(a.access).post('/api/auth/sessions/revoke-others');
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await as(b.access).get('/api/school/students')).status).toBe(401);
    expect((await as(a.access).get('/api/school/students')).status).toBe(200);
  });

  it('logout everywhere ends every session at once', async () => {
    const a = await signIn();
    const b = await signIn();
    expect((await as(a.access).post('/api/auth/logout-all')).status).toBe(200);
    expect((await as(a.access).get('/api/school/students')).status).toBe(401);
    expect((await as(b.access).get('/api/school/students')).status).toBe(401);
  });
});

describe('password change and reset', () => {
  it('changing the password signs out other devices but keeps this one, and sends a notice', async () => {
    const here = await signIn();
    const elsewhere = await signIn();
    const res = await as(here.access).post('/api/auth/change-password', { current_password: f.PASSWORD, new_password: 'BrandNewPassw0rd' });
    expect(res.status).toBe(200);
    expect((await as(res.body.access_token).get('/api/school/students')).status).toBe(200);
    expect((await as(elsewhere.access).get('/api/school/students')).status).toBe(401);
    expect((await refresh(elsewhere.cookie)).status).toBe(401);
    const mails = await fixture.outbox('admin@alpha.test');
    expect(mails.some((m) => m.template === 'security_notice')).toBe(true);
  });

  it('reset by email: same answer for unknown addresses, single-use link, all sessions ended', async () => {
    const unknown = await request(app).post('/api/auth/password-reset/request').send({ email: 'nobody@nowhere.test' });
    const known = await request(app).post('/api/auth/password-reset/request').send({ email: 't1@alpha.test' });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(await fixture.outbox('nobody@nowhere.test')).toHaveLength(0);

    const before = await signIn('t1@alpha.test');
    const token = await fixture.tokenFromEmail('t1@alpha.test', 'reset-password');
    const done = await request(app).post('/api/auth/password-reset/confirm').send({ token, password: 'ResetPassw0rd!' });
    expect(done.status).toBe(200);
    expect((await as(before.access).get('/api/me/teacher/overview')).status).toBe(401);
    expect((await refresh(before.cookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 't1@alpha.test', password: f.PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 't1@alpha.test', password: 'ResetPassw0rd!' })).status).toBe(200);
    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token, password: 'Again12345!' })).status).toBe(400);
  });

  it('reset links expire after an hour', async () => {
    await request(app).post('/api/auth/password-reset/request').send({ email: 't1@alpha.test' });
    const token = await fixture.tokenFromEmail('t1@alpha.test', 'reset-password');
    await fixture.pool.query(`UPDATE email_tokens SET expires_at = now() - interval '1 second'`);
    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token, password: 'ResetPassw0rd!' })).status).toBe(400);
  });

  it('reset requests are rate limited per address', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/password-reset/request').send({ email: 's2@alpha.test' })).status).toBe(202);
    }
    expect((await request(app).post('/api/auth/password-reset/request').send({ email: 's2@alpha.test' })).status).toBe(429);
  });
});

describe('email verification', () => {
  it('sends a confirmation link and marks the address verified', async () => {
    const req = await as(f.tokens.s1).post('/api/auth/verify-email/request');
    expect(req.status).toBe(202);
    const token = await fixture.tokenFromEmail('s1@alpha.test', 'verify-email');
    const res = await request(app).post('/api/auth/verify-email/confirm').send({ token });
    expect(res.status).toBe(200);
    expect((await as(f.tokens.s1).get('/api/auth/me')).body.email_verified).toBe(true);
    expect((await request(app).post('/api/auth/verify-email/confirm').send({ token })).status).toBe(400);
  });
});
