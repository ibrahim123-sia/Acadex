// Notifications. notify() writes the in-app notification (and a live event for open tabs) in
// the caller's transaction and queues delivery by email, push and WhatsApp, which then
// follows each person's preferences, quiet hours and digest choice and is recorded in
// delivery_logs. Urgent types (emergency) go out at once on every channel. The digest job
// sends one email a day or a week instead of one per notification.
import { channelsFor, inQuietHours, isUrgent, NOTIFICATION_TYPES, type NotificationType } from '@acadex/shared';
import { getConfig } from '../config';
import { asSystem, db, runAsSystem } from '../db/context';
import { defineJob, enqueue } from '../jobs/queue';
import { publish } from './events';
import { minutesIn } from './locale';
import { logger } from './logger';
import { sendEmail } from './mailer';
import { pushDriver } from './push';
import { channelEnabled, sendAndLog, type Channel } from './messaging';

/** The phone number of an account: the guardian's, the teacher's or the student's record. */
export const PHONE_SQL = (u: string) => `COALESCE(
  (SELECT NULLIF(g.phone, '') FROM guardians g WHERE ${u}.role = 'parent' AND g.user_id = ${u}.id AND g.deleted_at IS NULL ORDER BY g.id LIMIT 1),
  (SELECT NULLIF(t.phone, '') FROM teachers t WHERE ${u}.role = 'teacher' AND t.id = ${u}.ref_id),
  (SELECT NULLIF(s.phone, '') FROM students s WHERE ${u}.role = 'student' AND s.id = ${u}.ref_id))`;

export interface NotifyInput {
  institutionId: number | null;
  userIds: number[];
  type: NotificationType;
  title: string;
  message?: string;
  /** where the notification leads in the web app, e.g. /learn/courses/4/work/12 */
  link?: string;
  /** a person gets each key at most once (reminders, alerts) */
  dedupeKey?: string;
  /** only these delivery channels (broadcasts); in-app is always written */
  channels?: DeliveryChannel[];
}
export type DeliveryChannel = 'email' | 'push' | 'whatsapp';

/** Notify people. Returns how many notifications were created. */
export async function notify(n: NotifyInput): Promise<number> {
  const ids = [...new Set(n.userIds)].filter((x) => Number.isInteger(x));
  if (!ids.length) return 0;
  const rows = await asSystem(
    async () =>
      (
        await db.query<{ id: number; user_id: number }>(
          `INSERT INTO notifications (institution_id, user_id, type, title, message, link, dedupe_key)
           SELECT $1, u, $3, $4, $5, $6, $7 FROM unnest($2::int[]) AS u
           ON CONFLICT (user_id, dedupe_key) DO NOTHING
           RETURNING id, user_id`,
          [n.institutionId, ids, n.type, n.title.slice(0, 300), (n.message ?? '').slice(0, 2000), n.link ?? '', n.dedupeKey ?? null]
        )
      ).rows
  );
  if (!rows.length) return 0;
  await publish(
    rows.map((r) => r.user_id),
    { kind: 'notification', data: { type: n.type, title: n.title } }
  );
  // one delivery job per 100 notifications
  for (let i = 0; i < rows.length; i += 100) await enqueue('notify.deliver', { ids: rows.slice(i, i + 100).map((r) => r.id), channels: n.channels });
  return rows.length;
}

interface DeliveryRow {
  id: number;
  user_id: number;
  institution_id: number | null;
  type: string;
  title: string;
  message: string;
  link: string;
  email: string;
  is_active: boolean;
  channels: Record<string, { email: boolean; push: boolean; whatsapp?: boolean }> | null;
  quiet_hours: { start: string; end: string } | null;
  digest: string | null;
  by_phone: boolean | null;
  phone: string | null;
  timezone: string | null;
}

/** Delivers queued notifications by email and push. */
export const deliverJob = defineJob<{ ids: number[]; now?: string; channels?: DeliveryChannel[] }>({
  name: 'notify.deliver',
  retryLimit: 3,
  async run({ ids, now, channels }) {
    const at = now ? new Date(now) : new Date();
    const rows = await runAsSystem(
      async () =>
        (
          await db.query<DeliveryRow>(
            `SELECT n.id, n.user_id, n.institution_id, n.type, n.title, n.message, n.link, u.email, u.is_active,
                    p.channels, p.quiet_hours, p.digest, (i.settings->>'notify_by_phone')::boolean AS by_phone, ${PHONE_SQL('u')} AS phone, i.timezone
               FROM notifications n JOIN users u ON u.id = n.user_id
               LEFT JOIN notification_preferences p ON p.user_id = n.user_id
               LEFT JOIN institutions i ON i.id = n.institution_id
              WHERE n.id = ANY($1::int[])`,
            [ids]
          )
        ).rows
    );
    const appUrl = getConfig().appUrl;
    const later: number[] = [];
    let wakeAt: Date | null = null;
    const logs: { notification_id: number; user_id: number; institution_id: number | null; channel: string; status: string; error: string | null }[] = [];
    const push = pushDriver();

    for (const n of rows) {
      if (!n.is_active) continue;
      const urgent = isUrgent(n.type);
      const ch = channelsFor(n.type, n.channels);
      // a daily / weekly digest replaces single emails (urgent ones still go at once)
      if (!urgent && n.digest && n.digest !== 'off') ch.email = false;
      // WhatsApp messages cost money: only where the institution allows them (always for emergencies)
      if (!urgent && !n.by_phone) ch.whatsapp = false;
      if (channels) for (const k of ['email', 'push', 'whatsapp'] as const) if (!channels.includes(k)) ch[k] = false;
      if (!ch.email && !ch.push && !ch.whatsapp) continue;
      const tz = n.timezone ?? 'Asia/Karachi';
      if (!urgent && inQuietHours(minutesIn(tz, at), n.quiet_hours)) {
        // try again when quiet hours are over (checked every 15 minutes)
        later.push(n.id);
        const next = new Date(at.getTime() + 15 * 60_000);
        if (!wakeAt || next < wakeAt) wakeAt = next;
        continue;
      }
      if (ch.email) {
        const link = n.link ? `${appUrl}${n.link}` : appUrl;
        await runAsSystem(() =>
          sendEmail({
            to: n.email,
            subject: n.title,
            text: `${n.message ? `${n.message}\n\n` : ''}Open Acadex: ${link}\n\nYou can choose which emails you get under Account → Notifications.`,
            template: `notification:${n.type}`,
            userId: n.user_id,
            institutionId: n.institution_id,
          })
        );
        logs.push({ notification_id: n.id, user_id: n.user_id, institution_id: n.institution_id, channel: 'email', status: 'sent', error: null });
      }
      for (const phoneChannel of ['whatsapp'] as Channel[]) {
        if (!ch[phoneChannel] || !channelEnabled(phoneChannel) || !n.institution_id) continue;
        if (!n.phone) {
          logs.push({ notification_id: n.id, user_id: n.user_id, institution_id: n.institution_id, channel: phoneChannel, status: 'skipped', error: 'no phone number' });
          continue;
        }
        const link = n.link ? ` ${appUrl}${n.link}` : '';
        const text = `${n.title}${n.message ? ` — ${n.message}` : ''}${link}`.slice(0, 640);
        await runAsSystem(() => sendAndLog(n.institution_id!, { channel: phoneChannel, to: n.phone!, text, userId: n.user_id, notificationId: n.id }));
      }
      if (ch.push) {
        if (!push.enabled) {
          logs.push({ notification_id: n.id, user_id: n.user_id, institution_id: n.institution_id, channel: 'push', status: 'skipped', error: 'push is turned off' });
          continue;
        }
        const subs = await runAsSystem(
          async () => (await db.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, [n.user_id])).rows
        );
        for (const s of subs) {
          const r = await push.send(s, { title: n.title, body: n.message, link: n.link, type: n.type });
          if (r.ok) {
            logs.push({ notification_id: n.id, user_id: n.user_id, institution_id: n.institution_id, channel: 'push', status: 'sent', error: null });
            await runAsSystem(() => db.query(`UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1`, [s.id]));
          } else {
            logs.push({ notification_id: n.id, user_id: n.user_id, institution_id: n.institution_id, channel: 'push', status: 'failed', error: r.error });
            if (r.gone) await runAsSystem(() => db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]));
          }
        }
      }
    }
    if (logs.length) {
      await runAsSystem(() =>
        db.query(
          `INSERT INTO delivery_logs (notification_id, user_id, institution_id, channel, status, error)
           SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::text[], $5::text[], $6::text[])`,
          [logs.map((l) => l.notification_id), logs.map((l) => l.user_id), logs.map((l) => l.institution_id), logs.map((l) => l.channel), logs.map((l) => l.status), logs.map((l) => l.error)]
        )
      );
    }
    if (later.length && wakeAt) {
      await enqueue('notify.deliver', { ids: later, channels }, { startAfter: wakeAt });
      logger.debug({ count: later.length }, 'notifications held for quiet hours');
    }
  },
});

interface DigestUser {
  user_id: number;
  institution_id: number | null;
  email: string;
  digest: 'daily' | 'weekly';
  channels: Record<string, { email: boolean; push: boolean }> | null;
  last_digest_at: Date | null;
  timezone: string | null;
}

const weekdayIn = (tz: string, at: Date) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at);

/**
 * Digests: at 18:00 local time (weekly: on Mondays), one email listing the unread notifications
 * that would have been emailed since the last digest. Runs every hour.
 */
export const digestJob = defineJob<{ now?: string }>({
  name: 'notify.digest',
  cron: '10 * * * *',
  async run({ now }) {
    const at = now ? new Date(now) : new Date();
    const users = await runAsSystem(
      async () =>
        (
          await db.query<DigestUser>(
            `SELECT p.user_id, u.institution_id, u.email, p.digest, p.channels, p.last_digest_at, i.timezone
               FROM notification_preferences p JOIN users u ON u.id = p.user_id AND u.is_active
               LEFT JOIN institutions i ON i.id = u.institution_id
              WHERE p.digest IN ('daily', 'weekly') AND (p.last_digest_at IS NULL OR p.last_digest_at < $1::timestamptz - interval '20 hours')`,
            [at]
          )
        ).rows
    );
    const appUrl = getConfig().appUrl;
    let sent = 0;
    for (const u of users) {
      const tz = u.timezone ?? 'Asia/Karachi';
      if (Math.floor(minutesIn(tz, at) / 60) !== 18) continue;
      if (u.digest === 'weekly' && weekdayIn(tz, at) !== 'Mon') continue;
      const since = u.last_digest_at ?? new Date(at.getTime() - (u.digest === 'weekly' ? 7 : 1) * 86_400_000);
      const items = await runAsSystem(
        async () =>
          (
            await db.query<{ type: string; title: string; message: string; link: string; created_at: Date }>(
              `SELECT type, title, message, link, created_at FROM notifications
                WHERE user_id = $1 AND created_at > $2 AND created_at <= $3 AND NOT COALESCE(is_read, false) ORDER BY created_at DESC LIMIT 100`,
              [u.user_id, since, at]
            )
          ).rows
      ).then((rows) => rows.filter((r) => !isUrgent(r.type) && channelsFor(r.type, u.channels).email));
      await runAsSystem(() => db.query(`UPDATE notification_preferences SET last_digest_at = $2 WHERE user_id = $1`, [u.user_id, at]));
      if (!items.length) continue;
      const lines = items.slice(0, 30).map((r) => `• ${r.title}${r.message ? ` — ${r.message.slice(0, 160)}` : ''}${r.link ? `\n  ${appUrl}${r.link}` : ''}`);
      const more = items.length > 30 ? `\n…and ${items.length - 30} more in Acadex.` : '';
      const label = u.digest === 'weekly' ? 'This week' : 'Today';
      await runAsSystem(() =>
        sendEmail({
          to: u.email,
          subject: `${label} in Acadex: ${items.length} update${items.length === 1 ? '' : 's'}`,
          text: `${lines.join('\n')}${more}\n\nOpen Acadex: ${appUrl}\nYou chose a ${u.digest} digest under Account → Notifications.`,
          template: 'notification:digest',
          userId: u.user_id,
          institutionId: u.institution_id,
        })
      );
      await runAsSystem(() =>
        db.query(`INSERT INTO delivery_logs (user_id, institution_id, channel, status, body) VALUES ($1,$2,'email','sent',$3)`, [u.user_id, u.institution_id, `digest: ${items.length} notifications`])
      );
      sent++;
    }
    if (sent) logger.info({ sent }, 'digests sent');
  },
});

export const NOTIFICATION_LABELS = Object.fromEntries(Object.entries(NOTIFICATION_TYPES).map(([k, v]) => [k, v.label]));
