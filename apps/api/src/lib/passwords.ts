import bcrypt from 'bcryptjs';

export { newPassword } from '@acadex/shared';

const BCRYPT_ROUNDS = 10;

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
