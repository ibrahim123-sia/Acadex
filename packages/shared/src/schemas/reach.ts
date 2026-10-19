// Reach and communication (Phase 5): messaging with safeguarding rules, tickets, parent–teacher
// meetings, emergency broadcasts, live-class provider accounts and per-person delivery choices.
import { z } from 'zod';
import { id, isoDate, optionalId, requiredText, text } from './common';

// ---------------------------------------------------------------- messaging

/**
 * How one-to-one conversations between an adult (staff) and a student under 18 work:
 * blocked (use class groups), cc_guardians (allowed, the student's guardians are added and see
 * everything — the default), or allowed (private; the tenant takes responsibility).
 */
export const MINOR_DM_POLICIES = ['blocked', 'cc_guardians', 'allowed'] as const;

export const messagingSettingsBody = z.object({
  enabled: z.boolean().default(true),
  minor_dm: z.enum(MINOR_DM_POLICIES).default('cc_guardians'),
  /** students may message classmates (same section) */
  student_to_student: z.boolean().default(false),
  /** guardians may start conversations with their children's teachers */
  guardian_to_teacher: z.boolean().default(true),
  /** the profanity filter masks words and flags the message for review */
  profanity_filter: z.boolean().default(true),
});
export type MessagingSettings = z.infer<typeof messagingSettingsBody>;

export const conversationBody = z.object({
  /** people to talk to (one for a direct conversation) */
  user_ids: z.array(id).min(1).max(200),
  title: text(120).default(''),
  /** the first message */
  body: requiredText(5000),
});

/** A class group: everyone in one of the teacher's courses (and, optionally, their guardians). */
export const classConversationBody = z.object({
  offering_id: id,
  title: text(120).default(''),
  include_guardians: z.boolean().default(false),
  body: requiredText(5000),
});

export const messageBody = z.object({ body: requiredText(5000) });
export const reportBody = z.object({ reason: requiredText(1000) });
export const reviewReportBody = z.object({ status: z.enum(['actioned', 'dismissed']), note: text(1000).default(''), hide_message: z.boolean().default(false), lock_conversation: z.boolean().default(false) });

// ---------------------------------------------------------------- tickets

export const TICKET_CATEGORIES = ['complaint', 'feedback', 'suggestion', 'academic', 'fees', 'transport', 'it', 'facilities', 'other'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
/** hours until a ticket of each priority is overdue */
export const TICKET_SLA_HOURS: Record<(typeof TICKET_PRIORITIES)[number], number> = { urgent: 4, high: 24, normal: 72, low: 168 };

export const ticketBody = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: requiredText(200),
  body: requiredText(5000),
  /** the child it is about (guardians) */
  student_id: optionalId,
  /** feedback without a name: the office does not see who raised it */
  anonymous: z.boolean().default(false),
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
});
export const ticketPatch = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assigned_to: id.nullable().optional(),
});
export const ticketCommentBody = z.object({ body: requiredText(5000), internal: z.boolean().default(false) });
export const ticketRatingBody = z.object({ satisfaction: z.coerce.number().int().min(1).max(5) });

// ---------------------------------------------------------------- parent–teacher meetings

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:MM');
export const ptmEventBody = z
  .object({
    title: requiredText(200),
    date: isoDate,
    start_time: hhmm,
    end_time: hhmm,
    slot_minutes: z.coerce.number().int().min(5).max(120).default(10),
    mode: z.enum(['in_person', 'online']).default('in_person'),
    location: text(200).default(''),
    section_ids: z.array(id).min(1).max(200),
    /** university-style office hours: students book for themselves */
    allow_students: z.boolean().default(false),
  })
  .refine((v) => v.start_time < v.end_time, { message: 'The end time must be after the start time', path: ['end_time'] });
export const ptmBookBody = z.object({ student_id: id, note: text(500).default('') });
export const ptmSlotPatch = z.object({ status: z.enum(['open', 'blocked', 'done', 'no_show']), note: text(500).optional() });

// ---------------------------------------------------------------- broadcasts and delivery

export const BROADCAST_CHANNELS = ['app', 'email', 'push', 'whatsapp'] as const;
export const broadcastBody = z.object({
  title: requiredText(160),
  message: requiredText(1000),
  audience: z.enum(['everyone', 'staff', 'students', 'guardians']).default('everyone'),
  campus_id: optionalId,
  section_ids: z.array(id).max(500).default([]),
  channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1).default([...BROADCAST_CHANNELS]),
});

export const DIGEST_MODES = ['off', 'daily', 'weekly'] as const;

/** Per-person account preferences kept on the server (follow the person across devices). */
export const accountPreferencesBody = z.object({
  /** the interface is in English; kept for accounts saved before */
  locale: z.enum(['en']).nullable().optional(),
  low_bandwidth: z.boolean().optional(),
});

// ---------------------------------------------------------------- live-class providers

export const LIVE_INTEGRATIONS = ['zoom', 'teams', 'meet'] as const;
export const liveIntegrationBody = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('zoom'),
    enabled: z.boolean().default(true),
    account_id: requiredText(100),
    client_id: requiredText(100),
    /** empty keeps the saved secret */
    client_secret: text(200).default(''),
    /** the webhook secret token (recordings and attendance from Zoom) */
    webhook_secret: text(200).default(''),
  }),
  z.object({
    provider: z.literal('teams'),
    enabled: z.boolean().default(true),
    tenant_id: requiredText(100),
    client_id: requiredText(100),
    client_secret: text(200).default(''),
    /** the Microsoft 365 user (id or email) meetings are created for */
    organizer: requiredText(200),
  }),
  z.object({
    provider: z.literal('meet'),
    enabled: z.boolean().default(true),
    client_email: requiredText(200),
    /** the service account's private key (PEM); empty keeps the saved one */
    private_key: text(5000).default(''),
    /** the Google Workspace user the service account acts for (domain-wide delegation) */
    organizer: requiredText(200),
  }),
]);
export type LiveIntegrationInput = z.infer<typeof liveIntegrationBody>;
