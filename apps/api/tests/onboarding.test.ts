// Invitation-based onboarding (no shared or admin-chosen passwords), resending invitations,
// the legacy forced password change, and password rules.
import { describe, it, expect, beforeEach } from 'vitest';
import { app, as, fixture, request } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });

async function createTeacher(email = 'new.teacher@alpha.test') {
  const res = await as(f.tokens.adminA).post('/api/school/teachers', { first_name: 'New', last_name: 'Teacher', email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('invitations', () => {
  it('a new account has no password and gets an emailed, single-use invitation', async () => {
    const t = await createTeacher();
    expect(t.invite.email).toBe('new.teacher@alpha.test');
    expect(t.invite.url).toMatch(/\/accept-invite#token=[A-Za-z0-9_-]{40,}$/);
    expect(t.login).toBeUndefined(); // no one-time password any more
    const mails = await fixture.outbox('new.teacher@alpha.test');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain('Alpha School');
    expect(mails[0].text_body).toContain(t.invite.url);
    const { rows } = await fixture.pool.query('SELECT password_hash FROM users WHERE email=$1', ['new.teacher@alpha.test']);
    expect(rows[0].password_hash).toBeNull();
    // nobody can sign in to an account that hasn't been activated
    expect((await login('new.teacher@alpha.test', '')).status).toBe(400);
    expect((await login('new.teacher@alpha.test', 'anything123')).status).toBe(401);
  });

  it('the invitation can be previewed, then accepted once to set a password and sign in', async () => {
    await createTeacher();
    const token = await fixture.tokenFromEmail('new.teacher@alpha.test', 'accept-invite');
    const peek = await request(app).get(`/api/auth/invites/${token}`);
    expect(peek.status).toBe(200);
    expect(peek.body).toEqual({ email: 'new.teacher@alpha.test', full_name: 'New Teacher', school_name: 'Alpha School' });

    const accept = await request(app).post('/api/auth/invites/accept').send({ token, password: 'MyOwnPassw0rd' });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body.user.email).toBe('new.teacher@alpha.test');
    expect(String(accept.headers['set-cookie'])).toMatch(/acadex_rt=/);
    expect((await as(accept.body.access_token).get('/api/me/teacher/overview')).status).toBe(200);

    const { rows } = await fixture.pool.query('SELECT email_verified_at FROM users WHERE email=$1', ['new.teacher@alpha.test']);
    expect(rows[0].email_verified_at).not.toBeNull(); // they proved they own the mailbox

    expect((await request(app).post('/api/auth/invites/accept').send({ token, password: 'Another1234' })).status).toBe(400);
    expect((await login('new.teacher@alpha.test', 'MyOwnPassw0rd')).status).toBe(200);
  });

  it('expired invitations are refused', async () => {
    await createTeacher();
    const token = await fixture.tokenFromEmail('new.teacher@alpha.test', 'accept-invite');
    await fixture.pool.query(`UPDATE email_tokens SET expires_at = now() - interval '1 minute'`);
    expect((await request(app).get(`/api/auth/invites/${token}`)).status).toBe(404);
    expect((await request(app).post('/api/auth/invites/accept').send({ token, password: 'MyOwnPassw0rd' })).status).toBe(400);
  });

  it('resending an invitation replaces the old link', async () => {
    const t = await createTeacher();
    const first = await fixture.tokenFromEmail('new.teacher@alpha.test', 'accept-invite');
    const resend = await as(f.tokens.adminA).post(`/api/school/users/${t.user_id}/invite`);
    expect(resend.status).toBe(200);
    const second = await fixture.tokenFromEmail('new.teacher@alpha.test', 'accept-invite');
    expect(second).not.toBe(first);
    expect((await request(app).get(`/api/auth/invites/${first}`)).status).toBe(404);
    expect((await request(app).get(`/api/auth/invites/${second}`)).status).toBe(200);
  });

  it('cannot resend for an activated account, another school, or without permission', async () => {
    const a = as(f.tokens.adminA);
    expect((await a.post(`/api/school/users/${f.users.t1.id}/invite`)).status).toBe(400); // already active
    expect((await a.post(`/api/school/users/${f.users.tb.id}/invite`)).status).toBe(404); // other school
    const t = await createTeacher();
    expect((await as(f.tokens.t1).post(`/api/school/users/${t.user_id}/invite`)).status).toBe(403);
  });

  it('admitting a student and registering a school also send invitations', async () => {
    const st = await as(f.tokens.adminA).post('/api/school/students', { first_name: 'N', last_name: 'S', email: 'n.s@alpha.test' });
    expect(st.status).toBe(201);
    expect(st.body.invite.url).toMatch(/accept-invite#token=/);
    const school = await as(f.tokens.super).post('/api/platform/schools', { name: 'Gamma', slug: 'gamma', adminEmail: 'admin@gamma.test' });
    expect(school.status).toBe(201);
    expect(school.body.admin.invite.url).toMatch(/accept-invite#token=/);
    expect(await fixture.outbox('admin@gamma.test')).toHaveLength(1);
  });

  it('invitations are sent only if the account was really created', async () => {
    // duplicate email: the request fails and no email goes out
    await as(f.tokens.adminA).post('/api/school/teachers', { first_name: 'Dup', last_name: 'T', email: 't1@alpha.test' });
    expect(await fixture.outbox('t1@alpha.test')).toHaveLength(0);
  });
});

describe('legacy accounts with a pending password change', () => {
  it('must change the password before using anything else', async () => {
    await fixture.pool.query('UPDATE users SET must_change_password=true WHERE id=$1', [f.users.t1.id]);
    const res = await login('t1@alpha.test', f.PASSWORD);
    expect(res.body.user.must_change_password).toBe(true);
    const blocked = await as(res.body.access_token).get('/api/me/teacher/overview');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const change = await as(res.body.access_token).post('/api/auth/change-password', {
      current_password: f.PASSWORD,
      new_password: 'MyNewPassw0rd!',
    });
    expect(change.status).toBe(200);
    expect(change.body.user.must_change_password).toBe(false);
    expect((await as(change.body.access_token).get('/api/me/teacher/overview')).status).toBe(200);
  });
});

describe('password rules', () => {
  it('requires the current password', async () => {
    const res = await as(f.tokens.s1).post('/api/auth/change-password', { current_password: 'wrong', new_password: 'MyNewPassw0rd!' });
    expect(res.status).toBe(400);
  });

  it('rejects weak or unchanged passwords', async () => {
    const t = as(f.tokens.s1);
    for (const weak of ['short1', 'alllettersnodigits', '1234567890123', f.PASSWORD]) {
      const res = await t.post('/api/auth/change-password', { current_password: f.PASSWORD, new_password: weak });
      expect(res.status, weak).toBe(400);
    }
  });

  it('accepting an invitation enforces the same rules', async () => {
    await createTeacher();
    const token = await fixture.tokenFromEmail('new.teacher@alpha.test', 'accept-invite');
    expect((await request(app).post('/api/auth/invites/accept').send({ token, password: 'weak' })).status).toBe(400);
  });
});
