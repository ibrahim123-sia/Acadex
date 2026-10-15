// Notifications. notify() writes the in-app notification (and a live event for open tabs) in
// the caller's transaction and queues delivery by email and push, which then follows each
// person's preferences and quiet hours and is recorded in delivery_logs.
import { channelsFor, inQuietHours, type NotificationType } from '@acadex/shared';
import { getConfig } from '../config';
import { asSystem, db, runAsSystem } from '../db/context';
import { defineJob, enqueue } from '../jobs/queue';
import { publish } from './events';
import { minutesIn } from './locale';
import { logger } from './logger';
import { sendEmail } from './mailer';
import { pushDriver } from './push';

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
}

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
  for (let i = 0; i < rows.length; i += 100) await enqueue('notify.deliver', { ids: rows.slice(i, i + 100).map((r) => r.id) });
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
  channels: Record<string, { email: boolean; push: boolean }> | null;
  quiet_hours: { start: string; end: string } | null;
  timezone: string | null;
}

/** Delivers queued notifications by email and push. */
export const deliverJob = defineJob<{ ids: number[]; now?: string }>({
  name: 'notify.deliver',
  retryLimit: 3,
  async run({ ids, now }) {
    const at = now ? new Date(now) : new Date();
    const rows = await runAsSystem(
      async () =>
        (
          await db.query<DeliveryRow>(
            `SELECT n.id, n.user_id, n.institution_id, n.type, n.title, n.message, n.link, u.email, u.is_active,
                    p.channels, p.quiet_hours, i.timezone
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
      const ch = channelsFor(n.type, n.channels);
      if (!ch.email && !ch.push) continue;
      const tz = n.timezone ?? 'Asia/Karachi';
      if (inQuietHours(minutesIn(tz, at), n.quiet_hours)) {
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
      await enqueue('notify.deliver', { ids: later }, { startAfter: wakeAt });
      logger.debug({ count: later.length }, 'notifications held for quiet hours');
    }
  },
});
