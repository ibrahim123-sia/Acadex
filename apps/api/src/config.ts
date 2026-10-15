// Environment configuration, validated once at startup. The server refuses to boot with
// an unsafe configuration instead of failing later at the first login.
import crypto from 'node:crypto';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z
    .string({ error: 'JWT_SECRET is required' })
    .min(32, 'JWT_SECRET must be at least 32 characters (generate one with: openssl rand -hex 32)'),
  /** Lifetime of access tokens (short; renewed with the refresh cookie). */
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  /** A refresh token is valid this many days after its last use (sliding). */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Hard limit on a session's age, however often it is refreshed. */
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(730).default(90),
  /** 'required' forces administrators to use 2FA; defaults to required in production. */
  ADMIN_MFA: z.enum(['required', 'optional']).optional(),
  /** 32-byte key (hex or base64) for encrypting 2FA secrets. Required in production. */
  MFA_ENCRYPTION_KEY: z.string().optional(),
  /** Base URL of the web app, used in email links. */
  APP_URL: z.string().url().default('http://localhost:3000'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  /** log: emails go to the email_outbox table and the log (development); smtp: real delivery. */
  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Acadex <no-reply@acadex.app>'),
  // Comma-separated list of browser origins allowed to call the API.
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  // Set when running behind a proxy/load balancer so rate limits see the real client IP.
  TRUST_PROXY: z.string().default('false'),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10), // failed attempts per 15 min per IP+email
  API_RATE_LIMIT: z.coerce.number().int().positive().default(600), // requests per minute per IP
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool(false),
  SENTRY_DSN: z.string().optional(),
  /** local: files on disk (development); s3: any S3-compatible store (AWS, Cloudflare R2, MinIO) */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  /** none: skip; clamav: scan every upload with clamd at CLAMAV_HOST:CLAMAV_PORT */
  VIRUS_SCAN: z.enum(['none', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  /** pgboss: queues in PostgreSQL; inline: in memory, run by drainJobs() (tests) */
  JOBS_DRIVER: z.enum(['pgboss', 'inline']).default('pgboss'),
  /** run the job workers inside the API process (turn off when running `npm run worker` separately) */
  JOBS_WORKER: bool(true),
  /** none: no push; webpush: browser push with the VAPID keys; fake: recorded in memory (tests) */
  PUSH_DRIVER: z.enum(['none', 'webpush', 'fake']).default('none'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@acadex.app'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  sessionMaxAgeDays: number;
  adminMfaRequired: boolean;
  mfaEncryptionKey: Buffer;
  appUrl: string;
  cookieSecure: boolean;
  cookieSameSite: 'strict' | 'lax' | 'none';
  mailDriver: 'log' | 'smtp';
  smtpUrl?: string;
  mailFrom: string;
  corsOrigins: string[];
  trustProxy: boolean | number | string;
  loginRateLimit: number;
  apiRateLimit: number;
  logLevel: string;
  logPretty: boolean;
  sentryDsn?: string;
  storage: {
    driver: 'local' | 's3';
    localDir: string;
    s3?: { bucket: string; region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean };
  };
  virusScan: { driver: 'none' | 'clamav'; host: string; port: number };
  jobsDriver: 'pgboss' | 'inline';
  jobsWorker: boolean;
  push: { driver: 'none' | 'webpush' | 'fake'; publicKey?: string; privateKey?: string; subject: string };
}

function parseKey(raw: string): Buffer | null {
  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : null;
  const key = hex ?? Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const c = parsed.data;
  const production = c.NODE_ENV === 'production';
  const problems: string[] = [];

  let mfaKey: Buffer | null = null;
  if (c.MFA_ENCRYPTION_KEY) {
    mfaKey = parseKey(c.MFA_ENCRYPTION_KEY);
    if (!mfaKey) problems.push('  - MFA_ENCRYPTION_KEY: must be 32 bytes as hex (64 chars) or base64 (openssl rand -hex 32)');
  } else if (production) {
    problems.push('  - MFA_ENCRYPTION_KEY: required in production (openssl rand -hex 32)');
  }
  if (c.MAIL_DRIVER === 'smtp' && !c.SMTP_URL) problems.push('  - SMTP_URL: required when MAIL_DRIVER=smtp');
  if (c.COOKIE_SAMESITE === 'none' && c.COOKIE_SECURE === 'false') {
    problems.push('  - COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  if (c.STORAGE_DRIVER === 's3' && !c.S3_BUCKET) problems.push('  - S3_BUCKET: required when STORAGE_DRIVER=s3');
  if (c.PUSH_DRIVER === 'webpush' && (!c.VAPID_PUBLIC_KEY || !c.VAPID_PRIVATE_KEY)) {
    problems.push('  - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: required when PUSH_DRIVER=webpush (npx web-push generate-vapid-keys)');
  }
  if (problems.length) throw new Error(`Invalid configuration:\n${problems.join('\n')}`);

  const trustProxy = c.TRUST_PROXY === 'true' ? 1 : c.TRUST_PROXY === 'false' ? false : c.TRUST_PROXY;
  return {
    env: c.NODE_ENV,
    port: c.PORT,
    jwtSecret: c.JWT_SECRET,
    accessTokenTtl: c.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: c.REFRESH_TOKEN_TTL_DAYS,
    sessionMaxAgeDays: c.SESSION_MAX_AGE_DAYS,
    adminMfaRequired: (c.ADMIN_MFA ?? (production ? 'required' : 'optional')) === 'required',
    // development/test fallback: derived from JWT_SECRET (never used in production)
    mfaEncryptionKey: mfaKey ?? deriveDevKey(c.JWT_SECRET),
    appUrl: c.APP_URL.replace(/\/+$/, ''),
    cookieSecure: c.COOKIE_SECURE ? c.COOKIE_SECURE === 'true' : production,
    cookieSameSite: c.COOKIE_SAMESITE,
    mailDriver: c.MAIL_DRIVER,
    smtpUrl: c.SMTP_URL,
    mailFrom: c.MAIL_FROM,
    corsOrigins: c.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy,
    loginRateLimit: c.LOGIN_RATE_LIMIT,
    apiRateLimit: c.API_RATE_LIMIT,
    logLevel: c.LOG_LEVEL,
    logPretty: c.LOG_PRETTY,
    sentryDsn: c.SENTRY_DSN,
    storage: {
      driver: c.STORAGE_DRIVER,
      localDir: c.STORAGE_LOCAL_DIR,
      s3: c.S3_BUCKET
        ? {
            bucket: c.S3_BUCKET,
            region: c.S3_REGION,
            endpoint: c.S3_ENDPOINT,
            accessKeyId: c.S3_ACCESS_KEY_ID,
            secretAccessKey: c.S3_SECRET_ACCESS_KEY,
            forcePathStyle: c.S3_FORCE_PATH_STYLE,
          }
        : undefined,
    },
    virusScan: { driver: c.VIRUS_SCAN, host: c.CLAMAV_HOST, port: c.CLAMAV_PORT },
    jobsDriver: c.JOBS_DRIVER,
    jobsWorker: c.JOBS_WORKER,
    push: { driver: c.PUSH_DRIVER, publicKey: c.VAPID_PUBLIC_KEY, privateKey: c.VAPID_PRIVATE_KEY, subject: c.VAPID_SUBJECT },
  };
}

/** Development/test only: a stable key derived from JWT_SECRET. */
function deriveDevKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'acadex', 'mfa-secret-encryption', 32));
}

let cached: Config | undefined;
/** The process configuration (loaded and validated once). */
export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
/** Tests: forget the cached configuration. */
export function resetConfigCache(): void {
  cached = undefined;
}
