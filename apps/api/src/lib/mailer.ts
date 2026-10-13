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

/** Queue an email as part of the current transaction. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const logOnly = getConfig().mailDriver === 'log';
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
