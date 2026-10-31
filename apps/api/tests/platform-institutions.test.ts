// The platform owner can correct an institution after registering it: its details, plan and
// country, and its administrators — a mistyped email gets a fresh invitation at the corrected
// address, the invitation can be sent again, and another administrator can be added.
import { describe, it, expect, beforeAll } from 'vitest';
import { as, fixture } from './helpers/http';
import { isDemoAddress } from '../src/lib/mailer';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;

beforeAll(async () => {
  f = await fixture.resetDb();
});

describe('platform: correcting an institution', () => {
  it('edits the details, type and plan, and audits it', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.post('/api/platform/institutions', { name: 'Oxferd Grammer', slug: 'oxferd', type: 'college', adminEmail: 'head@oxferd.test' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.institution.type).toBe('college');
    const id = r.body.institution.id;

    const p = await sup.patch(`/api/platform/institutions/${id}`, {
      name: 'Oxford Grammar School',
      slug: 'oxford-grammar',
      type: 'school',
      contact_email: 'office@oxford.test',
      primary_color: '#0F766E',
      plan: 'pro',
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ name: 'Oxford Grammar School', slug: 'oxford-grammar', type: 'school', contact_email: 'office@oxford.test', primary_color: '#0F766E', plan: 'pro' });
    expect((await q(`SELECT action FROM audit_log WHERE institution_id = $1 ORDER BY id DESC LIMIT 1`, [id]))[0].action).toBe('update_institution');

    // an address name already taken, and bad values, are refused
    const taken = await sup.patch(`/api/platform/institutions/${id}`, { slug: f.institutions.A.slug });
    expect(taken.status).toBe(409);
    expect((await sup.patch(`/api/platform/institutions/${id}`, { primary_color: 'teal' })).status).toBe(400);
    expect((await sup.patch(`/api/platform/institutions/${id}`, { type: 'kindergarten' })).status).toBe(400);
  });

  it('finds institutions by name or status', async () => {
    const sup = as(f.tokens.super);
    const byName = await sup.get('/api/platform/institutions?q=oxford');
    expect(byName.body.map((r: { slug: string }) => r.slug)).toEqual(['oxford-grammar']);
    const suspended = await sup.get('/api/platform/institutions?status=suspended');
    expect(suspended.body).toHaveLength(0);
  });

  it('corrects a mistyped administrator email and invites the right address', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.post('/api/platform/institutions', { name: 'Typo School', slug: 'typo-school', adminName: 'Sara Malik', adminEmail: 'sara@typo-shcool.test' });
    const id = r.body.institution.id;
    const admins = await sup.get(`/api/platform/institutions/${id}/admins`);
    expect(admins.status).toBe(200);
    expect(admins.body).toEqual([expect.objectContaining({ email: 'sara@typo-shcool.test', status: 'invited', full_admin: true })]);
    expect(admins.body[0]).not.toHaveProperty('password_hash');

    const fix = await sup.patch(`/api/platform/institutions/${id}/admins/${admins.body[0].id}`, { name: 'Sara Malik', email: 'sara@typo-school.test' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(fix.body.invite.email).toBe('sara@typo-school.test');
    expect((await fixture.outbox('sara@typo-school.test')).length).toBe(1);
    // the contact email followed the administrator's address
    expect((await q(`SELECT contact_email FROM institutions WHERE id = $1`, [id]))[0].contact_email).toBe('sara@typo-school.test');
    // only one live invitation: the first link no longer works
    expect((await q(`SELECT count(*)::int n FROM email_tokens WHERE user_id = $1 AND purpose = 'invite' AND used_at IS NULL`, [admins.body[0].id]))[0].n).toBe(1);

    const again = await sup.post(`/api/platform/institutions/${id}/admins/${admins.body[0].id}/invite`, {});
    expect(again.status).toBe(200);
    expect((await fixture.outbox('sara@typo-school.test')).length).toBe(2);
  });

  it('does not change the email of an administrator who has already signed up', async () => {
    const sup = as(f.tokens.super);
    const [admin] = await q(`SELECT id, email FROM users WHERE institution_id = $1 AND role = 'institution_admin' AND password_hash IS NOT NULL LIMIT 1`, [f.institutions.A.id]);
    const r = await sup.patch(`/api/platform/institutions/${f.institutions.A.id}/admins/${admin.id}`, { name: 'Renamed Admin', email: 'someone.else@a.test' });
    expect(r.status).toBe(400);
    // the name alone may be corrected
    expect((await sup.patch(`/api/platform/institutions/${f.institutions.A.id}/admins/${admin.id}`, { name: 'Renamed Admin', email: admin.email })).status).toBe(200);
    expect((await sup.post(`/api/platform/institutions/${f.institutions.A.id}/admins/${admin.id}/invite`, {})).status).toBe(400);
    // an administrator of another institution is not reachable through this one
    expect((await sup.patch(`/api/platform/institutions/${f.institutions.B.id}/admins/${admin.id}`, { name: 'X', email: admin.email })).status).toBe(404);
  });

  it('adds another administrator with full rights', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.post(`/api/platform/institutions/${f.institutions.B.id}/admins`, { name: 'Second Admin', email: 'second.admin@b.test' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.invite.email).toBe('second.admin@b.test');
    const list = (await sup.get(`/api/platform/institutions/${f.institutions.B.id}/admins`)).body;
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'second.admin@b.test', status: 'invited', full_admin: true })]));
    // an email that already has an account is refused
    expect((await sup.post(`/api/platform/institutions/${f.institutions.B.id}/admins`, { name: 'Dup', email: 'second.admin@b.test' })).status).toBe(409);
  });

  it('is for the platform only', async () => {
    const admin = as(f.tokens.adminA);
    expect((await admin.get(`/api/platform/institutions/${f.institutions.A.id}/admins`)).status).toBe(403);
    expect((await admin.post(`/api/platform/institutions/${f.institutions.A.id}/admins`, { name: 'X', email: 'x@a.test' })).status).toBe(403);
    expect((await admin.patch(`/api/platform/institutions/${f.institutions.A.id}`, { name: 'Mine now' })).status).toBe(403);
  });
});

describe('development mail redirect', () => {
  it('only catches the made-up demo addresses', () => {
    expect(isDemoAddress('admin@greenwood.edu')).toBe(true);
    expect(isDemoAddress('superadmin@acadex.com')).toBe(true);
    expect(isDemoAddress('hamza@example.com')).toBe(true);
    expect(isDemoAddress('x@family.example')).toBe(true);
    expect(isDemoAddress('head@gulf.test')).toBe(true);
    expect(isDemoAddress('someone@gmail.com')).toBe(false);
    expect(isDemoAddress('principal@greenwood.edu.pk')).toBe(false);
  });
});
