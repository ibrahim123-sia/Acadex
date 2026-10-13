const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const BCRYPT_ROUNDS = 10;
// No look-alike characters (0/O, 1/l/I) so a password read off a screen can be typed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

// 16 random characters in groups of 4, e.g. "Xk7p-Qm2R-a9Tz-Wc4N" (~92 bits).
function generateTempPassword() {
  const chars = Array.from({ length: 16 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return chars.match(/.{4}/g).join('-');
}

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

const newPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password is too long')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

module.exports = { generateTempPassword, hashPassword, newPassword };
