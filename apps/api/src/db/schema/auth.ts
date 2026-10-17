// Sessions, refresh tokens, one-time email tokens, two-factor authentication and the
// outgoing email log.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, serial, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './core';

/** A signed-in device. Access tokens carry its id; revoking it signs that device out. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    /** absolute limit, however often the session is refreshed */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    userAgent: text('user_agent').notNull().default(''),
    ip: text('ip').notNull().default(''),
    /** the user completed a second factor for this session */
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    /** a support session: the platform administrator signed in as this user */
    impersonatedBy: integer('impersonated_by'),
  },
  (t) => [
    index('idx_sessions_user').on(t.userId),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'sessions_user_id_fkey' }).onDelete('cascade'),
  ]
);

/** Rotating refresh tokens (stored hashed). Reusing a spent one revokes the whole session. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: serial('id').primaryKey(),
    sessionId: uuid('session_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    unique('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('idx_refresh_tokens_session').on(t.sessionId),
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id], name: 'refresh_tokens_session_id_fkey' }).onDelete('cascade'),
  ]
);

/** Single-use links sent by email: invitations, password resets, email verification. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: integer('created_by'),
  },
  (t) => [
    unique('email_tokens_token_hash_key').on(t.tokenHash),
    index('idx_email_tokens_user').on(t.userId, t.purpose),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'email_tokens_user_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [t.createdBy], foreignColumns: [users.id], name: 'email_tokens_created_by_fkey' }).onDelete('set null'),
    check('email_tokens_purpose_check', sql`${t.purpose} IN ('invite', 'password_reset', 'verify_email')`),
  ]
);

/** A second factor. The TOTP secret is encrypted at rest (AES-256-GCM). */
export const mfaFactors = pgTable(
  'mfa_factors',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    type: text('type').notNull().default('totp'),
    secretEnc: text('secret_enc').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** last accepted 30-second step, so a code can't be replayed */
    lastUsedStep: integer('last_used_step'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('mfa_factors_user_id_type_key').on(t.userId, t.type),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'mfa_factors_user_id_fkey' }).onDelete('cascade'),
    check('mfa_factors_type_check', sql`${t.type} IN ('totp')`),
  ]
);

/** Single-use backup codes for when the authenticator is unavailable (stored hashed). */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_mfa_recovery_codes_user').on(t.userId),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'mfa_recovery_codes_user_id_fkey' }).onDelete('cascade'),
  ]
);

/** Every email the platform sends (delivery log; the development driver only records). */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: serial('id').primaryKey(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    textBody: text('text_body').notNull(),
    htmlBody: text('html_body').notNull().default(''),
    template: text('template').notNull().default(''),
    userId: integer('user_id'),
    institutionId: integer('institution_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    index('idx_email_outbox_to').on(t.toEmail),
    foreignKey({ columns: [t.userId], foreignColumns: [users.id], name: 'email_outbox_user_id_fkey' }).onDelete('set null'),
  ]
);
