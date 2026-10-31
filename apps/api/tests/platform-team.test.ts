// The platform owner sets up groups of institutions (with a read-only group administrator) and
// its own team of platform administrators, whose access can be turned off without locking the
// platform out.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture, request, app } from './helpers/http';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;

beforeAll(async () => {
  f = await fixture.resetDb();
});

describe('platform: groups of institutions', () => {
  let groupId: number;

  it('creates a group, puts institutions in it and lists them', async () => {
    const sup = as(f.tokens.super);
    const g = await sup.post('/api/platform/groups', { name: 'Beacon Schools Network', slug: 'beacon' });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    groupId = g.body.id;
    expect((await sup.post('/api/platform/groups', { name: 'Copy', slug: 'beacon' })).status).toBe(409);

    for (const inst of [f.institutions.A, f.institutions.B]) {
      expect((await sup.patch(`/api/platform/institutions/${inst.id}`, { group_id: groupId })).status).toBe(200);
    }
    expect((await sup.patch(`/api/platform/institutions/${f.institutions.A.id}`, { group_id: 999999 })).status).toBe(400);
    const list = (await sup.get('/api/platform/groups')).body;
    const beacon = list.find((x: { id: number }) => x.id === groupId);
    expect(beacon.institutions.map((i: { id: number }) => i.id).sort()).toEqual([f.institutions.A.id, f.institutions.B.id].sort());
    expect((await sup.patch(`/api/platform/groups/${groupId}`, { name: 'Beacon Schools' })).body.name).toBe('Beacon Schools');
  });

  it('invites a group administrator who sees the whole group', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.post(`/api/platform/groups/${groupId}/admins`, { name: 'Network Director', email: 'director@beacon.test' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await fixture.outbox('director@beacon.test')).length).toBe(1);
    expect((await sup.post(`/api/platform/groups/${groupId}/admins/${r.body.id}/invite`, {})).status).toBe(200);

    // accept the invitation, sign in, and see both institutions
    const token = await fixture.tokenFromEmail('director@beacon.test', 'accept-invite');
    const accept = await request(app).post('/api/auth/invites/accept').send({ token, password: 'Director2026' });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const overview = await as(accept.body.access_token).get('/api/group/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.institutions).toHaveLength(2);
  });

  it('only deletes an empty group', async () => {
    const sup = as(f.tokens.super);
    expect((await sup.delete(`/api/platform/groups/${groupId}`)).status).toBe(400);
    const empty = await sup.post('/api/platform/groups', { name: 'Empty', slug: 'empty-group' });
    expect((await sup.delete(`/api/platform/groups/${empty.body.id}`)).status).toBe(204);
  });
});

describe('platform: the team', () => {
  it('adds a platform administrator, and turns access off and on', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.post('/api/platform/team', { name: 'Support Lead', email: 'support.lead@acadex.test' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const team = (await sup.get('/api/platform/team')).body;
    expect(team).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'support.lead@acadex.test', status: 'invited', you: false })]));
    expect(team.find((m: { you: boolean }) => m.you)).toBeTruthy();
    expect(team[0]).not.toHaveProperty('password_hash');

    expect((await sup.patch(`/api/platform/team/${r.body.id}`, { active: false })).status).toBe(200);
    expect((await q(`SELECT is_active FROM users WHERE id = $1`, [r.body.id]))[0].is_active).toBe(false);
    expect((await sup.patch(`/api/platform/team/${r.body.id}`, { active: true })).status).toBe(200);
  });

  it('never locks the platform out', async () => {
    const sup = as(f.tokens.super);
    const [me] = await q(`SELECT id FROM users WHERE email = 'super@acadex.test'`);
    expect((await sup.patch(`/api/platform/team/${me.id}`, { active: false })).status).toBe(400);
    expect((await sup.patch(`/api/platform/team/${me.id}`, { active: 'no' })).status).toBe(400);
    // an institution user is not a platform administrator
    const [teacher] = await q(`SELECT id FROM users WHERE role = 'teacher' LIMIT 1`);
    expect((await sup.patch(`/api/platform/team/${teacher.id}`, { active: false })).status).toBe(404);
  });

  it('is for the platform only', async () => {
    const admin = as(f.tokens.adminA);
    expect((await admin.get('/api/platform/team')).status).toBe(403);
    expect((await admin.post('/api/platform/team', { name: 'Me', email: 'me@a.test' })).status).toBe(403);
    expect((await admin.post('/api/platform/groups', { name: 'Mine', slug: 'mine' })).status).toBe(403);
  });
});
