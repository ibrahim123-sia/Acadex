// Bug #9 (+ G): tokens must stop working when a user is deactivated, a school is
// suspended, or the user logs out; login is rate-limited; CORS is an allow-list.
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { app, as, fixture, request } from './helpers/http';

import { loadConfig } from '../src/config';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});
const q = (sql: string, p?: unknown[]) => fixture.pool.query(sql, p);

describe('token validity is re-checked on every request', () => {
  it('a suspended school locks out its users immediately', async () => {
    expect((await as(f.tokens.adminA).get('/api/school/students')).status).toBe(200);
    const patch = await as(f.tokens.super).patch(`/api/platform/schools/${f.schools.A.id}`, { status: 'suspended' });
    expect(patch.status).toBe(200);
    const res = await as(f.tokens.adminA).get('/api/school/students');
    expect(res.status).toBe(403);
    expect((await as(f.tokens.s1).get('/api/me/student/overview')).status).toBe(403);
    // the other school is unaffected
    expect((await as(f.tokens.adminB).get('/api/school/students')).status).toBe(200);
  });

  it('a deactivated user is rejected', async () => {
    await q('UPDATE users SET is_active=false WHERE id=$1', [f.users.t1.id]);
    expect((await as(f.tokens.t1).get('/api/me/teacher/overview')).status).toBe(401);
  });

  it('a deleted user is rejected', async () => {
    await q('DELETE FROM users WHERE id=$1', [f.users.s2.id]);
    expect((await as(f.tokens.s2).get('/api/me/notifications')).status).toBe(401);
  });

  it('permissions come from the database, not the token', async () => {
    expect((await as(f.tokens.t1).get('/api/me/teacher/overview')).status).toBe(200);
    await q(`DELETE FROM user_roles WHERE user_id=$1`, [f.users.t1.id]);
    expect((await as(f.tokens.t1).get('/api/me/teacher/overview')).status).toBe(403);
  });

  it('logout revokes the token', async () => {
    const t = as(f.tokens.s1);
    expect((await t.get('/api/me/notifications')).status).toBe(200);
    expect((await t.post('/api/auth/logout')).status).toBe(200);
    expect((await t.get('/api/me/notifications')).status).toBe(401);
  });

  it('a token signed with another secret is rejected', async () => {
    const forged = jwt.sign({ id: f.users.adminA.id, role: 'school_admin', school_id: f.schools.A.id, tv: 0 }, 'wrong-secret-wrong-secret-wrong-secret');
    expect((await as(forged).get('/api/school/students')).status).toBe(401);
  });

  it('a token claiming another school than the account belongs to is rejected', async () => {
    const forged = jwt.sign({ id: f.users.adminA.id, tv: 0, role: 'school_admin', school_id: f.schools.B.id }, process.env.JWT_SECRET!);
    expect((await as(forged).get('/api/school/students')).status).toBe(401);
    // and an account moved to another school can't keep using its old token
    await q(`UPDATE users SET school_id=$1 WHERE id=$2`, [f.schools.B.id, f.users.t2.id]);
    expect((await as(f.tokens.t2).get('/api/me/notifications')).status).toBe(401);
  });

  it('an old-format token without a version is rejected', async () => {
    const old = jwt.sign({ id: f.users.adminA.id, role: 'school_admin', school_id: f.schools.A.id }, process.env.JWT_SECRET!);
    expect((await as(old).get('/api/school/students')).status).toBe(401);
  });

  it('a raw token without the Bearer prefix is rejected', async () => {
    const res = await request(app).get('/api/school/students').set('Authorization', f.tokens.adminA);
    expect(res.status).toBe(401);
  });

  it('login issues a token that expires within 12 hours', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@alpha.test', password: f.PASSWORD });
    expect(res.status).toBe(200);
    const { iat, exp } = jwt.decode(res.body.token) as jwt.JwtPayload;
    expect(exp! - iat!).toBeLessThanOrEqual(12 * 3600);
  });

  it('login is refused for a suspended school', async () => {
    await q(`UPDATE schools SET status='suspended' WHERE id=$1`, [f.schools.A.id]);
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@alpha.test', password: f.PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('login rate limiting', () => {
  it('blocks after 10 failed attempts for the same email, even with the right password', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/api/auth/login').send({ email: 's3@alpha.test', password: 'wrong' });
      expect(r.status).toBe(401);
    }
    const res = await request(app).post('/api/auth/login').send({ email: 's3@alpha.test', password: f.PASSWORD });
    expect(res.status).toBe(429);
  });
});

describe('HTTP hardening', () => {
  it('allows the configured frontend origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not allow other origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('startup configuration', () => {
  it('refuses a missing or short JWT secret', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/JWT_SECRET/);
  });

  it('refuses a missing DATABASE_URL', () => {
    expect(() => loadConfig({ JWT_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/);
  });

  it('accepts a valid configuration', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(40), CORS_ORIGINS: 'https://a.test, https://b.test' });
    expect(c.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
  });
});
