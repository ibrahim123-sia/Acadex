// Notifications for the signed-in person: the in-app list, read state, email / push
// preferences with quiet hours, and browser push subscriptions. Mounted under /api/notifications.
// The live stream (server-sent events) is eventsHandler, mounted before the per-request
// database transaction because it stays open.
import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { NOTIFICATION_TYPES, accountPreferencesBody, id, notificationPreferencesBody, pushSubscriptionBody } from '@acadex/shared';
import { verifyAccessToken } from '../auth/tokens';
import { db, runAsSystem } from '../db/context';
import { notFound } from '../lib/errors';
import { subscribe } from '../lib/events';
import { logger } from '../lib/logger';
import { parsePage } from '../lib/pagination';
import { vapidPublicKey } from '../lib/push';
import { channelEnabled } from '../lib/messaging';
import { auth, currentUser, loadUserRow } from '../middleware/auth';

const router = Router();
router.use(auth);

router.get('/', async (req, res) => {
  const pg = parsePage(req.query, { defaultSize: 20 });
  const unreadOnly = req.query.unread === 'true';
  const userId = currentUser(req).id;
  const [items, counts] = await Promise.all([
    db.query(
      `SELECT id, type, title, message, link, is_read, created_at FROM notifications
        WHERE user_id = $1 AND ($4::boolean IS FALSE OR NOT is_read)
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, pg.limit, pg.offset, unreadOnly]
    ),
    db.query<{ total: number; unread: number }>(
      `SELECT count(*)::int total, count(*) FILTER (WHERE NOT is_read)::int unread FROM notifications WHERE user_id = $1`,
      [userId]
    ),
  ]);
  res.json({ items: items.rows, unread: counts.rows[0]?.unread ?? 0, total: counts.rows[0]?.total ?? 0 });
});

router.post('/read-all', async (req, res) => {
  await db.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND NOT is_read`, [currentUser(req).id]);
  res.json({ ok: true });
});

router.post('/:id/read', async (req, res) => {
  const { rowCount } = await db.query(`UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [id.parse(req.params.id), currentUser(req).id]);
  if (!rowCount) throw notFound();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- preferences

router.get('/preferences', async (req, res) => {
  const u = currentUser(req);
  const { rows } = await db.query(`SELECT channels, quiet_hours, digest FROM notification_preferences WHERE user_id = $1`, [u.id]);
  const inst = u.institution_id
    ? (await db.query<{ by_phone: boolean | null }>(`SELECT (settings->>'notify_by_phone')::boolean AS by_phone FROM institutions WHERE id = $1`, [u.institution_id])).rows[0]
    : undefined;
  res.json({
    types: Object.entries(NOTIFICATION_TYPES).map(([key, t]) => ({ key, label: t.label, urgent: 'urgent' in t && t.urgent, default: { email: t.email, push: t.push, sms: false, whatsapp: false } })),
    channels: rows[0]?.channels ?? {},
    quiet_hours: rows[0]?.quiet_hours ?? null,
    digest: rows[0]?.digest ?? 'off',
    /** whether the institution sends notifications by SMS / WhatsApp at all */
    phone: { sms: !!inst?.by_phone && channelEnabled('sms'), whatsapp: !!inst?.by_phone && channelEnabled('whatsapp') },
    push: { available: vapidPublicKey() !== null, public_key: vapidPublicKey() },
  });
});

router.put('/preferences', async (req, res) => {
  const b = notificationPreferencesBody.parse(req.body);
  const u = currentUser(req);
  await db.query(
    `INSERT INTO notification_preferences (user_id, institution_id, channels, quiet_hours, digest, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET channels = EXCLUDED.channels, quiet_hours = EXCLUDED.quiet_hours, digest = EXCLUDED.digest, updated_at = now()`,
    [u.id, u.institution_id, JSON.stringify(b.channels), b.quiet_hours ? JSON.stringify(b.quiet_hours) : null, b.digest]
  );
  res.json(b);
});

// ---------------------------------------------------------------- account preferences

/** The person's language and low-bandwidth mode, kept on the account so every device follows it. */
router.put('/account-preferences', async (req, res) => {
  const b = accountPreferencesBody.parse(req.body);
  const u = currentUser(req);
  const { rows } = await db.query<{ locale: string | null; low_bandwidth: boolean }>(
    `UPDATE users SET locale = CASE WHEN $2::boolean THEN $3 ELSE locale END, low_bandwidth = COALESCE($4, low_bandwidth) WHERE id = $1 RETURNING locale, low_bandwidth`,
    [u.id, b.locale !== undefined, b.locale ?? null, b.low_bandwidth ?? null]
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------------- push subscriptions

router.post('/push-subscriptions', async (req, res) => {
  const b = pushSubscriptionBody.parse(req.body);
  const u = currentUser(req);
  // an endpoint belongs to one browser: re-subscribing (or another person signing in on it) takes it over
  await runAsSystem(() => db.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id <> $2`, [b.endpoint, u.id]));
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [u.id, b.endpoint, b.keys.p256dh, b.keys.auth, String(req.headers['user-agent'] ?? '').slice(0, 300)]
  );
  res.status(201).json({ ok: true });
});

router.delete('/push-subscriptions', async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url().max(2000) }).parse(req.body ?? {});
  await db.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [endpoint, currentUser(req).id]);
  res.status(204).end();
});

export default router;

/**
 * GET /api/events — a stream of live events for the signed-in person (server-sent events).
 * The access token comes in the Authorization header (the web app reads the stream with
 * fetch); the stream ends when the token expires and the client reconnects with a fresh one.
 */
export async function eventsHandler(req: Request, res: Response) {
  const header = req.headers.authorization || '';
  const claims = header.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
  if (!claims) return void res.status(401).json({ error: 'Invalid or expired session', code: 'TOKEN_INVALID' });
  const u = await runAsSystem(() => loadUserRow(claims.id, claims.sid));
  if (!u || !u.is_active || u.token_version !== claims.tv || !u.session_found || u.session_revoked || u.session_expired) {
    return void res.status(401).json({ error: 'Invalid or expired session', code: 'SESSION_INVALID' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // listening first, so nothing published after 'ready' is missed
  const unsubscribe = await subscribe(u.id, (e) => send(e.kind, e.data ?? {}));
  send('ready', { user_id: u.id });
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
  const expMs = (claims.exp ?? 0) * 1000 - Date.now();
  const expiry = setTimeout(() => {
    send('reauth', {});
    res.end();
  }, Math.max(1000, Math.min(expMs, 60 * 60_000)));
  const close = () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    unsubscribe();
  };
  req.on('close', close);
  res.on('error', (err) => {
    logger.debug({ err }, 'event stream closed');
    close();
  });
}
