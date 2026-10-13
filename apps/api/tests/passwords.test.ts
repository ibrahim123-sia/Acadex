// Bug #10 (+ F): no shared default password; one-time passwords must be changed at first login.
import { describe, it, expect, beforeEach } from 'vitest';
import { app, as, fixture, request } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

async function createTeacher(email = 'new.teacher@alpha.test') {
  const res = await as(f.tokens.adminA).post('/api/school/teachers', { first_name: 'New', last_name: 'Teacher', email });
  expect(res.status).toBe(201);
  return res.body;
}

describe('accounts created by an admin', () => {
  it('do not get the shared default password', async () => {
    await createTeacher();
    expect((await login('new.teacher@alpha.test', 'Acadex@123')).status).toBe(401);
  });

  it('get a strong, unique one-time password returned once', async () => {
    const a = await createTeacher('t.a@alpha.test');
    const b = await createTeacher('t.b@alpha.test');
    expect(a.login.email).toBe('t.a@alpha.test');
    expect(a.login.tempPassword).toMatch(/^.{14,}$/);
    expect(a.login.tempPassword).not.toBe(b.login.tempPassword);
    const st = await as(f.tokens.adminA).post('/api/school/students', { first_name: 'N', last_name: 'S', email: 'n.s@alpha.test' });
    expect(st.status).toBe(201);
    expect(st.body.login.tempPassword).toMatch(/^.{14,}$/);
  });

  it('must change the password before using anything else', async () => {
    const { login: creds } = await createTeacher();
    const res = await login(creds.email, creds.tempPassword);
    expect(res.status).toBe(200);
    expect(res.body.user.must_change_password).toBe(true);
    const t = as(res.body.token);
    const blocked = await t.get('/api/me/teacher/overview');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await t.get('/api/auth/me')).status).toBe(200);
  });

  it('changing the password unlocks the account and revokes the old token', async () => {
    const { login: creds } = await createTeacher();
    const { body } = await login(creds.email, creds.tempPassword);
    const change = await as(body.token).post('/api/auth/change-password', {
      current_password: creds.tempPassword,
      new_password: 'MyNewPassw0rd!',
    });
    expect(change.status).toBe(200);
    expect(change.body.user.must_change_password).toBe(false);
    expect((await as(change.body.token).get('/api/me/teacher/overview')).status).toBe(200);
    expect((await as(body.token).get('/api/auth/me')).status).toBe(401);
    expect((await login(creds.email, 'MyNewPassw0rd!')).status).toBe(200);
    expect((await login(creds.email, creds.tempPassword)).status).toBe(401);
  });
});

describe('change password rules', () => {
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
});

describe('platform school registration', () => {
  it('gives the first admin a random one-time password', async () => {
    const res = await as(f.tokens.super).post('/api/platform/schools', { name: 'Gamma', slug: 'gamma', adminEmail: 'admin@gamma.test' });
    expect(res.status).toBe(201);
    const pw = res.body.admin.tempPassword;
    expect(pw).not.toMatch(/^Acadex@\d{4}$/);
    expect(pw).toMatch(/^.{14,}$/);
    const l = await login('admin@gamma.test', pw);
    expect(l.status).toBe(200);
    expect(l.body.user.must_change_password).toBe(true);
  });
});
