// Single-use email tokens (invites, password resets, email verification), stored hashed.
import { asSystem, db } from '../db/context';
import { randomToken, sha256 } from './crypto';

export type EmailTokenPurpose = 'invite' | 'password_reset' | 'verify_email';

export const TOKEN_TTL_HOURS: Record<EmailTokenPurpose, number> = {
  invite: 24 * 7,
  password_reset: 1,
  verify_email: 24,
};

/** Create a token (older unused tokens of the same purpose stop working). */
export async function createEmailToken(
  userId: number,
  purpose: EmailTokenPurpose,
  createdBy: number | null = null
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS[purpose] * 3600 * 1000);
  await asSystem(async () => {
    await db.query(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
    await db.query(
      `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [userId, purpose, sha256(token), expiresAt, createdBy]
    );
  });
  return { token, expiresAt };
}

/** The user a still-valid token belongs to, without using it up. */
export async function peekEmailToken(token: string, purpose: EmailTokenPurpose): Promise<number | null> {
  const { rows } = await asSystem(() =>
    db.query<{ user_id: number }>(
      `SELECT user_id FROM email_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`,
      [sha256(token), purpose]
    )
  );
  return rows[0]?.user_id ?? null;
}

/** Use a token up; returns its user, or null if unknown, expired or already used. */
export async function consumeEmailToken(token: string, purpose: EmailTokenPurpose): Promise<number | null> {
  const { rows } = await asSystem(() =>
    db.query<{ user_id: number }>(
      `UPDATE email_tokens SET used_at = now()
        WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token), purpose]
    )
  );
  return rows[0]?.user_id ?? null;
}
