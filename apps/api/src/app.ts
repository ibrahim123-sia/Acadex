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
import authRoutes from './routes/auth';
import platformRoutes from './routes/platform';
import schoolRoutes from './routes/school';
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
  // Failed logins only, keyed by IP + email, so one attacker can't lock out a whole school.
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

  app.use('/api', dbContext);
  app.use('/api/auth', authRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/school', rolesRoutes);
  app.use('/api/school', schoolRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/parent', parentRoutes);
  app.use('/api/pdf', pdfRoutes);

  app.get('/', (_req, res) => res.json({ message: 'Acadex API' }));

  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);

  return app;
}
