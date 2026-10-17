// Outgoing email (transactional outbox): every message is first written to email_outbox
// inside the caller's transaction, so it is sent only if the work it belongs to commits.
// A background flusher then delivers pending rows.
//   MAIL_DRIVER=log  → nothing leaves the machine; rows are marked sent and logged (development, tests)
//   MAIL_DRIVER=smtp → delivered through SMTP_URL (any provider: SES, Postmark, Resend, Brevo, ...)
import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from '../config';
import { asSystem, db, runAsSystem, withTransaction } from '../db/context';
import { logger } from './logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  template?: string;
  userId?: number | null;
  institutionId?: number | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A simple branded HTML version of a plain-text email (the institution's name, colour and footer). */
export function brandedHtml(text: string, brand: { name: string; color: string; footer?: string; logo?: string }): string {
  const body = esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + brand.color + '">$1</a>')
    .replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${brand.color};color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold">${brand.logo ? `<img src="${esc(brand.logo)}" alt="" height="28" style="vertical-align:middle;margin-right:8px">` : ''}${esc(brand.name)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">${body}</td></tr>
<tr><td style="padding:12px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">${esc(brand.footer || brand.name)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Queue an email as part of the current transaction. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const logOnly = getConfig().mailDriver === 'log';
  if (!msg.html && msg.institutionId) {
    const { rows } = await asSystem(() =>
      db.query<{ name: string; primary_color: string | null; logo_url: string | null; app_name: string | null; footer: string | null }>(
        `SELECT name, primary_color, logo_url, settings->'branding'->>'app_name' AS app_name, settings->'branding'->>'email_footer' AS footer FROM institutions WHERE id = $1`,
        [msg.institutionId]
      )
    );
    const b = rows[0];
    if (b) msg = { ...msg, html: brandedHtml(msg.text, { name: b.app_name || b.name, color: /^#[0-9a-fA-F]{6}$/.test(b.primary_color ?? '') ? b.primary_color! : '#4f46e5', footer: b.footer ?? undefined, logo: b.logo_url || undefined }) };
  }
  await asSystem(() =>
    withTransaction((tx) =>
      tx.query(
        `INSERT INTO email_outbox (to_email, subject, text_body, html_body, template, user_id, institution_id, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [msg.to, msg.subject, msg.text, msg.html ?? '', msg.template ?? '', msg.userId ?? null, msg.institutionId ?? null, logOnly ? new Date() : null]
      )
    )
  );
  if (logOnly) logger.info({ to: msg.to, subject: msg.subject, template: msg.template }, 'email recorded (MAIL_DRIVER=log)');
}

let transporter: Transporter | undefined;

/** Deliver up to `limit` pending emails (SMTP driver). Returns how many were sent. */
export async function flushOutbox(limit = 20): Promise<number> {
  const cfg = getConfig();
  if (cfg.mailDriver !== 'smtp' || !cfg.smtpUrl) return 0;
  transporter ??= nodemailer.createTransport(cfg.smtpUrl);
  const pending = await runAsSystem(async () =>
    (
      await db.query<{ id: number; to_email: string; subject: string; text_body: string; html_body: string }>(
        `SELECT id, to_email, subject, text_body, html_body FROM email_outbox
          WHERE sent_at IS NULL AND attempts < 8 ORDER BY id LIMIT $1`,
        [limit]
      )
    ).rows
  );
  let sent = 0;
  for (const m of pending) {
    try {
      await transporter.sendMail({ from: cfg.mailFrom, to: m.to_email, subject: m.subject, text: m.text_body, html: m.html_body || undefined });
      await runAsSystem(() => db.query(`UPDATE email_outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [m.id]));
      sent++;
    } catch (err) {
      logger.warn({ err, id: m.id }, 'email delivery failed');
      await runAsSystem(() =>
        db.query(`UPDATE email_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [m.id, String((err as Error).message).slice(0, 500)])
      );
    }
  }
  return sent;
}

/** Start the background flusher (server only). */
export function startOutboxFlusher(intervalMs = 5000): () => void {
  const timer = setInterval(() => {
    flushOutbox().catch((err) => logger.error({ err }, 'outbox flush failed'));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
