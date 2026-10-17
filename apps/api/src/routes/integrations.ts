// Webhooks from live-class providers (public, verified by signature). Zoom reports who joined a
// meeting (→ the class register) and when a cloud recording is ready (→ the session's recording
// link). Each institution's Zoom app calls /api/integrations/zoom/webhook/<institution id>.
import crypto from 'node:crypto';
import { Router } from 'express';
import { id } from '@acadex/shared';
import { db, runAsSystem } from '../db/context';
import { safeEqual } from '../auth/crypto';
import { loadAccount, markLiveAttendance, zoomSignature } from '../lib/live';
import { logger } from '../lib/logger';

const router = Router();

interface ZoomEvent {
  event: string;
  payload: {
    plainToken?: string;
    object?: { id?: number | string; share_url?: string; participant?: { email?: string; join_time?: string } };
  };
}

router.post('/zoom/webhook/:institution', async (req, res) => {
  const inst = id.parse(req.params.institution);
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const account = await runAsSystem(() => loadAccount(inst, 'zoom'));
  const secret = account?.secret.webhook_secret;
  if (!account?.enabled || !secret) return res.status(404).json({ error: 'Not found' });
  const ts = String(req.headers['x-zm-request-timestamp'] ?? '');
  const sig = String(req.headers['x-zm-signature'] ?? '');
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300 || !safeEqual(sig, zoomSignature(secret, ts, raw))) {
    return res.status(401).json({ error: 'Bad signature' });
  }
  let e: ZoomEvent;
  try {
    e = JSON.parse(raw) as ZoomEvent;
  } catch {
    return res.status(400).json({ error: 'Bad JSON' });
  }
  if (e.event === 'endpoint.url_validation' && e.payload.plainToken) {
    const plainToken = e.payload.plainToken;
    return res.json({ plainToken, encryptedToken: crypto.createHmac('sha256', secret).update(plainToken).digest('hex') });
  }
  const meetingId = e.payload.object?.id != null ? String(e.payload.object.id) : null;
  if (!meetingId) return res.json({ ok: true });
  await runAsSystem(async () => {
    const { rows } = await db.query<{ id: number; offering_id: number; starts_at: Date; auto_attendance: boolean }>(
      `SELECT id, offering_id, starts_at, auto_attendance FROM live_sessions WHERE institution_id = $1 AND provider = 'zoom' AND external_id = $2`,
      [inst, meetingId]
    );
    const l = rows[0];
    if (!l) return;
    if (e.event === 'recording.completed' && e.payload.object?.share_url) {
      await db.query(`UPDATE live_sessions SET recording_url = $2 WHERE id = $1 AND recording_url = ''`, [l.id, e.payload.object.share_url]);
    }
    if (e.event === 'meeting.participant_joined') {
      const email = e.payload.object?.participant?.email?.toLowerCase();
      if (!email) return;
      const { rows: users } = await db.query<{ id: number; role: string; ref_id: number | null }>(
        `SELECT id, role, ref_id FROM users WHERE institution_id = $1 AND lower(email) = $2 AND is_active`,
        [inst, email]
      );
      const u = users[0];
      if (!u) return;
      await db.query(`INSERT INTO live_joins (institution_id, live_session_id, user_id) VALUES ($1,$2,$3)`, [inst, l.id, u.id]);
      if (u.role === 'student' && u.ref_id) {
        const joined = e.payload.object?.participant?.join_time ? Date.parse(e.payload.object.participant.join_time) : Date.now();
        await markLiveAttendance(inst, l, u.ref_id, u.id, Number.isFinite(joined) ? joined : Date.now());
      }
    }
  });
  logger.debug({ event: e.event, meetingId }, 'zoom webhook');
  res.json({ ok: true });
});

export default router;
