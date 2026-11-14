// The two first-run tasks behind `npm run db:empty` and `npm run admin:create` (see admin.ts).
import { db, runAsSystem, withTransaction } from './context';
import { syncRbacCatalogue, grantSystemRole } from '../rbac';
import { inviteUser } from '../auth/invites';

/** Remove every institution, user and message; the built-in roles, plans and settings stay. */
export async function emptyDatabase(): Promise<void> {
  await runAsSystem(async () => {
    // every tenant table references institutions or users; CASCADE empties them all
    await db.query('TRUNCATE institutions, institution_groups, users, email_outbox CASCADE');
    await syncRbacCatalogue(db); // the built-in roles went with the cascade
  });
}

/** The first platform administrator: no password yet, a one-time link to set it. */
export async function createPlatformAdmin(email: string, name: string) {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Give a valid --email');
  if (!name.trim()) throw new Error('Give a --name');
  const id = await runAsSystem(async () => {
    const taken = await db.query(`SELECT 1 FROM users WHERE email = $1`, [address]);
    if (taken.rowCount) throw new Error('That email already has an account');
    return withTransaction(async (client) => {
      const u = (
        await client.query<{ id: number }>(
          `INSERT INTO users (institution_id, role, email, password_hash, full_name) VALUES (NULL, 'super_admin', $1, NULL, $2) RETURNING id`,
          [address, name.trim()]
        )
      ).rows[0]!;
      await grantSystemRole(client, u.id, 'super_admin', null, null);
      return u.id;
    });
  });
  const invite = await runAsSystem(() => inviteUser(id, { id: null, name: 'Acadex setup' }));
  return { id, email: address, invite };
}
