// Two-factor authentication: TOTP authenticator apps + single-use recovery codes.
import crypto from 'node:crypto';
import { asSystem, db } from '../db/context';
import { decryptSecret, encryptSecret, safeEqual, sha256 } from './crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_CODE_COUNT = 10;

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
    await db.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [userId]);
    return replaceRecoveryCodes(userId);
  });
}

/** Check a TOTP code (not reusable) or a recovery code (consumed). */
export async function verifySecondFactor(userId: number, code: string): Promise<'totp' | 'recovery' | null> {
  return asSystem(async () => {
    const normalized = code.trim().toLowerCase();
    if (/^\d{6}$/.test(normalized)) {
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
