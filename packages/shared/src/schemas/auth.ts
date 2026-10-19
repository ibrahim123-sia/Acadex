import { z } from 'zod';

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});

export const newPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password is too long')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export const changePasswordBody = z.object({
  current_password: z.string().min(1).max(200),
  new_password: newPassword,
});

/** Opaque single-use tokens sent by email (invites, password reset, email verification). */
export const emailToken = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'Invalid or expired link');

export const acceptInviteBody = z.object({ token: emailToken, password: newPassword });
export const passwordResetRequestBody = z.object({ email: z.string().trim().toLowerCase().min(3).max(254) });
export const passwordResetBody = z.object({ token: emailToken, password: newPassword });
export const verifyEmailBody = z.object({ token: emailToken });

export const totpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
/** A 6-digit code (authenticator app or email) or a recovery code (xxxxx-xxxxx). */
export const mfaCode = z
  .string()
  .trim()
  .regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/i, 'Enter the 6-digit code or a recovery code');

export const mfaVerifyBody = z.object({ mfa_token: z.string().min(20).max(2000), code: mfaCode });
/** Which method the sign-in uses; with codes by email, one is sent now. */
export const mfaStartBody = z.object({ mfa_token: z.string().min(20).max(2000) });
export const mfaEnableBody = z.object({ code: totpCode });
export const mfaDisableBody = z.object({ password: z.string().min(1).max(200), code: mfaCode });

export type LoginBody = z.infer<typeof loginBody>;
