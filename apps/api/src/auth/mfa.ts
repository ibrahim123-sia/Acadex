// Two-factor authentication: an authenticator app (TOTP) or six-digit codes sent by email, plus
// single-use recovery codes. A person uses one method at a time.
import crypto from 'node:crypto';
import { asSystem, db, runAsSystem } from '../db/context';
import { decryptSecret, encryptSecret, safeEqual, sha256 } from './crypto';
import { sendMfaCodeEmail } from './emails';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_CODE_COUNT = 10;

export type MfaMethod = 'totp' | 'email';
type EmailPurpose = 'enable' | 'verify';
/** an emailed code lasts 10 minutes and allows 5 tries; a new one can be sent after a minute, 5 an hour */
const EMAIL_CODE_TTL_MIN = 10;
const EMAIL_CODE_TRIES = 5;
const EMAIL_RESEND_SECONDS = 60;
const EMAIL_CODES_PER_HOUR = 5;

function newRecoveryCode(): string {
  const part = () => Array.from({ length: 5 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}

interface FactorRow {
  id: number;
  secret_enc: string;
  confirmed_at: Date | null;
  last_used_step: number | null;
}

async function factorFor(userId: number): Promise<FactorRow | null> {
  const { rows } = await db.query<FactorRow>(
    `SELECT id, secret_enc, confirmed_at, last_used_step FROM mfa_factors WHERE user_id = $1 AND type = 'totp'`,
    [userId]
  );
  return rows[0] ?? null;
}

/** Start (or restart) enrolment: a new secret, not active until a code confirms it. */
export async function setupTotp(userId: number, accountLabel: string): Promise<{ secret: string; otpauthUrl: string }> {
  return asSystem(async () => {
    const existing = await factorFor(userId);
    if (existing?.confirmed_at) throw Object.assign(new Error('2FA is already enabled'), { status: 409 });
    const secret = generateTotpSecret();
    await db.query(
      `INSERT INTO mfa_factors (user_id, type, secret_enc) VALUES ($1, 'totp', $2)
       ON CONFLICT ON CONSTRAINT mfa_factors_user_id_type_key DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_used_step = NULL, created_at = now()`,
      [userId, encryptSecret(secret)]
    );
    return { secret, otpauthUrl: otpauthUri(secret, accountLabel) };
  });
}

async function replaceRecoveryCodes(userId: number): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await db.query(`INSERT INTO mfa_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`, [userId, codes.map(sha256)]);
  return codes;
}

/** Confirm enrolment with a code from the app. Returns the recovery codes (shown once). */
export async function enableTotp(userId: number, code: string): Promise<string[] | null> {
  return asSystem(async () => {
    const f = await factorFor(userId);
    if (!f || f.confirmed_at) return null;
    const step = verifyTotp(decryptSecret(f.secret_enc), code);
    if (step == null) return null;
    await db.query(`UPDATE mfa_factors SET confirmed_at = now(), last_used_step = $2 WHERE id = $1`, [f.id, step]);
    await db.query(`DELETE FROM mfa_factors WHERE user_id = $1 AND type = 'email'`, [userId]);
    await db.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [userId]);
    return replaceRecoveryCodes(userId);
  });
}

/** The method a person signs in with, once 2FA is on. */
export async function activeMethod(userId: number): Promise<MfaMethod | null> {
  const { rows } = await asSystem(() =>
    db.query<{ type: MfaMethod }>(`SELECT type FROM mfa_factors WHERE user_id = $1 AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC LIMIT 1`, [userId])
  );
  return rows[0]?.type ?? null;
}

/** "a•••@example.com" — enough to recognise the address without revealing it. */
export const maskEmail = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, '$1•••$2');

/**
 * Email a fresh six-digit code (only its hash is stored; earlier unused codes stop working).
 * Limited to one a minute and five an hour per person, so the inbox can't be flooded.
 */
export async function sendEmailCode(
  user: { id: number; email: string; name: string },
  purpose: EmailPurpose
): Promise<{ sent: true } | { sent: false; retry_after: number }> {
  return asSystem(async () => {
    const { rows } = await db.query<{ last: Date | null; hour: number }>(
      `SELECT max(created_at) AS last, count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hour FROM mfa_email_codes WHERE user_id = $1`,
      [user.id]
    );
    const last = rows[0]?.last ? new Date(rows[0].last).getTime() : 0;
    const wait = Math.ceil((last + EMAIL_RESEND_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) return { sent: false, retry_after: wait };
    if ((rows[0]?.hour ?? 0) >= EMAIL_CODES_PER_HOUR) return { sent: false, retry_after: 3600 };
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await db.query(`UPDATE mfa_email_codes SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [user.id, purpose]);
    await db.query(
      `INSERT INTO mfa_email_codes (user_id, purpose, code_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [user.id, purpose, sha256(`${user.id}:${code}`), EMAIL_CODE_TTL_MIN]
    );
    await sendMfaCodeEmail({ to: user.email, name: user.name, userId: user.id, code, minutes: EMAIL_CODE_TTL_MIN });
    return { sent: true };
  });
}

/** Check an emailed code: the newest unused one for that purpose, before it expires, within 5 tries. */
async function checkEmailCode(userId: number, purpose: EmailPurpose, code: string): Promise<boolean> {
  const { rows } = await db.query<{ id: number; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM mfa_email_codes WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose]
  );
  const c = rows[0];
  if (!c || c.attempts >= EMAIL_CODE_TRIES) return false;
  if (!safeEqual(c.code_hash, sha256(`${userId}:${code}`))) {
    // counted outside the request's transaction, which rolls back when the code is refused
    await runAsSystem(() => db.query(`UPDATE mfa_email_codes SET attempts = attempts + 1 WHERE id = $1`, [c.id]));
    return false;
  }
  // conditional update: two concurrent requests with the same code can't both succeed
  const { rowCount } = await db.query(`UPDATE mfa_email_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [c.id]);
  return !!rowCount;
}

/** Start using codes by email: the first code, sent now, confirms the address works. */
export async function setupEmailMfa(user: { id: number; email: string; name: string }) {
  return asSystem(async () => {
    await db.query(
      `INSERT INTO mfa_factors (user_id, type, secret_enc) VALUES ($1, 'email', '')
       ON CONFLICT ON CONSTRAINT mfa_factors_user_id_type_key DO UPDATE SET confirmed_at = NULL, created_at = now()`,
      [user.id]
    );
    return sendEmailCode(user, 'enable');
  });
}

/** Confirm codes by email with the code just sent. Returns the recovery codes (shown once). */
export async function enableEmailMfa(userId: number, code: string): Promise<string[] | null> {
  return asSystem(async () => {
    if (!(await checkEmailCode(userId, 'enable', code.trim()))) return null;
    const { rowCount } = await db.query(`UPDATE mfa_factors SET confirmed_at = now() WHERE user_id = $1 AND type = 'email' AND confirmed_at IS NULL`, [userId]);
    if (!rowCount) return null;
    // one method at a time: an unfinished authenticator enrolment is dropped
    await db.query(`DELETE FROM mfa_factors WHERE user_id = $1 AND type = 'totp'`, [userId]);
    await db.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [userId]);
    return replaceRecoveryCodes(userId);
  });
}

/** Check a TOTP code (not reusable), an emailed code (single use) or a recovery code (consumed). */
export async function verifySecondFactor(userId: number, code: string): Promise<MfaMethod | 'recovery' | null> {
  return asSystem(async () => {
    const normalized = code.trim().toLowerCase();
    if (/^\d{6}$/.test(normalized)) {
      if ((await activeMethod(userId)) === 'email') return (await checkEmailCode(userId, 'verify', normalized)) ? 'email' : null;
      const f = await factorFor(userId);
      if (!f?.confirmed_at) return null;
      const step = verifyTotp(decryptSecret(f.secret_enc), normalized, { lastUsedStep: f.last_used_step });
      if (step == null) return null;
      // conditional update: two concurrent requests with the same code can't both succeed
      const { rowCount } = await db.query(
        `UPDATE mfa_factors SET last_used_step = $2 WHERE id = $1 AND (last_used_step IS NULL OR last_used_step < $2)`,
        [f.id, step]
      );
      return rowCount ? 'totp' : null;
    }
    const { rows } = await db.query<{ id: number; code_hash: string }>(
      `SELECT id, code_hash FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );
    const hash = sha256(normalized);
    const match = rows.find((r) => safeEqual(r.code_hash, hash));
    if (!match) return null;
    const { rowCount } = await db.query(`UPDATE mfa_recovery_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [match.id]);
    return rowCount ? 'recovery' : null;
  });
}

export async function disableTotp(userId: number): Promise<void> {
  await asSystem(async () => {
    await db.query(`DELETE FROM mfa_factors WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM mfa_email_codes WHERE user_id = $1`, [userId]);
    await db.query(`UPDATE users SET mfa_enabled = false WHERE id = $1`, [userId]);
  });
}

export async function regenerateRecoveryCodes(userId: number): Promise<string[]> {
  return asSystem(() => replaceRecoveryCodes(userId));
}

export async function remainingRecoveryCodes(userId: number): Promise<number> {
  const { rows } = await asSystem(() =>
    db.query<{ n: number }>(`SELECT count(*)::int n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId])
  );
  return rows[0]?.n ?? 0;
}
