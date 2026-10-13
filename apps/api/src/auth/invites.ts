// Invitation-based onboarding: accounts are created without a password; the person sets one
// through a single-use emailed link (also shown to the admin, for schools that hand out links
// on paper or by WhatsApp).
import { asSystem, db } from '../db/context';
import { createEmailToken } from './email-tokens';
import { inviteUrl, sendInviteEmail } from './emails';

export interface InviteInfo {
  email: string;
  url: string;
  expires_at: string;
}

/** Issue (or re-issue) an invitation for an account and email it. */
export async function inviteUser(userId: number, invitedBy: { id: number | null; name: string }): Promise<InviteInfo> {
  const { rows } = await asSystem(() =>
    db.query<{ email: string; full_name: string; school_id: number | null; school_name: string | null }>(
      `SELECT u.email, u.full_name, u.school_id, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = $1`,
      [userId]
    )
  );
  const u = rows[0];
  if (!u) throw new Error(`inviteUser: unknown user ${userId}`);
  const { token, expiresAt } = await createEmailToken(userId, 'invite', invitedBy.id);
  await sendInviteEmail({
    to: u.email,
    name: u.full_name,
    schoolName: u.school_name ?? 'Acadex',
    inviter: invitedBy.name,
    token,
    userId,
    schoolId: u.school_id,
  });
  return { email: u.email, url: inviteUrl(token), expires_at: expiresAt.toISOString() };
}
