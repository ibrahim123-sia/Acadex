// Two-factor authentication (TOTP + recovery codes) when it is optional.
import { describe, it, expect, beforeEach } from 'vitest';
import { app, as, fixture, request } from './helpers/http';
import { currentStep, totpAt, base32Encode, base32Decode, verifyTotp } from '../src/auth/totp';
import { decryptSecret, encryptSecret } from '../src/auth/crypto';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });

async function enable(token: string) {
  const setup = await as(token).post('/api/auth/mfa/totp/setup');
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const secret = setup.body.secret as string;
  const res = await as(token).post('/api/auth/mfa/totp/enable', { code: totpAt(secret, currentStep()) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { secret, recovery: res.body.recovery_codes as string[], access: res.body.access_token as string };
}

describe('TOTP primitives', () => {
  it('match the RFC 6238 reference vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpAt(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(totpAt(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('accept one step of clock drift and refuse replays', () => {
    const secret = base32Encode(Buffer.from('abcdefghijabcdefghij'));
    const now = Date.now();
    const prev = totpAt(secret, currentStep(now) - 1);
    const step = verifyTotp(secret, prev, { now });
    expect(step).toBe(currentStep(now) - 1);
    expect(verifyTotp(secret, prev, { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, currentStep(now) - 3), { now })).toBeNull();
  });

  it('secrets are encrypted at rest and tampering is detected', () => {
    const sealed = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const raw = Buffer.from(sealed, 'base64');
    raw[raw.length - 1]! ^= 1;
    expect(() => decryptSecret(raw.toString('base64'))).toThrow();
  });
});

describe('two-factor authentication', () => {
  it('enrolment needs a valid code, returns 10 recovery codes and stores the secret encrypted', async () => {
    const setup = await as(f.tokens.t1).post('/api/auth/mfa/totp/setup');
    expect(setup.body.otpauth_url).toMatch(/^otpauth:\/\/totp\/Acadex%3At1%40alpha.test\?secret=/);
    expect((await as(f.tokens.t1).post('/api/auth/mfa/totp/enable', { code: '000000' })).status).toBe(400);
    const res = await as(f.tokens.t1).post('/api/auth/mfa/totp/enable', { code: totpAt(setup.body.secret, currentStep()) });
    expect(res.status).toBe(200);
    expect(res.body.recovery_codes).toHaveLength(10);
    const { rows } = await fixture.pool.query(`SELECT secret_enc FROM mfa_factors WHERE user_id=$1`, [f.users.t1.id]);
    expect(rows[0].secret_enc).not.toContain(setup.body.secret);
  });

  it('after enrolment, a password alone is not enough to sign in', async () => {
    const { secret } = await enable(f.tokens.t1);
    const step1 = await login('t1@alpha.test', f.PASSWORD);
    expect(step1.status).toBe(200);
    expect(step1.body.mfa_required).toBe(true);
    expect(step1.body.access_token).toBeUndefined();
    expect(step1.headers['set-cookie']).toBeUndefined();

    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: step1.body.mfa_token, code: '123456' })).status).toBe(400);
    // the enrolment code was step N; the next login uses step N+1 (codes can't be replayed)
    const code = totpAt(secret, currentStep() + 1);
    const step2 = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: step1.body.mfa_token, code });
    expect(step2.status, JSON.stringify(step2.body)).toBe(200);
    expect((await as(step2.body.access_token).get('/api/me/teacher/overview')).status).toBe(200);
    // the same code can't be used twice
    const again = await login('t1@alpha.test', f.PASSWORD);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: again.body.mfa_token, code })).status).toBe(400);
  });

  it('a recovery code works exactly once', async () => {
    const { recovery } = await enable(f.tokens.t1);
    const a = await login('t1@alpha.test', f.PASSWORD);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: a.body.mfa_token, code: recovery[0] })).status).toBe(200);
    const b = await login('t1@alpha.test', f.PASSWORD);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: b.body.mfa_token, code: recovery[0] })).status).toBe(400);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: b.body.mfa_token, code: recovery[1] })).status).toBe(200);
  });

  it('turning 2FA on signs out every other session', async () => {
    const other = await login('t1@alpha.test', f.PASSWORD);
    const { access } = await enable(f.tokens.t1);
    expect((await as(other.body.access_token).get('/api/me/teacher/overview')).status).toBe(401);
    expect((await as(access).get('/api/me/teacher/overview')).status).toBe(200);
  });

  it('the challenge token is short-lived and bound to the password version', async () => {
    await enable(f.tokens.t1);
    const a = await login('t1@alpha.test', f.PASSWORD);
    await fixture.pool.query('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [f.users.t1.id]);
    const res = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: a.body.mfa_token, code: '123456' });
    expect(res.status).toBe(401);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: 'garbage.garbage.garbage', code: '123456' })).status).toBe(401);
  });

  it('turning it off needs both the password and a code', async () => {
    const { secret, access } = await enable(f.tokens.t1);
    const t = as(access);
    expect((await t.post('/api/auth/mfa/disable', { password: 'wrong', code: totpAt(secret, currentStep() + 1) })).status).toBe(400);
    expect((await t.post('/api/auth/mfa/disable', { password: f.PASSWORD, code: '000000' })).status).toBe(400);
    expect((await t.post('/api/auth/mfa/disable', { password: f.PASSWORD, code: totpAt(secret, currentStep() + 1) })).status).toBe(200);
    expect((await login('t1@alpha.test', f.PASSWORD)).body.access_token).toBeTruthy();
  });

  it('recovery codes can be regenerated (the old ones stop working)', async () => {
    const { secret, recovery, access } = await enable(f.tokens.t1);
    const res = await as(access).post('/api/auth/mfa/recovery-codes', { code: totpAt(secret, currentStep() + 1) });
    expect(res.status).toBe(200);
    const a = await login('t1@alpha.test', f.PASSWORD);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: a.body.mfa_token, code: recovery[0] })).status).toBe(400);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: a.body.mfa_token, code: res.body.recovery_codes[0] })).status).toBe(200);
  });

  it('second-factor attempts are rate limited', async () => {
    await enable(f.tokens.t2);
    const a = await login('t2@alpha.test', f.PASSWORD);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await request(app).post('/api/auth/mfa/verify').send({ mfa_token: a.body.mfa_token, code: '000000' })).status;
    }
    expect(last).toBe(429);
  });
});
