// Outgoing webhooks: an institution's endpoints receive events (student.enrolled,
// grade.released, payment.received, …) as JSON, signed with HMAC-SHA256 like Stripe:
//   Acadex-Signature: t=<unix seconds>,v1=<hex of HMAC(secret, "<t>.<body>")>
// Deliveries are queued after the transaction commits and retried with back-off (1, 5, 30
// minutes, 2 and 6 hours); an endpoint that keeps failing is switched off.
import crypto from 'node:crypto';
import type { WebhookEvent } from '@acadex/shared';
import { decryptSecret } from '../auth/crypto';
import { asSystem, db, inContext, runAsSystem } from '../db/context';
import { defineJob, enqueue } from '../jobs/queue';
import { logger } from './logger';

const BACKOFF_MIN = [1, 5, 30, 120, 360];
const DISABLE_AFTER = 20;

export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** Queues an event for every enabled endpoint of the institution that listens to it. */
export async function emitWebhook(institutionId: number, event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
  // in the caller's transaction: no event for a change that rolls back
  const ids = await asSystem(async () => {
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM webhook_endpoints WHERE institution_id = $1 AND enabled AND $2 = ANY(events)`,
      [institutionId, event]
    );
    if (!rows.length) return [];
    const payload = { id: crypto.randomUUID(), event, created_at: new Date().toISOString(), institution_id: institutionId, data };
    const { rows: d } = await db.query<{ id: number }>(
      `INSERT INTO webhook_deliveries (institution_id, endpoint_id, event, payload) SELECT $1, e, $2, $3 FROM unnest($4::int[]) e RETURNING id`,
      [institutionId, event, JSON.stringify(payload), rows.map((r) => r.id)]
    );
    return d.map((r) => r.id);
  });
  for (const id of ids) await enqueue('webhook.deliver', { id });
  return ids.length;
}

/** Fetch used for deliveries (tests replace it). */
export const webhookTransport: { fetch: typeof fetch } = { fetch: (...a) => fetch(...a) };

export async function deliver(deliveryId: number): Promise<'delivered' | 'retry' | 'failed' | 'skip'> {
  // in the caller's transaction when there is one (a test ping sees its own new delivery)
  const run = <T,>(fn: () => Promise<T>) => (inContext() ? asSystem(fn) : runAsSystem(fn));
  return run(async () => {
    const { rows } = await db.query<{ id: number; endpoint_id: number; payload: unknown; attempts: number; url: string; secret_sealed: string; enabled: boolean; status: string }>(
      `SELECT d.id, d.endpoint_id, d.payload, d.attempts, d.status, e.url, e.secret_sealed, e.enabled
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE d.id = $1`,
      [deliveryId]
    );
    const d = rows[0];
    if (!d || d.status !== 'pending' || !d.enabled) return 'skip';
    const body = JSON.stringify(d.payload);
    let code: number | null = null;
    let error: string | null = null;
    try {
      const res = await webhookTransport.fetch(d.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Acadex-Webhooks/1', 'Acadex-Signature': signPayload(decryptSecret(d.secret_sealed), body) },
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
      });
      code = res.status;
      if (res.status >= 200 && res.status < 300) {
        await db.query(`UPDATE webhook_deliveries SET status = 'delivered', attempts = attempts + 1, response_code = $2, delivered_at = now(), error = NULL WHERE id = $1`, [d.id, code]);
        await db.query(`UPDATE webhook_endpoints SET failures = 0 WHERE id = $1`, [d.endpoint_id]);
        return 'delivered';
      }
      error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
    }
    const attempts = d.attempts + 1;
    const final = attempts > BACKOFF_MIN.length;
    const next = final ? null : new Date(Date.now() + BACKOFF_MIN[attempts - 1]! * 60_000);
    await db.query(`UPDATE webhook_deliveries SET attempts = $2, response_code = $3, error = $4, status = $5, next_attempt_at = $6 WHERE id = $1`, [
      d.id,
      attempts,
      code,
      error,
      final ? 'failed' : 'pending',
      next,
    ]);
    const { rows: ep } = await db.query<{ failures: number }>(`UPDATE webhook_endpoints SET failures = failures + 1 WHERE id = $1 RETURNING failures`, [d.endpoint_id]);
    if ((ep[0]?.failures ?? 0) >= DISABLE_AFTER) {
      await db.query(`UPDATE webhook_endpoints SET enabled = false WHERE id = $1`, [d.endpoint_id]);
      logger.warn({ endpoint: d.endpoint_id }, 'webhook endpoint switched off after repeated failures');
    }
    if (next) await enqueue('webhook.deliver', { id: d.id }, { startAfter: next });
    return final ? 'failed' : 'retry';
  });
}

export const webhookJob = defineJob<{ id: number }>({
  name: 'webhook.deliver',
  async run({ id }) {
    await deliver(id);
  },
});
