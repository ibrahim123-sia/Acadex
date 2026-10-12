const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');
const { wrap } = require('./lib/router');
const { errorHandler } = require('./lib/errors');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

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
