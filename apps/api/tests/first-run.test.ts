// A fresh installation: the database is emptied, then one platform administrator (the top role)
// is created with a one-time link to set a password, and can sign in and run the platform.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';
import { createPlatformAdmin, emptyDatabase } from '../src/db/admin-tasks';

const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;

beforeAll(async () => {
  await fixture.resetDb();
});

describe('first run', () => {
  it('empties the database but keeps the built-in roles and plans', async () => {
    await emptyDatabase();
    expect((await q(`SELECT count(*)::int n FROM institutions`))[0].n).toBe(0);
    expect((await q(`SELECT count(*)::int n FROM users`))[0].n).toBe(0);
    expect((await q(`SELECT count(*)::int n FROM roles WHERE key = 'super_admin' AND is_system`))[0].n).toBe(1);
    expect((await q(`SELECT count(*)::int n FROM plans`))[0].n).toBeGreaterThan(0);
  });

  it('creates the first platform administrator, who sets a password and runs the platform', async () => {
    const r = await createPlatformAdmin('Owner@Example.Test', 'Platform Owner');
    expect(r.email).toBe('owner@example.test');
    expect(r.invite.url).toMatch(/\/accept-invite#token=/);
    expect((await q(`SELECT role, password_hash FROM users WHERE id = $1`, [r.id]))[0]).toEqual({ role: 'super_admin', password_hash: null });

    const token = new URL(r.invite.url).hash.replace('#token=', '');
    const accept = await request(app).post('/api/auth/invites/accept').send({ token, password: 'test-owner-pass-2026' });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const sup = as(accept.body.access_token);
    expect((await sup.get('/api/platform/institutions')).body).toEqual([]);
    const made = await sup.post('/api/platform/institutions', { name: 'First School', slug: 'first-school', adminEmail: 'head@first-school.test' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await sup.get('/api/platform/team')).body).toHaveLength(1);
  });

  it('refuses a second account on the same email and bad input', async () => {
    await expect(createPlatformAdmin('owner@example.test', 'Again')).rejects.toThrow(/already has an account/);
    await expect(createPlatformAdmin('not-an-email', 'X')).rejects.toThrow(/valid --email/);
    await expect(createPlatformAdmin('x@example.test', '  ')).rejects.toThrow(/--name/);
  });
});
