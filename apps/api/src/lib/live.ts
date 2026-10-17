// Live-class providers: Acadex creates the meeting on the institution's own account.
//   jitsi — a fresh room on meet.jit.si (no account needed)
//   zoom  — Server-to-Server OAuth app (account id, client id, secret); webhooks bring back
//           recordings and who joined
//   teams — Microsoft Graph with an app registration (client credentials) creating online
//           meetings for one organizer (needs an application access policy for that user)
//   meet  — a Google service account with domain-wide delegation creating a Calendar event
//           with a Meet link for one organizer
// LIVE_DRIVER=fake (tests) returns made-up meetings without calling anyone.
import crypto from 'node:crypto';
import type { LiveIntegrationInput } from '@acadex/shared';
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { getConfig } from '../config';
import { db } from '../db/context';
import { badRequest, HttpError } from './errors';
import { institutionTimeZone } from './institution';
import { todayIn } from './locale';

export type LiveProvider = 'zoom' | 'teams' | 'meet';
export interface Meeting {
  joinUrl: string;
  hostUrl: string;
  externalId: string;
}
export interface MeetingRequest {
  title: string;
  startsAt: Date;
  durationMinutes: number;
}
interface Account {
  enabled: boolean;
  config: Record<string, string>;
  secret: Record<string, string>;
}

/** Meetings the fake driver created (tests). */
export const fakeMeetings: { provider: string; title: string }[] = [];

export const jitsiRoom = () => `https://meet.jit.si/acadex-${crypto.randomBytes(9).toString('base64url')}`;

export async function loadAccount(institutionId: number, provider: LiveProvider): Promise<Account | null> {
  const { rows } = await db.query<{ enabled: boolean; public_config: Record<string, string>; secret_sealed: string | null }>(
    `SELECT enabled, public_config, secret_sealed FROM integration_accounts WHERE institution_id = $1 AND provider = $2`,
    [institutionId, provider]
  );
  const r = rows[0];
  if (!r) return null;
  return { enabled: r.enabled, config: r.public_config, secret: r.secret_sealed ? (JSON.parse(decryptSecret(r.secret_sealed)) as Record<string, string>) : {} };
}

/** Saves an account; empty secret fields keep the saved ones. */
export async function saveAccount(institutionId: number, userId: number, input: LiveIntegrationInput): Promise<void> {
  const old = await loadAccount(institutionId, input.provider);
  let config: Record<string, string>;
  let secret: Record<string, string>;
  if (input.provider === 'zoom') {
    config = { account_id: input.account_id, client_id: input.client_id };
    secret = { client_secret: input.client_secret || old?.secret.client_secret || '', webhook_secret: input.webhook_secret || old?.secret.webhook_secret || '' };
    if (!secret.client_secret) throw badRequest('Enter the client secret', { client_secret: 'required' });
  } else if (input.provider === 'teams') {
    config = { tenant_id: input.tenant_id, client_id: input.client_id, organizer: input.organizer };
    secret = { client_secret: input.client_secret || old?.secret.client_secret || '' };
    if (!secret.client_secret) throw badRequest('Enter the client secret', { client_secret: 'required' });
  } else {
    config = { client_email: input.client_email, organizer: input.organizer };
    secret = { private_key: input.private_key || old?.secret.private_key || '' };
    if (!secret.private_key?.includes('PRIVATE KEY')) throw badRequest('Paste the private key of the service account (PEM)', { private_key: 'invalid' });
  }
  await db.query(
    `INSERT INTO integration_accounts (institution_id, provider, enabled, public_config, secret_sealed, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT ON CONSTRAINT integration_accounts_institution_id_provider_key
     DO UPDATE SET enabled = EXCLUDED.enabled, public_config = EXCLUDED.public_config, secret_sealed = EXCLUDED.secret_sealed, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [institutionId, input.provider, input.enabled, JSON.stringify(config), encryptSecret(JSON.stringify(secret)), userId]
  );
  tokens.delete(`${institutionId}:${input.provider}`);
}

// access tokens per institution and provider, reused until shortly before they expire
const tokens = new Map<string, { token: string; until: number }>();

async function cachedToken(key: string, fetchToken: () => Promise<{ token: string; expiresIn: number }>): Promise<string> {
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await fetchToken();
  tokens.set(key, { token: t.token, until: Date.now() + (t.expiresIn - 60) * 1000 });
  return t.token;
}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; message?: string; error_description?: string };
  if (!res.ok) {
    const msg = body.error_description ?? body.message ?? (typeof body.error === 'object' ? JSON.stringify(body.error) : String(body.error ?? `HTTP ${res.status}`));
    throw new HttpError(400, `${what} refused the request: ${msg}`.slice(0, 300), undefined, 'PROVIDER_ERROR');
  }
  return body;
}

async function zoom(inst: number, a: Account, m: MeetingRequest): Promise<Meeting> {
  const token = await cachedToken(`${inst}:zoom`, async () => {
    const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(a.config.account_id!)}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${a.config.client_id}:${a.secret.client_secret}`).toString('base64')}` },
    });
    const j = await json<{ access_token: string; expires_in: number }>(res, 'Zoom');
    return { token: j.access_token, expiresIn: j.expires_in };
  });
  const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: m.title,
      type: 2,
      start_time: m.startsAt.toISOString(),
      duration: m.durationMinutes,
      settings: { join_before_host: false, waiting_room: true, auto_recording: 'cloud' },
    }),
  });
  const j = await json<{ id: number; join_url: string; start_url: string }>(res, 'Zoom');
  return { joinUrl: j.join_url, hostUrl: j.start_url, externalId: String(j.id) };
}

async function teams(inst: number, a: Account, m: MeetingRequest): Promise<Meeting> {
  const token = await cachedToken(`${inst}:teams`, async () => {
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(a.config.tenant_id!)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: a.config.client_id!, client_secret: a.secret.client_secret!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    const j = await json<{ access_token: string; expires_in: number }>(res, 'Microsoft');
    return { token: j.access_token, expiresIn: j.expires_in };
  });
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(a.config.organizer!)}/onlineMeetings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: m.title, startDateTime: m.startsAt.toISOString(), endDateTime: new Date(m.startsAt.getTime() + m.durationMinutes * 60_000).toISOString() }),
  });
  const j = await json<{ id: string; joinWebUrl: string }>(res, 'Microsoft Teams');
  return { joinUrl: j.joinWebUrl, hostUrl: '', externalId: j.id };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

async function meet(inst: number, a: Account, m: MeetingRequest): Promise<Meeting> {
  const token = await cachedToken(`${inst}:meet`, async () => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({ iss: a.config.client_email, sub: a.config.organizer, scope: 'https://www.googleapis.com/auth/calendar.events', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
    );
    const signature = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(a.secret.private_key!.replace(/\\n/g, '\n'));
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(signature)}` }),
    });
    const j = await json<{ access_token: string; expires_in: number }>(res, 'Google');
    return { token: j.access_token, expiresIn: j.expires_in };
  });
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: m.title,
      start: { dateTime: m.startsAt.toISOString() },
      end: { dateTime: new Date(m.startsAt.getTime() + m.durationMinutes * 60_000).toISOString() },
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  });
  const j = await json<{ id: string; hangoutLink?: string }>(res, 'Google Calendar');
  if (!j.hangoutLink) throw new HttpError(400, 'Google did not add a Meet link — is Google Meet turned on for this Workspace?', undefined, 'PROVIDER_ERROR');
  return { joinUrl: j.hangoutLink, hostUrl: '', externalId: j.id };
}

const FAKE_HOSTS: Record<LiveProvider, (n: number) => string> = {
  zoom: (n) => `https://us02web.zoom.us/j/${9_000_000_000 + n}`,
  teams: (n) => `https://teams.microsoft.com/l/meetup-join/fake-${n}`,
  meet: (n) => `https://meet.google.com/fak-${String(n).padStart(4, '0')}-abc`,
};

/** Whether Acadex can create meetings on this provider for the institution. */
export async function canCreate(institutionId: number, provider: string): Promise<boolean> {
  if (provider === 'jitsi') return true;
  if (!['zoom', 'teams', 'meet'].includes(provider)) return false;
  const a = await loadAccount(institutionId, provider as LiveProvider);
  return !!a?.enabled;
}

/** Creates a meeting on the institution's account. */
export async function createMeeting(institutionId: number, provider: string, m: MeetingRequest): Promise<Meeting> {
  if (provider === 'jitsi') return { joinUrl: jitsiRoom(), hostUrl: '', externalId: '' };
  const a = await loadAccount(institutionId, provider as LiveProvider);
  if (!a?.enabled) throw badRequest(`Connect ${provider} under Settings → Integrations, or paste the meeting link`, { join_url: 'required' });
  if (getConfig().liveDriver === 'fake') {
    fakeMeetings.push({ provider, title: m.title });
    const n = fakeMeetings.length;
    return { joinUrl: FAKE_HOSTS[provider as LiveProvider](n), hostUrl: provider === 'zoom' ? `${FAKE_HOSTS.zoom(n)}?host=1` : '', externalId: `fake-${provider}-${n}` };
  }
  if (provider === 'zoom') return zoom(institutionId, a, m);
  if (provider === 'teams') return teams(institutionId, a, m);
  return meet(institutionId, a, m);
}

/** Zoom webhook signature: v0=HMAC-SHA256(secret, "v0:{timestamp}:{body}"). */
export function zoomSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

/**
 * A student joined a live class (through Acadex or, for Zoom, reported by its webhook): mark
 * them present in the course's class register (late after 10 minutes), never overriding a
 * mark other than absent.
 */
export async function markLiveAttendance(
  institutionId: number,
  l: { id: number; offering_id: number; starts_at: Date; auto_attendance: boolean },
  studentId: number,
  userId: number,
  at: number = Date.now()
): Promise<void> {
  if (!l.auto_attendance) return;
  const { rows: o } = await db.query<{ section_id: number | null }>(`SELECT section_id FROM course_offerings WHERE id = $1`, [l.offering_id]);
  const sectionId = o[0]?.section_id;
  if (!sectionId) return;
  const date = todayIn(await institutionTimeZone(institutionId), l.starts_at);
  const late = Math.max(0, Math.round((at - l.starts_at.getTime()) / 60000));
  const { rows: sess } = await db.query<{ id: number }>(
    `INSERT INTO attendance_sessions (institution_id, section_id, offering_id, date, kind) VALUES ($1,$2,$3,$4,'class')
     ON CONFLICT ON CONSTRAINT attendance_sessions_section_id_offering_id_date_period_id_key DO UPDATE SET updated_at = now() RETURNING id`,
    [institutionId, sectionId, l.offering_id, date]
  );
  await db.query(
    `INSERT INTO attendance_records (session_id, student_id, institution_id, status, minutes_late, method, marked_by) VALUES ($1,$2,$3,$4,$5,'live',$6)
     ON CONFLICT ON CONSTRAINT attendance_records_pkey DO UPDATE SET status = EXCLUDED.status, minutes_late = EXCLUDED.minutes_late, method = 'live' WHERE attendance_records.status = 'absent'`,
    [sess[0]!.id, studentId, institutionId, late > 10 ? 'late' : 'present', late > 10 ? late : null, userId]
  );
}
