import crypto from 'node:crypto';
import { getConfig } from '../config';

/** URL-safe random token (default 32 bytes ≈ 43 chars). */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Tokens are stored hashed: a database leak doesn't hand out working links or sessions. */
export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** AES-256-GCM with the MFA encryption key: base64(iv | tag | ciphertext). */
export function encryptSecret(plain: string, key: Buffer = getConfig().mfaEncryptionKey): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(sealed: string, key: Buffer = getConfig().mfaEncryptionKey): string {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
