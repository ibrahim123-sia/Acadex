// ADMIN_MFA=required (the production default): administrators must enrol in 2FA before
// they can use anything; other roles are unaffected.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.ADMIN_MFA = 'required';
});

const { app, as, fixture, request } = await import('./helpers/http');
const { currentStep, totpAt } = await import('../src/auth/totp');

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

describe('2FA required for administrators', () => {
  it('an admin without 2FA can sign in but only to set it up', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@alpha.test', password: f.PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.mfa_enrollment_required).toBe(true);
    const blocked = await as(res.body.access_token).get('/api/institution/students');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect((await as(res.body.access_token).get('/api/auth/me')).status).toBe(200);

    const setup = await as(res.body.access_token).post('/api/auth/mfa/totp/setup');
    const enabled = await as(res.body.access_token).post('/api/auth/mfa/totp/enable', { code: totpAt(setup.body.secret, currentStep()) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.user.mfa_enrollment_required).toBe(false);
    expect((await as(enabled.body.access_token).get('/api/institution/students')).status).toBe(200);
  });

  it('platform administrators too', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'super@acadex.test', password: f.PASSWORD });
    expect((await as(res.body.access_token).get('/api/platform/institutions')).body.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('teachers, students and parents are not forced', async () => {
    for (const email of ['t1@alpha.test', 's1@alpha.test', 'p1@alpha.test']) {
      const res = await request(app).post('/api/auth/login').send({ email, password: f.PASSWORD });
      expect(res.body.user.mfa_enrollment_required, email).toBe(false);
    }
  });

  it('an administrator cannot turn it off', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@alpha.test', password: f.PASSWORD });
    const setup = await as(res.body.access_token).post('/api/auth/mfa/totp/setup');
    const on = await as(res.body.access_token).post('/api/auth/mfa/totp/enable', { code: totpAt(setup.body.secret, currentStep()) });
    const off = await as(on.body.access_token).post('/api/auth/mfa/disable', { password: f.PASSWORD, code: totpAt(setup.body.secret, currentStep() + 1) });
    expect(off.status).toBe(400);
  });
});
