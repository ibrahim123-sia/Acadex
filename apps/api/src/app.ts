import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { pool } from './db/pool';
import { dbContext } from './db/context';
import { getConfig, type Config } from './config';
import { errorHandler } from './lib/errors';
import { httpLogger } from './lib/logger';
import { PAGINATION_HEADERS } from './lib/pagination';
import { buildOpenApi, docsHtml } from './openapi';
import { loadDrizzleMigrations } from './db/migrate';
import authRoutes from './routes/auth';
import platformRoutes from './routes/platform';
import institutionRoutes from './routes/institution';
import structureRoutes from './routes/structure';
import settingsRoutes from './routes/settings';
import peopleRoutes from './routes/people';
import importRoutes from './routes/imports';
import documentRoutes from './routes/documents';
import yearEndRoutes from './routes/yearend';
import recordRoutes from './routes/records';
import groupRoutes from './routes/group';
import publicRoutes from './routes/public';
import fileRoutes from './routes/files';
import meRoutes from './routes/me';
import parentRoutes from './routes/parent';
import pdfRoutes from './routes/pdf';
import rolesRoutes from './routes/roles';

export function createApp(config: Config = getConfig()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(httpLogger);
  app.use(helmet());
  app.use(
    cors({
      // requests without an Origin header (curl, server-to-server) are not CORS requests
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: [...PAGINATION_HEADERS, 'X-Request-Id'],
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(
    '/api',
    rateLimit({ windowMs: 60 * 1000, limit: config.apiRateLimit, standardHeaders: 'draft-8', legacyHeaders: false })
  );
  // Failed logins only, keyed by IP + email, so one attacker can't lock out a whole institution.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email || '').toLowerCase().trim()}`,
    message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  });
  app.use('/api/auth/login', loginLimiter);
  // second factor, email links and reset requests: per IP (+ email where there is one)
  const sensitive = (limit: number, skipSuccessfulRequests: boolean) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit,
      skipSuccessfulRequests,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email || '').toLowerCase().trim()}`,
      message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
    });
  app.use('/api/auth/mfa/verify', sensitive(config.loginRateLimit, true));
  app.use('/api/auth/invites/accept', sensitive(config.loginRateLimit, true));
  app.use('/api/auth/password-reset/confirm', sensitive(config.loginRateLimit, true));
  app.use('/api/auth/password-reset/request', sensitive(5, false)); // also limits email flooding
  app.use('/api/auth/verify-email', sensitive(10, false));

  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'OK', db: 'connected', service: 'Acadex API' });
    } catch (e) {
      req.log.error({ err: e }, 'health check: database unreachable');
      res.status(503).json({ status: 'ERROR', db: 'disconnected' });
    }
  });

  // readiness: the database answers and every migration in this build has been applied
  app.get('/api/ready', async (req, res) => {
    try {
      const expected = loadDrizzleMigrations().map((m) => m.id);
      const { rows } = await pool.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = ANY($1::text[])', [expected]);
      const missing = expected.filter((id) => !rows.some((r) => r.id === id));
      if (missing.length) return void res.status(503).json({ status: 'NOT_READY', reason: 'pending migrations', pending: missing.length });
      res.json({ status: 'READY' });
    } catch (e) {
      req.log.error({ err: e }, 'readiness: database unreachable');
      res.status(503).json({ status: 'NOT_READY', reason: 'database unreachable' });
    }
  });

  const spec = buildOpenApi();
  app.get('/api/openapi.json', (_req, res) => res.json(spec));
  app.get('/api/docs', (_req, res) => {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
    );
    res.type('html').send(docsHtml);
  });

  app.use('/api', dbContext);
  app.use('/api/auth', authRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/institution', rolesRoutes);
  app.use('/api/institution', institutionRoutes);
  app.use('/api/institution', structureRoutes);
  app.use('/api/institution', settingsRoutes);
  app.use('/api/institution', peopleRoutes);
  app.use('/api/institution', importRoutes);
  app.use('/api/institution', documentRoutes);
  app.use('/api/institution', yearEndRoutes);
  app.use('/api/institution', recordRoutes);
  app.use('/api/group', groupRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/parent', parentRoutes);
  app.use('/api/pdf', pdfRoutes);

  app.get('/', (_req, res) => res.json({ message: 'Acadex API' }));

  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);

  return app;
}
