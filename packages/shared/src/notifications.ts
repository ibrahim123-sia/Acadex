import { z } from 'zod';

/**
 * What people can be notified about. In-app notifications are always on; email and push follow
 * each person's preferences, starting from these defaults.
 */
export const NOTIFICATION_TYPES = {
  assignment_posted: { label: 'New work posted in my courses', email: false, push: true },
  due_soon: { label: 'Reminders before work is due', email: true, push: true },
  grade_released: { label: 'Grades and feedback', email: true, push: true },
  submission_received: { label: 'New submissions to grade', email: false, push: false },
  announcement: { label: 'Announcements', email: true, push: true },
  attendance_alert: { label: 'Attendance alerts', email: true, push: true },
  leave_decision: { label: 'Leave requests', email: true, push: true },
  discussion_reply: { label: 'Replies in discussions', email: false, push: true },
  live_class: { label: 'Live classes starting', email: false, push: true },
  certificate_issued: { label: 'Certificates', email: true, push: false },
  fee_due: { label: 'Fee reminders and dues', email: true, push: true },
  payment_received: { label: 'Payment receipts', email: true, push: false },
  exam_update: { label: 'Exam schedules, admit cards and results', email: true, push: true },
  admission_update: { label: 'Admission applications', email: true, push: false },
  system: { label: 'Account and system messages', email: true, push: false },
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:MM');

export const notificationPreferencesBody = z.object({
  channels: z
    .partialRecord(z.enum(NOTIFICATION_TYPE_KEYS as [NotificationType, ...NotificationType[]]), z.object({ email: z.boolean(), push: z.boolean() }))
    .default({}),
  /** no email or push between these local times (in-app notifications still arrive) */
  quiet_hours: z.object({ start: hhmm, end: hhmm }).nullable().default(null),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesBody>;

export const pushSubscriptionBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(200) }),
});

/** Whether a local time (minutes after midnight) falls in quiet hours (which may cross midnight). */
export function inQuietHours(minutes: number, q: { start: string; end: string } | null | undefined): boolean {
  if (!q) return false;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const start = toMin(q.start);
  const end = toMin(q.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** The channels a person gets for a type: their choice, else the default. */
export function channelsFor(type: string, prefs: Partial<Record<string, { email: boolean; push: boolean }>> | null | undefined) {
  const def = NOTIFICATION_TYPES[type as NotificationType] ?? NOTIFICATION_TYPES.system;
  return prefs?.[type] ?? { email: def.email, push: def.push };
}
