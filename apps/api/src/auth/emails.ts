// Transactional email templates (plain text + minimal HTML). Links carry the token in the
// URL fragment (#token=...) so it never reaches server logs or Referer headers.
import { getConfig } from '../config';
import { sendEmail } from '../lib/mailer';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, bodyHtml: string, action?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
<div style="font-weight:700;font-size:18px;color:#4f46e5;margin-bottom:16px">Acadex</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml}
${action ? `<p style="margin:24px 0"><a href="${esc(action.url)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${esc(action.label)}</a></p>
<p style="font-size:12px;color:#64748b">Or paste this link into your browser:<br>${esc(action.url)}</p>` : ''}
</div></body></html>`;
}

export const inviteUrl = (token: string) => `${getConfig().appUrl}/accept-invite#token=${token}`;
export const resetUrl = (token: string) => `${getConfig().appUrl}/reset-password#token=${token}`;
export const verifyUrl = (token: string) => `${getConfig().appUrl}/verify-email#token=${token}`;

export async function sendInviteEmail(p: { to: string; name: string; institutionName: string; inviter: string; token: string; userId: number; institutionId: number | null }) {
  const url = inviteUrl(p.token);
  await sendEmail({
    to: p.to,
    subject: `You're invited to ${p.institutionName} on Acadex`,
    template: 'invite',
    userId: p.userId,
    institutionId: p.institutionId,
    text: `Hello ${p.name},\n\n${p.inviter} has invited you to ${p.institutionName} on Acadex.\nSet your password to activate your account (the link is valid for 7 days):\n\n${url}\n\nIf you weren't expecting this, you can ignore this email.`,
    html: layout(
      `Join ${p.institutionName} on Acadex`,
      `<p>Hello ${esc(p.name)},</p><p>${esc(p.inviter)} has invited you to <b>${esc(p.institutionName)}</b>. Set your password to activate your account. The link is valid for 7 days.</p>`,
      { label: 'Set my password', url }
    ),
  });
}

export async function sendPasswordResetEmail(p: { to: string; name: string; token: string; userId: number }) {
  const url = resetUrl(p.token);
  await sendEmail({
    to: p.to,
    subject: 'Reset your Acadex password',
    template: 'password_reset',
    userId: p.userId,
    text: `Hello ${p.name},\n\nSomeone (hopefully you) asked to reset your Acadex password. The link is valid for 1 hour:\n\n${url}\n\nIf it wasn't you, ignore this email — your password stays the same.`,
    html: layout(
      'Reset your password',
      `<p>Hello ${esc(p.name)},</p><p>Someone (hopefully you) asked to reset your Acadex password. The link is valid for 1 hour.</p><p>If it wasn't you, ignore this email — your password stays the same.</p>`,
      { label: 'Choose a new password', url }
    ),
  });
}

export async function sendVerifyEmail(p: { to: string; name: string; token: string; userId: number }) {
  const url = verifyUrl(p.token);
  await sendEmail({
    to: p.to,
    subject: 'Confirm your email address',
    template: 'verify_email',
    userId: p.userId,
    text: `Hello ${p.name},\n\nPlease confirm that this is your email address (valid for 24 hours):\n\n${url}`,
    html: layout('Confirm your email address', `<p>Hello ${esc(p.name)},</p><p>Please confirm that this is your email address. The link is valid for 24 hours.</p>`, {
      label: 'Confirm email',
      url,
    }),
  });
}

/** A two-step verification code (the code itself is never stored, only its hash). */
export async function sendMfaCodeEmail(p: { to: string; name: string; userId: number; code: string; minutes: number }) {
  await sendEmail({
    to: p.to,
    subject: `Your Acadex code: ${p.code}`,
    template: 'mfa_code',
    userId: p.userId,
    text: `Hello ${p.name},\n\nYour Acadex verification code is ${p.code}. It works once, for ${p.minutes} minutes.\n\nNobody from Acadex or your institution will ever ask you for this code. If you didn't try to sign in, change your password now.`,
    html: layout(
      'Your verification code',
      `<p>Hello ${esc(p.name)},</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${esc(p.code)}</p><p>It works once, for ${p.minutes} minutes.</p><p style="font-size:13px;color:#64748b">Nobody from Acadex or your institution will ever ask you for this code. If you didn't try to sign in, change your password now.</p>`
    ),
  });
}

export async function sendSecurityNotice(p: { to: string; name: string; userId: number; what: string }) {
  await sendEmail({
    to: p.to,
    subject: `Security notice: ${p.what}`,
    template: 'security_notice',
    userId: p.userId,
    text: `Hello ${p.name},\n\n${p.what} on your Acadex account just now. If this wasn't you, reset your password immediately and contact your institution administrator.`,
    html: layout(`Security notice`, `<p>Hello ${esc(p.name)},</p><p><b>${esc(p.what)}</b> on your Acadex account just now.</p><p>If this wasn't you, reset your password immediately and contact your institution administrator.</p>`),
  });
}
