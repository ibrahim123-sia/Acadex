const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const pool = require('./db/pool');
const { loadConfig } = require('./config');
const { wrap } = require('./lib/router');
const { errorHandler } = require('./lib/errors');
const { PAGINATION_HEADERS } = require('./lib/pagination');

function createApp(config = loadConfig()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(
    cors({
      // requests without an Origin header (curl, server-to-server) are not CORS requests
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: PAGINATION_HEADERS,
    })
  );
  app.use(express.json({ limit: '100kb' }));

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
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').toLowerCase().trim()}`,
    message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  });
  app.use('/api/auth/login', loginLimiter);

  app.get('/api/health', wrap(async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'OK', db: 'connected', service: 'Acadex API' });
    } catch (e) {
      console.error('health check: database unreachable', e.message);
      res.status(503).json({ status: 'ERROR', db: 'disconnected' });
    }
  }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/platform', require('./routes/platform'));
  app.use('/api/school', require('./routes/school'));
  app.use('/api/me', require('./routes/me'));
  app.use('/api/parent', require('./routes/parent'));
  app.use('/api/pdf', require('./routes/pdf'));

  app.get('/', (req, res) => res.json({ message: 'Acadex — School Management SaaS API' }));

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
