// Row-Level Security: the database itself keeps institutions apart, even for a query that
// forgets its institution filter. Runs as the non-superuser role the API uses.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { db, runAsSystem, runAsTenant } from '../src/db/context';
import { as, fixture } from './helpers/http';

let f;
const app = new pg.Pool({ connectionString: process.env.DATABASE_URL }); // role acadex_app

beforeAll(async () => {
  f = await fixture.resetDb();
});
afterAll(async () => {
  await app.end();
});

/** Run statements in one transaction with the given app.* settings, as the API's role. */
async function inTx<T>(settings: Record<string, string>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    for (const [k, v] of Object.entries(settings)) await c.query(`SELECT set_config($1, $2, true)`, [k, v]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}
const countIn = (settings: Record<string, string>, table: string) =>
  inTx(settings, async (c) => Number((await c.query(`SELECT count(*) FROM ${table}`)).rows[0].count));

describe('row-level security', () => {
  it('the API role is not a superuser and cannot bypass RLS by role', async () => {
    const { rows } = await app.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('every table with an institution_id column has RLS enabled and forced', async () => {
    const { rows } = await fixture.pool.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM information_schema.columns col
                      WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'institution_id')`);
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it('soft-deleted rows are hidden from every query unless the request opts in', async () => {
    const A = String(f.institutions.A.id);
    await fixture.pool.query(`UPDATE students SET deleted_at = now() WHERE id = $1`, [f.students.S3.id]);
    try {
      expect(await countIn({ 'app.institution_id': A }, 'students')).toBe(2);
      expect(await countIn({ 'app.institution_id': A, 'app.include_deleted': 'on' }, 'students')).toBe(3);
      // a soft delete needs the opt-in too (the updated row must stay visible to the statement)
      const err = await inTx({ 'app.institution_id': A }, (c) =>
        c.query(`UPDATE students SET deleted_at = now() WHERE id = $1`, [f.students.S1.id]).then(() => null, (e: Error) => e)
      );
      expect(err?.message).toMatch(/row-level security/);
    } finally {
      await fixture.pool.query(`UPDATE students SET deleted_at = NULL WHERE id = $1`, [f.students.S3.id]);
    }
  });

  it('with no tenant set, tenant tables show nothing (fail closed)', async () => {
    for (const t of ['students', 'tuition_fee', 'users', 'institutions', 'grades']) expect(await countIn({}, t), t).toBe(0);
  });

  it('an institution sees only its own rows, even without a WHERE clause', async () => {
    const A = String(f.institutions.A.id);
    expect(await countIn({ 'app.institution_id': A }, 'students')).toBe(3);
    expect(await countIn({ 'app.institution_id': A }, 'tuition_fee')).toBe(2);
    expect(await countIn({ 'app.institution_id': A }, 'institutions')).toBe(1);
    expect(await countIn({ 'app.institution_id': String(f.institutions.B.id) }, 'students')).toBe(1);
  });

  it("cannot write rows into another institution", async () => {
    await expect(
      inTx({ 'app.institution_id': String(f.institutions.A.id) }, (c) =>
        c.query(`INSERT INTO sections (institution_id, code, name) VALUES ($1, 'X1', 'Sneaky')`, [f.institutions.B.id])
      )
    ).rejects.toThrow(/row-level security/);
    // and cannot move an own row into another institution
    await expect(
      inTx({ 'app.institution_id': String(f.institutions.A.id) }, (c) =>
        c.query(`UPDATE students SET institution_id=$1 WHERE id=$2`, [f.institutions.B.id, f.students.S1.id])
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("updates and deletes cannot touch another institution's rows", async () => {
    const touched = await inTx({ 'app.institution_id': String(f.institutions.A.id) }, async (c) => {
      const u = await c.query(`UPDATE students SET first_name='Hacked' WHERE id=$1`, [f.students.SB.id]);
      const d = await c.query(`DELETE FROM tuition_fee WHERE id=$1`, [f.fees.FB.id]);
      return [u.rowCount, d.rowCount];
    });
    expect(touched).toEqual([0, 0]);
  });

  it('accounts: institution members plus your own row; platform staff are invisible to institutions', async () => {
    const settings = { 'app.institution_id': String(f.institutions.A.id), 'app.user_id': String(f.users.adminA.id) };
    const emails = await inTx(settings, async (c) => (await c.query(`SELECT email FROM users`)).rows.map((r) => r.email));
    expect(emails).toContain('admin@alpha.test');
    expect(emails).not.toContain('admin@beta.test');
    expect(emails).not.toContain('super@acadex.test');
    const own = await inTx({ 'app.user_id': String(f.users.super.id) }, async (c) => (await c.query(`SELECT email FROM users`)).rows);
    expect(own).toEqual([{ email: 'super@acadex.test' }]);
  });

  it('built-in roles are visible to every institution but writable by none', async () => {
    const result = await inTx({ 'app.institution_id': String(f.institutions.A.id) }, async (c) => {
      const visible = (await c.query(`SELECT key FROM roles WHERE institution_id IS NULL`)).rows.map((r) => r.key).sort();
      const upd = await c.query(`UPDATE roles SET name='Owned' WHERE key='institution_admin'`);
      const del = await c.query(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE key='teacher')`);
      return { visible, updated: upd.rowCount, deleted: del.rowCount };
    });
    expect(result.visible).toEqual(['group_admin', 'institution_admin', 'parent', 'student', 'super_admin', 'teacher']);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("one institution's custom roles are invisible to another", async () => {
    await as(f.tokens.adminB).post('/api/institution/roles', { name: 'Clerk', permissions: ['fees.read'] });
    expect(await countIn({ 'app.institution_id': String(f.institutions.A.id) }, `roles WHERE key = 'custom_clerk'`)).toBe(0);
    expect(await countIn({ 'app.institution_id': String(f.institutions.B.id) }, `roles WHERE key = 'custom_clerk'`)).toBe(1);
  });

  it('application code: a query without any institution filter still returns only the tenant’s rows', async () => {
    const tenantRows = await runAsTenant(f.institutions.A.id, async () => (await db.query(`SELECT institution_id FROM students`)).rows);
    expect(tenantRows.length).toBe(3);
    expect(new Set(tenantRows.map((r) => r.institution_id))).toEqual(new Set([f.institutions.A.id]));
    const all = await runAsSystem(async () => (await db.query(`SELECT count(*)::int n FROM students`)).rows[0].n);
    expect(all).toBe(4);
  });

  it('a failed request rolls back everything it wrote', async () => {
    const before = Number((await fixture.pool.query(`SELECT count(*) FROM sections`)).rows[0].count);
    // duplicate class code: the insert fails, the 409 response rolls the request back
    const ok = await as(f.tokens.adminA).post('/api/institution/sections', { code: 'NEW1', name: 'New' });
    expect(ok.status).toBe(201);
    const dup = await as(f.tokens.adminA).post('/api/institution/sections', { code: 'NEW1', name: 'Again' });
    expect(dup.status).toBe(409);
    expect(Number((await fixture.pool.query(`SELECT count(*) FROM sections`)).rows[0].count)).toBe(before + 1);
  });
});
