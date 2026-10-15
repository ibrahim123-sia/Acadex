// Browser push (Web Push with VAPID keys) behind a small interface, so tests and installations
// without push use a driver that sends nothing.
//   PUSH_DRIVER=none    → push is off (subscriptions are still accepted, nothing is sent)
//   PUSH_DRIVER=webpush → sent with the VAPID keys
//   PUSH_DRIVER=fake    → recorded in memory (tests)
import webpush from 'web-push';
import { getConfig } from '../config';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushPayload {
  title: string;
  body: string;
  link: string;
  type: string;
}
/** gone: the browser dropped the subscription (delete it). */
export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };

export interface PushDriver {
  readonly enabled: boolean;
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

/** Pushes the fake driver recorded (tests). */
export const sentPushes: { target: PushTarget; payload: PushPayload }[] = [];

let driver: PushDriver | undefined;

export function pushDriver(): PushDriver {
  if (driver) return driver;
  const cfg = getConfig().push;
  if (cfg.driver === 'fake') {
    driver = {
      enabled: true,
      async send(target, payload) {
        if (target.endpoint.includes('gone')) return { ok: false, gone: true, error: 'subscription expired' };
        sentPushes.push({ target, payload });
        return { ok: true };
      },
    };
  } else if (cfg.driver === 'webpush') {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey!, cfg.privateKey!);
    driver = {
      enabled: true,
      async send(target, payload) {
        try {
          await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), { TTL: 24 * 3600 });
          return { ok: true };
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          return { ok: false, gone: status === 404 || status === 410, error: String((e as Error).message).slice(0, 300) };
        }
      },
    };
  } else {
    driver = { enabled: false, send: async () => ({ ok: false, gone: false, error: 'push is turned off' }) };
  }
  return driver;
}

/** The public key browsers need to subscribe (null when push is off). */
export const vapidPublicKey = () => {
  const cfg = getConfig().push;
  if (cfg.driver === 'webpush') return cfg.publicKey ?? null;
  if (cfg.driver === 'fake') return 'fake-public-key';
  return null;
};
