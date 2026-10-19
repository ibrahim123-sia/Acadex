// Two-step verification with codes sent by email (the free alternative to SMS codes).
import { describe, it, expect, beforeEach } from 'vitest';
import { app, as, fixture, request } from './helpers/http';
import { currentStep, totpAt } from '../src/auth/totp';
import { verifySecondFactor } from '../src/auth/mfa';
import { runAsSystem } from '../src/db/context';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const start = (mfaToken: string) => request(app).post('/api/auth/mfa/start').send({ mfa_token: mfaToken });

/** The newest code emailed to an address. */
async function lastCode(to: string): Promise<string> {
  const mails = await fixture.outbox(to);
  const m = /code: (\d{6})/.exec(mails.at(-1)?.subject ?? '');
  if (!m) throw new Error(`no code emailed to ${to}`);
  return m[1]!;
}

/** Let the next code go out now (codes are limited to one a minute). */
const ageCodes = (userId: number) => fixture.pool.query(`UPDATE mfa_email_codes SET created_at = created_at - interval '2 minutes' WHERE user_id = $1`, [userId]);

async function enableByEmail(token: string, userId: number, email: string) {
  const setup = await as(token).post('/api/auth/mfa/email/setup');
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const res = await as(token).post('/api/auth/mfa/email/enable', { code: await lastCode(email) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await ageCodes(userId);
  return { recovery: res.body.recovery_codes as string[], access: res.body.access_token as string };
}

describe('two-step verification by email', () => {
  it('enrolment sends a code, needs it back, and returns 10 recovery codes', async () => {
    const setup = await as(f.tokens.t1).post('/api/auth/mfa/email/setup');
    expect(setup.body).toEqual({ method: 'email', email: 't•••@alpha.test', sent: true });
    const code = await lastCode('t1@alpha.test');
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await as(f.tokens.t1).post('/api/auth/mfa/email/enable', { code: wrong })).status).toBe(400);
    const res = await as(f.tokens.t1).post('/api/auth/mfa/email/enable', { code });
    expect(res.status).toBe(200);
    expect(res.body.recovery_codes).toHaveLength(10);
    // only a hash of the code is kept
    const { rows } = await fixture.pool.query(`SELECT code_hash FROM mfa_email_codes WHERE user_id = $1`, [f.users.t1.id]);
    expect(rows.every((r) => r.code_hash !== code && r.code_hash.length === 64)).toBe(true);
    const status = await as(res.body.access_token).get('/api/auth/mfa');
    expect(status.body).toMatchObject({ enabled: true, method: 'email', email_allowed: true });
  });

  it('signing in emails a code; it works once', async () => {
    await enableByEmail(f.tokens.t1, f.users.t1.id, 't1@alpha.test');
    const step1 = await login('t1@alpha.test', f.PASSWORD);
    expect(step1.body.mfa_required).toBe(true);
    const s = await start(step1.body.mfa_token);
    expect(s.body).toEqual({ method: 'email', email: 't•••@alpha.test', sent: true });
    const code = await lastCode('t1@alpha.test');
    const ok = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: step1.body.mfa_token, code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await as(ok.body.access_token).get('/api/me/teacher/overview')).status).toBe(200);
    const again = await login('t1@alpha.test', f.PASSWORD);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: again.body.mfa_token, code })).status).toBe(400);
  });

  it('a new code can be sent after a minute, five an hour; a new code replaces the old one', async () => {
    await enableByEmail(f.tokens.t1, f.users.t1.id, 't1@alpha.test');
    const a = await login('t1@alpha.test', f.PASSWORD);
    expect((await start(a.body.mfa_token)).body.sent).toBe(true);
    const first = await lastCode('t1@alpha.test');
    const soon = await start(a.body.mfa_token);
    expect(soon.body.sent).toBe(false);
    expect(soon.body.retry_after).toBeGreaterThan(0);
    await ageCodes(f.users.t1.id);
    expect((await start(a.body.mfa_token)).body.sent).toBe(true);
    const second = await lastCode('t1@alpha.test');
    const run = (code: string) => runAsSystem(() => verifySecondFactor(f.users.t1.id, code));
    if (first !== second) expect(await run(first)).toBeNull();
    expect(await run(second)).toBe('email');
    // the enrolment code and the two sign-in codes count towards five an hour
    await fixture.pool.query(`UPDATE mfa_email_codes SET created_at = now() - interval '10 minutes' WHERE user_id = $1`, [f.users.t1.id]);
    await fixture.pool.query(`INSERT INTO mfa_email_codes (user_id, purpose, code_hash, expires_at, created_at) SELECT $1, 'verify', 'x', now(), now() - interval '5 minutes' FROM generate_series(1, 2)`, [f.users.t1.id]);
    expect((await start(a.body.mfa_token)).body).toMatchObject({ sent: false, retry_after: 3600 });
  });

  it('a code stops working after 5 wrong tries, and after 10 minutes', async () => {
    await enableByEmail(f.tokens.t1, f.users.t1.id, 't1@alpha.test');
    const a = await login('t1@alpha.test', f.PASSWORD);
    await start(a.body.mfa_token);
    const code = await lastCode('t1@alpha.test');
    const wrong = code === '000000' ? '111111' : '000000';
    const run = (c: string) => runAsSystem(() => verifySecondFactor(f.users.t1.id, c));
    for (let i = 0; i < 5; i++) expect(await run(wrong)).toBeNull();
    expect(await run(code)).toBeNull();

    await ageCodes(f.users.t1.id);
    await start(a.body.mfa_token);
    const late = await lastCode('t1@alpha.test');
    await fixture.pool.query(`UPDATE mfa_email_codes SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND used_at IS NULL`, [f.users.t1.id]);
    expect(await run(late)).toBeNull();
  });

  it('recovery codes still work, and turning it off needs the password and an emailed code', async () => {
    const { recovery, access } = await enableByEmail(f.tokens.t1, f.users.t1.id, 't1@alpha.test');
    const a = await login('t1@alpha.test', f.PASSWORD);
    expect((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: a.body.mfa_token, code: recovery[0] })).status).toBe(200);
    const t = as(access);
    expect((await t.post('/api/auth/mfa/email/code')).body.sent).toBe(true);
    const code = await lastCode('t1@alpha.test');
    expect((await t.post('/api/auth/mfa/disable', { password: 'wrong', code })).status).toBe(400);
    expect((await t.post('/api/auth/mfa/disable', { password: f.PASSWORD, code })).status).toBe(200);
    expect((await login('t1@alpha.test', f.PASSWORD)).body.access_token).toBeTruthy();
    expect((await fixture.pool.query(`SELECT count(*)::int n FROM mfa_email_codes WHERE user_id = $1`, [f.users.t1.id])).rows[0].n).toBe(0);
  });

  it('authenticator-app users get no email, and platform owners must use an app', async () => {
    const setup = await as(f.tokens.t2).post('/api/auth/mfa/totp/setup');
    await as(f.tokens.t2).post('/api/auth/mfa/totp/enable', { code: totpAt(setup.body.secret, currentStep()) });
    const before = (await fixture.outbox('t2@alpha.test')).length;
    const a = await login('t2@alpha.test', f.PASSWORD);
    expect((await start(a.body.mfa_token)).body).toEqual({ method: 'totp' });
    expect((await fixture.outbox('t2@alpha.test')).length).toBe(before);
    expect((await start('garbage.garbage.garbage')).status).toBe(401);

    const superSetup = await as(f.tokens.super).post('/api/auth/mfa/email/setup');
    expect(superSetup.status).toBe(400);
    expect((await as(f.tokens.super).get('/api/auth/mfa')).body.email_allowed).toBe(false);
  });

  it('switching methods: an app enrolment replaces an unfinished email one, and 2FA once on cannot be set up again', async () => {
    await as(f.tokens.t1).post('/api/auth/mfa/email/setup');
    const setup = await as(f.tokens.t1).post('/api/auth/mfa/totp/setup');
    const res = await as(f.tokens.t1).post('/api/auth/mfa/totp/enable', { code: totpAt(setup.body.secret, currentStep()) });
    expect(res.status).toBe(200);
    const { rows } = await fixture.pool.query(`SELECT type FROM mfa_factors WHERE user_id = $1`, [f.users.t1.id]);
    expect(rows.map((r) => r.type)).toEqual(['totp']);
    expect((await as(res.body.access_token).post('/api/auth/mfa/email/setup')).status).toBe(409);
    expect((await as(res.body.access_token).post('/api/auth/mfa/email/code')).status).toBe(400);
  });
});
