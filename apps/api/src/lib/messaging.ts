// Text messages and WhatsApp behind one interface (fee reminders, absence alerts).
//   log    → printed to the server log (development)
//   fake   → recorded in memory (tests)
//   twilio → Twilio Messaging API (SMS, and WhatsApp with a "whatsapp:" sender)
//   meta   → WhatsApp Cloud API with a pre-approved template (one {{1}} text parameter)
// Every attempt is written to delivery_logs.
import { getConfig } from '../config';
import { asSystem, db } from '../db/context';
import { logger } from './logger';

export type Channel = 'sms' | 'whatsapp';
export interface OutgoingMessage {
  channel: Channel;
  to: string;
  text: string;
}
export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

/** Messages the fake driver recorded (tests). */
export const sentMessages: OutgoingMessage[] = [];

/** E.164 for Pakistani numbers written locally (03xx…), otherwise as given with a leading +. */
export function normalizePhone(raw: string, defaultCountry = '92'): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits.length >= 9 ? digits : null;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+${defaultCountry}${digits.slice(1)}`;
  return digits.length >= 9 ? `+${digits}` : null;
}

async function twilio(m: OutgoingMessage): Promise<SendResult> {
  const t = getConfig().messaging.twilio;
  const from = m.channel === 'whatsapp' ? t.whatsappFrom : t.smsFrom;
  if (!from) return { ok: false, error: `no Twilio ${m.channel} sender configured` };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      From: m.channel === 'whatsapp' && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from,
      To: m.channel === 'whatsapp' ? `whatsapp:${m.to}` : m.to,
      Body: m.text,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  return res.ok ? { ok: true, id: json.sid } : { ok: false, error: json.message ?? `HTTP ${res.status}` };
}

async function meta(m: OutgoingMessage): Promise<SendResult> {
  const c = getConfig().messaging.meta;
  const res = await fetch(`https://graph.facebook.com/v20.0/${c.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: m.to.replace(/^\+/, ''),
      type: 'template',
      template: { name: c.template, language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: m.text.slice(0, 1000) }] }] },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
  return res.ok ? { ok: true, id: json.messages?.[0]?.id } : { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
}

export function channelEnabled(channel: Channel): boolean {
  const cfg = getConfig().messaging;
  return (channel === 'sms' ? cfg.sms : cfg.whatsapp) !== 'none';
}

export async function sendMessage(m: OutgoingMessage): Promise<SendResult> {
  const cfg = getConfig().messaging;
  const driver = m.channel === 'sms' ? cfg.sms : cfg.whatsapp;
  try {
    if (driver === 'none') return { ok: false, error: `${m.channel} is turned off` };
    if (driver === 'fake') {
      sentMessages.push(m);
      return { ok: true, id: `fake_${sentMessages.length}` };
    }
    if (driver === 'log') {
      logger.info({ channel: m.channel, to: m.to, text: m.text }, 'message (log driver)');
      return { ok: true };
    }
    if (driver === 'twilio') return await twilio(m);
    return await meta(m);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Send and log (delivery_logs). Returns whether it went out. */
export async function sendAndLog(institutionId: number, m: Omit<OutgoingMessage, 'to'> & { to: string; userId?: number | null }): Promise<boolean> {
  const to = normalizePhone(m.to);
  if (!to) {
    await asSystem(() => db.query(`INSERT INTO delivery_logs (institution_id, user_id, channel, status, error, to_address) VALUES ($1,$2,$3,'skipped','no valid phone number',$4)`, [
      institutionId, m.userId ?? null, m.channel, m.to,
    ]));
    return false;
  }
  const r = await sendMessage({ channel: m.channel, to, text: m.text });
  await asSystem(() => db.query(`INSERT INTO delivery_logs (institution_id, user_id, channel, status, error, to_address) VALUES ($1,$2,$3,$4,$5,$6)`, [
    institutionId, m.userId ?? null, m.channel, r.ok ? 'sent' : 'failed', r.ok ? null : r.error, to,
  ]));
  return r.ok;
}
