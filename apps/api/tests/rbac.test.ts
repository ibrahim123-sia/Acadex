// RBAC: permissions come from role assignments with scopes; institutions can define custom
// roles; role changes apply immediately; no escalation across institutions or to platform roles.
import { describe, it, expect, beforeEach } from 'vitest';
import { can, loadGrants } from '../src/rbac';
import { as, fixture } from './helpers/http';

let f;
beforeEach(async () => {
  f = await fixture.resetDb();
});

const roleIdByKey = async (key: string) =>
  (await fixture.pool.query(`SELECT id FROM roles WHERE key=$1 AND institution_id IS NULL`, [key])).rows[0].id as number;

describe('can()', () => {
  const user = (grants) => ({ institution_id: 1, grants });

  it('institution-scoped grants apply only to their institution', () => {
    const u = user([{ permission: 'fees.read', scopeType: 'institution', scopeId: 1 }]);
    expect(can(u, 'fees.read')).toBe(true);
    expect(can(u, 'fees.read', { institutionId: 2 })).toBe(false);
    expect(can(u, 'fees.manage')).toBe(false);
  });

  it('platform-scoped grants apply everywhere', () => {
    const u = user([{ permission: 'platform.institutions.read', scopeType: 'platform', scopeId: null }]);
    expect(can(u, 'platform.institutions.read', { institutionId: 99 })).toBe(true);
  });

  it('every fixture account holds the permissions of its built-in role', async () => {
    const perms = async (key) => (await loadGrants(f.users[key].id, fixture.pool)).map((g) => g.permission).sort();
    expect(await perms('adminA')).toContain('roles.manage');
    expect(await perms('t1')).toEqual(['announcements.view', 'assignments.manage', 'attendance.mark', 'grades.enter', 'structure.read', 'teaching.access']);
    expect(await perms('s1')).toEqual(['announcements.view', 'learner.access', 'submissions.create']);
    expect(await perms('super')).toEqual(['platform.audit.read', 'platform.institutions.manage', 'platform.institutions.read']);
  });
});

describe('custom roles', () => {
  async function createAccountant(token = f.tokens.adminA) {
    const res = await as(token).post('/api/institution/roles', {
      name: 'Accountant',
      description: 'Fee desk',
      permissions: ['fees.read', 'fees.manage'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as number;
  }

  it('a teacher given a custom role gains exactly those permissions, immediately', async () => {
    const t1 = as(f.tokens.t1);
    expect((await t1.get('/api/institution/fees')).status).toBe(403);
    const roleId = await createAccountant();
    const grant = await as(f.tokens.adminA).post(`/api/institution/users/${f.users.t1.id}/roles`, { role_id: roleId });
    expect(grant.status).toBe(201);

    expect((await t1.get('/api/institution/fees')).status).toBe(200);
    expect((await t1.post('/api/institution/fees', { student_id: f.students.S1.id, total_fee: 100 })).status).toBe(201);
    expect((await t1.get('/api/institution/students')).status).toBe(403); // not part of the role
    expect((await t1.get('/api/me/teacher/sections')).status).toBe(200); // still a teacher

    const revoke = await as(f.tokens.adminA).delete(`/api/institution/users/${f.users.t1.id}/roles/${roleId}`);
    expect(revoke.status).toBe(200);
    expect((await t1.get('/api/institution/fees')).status).toBe(403);
  });

  it('editing a role changes what its holders can do', async () => {
    const roleId = await createAccountant();
    await as(f.tokens.adminA).post(`/api/institution/users/${f.users.t1.id}/roles`, { role_id: roleId });
    const patch = await as(f.tokens.adminA).patch(`/api/institution/roles/${roleId}`, { permissions: ['students.read'] });
    expect(patch.status).toBe(200);
    expect((await as(f.tokens.t1).get('/api/institution/fees')).status).toBe(403);
    expect((await as(f.tokens.t1).get('/api/institution/students')).status).toBe(200);
  });

  it('lists built-in and own roles with permissions and member counts', async () => {
    await createAccountant();
    const res = await as(f.tokens.adminA).get('/api/institution/roles');
    expect(res.status).toBe(200);
    const keys = res.body.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['institution_admin', 'teacher', 'student', 'parent', 'custom_accountant']));
    expect(keys).not.toContain('super_admin');
    expect(res.body.find((r) => r.key === 'teacher').members).toBe(2);
  });

  it('cannot include platform permissions or unknown ones', async () => {
    const a = as(f.tokens.adminA);
    expect((await a.post('/api/institution/roles', { name: 'Sneaky', permissions: ['platform.institutions.manage'] })).status).toBe(400);
    expect((await a.post('/api/institution/roles', { name: 'Typo', permissions: ['fees.reed'] })).status).toBe(400);
    expect((await a.post('/api/institution/roles', { name: 'Empty', permissions: [] })).status).toBe(400);
  });

  it('duplicate role names are rejected', async () => {
    await createAccountant();
    const res = await as(f.tokens.adminA).post('/api/institution/roles', { name: 'Accountant', permissions: ['fees.read'] });
    expect(res.status).toBe(409);
  });

  it('built-in roles cannot be edited or deleted', async () => {
    const teacherRole = await roleIdByKey('teacher');
    expect((await as(f.tokens.adminA).patch(`/api/institution/roles/${teacherRole}`, { name: 'X' })).status).toBe(400);
    expect((await as(f.tokens.adminA).delete(`/api/institution/roles/${teacherRole}`)).status).toBe(400);
  });
});

describe('role management is contained', () => {
  it('only holders of roles.manage can manage roles', async () => {
    for (const who of ['t1', 's1', 'p1', 'super']) {
      expect((await as(f.tokens[who]).get('/api/institution/roles')).status, who).toBe(403);
      expect((await as(f.tokens[who]).post('/api/institution/roles', { name: 'X', permissions: ['fees.read'] })).status, who).toBe(403);
    }
  });

  it('cannot grant the platform administrator role', async () => {
    const superRole = await roleIdByKey('super_admin');
    const res = await as(f.tokens.adminA).post(`/api/institution/users/${f.users.t1.id}/roles`, { role_id: superRole });
    expect(res.status).toBe(404);
  });

  it("cannot assign roles to another institution's users or use another institution's custom role", async () => {
    const res = await as(f.tokens.adminB).post('/api/institution/roles', { name: 'Clerk', permissions: ['fees.read'] });
    const clerkB = res.body.id;
    expect((await as(f.tokens.adminA).post(`/api/institution/users/${f.users.t1.id}/roles`, { role_id: clerkB })).status).toBe(404);
    expect((await as(f.tokens.adminA).patch(`/api/institution/roles/${clerkB}`, { name: 'Mine now' })).status).toBe(404);
    const teacherRole = await roleIdByKey('teacher');
    expect((await as(f.tokens.adminA).post(`/api/institution/users/${f.users.tb.id}/roles`, { role_id: teacherRole })).status).toBe(404);
  });

  it('an institution always keeps at least one administrator', async () => {
    const adminRole = await roleIdByKey('institution_admin');
    const res = await as(f.tokens.adminA).delete(`/api/institution/users/${f.users.adminA.id}/roles/${adminRole}`);
    expect(res.status).toBe(400);
  });

  it('role changes are audited', async () => {
    await as(f.tokens.adminA).post('/api/institution/roles', { name: 'Librarian', permissions: ['students.read'] });
    const { rows } = await fixture.pool.query(`SELECT action, detail FROM audit_log WHERE action='create_role'`);
    expect(rows[0].detail).toContain('Librarian');
  });
});
