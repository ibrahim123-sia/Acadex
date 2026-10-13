import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export { newPassword } from '@acadex/shared';

const BCRYPT_ROUNDS = 10;
// No look-alike characters (0/O, 1/l/I) so a password read off a screen can be typed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 16 random characters in groups of 4, e.g. "Xk7p-Qm2R-a9Tz-Wc4N" (~92 bits). */
export function generateTempPassword(): string {
  const chars = Array.from({ length: 16 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
