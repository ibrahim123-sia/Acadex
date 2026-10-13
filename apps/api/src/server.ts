import 'dotenv/config';
import { loadConfig, type Config } from './config';

let config: Config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
}

const { createApp } = await import('./app');
const { logger } = await import('./lib/logger');
const { startOutboxFlusher } = await import('./lib/mailer');
startOutboxFlusher();

const server = createApp(config).listen(config.port, () => logger.info(`Acadex API listening on port ${config.port}`));

// Finish in-flight requests on redeploys instead of dropping them.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
