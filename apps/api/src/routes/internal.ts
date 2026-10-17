// Calls from Acadex's own infrastructure, not from people. Mounted under /api/internal.
//
// POST /cron — an outside scheduler (the Cloudflare Worker's cron trigger, see
// docs/cloudflare.md) wakes the API every few minutes and asks it to queue the scheduled jobs
// that fell due in the last window. Used with JOBS_SCHEDULE=external, because a container that
// sleeps between requests misses pg-boss's own schedules. Without CRON_SECRET the route answers
// 404, so a normal deployment has no such endpoint.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../config';
import { badRequest, notFound } from '../lib/errors';
import { dueMinutes } from '../lib/cron';
import { logger } from '../lib/logger';
import { cronJobs, enqueue } from '../jobs';

const router = Router();

const tickSchema = z.object({
  /** the scheduled time of this tick (the Worker's event.scheduledTime); now when missing */
  at: z.iso.datetime({ offset: true }).optional(),
  /** how far back to look, in minutes (the trigger's interval) */
  window_minutes: z.coerce.number().int().min(1).max(60).default(5),
});

const sameSecret = (given: string | undefined, expected: string) => {
  const a = crypto.createHash('sha256').update(given ?? '').digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
};

/** Queue the scheduled jobs due in the last window (header x-acadex-cron: CRON_SECRET). */
router.post('/cron', async (req, res) => {
  const secret = getConfig().cronSecret;
  if (!secret || !sameSecret(req.header('x-acadex-cron'), secret)) throw notFound();
  const b = tickSchema.parse(req.body ?? {});
  const now = Date.now();
  const at = b.at ? new Date(b.at) : new Date(now);
  if (Math.abs(at.getTime() - now) > 15 * 60_000) throw badRequest('The tick is too far from now', { at: 'invalid' });
  const from = new Date(at.getTime() - b.window_minutes * 60_000);
  const queued: { job: string; at: string }[] = [];
  for (const job of cronJobs()) {
    for (const minute of dueMinutes(job.cron, from, at)) {
      // one run per job and minute, even if the tick is retried
      await enqueue(job.name, {}, { singletonKey: `cron:${minute.toISOString()}` });
      queued.push({ job: job.name, at: minute.toISOString() });
    }
  }
  if (queued.length) logger.info({ queued }, 'scheduled jobs queued by the outside scheduler');
  res.json({ queued });
});

export default router;
